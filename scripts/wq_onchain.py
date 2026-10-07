"""StudioNet on-chain verification for the redeployed WeatherQuest contract.

Loads GENLAYER_PRIVATE_KEY from .env (never printed) and runs a named step so
each consensus round-trip is one explicit, observable action (rule 6).

  python scripts/wq_onchain.py schema      # deployed ABI/methods present?
  python scripts/wq_onchain.py bal          # contract GEN balance
  python scripts/wq_onchain.py deposit      # fund the house with 2 GEN (payable)
  python scripts/wq_onchain.py mult         # get_weather_multiplier("Tokyo")
  python scripts/wq_onchain.py complete     # complete_level(2,"Tokyo",action)  [3-arg ABI]

Write steps submit the tx, then poll get_transaction until it leaves PENDING,
printing status_name + result_name (the consensus outcome we must prove).
"""
import os
import sys
import time

from dotenv import load_dotenv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, ".env"))
from eth_account import Account
from genlayer_py import create_client, studionet

ADDR = os.environ.get(
    "WQ_CONTRACT_ADDRESS", "0x6028EB222937cd0Bd881c85260E1e0F11330a0A3"
)
GEN = 10**18
DEADLINE = 300  # 5 min per tx (rule 5)
POLL = 20       # seconds between polls (rule 5)


def client():
    acct = Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"])
    return create_client(chain=studionet, account=acct), acct


def wait_tx(c, tx_id, label):
    """Poll a submitted tx until it leaves PENDING; print the consensus result."""
    print("%s: submitted txId %s" % (label, tx_id))
    deadline = time.time() + DEADLINE
    seen = {}
    while time.time() < deadline:
        tx = c.get_transaction(tx_id)
        sn = tx.get("status_name")
        rn = tx.get("result_name")
        seen[sn] = seen.get(sn, 0) + 1
        print("  %s status=%s result=%s" % (label, sn, rn))
        if sn in ("FINALIZED", "FAILED", "UNDETERMINED"):
            return sn, rn
        if seen[sn] > 15:  # same state 15x (~5 min) => stop and report
            print("  STALLED in %s; stopping for manual review" % sn)
            return sn, rn
        time.sleep(POLL)
    print("  TIMEOUT waiting for %s" % label)
    return "TIMEOUT", None


def do_schema(c):
    sch = c.get_contract_schema(ADDR)
    try:
        funcs = [m.get("name") for m in sch.get("abi", []) if m.get("type") == "function"]
    except Exception:
        funcs = None
    print("schema keys:", list(sch.keys()) if isinstance(sch, dict) else type(sch))
    print("methods:", funcs)
    print("raw schema:", str(sch)[:600])


def do_bal(c):
    bal = int(c.get_balance(ADDR))
    print("contract GEN: %.6f" % (bal / GEN))


def do_deposit(c, acct):
    tx_id = c.write_contract(ADDR, "deposit", value=2 * GEN)
    wait_tx(c, tx_id, "deposit(2 GEN)")
    do_bal(c)


def do_mult(c, acct):
    tx_id = c.write_contract(ADDR, "get_weather_multiplier", args=["Tokyo"])
    sn, rn = wait_tx(c, tx_id, "get_weather_multiplier(Tokyo)")
    if sn == "FINALIZED":
        bal = int(c.read_contract(ADDR, "contract_balance"))
        print("view contract_balance: %.6f GEN" % (bal / GEN))


def do_complete(c, acct):
    # Level 2 -> fixed table city "Tokyo". 3-arg ABI: no caller step counts.
    args = [2, "Tokyo", "Set up a sturdy tent and wait out the wind"]
    tx_id = c.write_contract(ADDR, "complete_level", args=args)
    sn, rn = wait_tx(c, tx_id, "complete_level(2,Tokyo)")
    print("complete_level consensus:", sn, rn)


STEPS = {
    "schema": do_schema,
    "bal": do_bal,
    "deposit": do_deposit,
    "mult": do_mult,
    "complete": do_complete,
}


def main():
    step = sys.argv[1] if len(sys.argv) > 1 else "schema"
    if step not in STEPS:
        print("unknown step; choose from", sorted(STEPS))
        sys.exit(2)
    c, acct = client()
    print("account:", acct.address, "target:", ADDR)
    fn = STEPS[step]
    try:
        fn(c, acct) if step in ("deposit", "mult", "complete") else fn(c)
    except Exception as e:
        import traceback

        traceback.print_exc()
        print("STEP ERROR:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
