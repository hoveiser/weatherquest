"""P1.2 final: Deploy fixed transfer_test, fund, test all patterns."""
import base64, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
from eth_account import Account
from genlayer_py import create_client, studionet

PK = os.environ["GENLAYER_PRIVATE_KEY"]
ROOT = os.path.join(os.path.dirname(__file__), "..")
GEN = 10**18
TERMINAL = {"FINALIZED"}
ACCEPTED_OR_LATER = {"ACCEPTED", "FINALIZED"}

deployer = Account.from_key(PK)
client = create_client(chain=studionet, account=deployer)

def bal_gen(addr):
    return int(client.get_balance(addr)) / GEN

def decode_lr(r):
    cd = r.get("consensus_data") or {}
    lrs = cd.get("leader_receipt") or []
    lr = lrs[0] if lrs else {}
    res = lr.get("result", "")
    raw = res.get("raw","") if isinstance(res, dict) else res
    try:
        msg = base64.b64decode(raw).decode() if raw else "(empty)"
    except: msg = str(res)[:200]
    return lr, msg

def wait(tx_id, label, finalized=False, timeout=300):
    targets = TERMINAL if finalized else ACCEPTED_OR_LATER
    t0 = time.time(); last=None; same=0
    while time.time()-t0 < timeout:
        r = client.get_transaction(tx_id)
        sn = r.get("status_name")
        el = time.time()-t0
        print(f"  {label} t={el:.0f}s {sn}")
        if sn in targets: return r, round(el,1)
        if sn==last: same+=1
        else: last,same=sn,1
        if same>3: print(f"  STALL at {sn}"); return r,round(el,1)
        time.sleep(20)
    return client.get_transaction(tx_id), round(time.time()-t0,1)

# DEPLOY
print("=== DEPLOYING ===")
code = open(os.path.join(ROOT,"contracts","transfer_test.py"),"r").read()
tx_id = client.deploy_contract(code=code)
print(f"Deploy tx: {tx_id}")
r, _ = wait(tx_id, "deploy", finalized=True, timeout=180)
addr = r.get("to_address")
result_name = r.get("result_name")
lr, msg = decode_lr(r)
print(f"  status={r.get('status_name')} result={result_name} exec={lr.get('execution_result')} addr={addr}")
if not addr:
    print("NO ADDRESS - aborting"); sys.exit(1)

# Verify balance is tracked
native = bal_gen(addr)
try:
    cb = int(client.read_contract(addr, "contract_balance")) / GEN
except Exception as e:
    cb = f"ERROR: {e}"
print(f"  native_balance={native} GEN, contract_balance()={cb}")

# FUND 10 GEN
print("\n=== FUND 10 GEN ===")
fund = client.write_contract(addr, "deposit", value=10*GEN)
r, sec = wait(fund, "fund", finalized=True)
native_after = bal_gen(addr)
try:
    cb_after = int(client.read_contract(addr, "contract_balance")) / GEN
except Exception as e:
    cb_after = f"ERROR: {e}"
print(f"  native={native_after} contract_balance={cb_after}")

# TEST PATTERNS
fresh = Account.create()
signers = [("deployer", deployer, deployer.address), ("fresh", fresh, fresh.address)]
patterns = [
    ("pay_immediate","A"), ("pay_on_accepted","B"),
    ("pay_on_finalized","C"), ("pay_broken","D"),
]
results = []
for name, signer, saddr in signers:
    for method, plabel in patterns:
        before = bal_gen(saddr)
        print(f"\n--- {plabel}/{name} (bal={before:.4f}) ---")
        tx = client.write_contract(addr, method, account=signer)
        r, sec = wait(tx, f"{plabel}/{name}")
        lr, msg = decode_lr(r)
        triggered = r.get("triggered_transactions") or []
        after = bal_gen(saddr)
        delta = after - before
        info = {"pattern":plabel,"account":name,"tx":tx,"status":r.get("status_name"),
                "result":r.get("result_name"),"exec":lr.get("execution_result"),
                "msg":msg[:200],"triggered":triggered,"before":before,"after":after,"delta":round(delta,9)}
        results.append(info)
        print(f"  {info['status']}/{info['result']} exec={info['exec']} trig={len(triggered)} delta={delta:+.9f}")
        print(f"  msg={msg[:100]}")

# Wait for triggered txs (finalized pattern needs extra time)
print("\n=== WAITING 90s for triggered txs ===")
time.sleep(90)
# Recheck balances
print("=== FINAL BALANCE CHECK ===")
for name, _, saddr in signers:
    print(f"  {name}: {bal_gen(saddr):.6f} GEN")
print(f"  contract native: {bal_gen(addr):.6f}")
try:
    print(f"  contract_balance(): {int(client.read_contract(addr,'contract_balance'))/GEN:.6f}")
except: pass

# Check triggered txs
print("\n=== TRIGGERED TX DETAILS ===")
for info in results:
    for th in info.get("triggered",[]):
        try:
            tr = client.get_transaction(th)
            tlr, tmsg = decode_lr(tr)
            vc = tr.get("value_credited")
            print(f"  {info['pattern']}/{info['account']}: {tr.get('status_name')}/{tr.get('result_name')} exec={tlr.get('execution_result')} to={str(tr.get('to_address',''))[:14]} val={tr.get('value')} credited={vc} msg={tmsg[:60]}")
        except Exception as e:
            print(f"  ERROR: {e}")

out = os.path.join(ROOT, "docs", "p1_transfer_test_results.json")
json.dump({"contract":addr,"results":results}, open(out,"w"), indent=2)
print(f"\nWrote {out}")
print("DONE")
