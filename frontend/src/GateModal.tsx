// ============================================================================
// GateModal — the "Magic Gate Locked" AI challenge overlay.
//
// Rendered when the Kaboom player walks into the closed Magic Gate. The game
// is paused while this modal is open. It shows the live weather + risk
// multiplier, offers 3 action cards plus a custom input, runs a "judging"
// state, and animates the verdict (success glow / failure shake).
//
// The actual verdict comes from `onSubmit` (the parent), which reuses the
// project's existing `submitAction` demo/heuristic logic — the same function
// the old UI used. No contract code was changed.
// ============================================================================
import { useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import type { LevelOutcome, RiskAnalysis, WeatherSnapshot } from './types';

interface Props {
  open: boolean;
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

const ICONS: Record<string, string> = {
  'Build a Raft': '🏗️',
  'Swim Across': '🏃',
  'Use Weather Magic': '🧙',
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
// card permanently transparent — this was the "backdrop shows but content is hidden" bug.
const shake: Variants = {
  idle: { x: 0, scale: 1, opacity: 1, y: 0 },
  shake: { x: [-6, 6, -6, 6, -3, 3, 0], scale: 1, opacity: 1, y: 0 },
};

export default function GateModal({ open, city, weather, risk, onSubmit, onResult, onClose }: Props) {
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
      // On-chain settlement can fail on StudioNet (validators congested / timeout).
      // Show an honest non-settled verdict instead of hanging on "analyzing…".
      res = {
        level: 0,
        success: false,
        payoutGen: 0,
        risk: result?.risk ?? ({ multiplier: 1, multiplierX100: 100, risk_tier: 'Low', reasoning: '' }),
        reasoning:
          'On-chain settlement did not confirm — StudioNet validators may be congested or the transaction timed out. Nothing was charged and the level was NOT completed; try again shortly, or play in demo mode.',
        difficulty: 'Easy',
        city,
        optimalSteps: 0,
        actualSteps: 0,
        efficiency: 'Good',
        efficiencyX100: 100,
        onChain: true,
      };
    }
    setResult(res);
    setMode('verdict');
    if (!res.success) setShakeKey((k) => k + 1);
    onResult(res);
  };

  const retry = () => {
    setMode('select');
    setResult(null);
  };

  const busy = mode === 'judging';

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
            animate={mode === 'verdict' && result && !result.success ? 'shake' : 'idle'}
            transition={{ type: 'spring', damping: 18, stiffness: 320, scale: { duration: 0.25 }, opacity: { duration: 0.2 }, x: { duration: 0.5, ease: 'easeInOut' } }}
            exit={{ scale: 0.9, opacity: 0, transition: { duration: 0.18 } }}
            className={`relative w-full max-w-lg rounded-modal border bg-card p-6 shadow-glow-purple ${
              mode === 'verdict' && result?.success ? 'border-success/60 shadow-glow-green' : ''
            } ${mode === 'verdict' && result && !result.success ? 'border-danger/60 shadow-glow-red' : ''}`}
          >
            {/* ---- Header ---- */}
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="font-mono text-[10px] tracking-[0.3em] text-secondary">genlayer · ai gate</p>
                <h2 className="mt-1 text-2xl font-bold leading-tight">
                  {mode === 'verdict' && result?.success ? 'Gate Unlocked ✨' : 'Magic Gate Locked 🚪'}
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
            </div>

            {/* ---- Live weather + risk multiplier ---- */}
            <div className="mb-5 grid grid-cols-2 gap-3">
              <div className="rounded-card border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Live Conditions</p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {weather?.condition ?? '—'} {condEmoji}
                </p>
                <p className="mt-0.5 font-mono text-xs text-slate-400">{conditionLine}</p>
              </div>
              <div className="flex flex-col items-center justify-center rounded-card border p-3">
                <div className={`rounded-pill border px-4 py-2 text-center ${risk ? TIER_BADGE[risk.risk_tier] : 'border-white/10 bg-white/5'}`}>
                  <p className="text-2xl font-bold leading-none">
                    {risk ? `${risk.multiplier.toFixed(1)}x` : '—'}
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
                  consensus round · re-fetch · compare
                </p>
              </div>
            ) : mode === 'verdict' && result ? (
              <div
                className={`rounded-card border p-4 ${
                  result.success ? 'border-success/50 bg-success/10' : 'border-danger/50 bg-danger/10'
                }`}
              >
                <p className={`text-lg font-bold ${result.success ? 'text-success' : 'text-danger'}`}>
                  {result.success ? '✅ Quest Passed' : '❌ Quest Failed'}
                </p>
                <p className="mt-1 text-sm text-slate-200">{result.reasoning}</p>
                {result.success ? (
                  <>
                    <p className="mt-3 font-mono text-sm text-white">
                      {result.onChain ? '≈' : '+'}
                      {result.payoutGen.toFixed(2)} GEN{' '}
                      <span className="text-slate-400">
                        (× {result.risk.multiplier.toFixed(1)} risk multiplier)
                      </span>
                    </p>
                    <p className="mt-1 font-mono text-[11px] leading-relaxed text-slate-400">
                      {result.onChain ? (
                        <>
                          ⛓ Settled on-chain — validators transferred GEN straight to your wallet
                          {result.txHash ? (
                            <>
                              {' '}· tx{' '}
                              <span className="text-secondary">
                                {result.txHash.slice(0, 10)}…{result.txHash.slice(-6)}
                              </span>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>🎮 Demo — reward simulated locally. Connect a wallet to settle on-chain.</>
                      )}
                    </p>
                    {/* ---- Navigation-efficiency breakdown ---- */}
                    <div className="mt-3 rounded-card border border-white/10 bg-white/5 p-3">
                      <p className="font-mono text-xs text-slate-200">
                        You took {result.actualSteps} steps · optimal was {result.optimalSteps} · efficiency{' '}
                        {Math.min(
                          100,
                          Math.round((result.optimalSteps / Math.max(1, result.actualSteps)) * 100),
                        )}
                        %
                      </p>
                      <p className="mt-1 font-mono text-[11px] text-slate-400">
                        Efficiency ×{(result.efficiencyX100 / 100).toFixed(2)} ·{' '}
                        <span
                          className={
                            result.efficiency === 'Perfect'
                              ? 'text-success'
                              : result.efficiency === 'Lost'
                                ? 'text-danger'
                                : 'text-secondary'
                          }
                        >
                          {result.efficiency} run
                        </span>
                      </p>
                      {result.efficiency === 'Lost' && (
                        <p className="mt-2 rounded-card border border-danger/40 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger">
                          You got lost! The AI penalized your reward for inefficiency. 🗺️
                        </p>
                      )}
                      {result.efficiency === 'Perfect' && (
                        <p className="mt-2 text-xs font-semibold text-success">
                          Flawless navigation — speed bonus applied! ⚡
                        </p>
                      )}
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={onClose}
                      className="mt-4 w-full rounded-pill bg-primary py-2.5 font-bold text-white transition-colors hover:bg-primary/90"
                    >
                      {result.onChain ? 'Reward sent — open the gate →' : 'Open the gate →'}
                    </motion.button>
                  </>
                ) : (
                  <button
                    onClick={retry}
                    className="mt-4 w-full rounded-pill border border-white/15 bg-white/5 py-2.5 font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    Try a different action
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* ---- Action cards ---- */}
                <p className="mb-2 text-[10px] uppercase tracking-wider text-slate-400">
                  Choose your action
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
                    onChange={(e) => setAction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submit();
                    }}
                    placeholder="Or type your own custom action..."
                    className="min-w-0 flex-1 rounded-pill border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-500 focus:border-secondary"
                  />
                  <motion.button
                    whileHover={{ scale: action.trim() ? 1.03 : 1 }}
                    whileTap={{ scale: action.trim() ? 0.97 : 1 }}
                    disabled={!action.trim() || busy}
                    onClick={() => void submit()}
                    className="rounded-pill bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Submit
                  </motion.button>
                </div>
                <p className="mt-3 font-mono text-[10px] leading-relaxed text-slate-500">
                  the ai validator re-checks live {city} weather and judges whether your action is
                  safe for these conditions.
                </p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
