import pytest

from app.services.effects import (
    advance_timed_effects,
    apply_effect_to_health,
    apply_periodic_effects_to_health,
    canonical_type,
    create_effect_draft,
    get_bleeding_state,
    normalize_effect,
    sync_health_derived_statuses,
    tick_effect,
    tick_effects,
)


def test_effect_aliases_are_canonicalized():
    assert canonical_type("heal") == "heal"
    assert canonical_type("bleeding_internal_extreme") == "bleeding_internal_extreme"
    assert canonical_type("") == "generic"


def test_normalization_preserves_executable_metadata():
    effect = normalize_effect({
        "type": "delayed_adjustment",
        "turns": 2,
        "tickPhase": "day_start",
        "adjustments": [{"field": "stress", "delta": -2}],
        "custom_flag": True,
    })

    assert effect["remaining"] == 2
    assert effect["tick"] == "day_start"
    assert effect["adjustments"] == [{"field": "stress", "delta": -2}]
    assert effect["custom_flag"] is True


def test_manual_effect_does_not_tick():
    effect = tick_effect({
        "type": "analgesia",
        "remaining": 3,
        "tick": "manual",
    })

    assert effect["remaining"] == 3


def test_effect_only_ticks_during_matching_phase():
    effect = {
        "type": "infection_growth_block",
        "remaining": 2,
        "tick": "day_start",
    }

    after_turn = tick_effect(effect, "turn_end")
    after_day = tick_effect(effect, "day_start")

    assert after_turn["remaining"] == 2
    assert after_day["remaining"] == 1


def test_expired_effect_is_removed_from_active_list():
    effects = tick_effects([
        {"type": "analgesia", "remaining": 1, "tick": "turn_end"},
        {"type": "fracture", "remaining": None, "tick": "manual"},
    ])

    assert [effect["type"] for effect in effects] == ["fracture"]


def test_persist_at_zero_keeps_expired_effect():
    effects = tick_effects([{
        "type": "generic",
        "remaining": 1,
        "tick": "turn_end",
        "persist_at_zero": True,
    }])

    assert len(effects) == 1
    assert effects[0]["remaining"] == 0


def test_bleeding_prevention_blocks_new_bleeding():
    health = {
        "effects": [{
            "type": "bleeding_prevention",
            "remaining": 3,
            "tick": "turn_end",
        }],
    }

    apply_effect_to_health(health, {
        "type": "bleeding_external_severe",
        "area": "leftArm",
    })

    assert get_bleeding_state(health)["totalSeverity"] == 0
    assert len(health["effects"]) == 1


def test_closed_and_suppressed_bleeding_do_not_raise_difficulty():
    health = {
        "effects": [
            {"type": "bleeding_external_light", "closed": True},
            {"type": "bleeding_internal_severe", "suppressed": True},
            {"type": "bleeding_external_medium", "area": "rightLeg"},
        ],
    }

    bleeding = get_bleeding_state(health)

    assert bleeding["totalSeverity"] == 3
    assert bleeding["difficulty"] == 8
    assert len(bleeding["effects"]) == 1


def test_periodic_adjustment_respects_bounds():
    health = {"stress": 1, "exhaustion": 9}
    effects = [{
        "type": "periodic_adjustment",
        "remaining": 2,
        "tick": "turn_end",
        "adjustments": [
            {"field": "stress", "delta": -5, "min": 0, "max": 10},
            {"field": "exhaustion", "delta": 5, "min": 0, "max": 10},
        ],
    }]

    apply_periodic_effects_to_health(health, effects)

    assert health["stress"] == 0
    assert health["exhaustion"] == 10


def test_blood_recovery_improves_stage_without_passing_normal():
    health = {"blood": "medium", "bloodStage": "medium"}
    effect = {
        "type": "blood_recovery",
        "value": 1,
        "remaining": 3,
        "tick": "turn_end",
    }

    apply_periodic_effects_to_health(health, [effect])
    assert health["blood"] == "light"

    apply_periodic_effects_to_health(health, [effect])
    apply_periodic_effects_to_health(health, [effect])
    assert health["blood"] == "normal"


def test_numeric_status_effects_are_clamped():
    health = {
        "radiation": 2,
        "painLevel": 9,
        "stress": 1,
        "intoxication": 95,
    }

    apply_effect_to_health(health, {"type": "radiation", "value": -10})
    apply_effect_to_health(health, {"type": "pain", "value": 5})
    apply_effect_to_health(health, {"type": "stress", "value": -5})
    apply_effect_to_health(health, {"type": "intoxication", "value": 20})

    assert health["radiation"] == 0
    assert health["painLevel"] == 10
    assert health["stress"] == 0
    assert health["intoxication"] == 100


def test_new_fracture_adds_three_pain_only_once():
    health = {"painLevel": 1, "effects": []}
    fracture = {
        "type": "fracture",
        "area": "rightArm",
        "source": "combat_attack",
    }

    apply_effect_to_health(health, fracture)
    apply_effect_to_health(health, fracture)

    assert health["painLevel"] == 4
    assert len([
        effect
        for effect in health["effects"]
        if effect["type"] == "fracture"
    ]) == 1


def test_fixed_fracture_is_kept_as_separate_status_without_extra_pain():
    health = {"painLevel": 3, "effects": []}

    apply_effect_to_health(health, {
        "type": "fracture_fixed",
        "area": "rightArm",
        "source": "splint",
    })

    assert health["painLevel"] == 3
    assert any(
        effect["type"] == "fracture_fixed" and effect["area"] == "rightArm"
        for effect in health["effects"]
    )


def test_fixed_fracture_expires_after_one_day_without_restoring_original_fracture():
    health = {"painLevel": 3, "effects": []}

    effects = [{
        "type": "fracture_fixed",
        "area": "rightArm",
        "remaining": 24,
        "remaining_seconds": 86400,
        "time_unit": "hour",
        "tick": "time_elapsed",
    }]

    effects = advance_timed_effects(health, effects, 86399)
    assert effects[0]["remaining_seconds"] == 1

    assert advance_timed_effects(health, effects, 1) == []
    assert health["effects"] == []


def test_regular_healing_does_not_restore_knocked_out_limb():
    health = {
        "current": 500,
        "max": 700,
        "zones": {
            "leftArm": {"current": 0, "max": 90},
            "rightArm": {"current": 50, "max": 90},
        },
        "effects": [],
    }

    apply_effect_to_health(health, {"type": "heal", "value": 20})

    assert health["current"] == 520
    assert health["zones"]["leftArm"]["current"] == 0
    assert health["zones"]["rightArm"]["current"] == 70


def test_temporary_limb_restoration_caps_healing_and_returns_limb_to_zero():
    health = {
        "current": 500,
        "max": 700,
        "zones": {"leftArm": {"current": 1, "max": 90}},
        "effects": [{
            "type": "temporary_limb_restoration",
            "area": "leftArm",
            "previous_health": 0,
            "health_cap": 1,
            "remaining": 4,
            "tick": "turn_end",
        }],
    }

    apply_effect_to_health(health, {"type": "heal", "value": 20})
    assert health["zones"]["leftArm"]["current"] == 1

    assert advance_timed_effects(health, health["effects"], 24, include_turn_effects=True) == []
    assert health["zones"]["leftArm"]["current"] == 0


def test_delayed_limb_treatment_cures_fractures_and_sets_zone_health_after_minute():
    health = {
        "zones": {"leftArm": {"current": 0, "max": 90}},
        "effects": [
            {"type": "fracture", "area": "leftArm", "active": True},
            {"type": "fracture_fixed", "area": "leftArm", "active": True},
            {
                "type": "delayed_limb_treatment",
                "area": "leftArm",
                "cure_fracture": True,
                "restore_limb_health": 50,
                "remaining": 1,
                "remaining_seconds": 60,
                "tick": "time_elapsed",
                "time_unit": "minute",
            },
        ],
    }

    effects = advance_timed_effects(health, health["effects"], 59)
    assert health["zones"]["leftArm"]["current"] == 0
    assert any(effect["type"] == "fracture" for effect in effects)

    effects = advance_timed_effects(health, effects, 1)
    assert health["zones"]["leftArm"]["current"] == 50
    assert not any(effect["type"] in {"fracture", "fracture_fixed"} for effect in effects)


def test_lost_organ_treatment_window_expires_without_removing_status():
    health = {"effects": []}
    effect = create_effect_draft("organ_loss", {"area": "leftEye"})

    effects = advance_timed_effects(health, [effect], 3600)

    assert len(effects) == 1
    assert effects[0]["type"] == "organ_loss"
    assert effects[0]["treatment_window_expired"] is True
    assert effects[0]["treatment_window_seconds"] == 0


def test_five_minute_delayed_effect_advances_in_six_second_rounds():
    health = {"stress": 5}
    effects = [{
        "type": "delayed_adjustment",
        "name": "Stress after five minutes",
        "remaining": 5,
        "remaining_seconds": 300,
        "time_unit": "minute",
        "tick": "time_elapsed",
        "adjustments": [{"field": "stress", "delta": -2, "min": 0, "max": 10}],
    }]

    effects = advance_timed_effects(health, effects, 294)
    assert effects[0]["remaining_seconds"] == 6
    assert health["stress"] == 5

    effects = advance_timed_effects(health, effects, 6)
    assert effects == []
    assert health["stress"] == 3


def test_rest_expires_minute_and_turn_effects():
    health = {"painLevel": 3}
    effects = [
        {
            "type": "limb_trauma_suppression",
            "remaining": 10,
            "time_unit": "minute",
            "tick": "time_elapsed",
        },
        {"type": "analgesia", "remaining": 3, "tick": "turn_end"},
    ]

    assert advance_timed_effects(
        health, effects, 3600, include_turn_effects=True
    ) == []


def test_elapsed_time_expires_consumable_stat_modifiers():
    health = {
        "combatMeta": {
            "consumableModifiers": [
                {"stat": "strength", "value": 5, "remaining": 2, "tick": "turn_end"},
                {"stat": "accuracy", "value": 5, "remaining": 3, "tick": "turn_end"},
            ],
        },
    }

    advance_timed_effects(health, [], 12)

    assert health["combatMeta"]["consumableModifiers"] == [
        {
            "stat": "accuracy",
            "value": 5,
            "remaining": 1,
            "remaining_seconds": 6,
            "tick": "turn_end",
        },
    ]


def test_radiation_filter_uses_max_hours_as_duration():
    health = {}
    effects = [{
        "type": "radiation_filter",
        "name": "Incoming radiation reduction",
        "remaining": None,
        "max_hours": 24,
        "tick": "movement_end",
    }]

    effects = advance_timed_effects(health, effects, 8 * 3600)

    assert effects[0]["remaining"] == 16
    assert effects[0]["time_unit"] == "hour"
    assert effects[0]["remaining_seconds"] == 16 * 3600
    assert advance_timed_effects(health, effects, 16 * 3600) == []


def test_zero_total_health_creates_permanent_death_once():
    health = {
        "current": 0,
        "max": 700,
        "zones": {},
        "effects": [{"type": "shock", "source": "combat_damage"}],
    }

    sync_health_derived_statuses(health)
    sync_health_derived_statuses(health)

    deaths = [effect for effect in health["effects"] if effect["type"] == "death"]
    assert len(deaths) == 1
    assert deaths[0]["source"] == "zero_total_health"
    assert deaths[0]["tick"] == "manual"


def test_zero_head_health_does_not_create_death():
    health = {
        "current": 650,
        "max": 700,
        "zones": {"head": {"current": 0, "max": 50}},
        "effects": [],
    }

    sync_health_derived_statuses(health)

    assert not any(effect["type"] == "death" for effect in health["effects"])


@pytest.mark.parametrize(
    ("organ", "source"),
    [("brain", "zero_brain_health"), ("skull", "zero_skull_health")],
)
def test_zero_brain_or_skull_health_creates_death(organ, source):
    health = {
        "current": 650,
        "max": 700,
        "organs": {organ: {"current": 0, "max": 1}},
        "effects": [],
    }

    sync_health_derived_statuses(health)

    death = next(effect for effect in health["effects"] if effect["type"] == "death")
    assert death["source"] == source


def test_fracture_becomes_unfixed_after_thirty_minutes(monkeypatch):
    health = {"effects": []}
    apply_effect_to_health(health, {"type": "fracture", "area": "leftLeg"})

    effects = advance_timed_effects(health, health["effects"], 10 * 60)
    fracture = next(effect for effect in effects if effect["type"] == "fracture")
    assert fracture["regular_fixation_seconds"] == 20 * 60
    assert fracture["hinged_fixation_seconds"] == 20 * 60

    monkeypatch.setattr("app.services.effects.random.randint", lambda *_: 25)
    effects = advance_timed_effects(health, effects, 20 * 60)

    unfixed = next(effect for effect in effects if effect["type"] == "fracture_unfixed")
    consequence = next(effect for effect in effects if effect["type"] == "fracture_sequela")
    assert unfixed["permanent_penalty"] is True
    assert consequence["area"] == "leftLeg"
