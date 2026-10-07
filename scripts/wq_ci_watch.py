"""Poll GitHub Actions run status for the pushed commit until each workflow
finishes. Reads GITHUB_TOKEN from this project's own .env and never prints it.
Polls every 25s and prints one line per poll; stops if 3 consecutive polls show
no change (per the network rules)."""
import json
import os
import sys
import time
import urllib.request

SHA = sys.argv[1] if len(sys.argv) > 1 else "81b76c7"


def token():
    for line in open(".env", encoding="utf-8", errors="ignore"):
        line = line.strip()
        if line.startswith("GITHUB_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


tok = token()
if not tok:
    print("NO GITHUB_TOKEN in .env"); sys.exit(2)


def runs():
    url = ("https://api.github.com/repos/hoveiser/weatherquest/actions/runs"
           "?head_sha=" + SHA)
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + tok,
        "Accept": "application/vnd.github+json",
        "User-Agent": "wq-ci-watch",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    out = {}
    for w in d.get("workflow_runs", []):
        out[w["name"]] = (w["status"], w.get("conclusion"))
    return out


prev = None
same = 0
start = time.time()
while True:
    try:
        st = runs()
    except Exception as e:
        print("poll error:", type(e).__name__, str(e)[:80])
        time.sleep(25)
        continue
    line = " | ".join("%s: %s/%s" % (n, s, c) for n, (s, c) in sorted(st.items()))
    print("[%4ds] %s" % (int(time.time() - start), line or "no runs yet"))
    if st and all(s == "completed" for s, _ in st.values()):
        print("ALL COMPLETED")
        break
    if st == prev:
        same += 1
        if same >= 3:
            print("NO CHANGE x3, stopping for user check")
            break
    else:
        same = 0
    prev = st
    if time.time() - start > 600:
        print("600s watch window elapsed, still running")
        break
    time.sleep(25)
