"""Deploy contracts/payout_control.py to StudioNet, fund it, test native GEN
transfer to both a never-used EOA and the deployer's own EOA. Reports triggered
tx result and balance changes. Never prints private keys."""
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


def get_balance(client, addr):
    """eth_getBalance via the client."""
    try:
        return int(client.get_balance(addr))
    except Exception:
        return -1


def decode_lr(r):
    """Decode the leader receipt from get_transaction result."""
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
    """Poll until FINALIZED or ACCEPTED, 5 min cap, 3 same -> stop."""
    t0 = time.time()
    last_status = None
    same_count = 0
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
        if sn in ("FINALIZED",):
            return r, el
        if sn == last_status:
            same_count += 1
            if same_count >= MAX_SAME:
                print(f"  STALLED at {sn} after {same_count} checks, returning")
                return r, el
        else:
            same_count = 0
            last_status = sn
        time.sleep(POLL)
    return client.get_transaction(tx_id), round(time.time() - t0, 1)


def main():
    pk = os.environ.get("GENLAYER_PRIVATE_KEY")
    if not pk:
        print("ERROR: GENLAYER_PRIVATE_KEY missing from .env")
        sys.exit(1)

    deployer = Account.from_key(pk)
    print(f"Deployer: {deployer.address}")

    client = create_client(chain=studionet, account=deployer)

    # Deploy
    print("\n=== DEPLOY ===")
    code = open(os.path.join(ROOT, "contracts", "payout_control.py"), "r", encoding="utf-8").read()
    tx_id = client.deploy_contract(code=code)
    print(f"Deploy tx: {tx_id}")
    print(f"Explorer: https://explorer-studio.genlayer.com/tx/{tx_id}")
    r, sec = wait_tx(client, tx_id, "deploy")
    addr = r.get("to_address")
    lr, msg = decode_lr(r)
    print(f"  status={r.get('status_name')} result={r.get('result_name')} exec={lr.get('execution_result')} addr={addr}")
    if not addr:
        print("FATAL: no contract address")
        sys.exit(1)

    # Fund with 2 GEN (enough for two 0.5 GEN payouts + 1 GEN buffer)
    print("\n=== FUND 2 GEN ===")
    fund_tx = client.write_contract(addr, "fund", value=2 * GEN)
    print(f"Fund tx: {fund_tx}")
    r, _ = wait_tx(client, fund_tx, "fund")
    lr, msg = decode_lr(r)
    print(f"  status={r.get('status_name')} result={r.get('result_name')} exec={lr.get('execution_result')}")
    # Check contract balance
    native_bal = get_balance(client, addr)
    print(f"  contract native balance: {native_bal} atto ({native_bal/GEN:.4f} GEN)")
    try:
        cb = int(client.read_contract(addr, "contract_balance"))
        print(f"  contract_balance(): {cb} atto ({cb/GEN:.4f} GEN)")
    except Exception as e:
        print(f"  contract_balance() error: {e}")

    # Test EOA addresses
    fresh = Account.create()
    print(f"\nFresh EOA (never used): {fresh.address}")

    # Test pay_to (send to a specific address string)
    print("\n=== PATTERN: pay_to fresh EOA (0.5 GEN) ===")
    bal_before_fresh = get_balance(client, str(fresh.address))
    print(f"  Fresh balance before: {bal_before_fresh} atto")
    p1_tx = client.write_contract(addr, "pay_to", args=[str(fresh.address), 5 * 10**17])
    print(f"  tx: {p1_tx}")
    r, _ = wait_tx(client, p1_tx, "pay_to_fresh")
    lr, msg = decode_lr(r)
    triggered = r.get("triggered_transactions") or []
    print(f"  status={r.get('status_name')} result={r.get('result_name')} exec={lr.get('execution_result')} trig={len(triggered)}")
    print(f"  msg={msg[:120]}")
    bal_after_fresh = get_balance(client, str(fresh.address))
    print(f"  Fresh balance after: {bal_after_fresh} atto (delta={bal_after_fresh - bal_before_fresh})")

    # Test pay_self (send to caller)
    print("\n=== PATTERN: pay_self (0.5 GEN to deployer) ===")
    bal_before_deployer = get_balance(client, str(deployer.address))
    print(f"  Deployer balance before: {bal_before_deployer} atto")
    p2_tx = client.write_contract(addr, "pay_self", args=[5 * 10**17])
    print(f"  tx: {p2_tx}")
    r, _ = wait_tx(client, p2_tx, "pay_self")
    lr, msg = decode_lr(r)
    triggered2 = r.get("triggered_transactions") or []
    print(f"  status={r.get('status_name')} result={r.get('result_name')} exec={lr.get('execution_result')} trig={len(triggered2)}")
    print(f"  msg={msg[:120]}")
    bal_after_deployer = get_balance(client, str(deployer.address))
    print(f"  Deployer balance after: {bal_after_deployer} atto (delta={bal_after_deployer - bal_before_deployer})")

    # Wait 60s then check triggered txs and balances again
    print("\n=== WAIT 60s for triggered txs to settle ===")
    time.sleep(60)

    # Recheck balances
    print("\n=== FINAL BALANCES ===")
    fresh_final = get_balance(client, str(fresh.address))
    deployer_final = get_balance(client, str(deployer.address))
    contract_final = get_balance(client, addr)
    print(f"  Fresh EOA: {fresh_final} atto")
    print(f"  Deployer EOA: {deployer_final} atto")
    print(f"  Contract: {contract_final} atto")
    try:
        stats = client.read_contract(addr, "get_stats")
        print(f"  Contract stats: {stats}")
    except Exception as e:
        print(f"  get_stats error: {e}")

    # Check triggered txs
    print("\n=== TRIGGERED TX DETAILS ===")
    for label, tx_list in [("pay_to_fresh", triggered), ("pay_self", triggered2)]:
        for th in tx_list:
            try:
                tr = client.get_transaction(th)
                tlr, tmsg = decode_lr(tr)
                print(f"  {label}: {th[:20]}... status={tr.get('status_name')} result={tr.get('result_name')} exec={tlr.get('execution_result')} to={tr.get('to_address','?')} val={tr.get('value')} msg={tmsg[:60]}")
            except Exception as e:
                print(f"  {label}: {th[:20]}... ERROR {e}")

    # Save evidence
    out = {
        "contract": str(addr),
        "deploy_tx": str(tx_id),
        "fund_tx": str(fund_tx),
        "pay_to_fresh_tx": str(p1_tx),
        "pay_self_tx": str(p2_tx),
        "fresh_eoa": str(fresh.address),
        "fresh_balance_before": int(bal_before_fresh),
        "fresh_balance_after_60s": int(fresh_final),
        "fresh_delta": int(fresh_final - bal_before_fresh),
        "deployer_eoa": str(deployer.address),
        "deployer_balance_before": int(bal_before_deployer),
        "deployer_balance_after_60s": int(deployer_final),
        "deployer_delta": int(deployer_final - bal_before_deployer),
        "contract_balance_before": int(native_bal),
        "contract_balance_after": int(contract_final),
        "payout_amount": 5 * 10**17,
        "pay_to_fresh_result": {"status": r.get("status_name"), "exec": lr.get("execution_result"), "triggered": len(triggered)},
        "pay_self_result": {"triggered": len(triggered2)},
    }
    outpath = os.path.join(ROOT, "docs", "payout_control_result.json")
    with open(outpath, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nEvidence saved: {outpath}")

    # Verdict
    delta_fresh = fresh_final - bal_before_fresh
    delta_deployer = deployer_final - bal_before_deployer
    if delta_fresh >= 5 * 10**17 or delta_deployer >= 5 * 10**17:
        print("\nVERDICT: NATIVE GEN TRANSFER WORKS on StudioNet")
    else:
        print(f"\nVERDICT: NO BALANCE DELTA. fresh={delta_fresh}, deployer={delta_deployer}")
        print("  May need to check triggered tx status separately")


if __name__ == "__main__":
    main()
