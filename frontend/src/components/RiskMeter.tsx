import { motion } from "framer-motion";
import type { RiskTier } from "../types";
import clsx from "clsx";

interface Props {
  multiplier: number; // 1.0 to 5.0
  tier: RiskTier;
  compact?: boolean;
}

const TIER_COLOR: Record<RiskTier, string> = {
  Low: "text-success",
  Medium: "text-warning",
  High: "text-primary",
  Extreme: "text-danger",
};

const TIER_BAR: Record<RiskTier, string> = {
  Low: "from-success to-success",
  Medium: "from-warning to-warning",
  High: "from-warning to-primary",
  Extreme: "from-primary to-danger",
};

/** Horizontal risk gauge (1.0x to 5.0x) with an animated fill and tier label. */
export default function RiskMeter({ multiplier, tier, compact = false }: Props) {
  const pct = Math.min(100, Math.max(0, ((multiplier - 1) / 4) * 100));
  return (
    <div className={clsx("w-full", compact ? "space-y-1.5" : "space-y-2")}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">Risk Multiplier</span>
        <span className={clsx("font-bold tabular-nums", TIER_COLOR[tier], compact ? "text-sm" : "text-lg")}>
          {multiplier.toFixed(1)}x
          <span className={clsx("ml-2 text-xs font-semibold", TIER_COLOR[tier])}>{tier}</span>
        </span>
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-pill bg-white/10"
        role="meter"
        aria-valuenow={Math.round(multiplier * 10)}
        aria-valuemin={10}
        aria-valuemax={50}
        aria-label={`Risk multiplier ${multiplier.toFixed(1)}x, ${tier}`}
      >
        <motion.div
          className={clsx("h-full rounded-pill bg-gradient-to-r", TIER_BAR[tier])}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}
