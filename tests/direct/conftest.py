"""Shared fixtures and mock helpers for WeatherQuest direct-mode tests.

The weather multiplier is now DETERMINISTIC (no weather LLM), so these helpers
only mock the Open-Meteo geocoding + forecast endpoints and the single remaining
action-judgment LLM prompt. The multiplier/risk tier a test asserts is derived by
the contract itself from the mocked `current` block, so the presets below pin the
exact integer snapshot the contract's _risk_from_snapshot consumes.
"""
import json
import os
import sys

GEN = 10**18

# Windows-only local shim. The GenLayer direct loader does
# os.dup2(fd, 0); os.close(fd); os.unlink(path) but fd 0 still references the temp
# file on Windows, so os.unlink raises PermissionError [WinError 32]. This wrapper
# only tolerates that on win32 so the local suite can run; CI on Linux exercises the
# real loader unchanged and is the authority. Never touches contract logic.
if sys.platform == "win32":
    _real_unlink = os.unlink

    def _tolerant_unlink(path, *args, **kwargs):
        try:
            return _real_unlink(path, *args, **kwargs)
        except PermissionError:
            return None

    os.unlink = _tolerant_unlink


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
    transaction clock from ``gl.message_raw['datetime']`` - so we bridge that
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


# --- Weather presets that pin the deterministic multiplier/tier -------------
# All-integer calm day: wind 7 (<20), no precip, temp 14 (5..25), code 3 ->
# hw/hp/ht/hc all 0 -> score 100 -> tier Low, multiplier 100 (1.00x).
CALM = {
    "temperature_2m": 14.1, "precipitation": 0.0, "weather_code": 3,
    "wind_speed_10m": 6.8, "relative_humidity_2m": 85,
}
# Windy day: wind 35 (30..39 -> hw 60), rest neutral -> score 160 -> Medium, 1.60x.
WINDY = {
    "temperature_2m": 14.0, "precipitation": 0.0, "weather_code": 3,
    "wind_speed_10m": 35.0, "relative_humidity_2m": 60,
}
# Severe thunderstorm: hits every high band and clamps to 500 -> Extreme.
STORM = {
    "temperature_2m": 38.0, "precipitation": 30.0, "weather_code": 96,
    "wind_speed_10m": 70.0, "relative_humidity_2m": 95,
}


def mock_weather(direct_vm, current=None):
    """Wire up geocoding + forecast for a free-form city. Only the non-payout
    preview helper get_weather_multiplier (level 0) uses the geocode path now."""
    current = current or CALM
    direct_vm.mock_web(
        r"geocoding-api\.open-meteo\.com.*",
        {"status": 200, "body": json.dumps(LONDON_GEOCODE)},
    )
    direct_vm.mock_web(
        r"api\.open-meteo\.com/v1/forecast.*",
        {"status": 200, "body": json.dumps(forecast(current))},
    )


def mock_forecast_only(direct_vm, current=None):
    """Campaign levels (1-10) skip geocoding and fetch the forecast directly, so only
    the forecast URL needs mocking; the geocode mock is harmless if left unused."""
    current = current or CALM
    direct_vm.mock_web(
        r"api\.open-meteo\.com/v1/forecast.*",
        {"status": 200, "body": json.dumps(forecast(current))},
    )


def mock_llm_judgment(direct_vm, success=True, why="fine", relevant=True):
    """Mock the ONE action-judgment LLM call. The judge now returns a STRUCTURED
    RUBRIC and the contract DERIVES success (it ignores any model-supplied
    'success'). The old kwargs stay readable for callers: relevant -> on_topic,
    success -> safe. A decoy 'success' (the OPPOSITE of the derived verdict) and a
    free-text 'why' are injected to prove the contract uses only the rubric."""
    rubric = {
        "on_topic": relevant,
        "concrete_action": True,
        "manipulation": False,
        "safe": success,
        # Decoys the contract MUST ignore (derived success never reads these):
        "success": not success,
        "why": why,
    }
    direct_vm.mock_llm(r".*Return strict JSON.*", json.dumps(rubric))


def mock_rubric(direct_vm, on_topic=True, concrete_action=True, manipulation=False,
                safe=True, **extra):
    """Mock the judge with an EXPLICIT rubric (plus any extra/decoy keys) so a test
    can pin the derived-success truth table or prove extra keys are ignored."""
    payload = {
        "on_topic": on_topic,
        "concrete_action": concrete_action,
        "manipulation": manipulation,
        "safe": safe,
    }
    payload.update(extra)
    direct_vm.mock_llm(r".*Return strict JSON.*", json.dumps(payload))


def mock_raw_llm(direct_vm, payload):
    """Mock the judge with an arbitrary payload (dict or raw string) to drive the
    malformed / missing-key / non-dict fail-closed paths."""
    body = payload if isinstance(payload, str) else json.dumps(payload)
    direct_vm.mock_llm(r".*Return strict JSON.*", body)


def deploy(direct_deploy, direct_vm, direct_alice, house=1000):
    """Deploy the contract and fund the house so >1x payouts can settle.

    NOTE: direct mode exposes a contract's GEN through its *native* balance
    (``self.balance`` -> WASI ``get_self_balance``), which is backed by the VM
    balance map. That map is only mutated by ``deal()`` - payable calls and
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


# NOTE: make_quest was removed. The quest-marketplace escrow (create_quest) is
# DISABLED on this deployment and reverts unconditionally, so no quest can be
# created and submit_action / claim_expired_quest are unreachable.
