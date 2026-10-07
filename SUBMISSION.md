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
> WeatherQuest: WeatherGate is a 2D top-down mini RPG you play in the browser (Kaboom.js + Framer Motion). Steer a hero with WASD/arrows past a river and a wall to a Magic Gate. Touching it pauses the game and opens an AI Gate modal showing the target city's live Open-Meteo weather and a 1.0x–5.0x risk multiplier. Pick an Action Card (Build a Raft / Swim Across / Use Weather Magic) or type your own move, then submit. A GenLayer intelligent contract fetches the same weather and uses AI to judge whether the action is safe for the current conditions; validators must independently agree on the tier, multiplier bucket, and pass/fail. PASS → confetti, a GEN reward (base × multiplier), the gate turns green, and you reach the Victory zone. FAIL → the modal shakes red and the gate stays locked. Reckless moves are rejected in High/Extreme weather; cautious ones survive. Ships in walletless demo mode with an on-chain seam ready, a fail-closed contract, and 131 passing tests (direct-mode + validator-logic).

*(990 chars)*

## Expected Verification Outcome (≤ 500 chars)
> Steward will: 1) open the live game and move the hero to the Magic Gate, 2) watch the game pause and the AI Gate modal open with live weather + risk multiplier, 3) click an Action Card and submit to see the "AI Validators…" judging state and a verdict, 4) see a PASS fire confetti + a GEN balance count-up + the gate open to Victory, and a reckless FAIL shake with the gate locked, 5) run `pytest tests/direct/` (131/131 pass), 6) verify the deployed contract on the StudioNet explorer.

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
   - `pytest tests/direct/ -v` - **133 direct-mode + validator-logic tests, all passing**.
     Setup (see README §7): `pip uninstall -y genlayer` (the public `genlayer` 0.0.1
     placeholder shadows the real SDK), then `pip install genlayer-py==0.16.3 genlayer-test==0.29.2`.
7. **To play against the deployed contract** instead of the local demo: click **"Connect GenLayer
   Wallet"** in the game (uses the `genlayer-js` SDK + an injected EIP-1193 wallet such as MetaMask),
   or set `VITE_CONTRACT_ADDRESS=0x599EA254e19f7427Db0B158123ED1A21f28538fe` and `VITE_ONCHAIN=true`
   in `frontend/.env` (the on-chain call signatures already match the contract).

> **Recording tip:** in `npm run dev` you can drive the campaign from the browser console with the
> dev-only seams `window.__wgOpenGate(steps)` (open the AI challenge without walking, optionally
> forcing a step count to trigger an efficiency tier), `window.__wgWin()`
> (fire the victory → "Level Up!" auto-advance), and `window.__wgPlay(n)` (jump to level n). These
> are compiled out of the production build.

## Contract Link
https://studio.genlayer.com/address/0x599EA254e19f7427Db0B158123ED1A21f28538fe
- **DEPLOYED to StudioNet** (address `0x599EA254e19f7427Db0B158123ED1A21f28538fe`; deploy tx
`0x623a915b…e361f9`, `FINALIZED` / `SUCCESS`; house funded to 30+ GEN via `deposit()` txs
`0x37ca040e…3936` and `0x9029e059…b8ba`). This is the **native-GEN-payout redeploy** of the
campaign-payout contract (superseding the credit-ledger stopgap `0x2d764187A908d1677510c5E7FE69e8e7C1810299`
and the earlier `0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72`, whose `get_contract_at` payouts no-oped).

**Native GEN payouts (the real fix, correcting the earlier claim).** An earlier report said
StudioNet could not deliver native GEN to a player EOA and that `@gl.evm.contract_interface` was
rejected with `exit_code 1`. That was WRONG. The failures came from the wrong API, not the network:
`gl.get_contract_at(eoa).emit_transfer(...)` sends an internal IC->IC message that silently no-ops
against an address with no Intelligent Contract (the "Contract not found" triggered txs in
`docs/p1_triggered_txs.json`), and the `exit_code 1` in the earlier four-pattern repro was a bad
test harness (it called `complete_level` with 4 args instead of the required 5), not the
`@gl.evm.contract_interface` path. The contract now pays with a `@gl.evm.contract_interface`
`EvmValueRecipient` + `emit_transfer(value=...)` on a plain hex address (the sibling devbounty
pattern) and keeps the credit ledger only as a per-address mirror. Verified on StudioNet on
contract `0x599EA254e19f7427Db0B158123ED1A21f28538fe`: three passing `complete_level` runs each
moved the throwaway wallet's NATIVE balance by exactly 0.12 GEN (delta == `get_credit`, 1
`MAJORITY_AGREE` round, 1 triggered transfer, house debited by the same amount); three gibberish
actions were rejected with 0 delta. Evidence: `docs/final_verify.json`.

The validator-consensus design is retained:
- **Deterministic weather:** the risk tier and the payout multiplier are pure integer math from a
  normalized weather snapshot, so no LLM produces a payout-determining value and every validator
  derives the identical number.
- **Byte-identical fetches:** levels 2-10 use a fixed integer coordinate table (skipping geocoding), so
  each validator requests a character-for-character identical forecast URL.
- **One LLM call:** only the action judgment uses the LLM, wrapped against prompt injection; the
  relevance gate (gibberish / off-topic rejection) is folded into that same call, so a Low-tier
  nonsense action is rejected with no second round-trip.
- **Exact consensus:** validators compare tier, multiplier, and pass/fail with NO tolerance.
`complete_level(level, city, action, optimal_steps, actual_steps)` binds levels 2-10 to their campaign
city and applies a deterministic integer-only **efficiency multiplier** (Perfect 1.2x / Good 1.0x /
Wandering 0.5x / Lost 0.1x) capped because step counts are client-supplied. Replaying a conquered
`(wallet, level)` reverts on-chain as anti-cheat. Payout = base * weather(x100) * efficiency(x100) /
10000 (all integer), paid natively to the wallet and mirrored in the credit ledger.
The marketplace methods pay natively too: `create_quest` escrows the base reward, `submit_action`
refunds it to the creator on a failed judgment, and `claim_expired_quest` returns the escrow when a
quest expires with no submissions, so no GEN can be locked without a working exit. 133 direct-mode
+ validator-logic tests pass. Redeploy: `scripts/deploy.sh` (CLI) or `scripts/wq_final_verify.py` /
the SDK scripts under `scripts/`.

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
| GenLayer contract | Complete | `contracts/weatherquest.py` - 15 public methods (marketplace + progressive campaign + on-chain credit ledger) with a deterministic efficiency-multiplier reward tier; passes `genvm-lint check` (lint + validate). |
| Contract deployment | Deployed to StudioNet | Address `0x599EA254e19f7427Db0B158123ED1A21f28538fe` (native-GEN redeploy: deterministic weather multiplier, one LLM call with a relevance gate, exact validator comparison, payouts sent as native GEN + mirrored in a credit ledger); reproducible via `scripts/wq_final_verify.py`. Superseded: `0x2d764187...` (credit stopgap), `0x8fc4bc48...` (`get_contract_at` payouts that no-oped). |
| On-chain verification round | Executed (StudioNet, final contract `0x599EA254...`) | `scripts/wq_final_verify.py`: 6 `complete_level` runs, 3 gibberish (all `MAJORITY_AGREE` / `SUCCESS`, 0 triggered, native delta 0, credit 0 => rejected by the relevance gate) + 3 sensible (all `MAJORITY_AGREE` / `SUCCESS`, 1 triggered transfer, native balance delta = credit = 0.12 GEN exactly, house debited by the same amount). Consensus clean 6/6 (1 round, no rotation). Evidence: `docs/final_verify.json`. A prior 26-run credit round on the superseded `0x2d764187...` stopgap is retained in `docs/round_results.json` + README §12b. |
| Live-UI native-delivery proof | Executed (Playwright + throwaway wallet) | `tools/pwtest/onchain_write.mjs` drives the production bundle with a freshly generated wallet relayed to StudioNet. Level 1 sensible action: `Quest Passed` (47 s), settlement tx `0x6cc91e1796b1aac84b1cd90ff3c49d553cb453a306bbaa07036cb1306fce7af3`, UI showed `"Payout: 0.1200 GEN received in your wallet"`, and an independent node-side `eth_getBalance` on that wallet moved **0 -> 0.12 GEN (delta == payout)**. 0 console errors. Evidence: `docs/ui-onchain-report.json`. |
| Direct-mode tests | Executed - 133 pass | `pytest tests/direct/` run in-environment after installing the real SDK (`genlayer-py`+`genlayer-test`); 52 direct-mode contract tests + 81 validator-logic tests (deterministic risk, exact-consistency helpers, relevance-gate rejection + fail-closed). On Windows the 52 real-VM direct tests cannot run (a `gltest` temp-file `PermissionError`), so they are verified in Linux CI. |
| Open-Meteo integration | ✅ Verified | Geocoding + forecast endpoints return the expected `results` / `current` shapes (confirmed live in-browser). |
| 2D game (Kaboom.js) | ✅ Complete & builds | `frontend/src/Game.tsx` - tile field (grass/river/wall/gate/victory), WASD+arrow movement, AABB collision, gate + victory triggers. |
| AI Gate modal | ✅ Complete & live-verified | `frontend/src/GateModal.tsx` - Framer Motion scale-in, live weather + multiplier, 3 Action Cards, custom input, "AI Validators…" judging state, verdict. |
| SUCCESS rewards | ✅ Verified (DOM) + foreground animation | PASS → confetti + chime + GEN count-up → gate recolors green → walk to ★ Victory. Confirmed via browser playtest. |
| FAIL / error handling | Verified in live UI + on-chain | A rejected on-chain transaction shows a clear, non-frozen "Transaction Failed / Transaction rejected by your wallet" with a working retry (Playwright, `docs/ui-report.json`). Reckless-action rejection is now also verified ON-CHAIN: 6 `success=false` cases on live Medium weather (`docs/round_results.json`, credit 0 + level not completed + same-account safe retry credited). No High/Extreme weather was live at run time, so those tiers remain covered by the direct-mode tests only. |
| Console health | ✅ Zero errors, zero warnings | Playtest + final reload logged only benign dev-only Vite/React lines; the 2 React Router warnings were removed by mounting the game directly. |
| Progressive campaign UI | ✅ Verified (browser playtest) | Level-select hub (1-10) with "Already Conquered ✅" badges from `campaign_progress`; Level 1 themed to the IP-detected home city (live playtest resolved *Geneve*, London fallback wired); victory → "Level Up!" auto-advance L1→L2→L3; HUD shows wallet/level/city/GEN. |
| Wallet hybrid | ✅ Demo default + SDK live | "Connect GenLayer Wallet" uses the `genlayer-js` SDK (lazy-loaded, code-split out of the demo bundle) for on-chain reads/writes; Demo Mode stays fully playable with `localStorage` progress. |
| Logo / icon | ✅ Complete | `frontend/public/` - `logo.svg` + PNGs (512², 128, 64 favicon). |
| Demo video | ✅ Produced | `media/demo.mp4` (1920×1080) via `scripts/build_demo.sh` + `docs/captions.srt`. YouTube upload is **[TBD]**. |
| Frontend deployment | Live + Playwright-verified | https://hoveiser.github.io/weatherquest/ (GitHub Pages); loads with 0 console errors, full movement/gate/demo/wallet flows. The final-contract bundle is verified end-to-end in `docs/ui-onchain-report.json` (real on-chain `complete_level`, native 0 -> 0.12 GEN delta). P2 renders the FULL 66-character settlement + payout explorer links; after this push the Pages workflow rebuilds with `VITE_CONTRACT_ADDRESS=0x599EA254...` so the published bundle matches the verified one. |

### Honest verification caveats
- **Direct-mode tests were executed and all 133 pass.** One harness-only shim
  lives in `conftest.py` (documented in README §7): `warp()` also writes
  `gl.message_raw['datetime']` (the pinned `genlayer-test` warp patches
  `datetime.now()` but not the cached message datetime the contract's `_now()`
  reads). The weather multiplier is now deterministic (no weather LLM), so only
  the action-judgment prompt is mocked. Neither shim changes on-chain behaviour.
- **The game ships in demo mode by default.** The demo verdict is produced by the frontend's
  settlement heuristic in `lib/contract.ts`, which mirrors the contract's rules and reads the same
  live Open-Meteo data, but is **not** the authoritative on-chain result. The `genlayer-js` SDK is now
  wired in `lib/genlayer.ts`: the in-game "Connect GenLayer Wallet" button switches the same call
  sites to real on-chain play, and a live-UI `complete_level` was settled on StudioNet against the
  final contract (tx `0x6cc91e17…e7af3`, native balance 0 -> 0.12 GEN, `docs/ui-onchain-report.json`).
  The Pages build bakes only
  `VITE_CONTRACT_ADDRESS` (not `VITE_ONCHAIN`), so reviewers still get the funded-wallet-free demo
  unless they connect.
- **`previewRisk` (demo meter) is now a byte-exact port of the contract.** `lib/weather.ts`
  delegates to `lib/risk.ts`, which re-implements the contract's integer bands (`_snap_from_raw`,
  `_code_class`, `_risk_from_snapshot`) and the `base * multiplier * efficiency / 10000` formula, so
  the previewed tier, multiplier and GEN match what the contract computes for the same weather
  snapshot. The same boundary table as the Python tests is unit-tested in
  `frontend/tests/risk.test.mjs` (10/10 pass). It is still labelled "preview" because the
  authoritative value is the one validators agree on-chain. The earlier Istanbul `1.4x`-vs-`0.12 GEN`
  divergence is fixed by this port (a live-site screenshot after the Pages deploy is captured in P5).
- **Native GEN delivery to the wallet is now verified on StudioNet** (correcting the earlier claim
  here). The old `gl.get_contract_at(eoa).emit_transfer(...)` path failed `Contract not found` on
  every triggered tx (0/14, `docs/p1_triggered_txs.json`) because it is an internal IC->IC message
  that no-ops against an EOA, NOT because the network forbids native transfers. The current
  contract pays via a `@gl.evm.contract_interface` `emit_transfer(value=...)` (the devbounty
  pattern). Verified on `0x599EA254...`: 3 sensible `complete_level` runs each moved the wallet's
  native balance by exactly 0.12 GEN (delta == `get_credit`, house debited), and 3 gibberish
  actions were rejected with 0 delta (`docs/final_verify.json`). The credit ledger is kept as a
  per-address mirror; the UI confirms delivery against the wallet's real balance delta before it
  says the payout was received.
- **Visual/animation checks (confetti, balance count-up, gate recolor, shake, victory) need a
  foregrounded browser tab** - `requestAnimationFrame` pauses when a tab is backgrounded (standard for
  canvas games). They were confirmed logic-complete via DOM playtest and render normally when the tab is
  visible.
