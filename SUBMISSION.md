# WeatherQuest - GenLayer Builder Program Submission

Copy-paste-ready text for the submission portal. The frontend is now published to GitHub Pages and
verified live; the only remaining **[TBD]** is the demo-video YouTube upload (a manual step).

---

## Name
WeatherQuest - WeatherGate: AI-Gated 2D Weather RPG

## Tags
- **Primary:** Gaming
- **Tag 1:** Outcome Verification
- **Tag 2:** Source Verification

## One-liner (≤ 180 chars)
> 2D top-down RPG where real-world weather sets the risk multiplier and an on-chain AI validator judges your move - brave actions in brutal storms pay bigger GEN.

*(160 chars)*

## Description (≤ 1000 chars)
> WeatherQuest: WeatherGate is a 2D top-down mini RPG you play in the browser (Kaboom.js + Framer Motion). Steer a hero with WASD/arrows past a river and a wall to a Magic Gate. Touching it pauses the game and opens an AI Gate modal showing the target city's live Open-Meteo weather and a 1.0x–5.0x risk multiplier. Pick an Action Card (Build a Raft / Swim Across / Use Weather Magic) or type your own move, then submit. A GenLayer intelligent contract fetches the same weather and uses AI to judge whether the action is safe for the current conditions; validators must independently agree on the tier, multiplier bucket, and pass/fail. PASS → confetti, a GEN reward (base × multiplier), the gate turns green, and you reach the Victory zone. FAIL → the modal shakes red and the gate stays locked. Reckless moves are rejected in High/Extreme weather; cautious ones survive. Ships in walletless demo mode with an on-chain seam ready, a fail-closed contract, and 125 passing tests (direct-mode + validator-logic).

*(990 chars)*

## Expected Verification Outcome (≤ 500 chars)
> Steward will: 1) open the live game and move the hero to the Magic Gate, 2) watch the game pause and the AI Gate modal open with live weather + risk multiplier, 3) click an Action Card and submit to see the "AI Validators…" judging state and a verdict, 4) see a PASS fire confetti + a GEN balance count-up + the gate open to Victory, and a reckless FAIL shake with the gate locked, 5) run `pytest tests/direct/` (125/125 pass), 6) verify the deployed contract on the StudioNet explorer.

*(484 chars)*

## Instructions (step-by-step)
1. Visit the live game: https://hoveiser.github.io/weatherquest/
2. It runs in **demo mode** by default - no wallet, no gas. Move with **WASD / arrow keys**.
3. Walk the orange hero past the river and the tree wall into the **purple Magic Gate**. The game
   **pauses** and the **AI Gate modal** opens.
4. Read the **live weather** + **risk multiplier** for the city. Pick an **Action Card**
   (`🏗️ Build a Raft`, `🏃 Swim Across`, `🧙 Use Weather Magic`) - it fills the text box - or type your
   own action, then **Submit**.
5. Watch the *"AI Validators are analyzing…"* consensus state, then the verdict:
   - **PASS:** confetti + a chime, your **GEN Balance counts up**, the gate turns **green** - walk right
     into the **★ Victory zone**.
   - **FAIL:** the modal **shakes** with a red *"Quest Failed"* and the gate stays locked - pick a safer
     action. (A reckless action like *Swim Across* is rejected when live risk is **High/Extreme**; the
     current weather tier is shown top-right. If the city is mild, most actions pass.)
6. **For developers:** clone the repo and:
   - `genvm-lint check contracts/weatherquest.py` - static lint + GenVM validation (**passes**).
   - `pytest tests/direct/ -v` - **125 direct-mode + validator-logic tests, all passing**.
     Setup (see README §7): `pip uninstall -y genlayer` (the public `genlayer` 0.0.1
     placeholder shadows the real SDK), then `pip install genlayer-py==0.16.3 genlayer-test==0.29.2`.
7. **To play against the deployed contract** instead of the local demo: click **"Connect GenLayer
   Wallet"** in the game (uses the `genlayer-js` SDK + an injected EIP-1193 wallet such as MetaMask),
   or set `VITE_CONTRACT_ADDRESS=0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72` and `VITE_ONCHAIN=true`
   in `frontend/.env` (the on-chain call signatures already match the contract).

> **Recording tip:** in `npm run dev` you can drive the campaign from the browser console with the
> dev-only seams `window.__wgOpenGate(steps)` (open the AI challenge without walking, optionally
> forcing a step count to trigger an efficiency tier), `window.__wgWin()`
> (fire the victory → "Level Up!" auto-advance), and `window.__wgPlay(n)` (jump to level n). These
> are compiled out of the production build.

## Contract Link
https://studio.genlayer.com/address/0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72
- **DEPLOYED to StudioNet** (address `0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72`; deploy tx
`0xe1aa739a…d2b9`, `FINALIZED` / `MAJORITY_AGREE`). This is the **validator-consensus redeploy** of the
campaign-payout contract. It keeps `CAMPAIGN_REWARD_SCALE=100` (every campaign prize GEN is divided by
100 on-chain; base reward L1..L10 = 0.1..1.0 GEN) but removes the root cause of the old `complete_level`
validator timeouts (leader SUCCESS but "Validators Timeout" / NO_MAJORITY):
- **Deterministic weather:** the risk tier and the payout multiplier are pure integer math from a
  normalized weather snapshot, so no LLM produces a payout-determining value and every validator
  derives the identical number.
- **Byte-identical fetches:** levels 2-10 use a fixed integer coordinate table (skipping geocoding), so
  each validator requests a character-for-character identical forecast URL.
- **One LLM call:** only the open-ended action judgment uses the LLM, wrapped against prompt injection.
- **Exact consensus:** validators compare tier, multiplier, and pass/fail with NO tolerance.
`complete_level(level, city, action, optimal_steps, actual_steps)` binds levels 2-10 to their campaign
city and applies a deterministic integer-only **efficiency multiplier** (Perfect 1.2× / Good 1.0× /
Wandering 0.5× / Lost 0.1×) capped because step counts are client-supplied. Replaying a conquered
`(wallet, level)` reverts on-chain as anti-cheat. On StudioNet a real `complete_level(2, "Tokyo", ...)`
settled `FINALIZED` / `MAJORITY_AGREE` and paid 0.144 GEN (0.12 base x 1.20x weather x 1.00x efficiency);
the deploy and a 2 GEN `deposit()` also finalized cleanly.
The marketplace methods (`create_quest`/`submit_action`) are unchanged and the 125-test suite still
passes. Redeploy: `scripts/deploy.sh` (CLI) or the SDK scripts under `scripts/`.

## Website
https://hoveiser.github.io/weatherquest/ (GitHub Pages via `.github/workflows/deploy-frontend.yml`;
published to `main` and verified live with Playwright + chromium).

## Demo Video
**[YouTube link - TBD]**. Source file: `media/demo.mp4` (1920×1080, 30fps, burned-in captions), built
with `scripts/build_demo.sh` (see `docs/video-storyboard.md` for the shot list and the 4-step manual
recording guide).

## GitHub
https://github.com/hoveiser/weatherquest

---

## What was actually built & verified

| Area | Status | Evidence |
|------|--------|----------|
| GenLayer contract | ✅ Complete | `contracts/weatherquest.py` - 14 public methods (marketplace + progressive campaign) with a deterministic efficiency-multiplier reward tier; passes `genvm-lint check` (lint + validate). |
| Contract deployment | ✅ Deployed to StudioNet | Address `0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72` (validator-consensus redeploy: deterministic weather multiplier, one LLM call, exact validator comparison); reproducible via the SDK scripts under `scripts/`. |
| On-chain verification round | ✅ Executed (StudioNet) | 13/13 clean `complete_level` runs (free-form L1 Istanbul x4 incl injection + replay, table L2..L8), all `MAJORITY_AGREE` / 1 rotation / 5-of-5 votes; time-to-ACCEPTED min 10.8s / median 21.3s / max 31.7s; 4/4 expected reverts (empty city, wrong city, `actual<optimal`, already-completed). House funded to 31.856 GEN via `0xb9d117be…`. Evidence: `docs/round_results.json`. |
| Direct-mode tests | ✅ Executed - 125 pass | `pytest tests/direct/` run in-environment after installing the real SDK (`genlayer-py`+`genlayer-test`); 46 direct-mode contract tests + 79 validator-logic tests over the deterministic risk / exact-consistency helpers. |
| Open-Meteo integration | ✅ Verified | Geocoding + forecast endpoints return the expected `results` / `current` shapes (confirmed live in-browser). |
| 2D game (Kaboom.js) | ✅ Complete & builds | `frontend/src/Game.tsx` - tile field (grass/river/wall/gate/victory), WASD+arrow movement, AABB collision, gate + victory triggers. |
| AI Gate modal | ✅ Complete & live-verified | `frontend/src/GateModal.tsx` - Framer Motion scale-in, live weather + multiplier, 3 Action Cards, custom input, "AI Validators…" judging state, verdict. |
| SUCCESS rewards | ✅ Verified (DOM) + foreground animation | PASS → confetti + chime + GEN count-up → gate recolors green → walk to ★ Victory. Confirmed via browser playtest. |
| FAIL / error handling | ✅ Verified in live UI | A rejected on-chain transaction shows a clear, non-frozen "Transaction Failed / Transaction rejected by your wallet" with a working retry (Playwright, `docs/ui-report.json`). Reckless-action rejection at High/Extreme tiers is covered by the direct-mode tests, not re-run on-chain this round. |
| Console health | ✅ Zero errors, zero warnings | Playtest + final reload logged only benign dev-only Vite/React lines; the 2 React Router warnings were removed by mounting the game directly. |
| Progressive campaign UI | ✅ Verified (browser playtest) | Level-select hub (1-10) with "Already Conquered ✅" badges from `campaign_progress`; Level 1 themed to the IP-detected home city (live playtest resolved *Geneve*, London fallback wired); victory → "Level Up!" auto-advance L1→L2→L3; HUD shows wallet/level/city/GEN. |
| Wallet hybrid | ✅ Demo default + SDK live | "Connect GenLayer Wallet" uses the `genlayer-js` SDK (lazy-loaded, code-split out of the demo bundle) for on-chain reads/writes; Demo Mode stays fully playable with `localStorage` progress. |
| Logo / icon | ✅ Complete | `frontend/public/` - `logo.svg` + PNGs (512², 128, 64 favicon). |
| Demo video | ✅ Produced | `media/demo.mp4` (1920×1080) via `scripts/build_demo.sh` + `docs/captions.srt`. YouTube upload is **[TBD]**. |
| Frontend deployment | ✅ Live + Playwright-verified | https://hoveiser.github.io/weatherquest/ (GitHub Pages); loads with 0 console errors, full movement/gate/demo/wallet flows and one real on-chain `complete_level` (tx `0x3cca45ee…be0607`) confirmed `FINALIZED` / `MAJORITY_AGREE`. |

### Honest verification caveats
- **Direct-mode tests were executed and all 125 pass.** One harness-only shim
  lives in `conftest.py` (documented in README §7): `warp()` also writes
  `gl.message_raw['datetime']` (the pinned `genlayer-test` warp patches
  `datetime.now()` but not the cached message datetime the contract's `_now()`
  reads). The weather multiplier is now deterministic (no weather LLM), so only
  the action-judgment prompt is mocked. Neither shim changes on-chain behaviour.
- **The game ships in demo mode by default.** The demo verdict is produced by the frontend's
  settlement heuristic in `lib/contract.ts`, which mirrors the contract's rules and reads the same
  live Open-Meteo data, but is **not** the authoritative on-chain result. The `genlayer-js` SDK is now
  wired in `lib/genlayer.ts`: the in-game "Connect GenLayer Wallet" button switches the same call
  sites to real on-chain play, and a live-UI `complete_level` was settled on StudioNet
  (tx `0x3cca45ee…be0607`, `FINALIZED` / `MAJORITY_AGREE`). The Pages build bakes only
  `VITE_CONTRACT_ADDRESS` (not `VITE_ONCHAIN`), so reviewers still get the funded-wallet-free demo
  unless they connect.
- **`previewRisk` (demo meter) is non-authoritative.** Its client-side risk bands in `lib/weather.ts`
  differ from the contract's deterministic bands, so the modal can preview a multiplier that the
  contract does not pay (captured live: Istanbul preview `1.4x · Low` ≈ 0.17 GEN vs the contract's
  0.12 GEN). It is labelled "preview" for exactly this reason.
- **StudioNet does not credit recipient EOA native balances.** `complete_level` pays via
  `emit_transfer(on="finalized")`, a separate triggered tx that finalizes `NO_MAJORITY` on StudioNet
  and never lands GEN in the player wallet (observed 0/13). The house is debited and `campaign_progress`
  completes correctly; the native credit works on Testnet, not StudioNet.
- **Visual/animation checks (confetti, balance count-up, gate recolor, shake, victory) need a
  foregrounded browser tab** - `requestAnimationFrame` pauses when a tab is backgrounded (standard for
  canvas games). They were confirmed logic-complete via DOM playtest and render normally when the tab is
  visible.
