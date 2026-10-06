"""Check if contract_balance matches the native balance for the test contract."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from eth_account import Account
from genlayer_py import create_client, studionet

GEN = 10**18
c = create_client(chain=studionet, account=Account.from_key(os.environ["GENLAYER_PRIVATE_KEY"]))
addr = "0xB6b201E6b0BBb8771855Fbf6bB4f5e275224Bdcd"

native = int(c.get_balance(addr))
print(f"Native balance of contract: {native / GEN} GEN")

# Also check the weatherquest contract for comparison
wq = "0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72"
native_wq = int(c.get_balance(wq))
print(f"Native balance of weatherquest: {native_wq / GEN} GEN")
wq_read = int(c.read_contract(wq, "contract_balance"))
print(f"contract_balance() of weatherquest: {wq_read / GEN} GEN")

# The test contract balance
try:
    tc_read = int(c.read_contract(addr, "contract_balance"))
    print(f"contract_balance() of test contract: {tc_read / GEN} GEN")
except Exception as e:
    print(f"test contract_balance() error: {e}")
