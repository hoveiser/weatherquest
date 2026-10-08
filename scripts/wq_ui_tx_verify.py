"""Independently verify a UI-submitted StudioNet tx with the GenLayer SDK.

Usage: python scripts/wq_ui_tx_verify.py <tx_hash> <wallet_address>

Checks (all printed, nothing assumed):
  - get_transaction lifecycle status + consensus result name
  - leader receipt execution_result / result_status (must be SUCCESS)
  - num_of_rounds + validator votes recorded
  - get_credit(wallet) on the current contract equals the expected payout
    payout = base(level) * multiplier_x100 // 100 with level = 1 (Istanbul run
    from the live UI): base 0.1 GEN, multiplier derived from the credit itself.
One blocking RPC call per poll, 25s between polls, 300s hard deadline, and it
stops after 3 unchanged polls (network rules). Reads GENLAYER_PRIVATE_KEY only
from this project's own .env; never prints it.
"""
import os
import sys
import time

from dotenv import load_dotenv
from eth_account import Account
from genlayer_py import create_client, studionet

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, ".env"))

ADDR = os.environ.get(
    "WQ_CONTRACT_ADDRESS", "0x6028EB222937cd0Bd881c85260E1e0F11330a0A3"
)
GEN = 10**18
LEVEL_BASE_GEN = (0, 10, 12, 15, 20, 25, 30, 35, 50, 75, 100)
POLL, DEADLINE, MAX_SAME = 25, 300, 3

tx_hash = sys.argv[1]
wallet = sys.argv[2]
lvl = int(sys.argv[3]) if len(sys.argv) > 3 else 1
acct = Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"])
client = create_client(chain=studionet, account=acct)

prev = None
same = 0
start = time.time()
raw = None
while True:
    raw = client.get_transaction(tx_hash)
    status = raw.get("status_name")
    result = raw.get("result_name")
    print("[%4ds] tx=%s status=%s result=%s" % (int(time.time() - start), tx_hash[:14] + "...", status, result))
    if status in ("FINALIZED", "UNDETERMINED", "CANCELED"):
        break
    key = (status, result)
    if key == prev:
        same += 1
        if same >= MAX_SAME:
            print("NO CHANGE x3, stopping and reporting current state")
            break
    else:
        same = 0
    prev = key
    if time.time() - start > DEADLINE:
        print("300s deadline reached, reporting current state")
        break
    time.sleep(POLL)

cd = raw.get("consensus_data") or {}
leader = (cd.get("leader_receipt") or [{}])[0]
lres = leader.get("result") or {}
lr = raw.get("last_round") or {}
votes = lr.get("validator_votes") or []
rounds = raw.get("num_of_rounds")
print("leader_execution_result=%s leader_result_status=%s votes=%s rounds=%s" % (
    leader.get("execution_result"), lres.get("status"), len(votes), rounds))

credit = client.read_contract(ADDR, "get_credit", args=[wallet])
atto = int(credit.get("credit_atto", 0))
base = LEVEL_BASE_GEN[lvl] * GEN // 100
mult = atto * 100 // base if base else 0
exact = base * mult // 100
print("wallet=%s level=%d base_atto=%d credit_atto=%d derived_mult_x100=%d" % (wallet, lvl, base, atto, mult))
print("payout == base*mult//100: %s (expected %d)" % (exact == atto, exact))
print("STATUS=%s RESULT=%s" % (status, result))
ok = (
    status == "FINALIZED"
    and str(result).endswith("MAJORITY_AGREE")
    and str(leader.get("execution_result")).endswith("SUCCESS")
    and len(votes) >= 5
    and atto > 0 and exact == atto and 100 <= mult <= 500
)
print("VERDICT:", "PASS" if ok else "CHECK")
