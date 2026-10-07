"""Deploy the CURRENT WeatherQuest contract (base * weather payout, no efficiency
bonus, fixed campaign cities 1-10, marketplace escrow disabled) to StudioNet and
fund the house with 30 GEN. Writes evidence to docs/deploy_new.json.

Gasless on StudioNet: the deployer needs 0 GEN to deploy a contract, but funding
the house with 30 GEN is a value-bearing deposit, so the deployer must hold >=30
GEN. Loads GENLAYER_PRIVATE_KEY from this project's own .env and NEVER prints it.

Rule 5: every consensus round-trip is one explicit BLOCKING wait with a 300s hard
deadline, polled every 20s with one printed line per tx; if a status is unchanged
for >3 polls the run STOPS and reports instead of looping in the background.
"""
import base64
import json
import os
import sys
import time

from dotenv import load_dotenv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(ROOT, ".env"))

from eth_account import Account
from genlayer_py import create_client, studionet

GEN = 10**18
DEADLINE = 300
POLL = 20
MAX_SAME = 3
STALE_ADDR = {
    "0x2d764187A908d1677510c5E7FE69e8e7C1810299",
    "0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72",
    "0x884974D0D16E087d925c690186687de9Ec2B20F9",
    "0x599EA254e19f7427Db0B158123ED1A21f28538fe",
}


class Stall(Exception):
    pass


def get_bal(client, addr):
    try:
        return int(client.get_balance(addr))
    except Exception:
        return -1


def decode_lr(r):
    cd = r.get("consensus_data") or {}
    lrs = cd.get("leader_receipt") or []
    lr = lrs[0] if lrs else {}
    res = lr.get("result", "")
    raw = res.get("raw", "") if isinstance(res, dict) else res
    try:
        msg = base64.b64decode(raw).decode("utf-8", errors="replace") if raw else "(empty)"
    except Exception:
        msg = str(res)[:200]
    return lr, msg


def _transient(err):
    s = str(err).lower()
    return any(k in s for k in (
        "502", "503", "504", "bad gateway", "timed out", "timeout", "connection",
        "reset by peer", "-32429", "429", "temporar", "unavailable",
        "eof occurred", "ssl", "getaddrinfo"))


def wait_tx(client, tx_id, label):
    t0 = time.time()
    last = None
    same = 0
    while True:
        try:
            r = client.get_transaction(tx_id)
        except Exception as e:
            if not _transient(e):
                raise
            if time.time() - t0 > DEADLINE:
                break
            print("  [%5.1fs] %s: poll transient (%s)" % (time.time() - t0, label, str(e)[:40]))
            time.sleep(POLL)
            continue
        sn = r.get("status_name", "?")
        el = round(time.time() - t0, 1)
        print("  [%5.1fs] %s: %s result=%s" % (el, label, sn, r.get("result_name")))
        if sn == "FINALIZED":
            return r, el
        if sn == last:
            same += 1
            if same >= MAX_SAME:
                raise Stall("stalled in %s for %d polls with no change (~%ds)" % (sn, same, same * POLL))
        else:
            same, last = 1, sn
        if el > DEADLINE:
            break
        time.sleep(POLL)
    return client.get_transaction(tx_id), round(time.time() - t0, 1)


def main():
    pk = os.environ.get("GENLAYER_PRIVATE_KEY")
    if not pk:
        print("ERROR: GENLAYER_PRIVATE_KEY missing")
        sys.exit(1)

    deployer = Account.from_key(pk)
    print("Deployer:", deployer.address)
    client = create_client(chain=studionet, account=deployer)

    print("\n=== DEPLOY WeatherQuest (new ABI) ===")
    code = open(os.path.join(ROOT, "contracts", "weatherquest.py"), "r", encoding="utf-8").read()
    tx_id = client.deploy_contract(code=code)
    print("Deploy tx:", tx_id)
    print("Explorer: https://explorer-studio.genlayer.com/tx/%s" % tx_id)
    r, _ = wait_tx(client, tx_id, "deploy")
    addr = r.get("to_address")
    lr, msg = decode_lr(r)
    print("  status=%s result=%s exec=%s addr=%s" % (
        r.get("status_name"), r.get("result_name"), lr.get("execution_result"), addr))
    if not addr:
        print("FATAL: deploy produced no address; execution likely failed")
        print("  leader msg:", msg[:300])
        sys.exit(1)
    if str(addr) in STALE_ADDR:
        print("FATAL: deploy returned a stale prior address, aborting")
        sys.exit(1)
    print("  NEW CONTRACT_ADDRESS=%s" % addr)

    print("\n=== FUND 30 GEN (deposit) ===")
    fund_tx = client.write_contract(addr, "deposit", value=30 * GEN)
    print("Fund tx:", fund_tx)
    r, _ = wait_tx(client, fund_tx, "fund")
    lr, _ = decode_lr(r)
    print("  status=%s exec=%s" % (r.get("status_name"), lr.get("execution_result")))
    bal = get_bal(client, addr)
    print("  House native balance: %.4f GEN" % (bal / GEN))

    print("\n=== ABI sanity: complete_level takes (level, city, action) ===")
    try:
        schema = client.get_contract_schema(addr) if hasattr(client, "get_contract_schema") else None
        if schema:
            cl = (schema.get("abi") or {}).get("complete_level") or schema.get("complete_level")
            print("  complete_level inputs:", cl)
    except Exception as e:
        print("  schema read skipped:", str(e)[:60])

    out = {
        "contract": str(addr),
        "deploy_tx": str(tx_id),
        "fund_tx": str(fund_tx),
        "deploy_status": r.get("status_name"),
        "house_native_atto": int(bal),
        "house_native_gen": bal / GEN,
        "deployer": str(deployer.address),
    }
    outpath = os.path.join(ROOT, "docs", "deploy_new.json")
    with open(outpath, "w") as f:
        json.dump(out, f, indent=2)
    print("\nEvidence saved:", outpath)
    print("NEW_ADDRESS=%s" % addr)


if __name__ == "__main__":
    try:
        main()
    except Stall as s:
        print("STALL -> stopping and reporting (rule 5):", s)
        sys.exit(3)
