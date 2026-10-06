"""Pre-commit secret scan. Loads this project's own .env values (never prints
them) and searches every file that would be staged for any of those secret
values. Excludes .git, node_modules, dist, __pycache__. Read-only."""
import os

vals = {}
with open(".env", encoding="utf-8", errors="ignore") as fh:
    for line in fh:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        if len(v) >= 16:
            vals[k] = v

print("env keys with long values:", list(vals.keys()))

skip = {".git", "node_modules", "dist", "__pycache__"}
hits = []
scanned = 0
for root, dirs, files in os.walk("."):
    dirs[:] = [d for d in dirs if d not in skip]
    for fn in files:
        p = os.path.join(root, fn)
        try:
            data = open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        scanned += 1
        for k, v in vals.items():
            if v in data:
                hits.append((p, k))

print("files scanned:", scanned)
print("SECRET VALUE LEAKS:", hits if hits else "NONE")
