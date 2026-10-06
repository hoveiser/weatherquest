// ============================================================================
// Pure, dependency-free port of the contract's deterministic risk engine.
//
// Mirrors contracts/weatherquest.py `_snap_from_raw`, `_code_class` and
// `_risk_from_snapshot` EXACTLY (same integer bands, same tier thresholds) so
// the client preview derives the identical tier + multiplier (hundredths) that
// the on-chain validators settle. The payout-determining multiplier never uses
// an LLM, so the same weather snapshot gives the same numbers here and on-chain.
//
// This module imports only TYPES (erased at build), so it can be unit-tested
// directly without dragging in axios / the network layer.
// ============================================================================
import type { RiskTier, WeatherSnapshot } from "../types";

export interface RiskSnapshot {
  temp_i: number;
  precip_i: number; // tenths of mm
  wind_i: number;
  humid_i: number;
  code_i: number;
}

/** Port of `_snap_from_raw`: normalize floats into the contract's integer snapshot. */
export function snapFromWeather(w: WeatherSnapshot): RiskSnapshot {
  const temp_i = Math.round(Number(w.temperature_2m) || 0);
  const precip_i = Math.round((Number(w.precipitation) || 0) * 10);
  const wind_i = Math.round(Number(w.wind_speed_10m) || 0);
  const humid_i = Math.round(Number(w.relative_humidity_2m) || 0);
  const rawCode = Math.trunc(Number(w.weather_code));
  const code_i = Number.isFinite(rawCode) && rawCode >= 0 && rawCode <= 99 ? rawCode : -1;
  return { temp_i, precip_i, wind_i, humid_i, code_i };
}

/** Port of `_code_class`: bucket a WMO code into a coarse severity class 0-6. */
export function codeClass(code: number): number {
  if (code === 0 || code === 1 || code === 2 || code === 3 || code === 45 || code === 48) return 0;
  if (code >= 51 && code <= 57) return 1;
  if (code >= 61 && code <= 67) return 2;
  if (code >= 71 && code <= 77) return 3;
  if (code === 80 || code === 81 || code === 82 || code === 85 || code === 86) return 4;
  if (code >= 95 && code <= 99) return 5;
  return 6;
}

// Per-class weather-code contribution keyed off `codeClass`. Matches the
// contract's inline dict {0:0,1:30,2:60,3:90,4:120,5:200,6:40}.
const CODE_HC: Record<number, number> = { 0: 0, 1: 30, 2: 60, 3: 90, 4: 120, 5: 200, 6: 40 };

/** Port of `_risk_from_snapshot`: returns `[tier, multiplier_x100]`, integer bands. */
export function riskFromSnapshot(s: RiskSnapshot): [RiskTier, number] {
  const wind = Math.max(0, s.wind_i);
  let hw: number;
  if (wind < 20) hw = 0;
  else if (wind < 30) hw = 30;
  else if (wind < 40) hw = 60;
  else if (wind < 50) hw = 100;
  else if (wind < 60) hw = 150;
  else hw = 200;

  const p = s.precip_i; // tenths of mm
  let hp: number;
  if (p <= 0) hp = 0;
  else if (p < 10) hp = 20;
  else if (p < 50) hp = 50;
  else if (p < 200) hp = 100;
  else hp = 150;

  const t = s.temp_i;
  let ht: number;
  if (t >= 5 && t <= 25) ht = 0;
  else if ((t >= -5 && t < 5) || (t > 25 && t <= 30)) ht = 20;
  else if ((t >= -15 && t < -5) || (t > 30 && t <= 35)) ht = 50;
  else ht = 100;

  const hc = CODE_HC[codeClass(s.code_i)];
  const score = Math.max(100, Math.min(500, 100 + hw + hp + ht + hc));
  return [tierFromScore(score), score];
}

/** Contract tier boundaries on the integer score: <150 Low, <250 Medium, <400 High, else Extreme. */
export function tierFromScore(score: number): RiskTier {
  if (score < 150) return "Low";
  if (score < 250) return "Medium";
  if (score < 400) return "High";
  return "Extreme";
}

/** Convenience tier lookup from a multiplier (kept for older callers). */
export function tierFor(multiplier: number): RiskTier {
  return tierFromScore(Math.round(multiplier * 100));
}
