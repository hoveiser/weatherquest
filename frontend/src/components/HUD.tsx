import { motion } from "framer-motion";
import type { RiskAnalysis, WalletMode, WeatherSnapshot } from "../types";
import { shortAddr } from "../lib/format";

interface Props {
  mode: WalletMode;
  address: string;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  level: number;
  city: string;
  displayBalance: number;
  weather: WeatherSnapshot | null;
  risk: RiskAnalysis | null;
}

const TIER_COLOR: Record<string, string> = {
  Low: "text-success",
  Medium: "text-warning",
  High: "text-primary",
  Extreme: "text-danger",
};

/** Cyberpunk HUD floating over the game canvas: wallet, level, city, balance. */
export default function HUD({
  mode,
  address,
  connecting,
  onConnect,
  onDisconnect,
  level,
  city,
  displayBalance,
  weather,
  risk,
}: Props) {
  const onchain = mode === "onchain";
  return (
    <>
      {/* Top-left: wallet + GEN balance */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
        <div className="flex flex-col gap-2">
          {/* Wallet control */}
          <div className="pointer-events-auto glass rounded-card px-3 py-2 shadow-card">
            <div className="flex items-center gap-2">
              <span
                className={`chip ${onchain ? "bg-success/15 text-success" : "bg-white/10 text-muted"}`}
              >
                {onchain ? "⛓ On-chain" : "🎮 Demo Mode"}
              </span>
              {onchain ? (
                <button
                  onClick={onDisconnect}
                  title="Disconnect wallet"
                  className="font-mono text-xs text-ink underline-offset-2 hover:underline"
                >
                  {shortAddr(address, 5)}
                </button>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={onConnect}
                  disabled={connecting}
                  className="rounded-pill bg-gradient-to-r from-primary to-secondary px-3 py-1 text-xs font-bold text-white disabled:opacity-60"
                >
                  {connecting ? "Connecting…" : "Connect GenLayer Wallet"}
                </motion.button>
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-1 font-mono text-lg font-bold text-primary">
              {displayBalance.toFixed(1)}
              <span className="text-xs text-muted">GEN</span>
            </div>
          </div>

          {/* Level + city */}
          <div className="pointer-events-auto glass rounded-card px-3 py-2 shadow-card">
            <div className="text-[10px] uppercase tracking-widest text-muted">Current Level</div>
            <div className="text-sm font-bold text-ink">
              LVL {level} · {city}
            </div>
          </div>
        </div>

        {/* Top-right: live weather widget synced to the challenge city */}
        <div className="pointer-events-auto glass rounded-card px-3 py-2 text-right shadow-card">
          <div className="text-[10px] uppercase tracking-widest text-muted">{city} · live</div>
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
    </>
  );
}
