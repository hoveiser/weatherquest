# ⛈️ WeatherQuest - AI-Verified Gaming Bounties

> **WeatherGate** is a 2D top-down mini RPG where **real-world weather sets the risk multiplier** and
> an **on-chain AI judges** whether your action survives the elements before the Magic Gate opens.
> Braver moves in brutal conditions pay bigger; reckless moves fail and the gate stays locked.

![WeatherQuest logo](frontend/public/logo.png)

Built for the **GenLayer Builder Program**. The GenLayer contract runs on GenVM; validators
independently read Open-Meteo and re-run the same AI judgment, and must agree on the *decision* - not
just that the JSON was well-formed. The game frontend is the player-facing skin over that contract.

---

## 1. The concept

| Step | Who owns it | What happens |
|------|-------------|--------------|
| 1. Post a bounty | **Contract** | Creator locks `base_reward` GEN in escrow with a city + expiry window. |
| 2. Weather sets risk | **Contract + Open-Meteo + LLM** | Consensus validators fetch live weather and derive a **1.0x–5.0x multiplier** and a **risk tier** (Low / Medium / High / Extreme). |
| 3. Player submits an action | **Contract + LLM** | The AI judges whether the action is *safe given the current risk tier*. Cautious moves in Extreme weather can still succeed; reckless ones fail. |
| 4. Settlement | **Contract** | On success → payout = `base_reward × multiplier`. On failure → base reward refunded to creator. |

Every nondeterministic step (web fetch + LLM prompt) is wrapped in a **comparative validator** so a
second validator independently reproduces the answer and they must agree on the risk tier,
multiplier bucket (±1.00x tolerance), and the success flag.

## 2. 🎮 How to Play - WeatherGate

The shipped frontend is a browser game (Kaboom.js canvas + a Tailwind cyberpunk HUD overlay).

1. **Move** your orange hero with **WASD** or the **arrow keys** across the grass field. A blue
   **river** and a **tree wall** block your path - you can't walk through them.
2. **Reach the Magic Gate** - the purple doorway set into the wall on the right. Touching it **pauses
   the game** and opens the **AI Gate modal**.
3. **Read the challenge.** The modal shows the target city's **live weather** (Open-Meteo) and the AI
   **risk multiplier** (e.g. `3.4x · High`). The same widget floats top-right over the HUD.
4. **Choose an action** - tap one of the three **Action Cards** (`🏗️ Build a Raft`, `🏃 Swim Across`,
   `🧙 Use Weather Magic`) or type your own in the box (clicking a card fills the box for you).
5. **Submit.** A consensus simulation runs - *"AI Validators are analyzing the weather and your
   action…"* - then returns a verdict.
6. **Pass →** confetti + a chime, your **GEN Balance counts up** (top-left), the gate turns **green**,
   and you **walk right into the ★ Victory zone**.
   **Fail →** the modal **shakes** red with *"Quest Failed"*, the gate stays locked, and you pick a
   safer action.

**How judgment works (demo mode):** the frontend reuses the project's existing settlement heuristic,
which mirrors the contract's LLM intent - a *cautious* action (shelter, wait, equipment…) survives even
harsh weather, while a *reckless* one (run, swim, climb…) is rejected when the live risk tier is
**High/Extreme**. At mild **Low/Medium** weather most actions pass. Flip to the real on-chain verdict at
any time (see §6).

> **Accessibility / motion:** the balance count-up and the confetti respect
> `prefers-reduced-motion` (the number snaps to its final value instead of animating).

## 3. Consensus boundary (why this needs GenLayer)

- **Game frontend owns:** the canvas, movement/collision, the modal UX, wallet, and *non-authoritative*
  live-weather **previews** (a deterministic client-side multiplier so the meter feels alive before you
  pay gas).
- **Contract owns:** escrow, the authoritative weather→multiplier derivation, the action judgment, and
  the payout/refund settlement - the state transitions that require trusted adjudication.
- **External source owns:** raw weather facts (Open-Meteo). The contract never trusts the leader's
  read - validators re-fetch, normalize to stable fields, and compare derived values.

## 4. Repository layout

```
contracts/weatherquest.py        # GenLayer intelligent contract (passes genvm-lint check)
frontend/                        # React + Vite + TypeScript + Tailwind + Kaboom.js game
  src/
    main.tsx                     # mounts the game directly (no router needed)
    App.tsx                      # game shell: canvas + HUD + AI-gate modal wiring + rewards
    Game.tsx                     # Kaboom layer: tiles, WASD/arrow movement, AABB collision,
                                 #   gate + victory triggers, open-gate seam (props)
    GateModal.tsx                # Framer Motion modal: weather widget, Action Cards, custom
                                 #   input, "AI Validators…" judging state, verdict (pass/shake)
    lib/                         # weather.ts (Open-Meteo + preview risk), contract.ts
                                 #   (demo/on-chain seam), theme.ts (day/night surfaces), format.ts
    types.ts                     # shared domain types (WeatherSnapshot, RiskAnalysis, Quest, ...)
    index.css                    # cyberpunk design system (Tailwind layers)
    pages/ components/ context/  # legacy dashboard MVP - still in the repo, NOT mounted in the game
tests/direct/                    # pytest direct-mode contract tests (see §7)
scripts/deploy.sh                # reproduce the StudioNet deployment
scripts/build_demo.sh            # assemble media/demo.mp4 from captured frames + captions
docs/                            # video storyboard + captions for the demo
media/demo.mp4                   # the demo video
.env.example                     # secrets template (real .env is git-ignored)
```

## 5. The contract - `contracts/weatherquest.py`

Pinned runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` (classic v0.x SDK).

**Public methods (9 total - 4 view, 5 write):**

| Method | Kind | Purpose |
|--------|------|---------|
| `deposit()` | write·payable | Fund the house so multipliers >1x can be paid above each quest's locked base. |
| `create_quest(city, base_reward, description, expiry_hours)` | write·payable | Escrow a bounty. Sender must lock exactly `base_reward` atto. |
| `get_weather_multiplier(city)` | write | Recompute + cache the consensus multiplier for a city (preview helper). |
| `submit_action(quest_id, action)` | write | Resolve weather + judge the action in one consensus round, then settle. |
| `claim_expired_quest(quest_id)` | write | Creator reclaims escrow if a quest expired with **zero** submissions. |
| `get_quest(quest_id)` | view | Full quest record. |
| `list_quests()` | view | All quests. |
| `has_submitted(quest_id, account)` | view | Duplicate-submission guard check. |
| `contract_balance()` | view | House balance. |

**Validation rules (all raise classified `[EXPECTED]` errors):**

- City: non-empty, ≤ 100 chars.
- `base_reward`: 1 – 1000 GEN (atto-scaled `u256`); sent value must equal it exactly.
- `expiry_hours`: 1 – 168 (≤ 7 days).
- Description ≤ 500 chars; Action ≤ 200 chars, non-empty.
- Quest must exist, be `Active`, not expired; one submission per address per quest.

**Fail-closed design:** any geocoding/forecast timeout, 4xx/5xx, missing city, empty body, or
malformed LLM output raises a `gl.vm.UserError` so the transaction reverts and **no funds move**.

**Error taxonomy** (so validators can compare failures): `[EXPECTED]` deterministic business logic
(exact match required), `[EXTERNAL]` 4xx/not-found (exact match), `[TRANSIENT]` network/5xx (agree
if both transient), `[LLM_ERROR]` misbehavior (always disagree → force rotation).

**Money & multiplier are integer-exact:** GEN is atto-scaled (`1 GEN = 10^18`); the multiplier is
stored as hundredths (`100`–`500`), and payout = `base × multiplier // 100`. Campaign levels add a
deterministic **efficiency multiplier** (`complete_level(level, city, action, optimal_steps, actual_steps)`
derives Perfect `1.2×` / Good `1.0×` / Wandering `0.5×` / Lost `0.1×` purely from the two step counts -
`Final = base × weather × efficiency`, all integer math). No floats in state or
settlement - no rounding drift between validators.

## 6. Running the frontend

```bash
cd frontend
npm install        # React, Kaboom.js, Framer Motion, canvas-confetti, Tailwind, Vite
npm run dev        # http://localhost:5173  (Vite proxies Open-Meteo to avoid CORS)
npm run build      # type-check (tsc -b) + production bundle into dist/
npx tsc --noEmit   # standalone strict type-check (must be 0 errors)
npm run preview    # serve the built bundle
```

**Demo mode is the default** so reviewers get the full, interactive 10-level campaign without a funded
wallet. You pick a level from the hub, walk to the Magic Gate, answer the AI challenge, and a victory
auto-advances you to the next (harder) world. Level 1 is themed to your IP-detected home city. Demo
settlement mirrors the on-chain rules and reads the *same* Open-Meteo data the contract uses, but
computes the multiplier/payout locally (progress persists in `localStorage`). To play against the
**deployed contract**, click **"Connect GenLayer Wallet"** in the HUD - the same call sites drive real
on-chain `complete_level` (with `optimal_steps`/`actual_steps`) / `campaign_progress` through the official `genlayer-js` SDK (`lib/genlayer.ts`,
loaded lazily and code-split out of the demo bundle).

| Var | Effect |
|-----|--------|
| `VITE_CONTRACT_ADDRESS` | Deployed contract address. |
| `VITE_ONCHAIN=true` | Start in on-chain mode by default (the in-game **"Connect GenLayer Wallet"** button toggles it at runtime via the `genlayer-js` SDK). |

## 7. Testing

### Contract static analysis

```bash
# Lint + GenVM validation (PASSES):
.venv/bin/genvm-lint check contracts/weatherquest.py
```

### 🧪 How to Run Tests Locally

The direct-mode suite runs on any machine that can reach PyPI + the pinned GenVM
runner (the test SDK auto-downloads the runner into `~/.cache/gltest-direct/`).
It was executed end-to-end and **all 131 tests pass**. On Windows the pinned
`gltest` direct loader crashes (`PermissionError`) because it unlinks its temp
file while fd 0 still holds it; `python scripts/wq_run_tests.py tests/direct/`
delays that unlink so the real assertions run. Linux and CI (`ubuntu-latest`) run
`pytest tests/direct/` directly.

```bash
# 1. Isolated environment (Python 3.12)
python3 -m venv .venv
source .venv/bin/activate

# 2. CRITICAL: the public `genlayer` package is a 0.0.1 placeholder that SHADOWS
#    the real SDK and breaks imports ("name 'gl' is not defined"). Remove it if
#    it is present, then install the real client + test plugin.
pip uninstall -y genlayer 2>/dev/null || true
pip install "genlayer-py==0.16.3" "genlayer-test==0.29.2"

# 3. Run the suite (from the repo root)
pytest tests/direct/ -v
```

Expected result:

```
....................................                          [100%]
36 passed in 0.65s
```

> **China / restricted networks?** If `pypi.org` is unreachable, add a mirror:
> `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn genlayer-py==0.16.3 genlayer-test==0.29.2`
> The GenVM runner bundle still comes from GitHub releases, so that host must be
> reachable once (it caches to `~/.cache/gltest-direct/`).

`tests/direct/` covers: create-quest validation (empty city, zero/oversized
reward, bad expiry, escrow mismatch), the read-back, `get_weather_multiplier`
(valid city, invalid city, malformed LLM, clamp-to-range), `submit_action`
settlement (success pays `base×mult`, failure refunds creator, empty action,
duplicate, expired, nonexistent, API-timeout fail-closed), and
`claim_expired_quest` (only creator, not-yet-expired, funds returned). Mocks for
the geocoding / forecast / both LLM prompts live in `tests/direct/conftest.py`.

**Two direct-mode harness notes** (why `conftest.py` looks the way it does - the
contract itself is production-correct, none of this changes on-chain behaviour):

- The weather LLM mock returns the multiplier as a **string**, because GenVM
  calldata has no `float` type; the contract coerces it with `float(str(...))`
  either way.
- `warp(...)` in `conftest.py` also writes the timestamp into
  `gl.message_raw['datetime']`: the direct-mode `vm.warp` patches
  `datetime.now()` but (at this SDK version) does not refresh the cached message
  datetime that the contract's deterministic `_now()` reads. Native GEN balances
  are seeded with `direct_vm.deal(...)` because direct mode does not move native
  value on `payable` / `emit_transfer` - full transfer accounting is exercised by
  integration tests against a live network.

## 8. Design & game feel (UI)

Cyberpunk neon-dark theme. GenLayer brand: **orange `#FF6B35`** (primary) + **purple `#6B46C1`**
(secondary) on a **`#0A0E27`** base. Glassmorphism HUD panels (`backdrop-blur`), neon glow shadows,
8px cards / 12px modals / pill buttons, Inter type. The Kaboom canvas renders at a fixed logical
704×448 and CSS-scales responsively (`image-rendering: pixelated`) so it stays crisp and centered on
any screen.

**Game feel:** the AI Gate modal uses **Framer Motion** (spring scale-in, animated judging pulse, a
re-mounting key so the fail **shake** replays on every rejected attempt) and **canvas-confetti** for the
success explosion, backed by an optional WebAudio chime. A smooth `requestAnimationFrame` **count-up**
animates the GEN balance. All of this respects `prefers-reduced-motion`.

**Day / night:** Open-Meteo's `is_day` flag still drives the weather palette - the modal picks a
day/night-aware condition glyph (`☀️` clear by day, `🌙` clear by night, `☁️/🌫️/🌧️/🌦️/🌨️/⛈️`
otherwise), and `lib/theme.ts` (`surfaceTheme(kind, isDay)`) remains available for the legacy dashboard
surfaces.

## 9. Logo

`frontend/public/logo.svg` is hand-authored (rounded neon tile + "W" bolt-mark + shield, orange→purple
gradient). The PNG assets (`logo.png` 512², `logo-128.png`, `favicon.png`) are produced by
`tools/render_logo.py`, a dependency-free stdlib rasterizer (`python3 tools/render_logo.py`) used
because image-generation/Pillow were unavailable in the build sandbox.

## 10. Deployment

- **Contract -> GenLayer StudioNet: DEPLOYED (native GEN payout redeploy).**
  ### `0x599EA254e19f7427Db0B158123ED1A21f28538fe`
  (deploy tx `0x623a915b…e361f9`, `FINALIZED` / `SUCCESS`). Payouts now reach the player's
  wallet as real native GEN. The earlier `gl.get_contract_at(eoa).emit_transfer(...)` path
  produced an internal IC->IC message that silently no-oped against EOAs (the "Contract not
  found" failures); this redeploy sends native value through a `@gl.evm.contract_interface`
  `emit_transfer`, the same pattern the sibling devbounty contract uses. Verified on
  StudioNet: a passing `complete_level` moved a throwaway wallet's native balance by exactly
  the payout (0.12 GEN), the house decreased by the same amount, and `get_credit(address)`
  mirrors the payout as a per-address ledger entry. The action judgment now also gates on
  relevance, so gibberish or off-topic text is rejected even on a Low tier with no second LLM
  call. The validator-consensus design is retained: the weather multiplier and risk tier are
  deterministic integer math (no LLM touches the payout-determining value), levels 2-10 read a
  fixed integer coordinate table so every validator requests a byte-identical forecast URL
  (geocoding skipped), only ONE LLM call remains (the action judgment, with prompt-injection
  wrapping), and validators compare tier/multiplier/success EXACTLY (no tolerance). It keeps
  `CAMPAIGN_REWARD_SCALE=100` (base reward L1..L10 = 0.1..1.0 GEN), the progressive-campaign
  methods, and caps the Perfect efficiency bonus at 1.20x. The house is funded with 30+ GEN.
  See §12 for the full on-chain verification round.
  Previous deployments: `0x2d764187A908d1677510c5E7FE69e8e7C1810299` (credit-ledger stopgap),
  `0x8fc4bc489C30666D6cF846DB63aAEaDfD8475A72` (validator-consensus redeploy whose
  `get_contract_at` payouts no-oped). Redeploy from source with the SDK scripts in `scripts/`
  (`wq_check.py`, `wq_deploy.py`, `wq_final_verify.py`); `scripts/deploy.sh` is the `genlayer`
  CLI path. Studio explorer: https://studio.genlayer.com.
- **Frontend -> GitHub Pages:** `frontend/dist` via the `.github/workflows/deploy-frontend.yml`
  workflow. Live at https://hoveiser.github.io/weatherquest/ (verified with Playwright + chromium).

To point the game at the live contract, set `VITE_CONTRACT_ADDRESS=0x599EA254e19f7427Db0B158123ED1A21f28538fe`
and `VITE_ONCHAIN=true` in `frontend/.env` (see §6). For the campaign path the Pages build bakes only
`VITE_CONTRACT_ADDRESS` (see `.github/workflows/deploy-frontend.yml`); `VITE_ONCHAIN` is intentionally left
off so the marketplace flows don't attempt unfunded on-chain escrow.

See `SUBMISSION.md` for the fill-in submission fields and the verification outcome summary, and
`scripts/build_demo.sh` / `docs/video-storyboard.md` for how `media/demo.mp4` is produced.

## 11. Known limitations

- **Demo mode ships on by default** so the full 10-level campaign is playable with no funded
  wallet (progress persists in `localStorage`). A **"Connect GenLayer Wallet"** button switches
  the same call sites to **real on-chain play** through the official `genlayer-js` SDK
  (`lib/genlayer.ts`, dynamically imported so it never bloats the demo bundle): it reads
  `campaign_progress` for conquered-level badges, shows the live GEN balance + wallet address in
  the HUD, and settles `complete_level` through validator consensus. On-chain play needs an
  injected EIP-1193 wallet (e.g. MetaMask).
- The client-side risk preview is labelled "preview" and stays informational (the authoritative
  value is whatever the validator set agrees on-chain). Since the P4 port, `previewRisk` in
  `lib/weather.ts` delegates to `lib/risk.ts`, a byte-exact TypeScript re-implementation of the
  contract's integer bands (`_snap_from_raw`, `_code_class`, `_risk_from_snapshot`), and the preview
  GEN amount uses the same `base * multiplier * efficiency / 10000` formula with the Perfect 1.20x
  bonus. The same boundary table used by the Python tests is unit-tested in
  `frontend/tests/risk.test.mjs` (10/10 pass with the bundled Node), so the displayed tier, multiplier
  and GEN for a given weather snapshot match the contract. A live-site screenshot confirming the
  Istanbul preview equals the on-chain payout for the same run is captured under `docs/` after the
  Pages deploy (P5).
- **StudioNet DOES credit recipient EOA native balances for the campaign payout.** An earlier
  conclusion that it could not was WRONG and is corrected here: the blocker was the API, not
  the network. `gl.get_contract_at(eoa).emit_transfer(...)` sends an internal IC->IC message
  that silently no-ops against addresses without an Intelligent Contract (the "Contract not
  found" triggered txs, `docs/p1_triggered_txs.json`). The working pattern is a
  `@gl.evm.contract_interface` recipient declaration plus `emit_transfer(value=...)` with a
  plain hex address, exactly what the sibling devbounty contract uses. Verified on StudioNet
  on the final contract (deploy `0x623a915b…e361f9`): three passing `complete_level` runs each
  moved a throwaway wallet's native balance by exactly 0.12 GEN (delta == payout ==
  `get_credit`), the house decreased by the same amount, and three gibberish actions were
  rejected with 0 delta (evidence `docs/final_verify.json`). The credit ledger is kept as a
  per-address mirror for read queries. The UI confirms delivery against the wallet's real
  native balance delta and only then reports the payout as received.
- The game canvas, confetti, and count-up run on `requestAnimationFrame` and therefore pause when the
  browser tab is backgrounded (standard for canvas games); everything resumes on focus.

## 12. On-chain verification rounds (real StudioNet)

### 12a. Native-payout + relevance round (current final contract `0x599EA254...`)

Run by `scripts/wq_final_verify.py` against the current final contract
`0x599EA254e19f7427Db0B158123ED1A21f28538fe` (deploy tx `0x623a915b1d4d612691eae3674d051b29ca7104f59db53ae8d5bb11897be361f9`,
funded 30 GEN via tx `0x37ca040eb2cc360f88cf27e345be029be8a0cf8d9330ca7237c05f6621783936`). Full
per-case records with tx hashes: `docs/final_verify.json`.

- 3 gibberish actions on level-1 Istanbul: each `MAJORITY_AGREE` / `exec=SUCCESS`, 1 consensus
  round, **0 triggered transfers, native balance delta 0, credit 0** -> rejected by the relevance
  gate even where the tier's guidance is lenient.
- 3 sensible actions on level-1 Istanbul: each `MAJORITY_AGREE` / `exec=SUCCESS`, 1 consensus
  round, **1 triggered transfer, wallet native balance delta = credit = 0.12 GEN exactly**, and
  the house decreased by the same 0.12 GEN per run.

This round proves the two things the earlier credit round could not: native GEN actually reaches
the player EOA, and the relevance gate rejects gibberish while keeping the single LLM call and
exact validator consensus.

**Live-UI proof (`tools/pwtest/onchain_write.mjs`, evidence `docs/ui-onchain-report.json`).** The
published GitHub Pages bundle (https://hoveiser.github.io/weatherquest/) is driven end-to-end by
Playwright with a freshly generated throwaway wallet (private key never printed or stored) whose
`eth_sendTransaction` is relayed to StudioNet. Level 1, sensible action, Low weather: wallet
`0xAeD87Dd89527F26DD8C288e32572067f92FD550D`, `Quest Passed`, settlement tx
`0x954f07a8f2311a2372d32f461de085c871c0e282ef923c3867e3b3e853462556`, the payout line read
`"Payout: 0.1200 GEN received in your wallet"`, and an independent node-side
`eth_getBalance` on the throwaway address moved **0 -> 0.12 GEN (delta exactly the payout)**.
The UI's balance-confirmation logic only reports `sent` after that native delta, so the displayed
text and the measured wallet balance agree. 0 console errors. This is the delivery proof through the
connected LIVE UI, not just the SDK harness.

### 12b. Credit-ledger stopgap round (superseded contract `0x2d764187...`)

All numbers below come from one sequential harness (`scripts/wq_round.py`) run against the
previous stopgap contract `0x2d764187A908d1677510c5E7FE69e8e7C1810299`, whose payouts were
recorded only as an on-chain credit (no native transfer). Every result is appended to
`docs/round_results.json` and the raw `get_transaction` dump for every tx is in
`docs/round_raw/`. Consensus is judged by the SDK's `result_name` + `last_round` votes + the
recorded per-validator vote set, not by the `tx_execution_result_name` field (which is null on
StudioNet). Fresh throwaway accounts are used per case; StudioNet is gasless so no account funding
was needed. "Consensus rounds" below is `num_of_rounds` on the tx (1 means the first round already
reached MAJORITY_AGREE, i.e. no rotation happened).

**Funding the house.** `deposit()` of 30 GEN from the deployer (tx
`0xef9bbe5b49d3b391cb0a6725b11ca45738b28cb65fb21819c1596ae4b1806590`) reached `FINALIZED` /
`MAJORITY_AGREE` and raised `contract_balance` from 0 to 30.0 GEN. Because that stopgap contract recorded payouts as an on-chain per-address credit (see §11) rather than a native `emit_transfer`,
the house balance stayed at 30.0 GEN across the whole round below (on the current
`0x599EA254...` contract a passing run debits the house by the native payout instead). That was far above the
`base * 6` max-payout pre-check in the contract (level 10 base is 1.0 GEN, multiplier 1.0..5.0, so
any single run caps at 6.0 GEN).

**`complete_level` credited successes (12 runs, 12/12 clean):**

| Case | Level / city | Sender (short) | Consensus | Consensus rounds | Votes | Time to ACCEPTED | Recipient credit delta (GEN) |
|------|--------------|----------------|-----------|------------------|-------|------------------|------------------------------|
| p3_free_L1_Istanbul_0 | L1 Istanbul, free-form geocode | 0x0c5b8066 | `MAJORITY_AGREE` | 1 | 5/5 | 21.7 s | 0.12 |
| p3_free_L1_Istanbul_1 | L1 Istanbul, free-form geocode | 0x1e312935 | `MAJORITY_AGREE` | 1 | 5/5 | 21.8 s | 0.12 |
| p3_free_L1_Istanbul_2 | L1 Istanbul, free-form geocode | 0x759823a7 | `MAJORITY_AGREE` | 1 | 5/5 | 21.6 s | 0.12 |
| p3_L2_Tokyo | L2 Tokyo, table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 22.5 s | 0.144 |
| p3_L3_Sydney | L3 Sydney, table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 22.0 s | 0.234 |
| p3_L4_Reykjavik | L4 Reykjavik, table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 21.8 s | 0.288 |
| p3_L5_Singapore | L5 Singapore, table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 21.6 s | 0.30 |
| p3_L6_Cairo | L6 Cairo, table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 22.0 s | 0.36 |
| p3_L7_Rio_de_Janeiro | L7 Rio, table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 21.6 s | 0.42 |
| p3_L8_Port_of_Spain | L8 Port of Spain, table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 21.7 s | 0.72 |
| p3_L9_Moscow | L9 Moscow, table coord (P3 high-tier case) | one account | `MAJORITY_AGREE` | 1 | 5/5 | 21.7 s | 0.90 |
| p3_L10_Tromso | L10 Tromso (with the o-slash), table coord | one account | `MAJORITY_AGREE` | 1 | 5/5 | 21.7 s | 1.56 |

Every credited row above was verified by the harness reading `get_credit(player)` immediately
before and after the tx: `recipient_credit_delta_atto` in the JSON equals the expected
`base_atto * mult_x100 * eff_x100 / 10000`, computed from the on-chain `validated` view. The
harness also confirms `has_completed_level(sender, level) = true` after each credited run.

**`complete_level` expected rejections on live Medium weather (6 runs, 6/6 clean, success=false):**

No campaign level or scanned city was at High or Extreme when the round ran (all table coords
currently return Low, and a 74-city storm-prone scan of the level-1 geocode path found only
Medium). The rejects below therefore target the Medium band via the level-1 free-form path. Each
reject uses a fresh account, one of three rotating clearly-reckless action texts, and is followed
by a safe retry from the same account.

| Case | City (level-1 geocode path) | Score | Consensus | Consensus rounds | Votes | Time to ACCEPTED | Recipient credit delta | Level marked completed | Same-account safe retry credited |
|------|-----------------------------|-------|-----------|------------------|-------|------------------|------------------------|------------------------|----------------------------------|
| p3r_reject0_L1_Wellington | Wellington, NZ (`0x98955476b3256bd14fbdffa6fcf004f8fc4bfd176a04ad3e026cb9c67ba710d0`) | 200 | `MAJORITY_AGREE` | 1 | 5/5 | 22.0 s | 0 | false | 0.24 GEN (`0xafc4a97c4f03fa6d4d95494c500a8ca0d56432dadeb94624cdcbc83ee87bc496`) |
| p3r_reject1_L1_Tromso | Tromso, Norway (`0x5caff9dd14d2dde7a03b980a3662a1abb1201c82dc9ea3c93b4ca53d609364b2`) | 180 | `MAJORITY_AGREE` | 1 | 5/5 | 21.7 s | 0 | false | 0.216 GEN (`0x79c3c78980ddf7c4ea01664b97463f4954a6cf7e8330c461702a05258840dd60`) |
| p3r_reject2_L1_San_Juan | San Juan, PR (`0x42fc092adaf4e93a6aae8ee2545c5809dd4f4113c6733a373380defac0b2961a`) | 170 | `MAJORITY_AGREE` | 1 | 5/5 | 21.7 s | 0 | false | 0.204 GEN (`0x2d74bd0776c0ccf7cf615184c9438948c6f202025e543655e3279483399b8114`) |
| p3r_reject3_L1_Guayaquil | Guayaquil, EC (`0xe4f0badf3acbdfb7e3114801baee66adb810cd91be7bfc5f0586db30c91c2a1c`) | 170 | `MAJORITY_AGREE` | 1 | 5/5 | 21.7 s | 0 | false | 0.204 GEN (`0x0ab40a1c9d456b34fb917c5347b0733950821dd644d9dba3bf888d28933fce30`) |
| p3r_reject4_L1_Durban | Durban, ZA (`0xe7d6398624651257199fb6624e038def19b7fcdb1d16e9286c6c9d0a308cf0ee`) | 160 | `MAJORITY_AGREE` | 1 | 5/5 | 21.8 s | 0 | false | 0.192 GEN (`0xd2e7614e627a236c6dfe06d4d6f3eacc5e84321e47738fb85d705ee9fdc77359`) |
| p3r_reject5_L1_Cabo_San_Lucas | Cabo San Lucas, MX (`0x2b4220211ed43a83ecd75e2aa7b5d30b209a3f1724564238e5f8c4c240645130`) | 150 | `MAJORITY_AGREE` | 1 | 5/5 | 21.8 s | 0 | false | 0.18 GEN (`0xd3f77e4e4528b6fd03289e440ee0eb4077e2df96bd8109d9195ad01d3a596d51`) |

The `success=false` outcome is proven by the on-chain effect and the decoded leader receipt:
after each reject, `get_credit(account)` is unchanged (delta 0), `has_completed_level(account, 1)`
returns false, and the same safe-account retry on the SAME city immediately after the reject
clears the level and credits exactly `base * mult_x100 * 120 / 10000` (Perfect efficiency).

**Honest diagnosis of earlier rejected-action cases.** In a prior round against the PREVIOUS
contract `0x8fc4bc48...`, 5 cases labelled `p3_reject*` were actually APPROVED by the single
`_judge_action` LLM call (`success=true`, credited, level marked completed). Decoding the raw
leader receipts shows why: every weather snapshot in that earlier set resolved to `risk_tier =
"Low"`, and the contract's tier-keyed guidance states "Low: approve essentially any reasonable
action", so reckless texts on Low weather were approved. The current 6-case set avoids this pitfall
by picking cities that the harness re-scans as Medium at run time.

**`get_weather_multiplier` probes on the final contract.**

| Case | Tx hash | Consensus | Consensus rounds | Votes | Time to ACCEPTED | Decoded result |
|------|---------|-----------|------------------|-------|------------------|----------------|
| Tromso | `0x5328b63f338afe46587c751c86ac13d225b9c8834ad29b4df39cff960a65b010` | `MAJORITY_AGREE` | 1 | 5/5 | 21.6 s | `multiplier=1.30`, `risk_tier=Low`, summary `temp=6C wind=27km/h humidity=75% condition=Overcast` |
| Singapore | `0x72f784db8ed806f1730e67f68edf02c664d0bbb86239a2bacdffb98b1b160e29` | `MAJORITY_AGREE` | 1 | 5/5 | 21.8 s | `multiplier=1.20`, `risk_tier=Low`, tropical summary `temp=27C humidity=88% condition=Overcast` |

**Timing summary across the 18 credited runs (12 successes + 6 safe retries).**
min **21.6 s**, median **21.7 s**, max **42.7 s** to ACCEPTED; **18/18** consensus clean
(`MAJORITY_AGREE`, `num_of_rounds=1`, 5-of-5 votes), **18/18** payout exact, success rate **100%**.
Including the 6 rejects and the 2 multiplier probes (26 `write_contract` calls total), every case
reached `MAJORITY_AGREE` with 1 consensus round and 5-of-5 votes; no `Validators Timeout`, no
`NO_MAJORITY`, and no validator disagreement on any value-determining field.

**StudioNet transient errors handled.** During reject0's safe retry, one `get_transaction` poll
returned `eth_getTransactionByHash returned invalid JSON` at t=63.7 s (a StudioNet 502-class
response observed in earlier rounds). The harness's transient-tolerant poller retried within the
5-minute cap and reached `FINALIZED` at t=84.6 s. Submission also goes through a bounded
transient-retry wrapper (`_submit`) so a single transient failure never aborts a round.

**Before / after vs the old failing txs.** Old baseline `0xa9a655d37aef475203a2f77d5fda8b7605242aac0578ec4c768f7ec33eabcc93` = `TIMEOUT` (Validators Timeout),
`0x4936ffae5ebe23889ba6dc19eb5d0dd8179e5a7b2915ca412612005604f1ede1` = `NO_MAJORITY` with 0 rounds / 0 votes (GenVM crash); neither ever reached ACCEPTED. The
P1 failed-payout example `0xa7d58a7e3a07e8d3d1ddfed2676e82112939c1703b2069b52685db7dead6cf72` was a *triggered* transfer on the previous
contract; all 14 such triggered transfers failed `Contract not found` (evidence `docs/p1_triggered_txs.json`) and moved no GEN. On the current contract
the 26 runs above are 26/26 `MAJORITY_AGREE`, 1 consensus round (no rotation), 5-of-5 votes.

**Live UI Playwright test.** The on-chain settlement made through the UI against the PREVIOUS
contract (`0x3cca45ee...`, hash recorded in `docs/ui-onchain-report.json`) still shows the old
truncated `…be0607` form. P2 rewires the UI so the settlement and payout links carry the full
66-character hash; the same Playwright harness in `tools/pwtest/` is re-run against the new
bundle (contract `0x2d764187A908d1677510c5E7FE69e8e7C1810299`) once GitHub Pages publishes the
deploy from P6, and its screenshots land under `docs/` (`ui-*.png`). The credit-delivery
themselves are already verified on-chain (SDK, not UI) via the p3 rows above, and the
P1 redeploy verification `docs/p1_credit_verify.json` shows `0x46a7b795d8b1c491f83c3a966b690ed69b5280d50ccc3a327632899ab22467ed` FINALIZED /
`MAJORITY_AGREE` with `get_credit(player) = 0.12 GEN` and the house unchanged at 30.0 GEN.
