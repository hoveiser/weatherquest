"""Decode the get_weather_multiplier leader/validator receipts for the probe
cities so the README can state the exact returned multiplier/tier/summary.
The value map is a msgpack map stored base64 in consensus_data.validators[].result
(the AGREE vote). Read-only, offline. No msgpack dep: we pull the ASCII runs."""
import base64
import json
import glob
import re


def receipt_b64(path):
    d = json.load(open(path, encoding="utf-8"))
    cd = d.get("consensus_data") or {}
    for v in cd.get("validators") or []:
        if v.get("vote") == "agree" and v.get("result"):
            return v["result"]
    return None


def ascii_runs(b):
    return re.findall(rb"[\x20-\x7e]{3,}", b)


for f in sorted(glob.glob("docs/round_raw/mult_*.json")):
    rb = receipt_b64(f)
    if not rb:
        print("=====", f, "NO AGREE RECEIPT")
        continue
    raw = base64.b64decode(rb)
    runs = [r.decode("ascii", "replace") for r in ascii_runs(raw)]
    print("=====", f)
    print("  ", " | ".join(runs))
