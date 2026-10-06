"""Inspect more fields of the deploy tx to find the contract address."""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from eth_account import Account
from genlayer_py import create_client, studionet

c = create_client(chain=studionet, account=Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"]))
r = c.get_transaction("0x8f9f1bc5b625262839fe7f3a32e0d76b272f87dbd530769338c40b27b8f7a1bc")
# Show all interesting fields
for k in ["to_address", "recipient", "from_address", "sender", "data",
          "tx_data", "value", "nonce", "messages", "result", "value_credited"]:
    v = r.get(k)
    if v is not None:
        sv = str(v)
        print(f"{k}: {sv[:300]}")

# Try eth_getTransactionReceipt (EVM-style)
print("\n=== eth_getTransactionReceipt ===")
try:
    rec = c.w3.provider.make_request("eth_getTransactionReceipt", ["0x8f9f1bc5b625262839fe7f3a32e0d76b272f87dbd530769338c40b27b8f7a1bc"])
    print(json.dumps(rec.get("result"), indent=2, default=str)[:1000])
except Exception as e:
    print("ERROR:", e)
