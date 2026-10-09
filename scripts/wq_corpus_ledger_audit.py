"""Task C end-state ledger audit: read the CURRENT on-chain state of every wallet the
adversarial corpus used and prove the per-transaction deltas add up to what the chain
says now, in the present tense.

Why this exists: the corpus runner measures each submission by reading the credit and
native balance before and after it. That is the right measurement, but it is a
per-tx view, and one submission (p2.legit_after) had to be re-sent three times because
the client-side POST died with a TLS error while the network had already accepted the
earlier copy. So the hash recorded for that case is the copy that hit the replay
guard, while the payment was made by the copy whose POST errored. The deltas still
add up, but the claim needs an audit that does not depend on which hash a record
carries: what does the chain owe each of these addresses right now?

For every distinct sender in docs/adversarial_results.json this reads
get_total_credit, the legacy get_credit, campaign_progress and eth_getBalance, then
checks:
  * credited total == sum of the credit deltas this wallet's records observed
  * get_credit (legacy name) == get_total_credit
  * campaign_progress(account)'s per-player credited total == get_total_credit, the
    conquered level list agrees, and that per-player view carries no contract-wide
    counter field at all (the reviewer fix, checked against the live ABI)
  * native balance == the 1 GEN the throwaway was funded with + that same credited
    total, so no wallet holds GEN the ledger cannot account for
  * a wallet that only ever submitted attacks has 0 credit, 0 payout and NO conquered
    level at all
Offline reads only (eth_call / eth_getBalance); no transaction is submitted.
Usage: python scripts/wq_corpus_ledger_audit.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wq_round as W  # noqa: E402  (shared, already-proven StudioNet helpers)

ROOT = W.ROOT
RESULTS = os.path.join(ROOT, "docs", "adversarial_results.json")
GEN = W.GEN
FUND_ATTO = int(os.environ.get("WQ_FUND_GEN", "1")) * GEN


def native_retry(addr, attempts=4, pause=10):
    """eth_getBalance through the same client the corpus used. A None here is a
    transport failure, not a zero balance, so it is retried and reported as None."""
    client = W.mk_client(W.deployer())
    for i in range(attempts):
        b = W.bal(client, addr)
        if b is not None:
            return b
        if i < attempts - 1:
            time.sleep(pause)
    return None


def campaign(addr):
    """campaign_progress(account) as deployed: per-player fields only. Returns
    (per-player credited total, conquered levels, the raw dict)."""
    p = W._read("campaign_progress", args=[addr]) or {}
    per_player = int(p.get("total_credit_atto", p.get("campaign_payout_atto", 0)))
    return per_player, [int(x) for x in (p.get("completed") or [])], p


def main():
    with open(RESULTS, encoding="utf-8") as f:
        data = json.load(f)
    by_sender = {}
    for r in data:
        by_sender.setdefault(r["sender"], []).append(r)

    rows = []
    all_ok = True
    print("contract:", W.ADDR)
    print("wallets:", len(by_sender), " records:", len(data))
    print("%-44s %-6s %-6s %-20s %-20s %-20s %-12s %s" % (
        "sender", "runs", "paid", "expected credit", "get_total_credit",
        "native balance", "conquered", "checks"))
    for sender, recs in sorted(by_sender.items(), key=lambda kv: -len(kv[1])):
        expected = sum(int(r.get("credit_delta_atto") or 0) for r in recs)
        paid_runs = sum(1 for r in recs if r.get("paid"))
        total = W._read("get_total_credit", args=[sender]) or {}
        legacy = W._read("get_credit", args=[sender]) or {}
        camp_atto, done, camp_raw = campaign(sender)
        native = native_retry(sender)
        got_total = int(total.get("total_credit_atto", 0))
        got_legacy = int(legacy.get("credit_atto", 0))
        checks = {
            "total_equals_sum_of_deltas": got_total == expected,
            "legacy_equals_total": got_legacy == got_total,
            "campaign_per_player_equals_total": camp_atto == got_total,
            "native_equals_funding_plus_credit": native == FUND_ATTO + expected,
            "attack_only_wallet_conquered_nothing": (expected == 0) == (done == []),
            "no_level_conquered_twice": len(done) == len(set(done)),
            # the reviewer fix: a contract-wide number must not sit inside the
            # per-player progress view at all
            "per_player_view_has_no_global_counter": "campaign_payout_atto" not in camp_raw,
        }
        ok = all(checks.values())
        all_ok = all_ok and ok
        bad = [k for k, v in checks.items() if not v]
        print("%-44s %-6d %-6d %-20d %-20d %-20s %-12s %s" % (
            sender, len(recs), paid_runs, expected, got_total, native,
            ",".join(str(x) for x in done) or "-",
            "OK" if ok else "FAIL " + ",".join(bad)))
        rows.append({
            "sender": sender, "runs": len(recs), "paid_runs": paid_runs,
            "expected_credit_atto": expected, "get_total_credit_atto": got_total,
            "get_credit_legacy_atto": got_legacy, "campaign_progress_total_atto": camp_atto,
            "completed_levels": done, "native_balance_atto": native,
            "funding_atto": FUND_ATTO, "checks": checks, "ok": ok,
        })

    attack_only = [r for r in rows if r["paid_runs"] == 0]
    print("")
    print("wallets that only ever submitted attacks:", len(attack_only))
    print("  all of them credited 0 and conquered nothing:",
          all(r["expected_credit_atto"] == 0 and not r["completed_levels"]
              for r in attack_only))
    print("total credited across every corpus wallet:",
          sum(r["get_total_credit_atto"] for r in rows), "atto")
    print("VERDICT:", "PASS" if all_ok else "CHECK")
    out = {"contract": W.ADDR, "funding_atto": FUND_ATTO, "wallets": rows,
           "all_ok": all_ok,
           "total_credited_atto": sum(r["get_total_credit_atto"] for r in rows)}
    with open(os.path.join(ROOT, "docs", "corpus-ledger-audit.json"), "w",
              encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("written: docs/corpus-ledger-audit.json")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
