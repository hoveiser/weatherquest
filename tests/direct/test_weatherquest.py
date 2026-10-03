"""Direct-mode tests for the WeatherQuest contract.

Run with the GenLayer test SDK installed (`genlayer[tests]`):
    pytest tests/direct/ -v

Direct mode exercises the leader path only (validation, state, escrow,
fail-closed reverts). Consensus/validator agreement is covered by integration
tests against a real environment.
"""
import pytest
from conftest import (
    GEN, deploy, make_quest, mock_weather, mock_llm_analysis, mock_llm_judgment, warp,
)


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
    """value sent != base_reward -> must revert (funds not double-counted)."""
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


# --- get_weather_multiplier -------------------------------------------------
def test_get_weather_multiplier_ok(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=2.5, tier="High")
    direct_vm.sender = direct_alice
    res = c.get_weather_multiplier("London")
    assert int(res["multiplier_x100"]) == 250
    assert res["risk_tier"] == "High"


def test_get_weather_multiplier_invalid_city_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.mock_web(r"geocoding-api\.open-meteo\.com.*",
                       {"status": 200, "body": '{"generationtime_ms":0.5}'})  # no results
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("[EXTERNAL] No location found"):
        c.get_weather_multiplier("zzxxqqnowhere")


def test_get_weather_multiplier_bad_llm_reverts(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    direct_vm.mock_llm(r".*risk engine.*", '{"not": "the schema"}')  # missing multiplier
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("missing 'multiplier'"):
        c.get_weather_multiplier("London")


def test_multiplier_clamped_to_range(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=99.0, tier="Extreme")  # over max -> clamp 5.0
    direct_vm.sender = direct_alice
    res = c.get_weather_multiplier("London")
    assert int(res["multiplier_x100"]) == 500


# --- submit_action settlement ----------------------------------------------
def test_submit_success_pays_multiplier(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=24)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=3.0, tier="High")
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.submit_action(qid, "Take cover indoors")
    assert res["success"] is True
    assert int(res["payout"]) == 30 * GEN  # 10 * 3.0x
    assert c.get_quest(qid)["status"] == "Completed"


def test_submit_failure_refunds_creator(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c, gen=10, hours=24)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=4.0, tier="Extreme")
    mock_llm_judgment(direct_vm, success=False)
    direct_vm.sender = direct_bob
    res = c.submit_action(qid, "Run a marathon in a blizzard")
    assert res["success"] is False
    assert int(res["payout"]) == 0
    assert c.get_quest(qid)["status"] == "Failed"
    # On a failed judgment the contract emits the locked base back to the
    # creator (a native GEN transfer) and marks the quest Failed. Direct mode
    # does not move native GEN on emit_transfer, so we assert the observable
    # state transition here; native refund accounting is covered by integration
    # tests against a real environment.
    assert int(c.contract_balance()) == 1000 * GEN  # house remains funded


def test_submit_empty_action_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Action must not be empty"):
        c.submit_action(qid, "   ")


def test_submit_duplicate_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    qid = make_quest(direct_vm, direct_alice, c)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm)
    mock_llm_judgment(direct_vm, success=False)  # fail path avoids needing funds
    direct_vm.sender = direct_bob
    c.submit_action(qid, "Drive")
    # The first submission resolves the quest, so it is no longer active. A
    # second submission by the same player is rejected: because a resolved
    # quest is no longer Active, the active-status guard fires first (the
    # defensive per-player "already submitted" guard backs this up on-chain).
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
