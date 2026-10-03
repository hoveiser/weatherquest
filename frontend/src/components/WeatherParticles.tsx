import { useMemo } from "react";
import type { WeatherKind } from "../types";
import { surfaceTheme } from "../lib/theme";

interface Props {
  kind: WeatherKind;
  /** Open-Meteo `is_day` flag (1/0). Drives sun vs. stars on clear skies. */
  isDay?: boolean;
  count?: number;
}

/**
 * Lightweight CSS-animated particle overlay that reacts to the current sky.
 * Clear skies render warm floating sun specks by day and twinkling stars by
 * night; precipitation conditions keep the rain/snow/storm effects. Rendered
 * inside relatively-positioned surfaces (pointer-events-none so it never blocks
 * the UI). Purely decorative.
 */
export default function WeatherParticles({ kind, isDay = true, count }: Props) {
  const mode = surfaceTheme(kind, isDay).particles;

  // Falling particles (rain / drizzle / snow / storm).
  const drops = useMemo(() => {
    const falling = mode === "rain" || mode === "drizzle" || mode === "snow" || mode === "storm";
    if (!falling) return [];
    const n = count ?? 24;
    const isSnow = mode === "snow";
    return Array.from({ length: n }, (_, i) => ({
      i,
      left: Math.random() * 100,
      delay: Math.random() * 3,
      dur: isSnow ? 5 + Math.random() * 4 : 0.9 + Math.random() * 0.9,
      drift: Math.random() * 30 - 15,
      size: isSnow ? 3 + Math.random() * 4 : mode === "drizzle" ? 0.8 : 1,
    }));
  }, [mode, count]);

  // Twinkling stars (clear + night).
  const stars = useMemo(() => {
    if (mode !== "stars") return [];
    const n = count ?? 26;
    return Array.from({ length: n }, (_, i) => ({
      i,
      left: Math.random() * 100,
      top: Math.random() * 70,
      size: 1 + Math.random() * 2,
      delay: Math.random() * 4,
      dur: 2.5 + Math.random() * 3,
    }));
  }, [mode, count]);

  // Warm floating sun specks (clear + day).
  const motes = useMemo(() => {
    if (mode !== "sun") return [];
    const n = count ?? 14;
    return Array.from({ length: n }, (_, i) => ({
      i,
      left: Math.random() * 100,
      top: 40 + Math.random() * 60,
      size: 2 + Math.random() * 4,
      delay: Math.random() * 5,
      dur: 6 + Math.random() * 5,
    }));
  }, [mode, count]);

  const isSnow = mode === "snow";
  const isStorm = mode === "storm";
  const isDrizzle = mode === "drizzle";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {isStorm && <div className="flash absolute inset-0" />}

      {/* Clear + night: star field */}
      {mode === "stars" && (
        <>
          <div
            className="absolute right-4 top-4 rounded-full"
            style={{
              width: 22,
              height: 22,
              background: "radial-gradient(circle, #E9D5FF 0%, rgba(167,139,250,0.5) 45%, transparent 70%)",
              boxShadow: "0 0 18px rgba(167,139,250,0.6)",
            }}
          />
          {stars.map((s) => (
            <span
              key={s.i}
              className="absolute rounded-full bg-white"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: s.size,
                height: s.size,
                animation: `twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
              }}
            />
          ))}
        </>
      )}

      {/* Clear + day: sun glow + warm floating specks */}
      {mode === "sun" && (
        <>
          <div
            className="absolute -right-6 -top-6 rounded-full"
            style={{
              width: 120,
              height: 120,
              background:
                "radial-gradient(circle, rgba(255,213,128,0.55) 0%, rgba(255,159,64,0.28) 40%, transparent 70%)",
            }}
          />
          {motes.map((m) => (
            <span
              key={m.i}
              className="absolute rounded-full"
              style={{
                left: `${m.left}%`,
                top: `${m.top}%`,
                width: m.size,
                height: m.size,
                background: "rgba(255,213,128,0.85)",
                boxShadow: "0 0 8px rgba(255,180,80,0.7)",
                animation: `float-up ${m.dur}s ease-in-out ${m.delay}s infinite`,
              }}
            />
          ))}
        </>
      )}

      {/* Drifting fog banks */}
      {(mode === "fog" || mode === "cloud") && (
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(60% 40% at 30% 40%, rgba(203,213,225,0.18), transparent 70%), radial-gradient(50% 35% at 75% 60%, rgba(148,163,184,0.16), transparent 70%)",
            animation: "drift 14s ease-in-out infinite alternate",
          }}
        />
      )}

      {/* Falling precipitation */}
      {drops.map((d) => (
        <span
          key={d.i}
          className="absolute top-0"
          style={{
            left: `${d.left}%`,
            width: isSnow || isDrizzle ? d.size : 1.5,
            height: isSnow ? d.size : isStorm ? 22 : isDrizzle ? 8 : 16,
            borderRadius: isSnow ? "9999px" : "2px",
            background: isSnow
              ? "rgba(226,232,240,0.9)"
              : "linear-gradient(rgba(180,200,255,0), rgba(180,200,255,0.85))",
            animation: `rain-fall ${d.dur}s linear ${d.delay}s infinite`,
            transform: `translateX(${d.drift}px)`,
            opacity: 0.7,
          }}
        />
      ))}

      <style>{`
        .flash{background:radial-gradient(circle at 50% 0%,rgba(255,255,255,.5),transparent 60%);opacity:0;animation:lightning 5s infinite}
        @keyframes lightning{0%,92%,100%{opacity:0}93%,95%{opacity:.85}94%{opacity:.2}}
        @keyframes twinkle{0%,100%{opacity:.15;transform:scale(.8)}50%{opacity:.95;transform:scale(1.2)}}
        @keyframes float-up{0%{transform:translateY(0);opacity:0}20%{opacity:.9}100%{transform:translateY(-70px);opacity:0}}
        @keyframes drift{0%{transform:translateX(-6%)}100%{transform:translateX(6%)}}
      `}</style>
    </div>
  );
}
