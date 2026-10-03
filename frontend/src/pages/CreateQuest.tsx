import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, Coins, Clock, MapPin, ScrollText, ShieldAlert } from "lucide-react";
import { useApp } from "../context/AppContext";
import { getWeatherByCity, previewRisk } from "../lib/weather";
import type { RiskAnalysis, WeatherSnapshot } from "../types";
import { formatGen } from "../lib/format";
import WeatherIcon from "../components/WeatherIcon";
import RiskMeter from "../components/RiskMeter";
import WeatherParticles from "../components/WeatherParticles";
import Button from "../components/Button";
import clsx from "clsx";

const LIMITS = { cityMax: 100, descMax: 500, rewardMax: 1000, expiryMax: 168 };

export default function CreateQuest() {
  const { state, connect, createQuest } = useApp();
  const navigate = useNavigate();

  const [city, setCity] = useState("");
  const [reward, setReward] = useState("25");
  const [expiry, setExpiry] = useState("24");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [risk, setRisk] = useState<RiskAnalysis | null>(null);
  const [weatherBusy, setWeatherBusy] = useState(false);

  // Debounced live weather preview as the creator types a city.
  useEffect(() => {
    const c = city.trim();
    if (c.length < 2) {
      setWeather(null);
      setRisk(null);
      return;
    }
    let alive = true;
    setWeatherBusy(true);
    const t = setTimeout(async () => {
      try {
        const w = await getWeatherByCity(c);
        if (!alive) return;
        setWeather(w);
        setRisk(previewRisk(w));
      } catch {
        if (alive) {
          setWeather(null);
          setRisk(null);
        }
      } finally {
        if (alive) setWeatherBusy(false);
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [city]);

  const rewardNum = Number(reward);
  const expiryNum = Number(expiry);
  const errors: Record<string, string> = {};
  if (!city.trim()) errors.city = "City is required.";
  else if (city.length > LIMITS.cityMax) errors.city = `Max ${LIMITS.cityMax} characters.`;
  if (!(rewardNum > 0)) errors.reward = "Reward must be greater than 0.";
  else if (rewardNum > LIMITS.rewardMax) errors.reward = `Max ${LIMITS.rewardMax} GEN.`;
  if (!(expiryNum >= 1)) errors.expiry = "Expiry must be at least 1 hour.";
  else if (expiryNum > LIMITS.expiryMax) errors.expiry = `Max ${LIMITS.expiryMax} hours (7 days).`;
  if (!description.trim()) errors.description = "Add a short objective.";
  else if (description.length > LIMITS.descMax) errors.description = `Max ${LIMITS.descMax} characters.`;
  const valid = Object.keys(errors).length === 0;

  const projected = risk ? Number((rewardNum || 0) * risk.multiplier) : 0;

  const onSubmit = async () => {
    setTouched(true);
    if (!valid) return;
    if (!state.address) {
      connect();
      return;
    }
    setSubmitting(true);
    const q = await createQuest({
      city: city.trim(),
      baseRewardGen: rewardNum,
      description: description.trim(),
      expiryHours: expiryNum,
    });
    setSubmitting(false);
    if (q) navigate("/dashboard");
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Create a Bounty</h1>
      <p className="mt-1 text-sm text-muted">
        Fund a quest with GEN. The payout scales with live weather risk when an action is judged.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Form */}
        <div className="card space-y-5 p-6">
          <Field label="City / Location" icon={MapPin} error={touched ? errors.city : ""} hint="Any place Open-Meteo can geocode.">
            <input
              className={clsx("field", touched && errors.city && "border-danger/60")}
              value={city}
              maxLength={LIMITS.cityMax}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Reykjavik"
              onBlur={() => setTouched(true)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Base Reward (GEN)" icon={Coins} error={touched ? errors.reward : ""}>
              <input
                className={clsx("field", touched && errors.reward && "border-danger/60")}
                type="number"
                min={1}
                max={LIMITS.rewardMax}
                value={reward}
                onChange={(e) => setReward(e.target.value)}
              />
            </Field>
            <Field label="Expiry (hours)" icon={Clock} error={touched ? errors.expiry : ""}>
              <input
                className={clsx("field", touched && errors.expiry && "border-danger/60")}
                type="number"
                min={1}
                max={LIMITS.expiryMax}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Objective" icon={ScrollText} error={touched ? errors.description : ""}>
            <textarea
              className={clsx("field resize-none", touched && errors.description && "border-danger/60")}
              rows={4}
              maxLength={LIMITS.descMax}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the adventurer do?"
            />
            <span className="mt-1 block text-right text-xs text-muted">
              {description.length}/{LIMITS.descMax}
            </span>
          </Field>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={onSubmit} loading={submitting} disabled={touched && !valid}>
              {state.address ? "Fund & Create Quest" : "Connect Wallet to Create"}
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <ShieldAlert size={14} className="text-warning" aria-hidden />
              Rewards are escrowed on-chain and refunded if no valid action completes.
            </p>
          </div>
        </div>

        {/* Live preview */}
        <div className="space-y-4">
          <motion.div layout className="card relative overflow-hidden p-5">
            {weather && <WeatherParticles kind={weather.kind} />}
            <p className="relative text-xs uppercase tracking-wider text-muted">Live Weather Preview</p>
            {weatherBusy ? (
              <div className="relative mt-4 space-y-3">
                <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
                <div className="h-2 w-full animate-pulse rounded-pill bg-white/10" />
              </div>
            ) : weather && risk ? (
              <div className="relative mt-3 space-y-4">
                <div className="flex items-center gap-3">
                  <WeatherIcon kind={weather.kind} isDay={weather.is_day === 1} className="text-primary" size={30} />
                  <div>
                    <p className="font-bold text-ink">{weather.condition}</p>
                    <p className="text-sm text-muted">
                      {Math.round(weather.temperature_2m)}°C · {Math.round(weather.wind_speed_10m)} km/h wind
                    </p>
                  </div>
                </div>
                <RiskMeter multiplier={risk.multiplier} tier={risk.risk_tier} />
                <div className="flex items-center justify-between border-t border-white/10 pt-3 text-sm">
                  <span className="text-muted">Projected max payout</span>
                  <span className="flex items-center gap-1.5 font-extrabold text-success">
                    <Check size={15} aria-hidden /> {formatGen(projected)}
                  </span>
                </div>
                <p className="text-xs text-muted">{risk.reasoning}</p>
              </div>
            ) : (
              <p className="relative mt-3 text-sm text-muted">
                Enter a city to preview the current risk multiplier and projected payout.
              </p>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  error,
  hint,
  children,
}: {
  label: string;
  icon: typeof MapPin;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon size={15} className="text-primary" aria-hidden /> {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
