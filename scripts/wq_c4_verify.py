"""Independent SDK verification of the C4 live-UI rejection ladder.

Usage: python scripts/wq_c4_verify.py [path/to/c4-ui-report.json]

The UI run (tools/pwtest/levels_payout.mjs with WQ_UI_MODE=injection) types four
actions into the real gate input from one throwaway wallet: a blocklisted
injection, an injection that slips past the deterministic layer-1 gate and has to
be answered by the AI rubric alone, harmless off-topic text, and then the
legitimate action. Everything below re-reads those four transactions straight
from StudioNet with the SDK, so the app is not the measure of its own success:

  - consensus: status FINALIZED, result MAJORITY_AGREE, rounds, validator votes,
    and the leader receipt execution result (no VALIDATORS_TIMEOUT / NO_MAJORITY)
  - the leader payload fragment, which is this verifier's per-transaction evidence of
    what that transaction itself did: the contract's [EXPECTED] revert text plus
    execution ERROR/rollback for a layer-1 rejection, the rubric flags (manipulation=1
    or on_topic=0 -> success=0) for an AI-layer rejection, and success=1 for the pay.
    StudioNet receipts carry no block number and eth_getBalance ignores block tags, so
    a per-transaction balance read is not available; a rejection is therefore judged by
    its own execution record (a rollback writes nothing, success=0 never enters the
    contract's payout branch) while the aggregate is judged by the end state below.
  - end state after the whole ladder: get_level_payout(wallet, level) equals exactly one
    payout (base(level) * multiplier / 100), campaign_progress marks only the legit level
    conquered, get_total_credit and eth_getBalance equal that same single figure, and a
    level nobody played still reports 0 atto.

Network rules: one blocking call at a time, 25s between polls, 300s hard
deadline, stop and report after 3 unchanged polls. Credentials come only from
this project's .env and are never printed.
"""
import base64
import json
import os
import re
import sys
import time

import requests
from dotenv import load_dotenv
from eth_account import Account
from genlayer_py import create_client, studionet

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, ".env"))

ADDR = os.environ.get(
    "WQ_CONTRACT_ADDRESS", "0x8b317B94AF764e9de587805d264CbBea59Ce3aE2"
)
RPC = "https://studio.genlayer.com/api"
GEN = 10**18
LEVEL_BASE_GEN = (0, 10, 12, 15, 20, 25, 30, 35, 50, 75, 100)
POLL, DEADLINE, MAX_SAME = 25, 300, 3

report_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    ROOT, "docs", "c4-ui-report.json"
)
with open(report_path, "r", encoding="utf-8") as f:
    report = json.load(f)

wallet = report["signer_address"]
proof = report.get("injection_proof") or {}
level = int(proof.get("level", 1))
# The ladder order, with the per-case measurements the UI run took around each
# transaction (native balance read before and after that one submission).
cases = None
for _e in report.get("levels") or []:
    if _e.get("cases"):
        level = int(_e.get("level", level))
        cases = _e["cases"]
        break
if cases is None:
    raise SystemExit("report has no levels[].cases - the UI ladder did not record anything")
# The .env account only satisfies the SDK client: nothing is signed or sent from it and
# its address is never printed.
client = create_client(chain=studionet, account=Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"]))

print("report      :", report_path)
print("contract    :", ADDR)
print("wallet      :", wallet, "(throwaway signer of the UI run)")
print("level       :", level, proof.get("city"))
print("cases       :", ", ".join("%s=%s" % (c["tag"], c["tx_hash"][:14]) for c in cases))
print("")


def retry(fn, *a, **kw):
    """StudioNet's TLS endpoint intermittently drops requests from this environment,
    so a connection-level error is retried with backoff. Calls stay strictly one at a
    time; anything that is not a transport failure is raised unchanged."""
    last = None
    for i in range(5):
        try:
            return fn(*a, **kw)
        except Exception as e:  # noqa: BLE001 - classified below
            last = e
            name, msg = type(e).__name__, str(e)
            transient = any(s in msg or s in name for s in
                            ("SSL", "Max retries", "Connection", "timed out", "timeout", "fetch failed"))
            if not transient or i == 4:
                raise
            print("    [transport retry %d] %s" % (i + 1, msg[:110]))
            time.sleep(3 * (i + 1))
    raise last


def native_atto(addr):
    j = retry(
        requests.post,
        RPC,
        json={"jsonrpc": "2.0", "id": 1, "method": "eth_getBalance", "params": [addr, "latest"]},
        timeout=30,
    ).json()
    return int(j.get("result", "0x0"), 16)


def wait_finalized(tx_hash):
    prev, same, start, polls = None, 0, time.time(), 0
    raw = None
    while True:
        polls += 1
        raw = retry(client.get_transaction, tx_hash)
        status, result = raw.get("status_name"), raw.get("result_name")
        print("  [%4ds] status=%s result=%s" % (int(time.time() - start), status, result))
        if status in ("FINALIZED", "UNDETERMINED", "CANCELED"):
            break
        if (status, result) == prev:
            same += 1
            if same >= MAX_SAME:
                print("  NO CHANGE x3, stopping and reporting current state")
                break
        else:
            same = 0
        prev = (status, result)
        if time.time() - start > DEADLINE:
            print("  300s deadline reached, reporting current state")
            break
        time.sleep(POLL)
    return raw, polls


def leader_bits(raw):
    """(execution result, leader receipt status, printable payload fragment)."""
    cd = raw.get("consensus_data") or {}
    lr = cd.get("leader_receipt") or [{}]
    r0 = lr[0] if isinstance(lr, list) and lr else {}
    lres = r0.get("result") or {}
    rb = lres.get("raw")
    frag = ""
    if rb:
        blob = base64.b64decode(rb) if isinstance(rb, str) else rb
        frag = "".join(re.findall(r"[ -~]{3,}", blob.decode("utf-8", "replace")))[:1400]
    return r0.get("execution_result"), lres.get("status"), frag


def read(method, args):
    return retry(client.read_contract, ADDR, method, args=args)


def rubric_flags(frag):
    """The contract's own deterministic flags string from the leader payload, so the
    judgment is read as it was written rather than inferred from a UI label."""
    m = re.search(r"on_topic=(\d) concrete=(\d) manipulation=(\d) safe=(\d) -> success=(\d)", frag or "")
    if not m:
        return None
    keys = ("on_topic", "concrete_action", "manipulation", "safe", "derived_success")
    return {k: int(v) for k, v in zip(keys, m.groups())}


# The end-state reads are only attributable to one transaction if that transaction is the
# last one of the ladder, so the pay case has to come last (the harness runs the
# rejections first exactly for this reason).
if cases[-1].get("expect") != "pay":
    raise SystemExit("the report's last case is not the paying one - end state cannot be attributed")

rows = []
all_ok = True
base = LEVEL_BASE_GEN[level] * GEN // 100

for c in cases:
    tag, is_reject = c["tag"], c.get("expect") != "pay"
    # the ladder records the layer as "layer", the report's proof block as "layer_expected"
    layer = c.get("layer_expected") or c.get("layer")
    print("=== %s (%s, layer %s, expected %s) tx=%s" % (
        tag, c.get("corpus"), layer,
        "REJECT / no payout" if is_reject else "PAY", c["tx_hash"]))
    raw, polls = wait_finalized(c["tx_hash"])
    last_round = raw.get("last_round") or {}
    votes = last_round.get("validator_votes") or []
    exe, lstatus, frag = leader_bits(raw)
    flags = rubric_flags(frag)
    ui_delta = int(c.get("native_delta_atto") or 0)
    try:
        # the RPC carries this as a string, so compare numbers, not reprs
        rounds_num = int(raw.get("num_of_rounds"))
    except (TypeError, ValueError):
        rounds_num = None
    row = {
        "tag": tag,
        "corpus": c.get("corpus"),
        "layer": layer,
        "tx_hash": c["tx_hash"],
        "expected": "reject" if is_reject else "pay",
        "ui_state": c.get("state"),
        "ui_seconds_to_verdict": c.get("seconds_to_verdict"),
        "ui_native_delta_around_this_tx_atto": ui_delta,
        "final_status": raw.get("status_name"),
        "result_name": raw.get("result_name"),
        "consensus_rounds": rounds_num,
        "validator_votes_recorded": len(votes),
        "leader_execution_result": str(exe),
        "leader_result_status": str(lstatus),
        "rubric_flags": flags,
        "polls": polls,
        "leader_fragment_excerpt": frag[:320],
    }
    common = {
        "finalized": row["final_status"] == "FINALIZED",
        "majority_agree": row["result_name"] == "MAJORITY_AGREE",
        "no_validator_timeout": row["result_name"] not in (
            "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT", "NO_MAJORITY", "UNDETERMINED"),
        "votes_recorded": len(votes) > 0,
        "single_consensus_round": rounds_num == 1,
    }
    if is_reject:
        if layer == "prefilter":
            row["basis"] = (
                "leader execution rolled back, so the GenVM wrote nothing at all "
                "(revert text in the payload): %s" % (frag[:80] or "(no payload text)")
            )
            paid_nothing = (
                str(exe).endswith("ERROR")
                and str(lstatus) == "rollback"
                and "[EXPECTED]" in frag
            )
        else:
            row["basis"] = (
                "rubric-derived success=0, so the contract never entered its payout branch "
                "(no level_payout write, no transfer, no completion flag)"
            )
            paid_nothing = flags is not None and flags["derived_success"] == 0
        row["checks"] = dict(
            common,
            tx_itself_paid_nothing=paid_nothing,
            native_delta_measured_around_this_tx_is_zero=ui_delta == 0,
            ui_showed_no_payout_wording=(
                c.get("payout_line_present") is False and c.get("gen_figure_in_verdict") is False
            ),
            ui_showed_explicit_rejection=bool(c.get("rejection_is_explicit")),
        )
    else:
        # This is the ladder's last transaction, so the state read now is its effect.
        shown = int(c.get("shown_payout_atto") or 0)
        mult = int(c.get("displayed_multiplier_x100") or 0)
        got = read("get_level_payout", [wallet, level])
        prog = read("campaign_progress", [wallet])
        tot = read("get_total_credit", [wallet])
        legacy = read("get_credit", [wallet])
        done = [int(x) for x in (prog.get("completed") or [])]
        onchain_atto = int(got.get("payout_atto", 0))
        total_now = int(tot.get("total_credit_atto", 0))
        native_now = native_atto(wallet)
        row.update({
            "onchain_level_payout_atto": onchain_atto,
            "onchain_level_completed": bool(got.get("completed")),
            "completed_levels": done,
            "onchain_total_credit_atto": total_now,
            "onchain_legacy_credit_atto": int(legacy.get("credit_atto", 0)),
            "native_balance_atto": native_now,
            "ui_measured_native_delta_atto": ui_delta,
        })
        row["checks"] = dict(
            common,
            leader_success=str(exe).endswith("SUCCESS"),
            rubric_derived_success_1=flags is not None and flags["derived_success"] == 1,
            level_marked_conquered=done == [level],
            onchain_payout_equals_ui=onchain_atto == shown and shown > 0,
            payout_equals_base_times_mult=onchain_atto == (base * mult // 100) and mult >= 100,
            total_credit_equals_single_payout=total_now == onchain_atto,
            legacy_credit_equals_total=int(legacy.get("credit_atto", 0)) == total_now,
            native_balance_equals_payout=native_now == onchain_atto,
            native_delta_measured_by_ui_equals_payout=ui_delta == onchain_atto,
        )
    ok = all(v is True for v in row["checks"].values())
    row["ok"] = ok
    all_ok = all_ok and ok
    rows.append(row)
    print("  votes=%s rounds=%s exec=%s leaderStatus=%s" % (
        len(votes), row["consensus_rounds"], exe, lstatus))
    print("  rubric flags: %s" % (json.dumps(flags) if flags else "(none: no judgment ran)"))
    print("  basis: %s" % row.get("basis", "this tx is the paying one; end state below"))
    if not is_reject:
        print("  onchain payout=%s total=%s legacy=%s native=%s completed=%s" % (
            row["onchain_level_payout_atto"], row["onchain_total_credit_atto"],
            row["onchain_legacy_credit_atto"], row["native_balance_atto"], row["completed_levels"]))
    print("  leader fragment: %s" % (frag[:200] or "(empty)"))
    for k, v in row["checks"].items():
        print("    %-44s %s" % (k, "OK" if v is True else "FAIL(%r)" % (v,)))
    print("  case verdict:", "OK" if ok else "FAIL")
    print("")

spare_level = 4 if level != 4 else 5
untouched = read("get_level_payout", [wallet, spare_level])
final_total = int(read("get_total_credit", [wallet]).get("total_credit_atto", 0))
final_payout = int(read("get_level_payout", [wallet, level]).get("payout_atto", 0))
final_native = native_atto(wallet)
pay_row = rows[-1]
summary = {
    "cases_verified": len(rows),
    "rejection_transactions": [r["tag"] for r in rows if r["expected"] == "reject"],
    "every_rejection_tx_paid_nothing_by_its_own_execution_record": all(
        r["checks"]["tx_itself_paid_nothing"] for r in rows if r["expected"] == "reject"),
    "every_rejection_left_the_wallet_balance_unchanged": all(
        r["checks"]["native_delta_measured_around_this_tx_is_zero"]
        for r in rows if r["expected"] == "reject"),
    "every_rejection_showed_no_payout_wording": all(
        r["checks"]["ui_showed_no_payout_wording"] and r["checks"]["ui_showed_explicit_rejection"]
        for r in rows if r["expected"] == "reject"),
    "legit_paid_exactly_base_times_mult": pay_row["checks"]["payout_equals_base_times_mult"],
    "legit_payout_landed_natively": pay_row["checks"]["native_balance_equals_payout"],
    "end_state_credited_exactly_one_payout": (
        final_payout == final_total == final_native
        and final_payout == pay_row["onchain_level_payout_atto"] and final_payout > 0),
    "every_case_clean_single_round_consensus": all(
        r["checks"]["finalized"] and r["checks"]["majority_agree"]
        and r["checks"]["single_consensus_round"] and r["checks"]["no_validator_timeout"]
        for r in rows),
    "final_native_atto": final_native,
    "final_total_credit_atto": final_total,
    "final_level_payout_atto": final_payout,
    "spare_level_payout_atto": int(untouched.get("payout_atto", 0)),
    "all_rows_ok": all_ok,
}
summary["spare_level_payout_is_zero"] = summary["spare_level_payout_atto"] == 0
print("=== SUMMARY ===")
print(json.dumps(summary, indent=2))
out_path = os.path.join(ROOT, "docs", "c4-sdk-verify.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({"summary": summary, "rows": rows}, f, indent=2)
print("written:", out_path)
print("VERDICT:", "PASS" if all_ok and summary[
    "every_rejection_tx_paid_nothing_by_its_own_execution_record"] and summary[
    "end_state_credited_exactly_one_payout"] else "FAIL")
sys.exit(0 if all_ok else 1)
