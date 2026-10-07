"""Verify the LIVE GitHub Pages bundle bakes the final contract address.

base: "./" means index.html references ./assets/*.js, and the contract address
lives in a dynamically-imported (code-split) chunk, not the entry. So this
crawls every asset js referenced by index.html OR by any fetched js (bounded),
greps each for the NEW and OLD addresses, and reports per-asset hits. Read-only
GETs of public static files. No secrets.
"""
import re
import urllib.request

SITE = "https://hoveiser.github.io/weatherquest/"
NEW = "0x2d764187A908d1677510c5E7FE69e8e7C1810299"
OLD = "0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72"
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
    has_old = OLD in body or OLD.lower() in body.lower()
    print("  %-40s status=%s bytes=%6d NEW=%s OLD=%s" % (name, st, len(body), has_new, has_old))
    if has_new:
        new_hits.append(name)
    if has_old:
        old_hits.append(name)
    # follow further chunk references inside this asset
    for deeper in re.findall(r"assets/[A-Za-z0-9_-]+\.js", body):
        if deeper not in fetched:
            queue.append(deeper)

print("assets crawled:", len(fetched))
print("contain NEW:", new_hits or "NONE")
print("contain OLD:", old_hits or "NONE")
print("VERDICT:", "PASS" if new_hits and not old_hits else "CHECK")
