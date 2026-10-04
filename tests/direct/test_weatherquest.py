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
    hex_addr,
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


# --- Progressive campaign: complete_level + hasCompletedLevel ---------------
def test_complete_level_success_pays_and_marks(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=2.0, tier="Medium")
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    res = c.complete_level(1, "London", "Take shelter indoors")
    assert res["success"] is True
    assert res["level"] == 1
    assert res["difficulty"] == "Easy"
    assert int(res["payout"]) == 20 * GEN  # 10 GEN base * 2.0x weather multiplier
    assert c.has_completed_level(hex_addr(direct_bob), 1) is True
    assert c.get_completed_levels(hex_addr(direct_bob)) == [1]
    prog = c.campaign_progress(hex_addr(direct_bob))
    assert prog["completed_count"] == 1
    assert prog["next_level"] == 2
    assert int(prog["campaign_payout_atto"]) == 20 * GEN


def test_complete_level_replay_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=2.0, tier="Medium")
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    c.complete_level(1, "London", "Take shelter indoors")
    # Anti-cheat: the same wallet cannot complete the same level twice.
    with direct_vm.expect_revert("Level already completed"):
        c.complete_level(1, "London", "Take shelter indoors")


def test_complete_level_fail_not_marked_retryable(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=4.0, tier="Extreme")
    mock_llm_judgment(direct_vm, success=False)
    direct_vm.sender = direct_bob
    res = c.complete_level(9, "London", "Sprint through the storm")
    assert res["success"] is False
    assert int(res["payout"]) == 0
    assert c.has_completed_level(hex_addr(direct_bob), 9) is False
    # A failed level is NOT marked complete, so replay is still allowed — the
    # anti-cheat guard only fires once a level actually succeeds. (The direct-mode
    # judge mock is global, so this second attempt also fails; the assertion is
    # that it does NOT revert with "Level already completed".)
    res2 = c.complete_level(9, "London", "Wait indoors until the storm passes")
    assert res2["success"] is False
    assert c.has_completed_level(hex_addr(direct_bob), 9) is False


def test_complete_level_distinct_levels_are_independent(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=1.5, tier="Low")
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    c.complete_level(1, "London", "Walk")
    c.complete_level(2, "London", "Walk")  # different level -> not a replay
    assert c.get_completed_levels(hex_addr(direct_bob)) == [1, 2]
    assert c.campaign_progress(hex_addr(direct_bob))["next_level"] == 3


def test_complete_level_invalid_level_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Level must be 1..10"):
        c.complete_level(0, "London", "Wait")
    with direct_vm.expect_revert("Level must be 1..10"):
        c.complete_level(11, "London", "Wait")


def test_complete_level_empty_city_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("City must not be empty"):
        c.complete_level(1, "   ", "Wait")


def test_complete_level_empty_action_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Action must not be empty"):
        c.complete_level(1, "London", "   ")


def test_complete_level_requires_funding(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice, house=1)  # house holds only 1 GEN
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=2.0, tier="Medium")
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    # L1 base 10 GEN * 2.0x = 20 GEN payout > 1 GEN house -> fail-closed revert.
    with direct_vm.expect_revert("Contract balance insufficient"):
        c.complete_level(1, "London", "Take shelter indoors")
    assert c.has_completed_level(hex_addr(direct_bob), 1) is False  # revert left no state


def test_complete_level_per_wallet_isolation(direct_vm, direct_deploy, direct_alice, direct_bob):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    mock_weather(direct_vm)
    mock_llm_analysis(direct_vm, multiplier=1.5, tier="Low")
    mock_llm_judgment(direct_vm, success=True)
    direct_vm.sender = direct_bob
    c.complete_level(1, "London", "Walk")
    # A different wallet has its own progress (hasCompletedLevel[bob][1] != [alice][1]).
    assert c.has_completed_level(hex_addr(direct_alice), 1) is False
    assert c.get_completed_levels(hex_addr(direct_alice)) == []


def test_get_level_reward_progressive_table(direct_vm, direct_deploy, direct_alice):
    c = deploy(direct_deploy, direct_vm, direct_alice)
    l1 = c.get_level_reward(1)
    assert l1["difficulty"] == "Easy"
    assert int(l1["base_reward_atto"]) == 10 * GEN
    assert int(l1["max_payout_atto"]) == 50 * GEN   # 10 * 5.0x
    l5 = c.get_level_reward(5)
    assert l5["difficulty"] == "Medium"
    assert int(l5["base_reward_atto"]) == 25 * GEN
    l10 = c.get_level_reward(10)
    assert l10["difficulty"] == "Hard"
    assert int(l10["base_reward_atto"]) == 100 * GEN
    assert int(l10["max_payout_atto"]) == 500 * GEN  # 100 * 5.0x
