from app.services.effects import (
    advance_timed_effects,
    apply_effect_to_health,
    apply_periodic_effects_to_health,
    canonical_type,
    get_bleeding_state,
    normalize_effect,
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
