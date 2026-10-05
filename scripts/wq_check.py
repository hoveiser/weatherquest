"""Read-only studionet balance check for the WeatherQuest deployer.

Loads GENLAYER_PRIVATE_KEY from the project .env (never prints it), connects to
StudioNet, and prints:
  - the deployer address and its GEN balance
  - the OLD contract's on-chain GEN balance (the campaign house)
This satisfies the pre-deploy "confirm funds" gate. It performs NO writes.
"""
import os
import sys

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

pk = os.environ.get("GENLAYER_PRIVATE_KEY")
if not pk:
    print("NO KEY in .env")
    sys.exit(2)

from eth_account import Account
import genlayer_py
from genlayer_py import create_client, studionet

OLD = "0x884974D0D16E087d925c690186687de9Ec2B20F9"

acct = Account.from_key(pk)
print("deployer:", acct.address)

client = create_client(chain=studionet, account=acct)
try:
    bal = int(client.get_balance(acct.address))
    print("deployer GEN: %.6f" % (bal / 1e18))
    obal = int(client.get_balance(OLD))
    print("old contract GEN: %.6f" % (obal / 1e18))
finally:
    try:
        client.w3.provider.make_request  # touch to ensure provider initialized
    except Exception:
        pass
