# WeatherQuest — GenLayer Builder Program Submission

Copy-paste-ready text for the submission portal. Fields marked **[TBD]** are filled after
Task 7 deployment (they require the live contract + hosted frontend URLs).

---

## Name
WeatherQuest: Dynamic Risk RPG

## Tags
- **Primary:** Gaming
- **Tag 1:** Outcome Verification
- **Tag 2:** Source Verification

## One-liner (≤ 180 chars)
> AI-driven RPG where real-world weather sets the risk multiplier and validates player actions for dynamic GEN payouts.

*(118 chars)*

## Description (≤ 1000 chars)
> WeatherQuest is a text-based RPG where real-world weather determines quest difficulty and rewards. Players submit actions (e.g., "Run", "Drive") for quests in real cities. The contract fetches live weather data, uses AI to calculate a risk multiplier (1x-5x), and judges if the action is safe. Success = Base Reward × Multiplier paid in GEN. Features fail-closed design, comprehensive validation, and a polished cyberpunk UI with live risk meters and AI reasoning display.

*(497 chars)*

## Expected Verification Outcome (≤ 500 chars)
> Steward will: 1) Visit the live frontend, 2) Create a test quest, 3) Submit an action and see AI judgment, 4) Run contract tests (pytest), 5) Verify the deployed contract on the StudioNet explorer.

*(238 chars)*

## Instructions (step-by-step)
1. Visit the live demo: **[frontend URL — TBD]**
2. Connect a wallet, or just use **demo mode** (default — no wallet or gas needed).
3. Browse the active quests and watch the **live risk meters** populate from real Open-Meteo weather.
4. Click a quest, review the weather analysis + projected payout, and type an action under **"Your action"**.
5. Submit for AI judgment and view the result screen (success/fail, multiplier at resolve, payout, AI reasoning, tx link).
6. Try the create-quest flow (`#/create`) to see validation + a live weather preview as you type a city.
7. **For developers:** clone the repo and:
   - `genvm-lint check contracts/weatherquest.py` — static lint + GenVM validation (**passes**).
   - `pytest tests/direct/ -v` — **22 direct-mode contract tests, all passing**.
     Setup (see README §6): `pip uninstall -y genlayer` (the public `genlayer` 0.0.1
     placeholder shadows the real SDK), then `pip install genlayer-py==0.16.3 genlayer-test==0.29.2`.

## Contract Link
https://studio.genlayer.com/address/`0x0B648Bd000cAfb84855fE681A584339ca31d8894`
— **DEPLOYED to StudioNet** (tx `ACCEPTED`, validators `AGREE`; verified with `genlayer schema` and a
live `contract_balance` call). Redeploy script: `scripts/deploy.sh`.

## Website
**[frontend URL — TBD]**

## GitHub
https://github.com/hoveiser/weatherquest *(set the real repo name on creation)*

---

## What was actually built & verified

| Area | Status | Evidence |
|------|--------|----------|
| GenLayer contract | ✅ Complete | `contracts/weatherquest.py` — 9 methods; passes `genvm-lint check` (lint + validate). |
| Open-Meteo integration | ✅ Verified | Geocoding + forecast endpoints return the expected `results` / `current` shapes (confirmed live). |
| Logo / icon | ✅ Complete | `frontend/public/` — `logo.svg` + PNGs (512², 128, 64 favicon). |
| Cyberpunk React UI | ✅ Complete & builds | `npm run build` succeeds; dev server + Open-Meteo proxy confirmed serving. |
| Day/night visual distinction | ✅ Complete & verified | `lib/theme.ts` (`surfaceTheme(kind, isDay)`) drives sun/stars particles + gradients on `QuestCard`, `QuestDetailModal`, `WeatherParticles`; browser check confirmed Tokyo=night starfield, Dubai=day sun, no console errors. |
| End-to-end UX | ✅ Verified (no console errors) | Browser check: landing → dashboard live weather in cards → quest modal → AI-judgment result screen all render. |
| Direct-mode tests | ✅ Executed — 22/22 pass | `pytest tests/direct/` run in-environment after installing the real SDK (`genlayer-py`+`genlayer-test`). |
| Demo video | ✅ Produced | `media/demo.mp4` (1920×1080, ~86s) built with `ffmpeg` from captured frames + burned-in captions (`docs/captions.srt`). YouTube upload is manual. |
| Contract deployment | ✅ Deployed to StudioNet | Address `0x0B648Bd000cAfb84855fE681A584339ca31d8894`; `scripts/deploy.sh` reproduces it. |
| Frontend deployment | ⏳ Workflow ready | GitHub Pages workflow included; publish needs the repo URL + pushing `main` (manual). |

### Honest verification caveats
- **Direct-mode tests were executed and all 22 pass.** Two harness-only shims
  live in `conftest.py` (documented in README §6): the weather LLM mock returns
  the multiplier as a string (GenVM calldata has no `float`), and `warp()` also
  writes `gl.message_raw['datetime']` (the pinned `genlayer-test` warp patches
  `datetime.now()` but not the cached message datetime the contract's `_now()`
  reads). Neither changes on-chain behaviour.
- **The UI ships in demo mode by default.** On-chain settlement requires wiring the GenLayer JS SDK
  into `frontend/src/lib/contract.ts` and setting `VITE_ONCHAIN=true` + `VITE_CONTRACT_ADDRESS`
  (the contract is already deployed and the call signatures already match). This keeps the
  reviewer-facing experience fully interactive without a funded wallet.
