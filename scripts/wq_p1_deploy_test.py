"""P1.2: Deploy transfer_test.py on studionet, fund it, test all 4 emit_transfer
patterns. For each, record the recipient balance before/after, triggered txs, outcome."""
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
CONTRACT_PATH = os.path.join(ROOT, "contracts", "transfer_test.py")

deployer = Account.from_key(PK)
client = create_client(chain=studionet, account=deployer)

GEN = 10**18
TERMINAL = {"FINALIZED"}
ACCEPTED_OR_LATER = {"ACCEPTED", "FINALIZED"}


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


def wait_tx(tx_id, label, timeout=300, poll=20):
    """Block until tx reaches ACCEPTED or FINALIZED. Print one line per poll."""
    t0 = time.time()
    last_status = None
    same_count = 0
    while time.time() - t0 < timeout:
        r = client.get_transaction(tx_id)
        sn = r.get("status_name")
        elapsed = time.time() - t0
        print(f"  {label} t={elapsed:.0f}s status={sn}")
        if sn in ACCEPTED_OR_LATER:
            return r, round(elapsed, 1)
        if sn == last_status:
            same_count += 1
        else:
            last_status, same_count = sn, 1
        if same_count > 3:
            print(f"  STALLED at {sn} for {same_count} polls, stopping")
            return r, round(elapsed, 1)
        time.sleep(poll)
    r = client.get_transaction(tx_id)
    return r, round(time.time() - t0, 1)


# 1. Deploy
print("=== DEPLOYING transfer_test.py ===")
code = open(CONTRACT_PATH, "r", encoding="utf-8").read()
deploy_tx_id = client.deploy_contract(code=code)
print(f"Deploy tx: {deploy_tx_id}")

# Wait for deploy to finalize
deploy_result = None
for _ in range(15):
    time.sleep(8)
    tx = client.get_transaction(deploy_tx_id)
    status = tx.get("status_name")
    # Contract address on studionet is in to_address (deploy wraps via consensus)
    addr = tx.get("to_address") or tx.get("recipient")
    dd = tx.get("decoded_deploy_data") or {}
    addr = addr or (dd.get("contract_address") if isinstance(dd, dict) else None)
    if addr:
        deploy_result = addr
        print(f"  status={status} address={addr}")
        break
    print(f"  status={status} (no address yet)")

if not deploy_result:
    print("DEPLOY FAILED - no contract address resolved")
    sys.exit(1)

contract_addr = deploy_result
print(f"Contract: {contract_addr}")

# 2. Fund with 10 GEN
print("\n=== FUNDING 10 GEN ===")
fund_tx = client.write_contract(contract_addr, "deposit", value=10 * GEN)
r, sec = wait_tx(fund_tx, "deposit")
bal = int(client.read_contract(contract_addr, "contract_balance"))
print(f"  contract_balance: {bal / GEN} GEN")

# 3. Create test accounts
fresh_acct = Account.create()  # never used, 0 balance, can transact on gasless studionet
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
        print(f"\n=== {full_label} === balance_before={before:.6f}")
        try:
            tx_id = client.write_contract(contract_addr, method, account=signer)
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

        # For patterns with triggered txs, wait for those too
        trig_details = []
        if triggered:
            time.sleep(10)  # give triggered txs time to appear
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
                        "value": tr.get("value"),
                        "from": tr.get("from_address"),
                        "value_credited": tr.get("value_credited"),
                    })
                except Exception as e:
                    trig_details.append({"hash": tth, "error": str(e)})

        after = gen_bal(addr)
        delta = after - before

        info = {
            "pattern": label,
            "account": acct_name,
            "addr": addr,
            "tx_id": tx_id,
            "status": status,
            "result_name": result_name,
            "leader_exec": lr.get("execution_result"),
            "leader_msg": msg[:200],
            "triggered_count": len(triggered),
            "triggered_details": trig_details,
            "balance_before_gen": before,
            "balance_after_gen": after,
            "balance_delta_gen": round(delta, 9),
            "sec_to_accepted": sec_to_accept,
        }
        results.append(info)
        print(f"  RESULT: status={status} result={result_name} exec={lr.get('execution_result')}")
        print(f"  triggered={len(triggered)} delta={delta:+.9f} GEN sec={sec_to_accept}s")
        print(f"  leader_msg={msg[:120]}")

# 4. Final balance recheck after all triggered txs settle
print("\n=== WAITING FOR ALL TO SETTLE (extra 60s) ===")
time.sleep(60)
print("\n=== FINAL BALANCE RECHECK ===")
for acct_name, _, addr in signers:
    final_bal = gen_bal(addr)
    print(f"  {acct_name} ({addr[:12]}...): {final_bal:.6f} GEN")

bal_final = int(client.read_contract(contract_addr, "contract_balance"))
print(f"  contract: {bal_final / GEN} GEN")

# Write results
out = os.path.join(ROOT, "docs", "p1_transfer_test_results.json")
with open(out, "w") as f:
    json.dump({"contract": contract_addr, "results": results}, f, indent=2)
print(f"\nWrote {out}")
