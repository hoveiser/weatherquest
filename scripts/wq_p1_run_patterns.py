"""P1.2b: Using the already-deployed transfer_test contract, fund it and test all
emit_transfer patterns on studionet. Contract: 0xB6b201E6b0BBb8771855Fbf6bB4f5e275224Bdcd"""
import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from eth_account import Account
from genlayer_py import create_client, studionet

PK = os.environ["GENLAYER_PRIVATE_KEY"]
ROOT = os.path.join(os.path.dirname(__file__), "..")
CONTRACT = "0xB6b201E6b0BBb8771855Fbf6bB4f5e275224Bdcd"
GEN = 10**18
ACCEPTED_OR_LATER = {"ACCEPTED", "FINALIZED"}
TERMINAL = {"FINALIZED"}

deployer = Account.from_key(PK)
client = create_client(chain=studionet, account=deployer)


def gen_bal(addr):
    return int(client.get_balance(addr)) / GEN


def decode_result(r):
    cd = r.get("consensus_data") or {}
    lr_list = cd.get("leader_receipt") or []
    lr = lr_list[0] if lr_list else {}
    result_raw = lr.get("result", "")
    if isinstance(result_raw, dict):
        raw = result_raw.get("raw", "")
    else:
        raw = result_raw
    try:
        decoded = base64.b64decode(raw).decode("utf-8") if raw else "(empty)"
    except Exception:
        decoded = str(raw)[:200]
    return lr, decoded


def wait_tx(tx_id, label, timeout=300, poll=20, need_finalized=False):
    """Block until tx reaches ACCEPTED (or FINALIZED if need_finalized=True)."""
    target = TERMINAL if need_finalized else ACCEPTED_OR_LATER
    t0 = time.time()
    last_status = None
    same_count = 0
    while time.time() - t0 < timeout:
        r = client.get_transaction(tx_id)
        sn = r.get("status_name")
        elapsed = time.time() - t0
        print(f"  {label} t={elapsed:.0f}s status={sn}")
        if sn in target:
            return r, round(elapsed, 1)
        if sn == last_status:
            same_count += 1
        else:
            last_status, same_count = sn, 1
        if same_count > 3:
            print(f"  STALLED at {sn}")
            return r, round(elapsed, 1)
        time.sleep(poll)
    return client.get_transaction(tx_id), round(time.time() - t0, 1)


# Check contract has code
code = client.get_code(CONTRACT)
print(f"Contract {CONTRACT} code: {bool(code and code != b'0x')}")

# Check current balance
bal = int(client.read_contract(CONTRACT, "contract_balance"))
print(f"Current contract_balance: {bal / GEN} GEN")

# Fund with 10 GEN
if bal / GEN < 10:
    print("\n=== FUNDING 10 GEN ===")
    fund_tx = client.write_contract(CONTRACT, "deposit", value=10 * GEN)
    print(f"  fund tx: {fund_tx}")
    r, sec = wait_tx(fund_tx, "deposit", need_finalized=True)
    bal = int(client.read_contract(CONTRACT, "contract_balance"))
    print(f"  contract_balance after fund: {bal / GEN} GEN")

# Test accounts
fresh_acct = Account.create()
signers = [
    ("funded_deployer", deployer, deployer.address),
    ("fresh_never_used", fresh_acct, fresh_acct.address),
]

patterns = [
    ("pay_immediate", "A_immediate"),
    ("pay_on_accepted", "B_accepted"),
    ("pay_on_finalized", "C_finalized"),
    ("pay_broken", "D_control_broken"),
]

results = []
for acct_name, signer, addr in signers:
    for method, label in patterns:
        full_label = f"{label}/{acct_name}"
        before = gen_bal(addr)
        print(f"\n{'='*60}")
        print(f"  {full_label} | addr={addr[:14]}... | bal_before={before:.6f}")
        try:
            tx_id = client.write_contract(CONTRACT, method, account=signer)
        except Exception as e:
            print(f"  CALL ERROR: {e}")
            results.append({"pattern": label, "account": acct_name, "error": str(e)})
            continue

        print(f"  tx_id={tx_id}")
        r, sec_to_accept = wait_tx(tx_id, full_label)
        lr, msg = decode_result(r)
        triggered = r.get("triggered_transactions") or []
        status = r.get("status_name")
        result_name = r.get("result_name")

        # Wait extra for triggered txs then check them
        trig_details = []
        if triggered:
            time.sleep(15)
            for tth in triggered:
                try:
                    tr = client.get_transaction(tth)
                    tlr, tmsg = decode_result(tr)
                    trig_details.append({
                        "hash": tth,
                        "status": tr.get("status_name"),
                        "result": tr.get("result_name"),
                        "exec": tlr.get("execution_result"),
                        "msg": tmsg[:150],
                        "to": tr.get("to_address"),
                        "from": tr.get("from_address"),
                        "value": tr.get("value"),
                        "value_credited": tr.get("value_credited"),
                    })
                    print(f"  TRIG {tth[:18]}... status={tr.get('status_name')}/{tr.get('result_name')} exec={tlr.get('execution_result')} msg={tmsg[:80]}")
                except Exception as e:
                    trig_details.append({"hash": tth, "error": str(e)})

        after = gen_bal(addr)
        delta = after - before

        info = {
            "pattern": label, "account": acct_name, "addr": addr,
            "tx_id": tx_id, "status": status, "result_name": result_name,
            "leader_exec": lr.get("execution_result"), "leader_msg": msg[:200],
            "triggered_count": len(triggered), "triggered_details": trig_details,
            "balance_before_gen": before, "balance_after_gen": after,
            "balance_delta_gen": round(delta, 9), "sec_to_accepted": sec_to_accept,
        }
        results.append(info)
        print(f"  MAIN: {status}/{result_name} exec={lr.get('execution_result')} msg={msg[:100]}")
        print(f"  triggered={len(triggered)} bal_delta={delta:+.9f} GEN")

# Final recheck after settle
print("\n=== WAITING 60s FOR TRIGGERED TXs TO SETTLE ===")
time.sleep(60)
print("=== FINAL BALANCE RECHECK ===")
for acct_name, signer, addr in signers:
    final_bal = gen_bal(addr)
    print(f"  {acct_name} ({addr[:14]}...): {final_bal:.6f} GEN")

bal_final = int(client.read_contract(CONTRACT, "contract_balance"))
print(f"  contract: {bal_final / GEN} GEN")

# Write results
out = os.path.join(ROOT, "docs", "p1_transfer_test_results.json")
with open(out, "w") as f:
    json.dump({"contract": CONTRACT, "results": results}, f, indent=2)
print(f"\nWrote {out}")
print("DONE")
