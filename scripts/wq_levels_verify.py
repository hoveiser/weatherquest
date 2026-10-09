"""Independent, app-free verification of the B3b levels 1-3 Playwright run.

Usage: python scripts/wq_levels_verify.py [path/to/levels-payout-report.json]

Everything below is read straight from StudioNet with the GenLayer SDK. The UI is
not involved, so this is a second, independent measurement of the same three
settlements. For each level it proves:
  - the transaction reached FINALIZED with majority agreement and SUCCESS in the
    leader receipt (status, result, rounds, validator votes are printed, not assumed)
  - get_level_payout(wallet, level) equals the per-level figure the UI displayed
    AND equals base(level) * multiplier / 100 for THAT level only
  - get_total_credit(wallet) equals the running sum of the per-level payouts
  - get_credit(wallet) (legacy name) agrees with get_total_credit
  - an untouched level reports payout_atto = 0, so a per-level view can never be a
    running total
  - the wallet native GEN balance from eth_getBalance equals the sum of payouts
Network rules: one blocking call at a time, 25s between polls, 300s hard deadline,
stop and report after 3 unchanged polls. Credentials come only from this project's
.env and are never printed.
"""
import json
import os
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
    ROOT, "docs", "levels-payout-report.json"
)
with open(report_path, "r", encoding="utf-8") as f:
    report = json.load(f)

wallet = report["signer_address"]
acct = Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"])
client = create_client(chain=studionet, account=acct)
print("report      :", report_path)
print("contract    :", ADDR)
print("wallet      :", wallet, "(throwaway signer of the UI run)")
print("site        :", report.get("site_url"))
print("")


def retry(fn, *a, **kw):
    """StudioNet's TLS endpoint intermittently drops requests from this environment
    (an SSL EOF is roughly 1 call in 6 here), so a connection-level error is retried
    with backoff. Calls stay strictly one at a time; anything that is not a transport
    failure is raised unchanged."""
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
    """Poll one tx with a single blocking call per iteration."""
    prev, same, start = None, 0, time.time()
    raw = None
    polls = 0
    while True:
        polls += 1
        raw = retry(client.get_transaction, tx_hash)
        status = raw.get("status_name")
        result = raw.get("result_name")
        el = int(time.time() - start)
        print("  [%4ds] status=%s result=%s" % (el, status, result))
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


def base_atto(level):
    return LEVEL_BASE_GEN[level] * GEN // 100


# A campaign level this wallet never played: its per-level payout must stay zero,
# which is what proves get_level_payout is per level and not a running total.
SPARE_LEVEL = 4


sum_shown = 0
all_ok = True
levels = [e for e in report["levels"] if e.get("checks")]
# The running sum the UI should have been showing at each level, recomputed here
# from the per-level figures the harness captured (independent arithmetic, the app
# is not trusted). get_total_credit read NOW can only equal the final one, so the
# intermediate totals are checked against this prefix table instead.
prefix = {}
_running = 0
for _e in levels:
    _running += int(_e["checks"]["shown_level_atto"])
    prefix[_e["level"]] = _running
for e in levels:
    lvl = e["level"]
    h = e["tx_hash"]
    print("=== LEVEL %d (%s) tx %s ===" % (lvl, e["city"], h))
    raw, polls = wait_finalized(h)
    cd = raw.get("consensus_data") or {}
    leader = (cd.get("leader_receipt") or [{}])[0]
    lres = leader.get("result") or {}
    last_round = raw.get("last_round") or {}
    votes = last_round.get("validator_votes") or []
    rounds = raw.get("num_of_rounds")
    print(
        "  leader_execution_result=%s leader_result_status=%s votes=%s rounds=%s polls=%s"
        % (leader.get("execution_result"), lres.get("status"), len(votes), rounds, polls)
    )
    print("  time_to_verdict_measured_by_ui=%ss (attempt %s)"
          % (e.get("seconds_to_verdict"), e.get("tx_attempts")))

    got = retry(client.read_contract, ADDR, "get_level_payout", args=[wallet, lvl])
    onchain_atto = int(got.get("payout_atto", 0))
    shown = int(e["checks"]["shown_level_atto"])
    total = int(e["checks"]["shown_total_atto"])
    mult = int(e["checks"]["displayed_multiplier_x100"])
    b = base_atto(lvl)
    expected = b * mult // 100
    sum_shown += onchain_atto

    tot = retry(client.read_contract, ADDR, "get_total_credit", args=[wallet])
    legacy = retry(client.read_contract, ADDR, "get_credit", args=[wallet])
    onchain_total = int(tot.get("total_credit_atto", 0))
    onchain_legacy = int(legacy.get("credit_atto", 0))

    other = SPARE_LEVEL
    untouched = retry(client.read_contract, ADDR, "get_level_payout", args=[wallet, other])
    untouched_atto = int(untouched.get("payout_atto", 0))

    native = native_atto(wallet)

    row = {
        "level": lvl,
        "finalized": raw.get("status_name") == "FINALIZED",
        "majority": str(raw.get("result_name") or "").endswith("MAJORITY_AGREE"),
        "leader_success": str(leader.get("execution_result")).endswith("SUCCESS"),
        "votes_ge_5": len(votes) >= 5,
        "completed_flag": bool(got.get("completed")),
        "onchain_level_payout_equals_ui": onchain_atto == shown,
        "onchain_level_payout_equals_base_times_mult": onchain_atto == expected,
        # the level's own prize must never be the ledger total from level 2 on
        "onchain_total_not_equal_to_this_level_payout": onchain_total != onchain_atto,
        "ui_total_equals_recomputed_prefix_sum": total == prefix[lvl],
        "legacy_get_credit_equals_total": onchain_legacy == onchain_total,
        "other_level_payout_is_zero": untouched_atto == 0,
    }
    print("  get_level_payout(%d)          = %d atto (%s GEN), ui showed %d, base*mult//100 = %d"
          % (lvl, onchain_atto, got.get("payout_gen"), shown, expected))
    print("  get_total_credit (read now)   = %d atto; this level's ui total was %d (prefix sum %d)"
          % (onchain_total, total, prefix[lvl]))
    print("  get_credit (legacy name)      = %d atto" % onchain_legacy)
    print("  get_level_payout(%d) untouched = %s atto" % (other, untouched_atto))
    print("  eth_getBalance                = %d atto (%s GEN)" % (native, native / GEN))
    print("  checks:", json.dumps(row))
    level_ok = all(v for v in row.values())
    if not level_ok:
        all_ok = False
        print("  >> LEVEL %d MISMATCH" % lvl)
    print("")

final_total = int(retry(client.read_contract, ADDR, "get_total_credit", args=[wallet]).get("total_credit_atto", 0))
final_ui_total = int(levels[-1]["checks"]["shown_total_atto"])
native_now = native_atto(wallet)
tail = {
    "sum_of_onchain_level_payouts": sum_shown,
    "onchain_total_credit_read_now": final_total,
    "onchain_total_credit_equals_sum": final_total == sum_shown,
    "onchain_total_equals_final_ui_total": final_total == final_ui_total,
    "native_balance_equals_sum": native_now == sum_shown,
    "native_balance_equals_total": native_now == final_total,
}
print("=== chain side summary ===")
print(json.dumps(tail))
stats = retry(client.read_contract, ADDR, "get_global_stats")
print("get_global_stats:", json.dumps(stats))
print("VERDICT:", "PASS" if all_ok and all(
    v for k, v in tail.items() if k != "sum_of_onchain_level_payouts" and k != "onchain_total_credit_read_now"
) else "CHECK")
