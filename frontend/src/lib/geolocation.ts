/**
 * IP-based geolocation for the personalized campaign start.
 *
 * Level 1 is always the player's real-world city. We resolve it client-side from
 * the requester IP via a free geolocation API (ipapi.co). This is a NON-authoritative
 * UX hint only - the GenLayer contract re-fetches the real weather for whatever city
 * string is submitted and derives the multiplier from Open-Meteo, so a tampered city
 * value can never forge a higher reward (the weather is re-verified by validators).
 *
 * All failures (offline, rate-limited, blocked, timeout) fall back to a default city
 * so the game always boots.
 */

export interface IPLocation {
  city: string;
  region?: string;
  country?: string; // ISO-3166 alpha-2
  countryName?: string;
  latitude?: number;
  longitude?: number;
  ok: boolean; // false when we returned the fallback
}

export const FALLBACK_LOCATION: IPLocation = {
  city: "London",
  country: "GB",
  countryName: "United Kingdom",
  ok: false,
};

const GEO_ENDPOINT = "https://ipapi.co/json/";

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export async function fetchIPLocation(timeoutMs = 4000): Promise<IPLocation> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(GEO_ENDPOINT, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return FALLBACK_LOCATION;

    const j = (await res.json()) as Record<string, unknown>;
    // ipapi.co signals errors (e.g. rate limiting) with { error: true, reason }.
    if (j && (j.error === true || j.error === "true")) return FALLBACK_LOCATION;

    const city = asString(j.city);
    if (!city) return FALLBACK_LOCATION;

    return {
      city,
      region: asString(j.region),
      country: asString(j.country_code) ?? asString(j.country),
      countryName: asString(j.country_name),
      latitude: typeof j.latitude === "number" ? j.latitude : undefined,
      longitude: typeof j.longitude === "number" ? j.longitude : undefined,
      ok: true,
    };
  } catch {
    return FALLBACK_LOCATION;
  }
}
