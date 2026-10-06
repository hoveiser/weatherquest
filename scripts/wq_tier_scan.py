"""Read-only scan of live Open-Meteo weather to find cities currently at a
Medium/High/Extreme risk tier, using the SAME integer bands as the contract
(_risk_from_snapshot / _code_class). No chain calls, no credentials; just public
weather reads so we can pick real stormy cities for the on-chain reject tests.

The campaign cities are known to be Low right now (multipliers 100-130 from the
round), so we also probe a set of typically-windy / storm-prone locations.
Prints each city's computed score (multiplier_x100) and tier, sorted descending.
"""
import sys
import requests

GEO = "https://geocoding-api.open-meteo.com/v1/search"
FC = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 15

CITIES = [
    # campaign cities (expected Low this round)
    "Tokyo", "Sydney", "Reykjavik", "Singapore", "Cairo", "Rio de Janeiro",
    "Port of Spain", "Moscow", "Tromso", "Istanbul",
    # storm-prone / windy candidates for early October
    "Wellington", "Punta Arenas", "Ushuaia", "Stavanger", "Bergen", "Cape Town",
    "Manila", "Taipei", "Osaka", "Naha", "Darwin", "Honolulu", "Nuuk",
    "Reykjavik", "Bluff", "Elizabeth Head", "Stanley", "Hobart", "Christchurch",
]


def code_class(code):
    if code in (0, 1, 2, 3, 45, 48):
        return 0
    if 51 <= code <= 57:
        return 1
    if 61 <= code <= 67:
        return 2
    if 71 <= code <= 77:
        return 3
    if code in (80, 81, 82, 85, 86):
        return 4
    if 95 <= code <= 99:
        return 5
    return 6


CODE_HC = {0: 0, 1: 30, 2: 60, 3: 90, 4: 120, 5: 200, 6: 40}


def risk(temp_i, precip_i, wind_i, code_i):
    wind = max(0, wind_i)
    if wind < 20:
        hw = 0
    elif wind < 30:
        hw = 30
    elif wind < 40:
        hw = 60
    elif wind < 50:
        hw = 100
    elif wind < 60:
        hw = 150
    else:
        hw = 200
    if precip_i <= 0:
        hp = 0
    elif precip_i < 10:
        hp = 20
    elif precip_i < 50:
        hp = 50
    elif precip_i < 200:
        hp = 100
    else:
        hp = 150
    t = temp_i
    if 5 <= t <= 25:
        ht = 0
    elif (-5 <= t < 5) or (25 < t <= 30):
        ht = 20
    elif (-15 <= t < -5) or (30 < t <= 35):
        ht = 50
    else:
        ht = 100
    hc = CODE_HC[code_class(code_i)]
    score = max(100, min(500, 100 + hw + hp + ht + hc))
    if score < 150:
        tier = "Low"
    elif score < 250:
        tier = "Medium"
    elif score < 400:
        tier = "High"
    else:
        tier = "Extreme"
    return tier, score, (temp_i, precip_i, wind_i, code_i, hw, hp, ht, hc)


def scan(city):
    g = requests.get(GEO, params={"name": city, "count": 1, "language": "en", "format": "json"}, timeout=TIMEOUT).json()
    res = g.get("results")
    if not res:
        return None
    r = res[0]
    fc = requests.get(FC, params={
        "latitude": r["latitude"], "longitude": r["longitude"],
        "current": "temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,is_day",
        "timezone": "auto"}, timeout=TIMEOUT).json()
    cur = fc.get("current") or {}
    temp_i = round(float(cur.get("temperature_2m") or 0))
    precip_i = round(float(cur.get("precipitation") or 0) * 10)
    wind_i = round(float(cur.get("wind_speed_10m") or 0))
    code_i = int(cur.get("weather_code") or 0)
    tier, score, parts = risk(temp_i, precip_i, wind_i, code_i)
    return (city, r["name"], r["latitude"], r["longitude"], temp_i, precip_i, wind_i, code_i, tier, score, parts)


def main():
    rows = []
    for c in CITIES:
        try:
            row = scan(c)
            if row:
                rows.append(row)
            print("  scanned %-16s -> %s" % (c, (row[8] + " " + str(row[9])) if row else "no result"), flush=True)
        except Exception as e:
            print("  %-16s ERROR %s" % (c, str(e)[:60]), flush=True)
    rows.sort(key=lambda x: x[9], reverse=True)
    print("\n=== sorted by live risk score (x100) ===")
    print("%-16s %-16s %6s %5s %6s %5s  %-8s %5s" % ("query", "resolved", "tempC", "prec", "wind", "code", "tier", "score"))
    for row in rows:
        print("%-16s %-16s %6d %5d %6d %5d  %-8s %5d" % (row[0], row[1][:16], row[4], row[5], row[6], row[7], row[8], row[9]))
    medplus = [row for row in rows if row[9] >= 150]
    print("\nMedium+ cities live now:", ", ".join("%s(%s x%d)" % (r[1], r[8], r[9]) for r in medplus) or "NONE")
    print("hint: %s" % ("use these for on-chain rejects" if medplus else "no Medium+ tier is live; reject cases cannot force success=false via weather"))


if __name__ == "__main__":
    sys.exit(main())
