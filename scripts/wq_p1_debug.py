"""Compare get_code behavior on known-good contract vs test contract."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from eth_account import Account
from genlayer_py import create_client, studionet

c = create_client(chain=studionet, account=Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"]))

wq = "0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72"
test = "0xB6b201E6b0BBb8771855Fbf6bB4f5e275224Bdcd"

# get_code
code_wq = c.get_code(wq)
print(f"WQ code: type={type(code_wq)} len={len(code_wq) if code_wq else 0} truthy={bool(code_wq and code_wq != b'0x')}")

code_test = c.get_code(test)
print(f"TEST code: type={type(code_test)} len={len(code_test) if code_test else 0} truthy={bool(code_test and code_test != b'0x')}")

# Try read_contract on both
try:
    bal_wq = c.read_contract(wq, "contract_balance")
    print(f"WQ contract_balance: {bal_wq}")
except Exception as e:
    print(f"WQ read error: {e}")

try:
    bal_test = c.read_contract(test, "contract_balance")
    print(f"TEST contract_balance: {bal_test}")
except Exception as e:
    print(f"TEST read error: {e}")

# Try get_schema
try:
    schema_wq = c.w3.provider.make_request("gen_getContractSchema", [wq])
    print(f"WQ schema: {str(schema_wq.get('result',''))[:100]}")
except Exception as e:
    print(f"WQ schema error: {e}")

try:
    schema_test = c.w3.provider.make_request("gen_getContractSchema", [test])
    print(f"TEST schema: {str(schema_test.get('result',''))[:100]}")
except Exception as e:
    print(f"TEST schema error: {e}")

# Check the deployer's nonce at time of test contract deploy vs wq deploy
print(f"\nDeployer nonce now: {c.w3.eth.get_transaction_count(c.w3.eth.accounts[0] if hasattr(c.w3.eth, 'accounts') else Account.from_key(os.environ['GENLAYER_PRIVATE_KEY']).address)}")
