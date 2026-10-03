import { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import Game from "./Game";
import GateModal from "./GateModal";
import { getWeatherByCity, previewRisk } from "./lib/weather";
import { submitAction } from "./lib/contract";
import type { ActionResult, Quest, RiskAnalysis, WeatherSnapshot } from "./types";

/** The city whose live weather gates the challenge (mirrors the contract's demo city). */
const CITY = "London";
const START_BALANCE = 25;

/**
 * A minimal quest descriptor reused by the existing `submitAction` demo/heuristic
 * judgment (the same function the old dashboard used — the GenLayer contract and
 * its tests are untouched). Only `city` and `baseRewardGen` matter to the mock.
 */
const GATE_QUEST: Quest = {
  questId: "GATE-LONDON",
  city: CITY,
  creator: "player",
  baseRewardGen: 10,
  description: "Cross the Magic Gate",
  createdAt: 0,
  expiresAt: Number.MAX_SAFE_INTEGER,
  status: "Active",
  submissionCount: 0,
};

const TIER_COLOR: Record<string, string> = {
  Low: "text-success",
  Medium: "text-warning",
  High: "text-primary",
  Extreme: "text-danger",
};

// --- Optional WebAudio chime (no asset files; silently no-ops if unsupported) ---
let audioCtx: AudioContext | null = null;
function ensureAudio() {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    /* audio is a nice-to-have */
  }
}
function playChime() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const notes: Array<[number, number]> = [
      [880, 0],
      [1320, 0.12],
    ];
    for (const [freq, offset] of notes) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const t = now + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
  } catch {
    /* ignore */
  }
}

function fireConfetti() {
  const colors = ["#FF6B35", "#6B46C1", "#48BB78", "#F6E27E", "#38BDF8"];
  const base = { zIndex: 60, colors, disableForReducedMotion: true };
  confetti({ ...base, particleCount: 110, spread: 360, startVelocity: 38, origin: { x: 0.5, y: 0.55 } });
  confetti({ ...base, particleCount: 45, angle: 60, spread: 80, origin: { x: 0, y: 0.7 } });
  confetti({ ...base, particleCount: 45, angle: 120, spread: 80, origin: { x: 1, y: 0.7 } });
}

/** Ease a number toward its target over `duration` ms (for the HUD count-up). */
function useCountUp(value: number, duration = 900): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    // Honour reduced-motion (and environments where rAF never ticks): snap straight to target.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else {
        fromRef.current = value;
        setDisplay(value);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

/**
 * WeatherGate game shell: the Kaboom 2D field + Tailwind cyberpunk HUD, with the
 * AI Gate Modal wired into the game's `onGateReached` seam. SUCCESS opens the
 * gate (green sprite + confetti + balance bump); FAIL shakes the modal and keeps
 * the gate closed. The contract/tests/deployment are unchanged.
 */
export default function App() {
  const [balance, setBalance] = useState(START_BALANCE);
  const displayBalance = useCountUp(balance);
  const [gateOpen, setGateOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [session, setSession] = useState(0); // bump to remount the modal fresh
  const [banner, setBanner] = useState<string | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskAnalysis | null>(null);
  const passedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    getWeatherByCity(CITY)
      .then((w) => {
        if (!alive) return;
        setWeather(w);
        setRisk(previewRisk(w));
      })
      .catch(() => {
        if (alive) setBanner("Weather service unavailable — showing offline preview.");
      });
    return () => {
      alive = false;
    };
  }, []);

  // Player touched the closed gate → pause and open the AI challenge.
  const handleGate = useCallback(() => {
    if (gateOpen) return;
    passedRef.current = false;
    ensureAudio(); // unlock audio inside the input frame so the later chime plays
    setSession((s) => s + 1);
    setModalOpen(true);
    setPaused(true);
  }, [gateOpen]);

  // Run the (mock/on-chain) judgment. Celebration lives in handleResult.
  const handleSubmit = useCallback(async (action: string): Promise<ActionResult> => {
    ensureAudio();
    return submitAction(GATE_QUEST, action);
  }, []);

  // Verdict known: reward + confetti + chime on pass; the modal handles the shake on fail.
  const handleResult = useCallback((result: ActionResult) => {
    if (result.success) {
      passedRef.current = true;
      setBalance((b) => b + result.payoutGen);
      fireConfetti();
      playChime();
    } else {
      passedRef.current = false;
    }
  }, []);

  // Closing the modal: if the challenge passed, unlock the gate and resume.
  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setPaused(false);
    if (passedRef.current) {
      setGateOpen(true);
      setBanner("🟢 Gate open! Walk right into the ★ victory zone.");
    }
  }, []);

  const handleVictory = useCallback(() => {
    fireConfetti();
    setBanner("🏆 Victory! You crossed the AI-gated challenge.");
  }, []);

  // Dev-only seam so the AI-gate modal + reward flow can be exercised directly
  // without walking (the Kaboom loop needs a focused rAF tab). Vite replaces
  // `import.meta.env.DEV` with `false` in production, so this is stripped from
  // the built bundle and never reachable by reviewers on GitHub Pages.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __wgOpenGate?: () => void };
    w.__wgOpenGate = handleGate;
    return () => {
      delete w.__wgOpenGate;
    };
  }, [handleGate]);

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="relative w-full max-w-3xl">
        {/* Title */}
        <div className="mb-3 text-center">
          <h1 className="text-2xl font-black tracking-tight neon-text">WeatherGate</h1>
          <p className="text-xs text-muted">A 2D AI-gated mini RPG · move with WASD / arrow keys</p>
        </div>

        {/* Game canvas (Kaboom mounts its canvas into this via Game.tsx) */}
        <Game
          gateOpen={gateOpen}
          paused={paused}
          onGateReached={handleGate}
          onVictoryReached={handleVictory}
        />

        {/* HUD overlay — cyberpunk panels floating on top of the canvas */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
          {/* Top-left: GEN balance */}
          <div className="pointer-events-auto glass rounded-card px-3 py-2 shadow-card">
            <div className="text-[10px] uppercase tracking-widest text-muted">GEN Balance</div>
            <div className="flex items-baseline gap-1 font-mono text-lg font-bold text-primary">
              {displayBalance.toFixed(1)}
              <span className="text-xs text-muted">GEN</span>
            </div>
          </div>

          {/* Top-right: live weather widget synced to the challenge city */}
          <div className="pointer-events-auto glass rounded-card px-3 py-2 text-right shadow-card">
            <div className="text-[10px] uppercase tracking-widest text-muted">{CITY} · live</div>
            {weather && risk ? (
              <>
                <div className="text-sm font-semibold text-ink">{weather.condition}</div>
                <div className={`text-xs font-bold ${TIER_COLOR[risk.risk_tier] ?? "text-ink"}`}>
                  {risk.multiplier.toFixed(1)}x · {risk.risk_tier}
                </div>
              </>
            ) : (
              <div className="text-sm text-muted">loading weather…</div>
            )}
          </div>
        </div>

        {/* Controls hint / status banner */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-2">
          <span className="glass rounded-pill px-3 py-1 text-[11px] text-muted">
            {banner ?? "⛩ reach the gate · ★ victory zone"}
          </span>
        </div>

        {/* AI Gate Modal */}
        <GateModal
          key={session}
          open={modalOpen}
          city={CITY}
          weather={weather}
          risk={risk}
          onSubmit={handleSubmit}
          onResult={handleResult}
          onClose={handleModalClose}
        />
      </div>
    </div>
  );
}
