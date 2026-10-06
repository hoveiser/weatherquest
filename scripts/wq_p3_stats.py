"""Focused P3 stats: clean timing + success-rate over THIS session's credited
successful runs, the honest Low-tier over-permissive diagnosis (old crashed-round
rejects that were approved), and the decoded Tromso/Singapore multiplier probes.
Read-only. Import of wq_p3_report reuses the leader-receipt byte decoder.
"""
import json
import statistics as st
from wq_p3_report import decode_receipt, _raw_for

data = json.load(open("docs/round_results.json", encoding="utf-8"))
by = {r["case"]: r for r in data}


def acc(c):
    return by[c].get("seconds_to_ACCEPTED")


succ = [c for c in by if c.startswith("p3_L") or c.startswith("p3_free_L1")]
newretr = [c for c in by if c.startswith("p3r_reject") and c.endswith("_safe_retry")]
credited_succ = [c for c in succ if isinstance(by[c].get("recipient_credit_delta_atto"), int)
                 and by[c]["recipient_credit_delta_atto"] > 0]
credited_retr = [c for c in newretr if isinstance(by[c].get("recipient_credit_delta_atto"), int)
                 and by[c]["recipient_credit_delta_atto"] > 0]
allgood = credited_succ + credited_retr
t = sorted(acc(c) for c in allgood if acc(c))
print("clean credited successes (campaign+free): %d" % len(credited_succ))
print("new Medium safe-retry credits          : %d" % len(credited_retr))
print("time to ACCEPTED (n=%d): min=%s median=%s max=%s" % (len(t), t[0], st.median(t), t[-1]))
print("clean consensus over credited successes: %d/%d" % (
    sum(1 for c in allgood if by[c].get("consensus_clean")), len(allgood)))
print("exact payout over credited successes   : %d/%d" % (
    sum(1 for c in allgood if by[c].get("payout_exact")), len(allgood)))

oldrej = [c for c in by if c.startswith("p3_reject") and not c.endswith("_safe_retry")]
print("\nOLD crashed-round Low-tier rejects (approved = success=true):")
for c in sorted(oldrej):
    raw = _raw_for(c)
    sv, tier, mult = decode_receipt(raw) if raw else (None, None, None)
    print("  %-30s tier=%s credit=%s completed=%s" % (
        c, tier, by[c].get("recipient_credit_delta_atto"), by[c].get("level_marked_completed")))

print("\nget_weather_multiplier probes (decoded):")
for c in ["get_weather_multiplier_Troms\u00f8", "get_weather_multiplier_Singapore"]:
    if c in by:
        raw = _raw_for(c)
        sv, tier, mult = decode_receipt(raw) if raw else (None, None, None)
        print("  %-42s result=%s clean=%s tier=%s mult_x100=%s" % (
            c, by[c].get("result_name"), by[c].get("consensus_clean"), tier, mult))
    else:
        print("  %-42s NOT FOUND in round_results" % c)

# base*mult*eff identity check for the new Medium safe retries (eff=120 Perfect, act=12 opt=10)
print("\nMedium safe-retry payout identity (base*mult*eff/10000):")
LEVEL_BASE = {1: 10}
for c in sorted(credited_retr):
    r = by[c]
    cd = r.get("recipient_credit_delta_atto")
    mult = r.get("derived_weather_mult_x100")
    print("  %-46s credit_atto=%s derived_mult=%s" % (c, cd, mult))
