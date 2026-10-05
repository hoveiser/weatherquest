"""Deploy the fixed WeatherQuest contract to StudioNet via the py SDK.

StudioNet is gasless, so this needs no GEN to deploy. It:
  1. loads GENLAYER_PRIVATE_KEY from the project .env (never printed)
  2. deploys contracts/weatherquest.py
  3. polls the deploy tx until it FINALIZES, resolves the new address
  4. verifies the address has runtime code and prints the new contract address

Usage:
  python scripts/wq_deploy.py            # deploy + wait + print address
  python scripts/wq_deploy.py <addr>     # skip deploy, just re-resolve/report addr
"""
import os
import sys
import time

from dotenv import load_dotenv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, ".env"))
pk = os.environ.get("GENLAYER_PRIVATE_KEY")
if not pk:
    print("NO GENLAYER_PRIVATE_KEY in .env")
    sys.exit(2)

from eth_account import Account
from genlayer_py import create_client, studionet

CONTRACT_PATH = os.path.join(ROOT, "contracts", "weatherquest.py")
FINALIZED = 3  # GenLayer status: 0 pending,1 accepted,...,3 finalized


def resolve_address(client, tx_id):
    """Return (address, status) from the decoded deploy transaction, if present."""
    tx = client.get_transaction(tx_id)
    status = tx.get("status") if isinstance(tx, dict) else getattr(tx, "status", None)
    addr = None
    if isinstance(tx, dict):
        dd = tx.get("decoded_deploy_data") or tx.get("deploy_data") or {}
        addr = dd.get("contract_address") if isinstance(dd, dict) else None
        addr = addr or tx.get("contract_address")
    else:
        dd = getattr(tx, "decoded_deploy_data", None)
        if isinstance(dd, dict):
            addr = dd.get("contract_address")
    return addr, status


def main():
    acct = Account.from_key(pk)
    client = create_client(chain=studionet, account=acct)
    print("deployer:", acct.address)

    if len(sys.argv) > 1:
        addr = sys.argv[1]
        code = client.get_code(addr)
        print("recheck address:", addr, "has_code:", bool(code and code != b"0x"))
        return

    code = open(CONTRACT_PATH, "r", encoding="utf-8").read()
    print("deploying %d bytes to studionet ..." % len(code))
    tx_id = client.deploy_contract(code=code)
    print("deploy txId:", tx_id)

    # Poll for finalization + address. Cap ~5 min per rule 6.
    addr = None
    status = None
    first = True
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            raw = client.get_transaction(tx_id)
            if first:
                print("  raw tx type:", type(raw).__name__)
                if isinstance(raw, dict):
                    print("  raw tx keys:", sorted(raw.keys()))
                first = False
            addr, status = resolve_address(client, tx_id)
        except Exception as e:
            print("  poll err:", e)
        print("  status=%s addr=%s" % (status, addr))
        if addr:
            break
        time.sleep(6)

    if not addr:
        print("DEPLOY NOT RESOLVED within 5 min; status=%s" % status)
        sys.exit(3)

    rc = client.get_code(addr)
    print("NEW CONTRACT ADDRESS:", addr)
    print("has runtime code:", bool(rc and rc != b"0x"))


if __name__ == "__main__":
    main()
