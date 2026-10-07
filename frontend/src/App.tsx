import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import confetti from "canvas-confetti";
import Game from "./Game";
import GateModal from "./GateModal";
import HUD from "./components/HUD";
import DemoModeNotice from "./components/DemoModeNotice";
import LevelSelect from "./components/LevelSelect";
import { getWeatherByCity, previewRisk } from "./lib/weather";
import {
  completeLevel,
  connectOnChainWallet,
  connectWallet,
  fetchCompletedLevels,
  fetchGenBalance,
} from "./lib/contract";
import { fetchIPLocation, FALLBACK_LOCATION } from "./lib/geolocation";
import { MAX_LEVEL, cityForLevel, computeOptimalSteps } from "./lib/maps";
import type { LevelOutcome, RiskAnalysis, WalletState, WeatherSnapshot } from "./types";

const START_BALANCE = 25;

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
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
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

type Phase = "menu" | "playing";

/**
 * WeatherGate campaign shell.
 *
 * - Level-select hub (1-10) with "Already Conquered ✅" badges from campaign_progress.
 * - Level 1 is themed to the player's IP-detected home city (fallback London).
 * - Walking a level: touch the closed Magic Gate → AI gate challenge (complete_level)
 *   → on success the gate opens → reach the ★ victory zone → "Level Up!" auto-advance.
 * - HUD shows wallet (Demo Mode or connected GenLayer address), level, city, GEN balance.
 * The GenLayer contract owns all authoritative weather-judgment + reward logic (125 tests).
 */
export default function App() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [wallet, setWallet] = useState<WalletState>({ mode: "demo", address: "", connecting: false });
  const [homeCity, setHomeCity] = useState<string>(FALLBACK_LOCATION.city);
  const [completed, setCompleted] = useState<number[]>([]);
  const [balance, setBalance] = useState(START_BALANCE);
  const displayBalance = useCountUp(balance);

  const [currentLevel, setCurrentLevel] = useState(1);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskAnalysis | null>(null);
  const [steps, setSteps] = useState(0);

  const [gateOpen, setGateOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [session, setSession] = useState(0);
  // Bumped every time the closed gate is touched so the GateModal remounts fresh
  // (resets select/judging/verdict state). It is deliberately SEPARATE from
  // `session`, which keys the Kaboom canvas - bumping `session` here would remount
  // the game and teleport the player back to spawn mid-level.
  const [gateNonce, setGateNonce] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<{ from: number; to: string } | null>(null);

  const passedRef = useRef(false);
  const outcomeRef = useRef<LevelOutcome | null>(null);
  const stepsRef = useRef(0); // step count captured when the gate is reached (cosmetic)
  const completedRef = useRef<number[]>([]);
  completedRef.current = completed;
  const walletModeRef = useRef(wallet.mode);
  walletModeRef.current = wallet.mode;
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const city = cityForLevel(currentLevel, homeCity);
  const nextLevel = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find((l) => !completed.includes(l)) ?? 0;

  // --- Boot: demo wallet + IP city + saved progress ------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const w = await connectWallet();
      if (!alive) return;
      setWallet(w);
      const [loc, done] = await Promise.all([fetchIPLocation(), fetchCompletedLevels(w)]);
      if (!alive) return;
      setHomeCity(loc.city);
      setCompleted(done);
      const start = w.mode === "onchain" ? await fetchGenBalance(w) : null;
      if (alive && start != null) setBalance(start);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- Live weather for the active level's city ----------------------------
  useEffect(() => {
    if (phase !== "playing") return;
    let alive = true;
    setWeather(null);
    setRisk(null);
    getWeatherByCity(cityForLevel(currentLevel, homeCity))
      .then((w) => {
        if (!alive) return;
        setWeather(w);
        setRisk(previewRisk(w));
      })
      .catch(() => alive && setBanner("Weather service unavailable - showing offline preview."));
    return () => {
      alive = false;
    };
  }, [phase, currentLevel, homeCity]);

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const enterLevel = useCallback(
    (level: number) => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      passedRef.current = false;
      outcomeRef.current = null;
      stepsRef.current = 0;
      setSteps(0);
      setSession((s) => s + 1);
      setCurrentLevel(level);
      setModalOpen(false);
      setPaused(false);
      setLevelUp(null);
      // EVERY level requires the AI gate challenge, so the gate always starts closed.
      // The lone exception is an ON-CHAIN replay of an already-settled level, where
      // re-calling complete_level would trip the contract's anti-cheat revert - there
      // we open the gate so the player can simply stroll to the ★. In Demo Mode,
      // progress persists locally but the challenge is still mandatory each time,
      // which is why a freshly-advanced level no longer greets you with an open gate.
      const done = completedRef.current.includes(level);
      const openGate = done && walletModeRef.current === "onchain";
      setGateOpen(openGate);
      setBanner(
        openGate
          ? `Level ${level} already settled on-chain - walk into the ★ zone to move on.`
          : "⛩ Reach the gate and answer the AI challenge to unlock it.",
      );
      setPhase("playing");
    },
    [],
  );

  const goMenu = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    setLevelUp(null);
    setModalOpen(false);
    setPaused(false);
    setBanner(null);
    setPhase("menu");
  }, []);

  // Player touched the closed gate -> pause, capture the step count, open the AI
  // challenge. `s` is the number of cells entered en route (cosmetic only).
  const handleGate = useCallback((s: number) => {
    if (gateOpen) return;
    passedRef.current = false;
    stepsRef.current = s;
    setSteps(s);
    ensureAudio();
    setGateNonce((n) => n + 1);
    setModalOpen(true);
    setPaused(true);
  }, [gateOpen]);

  // Run the (demo/on-chain) judgment for this campaign level. The reward is base *
  // weather only; the live step counter is a purely cosmetic stat and is NOT sent.
  const handleSubmit = useCallback(
    async (action: string): Promise<LevelOutcome> => {
      ensureAudio();
      const outcome = await completeLevel({
        level: currentLevel,
        homeCity,
        action,
        wallet,
      });
      outcomeRef.current = outcome;
      return outcome;
    },
    [currentLevel, homeCity, wallet],
  );

  // Verdict known: reward + confetti + chime on pass; the modal shakes on fail.
  const handleResult = useCallback((result: LevelOutcome) => {
    const outcome = outcomeRef.current;
    if (result.success) {
      passedRef.current = true;
      const gained = outcome && !outcome.alreadyCompleted ? outcome.payoutGen : 0;
      if (outcome && outcome.level) {
        setCompleted((prev) => (prev.includes(outcome.level) ? prev : [...prev, outcome.level].sort((a, b) => a - b)));
      }
      if (wallet.mode === "demo") {
        setBalance((b) => b + gained);
      } else {
        void (async () => {
          const bal = await fetchGenBalance(wallet);
          if (bal != null) setBalance(bal);
        })();
      }
      fireConfetti();
      playChime();
    } else {
      passedRef.current = false;
    }
  }, [wallet]);

  // Closing the modal: if the challenge passed, unlock the gate and resume.
  const handleModalClose = useCallback(() => {
    setModalOpen(false);
    setPaused(false);
    if (passedRef.current) {
      setGateOpen(true);
      setBanner("🟢 Gate open! Walk into the ★ victory zone to advance.");
    }
  }, []);

  // Reached the victory zone: celebrate, show "Level Up!", auto-advance.
  const handleVictory = useCallback(() => {
    fireConfetti();
    if (currentLevel >= MAX_LEVEL) {
      setBanner("🏆 Campaign complete - you conquered every weather world!");
      return;
    }
    const next = currentLevel + 1;
    const nextCity = cityForLevel(next, homeCity);
    setLevelUp({ from: currentLevel, to: nextCity });
    advanceTimer.current = setTimeout(() => enterLevel(next), 1600);
  }, [currentLevel, homeCity, enterLevel]);

  // Wallet connect / disconnect (Demo <-> GenLayer on-chain).
  const handleConnect = useCallback(async () => {
    setWallet((w) => ({ ...w, connecting: true }));
    try {
      const w = await connectOnChainWallet();
      setWallet(w);
      const [done, bal] = await Promise.all([fetchCompletedLevels(w), fetchGenBalance(w)]);
      setCompleted(done);
      if (bal != null) setBalance(bal);
      setBanner(`⛓ Connected ${w.address.slice(0, 6)}…${w.address.slice(-4)} - playing on-chain.`);
    } catch (e) {
      setWallet((w) => ({ ...w, connecting: false }));
      setBanner(e instanceof Error ? `⚠ ${e.message}` : "Wallet connection failed.");
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    const w = await connectWallet();
    setWallet(w);
    setCompleted(await fetchCompletedLevels(w));
    setBalance(START_BALANCE);
    setBanner("🎮 Back in Demo Mode - no wallet needed.");
  }, []);

  // Dev-only seams so the AI-gate modal, victory->advance, and level jumps can be
  // exercised directly without pixel-perfect canvas walking. __wgOpenGate takes a
  // synthetic step count for the cosmetic counter. Vite replaces
  // `import.meta.env.DEV` with `false` in production, so these are stripped from
  // the built bundle and never reachable by reviewers on GitHub Pages.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __wgOpenGate?: (steps?: number) => void;
      __wgWin?: () => void;
      __wgPlay?: (level: number) => void;
    };
    w.__wgOpenGate = (s = 0) => handleGate(s);
    w.__wgWin = handleVictory;
    w.__wgPlay = enterLevel;
    return () => {
      delete w.__wgOpenGate;
      delete w.__wgWin;
      delete w.__wgPlay;
    };
  }, [handleGate, handleVictory, enterLevel]);

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="relative w-full max-w-3xl">
        {/* Title */}
        <div className="mb-3 text-center">
          <h1 className="text-2xl font-black tracking-tight neon-text">WeatherGate</h1>
          <p className="text-xs text-muted">A 2D AI-gated weather RPG · move with WASD / arrow keys</p>
        </div>

        <DemoModeNotice mode={wallet.mode} />

        {phase === "menu" ? (
          <div className="relative">
            {/* Compact wallet/balance bar on the menu */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="glass rounded-card px-3 py-2 shadow-card">
                <span
                  title={
                    wallet.mode === "onchain"
                      ? "On-chain: playing against the deployed GenLayer contract."
                      : "Demo Mode: Progress saved locally. Connect wallet for on-chain play."
                  }
                  className={
                    wallet.mode === "onchain"
                      ? "chip bg-success/15 text-success"
                      : "inline-flex animate-pulse items-center rounded-pill bg-gradient-to-r from-warning to-primary px-4 py-1.5 text-sm font-extrabold uppercase tracking-wide text-black shadow-glow-purple"
                  }
                >
                  {wallet.mode === "onchain" ? "⛓ On-chain" : "🎮 Demo Mode"}
                </span>
                <span className="ml-2 font-mono text-sm text-ink">
                  {displayBalance.toFixed(1)} <span className="text-muted">GEN</span>
                </span>
              </div>
              {wallet.mode === "demo" ? (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => void handleConnect()}
                  disabled={wallet.connecting}
                  className="rounded-pill bg-gradient-to-r from-primary to-secondary px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
                >
                  {wallet.connecting ? "Connecting…" : "Connect GenLayer Wallet"}
                </motion.button>
              ) : (
                <button
                  onClick={() => void handleDisconnect()}
                  className="rounded-pill border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-ink hover:bg-white/10"
                >
                  Disconnect
                </button>
              )}
            </div>

            <LevelSelect homeCity={homeCity} completed={completed} nextLevel={nextLevel} onPlay={enterLevel} />

            {banner && (
              <div className="mt-4 flex justify-center">
                <span className="glass rounded-pill px-3 py-1 text-[11px] text-muted">{banner}</span>
              </div>
            )}
          </div>
        ) : (
          <div>
            <HUD
              mode={wallet.mode}
              address={wallet.address}
              connecting={wallet.connecting}
              onConnect={() => void handleConnect()}
              onDisconnect={() => void handleDisconnect()}
              level={currentLevel}
              city={city}
              displayBalance={displayBalance}
              weather={weather}
              risk={risk}
              steps={steps}
              optimalSteps={computeOptimalSteps(currentLevel)}
            />

            <div className="relative">
            {/* Game canvas (Kaboom mounts its canvas here). Keyed by level so the map regenerates. */}
            <Game
              key={`${currentLevel}-${session}`}
              level={currentLevel}
              gateOpen={gateOpen}
              paused={paused}
              onGateReached={handleGate}
              onVictoryReached={handleVictory}
              onStepsChanged={setSteps}
            />

            {/* Back-to-menu + status banner */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 p-2">
              <button
                onClick={goMenu}
                className="pointer-events-auto rounded-pill bg-black/40 px-3 py-1 text-[11px] text-ink backdrop-blur hover:bg-black/60"
              >
                ← Levels
              </button>
              <span className="glass rounded-pill px-3 py-1 text-[11px] text-muted">
                {banner ?? "⛩ reach the gate · ★ victory zone"}
              </span>
            </div>

            {/* "Level Up!" auto-advance flourish */}
            <AnimatePresence>
              {levelUp && (
                <motion.div
                  className="pointer-events-none absolute inset-0 z-[80] flex flex-col items-center justify-center rounded-modal bg-black/70 backdrop-blur-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <motion.div
                    initial={{ scale: 0.4, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    transition={{ type: "spring", damping: 12, stiffness: 260 }}
                    className="text-center"
                  >
                    <p className="text-sm uppercase tracking-[0.4em] text-secondary">Level {levelUp.from} conquered</p>
                    <h2 className="mt-2 text-4xl font-black text-[#fff]">
                      LEVEL UP <span className="text-primary">→</span>{" "}
                      <span className="neon-text">{levelUp.to}</span>
                    </h2>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
            </div>

            {/* AI Gate Modal (challenge for the current level's city) */}
            <GateModal
              key={`${currentLevel}-${gateNonce}`}
              open={modalOpen}
              city={city}
              weather={weather}
              risk={risk}
              onSubmit={handleSubmit}
              onResult={handleResult}
              onClose={handleModalClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}
