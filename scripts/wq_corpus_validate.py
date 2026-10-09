"""Offline validator for tests/adversarial_corpus.json (no network, no consensus).

The expected layer of every corpus item is computed with a faithful mirror of the
DEPLOYED pre-filter, and the constants of that mirror are parsed straight out of
contracts/weatherquest.py instead of being retyped here, so this check cannot drift
away from the contract. It answers, before a single transaction is spent:
  - are the ids unique, are there >= 24 attacks and >= 10 legit actions,
  - is every class the reviewer listed actually present,
  - which items the deterministic layer-1 gate reverts and which one reaches the LLM
    rubric, and does that match the layer each item claims in the file,
  - does every legitimate action survive the gate (a legit action blocked by the
    pre-filter would be a false reject waiting to happen).

Exit code 0 means the corpus is internally consistent. This file makes no claim
about what the validators will decide; that is measured on chain by
scripts/wq_adversarial_corpus.py.
"""
import ast
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CONTRACT = os.path.join(ROOT, "contracts", "weatherquest.py")
CORPUS = os.path.join(ROOT, "tests", "adversarial_corpus.json")

# --- constants lifted from the contract source --------------------------------
src = io.open(CONTRACT, encoding="utf-8").read()
tree = ast.parse(src)
CONST = {}
for node in tree.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if isinstance(t, ast.Name) and t.id in (
                "ACTION_MIN", "ACTION_MAX", "ACTION_MIN_WORDS", "ACTION_REPEAT_RUN",
                "ACTION_BLOCKED_CHARS", "ACTION_INVISIBLE", "ACTION_BLOCKED_PHRASES",
            ):
                try:
                    CONST[t.id] = ast.literal_eval(node.value)
                except ValueError:
                    pass
missing = {
    "ACTION_MIN", "ACTION_MAX", "ACTION_MIN_WORDS", "ACTION_REPEAT_RUN",
    "ACTION_BLOCKED_CHARS", "ACTION_INVISIBLE", "ACTION_BLOCKED_PHRASES",
} - set(CONST)
if missing:
    print("FATAL: could not read these constants from the contract:", sorted(missing))
    sys.exit(1)
print("contract constants:",
      "MIN=%d MAX=%d WORDS=%d REPEAT_RUN=%d BLOCKED_CHARS=%s PHRASES=%d"
      % (CONST["ACTION_MIN"], CONST["ACTION_MAX"], CONST["ACTION_MIN_WORDS"],
         CONST["ACTION_REPEAT_RUN"], CONST["ACTION_BLOCKED_CHARS"],
         len(CONST["ACTION_BLOCKED_PHRASES"])))


def prefilter(action):
    """Mirror of _prefilter_action in contracts/weatherquest.py, in the same order.
    Returns None when the action reaches the LLM, else the revert reason."""
    s = str(action)
    for ch in s:
        o = ord(ch)
        if o < 32 or o == 127:
            return "control characters"
        if ch in CONST["ACTION_INVISIBLE"]:
            return "invisible characters"
    for ch in s:
        if ch < " " or ch > "~":
            return "printable ASCII only"
        if ch in CONST["ACTION_BLOCKED_CHARS"]:
            return "blocked character"
    if len(s) < CONST["ACTION_MIN"] or len(s) > CONST["ACTION_MAX"]:
        return "length %d..%d" % (CONST["ACTION_MIN"], CONST["ACTION_MAX"])
    words = 0
    for tok in s.split():
        for c in tok:
            if ("a" <= c <= "z") or ("A" <= c <= "Z"):
                words += 1
                break
    if words < CONST["ACTION_MIN_WORDS"]:
        return "needs %d words" % CONST["ACTION_MIN_WORDS"]
    run_char, run_len = "", 0
    for ch in s:
        run_len = run_len + 1 if ch == run_char else 1
        run_char = ch
        if run_len >= CONST["ACTION_REPEAT_RUN"]:
            return "repeated-character padding"
    letters = "".join(c for c in s.lower() if "a" <= c <= "z")
    for phrase in CONST["ACTION_BLOCKED_PHRASES"]:
        if phrase in letters:
            return "blocked instruction text (%s)" % phrase
    return None


with io.open(CORPUS, encoding="utf-8") as f:
    corpus = json.load(f)

attacks = corpus["attacks"]
legit = corpus["legit"]
errors = []
ids = [a["id"] for a in attacks] + [l["id"] for l in legit]
if len(ids) != len(set(ids)):
    errors.append("duplicate ids")
for a in attacks:
    for key in ("id", "class", "action", "layer_expected"):
        if key not in a:
            errors.append("%s missing %s" % (a.get("id"), key))
if len(attacks) < 24:
    errors.append("only %d attacks, need 24" % len(attacks))
if len(legit) < 10:
    errors.append("only %d legit actions, need 10" % len(legit))
present = sorted({a["class"] for a in attacks})
declared = sorted(corpus["classes"])
if present != declared:
    errors.append("classes present %s != declared %s" % (present, declared))
required = {
    "direct_override", "fake_json_verdict", "fake_role_system_message",
    "delimiter_break", "hidden_instruction", "authority_approval",
    "prompt_exfiltration", "multilingual", "encoded_text", "homoglyph",
    "zero_width", "padded_text", "length_overflow", "emoji_only", "empty_like",
    "gibberish", "irrelevant_harmless", "reckless_action",
}
absent = required - set(present)
if absent:
    errors.append("classes not covered: %s" % sorted(absent))

print("\n--- attacks (%d) ---" % len(attacks))
counts = {"prefilter": 0, "llm": 0}
for a in attacks:
    hit = prefilter(a["action"].strip() if a["class"] != "empty_like" else a["action"])
    layer = "prefilter" if hit else "llm"
    counts[layer] += 1
    flag = ""
    if layer != a["layer_expected"]:
        flag = "  << file says %s" % a["layer_expected"]
        errors.append("%s expected %s, gate says %s" % (a["id"], a["layer_expected"], layer))
    print("  %-4s %-26s %-9s len=%-4d %s%s"
          % (a["id"], a["class"], layer, len(a["action"]), hit or "reaches the rubric", flag))

print("\n--- legitimate actions (%d) ---" % len(legit))
for l in legit:
    hit = prefilter(l["action"])
    print("  %-4s L%-2d %-16s len=%-4d %s"
          % (l["id"], l["level"], l["city"], len(l["action"]),
             "PASS the gate, goes to the rubric" if hit is None else "BLOCKED: " + hit))
    if hit is not None:
        errors.append("%s legitimate action is blocked by the pre-filter: %s" % (l["id"], hit))
    if len(l["action"]) < 12 or len(l["action"]) > 200:
        errors.append("%s length %d outside 12..200" % (l["id"], len(l["action"])))

style_lengths = sorted(len(l["action"]) for l in legit)
print("\nlegit length spread: min %d, max %d; distinct levels: %s"
      % (style_lengths[0], style_lengths[-1], sorted({l["level"] for l in legit})))
if len({l["level"] for l in legit}) < 5:
    errors.append("legit actions cover fewer than 5 levels")

print("\nattacks blocked by the deterministic gate: %d" % counts["prefilter"])
print("attacks that reach the LLM rubric:          %d" % counts["llm"])
if errors:
    print("\nERRORS:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nCORPUS OK")
