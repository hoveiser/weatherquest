"""Shared fixtures and mock helpers for WeatherQuest direct-mode tests."""
import json

GEN = 10**18

LONDON_GEOCODE = {
    "results": [
        {"id": 2643743, "name": "London", "latitude": 51.50853, "longitude": -0.12574,
         "country_code": "GB", "country": "United Kingdom"}
    ],
    "generationtime_ms": 0.5,
}


def forecast(current):
    return {
        "latitude": 51.51, "longitude": -0.13, "timezone": "Europe/London",
        "current": current,
    }


CALM = {
    "time": "2026-10-03T09:15", "interval": 900, "temperature_2m": 14.1,
    "precipitation": 0.0, "weather_code": 3, "wind_speed_10m": 6.8,
    "relative_humidity_2m": 85, "is_day": 1,
}


def mock_weather(direct_vm, city="London", current=None):
    """Wire up geocoding + forecast + both LLM prompts for a calm London day."""
    current = current or CALM
    direct_vm.mock_web(
        r"geocoding-api\.open-meteo\.com.*",
        {"status": 200, "body": json.dumps(LONDON_GEOCODE)},
    )
    direct_vm.mock_web(
        r"api\.open-meteo\.com/v1/forecast.*",
        {"status": 200, "body": json.dumps(forecast(current))},
    )


def mock_llm_analysis(direct_vm, multiplier=2.0, tier="Medium", reasoning="Windy."):
    direct_vm.mock_llm(
        r".*risk engine of a weather-based bounty game.*",
        json.dumps({"multiplier": multiplier, "risk_tier": tier, "reasoning": reasoning}),
    )


def mock_llm_judgment(direct_vm, success=True, reasoning="Safe enough."):
    direct_vm.mock_llm(
        r".*Judge whether performing this action.*",
        json.dumps({"success": success, "reasoning": reasoning}),
    )


def deploy(direct_deploy, direct_vm, direct_alice):
    """Deploy the contract and fund the house so >1x payouts can settle."""
    contract = direct_deploy("contracts/weatherquest.py")
    direct_vm.sender = direct_alice
    direct_vm.value = 1000 * GEN
    contract.deposit()
    direct_vm.value = 0
    return contract


def make_quest(direct_vm, direct_alice, contract, city="London", gen=10, hours=24):
    direct_vm.sender = direct_alice
    direct_vm.value = gen * GEN
    qid = contract.create_quest(city, gen * GEN, "test quest", hours)
    direct_vm.value = 0
    return qid
