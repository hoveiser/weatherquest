import type { WeatherKind } from "../types";

export type ParticleMode =
  | "sun"
  | "stars"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

export interface SurfaceTheme {
  /** Subtle CSS background wash applied behind a surface's content. */
  gradient: string;
  /** Which particle effect the overlay should render. */
  particles: ParticleMode;
  /** Accent color (hex) used to tint icons/glyphs for the current sky. */
  accent: string;
}

/**
 * Maps a weather condition + the Open-Meteo `is_day` flag onto a visual theme.
 * Clear skies get the strongest day/night contrast:
 *   - Day + Clear   → vibrant sky-blue → warm-orange wash + sun particles.
 *   - Night + Clear → deep purple → midnight-blue wash + star particles.
 * Other conditions get a calmer wash that still shifts warm (day) vs cool (night).
 */
export function surfaceTheme(kind: WeatherKind, isDay: boolean): SurfaceTheme {
  if (kind === "clear") {
    return isDay
      ? {
          gradient:
            "linear-gradient(160deg, rgba(56,189,248,0.28) 0%, rgba(255,159,64,0.24) 55%, rgba(255,107,53,0.18) 100%)",
          particles: "sun",
          accent: "#38BDF8",
        }
      : {
          gradient:
            "linear-gradient(160deg, rgba(107,70,193,0.34) 0%, rgba(30,58,138,0.30) 55%, rgba(10,14,39,0.42) 100%)",
          particles: "stars",
          accent: "#A78BFA",
        };
  }

  if (kind === "storm") {
    return {
      gradient: "linear-gradient(160deg, rgba(30,27,75,0.42), rgba(10,14,39,0.5))",
      particles: "storm",
      accent: isDay ? "#818CF8" : "#6366F1",
    };
  }

  if (kind === "snow") {
    return {
      gradient: isDay
        ? "linear-gradient(160deg, rgba(148,197,253,0.22), rgba(30,41,59,0.30))"
        : "linear-gradient(160deg, rgba(99,102,241,0.22), rgba(15,23,42,0.42))",
      particles: "snow",
      accent: "#BAE6FD",
    };
  }

  if (kind === "rain" || kind === "drizzle") {
    return {
      gradient: isDay
        ? "linear-gradient(160deg, rgba(96,165,250,0.20), rgba(30,41,59,0.34))"
        : "linear-gradient(160deg, rgba(51,65,85,0.34), rgba(10,14,39,0.46))",
      particles: kind === "drizzle" ? "drizzle" : "rain",
      accent: "#60A5FA",
    };
  }

  if (kind === "fog") {
    return {
      gradient: isDay
        ? "linear-gradient(160deg, rgba(148,163,184,0.18), rgba(30,41,59,0.28))"
        : "linear-gradient(160deg, rgba(71,85,105,0.24), rgba(10,14,39,0.40))",
      particles: "fog",
      accent: "#CBD5E1",
    };
  }

  // cloud (default)
  return {
    gradient: isDay
      ? "linear-gradient(160deg, rgba(148,163,184,0.16), rgba(56,189,248,0.12))"
      : "linear-gradient(160deg, rgba(51,65,85,0.28), rgba(15,23,42,0.40))",
    particles: "cloud",
    accent: isDay ? "#94A3B8" : "#64748B",
  };
}
