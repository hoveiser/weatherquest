"""Secret and dash scan for the repo (reviewer hard rules: credentials only in this
project's .env, never printed; no em dashes anywhere).

Usage: python scripts/wq_secret_scan.py

Checks, printing only file paths, line numbers, key NAMES and lengths, never any
matched value (a value must never reach stdout, a log or a command line here):
  1. .env is ignored by git and no env/key file is tracked
  2. no 64-hex private-key-looking literal appears in any tracked text file
  3. no "key = <literal>" style credential assignment outside .env.example / docs
  4. no em dash (U+2014) or en dash (U+2013) in any tracked text file
  5. no value from this project's .env appears in any file except .env itself
  6. no value from this project's .env appears in any object ever written to git,
     which is the only check that can say anything about commits already pushed
Exit code 0 only if all six are clean.
"""
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
os.chdir(ROOT)

tracked = subprocess.check_output(["git", "ls-files"], text=True).split()
ignored = subprocess.call(["git", "check-ignore", "-q", ".env"]) == 0

HEXKEY = re.compile(r"(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])")
ASSIGN = re.compile(
    r"(?i)(private[_ -]?key|secret[_ -]?(access|key)|api[_ -]?key|seed[_ -]?phrase|mnemonic)"
    r"\s*[:=]\s*[\"']?([A-Za-z0-9+/=_-]{12,})"
)
DASH = re.compile(u"[\u2014\u2013]")
# contract / address hashes are legitimate; only flag 64-hex strings that look like a
# key by context (an assignment nearby or a key-ish filename), so the raw hash scan is
# reported separately from the credential scan.
ALLOWED_HEX_CONTEXT = re.compile(
    r"(?i)(tx|hash|0x[0-9a-f]{40}|deploy|settlement|runner|receipt|commit|sha)")

problems = []
print("tracked files:", len(tracked))
print("1) .env ignored by git:", "YES" if ignored else "NO - PROBLEM")
if not ignored:
    problems.append(".env is not git-ignored")
tracked_env = [f for f in tracked if f.endswith((".env", ".pem", ".p12", ".key"))
               or os.path.basename(f) in (".env",)]
print("   tracked env/key files:", tracked_env or "none")
if tracked_env:
    problems.append("tracked credential-shaped files: %s" % tracked_env)

hex_hits = []
cred_hits = []
dash_hits = []
skipped_binary = 0
for f in tracked:
    p = os.path.join(ROOT, f)
    if not os.path.isfile(p):
        continue
    try:
        with open(p, "r", encoding="utf-8") as h:
            text = h.read()
    except (UnicodeDecodeError, OSError):
        skipped_binary += 1
        continue
    if os.path.basename(f) == ".env.example":
        continue  # placeholder file by design, values are placeholders only
    for ln, line in enumerate(text.splitlines(), 1):
        if HEXKEY.search(line) and not ALLOWED_HEX_CONTEXT.search(line):
            hex_hits.append("%s:%d (%d hex chars)" % (f, ln, len(HEXKEY.search(line).group(0))))
        m = ASSIGN.search(line)
        if m:
            cred_hits.append("%s:%d marker=%s value-length=%d" % (f, ln, m.group(1), len(m.group(3))))
        if DASH.search(line):
            dash_hits.append("%s:%d" % (f, ln))

print("2) unexplained 64-hex literals (non tx/address context):", hex_hits or "none")
print("3) credential-shaped assignments:", cred_hits or "none")
print("4) em/en dash occurrences:", dash_hits or "none")
print("   (binary/non-utf8 files skipped: %d)" % skipped_binary)
problems += ["unexplained hex literal: %s" % h for h in hex_hits]
problems += ["credential literal: %s" % c for c in cred_hits]
problems += ["dash: %s" % d for d in dash_hits]

# ---- 5/6: the real .env values, searched for but never echoed ----
ENV_PATH = os.path.join(ROOT, ".env")
SKIP_DIRS = {".git", "node_modules", "dist", "__pycache__"}


def env_values():
    """Long-enough values from this project's own .env, keyed by env var name."""
    out = {}
    if not os.path.isfile(ENV_PATH):
        return out
    with open(ENV_PATH, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            if len(v) >= 16:
                out[k.strip()] = v
    return out


vals = env_values()
print("5) .env keys with values long enough to be a secret:", sorted(vals.keys()) or "none")

work_hits = []
work_scanned = 0
for root, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for fn in files:
        fp = os.path.join(root, fn)
        if os.path.abspath(fp) == os.path.abspath(ENV_PATH):
            continue  # the values legitimately live here
        try:
            data = open(fp, "rb").read()
        except OSError:
            continue
        work_scanned += 1
        for k, v in vals.items():
            if v.encode("utf-8") in data:
                work_hits.append("%s key=%s" % (os.path.relpath(fp, ROOT), k))
print("   files scanned (excluding .env itself):", work_scanned)
print("   .env value leaks in the working tree:", work_hits or "none")
problems += ["working-tree leak: %s" % h for h in work_hits]

hist_hits = []
blobs = 0
if vals:
    # --batch reads every object in the repo, so a value that was ever committed (even
    # in a commit that is now amended away but still in a pushed branch) is caught.
    proc = subprocess.Popen(["git", "cat-file", "--batch-all-objects", "--batch"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    buf = proc.stdout.read()
    proc.wait()
    # records are separated by newlines: "<sha> blob <size>\n<content>\n"
    i = 0
    while i < len(buf):
        nl = buf.find(b"\n", i)
        if nl < 0:
            break
        head = buf[i:nl].split()
        if len(head) < 3 or head[1] != b"blob":
            i = nl + 1
            continue
        size = int(head[2])
        content = buf[nl + 1: nl + 1 + size]
        blobs += 1
        for k, v in vals.items():
            if v.encode("utf-8") in content:
                hist_hits.append("blob %s key=%s" % (head[0].decode(), k))
        i = nl + 1 + size + 1
print("6) git objects scanned:", blobs)
print("   .env value leaks anywhere in git history:", hist_hits or "none")
problems += ["history leak: %s" % h for h in hist_hits]

print("")
print("SCAN:", "CLEAN" if not problems else "PROBLEMS (%d)" % len(problems))
sys.exit(0 if not problems else 1)
