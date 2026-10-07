"""Deploy the fixed WeatherQuest contract (with native emit_transfer via
@gl.evm.contract_interface) to StudioNet, fund the house with 30 GEN, run a
complete_level, verify the recipient's native balance increased by the payout."""
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


def wait_tx(client, tx_id, label):
    t0 = time.time()
    last = None
    same = 0
    while time.time() - t0 < DEADLINE:
        try:
            r = client.get_transaction(tx_id)
        except Exception as e:
            print(f"  {label}: poll error {type(e).__name__} {str(e)[:60]}")
            time.sleep(POLL)
            continue
        sn = r.get("status_name", "?")
        el = round(time.time() - t0, 1)
        print(f"  [{el}s] {label}: {sn}")
        if sn == "FINALIZED":
            return r, el
        if sn == last:
            same += 1
            if same >= MAX_SAME:
                print(f"  STALLED at {sn}")
                return r, el
        else:
            same = 0
            last = sn
        time.sleep(POLL)
    return client.get_transaction(tx_id), round(time.time() - t0, 1)


def main():
    pk = os.environ.get("GENLAYER_PRIVATE_KEY")
    if not pk:
        print("ERROR: GENLAYER_PRIVATE_KEY missing")
        sys.exit(1)

    deployer = Account.from_key(pk)
    print(f"Deployer: {deployer.address}")
    client = create_client(chain=studionet, account=deployer)

    # DEPLOY
    print("\n=== DEPLOY WeatherQuest ===")
    code = open(os.path.join(ROOT, "contracts", "weatherquest.py"), "r", encoding="utf-8").read()
    tx_id = client.deploy_contract(code=code)
    print(f"Deploy tx: {tx_id}")
    print(f"Explorer: https://explorer-studio.genlayer.com/tx/{tx_id}")
    r, _ = wait_tx(client, tx_id, "deploy")
    addr = r.get("to_address")
    lr, msg = decode_lr(r)
    print(f"  status={r.get('status_name')} result={r.get('result_name')} exec={lr.get('execution_result')} addr={addr}")
    if not addr:
        print("FATAL: Deploy failed, no address")
        sys.exit(1)
    print(f"  CONTRACT_ADDRESS={addr}")

    # FUND 30 GEN
    print("\n=== FUND 30 GEN ===")
    fund_tx = client.write_contract(addr, "deposit", value=30 * GEN)
    print(f"Fund tx: {fund_tx}")
    r, _ = wait_tx(client, fund_tx, "fund")
    lr, _ = decode_lr(r)
    print(f"  status={r.get('status_name')} exec={lr.get('execution_result')}")
    bal = get_bal(client, addr)
    print(f"  Contract native balance: {bal/GEN:.2f} GEN")

    # TEST: complete_level on a fresh throwaway account
    print("\n=== COMPLETE_LEVEL TEST (level 1, Istanbul, fresh account) ===")
    player = Account.create()
    player_client = create_client(chain=studionet, account=player)
    print(f"Player: {player.address}")

    bal_before = get_bal(client, str(player.address))
    print(f"  Player native balance BEFORE: {bal_before} atto ({bal_before/GEN:.6f} GEN)")

    # complete_level(level, city, action, optimal_steps, actual_steps)
    # level 1 uses free-form geocode path
    cl_tx = player_client.write_contract(
        addr, "complete_level",
        args=[1, "Istanbul", "Walk to the market and buy bread", 10, 10]
    )
    print(f"  complete_level tx: {cl_tx}")
    print(f"  Explorer: https://explorer-studio.genlayer.com/tx/{cl_tx}")
    r, sec = wait_tx(player_client, cl_tx, "complete_level")
    lr, msg = decode_lr(r)
    triggered = r.get("triggered_transactions") or []
    result_name = r.get("result_name")
    print(f"  status={r.get('status_name')} result={result_name} exec={lr.get('execution_result')} trig={len(triggered)}")
    print(f"  msg snippet: {msg[:150]}")

    # Check triggered payout tx
    print("\n=== TRIGGERED PAYOUT TX ===")
    for th in triggered:
        try:
            tr = player_client.get_transaction(th)
            tlr, tmsg = decode_lr(tr)
            print(f"  {th[:20]}... status={tr.get('status_name')} result={tr.get('result_name')}")
            print(f"    to={tr.get('to_address')} value={tr.get('value')}")
            print(f"    exec={tlr.get('execution_result')} msg={tmsg[:80]}")
        except Exception as e:
            print(f"  {th[:20]}... ERROR: {e}")

    # Wait 30s for balance to propagate
    print("\n  Waiting 30s for triggered transfer to settle...")
    time.sleep(30)

    # Check player balance after
    bal_after = get_bal(player_client, str(player.address))
    delta = bal_after - bal_before
    print(f"\n=== RESULT ===")
    print(f"  Player native balance AFTER: {bal_after} atto ({bal_after/GEN:.6f} GEN)")
    print(f"  DELTA: {delta} atto ({delta/GEN:.6f} GEN)")

    # Check credit ledger too
    try:
        credit = player_client.read_contract(addr, "get_credit", args=[player.address])
        print(f"  get_credit(): {credit}")
    except Exception as e:
        print(f"  get_credit error: {e}")

    # Contract balance check
    contract_bal_final = get_bal(client, addr)
    print(f"  Contract balance after: {contract_bal_final/GEN:.4f} GEN (started at 30)")

    # Save evidence
    out = {
        "contract": str(addr),
        "deploy_tx": str(tx_id),
        "fund_tx": str(fund_tx),
        "complete_level_tx": str(cl_tx),
        "player": str(player.address),
        "player_balance_before": int(bal_before),
        "player_balance_after": int(bal_after),
        "player_delta": int(delta),
        "triggered_transactions": triggered,
        "complete_level_status": r.get("status_name"),
        "complete_level_result": result_name,
        "contract_balance_final_atto": int(contract_bal_final),
        "seconds_to_FINALIZED": float(sec),
        "verdict": "NATIVE_PAYOUT_WORKS" if delta > 0 else "NO_DELTA"
    }
    outpath = os.path.join(ROOT, "docs", "native_payout_verify.json")
    with open(outpath, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nEvidence saved: {outpath}")
    print(f"\nVERDICT: {out['verdict']}")


if __name__ == "__main__":
    main()
