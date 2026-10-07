"""Verify the LIVE GitHub Pages bundle bakes the final contract address.

base: "./" means index.html references ./assets/*.js, and the contract address
lives in a dynamically-imported (code-split) chunk, not the entry. So this
crawls every asset js referenced by index.html OR by any fetched js (bounded),
greps each for the NEW and OLD addresses, and reports per-asset hits. Read-only
GETs of public static files. No secrets.
"""
import os
import re
import urllib.request

SITE = "https://hoveiser.github.io/weatherquest/"
NEW = os.environ.get(
    "WQ_CONTRACT_ADDRESS", "0x6028EB222937cd0Bd881c85260E1e0F11330a0A3"
)
# Every prior deployment must be ABSENT from the published bundle.
OLD_ADDRESSES = [
    "0x599EA254e19f7427Db0B158123ED1A21f28538fe",
    "0x2d764187A908d1677510c5E7FE69e8e7C1810299",
    "0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72",
    "0x884974D0D16E087d925c690186687de9Ec2B20F9",
]
UA = {"User-Agent": "wq-live-bundle-check"}


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
            return r.status, r.read().decode("utf-8", "ignore")
    except Exception as e:
        return None, "ERR " + type(e).__name__ + " " + str(e)[:80]


def resolve(asset):
    a = asset.lstrip("./").lstrip("/")
    return SITE + a


status, html = get(SITE + "index.html")
print("index.html status:", status)
js = set(re.findall(r"assets/[A-Za-z0-9_-]+\.js", html))
print("assets referenced by index:", sorted(js))

fetched = set()
new_hits = []
old_hits = []
queue = list(js)
guard = 0
while queue and guard < 30:
    guard += 1
    name = queue.pop(0)
    if name in fetched:
        continue
    fetched.add(name)
    url = resolve(name)
    st, body = get(url)
    if st != 200:
        print("  FETCH FAIL", url, body)
        continue
    has_new = NEW in body or NEW.lower() in body.lower()
    present_old = [o for o in OLD_ADDRESSES if o in body or o.lower() in body.lower()]
    print("  %-40s status=%s bytes=%6d NEW=%s OLD=%s" % (
        name, st, len(body), has_new, present_old or False))
    if has_new:
        new_hits.append(name)
    if present_old:
        old_hits.append((name, present_old))
    # follow further chunk references inside this asset
    for deeper in re.findall(r"assets/[A-Za-z0-9_-]+\.js", body):
        if deeper not in fetched:
            queue.append(deeper)

print("assets crawled:", len(fetched))
print("contain NEW:", new_hits or "NONE")
print("contain OLD:", old_hits or "NONE")
print("VERDICT:", "PASS" if new_hits and not old_hits else "CHECK")
