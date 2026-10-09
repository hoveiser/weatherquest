// ============================================================================
// GateModal - the "Magic Gate Locked" AI challenge overlay.
//
// Rendered when the Kaboom player walks into the closed Magic Gate. The game
// is paused while this modal is open. It shows the live weather + risk
// multiplier, the on-chain objective the validators grade against, offers 3
// action cards plus a custom input, runs a "judging" state, and animates the
// verdict (success glow / failure shake).
//
// The actual verdict comes from `onSubmit` (the parent), which reuses the
// project's existing complete_level demo/on-chain logic. Four verdict shapes are
// rendered: PASS; a genuine AI-judged-unsafe FAIL (shake); a specific TRANSACTION
// ERROR shown verbatim - wallet rejection / revert / insufficient funds / network
// (no shake, no generic "AI said no"); and a validator CONGESTION TIMEOUT (60s,
// no shake, "may finalize later").
//
// MONEY LABELING CONTRACT (reviewer fix): every GEN figure in the settlement
// block names its class, and the three classes never share a line:
//   Level N payout            PER-LEVEL   from get_level_payout(account, level)
//   Wallet native GEN a -> b  WALLET-NATIVE measured balance delta
//   Total credited to your    PER-PLAYER  from get_total_credit (cumulative, all
//   address                   cumulative  levels - never presented as one prize)
// ============================================================================
import { useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import type { LevelOutcome, RiskAnalysis, WeatherSnapshot } from './types';
import { HashLink } from './components/TxLink';
import { objectiveForLevel } from './lib/maps';
import { nativeDeltaLabel, payoutStatusLabel, totalCreditedLabel } from './lib/payout';

interface Props {
  open: boolean;
  /** Campaign level being attempted (1-10). Drives the objective text. */
  level: number;
  city: string;
  weather: WeatherSnapshot | null;
  risk: RiskAnalysis | null;
  /** Parent runs the (mock/on-chain) judgment and resolves with the verdict. */
  onSubmit: (action: string) => Promise<LevelOutcome>;
  /** Fired once the verdict is known so the parent can reward/celebrate or shake. */
  onResult: (result: LevelOutcome) => void;
  onClose: () => void;
}

type Mode = 'select' | 'judging' | 'verdict';

// Action presets offered on the cards. These MUST survive the contract's Layer 1
// pre-filter (12..200 chars, at least 3 letter words, no blocked characters), so
// they are full phrases and every one names the gate - the objective the judge
// grades `on_topic` against. Changing a label here changes what gets sent on-chain.
const ICONS: Record<string, string> = {
  'Build a raft and reach the gate': '🏗️',
  'Swim across to the magic gate': '🏃',
  'Use weather magic to reach the gate': '🧙',
};

const TIER_BADGE: Record<string, string> = {
  Low: 'text-success border-success/50 bg-success/10',
  Medium: 'text-warning border-warning/50 bg-warning/10',
  High: 'text-primary border-primary/50 bg-primary/10',
  Extreme: 'text-danger border-danger/50 bg-danger/10',
};

// Re-mounting with a new key replays the shake on every failed attempt.
// Both states MUST restate the base transform: `animate` targets a variant NAME, and
// Framer Motion only animates properties present in the active variant. Because the card
// starts (initial) at opacity 0 / scale 0.85 / y 24, variants that listed only `x` left the
// card permanently transparent - this was the "backdrop shows but content is hidden" bug.
const shake: Variants = {
  idle: { x: 0, scale: 1, opacity: 1, y: 0 },
  shake: { x: [-6, 6, -6, 6, -3, 3, 0], scale: 1, opacity: 1, y: 0 },
};

export default function GateModal({ open, level, city, weather, risk, onSubmit, onResult, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('select');
  const [action, setAction] = useState('');
  const [result, setResult] = useState<LevelOutcome | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  const conditionLine = weather
    ? `${weather.temperature_2m.toFixed(1)}°C · ${weather.wind_speed_10m.toFixed(0)} km/h wind`
    : 'Acquiring telemetry…';
  const condEmoji = weather
    ? weather.kind === 'storm'
      ? '⛈️'
      : weather.kind === 'snow'
        ? '🌨️'
        : weather.kind === 'rain'
          ? '🌧️'
          : weather.kind === 'drizzle'
            ? '🌦️'
            : weather.kind === 'fog'
              ? '🌫️'
              : weather.kind === 'cloud'
                ? '☁️'
                : weather.is_day
                  ? '☀️'
                  : '🌙'
    : '🛰️';

  const submit = async () => {
    const trimmed = action.trim();
    if (!trimmed || mode === 'judging') return;
    setMode('judging');
    let res: LevelOutcome;
    try {
      res = await onSubmit(trimmed);
    } catch {
      // writeCompleteLevel now maps wallet-rejection / revert / funding / timeout into a
      // returned outcome, so reaching here means an unexpected failure in the promise
      // chain. Show a specific, neutral "network error" - never a false "Quest Failed"
      // AI verdict and never a false congestion state.
      res = {
        level: 0,
        success: false,
        timedOut: false,
        errorMessage: 'Network error. Please try again.',
        payoutGen: 0,
        risk: result?.risk ?? ({ multiplier: 1, multiplierX100: 100, risk_tier: 'Low', reasoning: '' }),
        reasoning: 'Network error. Please try again.',
        difficulty: 'Easy',
        city,
        onChain: true,
      };
    }
    setResult(res);
    setMode('verdict');
    // Only a genuine AI-judged-unsafe failure shakes. A congestion timeout OR a specific
    // transaction error (wallet rejection / revert / funding / network) is shown calmly.
    if (!res.success && !res.timedOut && !res.errorMessage) setShakeKey((k) => k + 1);
    onResult(res);
  };

  const retry = () => {
    setMode('select');
    setResult(null);
  };

  const busy = mode === 'judging';
  // Client-side mirror of the contract's Layer 1 gate (12..200 chars, at least 3
  // words containing letters). Blocking here saves a consensus round that would
  // revert anyway; the contract still enforces it, this is only a fast hint.
  const trimmedAction = action.trim();
  const wordish = trimmedAction.split(/\s+/).filter((w) => /[a-z]/i.test(w)).length;
  const tooShort = trimmedAction.length < 12 || wordish < 3;
  const isTimeout = mode === 'verdict' && !!result?.timedOut;
  const isFail = mode === 'verdict' && !!result && !result.success && !result.timedOut;
  // A specific transaction error (wallet rejection / revert / funding / network) is shown
  // verbatim and must NOT shake or read as a generic "AI said no" failure.
  const errorMessage = isFail ? result?.errorMessage : undefined;
  const isHardFail = isFail && !errorMessage;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Dim + blur the game behind the modal */}
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={mode === 'select' ? onClose : undefined}
          />

          <motion.div
            key={shakeKey}
            variants={shake}
            initial={{ scale: 0.85, opacity: 0, y: 24 }}
            animate={isHardFail ? 'shake' : 'idle'}
            transition={{ type: 'spring', damping: 18, stiffness: 320, scale: { duration: 0.25 }, opacity: { duration: 0.2 }, x: { duration: 0.5, ease: 'easeInOut' } }}
            exit={{ scale: 0.9, opacity: 0, transition: { duration: 0.18 } }}
            className={`relative w-full max-w-lg rounded-modal border bg-card p-6 shadow-glow-purple ${
              mode === 'verdict' && result?.success ? 'border-success/60 shadow-glow-green' : ''
            } ${isFail ? 'border-danger/60 shadow-glow-red' : ''} ${isTimeout ? 'border-warning/60' : ''}`}
          >
            {/* ---- Header ---- */}
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="font-mono text-[10px] tracking-[0.3em] text-secondary">genlayer · ai gate</p>
                <h2 className="mt-1 text-2xl font-bold leading-tight">
                  {mode === 'verdict' && result?.success
                    ? 'Gate Unlocked ✨'
                    : isTimeout
                      ? 'Validators Busy ⏳'
                      : 'Magic Gate Locked 🚪'}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Target city: <span className="text-white">{city}</span> {condEmoji}
                </p>
              </div>
              {mode === 'select' && (
                <button
                  onClick={onClose}
                  className="rounded-pill bg-white/5 px-3 py-1 text-xs text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Step back
                </button>
              )}
              {/* Close (X): lets the player dismiss a failure / congestion verdict
                  without being forced to retry. Hidden while the AI is judging. */}
              {mode === 'verdict' && (
                <button
                  onClick={onClose}
                  aria-label="Close"
                  title="Close"
                  className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-white/5 text-lg leading-none text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            {/* ---- Live weather + risk multiplier ---- */}
            <div className="mb-5 grid grid-cols-2 gap-3">
              <div className="rounded-card border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Live Conditions</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {weather?.condition ?? '-'} {condEmoji}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{conditionLine}</p>
              </div>
              <div className="flex flex-col items-center justify-center rounded-card border p-3">
                <div className={`rounded-pill border px-4 py-2 text-center ${risk ? TIER_BADGE[risk.risk_tier] : 'border-white/10 bg-white/5'}`}>
                  <p className="text-2xl font-bold leading-none">
                    {risk ? `${risk.multiplier.toFixed(1)}x` : '-'}
                  </p>
                  <p className="mt-1 font-mono text-[10px] tracking-widest">{risk?.risk_tier ?? 'RISK'}</p>
                </div>
                <p className="mt-1.5 text-[10px] uppercase tracking-wider text-slate-400">Risk Multiplier</p>
              </div>
            </div>

            {/* ---- Body switches by mode ---- */}
            {mode === 'judging' ? (
              <div className="flex flex-col items-center py-10">
                <motion.div
                  animate={{ scale: [1, 1.35, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-secondary text-3xl"
                >
                  🛰️
                </motion.div>
                <p className="animate-pulse text-center text-sm font-semibold text-secondary">
                  AI Validators are analyzing the weather and your action…
                </p>
                <p className="mt-2 font-mono text-[10px] tracking-widest text-slate-500">
                  consensus round · re-fetch · compare · up to 60s
                </p>
                <button
                  onClick={onClose}
                  className="mt-6 rounded-pill border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : mode === 'verdict' && result && isTimeout ? (
              // ---- Validator congestion (NOT a failure - no shake) ----
              <div className="rounded-card border border-warning/50 bg-warning/10 p-4">
                <p className="text-lg font-bold text-warning">⏳ Validators congested</p>
                <p className="mt-1 text-sm text-slate-200">{result.reasoning}</p>
                <p className="mt-2 font-mono text-[11px] text-slate-400">
                  StudioNet is taking longer than 60s to reach consensus. Your transaction may
                  still finalize on-chain - this was not an AI failure.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={retry}
                    className="flex-1 rounded-pill border border-white/15 bg-white/5 py-2.5 font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    Try again
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 rounded-pill bg-primary py-2.5 font-bold text-white transition-colors hover:bg-primary/90"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : mode === 'verdict' && result ? (
              <div
                className={`rounded-card border p-4 ${
                  result.success ? 'border-success/50 bg-success/10' : 'border-danger/50 bg-danger/10'
                }`}
              >
                {/* Specific failure reason (wallet rejection / revert / funding / network),
                    shown prominently ABOVE the failure heading. */}
                {!result.success && errorMessage && (
                  <div className="mb-3 rounded border border-danger/50 bg-danger/10 p-3 text-sm text-danger">
                    ⚠️ {errorMessage}
                  </div>
                )}
                <p className={`text-lg font-bold ${result.success ? 'text-success' : 'text-danger'}`}>
                  {result.success ? '✅ Quest Passed' : isHardFail ? '❌ Quest Failed' : '⚠️ Transaction Failed'}
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {errorMessage
                    ? 'Nothing was charged and this level was not marked conquered - fix the issue and try again.'
                    : result.reasoning}
                </p>
                {result.success ? (
                  <>
                    {/* PER-LEVEL: exactly what get_level_payout(account, level) stored.
                        Never a cumulative or global figure on this line. */}
                    <p className="mt-3 font-mono text-sm text-white" data-testid="level-payout">
                      {result.onChain ? '≈' : '+'}
                      {result.payoutGen.toFixed(4)} GEN{' '}
                      <span className="text-slate-400">
                        (Level {result.level} payout only · × {result.risk.multiplier.toFixed(1)} risk multiplier)
                      </span>
                    </p>
                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-slate-400" data-testid="settlement-proof">
                      {result.onChain ? (
                        <>
                          <span data-testid="verdict-status">⛓ Verdict settled on-chain</span>
                          {result.txHash ? (
                            <>
                              {' '}· tx <HashLink hash={result.txHash} testId="tx-hash-link" />
                            </>
                          ) : null}
                          <br />
                          <span data-testid="payout-status">
                            {payoutStatusLabel(result.payoutStatus, result.levelPayoutAtto)}
                          </span>
                          {result.payoutTxHash ? (
                            <>
                              {' '}· payout tx <HashLink hash={result.payoutTxHash} testId="payout-tx-link" />
                            </>
                          ) : null}
                          {/* WALLET-NATIVE: measured balance before -> after (proof it landed). */}
                          <br />
                          <span data-testid="native-delta">
                            {nativeDeltaLabel(result.nativeBeforeAtto, result.nativeAfterAtto)}
                            {result.nativeDeltaMatches === false ? ' · does not match the level payout yet' : ''}
                          </span>
                          {/* PER-PLAYER cumulative: explicitly all levels, not this prize. */}
                          <br />
                          <span data-testid="total-credited">
                            {totalCreditedLabel(result.totalCreditAtto ?? 0n)}
                          </span>
                        </>
                      ) : (
                        <>
                          🎮 Demo - reward simulated locally. Connect a wallet to settle on-chain.{' '}
                          <span data-testid="demo-objective">Objective graded on-chain: {objectiveForLevel(level)}</span>
                        </>
                      )}
                    </p>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={onClose}
                      className="mt-4 w-full rounded-pill bg-primary py-2.5 font-bold text-white transition-colors hover:bg-primary/90"
                    >
                      {result.onChain ? 'Open the gate · verdict settled →' : 'Open the gate →'}
                    </motion.button>
                  </>
                ) : (
                  // ---- Genuine AI failure: retry OR close without retrying (issue 2) ----
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={retry}
                      className="flex-1 rounded-pill border border-white/15 bg-white/5 py-2.5 font-semibold text-white transition-colors hover:bg-white/10"
                    >
                      Try a different action
                    </button>
                    <button
                      onClick={onClose}
                      className="rounded-pill border border-white/15 bg-white/5 px-5 py-2.5 font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* ---- Action cards ---- */}
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-400">
                  Choose your action
                </p>
                {/* The exact string the contract's LEVEL_OBJECTIVE feeds the judge, so
                    the player sees the bar their action is graded against. */}
                <p className="mb-3 rounded-card border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-slate-300">
                  <span className="uppercase tracking-wider text-slate-500">Objective · </span>
                  <span data-testid="level-objective">{objectiveForLevel(level)}</span>
                  <span className="text-slate-500"> · off-topic or empty text is rejected, even in calm weather.</span>
                </p>
                <div className="mb-4 grid grid-cols-3 gap-3">
                  {Object.entries(ICONS).map(([name, icon]) => {
                    const selected = action.includes(name);
                    return (
                      <motion.button
                        key={name}
                        whileHover={{ y: -3 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setAction(selected ? '' : name)}
                        className={`flex flex-col items-center gap-1.5 rounded-card border p-3 text-center transition-colors ${
                          selected
                            ? 'border-secondary bg-secondary/20 shadow-glow-purple'
                            : 'border-white/10 bg-white/5 hover:border-white/25'
                        }`}
                      >
                        <span className="text-2xl">{icon}</span>
                        <span className="text-xs font-semibold leading-tight">{name}</span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* ---- Custom input ---- */}
                <div className="flex gap-2">
                  <input
                    value={action}
                    maxLength={200}
                    onChange={(e) => setAction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submit();
                    }}
                    placeholder="Or type your own custom action..."
                    className="min-w-0 flex-1 rounded-pill border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-500 focus:border-secondary"
                  />
                  <motion.button
                    whileHover={{ scale: action.trim() && !tooShort ? 1.03 : 1 }}
                    whileTap={{ scale: action.trim() && !tooShort ? 0.97 : 1 }}
                    disabled={!action.trim() || busy || tooShort}
                    onClick={() => void submit()}
                    className="rounded-pill bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Submit
                  </motion.button>
                </div>
                {tooShort && trimmedAction.length > 0 && (
                  <p className="mt-2 text-[11px] text-warning" data-testid="action-too-short">
                    Needs at least 12 characters and 3 words of real text - short filler is
                    rejected on-chain and pays nothing.
                  </p>
                )}
                <p className="mt-3 font-mono text-[10px] leading-relaxed text-slate-500">
                  the ai validator checks your action against the objective above and the live
                  {city} conditions. text aimed at the judge, empty filler, or anything off-topic
                  is rejected and pays nothing.
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
