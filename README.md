# ⛈️ WeatherQuest — AI-Verified Gaming Bounties

> Post GEN-funded gaming bounties where **real-world weather sets the risk multiplier** and an
> **on-chain AI judges** whether your action survives the elements. Braver moves in brutal
> conditions pay bigger; reckless moves fail and the funds go back to the creator.

![WeatherQuest logo](frontend/public/logo.png)

Built for the **GenLayer Builder Program**. The contract runs on GenVM; validators independently
read Open-Meteo and re-run the same AI judgment, and must agree on the *decision* — not just that
the JSON was well-formed.

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

## 2. Consensus boundary (why this needs GenLayer)

- **Frontend owns:** UI, wallet, search/filters, and *non-authoritative* live-weather **previews**
  (a deterministic client-side multiplier so the meter feels alive before you pay gas).
- **Contract owns:** escrow, the authoritative weather→multiplier derivation, the action judgment,
  and the payout/refund settlement — the state transitions that require trusted adjudication.
- **External source owns:** raw weather facts (Open-Meteo). The contract never trusts the leader's
  read — validators re-fetch, normalize to stable fields, and compare derived values.

## 3. Repository layout

```
contracts/weatherquest.py        # GenLayer intelligent contract (passes genvm-lint check)
frontend/                        # React + Vite + Tailwind cyberpunk UI
  public/                        # logo.svg, logo.png (512), logo-128.png, favicon.png
  src/
    App.tsx, main.tsx            # HashRouter shell + layout
    context/AppContext.tsx       # wallet + quests + toasts (useReducer)
    pages/                       # Landing, Dashboard, CreateQuest, MyQuests
    components/                  # Header, MobileNav, QuestCard, QuestDetailModal,
                                 # ResultScreen, RiskMeter, WeatherIcon, WeatherParticles,
                                 # Toasts, Button, Tooltip, SkeletonCard, EmptyState
    hooks/useWeatherPreview.ts   # live weather + client risk preview
    lib/                         # weather.ts (Open-Meteo), contract.ts (demo/on-chain seam), format.ts
    types.ts
tools/render_logo.py             # dependency-free PNG rasterizer for the logo assets
tests/direct/                    # pytest direct-mode contract tests (see §6)
.env.example                     # secrets template (real .env is git-ignored)
```

## 4. The contract — `contracts/weatherquest.py`

Pinned runner: `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` (classic v0.x SDK).

**Public methods (9 total — 4 view, 5 write):**

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
stored as hundredths (`100`–`500`), and payout = `base × multiplier // 100`. No floats in state or
settlement — no rounding drift between validators.

## 5. Running the frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (Vite proxies Open-Meteo to avoid CORS)
npm run build      # type-check + production bundle into dist/
npm run preview    # serve the built bundle
```

**Demo mode is the default** so reviewers get the full, interactive experience without a funded
wallet. Demo settlement mirrors the on-chain rules and reads the *same* Open-Meteo data the contract
uses, but computes the multiplier/payout locally.

**Environment variables** (`frontend/.env`, all optional — see `.env.example` at repo root):

| Var | Effect |
|-----|--------|
| `VITE_CONTRACT_ADDRESS` | Deployed contract address. |
| `VITE_ONCHAIN=true` | Flip `contract.ts` to the on-chain seam (requires the GenLayer JS SDK wired in — see Task 7 in `SUBMISSION.md`). |

Without those, `USE_ONCHAIN` is `false` and the app runs in demo mode. The call signatures in
`lib/contract.ts` already match `contracts/weatherquest.py`, so going live is a swap, not a rewrite.

## 6. Testing

```bash
# Contract static analysis (lint + GenVM validation) — this PASSES in this environment:
.venv/bin/genvm-lint check contracts/weatherquest.py

# Contract tests (pytest direct mode):
pytest tests/direct/ -v
```

`tests/direct/` contains ~24 tests covering create-quest validation (empty city, zero/oversized
reward, bad expiry, escrow mismatch), the read-back, `get_weather_multiplier` (valid city, invalid
city, malformed LLM, clamp-to-range), `submit_action` settlement (success pays `base×mult`, failure
refunds creator, empty action, duplicate, expired, nonexistent, API-timeout fail-closed), and
`claim_expired_quest` (only creator, not-yet-expired, funds returned). Mocks for the geocoding /
forecast / both LLM prompts live in `tests/direct/conftest.py`.

> **Honest status:** `genvm-lint check` passes (lint + validate). The direct-mode tests are written
> and lint-clean, but **could not be executed in this build environment** because the GenLayer test
> SDK (`genlayer[tests]` / the `genlayer-test` pytest plugin) is not installable here — the public
> PyPI `genlayer` distribution is a `0.0.1` placeholder and the real package could not be resolved.
> The tests target the documented `direct_vm` / `direct_deploy` / `mock_web` / `mock_llm` /
> `expect_revert` / `warp` fixture API and will run unmodified where the SDK is available.

## 7. Design system (UI)

Cyberpunk neon-dark theme. GenLayer brand: **orange `#FF6B35`** (primary) + **purple `#6B46C1`**
(secondary) on a **`#0A0E27`** base. Inter type, glassmorphism surfaces (`backdrop-blur`), neon glow
shadows, 8px cards / 12px modals / pill buttons. Fully responsive (mobile bottom-nav, tablet,
desktop grid). Weather-reactive particle overlays (rain / snow / storm lightning) and an animated
risk meter bring the "weather decides your fate" hook to life.

**Accessibility:** semantic landmarks, a skip-to-content link, visible `:focus-visible` rings,
`aria-label`s on icon buttons, `role="dialog"` + `aria-modal` + Escape/backdrop close on the quest
modal, `aria-live` toasts, a `role="meter"` risk gauge, and keyboard-reachable tooltips. Text meets
WCAG AA contrast against the dark surfaces.

## 8. Logo

`frontend/public/logo.svg` is hand-authored (rounded neon tile + "W" bolt-mark + shield, orange→purple
gradient). The PNG assets (`logo.png` 512², `logo-128.png`, `favicon.png`) are produced by
`tools/render_logo.py`, a dependency-free stdlib rasterizer (`python3 tools/render_logo.py`) used
because image-generation/Pillow were unavailable in the build sandbox.

## 9. Deployment

- **Contract → GenLayer StudioNet:** `genlayer deploy contracts/weatherquest.py` (fund with
  `deposit()`, then `create_quest(...)`). Studio explorer: https://studio.genlayer.com.
- **Frontend → GitHub Pages:** `frontend/dist` via the `.github/workflows/deploy-frontend.yml`
  workflow (HashRouter + relative base so deep links work on a project page).

See `SUBMISSION.md` for the fill-in submission fields and the verification outcome summary.

## 10. Known limitations

- **Demo mode ships on by default.** Live on-chain settlement requires the contract deployed and the
  GenLayer JS SDK wired into `lib/contract.ts` (the seam and signatures are ready).
- **Direct tests are unexecuted here** (SDK unavailable) — see §6. Static validation via
  `genvm-lint check` passes.
- The client-side risk preview is explicitly labelled "preview"; it is *not* the authoritative
  on-chain multiplier.
