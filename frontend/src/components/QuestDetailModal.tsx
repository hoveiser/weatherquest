import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, MapPin, Coins, Clock, ShieldQuestion, Send, Info } from "lucide-react";
import type { ActionResult, Quest } from "../types";
import { countdown, formatGen } from "../lib/format";
import { useApp } from "../context/AppContext";
import { useWeatherPreview } from "../hooks/useWeatherPreview";
import { payoutPreview } from "../lib/contract";
import { surfaceTheme } from "../lib/theme";
import WeatherIcon from "./WeatherIcon";
import WeatherParticles from "./WeatherParticles";
import RiskMeter from "./RiskMeter";
import Button from "./Button";
import Tooltip from "./Tooltip";
import { StatusChip } from "./QuestCard";
import ResultScreen from "./ResultScreen";
import clsx from "clsx";

interface Props {
  quest: Quest | null;
  onClose: () => void;
}

export default function QuestDetailModal({ quest, onClose }: Props) {
  const { submitAction } = useApp();
  const { loading, weather, risk, condition, temp } = useWeatherPreview(quest);
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const msLeft = quest ? quest.expiresAt - Date.now() : 0;
  const isActive = quest?.status === "Active" && msLeft > 0;
  const isDay = weather ? weather.is_day === 1 : true;
  const theme = weather ? surfaceTheme(weather.kind, isDay) : null;

  // Reset local state whenever a different quest opens.
  useEffect(() => {
    setAction("");
    setResult(null);
    setBusy(false);
  }, [quest?.questId]);

  // Escape to close + focus the panel on open.
  useEffect(() => {
    if (!quest) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [quest, onClose]);

  const handleSubmit = async () => {
    if (!quest || !action.trim()) return;
    setBusy(true);
    const res = await submitAction(quest, action.trim());
    setBusy(false);
    if (res) setResult(res);
  };

  return (
    <AnimatePresence>
      {quest && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={`Quest details: ${quest.city}`}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            style={theme ? { backgroundImage: theme.gradient } : undefined}
            className="glass relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-modal border-white/10 p-6 outline-none transition-all duration-500 sm:rounded-modal"
          >
            {weather && <WeatherParticles kind={weather.kind} isDay={isDay} />}

            <button
              onClick={onClose}
              className="absolute right-4 top-4 rounded-full p-1.5 text-muted hover:bg-white/10 hover:text-ink"
              aria-label="Close quest details"
            >
              <X size={20} aria-hidden />
            </button>

            {result ? (
              <ResultScreen result={result} onClose={onClose} />
            ) : (
              <div className="relative space-y-5">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <MapPin size={13} aria-hidden /> {quest.city}
                    </p>
                    <StatusChip status={quest.status} />
                  </div>
                  <h2 className="mt-2 pr-8 text-xl font-extrabold leading-tight text-ink">
                    {quest.description}
                  </h2>
                </div>

                {/* Live weather + risk */}
                <div className="rounded-card border border-white/10 bg-surface-2/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {weather && (
                        <WeatherIcon kind={weather.kind} isDay={isDay} color={theme?.accent} size={18} />
                      )}
                      {loading ? "Reading live weather…" : condition}
                      {temp != null && <span className="tabular-nums text-muted">{Math.round(temp)}°C</span>}
                    </span>
                    <Tooltip label="Preview from live Open-Meteo data. The final multiplier is set by the on-chain AI consensus.">
                      <span className="flex items-center gap-1 text-[11px] text-muted">
                        <Info size={13} aria-hidden /> preview
                      </span>
                    </Tooltip>
                  </div>
                  {risk ? (
                    <>
                      <RiskMeter multiplier={risk.multiplier} tier={risk.risk_tier} />
                      <p className="mt-3 flex items-center justify-between text-sm">
                        <span className="text-muted">Projected payout</span>
                        <span className="font-bold text-ink">
                          {formatGen(payoutPreview(quest, risk))}
                        </span>
                      </p>
                    </>
                  ) : (
                    <div className="h-10 w-full animate-pulse rounded bg-white/10" />
                  )}
                </div>

                {/* Quest meta */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2 rounded-card bg-white/5 px-3 py-2">
                    <Coins size={16} className="text-warning" aria-hidden />
                    <div>
                      <p className="text-xs text-muted">Base reward</p>
                      <p className="font-semibold text-ink">{formatGen(quest.baseRewardGen)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-card bg-white/5 px-3 py-2">
                    <Clock size={16} className={clsx(msLeft > 0 && msLeft < 3600_000 ? "text-danger" : "text-muted")} aria-hidden />
                    <div>
                      <p className="text-xs text-muted">Time left</p>
                      <p className="font-semibold text-ink">{countdown(msLeft)}</p>
                    </div>
                  </div>
                </div>

                {/* Action submission */}
                {isActive ? (
                  <div className="space-y-3">
                    <label htmlFor="action" className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <ShieldQuestion size={16} className="text-secondary" aria-hidden />
                      Your action
                    </label>
                    <textarea
                      id="action"
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                      maxLength={200}
                      rows={3}
                      placeholder="e.g. Shelter indoors and monitor the storm, then cross at dawn."
                      className="field resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted">{action.length}/200</span>
                      <Button onClick={handleSubmit} loading={busy} disabled={!action.trim()}>
                        {!busy && <Send size={16} aria-hidden />}
                        {busy ? "AI judging…" : "Submit for AI Judgment"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted">
                      The on-chain AI reviews your action against the current risk tier. Reckless moves in
                      extreme weather will fail; well-adapted moves win the multiplied reward.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-card border border-white/10 bg-white/5 p-4 text-center text-sm text-muted">
                    This quest is {quest.status === "Active" ? "expired" : quest.status.toLowerCase()} and no
                    longer accepts submissions.
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
