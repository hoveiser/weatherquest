import { useEffect, useState } from "react";
import type { Quest, RiskAnalysis, WeatherSnapshot } from "../types";
import { getWeatherByCity, previewRisk } from "../lib/weather";

interface PreviewState {
  loading: boolean;
  weather: WeatherSnapshot | null;
  risk: RiskAnalysis | null;
  condition: string | null;
  temp: number | null;
  error: string | null;
}

/**
 * Lazily fetches live weather + a deterministic client risk preview for a quest.
 * The authoritative on-chain multiplier comes from the contract; this powers the
 * live meter and is clearly labelled as a preview in the UI.
 */
export function useWeatherPreview(quest: Quest | null): PreviewState {
  const [state, setState] = useState<PreviewState>({
    loading: Boolean(quest),
    weather: null,
    risk: null,
    condition: null,
    temp: null,
    error: null,
  });

  useEffect(() => {
    if (!quest) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        // Single Open-Meteo round-trip per quest: derive the client risk preview
        // from the same snapshot we render (icon + particles + gradient).
        const weather = await getWeatherByCity(quest.city);
        const risk = previewRisk(weather);
        if (!alive) return;
        setState({
          loading: false,
          weather,
          risk,
          condition: weather.condition,
          temp: weather.temperature_2m,
          error: null,
        });
      } catch (e: any) {
        if (alive) setState((s) => ({ ...s, loading: false, error: e?.message || "Weather unavailable" }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quest?.questId, quest?.city]);

  return state;
}
