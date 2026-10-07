"""Final StudioNet verification for the native-payout + relevance-gate rewrite.

1. Deploy the current contracts/weatherquest.py.
2. Fund the house with 30 GEN (payable deposit).
3. Run 6 complete_level cases on fresh throwaway wallets (gasless on StudioNet):
     - 3 GIBBERISH actions   -> relevance gate rejects them even on a Low tier
                                (success=false, no triggered transfer, 0 native delta)
     - 3 SENSIBLE actions    -> accepted, native GEN delivered to the wallet
                                (delta == payout == credit ledger entry)
   Each case records the consensus result and the wallet's real native balance
   delta so the claim "native GEN reaches the wallet" is verified, not asserted.

Blocking calls only, one printed line per poll, 5-minute hard cap per tx, and it
stops if a tx stalls at the same status more than 3 consecutive polls.
"""
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
CITY = "Istanbul"  # level 1 is free-form

GIBBERISH = [
    "asdf ghjk qwerty zxcv",
    "the cow moon 9999 banana",
    "zzzz zzzz zzzz qqqq",
]
SENSIBLE = [
    "Dress warmly and take shelter indoors",
    "Wait safely indoors until conditions improve",
    "Use proper gear and head to a warm shelter",
]


def get_bal(client, addr):
    try:
        return int(client.get_balance(addr))
    except Exception:
        return -1


def decode_lr(r):
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
    t0 = time.time()
    last = None
    same = 0
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
        if sn == "FINALIZED":
            return r, el
        if sn == last:
            same += 1
            if same >= MAX_SAME:
                print(f"  STALLED at {sn}")
                return r, el
        else:
            same = 0
            last = sn
        time.sleep(POLL)
    return client.get_transaction(tx_id), round(time.time() - t0, 1)


def run_case(client, addr, kind, action, idx):
    player = Account.create()
    pc = create_client(chain=studionet, account=player)
    before = get_bal(client, str(player.address))
    print(f"\n--- {kind.upper()} #{idx} player={player.address} action={action!r} ---")
    cl_tx = pc.write_contract(
        addr, "complete_level", args=[1, CITY, action, 10, 10]
    )
    print(f"  complete_level tx: {cl_tx}")
    print(f"  Explorer: https://explorer-studio.genlayer.com/tx/{cl_tx}")
    r, sec = wait_tx(pc, cl_tx, f"{kind}{idx}")
    lr, _msg = decode_lr(r)
    triggered = r.get("triggered_transactions") or []
    status = r.get("status_name")
    result = r.get("result_name")
    exec_ = lr.get("execution_result")

    trig_value = 0
    for th in triggered:
        try:
            tr = pc.get_transaction(th)
            if int(tr.get("value") or 0) > 0:
                trig_value = int(tr.get("value"))
        except Exception:
            pass

    # Poll the wallet's native balance for the transfer to settle.
    after = before
    for _ in range(6):
        a = get_bal(client, str(player.address))
        if a > before:
            after = a
            break
        after = a
        time.sleep(5)
    delta = after - before

    credit = 0
    try:
        cview = pc.read_contract(addr, "get_credit", args=[player.address])
        credit = int(str(cview.get("credit_atto", "0")))
    except Exception as e:
        print(f"  get_credit error: {e}")

    paid = delta > 0
    rec = {
        "kind": kind,
        "action": action,
        "player": str(player.address),
        "complete_level_tx": str(cl_tx),
        "status": status,
        "result": result,
        "exec": exec_,
        "triggered_count": len(triggered),
        "triggered_value_atto": trig_value,
        "native_delta_atto": int(delta),
        "native_delta_gen": delta / GEN,
        "credit_atto": credit,
        "seconds_to_FINALIZED": float(sec),
    }
    if kind == "gibberish":
        rec["verdict"] = "REJECTED_NO_PAYOUT" if (not paid and credit == 0) else "UNEXPECTED_PAYOUT"
    else:
        rec["verdict"] = "PAID_NATIVE" if (paid and delta == credit) else "PARTIAL"
    print(
        f"  status={status} result={result} exec={exec_} trig={len(triggered)} "
        f"delta={delta/GEN:.6f}GEN credit={credit/GEN:.6f}GEN -> {rec['verdict']}"
    )
    return rec


def main():
    pk = os.environ.get("GENLAYER_PRIVATE_KEY")
    if not pk:
        print("ERROR: GENLAYER_PRIVATE_KEY missing in this project's .env")
        sys.exit(1)

    deployer = Account.from_key(pk)
    print(f"Deployer: {deployer.address}")
    client = create_client(chain=studionet, account=deployer)

    print("\n=== DEPLOY (final: native emit + relevance gate) ===")
    code = open(os.path.join(ROOT, "contracts", "weatherquest.py"), "r", encoding="utf-8").read()
    tx_id = client.deploy_contract(code=code)
    print(f"Deploy tx: {tx_id}")
    print(f"Explorer: https://explorer-studio.genlayer.com/tx/{tx_id}")
    r, _ = wait_tx(client, tx_id, "deploy")
    addr = r.get("to_address")
    lr, _ = decode_lr(r)
    print(f"  status={r.get('status_name')} exec={lr.get('execution_result')} addr={addr}")
    if not addr:
        print("FATAL: deploy failed, no address")
        sys.exit(1)
    print(f"  CONTRACT_ADDRESS={addr}")

    print("\n=== FUND 30 GEN ===")
    fund_tx = client.write_contract(addr, "deposit", value=30 * GEN)
    print(f"Fund tx: {fund_tx}")
    r, _ = wait_tx(client, fund_tx, "fund")
    lr, _ = decode_lr(r)
    print(f"  status={r.get('status_name')} exec={lr.get('execution_result')}")
    print(f"  Contract native balance: {get_bal(client, addr)/GEN:.2f} GEN")

    cases = []
    for i, a in enumerate(GIBBERISH, 1):
        cases.append(run_case(client, addr, "gibberish", a, i))
    for i, a in enumerate(SENSIBLE, 1):
        cases.append(run_case(client, addr, "sensible", a, i))

    gib_rejected = sum(1 for c in cases if c["kind"] == "gibberish" and c["verdict"] == "REJECTED_NO_PAYOUT")
    sen_paid = sum(1 for c in cases if c["kind"] == "sensible" and c["verdict"] == "PAID_NATIVE")
    consensus_clean = all(
        c["result"] in ("MAJORITY_AGREE",) and c["exec"] == "SUCCESS" for c in cases
    )
    out = {
        "contract": str(addr),
        "deploy_tx": str(tx_id),
        "fund_tx": str(fund_tx),
        "house_balance_atto": get_bal(client, addr),
        "cases": cases,
        "summary": {
            "gibberish_rejected": f"{gib_rejected}/3",
            "sensible_paid_native": f"{sen_paid}/3",
            "consensus_clean_majority_agree_success": consensus_clean,
            "verdict": (
                "PASS" if gib_rejected == 3 and sen_paid == 3 and consensus_clean else "REVIEW"
            ),
        },
    }
    outpath = os.path.join(ROOT, "docs", "final_verify.json")
    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\n=== SUMMARY ===")
    print(json.dumps(out["summary"], indent=2))
    print(f"Evidence saved: {outpath}")


if __name__ == "__main__":
    main()
