import axios from "axios";
import type { RiskAnalysis, RiskTier, WeatherKind, WeatherSnapshot } from "../types";
import { riskFromSnapshot, snapFromWeather } from "./risk";

// In dev the Vite proxy keeps these same-origin; in production they resolve to
// the public Open-Meteo hosts (free, no key). Base path chosen at runtime.
const GEO = import.meta.env.DEV ? "/api/geocoding/v1/search" : "https://geocoding-api.open-meteo.com/v1/search";
const FC = import.meta.env.DEV ? "/api/open-meteo/v1/forecast" : "https://api.open-meteo.com/v1/forecast";

const TIMEOUT_MS = 10_000;

const CODE_INFO: Record<number, { condition: string; kind: WeatherKind }> = {
  0: { condition: "Clear sky", kind: "clear" },
  1: { condition: "Mainly clear", kind: "clear" },
  2: { condition: "Partly cloudy", kind: "cloud" },
  3: { condition: "Overcast", kind: "cloud" },
  45: { condition: "Fog", kind: "fog" },
  48: { condition: "Rime fog", kind: "fog" },
  51: { condition: "Light drizzle", kind: "drizzle" },
  53: { condition: "Drizzle", kind: "drizzle" },
  55: { condition: "Dense drizzle", kind: "drizzle" },
  56: { condition: "Freezing drizzle", kind: "drizzle" },
  57: { condition: "Freezing drizzle", kind: "drizzle" },
  61: { condition: "Light rain", kind: "rain" },
  63: { condition: "Rain", kind: "rain" },
  65: { condition: "Heavy rain", kind: "rain" },
  66: { condition: "Freezing rain", kind: "rain" },
  67: { condition: "Freezing rain", kind: "rain" },
  71: { condition: "Light snow", kind: "snow" },
  73: { condition: "Snow", kind: "snow" },
  75: { condition: "Heavy snow", kind: "snow" },
  77: { condition: "Snow grains", kind: "snow" },
  80: { condition: "Rain showers", kind: "rain" },
  81: { condition: "Rain showers", kind: "rain" },
  82: { condition: "Violent showers", kind: "storm" },
  85: { condition: "Snow showers", kind: "snow" },
  86: { condition: "Snow showers", kind: "snow" },
  95: { condition: "Thunderstorm", kind: "storm" },
  96: { condition: "Thunderstorm + hail", kind: "storm" },
  99: { condition: "Severe thunderstorm", kind: "storm" },
};

export function codeInfo(code: number) {
  return CODE_INFO[code] ?? { condition: "Unknown", kind: "cloud" as WeatherKind };
}

export interface GeoResult {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

/** Resolve a free-text city to coordinates. Throws a friendly message on failure. */
export async function geocode(city: string): Promise<GeoResult> {
  const q = city.trim();
  if (!q) throw new Error("Please enter a city name.");
  try {
    const { data } = await axios.get(GEO, {
      params: { name: q, count: 1, language: "en", format: "json" },
      timeout: TIMEOUT_MS,
    });
    const r = data?.results?.[0];
    if (!r) throw new Error("We couldn't find weather data for this city. Please try another.");
    return {
      name: r.name,
      country: r.country,
      admin1: r.admin1,
      latitude: r.latitude,
      longitude: r.longitude,
    };
  } catch (e: any) {
    if (e?.code === "ECONNABORTED" || /timeout/i.test(e?.message || "")) {
      throw new Error("Weather service is slow. Please try again in a moment.");
    }
    if (e?.message?.includes("couldn't find")) throw e;
    throw new Error("Weather service is temporarily unavailable. Please try again shortly.");
  }
}

/** Fetch the current weather for coordinates. */
export async function fetchWeather(geo: GeoResult): Promise<WeatherSnapshot> {
  try {
    const { data } = await axios.get(FC, {
      params: {
        latitude: geo.latitude,
        longitude: geo.longitude,
        current: "temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,is_day",
        timezone: "auto",
      },
      timeout: TIMEOUT_MS,
    });
    const cur = data?.current;
    if (!cur) throw new Error("No weather data");
    const info = codeInfo(cur.weather_code);
    return {
      city: geo.name,
      temperature_2m: cur.temperature_2m,
      precipitation: cur.precipitation,
      wind_speed_10m: cur.wind_speed_10m,
      relative_humidity_2m: cur.relative_humidity_2m,
      weather_code: cur.weather_code,
      is_day: cur.is_day,
      condition: info.condition,
      kind: info.kind,
    };
  } catch (e: any) {
    if (e?.code === "ECONNABORTED") {
      throw new Error("Weather service is slow. Please try again in a moment.");
    }
    throw new Error("Weather service is temporarily unavailable. Please try again shortly.");
  }
}

/** Convenience: geocode + fetch in one call. */
export async function getWeatherByCity(city: string): Promise<WeatherSnapshot> {
  const geo = await geocode(city);
  return fetchWeather(geo);
}

/**
 * Deterministic client-side risk PREVIEW. Delegates to the exact integer port in
 * ./risk (a value-for-value mirror of the contract's _snap_from_raw, _code_class
 * and _risk_from_snapshot), so the meter, the tier and the multiplier shown agree
 * with the value the validators settle on-chain for the same weather snapshot.
 */
export function previewRisk(w: WeatherSnapshot): RiskAnalysis {
  const [risk_tier, multiplierX100] = riskFromSnapshot(snapFromWeather(w));
  return {
    multiplier: multiplierX100 / 100,
    multiplierX100,
    risk_tier,
    reasoning: reasoningFor(w, multiplierX100 / 100, risk_tier),
  };
}

// Re-export the pure helpers so existing imports keep working; the canonical
// implementation lives in ./risk (dependency-free and directly unit-testable).
export { snapFromWeather, codeClass, riskFromSnapshot, tierFor, tierFromScore } from "./risk";
export type { RiskSnapshot } from "./risk";

function reasoningFor(w: WeatherSnapshot, m: number, tier: RiskTier): string {
  const parts: string[] = [];
  parts.push(`${w.condition} at ${Math.round(w.temperature_2m)}\u00b0C`);
  if (w.wind_speed_10m > 20) parts.push(`${Math.round(w.wind_speed_10m)} km/h winds`);
  if (w.precipitation > 2) parts.push(`${w.precipitation} mm precipitation`);
  const severity =
    tier === "Low"
      ? "mild conditions"
      : tier === "Medium"
        ? "notable hazards"
        : tier === "High"
          ? "dangerous conditions"
          : "extreme, potentially life-threatening conditions";
  return `${parts.join(", ")}: ${severity}. Risk multiplier ${m.toFixed(1)}x.`;
}
