"""Read-only scan to find cities currently at a Medium/High/Extreme risk tier via
the SAME path the contract's free-form level-1 uses: Open-Meteo geocoding (name ->
first result) then the forecast at those exact integer e5 coords, with the contract
integer bands (_risk_from_snapshot / _code_class). No chain calls, no credentials.

Used to pick real stormy cities so on-chain reject cases (success must be false)
land on a tier whose _judge_action guidance actually rejects dangerous actions. At
Low tier the AI approves nearly everything, so rejects must target Medium+.
Prints the resolved name, coords, tier and score, sorted by score descending.
"""
import sys
import requests

GEO = "https://geocoding-api.open-meteo.com/v1/search"
FC = "https://api.open-meteo.com/v1/forecast"
TIMEOUT = 15

# Broad storm-prone / high-wind candidate set for early October (hurricane +
# southern-hemisphere spring-wind season). Level 1 is free-form, so any of these
# can be passed straight to complete_level(1, city, ...).
CITIES = [
    "Cabo San Lucas", "Cancun", "Kingston", "Montego Bay", "Nassau", "Havana",
    "Santo Domingo", "San Juan", "Port-au-Prince", "Belize City", "Roatan",
    "Guayaquil", "Cartagena", "Barranquilla", "Maracaibo", "Georgetown",
    "Paramaribo", "Cayenne", "Belem", "Fortaleza", "Recife", "Salvador",
    "Wellington", "Christchurch", "Dunedin", "Napier", "Gisborne", "Picton",
    "Bluff", "Stavanger", "Bergen", "Tromso", "Reykjavik", "Torshavn",
    "Ushuaia", "Punta Arenas", "Stanley", "Hobart", "Launceston", "Ballarat",
    "Darwin", "Cairns", "Townsville", "Auckland", "Suva", "Port Moresby",
    "Manila", "Taipei", "Naha", "Okinawa", "Tokyo", "Osaka", "Haiphong",
    "Da Nang", "Ho Chi Minh City", "Bangkok", "Phnom Penh", "Vientiane",
    "Jakarta", "Surabaya", "Singapore", "Kuala Lumpur", "Padang", "Medan",
    "Cape Town", "Durban", "Port Elizabeth", "Windhoek", "Luanda",
    "Honolulu", "Anchorage", "Juneau", "Reykjavik", "Nuuk", "Longyearbyen",
]

CODE_HC = {0: 0, 1: 30, 2: 60, 3: 90, 4: 120, 5: 200, 6: 40}


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
    return tier, score


def scan(city):
    g = requests.get(GEO, params={"name": city, "count": 1, "language": "en", "format": "json"}, timeout=TIMEOUT).json()
    res = g.get("results")
    if not res:
        return None
    r = res[0]
    lat_e5 = int(round(float(r["latitude"]) * 100000))
    lon_e5 = int(round(float(r["longitude"]) * 100000))
    fc = requests.get(FC, params={
        "latitude": lat_e5 / 1e5, "longitude": lon_e5 / 1e5,
        "current": "temperature_2m,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,is_day",
        "timezone": "auto"}, timeout=TIMEOUT).json()
    cur = fc.get("current") or {}
    temp_i = round(float(cur.get("temperature_2m") or 0))
    precip_i = round(float(cur.get("precipitation") or 0) * 10)
    wind_i = round(float(cur.get("wind_speed_10m") or 0))
    code_i = int(cur.get("weather_code") or 0)
    tier, score = risk(temp_i, precip_i, wind_i, code_i)
    return {"query": city, "resolved": r["name"], "lat_e5": lat_e5, "lon_e5": lon_e5,
            "temp": temp_i, "prec": precip_i, "wind": wind_i, "code": code_i,
            "tier": tier, "score": score}


def main():
    rows = []
    seen = set()
    for c in CITIES:
        if c in seen:
            continue
        seen.add(c)
        try:
            row = scan(c)
            if row:
                rows.append(row)
                print("  %-18s -> %-14s %-7s %3d (w%3d p%3d t%3d c%2d)" % (
                    c, row["resolved"][:14], row["tier"], row["score"],
                    row["wind"], row["prec"], row["temp"], row["code"]), flush=True)
        except Exception as e:
            print("  %-18s ERROR %s" % (c, str(e)[:60]), flush=True)
    rows.sort(key=lambda x: x["score"], reverse=True)
    medplus = [r for r in rows if r["score"] >= 150]
    print("\n=== Medium+ cities (level-1 geocode path) ===")
    for r in medplus:
        print("  %-16s %-7s %3d  lat_e5=%d lon_e5=%d  (query=%s)" % (
            r["resolved"][:16], r["tier"], r["score"], r["lat_e5"], r["lon_e5"], r["query"]))
    print("\ntotal scanned=%d  Medium+=%d  High+=%d  Extreme=%d" % (
        len(rows), len(medplus), len([r for r in rows if r["score"] >= 250]),
        len([r for r in rows if r["score"] >= 400])))


if __name__ == "__main__":
    sys.exit(main())
