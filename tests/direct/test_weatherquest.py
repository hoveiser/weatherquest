"""Direct-mode tests for the WeatherQuest contract.

Run with the GenLayer test SDK installed (`genlayer[tests]`):
    pytest tests/direct/ -v

Direct mode exercises the leader path only (validation, state, escrow,
fail-closed reverts). The weather multiplier is now DETERMINISTIC, so every
assertion below is a plain number derived by the contract from the mocked
`current` block - not from an LLM. The single remaining LLM (action judgment) is
mocked with `mock_llm_judgment`. Pure validator-side helpers and exact-consensus
comparison are covered in `test_validator_logic.py` (stubbed genlayer module).
"""
import json

import pytest
from conftest import (
    GEN, CALM, WINDY, STORM, deploy, make_quest, mock_weather, mock_forecast_only,
    mock_llm_judgment, warp, hex_addr,
)

TROMSO = "Troms\u00f8"  # Tromso with the o-slash, matching the contract table byte for byte


# --- create_quest validation ------------------------------------------------
def test_create_quest_empty_city_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN
    with direct_vm.expect_revert("City must not be empty"):
        c.create_quest("   ", 10 * GEN, "d", 24)


def test_create_quest_zero_reward_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.value = 0
    with direct_vm.expect_revert("base_reward must be 1..1000 GEN"):
        c.create_quest("London", 0, "d", 24)


def test_create_quest_reward_too_large_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.value = 1001 * GEN
    with direct_vm.expect_revert("base_reward must be 1..1000 GEN"):
        c.create_quest("London", 1001 * GEN, "d", 24)


@pytest.mark.parametrize("hours", [0, 169, 9999])
def test_create_quest_bad_expiry_reverts(direct_vm, direct_deploy, direct_alice, hours):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.value = 10 * GEN
    with direct_vm.expect_revert("expiry_hours must be"):
        c.create_quest("London", 10 * GEN, "d", hours)


def test_create_quest_escrow_mismatch_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    direct_vm.value = 5 * GEN  # under-paying the 10 GEN reward
    with direct_vm.expect_revert("Must lock exactly base_reward GEN"):
        c.create_quest("London", 10 * GEN, "d", 24)


def test_create_quest_success_and_readback(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=24)
    assert qid == "Q0"
    q = c.get_quest(qid)
    assert q["city"] == "London"
    assert q["status"] == "Active"
    assert int(q["base_reward_atto"]) == 10 * GEN
    assert c.list_quests()[0]["quest_id"] == "Q0"


# --- get_weather_multiplier (deterministic, free-form geocode path) ---------
def test_get_weather_multiplier_calm_is_low_100(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)
    direct_vm.sender = direct_alice
    res = c.get_weather_multiplier("London")
    assert int(res["multiplier_x100"]) == 100
    assert res["risk_tier"] == "Low"


def test_get_weather_multiplier_windy_is_medium_160(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, WINDY)
    direct_vm.sender = direct_alice
    res = c.get_weather_multiplier("London")
    assert int(res["multiplier_x100"]) == 160
    assert res["risk_tier"] == "Medium"


def test_get_weather_multiplier_storm_clamps_to_500(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, STORM)
    direct_vm.sender = direct_alice
    res = c.get_weather_multiplier("London")
    assert int(res["multiplier_x100"]) == 500  # clamped MULT_MAX
    assert res["risk_tier"] == "Extreme"


def test_get_weather_multiplier_invalid_city_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.mock_web(r"geocoding-api\.open-meteo\.com.*",
                       {"status": 200, "body": '{"generationtime_ms":0.5}'})  # no results
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXTERNAL] No location found"):
        c.get_weather_multiplier("zzxxqqnowhere")


def test_get_weather_multiplier_malformed_weather_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.mock_web(r"geocoding-api\.open-meteo\.com.*", {"status": 200, "body": json.dumps({
        "results": [{"latitude": 51.5, "longitude": -0.1}]})})
    bad = {"current": {"temperature_2m": 10, "precipitation": 0, "wind_speed_10m": 5,
                       "relative_humidity_2m": 50, "weather_code": None}}
    direct_vm.mock_web(r"api\.open-meteo\.com/v1/forecast.*",
                       {"status": 200, "body": json.dumps(bad)})
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXTERNAL] Malformed weather data"):
        c.get_weather_multiplier("London")


def test_get_weather_multiplier_empty_city_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("City must not be empty"):
        c.get_weather_multiplier("  ")


# --- submit_action settlement ----------------------------------------------
def test_submit_success_pays_multiplier(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=24)
    mock_weather(direct_vm, WINDY)  # deterministic 1.60x
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.submit_action(qid, "Take cover indoors")
    assert res["success"] is True
    assert int(res["multiplier_x100"]) == 160
    assert int(res["payout"]) == 16 * GEN  # 10 * 1.60x
    assert c.get_quest(qid)["status"] == "Completed"


def test_submit_failure_refunds_creator(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=24)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=False)
    direct_vm.sender = direct_bob
    res = c.submit_action(qid, "Run a marathon in a blizzard")
    assert res["success"] is False
    assert int(res["payout"]) == 0
    assert c.get_quest(qid)["status"] == "Failed"
    assert int(c.contract_balance()) == 1000 * GEN  # house remains funded


def test_submit_empty_action_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Action must not be empty"):
        c.submit_action(qid, "   ")


def test_submit_duplicate_or_resolved_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=False)  # fail path avoids needing funds
    direct_vm.sender = direct_bob
    c.submit_action(qid, "Drive")
    # First submission resolves the quest (Failed), so it is no longer Active and a
    # second submission hits the active-status guard.
    with direct_vm.expect_revert("not active"):
        c.submit_action(qid, "Drive again")


def test_submit_expired_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    warp(direct_vm, "2026-10-03T09:15:00")
    qid = make_quest(direct_vm, direct_alice, c, hours=1)
    warp(direct_vm, "2026-10-03T11:00:00")  # 1h45m later -> expired
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("This quest has expired"):
        c.submit_action(qid, "Run")


def test_submit_nonexistent_quest_reverts(direct_vm, direct_deploy, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_bob)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("does not exist"):
        c.submit_action("Q999", "Run")


def test_submit_api_timeout_fail_closed(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c)
    direct_vm.mock_web(r"geocoding-api\.open-meteo\.com.*", {"status": 503, "body": b""})
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("[TRANSIENT] Geocoding temporarily unavailable"):
        c.submit_action(qid, "Run")


# --- claim_expired_quest ----------------------------------------------------
def test_claim_expired_only_creator(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    warp(direct_vm, "2026-10-03T09:15:00")
    qid = make_quest(direct_vm, direct_alice, c, hours=1)
    warp(direct_vm, "2026-10-04T09:15:00")  # expired
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the creator can claim"):
        c.claim_expired_quest(qid)


def test_claim_expired_before_expiry_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    warp(direct_vm, "2026-10-03T09:15:00")
    qid = make_quest(direct_vm, direct_alice, c, hours=24)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Quest has not expired yet"):
        c.claim_expired_quest(qid)


def test_claim_expired_returns_funds(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    warp(direct_vm, "2026-10-03T09:15:00")
    bal_after_create = int(c.contract_balance())
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=1)
    warp(direct_vm, "2026-10-04T09:15:00")  # expired, no submissions
    direct_vm.sender = direct_alice
    c.claim_expired_quest(qid)
    assert c.get_quest(qid)["status"] == "Claimed"
    assert int(c.contract_balance()) == bal_after_create  # 10 out, 10 back


# --- Progressive campaign: complete_level -----------------------------------
def test_complete_level_success_pays_and_marks(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, WINDY)  # 1.60x Low->Medium
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.complete_level(1, "London", "Take shelter indoors", 20, 25)  # Good 1.0x
    assert res["success"] is True
    assert res["level"] == 1
    assert res["difficulty"] == "Easy"
    assert int(res["payout"]) == (16 * GEN) // 100  # L1 base 0.1 * 1.6x * 1.0x
    assert res["efficiency"] == "Good"
    assert int(res["efficiency_x100"]) == 100
    assert c.has_completed_level(hex_addr(direct_bob), 1) is True
    assert c.get_completed_levels(hex_addr(direct_bob)) == [1]
    prog = c.campaign_progress(hex_addr(direct_bob))
    assert prog["completed_count"] == 1
    assert prog["next_level"] == 2
    assert int(prog["campaign_payout_atto"]) == (16 * GEN) // 100


def test_complete_level_perfect_run_grants_capped_speed_bonus(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)  # 1.0x
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    # Perfect (actual <= optimal + 2) -> 1.2x efficiency (reduced from 1.5x).
    res = c.complete_level(1, "London", "Take shelter indoors", 20, 20)
    assert res["efficiency"] == "Perfect"
    assert int(res["efficiency_x100"]) == 120
    assert int(res["payout"]) == (12 * GEN) // 100  # 0.1 * 1.0 * 1.2


def test_complete_level_wandering_is_penalized(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.complete_level(1, "London", "Take shelter indoors", 10, 25)  # Wandering 0.5x
    assert res["efficiency"] == "Wandering"
    assert int(res["efficiency_x100"]) == 50
    assert int(res["payout"]) == (5 * GEN) // 100  # 0.1 * 1.0 * 0.5


def test_complete_level_lost_gets_near_zero(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.complete_level(1, "London", "Take shelter indoors", 10, 100)  # Lost 0.1x
    assert res["efficiency"] == "Lost"
    assert int(res["efficiency_x100"]) == 10
    assert int(res["payout"]) == (1 * GEN) // 100  # 0.1 * 1.0 * 0.1


@pytest.mark.parametrize("level,city", [
    (2, "Tokyo"),
    (7, "Rio de Janeiro"),
    (8, "Port of Spain"),
    (10, TROMSO),
])
def test_complete_level_table_cities_are_accepted(direct_vm, direct_deploy, direct_alice, direct_bob, level, city):
    """Levels 2-10 must accept the exact campaign city (case-insensitive) and skip
    geocoding, fetching the forecast straight from the fixed coordinate table."""
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_forecast_only(direct_vm, CALM)  # table path: no geocode mock needed
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.complete_level(level, city, "Take shelter indoors", 20, 20)
    assert res["success"] is True
    assert res["city"] == city  # canonical city returned, not truncated
    assert int(res["multiplier_x100"]) == 100


def test_complete_level_wrong_city_for_table_level_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    # Level 2 is bound to Tokyo; a mismatch reverts deterministically BEFORE consensus.
    with direct_vm.expect_revert("Level 2 requires city 'Tokyo'"):
        c.complete_level(2, "London", "Take shelter indoors", 20, 20)


def test_complete_level_city_match_is_case_insensitive(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_forecast_only(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.complete_level(7, "rio de janeiro", "Wait it out", 20, 20)  # lowercase ok
    assert res["success"] is True


def test_complete_level_zero_optimal_steps_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("optimal_steps must be 1..500"):
        c.complete_level(1, "London", "Take shelter indoors", 0, 10)


def test_complete_level_actual_below_optimal_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("actual_steps must be >= optimal_steps"):
        c.complete_level(1, "London", "Take shelter indoors", 30, 10)


def test_complete_level_steps_over_max_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("actual_steps must be <= 500"):
        c.complete_level(1, "London", "Take shelter indoors", 10, 600)


def test_complete_level_replay_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    c.complete_level(1, "London", "Take shelter indoors", 20, 25)
    with direct_vm.expect_revert("Level already completed"):
        c.complete_level(1, "London", "Take shelter indoors", 20, 25)


def test_complete_level_fail_not_marked_retryable(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, STORM)
    mock_llm_judgment(direct_vm, success=False)
    direct_vm.sender = direct_bob
    res = c.complete_level(1, "London", "Sprint through the storm", 20, 25)
    assert res["success"] is False
    assert int(res["payout"]) == 0
    assert c.has_completed_level(hex_addr(direct_bob), 1) is False
    # A failed level is NOT marked complete, so replay is still allowed (does NOT
    # revert with "Level already completed").
    res2 = c.complete_level(1, "London", "Wait indoors until the storm passes", 20, 25)
    assert res2["success"] is False
    assert c.has_completed_level(hex_addr(direct_bob), 1) is False


def test_complete_level_distinct_levels_are_independent(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)  # free-form geocode for L1
    mock_forecast_only(direct_vm, CALM)  # table path for L2 (Tokyo)
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    c.complete_level(1, "London", "Walk", 10, 10)
    c.complete_level(2, "Tokyo", "Walk", 10, 10)  # different level -> not a replay
    assert c.get_completed_levels(hex_addr(direct_bob)) == [1, 2]
    assert c.campaign_progress(hex_addr(direct_bob))["next_level"] == 3


def test_complete_level_invalid_level_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Level must be 1..10"):
        c.complete_level(0, "London", "Wait", 10, 10)
    with direct_vm.expect_revert("Level must be 1..10"):
        c.complete_level(11, "London", "Wait", 10, 10)


def test_complete_level_empty_city_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("City must not be empty"):
        c.complete_level(1, "   ", "Wait", 10, 10)


def test_complete_level_empty_action_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Action must not be empty"):
        c.complete_level(1, "London", "   ", 10, 10)


def test_complete_level_requires_funding(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice, house=1)  # house holds only 1 GEN
    mock_forecast_only(direct_vm, CALM)  # 1.0x
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    # L10 base 1 GEN * 1.0x * 1.2x (Perfect) = 1.2 GEN payout > 1 GEN house -> revert.
    with direct_vm.expect_revert("Contract balance insufficient"):
        c.complete_level(10, TROMSO, "Take shelter indoors", 20, 20)
    assert c.has_completed_level(hex_addr(direct_bob), 10) is False  # revert left no state


def test_complete_level_per_wallet_isolation(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    c.complete_level(1, "London", "Walk", 10, 10)
    assert c.has_completed_level(hex_addr(direct_alice), 1) is False
    assert c.get_completed_levels(hex_addr(direct_alice)) == []


def test_get_level_reward_progressive_table(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    l1 = c.get_level_reward(1)
    assert l1["difficulty"] == "Easy"
    assert int(l1["base_reward_atto"]) == (10 * GEN) // 100
    assert int(l1["max_payout_atto"]) == (50 * GEN) // 100   # 0.1 * 5.0x
    l5 = c.get_level_reward(5)
    assert l5["difficulty"] == "Medium"
    assert int(l5["base_reward_atto"]) == (25 * GEN) // 100
    l10 = c.get_level_reward(10)
    assert l10["difficulty"] == "Hard"
    assert int(l10["base_reward_atto"]) == (100 * GEN) // 100
    assert int(l10["max_payout_atto"]) == (500 * GEN) // 100  # 1.0 * 5.0x


# --- Internal credit accounting (StudioNet cannot move native GEN to EOAs) ---
# On StudioNet emit_transfer to an EOA fails "Contract not found", so payouts
# are recorded as a per-address credit that the house keeps. These tests lock
# the invariant: credit == exact payout, house native balance untouched, credits
# accumulate, and unpaid addresses read zero.
def test_credit_matches_payout_on_complete_level(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, WINDY)  # 1.60x
    mock_llm_judgment(direct_vm, success=True)
    assert int(c.get_credit(hex_addr(direct_bob))["credit_atto"]) == 0
    direct_vm.sender = direct_bob
    res = c.complete_level(1, "London", "Take shelter indoors", 20, 25)
    payout = int(res["payout"])
    assert payout == (16 * GEN) // 100
    assert int(c.get_credit(hex_addr(direct_bob))["credit_atto"]) == payout
    # The GEN never leaves the house: native balance is unchanged by the credit.
    assert int(c.contract_balance()) == 1000 * GEN


def test_credit_accumulates_across_levels(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)  # free-form L1 1.0x
    mock_forecast_only(direct_vm, CALM)  # table L2 (Tokyo) 1.0x
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    r1 = c.complete_level(1, "London", "Take shelter indoors", 20, 20)
    r2 = c.complete_level(2, "Tokyo", "Take shelter indoors", 20, 20)
    total = int(r1["payout"]) + int(r2["payout"])
    assert int(c.get_credit(hex_addr(direct_bob))["credit_atto"]) == total
    assert int(c.contract_balance()) == 1000 * GEN


def test_credit_isolated_per_account(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    c.complete_level(1, "London", "Take shelter indoors", 20, 20)
    # A different address is owed nothing.
    assert int(c.get_credit(hex_addr(direct_alice))["credit_atto"]) == 0


def test_submit_success_credits_player(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=24)
    mock_weather(direct_vm, WINDY)  # 1.60x
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.submit_action(qid, "Take cover indoors")
    assert int(res["payout"]) == 16 * GEN
    assert int(c.get_credit(hex_addr(direct_bob))["credit_atto"]) == 16 * GEN
    assert int(c.contract_balance()) == 1000 * GEN


def test_submit_failure_credits_creator_refund(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=24)
    mock_weather(direct_vm, CALM)
    mock_llm_judgment(direct_vm, success=False)
    direct_vm.sender = direct_bob
    res = c.submit_action(qid, "Run a marathon in a blizzard")
    assert int(res["payout"]) == 0
    # Creator is refunded the base by credit, not by a native transfer.
    assert int(c.get_credit(hex_addr(direct_alice))["credit_atto"]) == 10 * GEN
    assert int(c.contract_balance()) == 1000 * GEN


def test_claim_expired_credits_creator(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    warp(direct_vm, "2026-10-03T09:15:00")
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=1)
    warp(direct_vm, "2026-10-04T09:15:00")  # expired, no submissions
    direct_vm.sender = direct_alice
    c.claim_expired_quest(qid)
    assert c.get_quest(qid)["status"] == "Claimed"
    assert int(c.get_credit(hex_addr(direct_alice))["credit_atto"]) == 10 * GEN
