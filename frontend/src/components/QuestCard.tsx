import { motion } from "framer-motion";
import { Clock, MapPin, Coins, ChevronRight } from "lucide-react";
import type { Quest, QuestStatus } from "../types";
import { countdown, formatGen } from "../lib/format";
import { useWeatherPreview } from "../hooks/useWeatherPreview";
import { surfaceTheme } from "../lib/theme";
import WeatherIcon from "./WeatherIcon";
import WeatherParticles from "./WeatherParticles";
import RiskMeter from "./RiskMeter";
import clsx from "clsx";

const STATUS_STYLE: Record<QuestStatus, string> = {
  Active: "bg-primary/15 text-primary",
  Completed: "bg-success/15 text-success",
  Failed: "bg-danger/15 text-danger",
  Expired: "bg-white/10 text-muted",
  Claimed: "bg-white/10 text-muted",
};

export function StatusChip({ status }: { status: QuestStatus }) {
  return <span className={clsx("chip", STATUS_STYLE[status])}>{status}</span>;
}

interface Props {
  quest: Quest;
  onOpen: (quest: Quest) => void;
}

export default function QuestCard({ quest, onOpen }: Props) {
  const { loading, weather, risk, condition, temp, error } = useWeatherPreview(quest);
  const msLeft = quest.expiresAt - Date.now();
  const isDay = weather ? weather.is_day === 1 : true;
  const theme = weather ? surfaceTheme(weather.kind, isDay) : null;

  return (
    <motion.button
      layout
      type="button"
      onClick={() => onOpen(quest)}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.99 }}
      className="card group relative flex w-full flex-col overflow-hidden p-5 text-left"
      aria-label={`Quest in ${quest.city}, ${formatGen(quest.baseRewardGen)} base reward. Open details.`}
    >
      {theme && (
        <div
          className="pointer-events-none absolute inset-0 -z-0 transition-opacity duration-500"
          style={{ background: theme.gradient }}
          aria-hidden
        />
      )}
      {weather && <WeatherParticles kind={weather.kind} isDay={isDay} />}

      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <MapPin size={13} aria-hidden /> {quest.city}
          </p>
          <h3 className="mt-1 font-bold leading-tight text-ink line-clamp-1">{quest.description}</h3>
        </div>
        <StatusChip status={quest.status} />
      </div>

      <div className="relative z-10 mt-4 flex items-center gap-3">
        {loading ? (
          <div className="h-6 w-40 animate-pulse rounded bg-white/10" />
        ) : error ? (
          <span className="text-xs text-warning">{error}</span>
        ) : weather ? (
          <>
            <WeatherIcon
              kind={weather.kind}
              isDay={isDay}
              size={22}
              className="transition-colors"
              color={theme?.accent}
            />
            <span className="text-sm text-ink">{condition}</span>
            <span className="text-sm tabular-nums text-muted">{Math.round(temp!)}°C</span>
          </>
        ) : (
          <span className="text-xs text-muted">No data</span>
        )}
      </div>

      <div className="relative z-10 mt-4">
        {risk ? (
          <RiskMeter multiplier={risk.multiplier} tier={risk.risk_tier} compact />
        ) : (
          <div className="h-8 w-full animate-pulse rounded bg-white/10" />
        )}
      </div>

      <div className="relative z-10 mt-5 flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Coins size={15} className="text-warning" aria-hidden />
            {formatGen(quest.baseRewardGen)}
          </span>
          <span
            className={clsx(
              "flex items-center gap-1.5 text-xs",
              msLeft > 0 && msLeft < 3600_000 ? "text-danger" : "text-muted",
            )}
          >
            <Clock size={13} aria-hidden />
            {countdown(msLeft)}
          </span>
        </div>
        <span className="flex items-center gap-1 text-sm font-semibold text-primary opacity-80 transition group-hover:opacity-100">
          View <ChevronRight size={16} aria-hidden />
        </span>
      </div>
    </motion.button>
  );
}
