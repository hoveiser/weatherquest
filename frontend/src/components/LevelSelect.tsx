import { motion } from "framer-motion";
import {
  MAX_LEVEL,
  baseRewardGen,
  cityForLevel,
  difficultyBand,
  type DifficultyBand,
} from "../lib/maps";

interface Props {
  homeCity: string;
  completed: number[];
  nextLevel: number;
  onPlay: (level: number) => void;
}

const BAND_STYLE: Record<DifficultyBand, string> = {
  Easy: "text-success border-success/40 bg-success/10",
  Medium: "text-warning border-warning/40 bg-warning/10",
  Hard: "text-danger border-danger/40 bg-danger/10",
};

const BAND_ICON: Record<DifficultyBand, string> = {
  Easy: "🌤️",
  Medium: "⛅",
  Hard: "⛈️",
};

/**
 * The campaign hub: levels 1-10, each bound to a fixed campaign city from
 * CAMPAIGN_CITIES (Level 1 is always Istanbul, never the detected location).
 * Conquered levels show a green "Already Conquered ✅" badge; the recommended
 * next level is highlighted.
 */
export default function LevelSelect({ homeCity, completed, nextLevel, onPlay }: Props) {
  const levels = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
  const doneCount = completed.length;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-black tracking-tight neon-text">Campaign</h2>
          <p className="text-xs text-muted">
            Conquer {MAX_LEVEL} weather-gated worlds · {doneCount}/{MAX_LEVEL} cleared
          </p>
        </div>
        <div className="text-right text-xs text-muted">
          <div>Detected location (cosmetic)</div>
          <div className="font-semibold text-ink">{homeCity}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {levels.map((level) => {
          const band = difficultyBand(level);
          const isDone = completed.includes(level);
          const isNext = level === nextLevel;
          const base = baseRewardGen(level);
          const maxPayout = base * 5;
          return (
            <motion.button
              key={level}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onPlay(level)}
              className={`relative flex flex-col gap-1 rounded-card border p-3 text-left transition-colors ${
                isNext
                  ? "border-primary/60 bg-primary/10 shadow-glow"
                  : isDone
                    ? "border-success/40 bg-success/5"
                    : "border-white/10 bg-white/5 hover:border-white/25"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-widest text-muted">LVL {level}</span>
                <span className={`chip border px-2 py-0.5 text-[10px] ${BAND_STYLE[band]}`}>
                  {BAND_ICON[band]} {band}
                </span>
              </div>

              <div className="truncate text-sm font-bold text-ink">
                {cityForLevel(level, homeCity)}
              </div>
              <div className="font-mono text-[11px] text-muted">
                {base.toFixed(2)} GEN base · up to {maxPayout.toFixed(2)} GEN
              </div>

              <div className="mt-1">
                {isDone ? (
                  <span className="text-xs font-bold text-success">Already Conquered ✅</span>
                ) : isNext ? (
                  <span className="text-xs font-bold text-primary">▶ Play next</span>
                ) : (
                  <span className="text-xs text-muted">Play</span>
                )}
              </div>

              {isDone && (
                <div className="absolute right-2 top-2 text-success" aria-hidden>
                  ✓
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
