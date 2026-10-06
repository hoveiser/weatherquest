"""Read-only helper: list parent complete_level txs and their triggered tx hashes
from docs/round_results.json. No network calls."""
import io
import json

recs = json.load(io.open("docs/round_results.json", encoding="utf-8"))
for r in recs:
    if str(r.get("kind", "")).startswith("complete"):
        print(r["case"], "|", r["tx_hash"], "| trig =", r.get("triggered_transactions"))
print("---- kinds seen:", sorted({str(r.get("kind")) for r in recs}))
