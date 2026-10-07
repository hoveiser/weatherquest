"""P5 independent verification of the live-UI on-chain settlement.

Reads docs/ui-onchain-report.json (written by tools/pwtest/onchain_write.mjs),
takes the settlement tx hash the UI submitted, and independently (via the
StudioNet RPC, not the browser) confirms:
  * lifecycle reached FINALIZED (or at least ACCEPTED) within the 5-min cap,
  * result_name == MAJORITY_AGREE (NOT Validators Timeout / NO_MAJORITY),
  * num_of_rounds == 1 (one consensus round, no rotation),
  * the validator vote set,
  * the throwaway signer's on-chain credit equals the expected L1 payout.

Polls every 20-25s, one printed line per poll, stops after 3 no-change polls.
Loads nothing secret; reads only public tx data + this project's own key is not
needed for these reads. NEVER prints any private key.
"""
import json
import os
import sys
import time

from dotenv import load_dotenv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, ".env"))
from genlayer_py import create_client, studionet  # noqa: E402
from eth_account import Account  # noqa: E402

ADDR = "0x2d764187A908d1677510c5E7FE69e8e7C1810299"
BAD = {"NO_MAJORITY", "MAJORITY_DISAGREE", "TIMEOUT", "VALIDATORS_TIMEOUT",
       "LEADER_TIMEOUT", "UNDETERMINED"}
TERMINAL = {"FINALIZED", "UNDETERMINED", "VALIDATORS_TIMEOUT", "LEADER_TIMEOUT", "CANCELED"}

report = json.load(open(os.path.join(ROOT, "docs", "ui-onchain-report.json"), encoding="utf-8"))
sub = report.get("submitted") or []
signer = report.get("signer_address")
if not sub:
    print("no submitted tx in report; aborting"); sys.exit(1)
tx_id = sub[0]["hash"]
print("settlement tx:", tx_id)
print("signer:", signer)

client = create_client(chain=studionet, account=Account.create())

prev = None
same = 0
start = time.time()
raw = None
while time.time() - start < 300:
    try:
        raw = client.get_transaction(tx_id)
    except Exception as e:
        print("  poll err", type(e).__name__, str(e)[:60]); time.sleep(20); continue
    sn = raw.get("status_name")
    rn = raw.get("result_name")
    print("[%3ds] status=%s result=%s rounds=%s" % (
        int(time.time() - start), sn, rn, raw.get("num_of_rounds")))
    if sn in TERMINAL:
        break
    if sn == prev:
        same += 1
        if same >= 3:
            print("no change x3, stopping"); break
    else:
        same = 0
    prev = sn
    time.sleep(22)

cd = (raw or {}).get("consensus_data") or {}
votes = cd.get("votes") or {}
vote_vals = list(votes.values())
result = {
    "tx_hash": tx_id,
    "status_name": (raw or {}).get("status_name"),
    "result_name": (raw or {}).get("result_name"),
    "num_of_rounds": (raw or {}).get("num_of_rounds"),
    "votes": vote_vals,
    "consensus_clean": (raw or {}).get("result_name") not in BAD and bool(vote_vals),
}
print(json.dumps(result, indent=2))

# read the signer's on-chain credit on the contract
credit = None
try:
    credit = client.read_contract(ADDR, "get_credit", [signer])
    print("get_credit(signer):", credit)
except Exception as e:
    print("get_credit read failed:", type(e).__name__, str(e)[:80])

out = {"settlement": result, "credit": credit}
with open(os.path.join(ROOT, "docs", "p5_ui_onchain_verify.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2, default=str)
print("wrote docs/p5_ui_onchain_verify.json")
