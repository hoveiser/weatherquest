"""P1.1: Pull triggered payout txs and the user-reported failed tx, report root cause."""
import base64
import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from genlayer_py import create_client, studionet

c = create_client(chain=studionet)

# All triggered tx hashes from the round (from docs/round_results.json)
recs = json.load(open(os.path.join(os.path.dirname(__file__), "..", "docs", "round_results.json")))
triggered = []
for r in recs:
    if r.get("kind") == "complete_level" and r.get("triggered_transactions"):
        for th in r["triggered_transactions"]:
            triggered.append((r["case"], r["tx_hash"], th))

# Also the user-reported one
triggered.append(("USER_REPORTED", "unknown_parent", "0xa7d58a7e3a07e8d3d1ddfed2676e82112939c1703b2069b52685db7dead6cf72"))

print(f"Checking {len(triggered)} triggered txs...")
results = []
for case, parent, th in triggered:
    try:
        r = c.get_transaction(th)
        cd = r.get("consensus_data") or {}
        lr_list = cd.get("leader_receipt") or []
        lr = lr_list[0] if lr_list else {}
        result_raw = lr.get("result", "")
        try:
            decoded = base64.b64decode(result_raw).decode("utf-8") if result_raw else "(empty)"
        except Exception:
            decoded = str(result_raw)[:150]
        info = {
            "case": case,
            "parent": parent,
            "triggered_hash": th,
            "status_name": r.get("status_name"),
            "result_name": r.get("result_name"),
            "num_of_rounds": r.get("num_of_rounds"),
            "from_address": r.get("from_address"),
            "to_address": r.get("to_address"),
            "value": r.get("value"),
            "triggered_by": r.get("triggered_by"),
            "triggered_on": r.get("triggered_on"),
            "leader_exec": lr.get("execution_result"),
            "leader_msg": decoded,
            "gaslimit": r.get("gaslimit"),
            "value_credited": r.get("value_credited"),
        }
        results.append(info)
        print(f"  {case}: {r.get('status_name')} / {r.get('result_name')} exec={lr.get('execution_result')} msg={decoded[:80]}")
    except Exception as e:
        print(f"  {case}: ERROR {e}")
        results.append({"case": case, "triggered_hash": th, "error": str(e)})

# Write to disk
out = os.path.join(os.path.dirname(__file__), "..", "docs", "p1_triggered_txs.json")
with open(out, "w") as f:
    json.dump(results, f, indent=2)
print(f"\nWrote {out}")

# Summary
errors = [r for r in results if r.get("leader_exec") == "ERROR"]
print(f"\nSUMMARY: {len(errors)} of {len(results)} triggered txs have leader ERROR")
msgs = set(r.get("leader_msg", "") for r in errors)
for m in msgs:
    print(f"  unique error msg: {m}")
