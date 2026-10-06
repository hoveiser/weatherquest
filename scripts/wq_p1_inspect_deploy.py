"""Quick inspect: check the deploy tx details."""
import json, base64, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from eth_account import Account
from genlayer_py import create_client, studionet

c = create_client(chain=studionet, account=Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"]))
r = c.get_transaction("0x8f9f1bc5b625262839fe7f3a32e0d76b272f87dbd530769338c40b27b8f7a1bc")
print("status_name:", r.get("status_name"))
print("result_name:", r.get("result_name"))
print("tx_execution_result_name:", r.get("tx_execution_result_name"))
print("contract_address:", r.get("contract_address"))
dd = r.get("decoded_deploy_data")
print("decoded_deploy_data:", dd)
cd = r.get("consensus_data") or {}
lrs = cd.get("leader_receipt") or []
if lrs:
    lr = lrs[0]
    print("leader_exec:", lr.get("execution_result"))
    res = lr.get("result", "")
    if isinstance(res, dict):
        raw = res.get("raw", "")
    else:
        raw = res
    try:
        decoded = base64.b64decode(raw).decode()[:300] if raw else "(empty)"
    except Exception:
        decoded = str(res)[:300]
    print("leader_msg:", decoded)
print("all keys:", sorted(r.keys()))
