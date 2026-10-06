"""Build the P3 on-chain evidence table from docs/round_results.json plus the saved
raw tx dumps in docs/round_raw. Decodes the leader receipt msgpack by byte pattern
(no msgpack module available) to recover the settled risk tier, the AI success flag
and multiplier_x100 for every complete_level run, independent of the credit ledger.

Reports num_of_rounds as "consensus rounds" (never "rotation"), plus votes, time to
ACCEPTED, the credit-ledger payout (the recipient balance proof on gasless StudioNet)
and min/median/max time to ACCEPTED with the success rate. Read-only; no chain calls.
"""
import base64
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
RESULTS = os.path.join(ROOT, "docs", "round_results.json")
RAWDIR = os.path.join(ROOT, "docs", "round_raw")
GEN = 10 ** 18


def _raw_for(case):
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in case)
    p = os.path.join(RAWDIR, safe + ".json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None


def _read_int_after(b, i):
    if i >= len(b):
        return None
    b0 = b[i]
    if b0 < 0x80:
        return b0
    if b0 == 0xcc and i + 1 < len(b):
        return b[i + 1]
    if b0 == 0xcd and i + 2 < len(b):
        return (b[i + 1] << 8) | b[i + 2]
    if b0 == 0xce and i + 3 < len(b):
        return (b[i + 1] << 24) | (b[i + 2] << 16) | (b[i + 3] << 8) | b[i + 4]
    return None


def decode_receipt(raw):
    """Return (success, tier, multiplier_x100) decoded from the leader receipt."""
    try:
        lr = raw.get("consensus_data", {}).get("leader_receipt")
        r0 = lr[0] if isinstance(lr, list) and lr else {}
        rb = (r0.get("result") or {}).get("raw")
        if not rb:
            return None, None, None
        b = base64.b64decode(rb)
    except Exception:
        return None, None, None
    succ = tier = mult = None
    i = b.find(b"success")
    if i != -1:
        v = b[i + 7:i + 8]
        succ = True if v == b"\xc3" else False if v == b"\xc2" else None
    j = b.find(b"risk_tier")
    if j != -1:
        seg = b[j + 9:j + 40]
        best = None
        for t in (b"Extreme", b"High", b"Medium", b"Low"):
            k = seg.find(t)
            if k != -1 and (best is None or k < best[0]):
                best = (k, t.decode())
        tier = best[1] if best else None
    m = b.find(b"multiplier_x100")
    if m != -1:
        mult = _read_int_after(b, m + 15)
    return succ, tier, mult


def main():
    data = json.load(open(RESULTS, encoding="utf-8"))
    runs = [r for r in data if r.get("case", "").startswith(("p3_", "p3r_"))
            and r.get("kind") in ("complete_level", "read_write")]
    print("=== P3 on-chain evidence table (final contract 0x2d764187...0299) ===")
    hdr = "%-34s %-42s %-14s %7s %5s %7s %10s %8s %5s"
    print(hdr % ("case", "tx", "result", "cons.rd", "votes", "toAcc", "payoutGEN", "tier", "succ"))
    acc_times = []
    n_clean = n_runs = 0
    credited = []
    for r in runs:
        case = r["case"]
        raw = _raw_for(case)
        succ, tier, mult = (decode_receipt(raw) if raw else (None, None, None))
        cd = r.get("recipient_credit_delta_atto")
        payout_gen = (cd / GEN) if isinstance(cd, int) else None
        res = r.get("result_name")
        clean = r.get("consensus_clean")
        if r.get("kind") == "complete_level":
            n_runs += 1
            if clean:
                n_clean += 1
        t = r.get("seconds_to_ACCEPTED")
        if r.get("kind") == "complete_level" and isinstance(r.get("recipient_credit_delta_atto"), int) and r["recipient_credit_delta_atto"] > 0:
            credited.append(r)
            if t:
                acc_times.append(t)
        print("%-34s %-42s %-14s %7s %5s %7s %10s %8s %5s" % (
            case[:34], str(r.get("tx_hash"))[:42], str(res),
            r.get("rotation_count"), r.get("votes_revealed"), t,
            ("%.4f" % payout_gen) if payout_gen is not None else "-",
            tier or "-", ("T" if succ else "F" if succ is False else "-")))
    # min/median/max over credited successful runs
    acc_times.sort()
    print("\n=== P3 success-rate / timing (credited complete_level runs) ===")
    if acc_times:
        med = acc_times[len(acc_times) // 2]
        print("successful credited runs : %d" % len(acc_times))
        print("time to ACCEPTED (s)     : min=%s median=%s max=%s" % (acc_times[0], med, acc_times[-1]))
    print("clean consensus          : %d / %d complete_level runs" % (n_clean, n_runs))
    # rejects
    rej = [r for r in runs if "reject_expected_fail" in r]
    print("\n=== P3 reject cases (success must be false) ===")
    for r in rej:
        raw = _raw_for(r["case"])
        succ, tier, mult = decode_receipt(raw)
        print("  %-32s expectedFail=%s aiSuccess=%s tier=%s credit=%s completed=%s clean=%s" % (
            r["case"][:32], r.get("reject_expected_fail"), succ, tier,
            r.get("recipient_credit_delta_atto"), r.get("level_marked_completed"), r.get("consensus_clean")))
    print("  rejects confirmed success=false : %d / %d" % (
        sum(1 for r in rej if r.get("reject_expected_fail")), len(rej)))
    retr = [r for r in runs if r.get("case", "").endswith("_safe_retry")]
    print("  safe retries passed            : %d / %d" % (
        sum(1 for r in retr if r.get("retry_passed") or (isinstance(r.get("recipient_credit_delta_atto"), int) and r["recipient_credit_delta_atto"] > 0)),
        len(retr)))


if __name__ == "__main__":
    main()
