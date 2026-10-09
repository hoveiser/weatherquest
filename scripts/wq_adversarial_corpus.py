"""Task C runner: submit the committed adversarial corpus to StudioNet and measure
what the deployed contract actually does with each item.

Usage:
  python scripts/wq_adversarial_corpus.py scan       # live weather tier of the 10 campaign cities
  python scripts/wq_adversarial_corpus.py attacks     # every attack, N passes, fresh account per pass
  python scripts/wq_adversarial_corpus.py legit       # every legitimate action, fresh accounts
  python scripts/wq_adversarial_corpus.py all         # attacks then legit
  python scripts/wq_adversarial_corpus.py report      # rebuild the table from the results file

Measured, never assumed, for every submission:
  tx hash, final status, consensus result, rounds, validator votes, seconds to
  ACCEPTED, which layer stopped it (deterministic gate revert, LLM rubric rejection,
  or nothing, meaning it was accepted), the rubric flags, the credit delta, the native
  balance delta and whether the level was marked completed.

Attacks are expected to end with: no credit delta, no native delta, level not
completed. A single paid attack is reported, not hidden. Network rules: one blocking
call per tx, 20s between polls, a 300s hard deadline, and the run stops if a status
repeats three times with no change. Results are appended after every transaction so
an interrupted run resumes where it stopped. Credentials are read only from this
project's .env and never printed.
"""
import io
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wq_round as W  # noqa: E402  (shared, already-proven StudioNet helpers)
import requests  # noqa: E402
from eth_account import Account  # noqa: E402

ROOT = W.ROOT
CORPUS = os.path.join(ROOT, "tests", "adversarial_corpus.json")
RESULTS = os.path.join(ROOT, "docs", "adversarial_results.json")
RAWDIR = os.path.join(ROOT, "docs", "adversarial_raw")
RPC = "https://studio.genlayer.com/api"
GEN = W.GEN
PASSES = int(os.environ.get("WQ_CORPUS_PASSES", "2"))
FUND_GEN = int(os.environ.get("WQ_FUND_GEN", "1"))
os.makedirs(RAWDIR, exist_ok=True)

with io.open(CORPUS, encoding="utf-8") as f:
    CORPUS_DATA = json.load(f)

ATTACK_LV = CORPUS_DATA["attack_target"]["level"]
ATTACK_CITY = CORPUS_DATA["attack_target"]["city"]
FLAGS_RE = re.compile(
    r"on_topic=(\d) concrete=(\d) manipulation=(\d) safe=(\d) -> success=(\d)")


# ------------------------------------------------------------------ results io --
def load_results():
    if os.path.exists(RESULTS):
        with io.open(RESULTS, encoding="utf-8") as f:
            return json.load(f)
    return []


def save_results(data):
    with io.open(RESULTS, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, default=str)


def record(rec):
    data = load_results()
    data = [d for d in data if d.get("key") != rec.get("key")]
    data.append(rec)
    save_results(data)
    try:
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", str(rec.get("key")))
        with io.open(os.path.join(RAWDIR, safe + ".json"), "w", encoding="utf-8") as f:
            json.dump(rec.get("_raw") or {}, f, indent=2, default=str)
    except Exception as e:
        print("  [raw] dump failed:", e)
    rec.pop("_raw", None)
    return data


def done_keys():
    return {d.get("key") for d in load_results()}


# ---------------------------------------------------------------- native funds --
def rpc(method, params, attempts=5):
    last = None
    for i in range(attempts):
        try:
            r = requests.post(RPC, json={"jsonrpc": "2.0", "id": int(time.time() * 1000),
                                         "method": method, "params": params}, timeout=40)
            j = r.json()
            if "error" in j:
                raise RuntimeError(str(j["error"])[:120])
            return j["result"]
        except Exception as e:
            last = e
            if not W._transient(e) or i == attempts - 1:
                raise
            time.sleep(5 * (i + 1))
    raise last


def fund(addr, gen=FUND_GEN, label=""):
    """Give a throwaway account native GEN from the deployer so the corpus really is
    run from funded accounts. The key is read from this project's .env and never
    printed. Returns the funding tx hash."""
    d = W.deployer()
    nonce = int(rpc("eth_getTransactionCount", [d.address, "pending"]), 16)
    gas_price = int(rpc("eth_gasPrice", []), 16)
    signed = Account.sign_transaction({
        "chainId": 61999, "from": d.address, "to": addr, "value": gen * GEN,
        "gas": 250000, "gasPrice": gas_price, "nonce": nonce, "data": b""},
        os.environ["GENLAYER_PRIVATE_KEY"])
    raw = signed.raw_transaction
    raw = raw.hex() if isinstance(raw, bytes) else raw
    h = rpc("eth_sendRawTransaction", [raw])
    print("  funded %s with %d GEN, tx %s (%s)" % (addr[:10], gen, h, label))
    return h


def native_atto(addr):
    """Native GEN straight from the node. client.get_balance returned None for
    freshly created accounts here, so the raw RPC (which the Playwright harness also
    used) is the source of truth for every balance figure in this run."""
    return int(rpc("eth_getBalance", [addr, "latest"]), 16)


def new_throwaway(tag):
    a = Account.create()
    c = W.mk_client(a)
    print("throwaway %s = %s" % (tag, a.address))
    try:
        h = fund(a.address, label=tag)
        m, _raw = W.wait_tx(W.mk_client(W.deployer()), h, "fund_" + tag)
        print("  funding %s -> status=%s result=%s" % (h[:14], m["final_status"], m["result_name"]))
    except Exception as e:
        print("  funding failed (%s), continuing: StudioNet accepts unfunded senders"
              % str(e)[:70])
    b = native_atto(a.address)
    print("  native balance before the corpus: %s GEN" % (b / GEN))
    return a, c, b


# --------------------------------------------------------------------- submit --
def full_fragment(raw, limit=2000):
    """Printable text of the leader receipt payload, long enough to reach the risk
    tier and the rubric flags (the 200 character fragment the round harness used
    stopped before them)."""
    try:
        lr = raw.get("consensus_data", {}).get("leader_receipt")
        r0 = lr[0] if isinstance(lr, list) and lr else {}
        rb = (r0.get("result") or {}).get("raw")
        if not rb:
            return ""
        import base64
        blob = base64.b64decode(rb) if isinstance(rb, str) else rb
        return "".join(re.findall(r"[ -~]{3,}", blob.decode("utf-8", "replace")))[:limit]
    except Exception as e:
        return "extract-err:" + str(e)[:60]


def measure(client, acct, level, city, action, key, meta, pass_baseline):
    """One complete_level submission with full evidence, written to the results file.
    The native delta is measured around THIS transaction (baseline right before the
    submit), so funding an account can never be mistaken for a payout."""
    addr = acct.address
    c2 = client
    credit0 = W.read_credit(addr)
    _p0, done0 = W.campaign_payout(addr)
    native0 = native_atto(addr)
    tx = W._submit(c2, "complete_level", args=[level, city, action], label=key)
    print("%s: %s L%d %s tx=%s" % (key, addr[:10], level, city, tx))
    m, raw = W.wait_tx(c2, tx, key)

    rec = {"key": key, "sender": addr, "level": level, "city": city}
    rec.update(meta)
    rec.update(m)
    native1 = native_atto(addr)
    credit1 = W.read_credit(addr)
    _p1, done1 = W.campaign_payout(addr)
    rec["native_balance_before_atto"] = native0
    rec["native_balance_after_atto"] = native1
    rec["native_delta_atto"] = (native1 - native0) if native1 is not None else None
    rec["pass_native_baseline_atto"] = pass_baseline
    rec["credit_before_atto"] = credit0
    rec["credit_after_atto"] = credit1
    rec["credit_delta_atto"] = (credit1 - credit0) if (credit0 is not None and credit1 is not None) else None
    rec["completed_levels_before"] = done0
    rec["completed_levels_after"] = done1
    rec["level_marked_completed"] = level in (done1 or [])
    exe, status, _short = W._leader_exec(raw)
    frag = full_fragment(raw) or _short
    rec["leader_execution_result"] = exe
    rec["leader_result_status"] = status
    rec["leader_message"] = frag[:300]
    rec["leader_tier"] = W._tier_from_frag(frag)
    fm = FLAGS_RE.search(frag or "")
    if fm:
        rec["rubric"] = {
            "on_topic": fm.group(1) == "1", "concrete_action": fm.group(2) == "1",
            "manipulation": fm.group(3) == "1", "safe": fm.group(4) == "1",
            "derived_success": fm.group(5) == "1",
        }
    # Which layer stopped it, measured from the chain rather than assumed.
    expected_revert = (exe == "ERROR" and status == "rollback"
                       and str(frag).startswith("[EXPECTED]"))
    llm_error = "[LLM_ERROR]" in str(frag)
    paid = bool((rec["credit_delta_atto"] or 0) > 0) or bool((rec["native_delta_atto"] or 0) > 0)
    replay_guard = "already completed" in str(frag).lower()
    if llm_error:
        rec["measured_layer"] = "llm_error_fail_closed"
    elif expected_revert and replay_guard:
        rec["measured_layer"] = "replay_guard"
    elif expected_revert:
        rec["measured_layer"] = "prefilter"
    elif exe == "ERROR":
        rec["measured_layer"] = "other_revert"
    else:
        rec["measured_layer"] = "rubric"
    rec["revert_reason"] = frag[:120] if expected_revert or llm_error else None
    rec["accepted_by_contract"] = bool(rec["level_marked_completed"])
    rec["paid"] = paid
    # A paid run must be exactly base(level) * multiplier / 100, with the native
    # transfer and the credit ledger agreeing.
    unit = W.base_atto(level)
    cd = rec["credit_delta_atto"] or 0
    if cd > 0:
        mult = cd * 100 // unit
        rec["derived_weather_mult_x100"] = mult
        rec["payout_exact"] = (unit * mult // 100 == cd and 100 <= mult <= 500)
        rec["native_equals_credit_delta"] = (rec["native_delta_atto"] == cd)
    else:
        rec["derived_weather_mult_x100"] = 0
        rec["payout_exact"] = (cd == 0 and (rec["native_delta_atto"] or 0) == 0)
        rec["native_equals_credit_delta"] = True
    rec["consensus_clean"] = W.clean_consensus(m)
    rec["payout_atto_expected_if_passed"] = W.base_atto(level)
    rec["pass_condition_for_attack"] = (
        not paid and not rec["level_marked_completed"] and rec["consensus_clean"])
    rec["_raw"] = raw
    record(rec)
    print("  -> layer=%s paid=%s completed=%s credit_delta=%s native_delta=%s rounds=%s votes=%s tier=%s accepted=%s"
          % (rec["measured_layer"], paid, rec["level_marked_completed"],
             rec["credit_delta_atto"], rec["native_delta_atto"], m["consensus_rounds"],
             m["votes_revealed"], rec.get("leader_tier"), rec.get("result_name")))
    if rec.get("rubric"):
        print("     rubric:", json.dumps(rec["rubric"]))
    return rec


# ------------------------------------------------------------------ live scan --
TIER_RANK = {"low": 0, "medium": 1, "high": 2, "extreme": 3}
TIER_CACHE = os.path.join(ROOT, "docs", "adversarial_tier_scan.json")


def _scan_rank(row):
    """Stormiest first: risk tier, then the live multiplier inside a tier."""
    return (-TIER_RANK.get(str(row["tier"]).lower(), 0), -(row.get("multiplier_x100") or 0))


def scan_tiers(use_cache=True):
    """Live risk tier and multiplier of the ten campaign cities.

    get_weather_multiplier is an intelligent view: it fetches Open-Meteo inside the
    GenVM, so a plain read_contract (eth_call) fails with 'GenVM internal error'.
    The working path, already used in earlier rounds, is to submit it as a
    transaction and let consensus run it. That costs ten txs, so the result is
    cached in docs/adversarial_tier_scan.json and reused by later modes."""
    if use_cache and os.path.exists(TIER_CACHE):
        with io.open(TIER_CACHE, encoding="utf-8") as f:
            cached = json.load(f)
        if len(cached) >= 10:
            print("=== cached live tier scan (%s) ===" % TIER_CACHE)
            for r in cached:
                print("  L%-2d %-16s tier=%-7s mult_x100=%s"
                      % (r["level"], r["city"], r["tier"], r.get("multiplier_x100")))
            return sorted(cached, key=_scan_rank)
    print("=== live risk tier of the ten campaign cities (one tx each, no payout) ===")
    client = W.mk_client(W.deployer())
    rows = []
    for lvl in range(1, 11):
        city = W.CAMPAIGN[lvl]
        tier, mult, tx = None, None, None
        try:
            tx = W._submit(client, "get_weather_multiplier", args=[city], label="tier-L%d" % lvl)
            m, raw = W.wait_tx(client, tx, "tier-L%d" % lvl)
            frag = full_fragment(raw)
            tier = W._tier_from_frag(frag) or "unknown"
            mm = re.search(r"multiplier.{0,2}(\d+\.\d\d)", frag or "")
            if mm:
                mult = int(round(float(mm.group(1)) * 100))
            W.dump_raw("tier_L%d_%s" % (lvl, city.replace(" ", "_")), raw)
            print("  L%-2d %-16s tier=%-7s mult_x100=%-5s (tx %s, status=%s)"
                  % (lvl, city, tier, mult, tx[:14], m["final_status"]))
        except Exception as e:
            print("  L%-2d %-16s scan failed: %s" % (lvl, city, str(e)[:70]))
            tier = "scan_failed"
        rows.append({"level": lvl, "city": city, "tier": tier,
                     "multiplier_x100": mult, "tx_hash": tx})
    with io.open(TIER_CACHE, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    rows.sort(key=_scan_rank)
    return rows


# --------------------------------------------------------------------- modes ---
def do_attacks():
    keys = done_keys()
    stormy = scan_tiers()
    top = stormy[0] if stormy else None
    print("stormiest campaign city right now: %s" % json.dumps(top))
    attacks = CORPUS_DATA["attacks"]
    for p in range(1, PASSES + 1):
        acct, client, native0 = new_throwaway("pass%d" % p)
        print("=== ATTACK PASS %d (%d attacks) ===" % (p, len(attacks)))
        for a in attacks:
            key = "p%d.%s" % (p, a["id"])
            if key in keys:
                print("%s already recorded, skipping" % key)
                continue
            lvl, city = ATTACK_LV, ATTACK_CITY
            run_acct, run_client, run_native = acct, client, native0
            if a["class"] == "reckless_action" and top and (
                    str(top["tier"]).lower() != "low" or (top.get("multiplier_x100") or 100) > 100):
                # Each reckless case gets its own fresh account: if one of them were
                # accepted it would complete that stormy level, and the next reckless
                # submission from the same wallet would then be stopped by the replay
                # guard instead of being judged on its merits.
                lvl, city = top["level"], top["city"]
                run_acct, run_client, run_native = new_throwaway("p%d.%s" % (p, a["id"]))
            measure(run_client, run_acct, lvl, city, a["action"], key,
                    {"kind": "attack", "id": a["id"], "class": a["class"],
                     "layer_expected": a["layer_expected"], "pass": p,
                     "action": a["action"][:220]}, run_native)
            keys.add(key)
        # The reviewer's condition: after all those rejections the SAME account must
        # still be able to finish the level for real and be paid exactly base*mult/100.
        key = "p%d.legit_after" % p
        if key not in keys:
            l = CORPUS_DATA["legit"][0]
            rec = measure(client, acct, ATTACK_LV, ATTACK_CITY, l["action"], key,
                          {"kind": "legit_after_attacks", "id": "legit_after",
                           "class": "legit_after_attacks", "pass": p,
                           "source_legit_id": l["id"], "action": l["action"]}, native0)
            exact = (rec.get("native_delta_atto") or 0) > 0 and rec["level_marked_completed"]
            print("  same-account recovery after %d attacks: paid=%s completed=%s"
                  % (len(attacks), exact, rec["level_marked_completed"]))
            keys.add(key)


def do_legit():
    keys = done_keys()
    scan = scan_tiers()
    legit = CORPUS_DATA["legit"]
    # One account walks the whole campaign (one completion per level), the second one
    # takes any level that repeats, so a replayed (wallet, level) never hides a result.
    accounts = []
    used = {}
    for l in legit:
        slot = next((i for i, u in enumerate(accounts) if u["taken"].get(l["level"]) is None), None)
        if slot is None:
            acct, client, native0 = new_throwaway("legit%d" % len(accounts))
            accounts.append({"acct": acct, "client": client, "native0": native0, "taken": {}})
            slot = len(accounts) - 1
        u = accounts[slot]
        key = "legit.%s" % l["id"]
        if key in keys:
            print("%s already recorded, skipping" % key)
            u["taken"][l["level"]] = True
            continue
        print("=== LEGIT %s (L%d %s, %d chars, style %s) ==="
              % (l["id"], l["level"], l["city"], len(l["action"]), l.get("style")))
        rec = measure(u["client"], u["acct"], l["level"], l["city"], l["action"], key,
                      {"kind": "legit", "id": l["id"], "class": "legitimate",
                       "style": l.get("style"), "action": l["action"],
                       "tier_scan_x100": next((s["multiplier_x100"] for s in scan
                                               if s["level"] == l["level"]), None)},
                      u["native0"])
        u["taken"][l["level"]] = True
        u["native0"] = rec.get("native_balance_after_atto") or u["native0"]
        keys.add(key)


def do_report():
    data = load_results()
    attacks = [d for d in data if d.get("kind") == "attack"]
    legit = [d for d in data if d.get("kind") in ("legit", "legit_after_attacks")]
    order = {a["id"]: i for i, a in enumerate(CORPUS_DATA["attacks"])}
    attacks.sort(key=lambda d: (order.get(d.get("id"), 99), d.get("key", "")))
    print("%-12s %-26s %-24s %-15s %-10s %-5s %-5s %-7s %-10s %-8s %-6s %s" % (
        "case", "class", "measured layer", "result", "tier", "rnds", "votes",
        "t->ACC", "credit delta", "native", "paid", "tx"))
    for d in attacks + legit:
        # a layer-1 revert happens before the contract reads the weather, so that tx
        # has no risk tier at all - say so instead of leaving the cell blank
        tier = d.get("leader_tier") or d.get("tier")
        if not tier:
            tier = "n/a-revert" if d.get("measured_layer") == "prefilter" else "-"
        print("%-12s %-26s %-24s %-15s %-10s %-5s %-5s %-7s %-10s %-8s %-6s %s" % (
            d.get("key"), d.get("class"), d.get("measured_layer"),
            str(d.get("result_name"))[:15], tier,
            d.get("consensus_rounds"), d.get("votes_revealed"),
            d.get("seconds_to_ACCEPTED"), d.get("credit_delta_atto"),
            d.get("native_delta_atto"), d.get("paid"), str(d.get("tx_hash"))[:20]))
    paid_attacks = [d for d in attacks if d.get("paid")]
    by_class = {}
    for d in attacks:
        by_class.setdefault(d.get("class"), []).append(d)
    print("\n--- per class ---")
    layers_by_class = {}
    for k in sorted(by_class):
        rows = by_class[k]
        layers = {}
        for rec in rows:
            lay = rec.get("measured_layer")
            layers[lay] = layers.get(lay, 0) + 1
        layers_by_class[k] = layers
        print("  %-26s runs=%-3d paid=%-2d layers=%s" % (k, len(rows),
              sum(1 for rec in rows if rec.get("paid")), json.dumps(layers)))
    times = [d.get("seconds_to_ACCEPTED") for d in attacks + legit
             if d.get("seconds_to_ACCEPTED") is not None]
    if times:
        ts = sorted(times)
        print("\ntime to ACCEPTED over %d txs: min %.1fs median %.1fs max %.1fs"
              % (len(ts), ts[0], ts[len(ts) // 2], ts[-1]))
    print("\nATTACK RUNS: %d   PAID ATTACKS: %d" % (len(attacks), len(paid_attacks)))
    ok_legit = [d for d in legit if d.get("paid") and d.get("level_marked_completed")]
    bad_legit = [d for d in legit if not (d.get("paid") and d.get("level_marked_completed"))]
    print("LEGIT RUNS: %d   accepted %d   false rejects %s"
          % (len(legit), len(ok_legit), [d.get("key") for d in bad_legit]))
    no_majority = [d.get("key") for d in attacks + legit
                   if str(d.get("result_name")) in W.BAD_RESULTS
                   or str(d.get("final_status")) in ("VALIDATORS_TIMEOUT", "UNDETERMINED")]
    print("consensus problems (NO_MAJORITY / timeout / undetermined):", no_majority or "none")
    # consensus rounds used, printed for every run: a case that needed more than one
    # round is reported here rather than hidden behind the "1 round" headline, because
    # an LLM-judged write is exactly where validators can disagree and rotate
    rounds_dist = {}
    for d in attacks + legit:
        rc = str(d.get("consensus_rounds"))
        rounds_dist[rc] = rounds_dist.get(rc, 0) + 1
    multi_round = [(d.get("key"), d.get("consensus_rounds"), d.get("class"))
                   for d in attacks + legit if str(d.get("consensus_rounds")) != "1"]
    print("consensus rounds distribution:", json.dumps(rounds_dist, sort_keys=True))
    print("multi-round cases (still majority-agreed, but not first-try):", multi_round or "none")
    print("tier 'n/a-revert' = the tx was rejected by the deterministic layer-1 pre-filter,")
    print("  which runs before the contract reads the weather, so no multiplier exists for it")
    print("  (the credit/native deltas recorded for those txs are measured on the node anyway)")
    print("VERDICT:", "PASS" if not paid_attacks and not bad_legit and not no_majority else "CHECK")
    out = {
        "attack_runs": len(attacks),
        "paid_attacks": [d.get("key") for d in paid_attacks],
        "legit_runs": len(legit),
        "legit_accepted": [d.get("key") for d in ok_legit],
        "legit_false_rejects": [d.get("key") for d in bad_legit],
        "consensus_problems": no_majority,
        "consensus_rounds_distribution": rounds_dist,
        "multi_round_cases": multi_round,
        "time_to_accepted": (min(times), sorted(times)[len(times) // 2], max(times)) if times else None,
        "attack_layer_totals": {
            "prefilter": sum(1 for d in attacks if d.get("measured_layer") == "prefilter"),
            "rubric": sum(1 for d in attacks if d.get("measured_layer") == "rubric"),
        },
        "by_class": layers_by_class,
        "attack_classes": len(by_class),
        "attack_ids": len(set(d.get("id") for d in attacks)),
    }
    with io.open(os.path.join(ROOT, "docs", "adversarial_summary.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("summary written: docs/adversarial_summary.json")


def do_smoke():
    """Two submissions only (keys prefixed 'smoke.') to prove the recording and the
    layer classification work, before the full corpus is spent on 68 transactions."""
    acct, client, native0 = new_throwaway("smoke")
    for iid in ("a01", "a27", "a22"):
        a = next(x for x in CORPUS_DATA["attacks"] if x["id"] == iid)
        measure(client, acct, ATTACK_LV, ATTACK_CITY, a["action"], "smoke." + iid,
                {"kind": "smoke", "id": iid, "class": a["class"],
                 "layer_expected": a["layer_expected"], "action": a["action"]}, native0)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "report"
    print("contract:", W.ADDR, "mode:", mode, "passes:", PASSES)
    if mode == "scan":
        print(json.dumps(scan_tiers(), indent=2))
    elif mode == "smoke":
        do_smoke()
    elif mode == "attacks":
        do_attacks()
    elif mode == "legit":
        do_legit()
    elif mode == "all":
        do_attacks()
        do_legit()
    elif mode == "report":
        do_report()
    else:
        print("unknown mode")
        sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except W.Stall as s:
        print("STALL -> stopping and reporting (rule 5):", s)
        sys.exit(3)
