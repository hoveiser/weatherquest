"""Count and (only if it fits) write the portal reviewer reply.

The portal caps that reply at 950 characters and the reviewer forbids em dashes, so
the text lives here and the limit is enforced by code: an over-long draft exits
non-zero instead of being written out. The contract address is a separate portal
field, so it never appears.
"""
import io
import sys

TEXT = """Layered verification: a deterministic pre-filter reverts obvious attacks before LLM work; one LLM call returns a rubric (on_topic, concrete_action, manipulation, safe); the contract derives success, ignoring any model-supplied success key; per-level LEVEL_OBJECTIVE fails irrelevant text as off-topic and gibberish even at Low. Corpus: 34 attacks x2 on fresh wallets, 18 classes. 68 attack runs, 0 paid, 0 levels conquered (42 filtered, 26 rubric-refused); 14 legit runs accepted, 0 false rejects; 85 txs all MAJORITY_AGREE, median 23.9s to ACCEPTED. Payout display fixed at the root: the settlement line shows get_level_payout, the cumulative total is labeled separately, both checked live against the native delta. 238 direct tests pass; new: pre-filter table, 64-row derived-success table, ignored model keys, [LLM_ERROR] fail-closed, per-level payout view. Residual: the rubric still ends in an LLM answer; hardened, not proof. Commit b36e104.
"""

t = TEXT.strip()
print("chars:", len(t))
print("em/en dash:", any(c in t for c in "\u2014\u2013"))
print("has 0x:", "0x" in t)
if len(t) > 950:
    sys.exit("TOO LONG by %d" % (len(t) - 950))
io.open("docs/portal-reply.txt", "w", encoding="utf-8", newline="\n").write(t + "\n")
print("written to docs/portal-reply.txt")
