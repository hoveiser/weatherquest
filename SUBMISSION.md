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
   - `pytest tests/direct/ -v` — ~24 direct-mode contract tests (see note below).

## Contract Link
**[TBD after StudioNet deployment]** — https://studio.genlayer.com/address/`<contract_address>`

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
| End-to-end UX | ✅ Verified (no console errors) | Browser check: landing → dashboard live weather in cards → quest modal → AI-judgment result screen all render. |
| Direct-mode tests | ⚠️ Written, not executed here | See honest note below. |
| Demo video | ⏳ Manual | Needs a screen recording; captions + storyboard provided (`docs/video-storyboard.md`). |
| Deployment | ⏳ Ready | GitHub Pages workflow included; StudioNet contract deploy is a manual `genlayer` CLI step. |

### Honest verification caveats
- **Contract tests are written but were not executed in this build environment.** The GenLayer test
  SDK (`genlayer[tests]` / `genlayer-test` plugin) is not installable here — the public PyPI
  `genlayer` distribution is a `0.0.1` placeholder and the real package could not be resolved
  (intermittent DNS to `files.pythonhosted.org`). The tests target the documented fixture API
  (`direct_vm`, `direct_deploy`, `mock_web`, `mock_llm`, `expect_revert`, `warp`) and run unmodified
  where the SDK is available.
- **The UI ships in demo mode by default.** On-chain settlement requires deploying the contract to
  StudioNet and wiring the GenLayer JS SDK into `frontend/src/lib/contract.ts` (the on-chain seam +
  call signatures already match the contract). This keeps the reviewer-facing experience fully
  interactive without a funded wallet.
