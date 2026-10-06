"""Check the D pattern txs - did triggered txs appear after finalization?"""
import os, sys, json, base64
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from eth_account import Account
from genlayer_py import create_client, studionet

c = create_client(chain=studionet, account=Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"]))
results = json.load(open(os.path.join(os.path.dirname(__file__), "..", "docs", "p1_transfer_test_results.json")))
contract_addr = results["contract"]

# Check contract balance
bal = int(c.get_balance(contract_addr))
print(f"Contract {contract_addr} native: {bal/1e18} GEN")

# Check D pattern main txs (now that time has passed, triggered txs should exist)
d_txs = [r["tx"] for r in results["results"] if r["pattern"] == "D"]
print(f"D pattern main txs: {len(d_txs)}")
for tx_id in d_txs:
    r = c.get_transaction(tx_id)
    sn = r.get("status_name")
    rn = r.get("result_name")
    triggered = r.get("triggered_transactions") or []
    print(f"  {tx_id[:24]}... status={sn} result={rn} triggered={len(triggered)}")
    for th in triggered:
        tr = c.get_transaction(th)
        cd = tr.get("consensus_data") or {}
        lr = (cd.get("leader_receipt") or [{}])[0]
        res_raw = lr.get("result", "")
        if isinstance(res_raw, dict):
            raw = res_raw.get("raw", "")
        else:
            raw = res_raw
        try:
            msg = base64.b64decode(raw).decode() if raw else "(empty)"
        except Exception:
            msg = str(res_raw)[:100]
        print(f"    TRIG {th[:24]}... status={tr.get('status_name')} result={tr.get('result_name')} exec={lr.get('execution_result')} to={tr.get('to_address','')[:14]} val={tr.get('value')} credited={tr.get('value_credited')}")
        print(f"      msg={msg[:100]}")

# Check all A/B/C main txs to confirm they are truly FAILED (not just not yet done)
print("\n--- A/B/C pattern check ---")
for r in results["results"]:
    if r["pattern"] in ("A", "B", "C"):
        tx = c.get_transaction(r["tx"])
        lr_msg = tx.get("consensus_data",{}).get("leader_receipt",[{}])[0].get("execution_result","?")
        print(f"  {r['pattern']}/{r['account']}: {tx.get('status_name')}/{tx.get('result_name')} exec={lr_msg}")
