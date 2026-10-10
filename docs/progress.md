# Progress log: validator-consensus fix

Branch: `fix/validator-consensus`. Goal: stop `complete_level` validator timeouts /
NO_MAJORITY on studionet by making the weather multiplier deterministic, cutting to
one LLM call, and enforcing EXACT validator consensus on payout values.

## Preflight (DONE)
- WSL Ubuntu-24.04 venv `~/wqenv` created via tsinghua pip mirror (DNS was flaky on
  pypi files host). Installed: genvm-linter 0.11.0, pytest 9.1.1, genlayer-py 0.16.3,
  genlayer-test 0.29.2.
- `.env` confirmed gitignored. Deployer key present. No node/npm locally, so the
  production frontend build is deferred to GitHub Actions.

## Step A: contract rewrite (DONE)
- Deterministic integer risk math (`_snap_from_raw` -> `_risk_from_snapshot`); no LLM
  touches the multiplier.
- `CAMPAIGN_CITY_TABLE` with integer e5 coords for levels 2-10; skips geocoding so the
  forecast URL is byte-identical across validators. City strings verified to match
  `frontend/src/lib/maps.ts` byte-for-byte (Tromso via `\u00f8`).
- One LLM call (`_judge_action`) with prompt-injection wrapping/stripping.
- `_validate_submission` does self-consistency + EXACT tier/multiplier/success compare
  (no tolerance). `complete_level` binds levels 2-10 to the table city.
- Efficiency Perfect bonus capped 150 -> 120; step bounds optimal 1..500,
  actual >= optimal, actual <= 500. Payout = base * mult * eff // 10000.
- Tab indentation and the pinned runner hash line preserved. No em dashes in contract.
- `genvm-lint check`: Lint passed (3 checks), Validation passed, Methods 14 (8 view,
  6 write). (A newer runner hash is reported as FYI; we keep the pinned one.)

## Step A7: frontend sync (DONE)
- `frontend/src/lib/contract.ts` `efficiencyTier` Perfect 150 -> 120 (demo mirror now
  matches on-chain) and doc comment updated.
- `frontend/src/types.ts` efficiency comment 150 -> 120.

## Step B: tests (DONE)
- Rewrote `tests/direct/conftest.py`: deterministic weather presets
  CALM(Low,100) / WINDY(Medium,160) / STORM(Extreme,500), single judgment LLM mock.
- Rewrote `tests/direct/test_weatherquest.py`: deterministic payout assertions,
  table-city levels, wrong-city revert, step bounds, replay anti-cheat.
- Added `tests/direct/test_validator_logic.py`: loads the contract with a stubbed
  `genlayer` module to unit-test the pure helpers and the validator-side logic
  (self-consistency, exact compare, prompt-injection).
- Seed step: `~/.cache/gltest-direct/genvm-universal-v0.2.16.tar.xz` downloaded (the
  version that carries our pinned runner hash).
- Result: `pytest tests/direct/` -> 125 passed (79 validator-logic + 46 direct-mode).

## Step C: deploy (DONE)
- No npm/`genlayer` CLI in this env, so deployed via the py SDK (`genlayer_py`) using
  `scripts/wq_check.py`, `scripts/wq_deploy.py`, `scripts/wq_onchain.py` (kept in-repo;
  `scripts/deploy.sh` remains the CLI path).
- Funds gate (HARD RULE 2): deployer `0x3de43AA2...c506` holds 11147 GEN; old house had 19.85 GEN.
- NEW contract: `0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72`. Deploy tx
  `0xe1aa739a...d2b9` FINALIZED / MAJORITY_AGREE. Deployed schema shows 14 methods and the
  pinned runner header `py-genlayer:1jb45aa8...` (bytes verified from the deploy payload).
- Address updated in `.github/workflows/deploy-frontend.yml`, `README.md`, `SUBMISSION.md`,
  `frontend/src/App.tsx` comment.

## Step D: on-chain tests (DONE)
- Funded house: `deposit()` 2 GEN -> FINALIZED / MAJORITY_AGREE; contract_balance = 2.000 GEN.
- CRUX `complete_level(2, "Tokyo", "Set up a sturdy tent...", 10, 12)` -> PROPOSING -> COMMITTING ->
  ACCEPTED -> FINALIZED / **MAJORITY_AGREE** (the originally-failing method now reaches clean
  consensus).
- State proof: `has_completed_level(acct,2)=True`; `campaign_progress` completed [2],
  `campaign_payout_atto=144000000000000000` = 0.144 GEN; `contract_balance` dropped to 1.856 GEN
  (payout actually transferred). Payout = 0.12 base x 1.00x Tokyo-Low weather x 1.20x Perfect
  efficiency, matching the deterministic integer math exactly.
- Also `get_weather_multiplier("Tokyo")` reached FINALIZED / MAJORITY_AGREE (2-HTTP no-LLM path).

## Known divergence (documented, not hidden)
- `frontend/src/lib/weather.ts` `previewRisk()` is a heuristic UI meter and does NOT replicate the
  contract's exact integer risk bands, so a demo city's displayed multiplier may differ slightly from
  what the contract computes. It is explicitly non-authoritative (SUBMISSION caveat). Left unchanged
  because the frontend cannot be built/typechecked in this environment (no node), and the spec's
  concrete frontend syncs (efficiencyTier 120, byte-identical city strings) are already applied.

## Next
- Step E: build + publish the live site (GitHub Actions Pages bakes the new
  `VITE_CONTRACT_ADDRESS`). Requires merge/push to `main` -> public publish; confirm with user first.
- Step F: README/SUBMISSION already updated for the redeploy + 125 tests; final pass pending.

## Step E: live site (DONE)
- Merged fix commit `519ba98` fast-forward into `main` and pushed to origin (user-approved public publish).
- GitHub Actions both succeeded on the push: CI (lint + 125 direct tests + frontend build) and
  "Deploy frontend to GitHub Pages".
- Live URL https://hoveiser.github.io/weatherquest/ serves HTTP 200; the production bundle
  `assets/index-IGK0c39o.js` contains the NEW address and NOT the old one (verified by fetch).

## Step F: docs (DONE)
- README §10 and SUBMISSION Contract Link rewritten for the validator-consensus redeploy,
  new address, deploy/on-chain evidence, 125-test count, and Perfect 1.20x cap. Preview-heuristic
  divergence documented honestly.

---

# Progress log: payout-transfer fix (P1)

Goal: fix the failed payout transfer (house debited, player received nothing) and make the
UI/docs honest about what StudioNet can and cannot do.

## P1.1 evidence (DONE)
- Pulled all 14 triggered payout txs (13 from `docs/round_raw` + the user's example) via the SDK.
- 14/14 fail: `execution_result=ERROR`, `result_name=NO_MAJORITY`, `num_of_rounds=0`, leader
  receipt msg decodes to "Contract 0x... not found". Structure: from = weatherquest contract,
  to = player EOA, value = payout, `triggered_on=finalized`, `triggered_by` = parent complete_level.
- Evidence: `docs/p1_triggered_txs.json`.

## P1.2 minimal four-pattern test (DONE)
- `contracts/transfer_test.py` deployed to StudioNet (v3 `0xAbf8cACd...3772`), funded, tested
  A) immediate `emit_transfer`, B) `on=accepted`, C) `on=finalized`, D) the current broken
  `get_contract_at().emit_transfer`. Patterns A/B/C via `@gl.evm.contract_interface` are rejected by
  StudioNet validators with `exit_code 1`; pattern D reaches SUCCESS on the main tx but its triggered
  transfer still fails "Contract not found". No EOA native balance ever increased.
- Discovery: `balance: u256` as a storage field SHADOWS `gl.Contract.balance`; do not declare it.
- Discovery: on StudioNet the deployed address is in the deploy tx `to_address`, and `get_code()`
  returns empty for every contract (not a deployment check). Native balance moves only after FINALIZED.
- Evidence: `docs/p1_transfer_test_results.json`.

## P1.3 sibling + SDK comparison (DONE, SOURCE only)
- `devbounty-genlayer` uses the same `@gl.evm.contract_interface` EthSend pattern; their own test
  comment says it "does NOT prove the network moves value". `genlayer-freelance-escrow-arbitration`
  has the same broken `get_contract_at().emit_transfer` pattern. Both SOURCE-read only; no other
  project's credentials touched.

## P1.4 root cause + fix (DONE)
- Root cause: on this runner (pinned `py-genlayer:1jb45aa8...`) NEITHER emit_transfer path can
  deliver native GEN to an EOA on StudioNet.
- Fix: replaced all four `emit_transfer` calls with an internal credit ledger (`credits: TreeMap`,
  `total_credits_atto`, `_credit()`, view `get_credit()`). The house keeps the GEN; the payout is
  recorded per address and is withdrawable once the platform supports EthSend.
- `genvm-lint check`: ok, 15 methods (9 view, 6 write).
- `pytest tests/direct/`: 131 passed (125 original + 6 new credit-accounting tests). On Windows the
  pinned gltest loader crashes on temp-file unlink (fd 0 still open); `scripts/wq_run_tests.py`
  defers that unlink so the real assertions run. CI/Linux unaffected.
- NEW contract `0x2d764187A908d1677510c5E7FE69e8e7C1810299` (deploy tx `0xcb2a7df0...87eda0`,
  FINALIZED/SUCCESS). Funded 30 GEN (deposit tx `0xef9bbe5b...06590`). Real `complete_level(1,
  Istanbul, ...)` tx `0x46a7b795...67ed` -> FINALIZED / MAJORITY_AGREE / 64s / 0 triggered txs;
  `get_credit(player)` = 120000000000000000 atto (0.12 GEN = 0.1 base x 1.00 x 1.20 Perfect) and
  `contract_balance()` stayed 30.0 GEN. Evidence: `docs/p1_credit_verify.json`.
- Address updated in deploy workflow, README, SUBMISSION, `scripts/wq_round.py`, and the pwtest
  tools; old address kept only as "previous deployment".

## P1.5 honest limitation (applies)
- Native GEN to a wallet is NOT possible on StudioNet and was NOT verified on any testnet; the
  previous "it works on Testnet" claim is removed. The UI must not say "reward sent" (P2), and
  manual testnet steps are recorded in the final report.

---

# Progress log: settlement tx link (P2)

Goal: after a level settles, the player can open the settlement tx and see the payout state.
- `frontend/src/components/TxLink.tsx` renders the FULL 66-char hash as a link to
  `https://explorer-studio.genlayer.com/tx/<hash>` (`target=_blank`, `rel=noopener noreferrer`),
  a shortened visual is allowed only when the href, a `title` and a Copy button all carry the
  full hash.
- Verdict and payout are shown separately: the settlement tx shows "Verdict settled" and the
  payout path shows "Payout: pending / sent / failed". On StudioNet there is no triggered payout
  tx (the credit is an on-chain ledger entry), so the payout line reflects the credit state, never
  a false "reward sent".
- Playwright assertions in `tools/pwtest` check the link exists, its href contains the full
  66-char hash, and the payout status text matches the recorded state.

---

# Progress log: on-chain round on the final contract (P3)

Contract `0x2d764187A908d1677510c5E7FE69e8e7C1810299`, StudioNet. Evidence:
`docs/round_results.json` + `docs/round_raw/`. Harness `scripts/wq_round.py`; decoded leader
receipts via `scripts/wq_p3_report.py` / `scripts/wq_p3_stats.py` (no msgpack module, byte decode).

## P3 successes (DONE, 12 credited, all clean)
- Campaign levels 2..10 on one fresh throwaway account (`p3_L2_Tokyo` .. `p3_L10_Tromso`), plus
  level 1 Istanbul from 3 distinct fresh accounts (`p3_free_L1_Istanbul_{0,1,2}`). StudioNet is
  gasless so fresh accounts need no funding.
- 12/12 `FINALIZED` / `MAJORITY_AGREE`, 1 consensus round, 5/5 votes, exact payout
  (`base * multiplier * efficiency / 10000`), and the per-account `get_credit` delta equal to the
  payout (the recipient proof on StudioNet; native balance does not move by design).
- L10 Tromso (o-slash) and L9 Moscow completed on-chain from the fresh campaign account.
- L5 Singapore leader summary shows tropical conditions (hot, humid, overcast).

## P3 rejects (DONE, the least-tested path)
- Honest finding: a first attempt ran all reject cases while EVERY campaign city was Low tier
  (multiplier < 150). At Low tier `_judge_action` guidance is "approve essentially any reasonable
  action", and the deployed LLM APPROVED even the reckless and gibberish texts
  (`docs/round_raw/p3_reject0..4`, success=true, credited, level marked completed). That path is
  not a fund-moving risk (they paid exactly the agreed Low-tier amount) but it does NOT satisfy
  "success must be false", so it was re-run properly.
- To force genuine `success=false` the reject must land on a tier whose guidance rejects danger.
  No campaign level was Medium+ at the contract's table coords (all Low right now) and no city in
  a 74-city live scan reached High/Extreme. Level 1 is the free-form geocode path, so the rejects
  were run there against cities currently at Medium (`scripts/wq_reject_scan.py`).
- 6 reject cases (`p3r_reject0..5`) at Wellington(200), Tromso(180), San Juan(170), Guayaquil(170),
  Durban(160), Cabo San Lucas(150): each reached `FINALIZED` / `MAJORITY_AGREE`, 1 consensus
  round, 5/5 votes, `success=false`, `get_credit` delta 0, level NOT marked completed.
- Each was followed by a SAME-account safe-action retry on the same level, all 6 passed and
  credited EXACTLY: base 0.1 GEN x weather x 1.20 Perfect = 0.24 / 0.216 / 0.204 / 0.204 / 0.192 /
  0.18 GEN (derived weather multipliers 200/180/170/170/160/150 match the live tier exactly).
- Harness resilience added: submissions and status polls now ride out transient StudioNet 502 /
  invalid-JSON responses (the first round aborted on one); `scripts/wq_round.py` `_submit` /
  tolerant `wait_tx`.

## P3 get_weather_multiplier probes (DONE)
- `get_weather_multiplier("Tromso")` tx `0x5328b63f338afe46587c751c86ac13d225b9c8834ad29b4df39cff960a65b010`
  -> MAJORITY_AGREE, 1.30x (Low, 6C wind 27 Overcast).
- `get_weather_multiplier("Singapore")` tx `0x72f784db8ed806f1730e67f68edf02c664d0bbb86239a2bacdffb98b1b160e29`
  -> MAJORITY_AGREE, 1.20x (Low, 27C, 88% humidity, Overcast).

## P3 timing + success rate
- Time to ACCEPTED over the 18 credited successful runs (12 successes + 6 safe retries):
  min 21.6s, median 21.7s, max 42.7s.
- Clean consensus 18/18; exact payout 18/18; success rate 100% (no Validators Timeout, no
  NO_MAJORITY across the whole round). Consensus rounds 1-2; 5 validators voted every time.

---

# Progress log: preview matches the contract (P4)

Goal: `previewRisk` shows the SAME tier + multiplier as the contract settles, and the preview GEN
uses the contract payout formula.
- Exact integer port in `frontend/src/lib/risk.ts` (`snapFromWeather`, `codeClass`,
  `riskFromSnapshot`, `tierFromScore`, `tierFor`), a value-for-value mirror of `_snap_from_raw`,
  `_code_class`, `_risk_from_snapshot`. `frontend/src/lib/weather.ts` `previewRisk` delegates to it;
  no float heuristics remain in the preview path.
- `payoutGenExact` in `frontend/src/lib/maps.ts` computes `base * multiplier_x100 * eff_x100 /
  10000` in BigInt atto (Perfect 1.20x), used by the demo path and as the fallback in the on-chain
  path in `contract.ts` (which prefers the real settled credit `res.creditWei`).
- `frontend/tests/risk.test.mjs`: 10 `node:test` cases run the same boundary table as the Python
  direct tests (CALM 100 Low, WINDY 160 Medium, STORM clamp 500, every wind/precip/temp/code band
  edge, tier thresholds, payout identity incl L1 100x120 = 0.12 and L10 500x120 = 6). 10/10 pass
  under the bundled Node. `npm test` wired and added as a CI step.
- `tsc -b` exit 0 and `vite build` exit 0. Live-site preview-vs-payout screenshot verification is
  pending the Pages deploy in P6 (no `frontend/.env`; the deploy workflow injects
  `VITE_CONTRACT_ADDRESS`).

---

# Progress log: hygiene and docs (P6)

## Em dash removal (DONE)
- Scanned every tracked file for U+2014. 22 files carried 82 em dashes total; all replaced
  (hyphen, colon or a rewritten sentence). A clean re-scan of `git ls-files` reports 0 remaining.
- The two edited docs (`README.md`, `SUBMISSION.md`) were re-scanned after the rewrite and contain
  0 em dashes.

## Secret scan (DONE)
- Read the value of `GENLAYER_PRIVATE_KEY` from this project's own `.env` (never printed it) and
  searched every tracked and untracked file for that exact hex: it appears in NONE.
- The only hex-64 / token-word pattern hits are public chain data (tx_execution_hash, validator
  vote hashes, signed_rollup blobs under `docs/round_raw/`) and env-var NAMES in validator config
  (`LLM_ROUTER_API_KEY`, `OPENROUTERAPIKEY`), not values.
- `frontend/tsconfig.node.tsbuildinfo` was accidentally tracked; untracked it with
  `git rm --cached` (file kept on disk; `*.tsbuildinfo` is already in `.gitignore`).

## Docs numbers (DONE)
- README §11 preview caveat rewritten for the P4 exact port; §12 rewritten for the P3 round on the
  final contract `0x2d764187...0299`: 12 credited successes, 6 Medium `success=false` rejects each
  with a credited same-account safe retry, 2 multiplier probes; column header "Rotation" replaced
  with "Consensus rounds" (value 1 = MAJORITY_AGREE on the first round, no rotation); house funded
  to 30.0 GEN via `0xef9bbe5b...` and left at 30.0 (credits, not native transfers); timing min 21.6s
  / median 21.7s / max 42.7s over the 18 credited runs; honest note on the earlier Low-tier
  over-approving rejects. SUBMISSION.md updated to match and the unverified "native credit works on
  Testnet" claim removed.

## Final validation (DONE)
- `genvm-lint check contracts/weatherquest.py`: lint + validation pass, 15 methods (9 view, 6 write);
  pinned runner line unchanged.
- `pytest tests/direct/`: 131 passed.
- `node tests/risk.test.mjs`: 10/10 pass; `tsc -b` exit 0; `vite build` exit 0 with the final address
  baked in (local bundle contains `0x2d764187...0299`, not the old `0x8fc4bc48...`).

## Remaining
- Commit, push to main, wait for CI + Pages green, re-check the live bundle address, then the P5
  live-UI Playwright pass against the deployed final-contract bundle.

## P6 push + deploy (DONE)
- Committed `81b76c7` and pushed to `main` (user declined the optional pre-push deep review).
- GitHub Actions both green for `81b76c7`: "Deploy frontend to GitHub Pages" success, and
  "CI - Regression Tests" (genvm-lint + 131 direct tests + frontend `npm test` + build) success.
- Live bundle re-checked (`scripts/wq_live_bundle.py`): the served entry chunk
  `assets/index-DvlQZpse.js` (HTTP 200) contains `0x2d764187A908d1677510c5E7FE69e8e7C1810299` and
  NOT the old `0x8fc4bc48...`.

---

# Progress log: live UI + preview match (P5, and the P4 live check)

Ran `tools/pwtest/onchain_write.mjs` (bundled Node + chromium) against the LIVE
https://hoveiser.github.io/weatherquest/ with an injected EIP-1193 provider backed by a fresh
throwaway key (generated in-test, never printed, never from `.env`). Screenshots under `docs/`:
`ui-13-gate-preview.png`, `ui-10-onchain-verdict.png`, `ui-12-settlement-proof.png`,
`ui-11-onchain-unlocked.png`; report `docs/ui-onchain-report.json`; RPC cross-check
`docs/p5_ui_onchain_verify.json`.

- Selector fixes made this pass (test-only, no product change): the connected address chip lives in
  the in-game `HUD` (not the menu, which only shows a "Disconnect" button), so the chip assertion
  moved to after entering the level; `Gate Unlocked` is read from the verdict modal (before it
  closes) instead of after clicking "Open the gate".
- Live-UI on-chain settlement (final run) tx `0x827d04f838cd410dd8a2bd3ffb769806c10050db9ee36c919b6d0803a1c3d43e`:
  independently confirmed via StudioNet RPC `FINALIZED` / `MAJORITY_AGREE` / 1 consensus round /
  votes [agree, agree, agree, idle, idle]. `get_credit(signer)` = 120000000000000000 atto = 0.12 GEN
  for a throwaway account that started at 0, so the recipient on-chain credit change = +0.12 GEN.
  (Two earlier UI runs in this session settled `0x94cd8997...` and `0xa2ecb17b...`, both also
  FINALIZED / MAJORITY_AGREE / 1 round / +0.12 credit.)
- P5 UI assertions all green: 0 console errors; connected + menu "Disconnect" shown; address chip
  present and matching the signer short address; gate opened; Quest Passed; full-66 explorer href;
  `target=_blank` + `rel=noopener noreferrer`; clicking opened the explorer popup; separate
  "Payout: 0.1200 GEN credited on-chain (StudioNet cannot send native GEN to the wallet)" line with
  no "reward sent" wording; `Gate Unlocked` shown.
- P4 live check: the same run's modal preview badge showed `1.0x · Low` and the settlement showed
  `x 1.0 risk multiplier` and `~0.12 GEN`, so the client `previewRisk` matched the on-chain payout
  for the same run. Note the live level-1 city is IP-resolved (the test runner resolved London, not
  Istanbul); the Istanbul equivalence is covered by the SDK runs `p3_free_L1_Istanbul_*` (0.12 GEN,
  multiplier 1.00) and the 10/10 boundary unit tests.
- Honest limitation unchanged: StudioNet cannot move native GEN to the EOA, so the recipient
  "balance change" measured here is the on-chain per-address credit, not an EOA native delta.
  **SUPERSEDED (later round):** that conclusion was wrong, and the line quoted above ("StudioNet
  cannot send native GEN to the wallet") is historical. The blocker was the API, not the network:
  `gl.get_contract_at(eoa).emit_transfer(...)` no-ops against an address with no intelligent
  contract, while a `@gl.evm.contract_interface` recipient with `value=` does move native GEN.
  Recipient EOA balances are now credited on StudioNet and the measured native delta equals the
  payout (README §11, `docs/final_verify.json`).

## Round: layered action verification + per-level payout display + adversarial corpus (current contract `0x8b317B94...`)

Reviewer finding that started this round: a prompt-injection action was paid 0.1 GEN on
`0x6028EB22...` (tx `0x2ee4ec3a...`), and the UI could show a cumulative credit as if it were one
level's prize.

- Contract: `_prefilter_action` (deterministic, reverts `[EXPECTED]` before any network or LLM
  work), a 4-key rubric from ONE LLM call with `success` derived on-chain (a model-supplied
  `success` is ignored), `LEVEL_OBJECTIVE` for levels 1-10, a hardened prompt (trusted instructions
  first, the action delimited as data, three short adversarial examples), plus the money views
  `get_level_payout` / `get_total_credit` / `get_global_stats`, and a `campaign_progress` that no
  longer returns a contract-wide counter. `genvm-lint check`: ok, 18 methods (12 view, 6 write).
- Deploy: `0x8b317B94AF764e9de587805d264CbBea59Ce3aE2`, deploy tx `0x46acbc55...48dedb` FINALIZED /
  MAJORITY_AGREE in 48.5 s, house funded 30 GEN via `0x0056cd40...23b3a6` (read back 30.0000 GEN).
- Frontend: `lib/payout.ts` labels every GEN figure by class; the settlement screen shows THIS
  level's payout, the native balance before/after, and a separately labelled total. 238 direct
  tests + 21 frontend unit tests pass; `tsc --noEmit` and `vite build` exit 0.
- Adversarial corpus (`tests/adversarial_corpus.json`: 34 attacks over 18 classes, 12 legitimate
  controls): 68 attack runs on two fresh wallets paid 0 and conquered 0 levels (42 stopped by the
  pre-filter, 26 refused by the rubric); 14 legitimate runs all accepted, 0 false rejects; all 85
  txs FINALIZED / MAJORITY_AGREE / 5 votes; time to ACCEPTED min 1.2 s, median 23.9 s, max 48.3 s;
  one multi-round outlier (`p1.a32`, 4 rounds, still refused).
- Ledger audit `scripts/wq_corpus_ledger_audit.py`: each corpus wallet's credit equals the sum of
  its observed deltas and its native balance equals 1 GEN funding plus that total; the 7
  attack-only wallets hold 0 credit. 4.625 GEN credited overall, all of it legitimate.
  `VERDICT: PASS`.
- Live UI: the levels 1-3 per-level payout proof (wallet `0xb71860c6...`) and the injection ladder
  (wallet `0xd43a94fa...`), each re-verified app-free through the SDK, screenshots under `docs/`.
- Publish: CI run 38020058932 and Pages run 38020058953 both green; the live entry chunk
  `assets/index-DkkQx3RP.js` (sha256 prefix `ece00e486e7da869`) carries the new address and none of
  the five previous deployments, and is byte-identical to the local build the live-UI proofs ran.
- Two harness bugs surfaced while writing the audits and fixed here:
  `scripts/wq_round.py::campaign_payout` read a contract-wide key that `campaign_progress` no
  longer returns (so it silently returned 0), and the corpus summary's `by_class` relied on a loop
  variable leaking out of a print loop. No recorded payout claim depended on either.
