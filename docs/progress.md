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
