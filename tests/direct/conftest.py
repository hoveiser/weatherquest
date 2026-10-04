"""Shared fixtures and mock helpers for WeatherQuest direct-mode tests."""
import json
import sys

GEN = 10**18


def hex_addr(account):
    """Render a fixture account (raw bytes) as the 0x-hex string a real caller
    would pass to an Address-typed method. The direct VM exposes fixture accounts
    as bytes; the contract stringifies ``gl.message.sender_address`` as hex, so
    view lookups must use the same hex form (the contract lowercases the key, so
    checksum vs lowercase is reconciled inside the contract)."""
    if isinstance(account, (bytes, bytearray)):
        return "0x" + bytes(account).hex()
    return str(account)


def warp(direct_vm, timestamp):
    """Advance the VM clock for time-based reverts.

    ``direct_vm.warp`` patches ``datetime.now`` and stores the timestamp, but
    the direct-mode harness does not propagate it into ``gl.message_raw``
    (only sender/origin are refreshed). The contract reads its deterministic
    transaction clock from ``gl.message_raw['datetime']`` — so we bridge that
    gap here without touching the contract. Mirrors the harness's own guard by
    only mutating the already-imported ``genlayer.gl`` module.
    """
    direct_vm.warp(timestamp)
    gl_mod = sys.modules.get("genlayer.gl")
    if gl_mod is not None and getattr(gl_mod, "message_raw", None) is not None:
        gl_mod.message_raw["datetime"] = timestamp

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
    # The multiplier is sent as a JSON string on purpose: GenVM calldata has no
    # float type, so the direct-mode LLM mock transport cannot round-trip a raw
    # float. The contract coerces it with float(str(...)) regardless.
    direct_vm.mock_llm(
        r".*risk engine of a weather-based bounty game.*",
        json.dumps({"multiplier": str(multiplier), "risk_tier": tier, "reasoning": reasoning}),
    )


def mock_llm_judgment(direct_vm, success=True, reasoning="Safe enough."):
    direct_vm.mock_llm(
        r".*Judge whether performing this action.*",
        json.dumps({"success": success, "reasoning": reasoning}),
    )


def deploy(direct_deploy, direct_vm, direct_alice, house=1000):
    """Deploy the contract and fund the house so >1x payouts can settle.

    NOTE: direct mode exposes a contract's GEN through its *native* balance
    (``self.balance`` -> WASI ``get_self_balance``), which is backed by the VM
    balance map. That map is only mutated by ``deal()`` — payable calls and
    ``emit_transfer`` do not move native GEN in direct mode. We therefore seed
    the deployed contract's native balance directly. (Full native-transfer
    accounting is covered by integration tests against a real environment.)
    """
    contract = direct_deploy("contracts/weatherquest.py")
    direct_vm.sender = direct_alice
    direct_vm.value = house * GEN
    contract.deposit()
    direct_vm.value = 0
    direct_vm.deal(direct_vm._contract_address, house * GEN)
    return contract


def make_quest(direct_vm, direct_alice, contract, city="London", gen=10, hours=24):
    direct_vm.sender = direct_alice
    direct_vm.value = gen * GEN
    qid = contract.create_quest(city, gen * GEN, "test quest", hours)
    direct_vm.value = 0
    return qid
