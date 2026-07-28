from app.services.consumable_effects import parse_consumable_effects
from app.services.effects import (
    apply_effect_to_health,
    apply_expired_effects_to_health,
    apply_periodic_effects_to_health,
    get_bleeding_state,
    tick_effects,
)


def test_dried_fish_reduces_stress_without_intoxication():
    profile = parse_consumable_effects(
        "Сушеная рыба. Для использования нужна 1/3 бутылки воды или 1 порция любого алкоголя. "
        "Снижает Уровень стресса на 1. -1/2 Уровня истощения. 3 Использования"
    )

    assert "intoxication_delta" not in profile["direct"]
    assert profile["direct"]["stress_delta"] == -1
    assert profile["direct"]["requires_water_fraction"] == 1 / 3


def test_beer_is_marked_as_alcohol_for_food_requirements():
    profile = parse_consumable_effects(
        "\u0411\u0430\u043d\u043a\u0430 \u043f\u0438\u0432\u0430. "
        "+20 \u043e\u043f\u044c\u044f\u043d\u0435\u043d\u0438\u044f."
    )

    assert profile["direct"]["is_alcohol"] is True


def test_tobacco_requires_fire_and_uses_five_minute_delay():
    profile = parse_consumable_effects(
        "Сигареты Тест. Снижение стресса через 5 минут"
    )

    assert profile["direct"]["requires_fire"] is True
    delayed = next(
        effect for effect in profile["effects"]
        if effect["type"] == "delayed_adjustment"
    )
    assert delayed["time_unit"] == "minute"
    assert delayed["remaining_seconds"] == 300


def test_dry_ration_counts_as_food_and_water():
    profile = parse_consumable_effects(
        "\u0421\u0443\u0445\u043e\u0439 \u043f\u0430\u0435\u043a. "
        "\u0414\u043b\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f "
        "\u043d\u0443\u0436\u043d\u0430 1/3 \u0431\u0443\u0442\u044b\u043b\u043a\u0438 \u0432\u043e\u0434\u044b. "
        "\u0421\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044f \u0435\u0434\u043e\u0439 \u0438 \u0432\u043e\u0434\u043e\u0439."
    )

    assert profile["direct"]["nutrition"] == 1
    assert profile["direct"]["satisfy_food"] is True
    assert profile["direct"]["satisfy_water"] is True
    assert profile["direct"]["requires_water_fraction"] == 1 / 3


def test_water_requirement_is_inferred_for_any_consumable_description():
    profile = parse_consumable_effects(
        "\u0414\u043b\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f "
        "\u043d\u0443\u0436\u043d\u044b 2/3 \u0431\u0443\u0442\u044b\u043b\u043a\u0438 \u0432\u043e\u0434\u044b."
    )

    assert profile["direct"]["requires_water_fraction"] == 2 / 3


def test_jelly_and_cotton_have_different_bleeding_effects():
    jelly = parse_consumable_effects(
        'Кровоостанавливающее "Желе". Ампула. Останавливает ухудшение стадий кровопотери на 5 ходов.'
    )
    cotton = parse_consumable_effects(
        'Кровоостанавливающее "Хлопок". Ампула. Останавливает все кровотечения. '
        'Блокирует появление новых кровотечений на 10 ходов. +1 Уровень истощения.'
    )

    jelly_types = {effect["type"] for effect in jelly["effects"]}
    cotton_types = {effect["type"] for effect in cotton["effects"]}
    assert "blood_loss_freeze" in jelly_types
    assert "bleeding_prevention" not in jelly_types
    assert "bleeding_prevention" in cotton_types
    assert cotton["direct"]["stop_all_bleeding"] is True


def test_antirad_is_periodic_instead_of_immediate():
    profile = parse_consumable_effects("Антирад-Б. Ампула. -5 радиации. Действует 4 хода. +1 Уровень истощения")
    treatment = next(effect for effect in profile["effects"] if effect["type"] == "radiation_treatment")

    assert "radiation_delta" not in profile["direct"]
    assert treatment["value"] == -5
    assert treatment["remaining"] == 4
    assert treatment["tick"] == "turn_end"


def test_bleedings_on_different_body_parts_do_not_merge():
    health = {"effects": []}
    apply_effect_to_health(health, {"id": "a", "type": "bleeding_external_light", "area": "leftArm"})
    apply_effect_to_health(health, {"id": "b", "type": "bleeding_external_light", "area": "rightArm"})

    bleeding = get_bleeding_state(health)
    assert len(health["effects"]) == 2
    assert bleeding["totalSeverity"] == 2
    assert {item["area"] for item in bleeding["effects"]} == {"leftArm", "rightArm"}


def test_periodic_effect_applies_on_every_remaining_turn():
    health = {
        "current": 100,
        "max": 700,
        "zones": {
            "leftArm": {"current": 10, "max": 200},
            "rightArm": {"current": 20, "max": 200},
        },
        "effects": [],
    }
    effects = [{"type": "regeneration", "value": 50, "remaining": 2, "tick": "turn_end"}]

    apply_periodic_effects_to_health(health, effects, "turn_end")
    effects = tick_effects(effects, "turn_end")
    apply_periodic_effects_to_health(health, effects, "turn_end")
    effects = tick_effects(effects, "turn_end")

    assert health["current"] == 200
    assert health["zones"]["leftArm"]["current"] == 60
    assert health["zones"]["rightArm"]["current"] == 70
    assert effects == []


def test_immediate_healing_restores_pool_and_distributes_over_zones():
    health = {
        "current": 100,
        "max": 700,
        "zones": {
            "leftLeg": {"current": 20, "max": 100},
            "rightLeg": {"current": 40, "max": 100},
        },
    }

    apply_effect_to_health(health, {"type": "heal", "value": 30})

    assert health["current"] == 130
    assert health["zones"]["leftLeg"]["current"] == 35
    assert health["zones"]["rightLeg"]["current"] == 55


def test_zone_healing_redistributes_overflow_from_nearly_full_zone():
    health = {
        "current": 100,
        "max": 700,
        "zones": {
            "leftArm": {"current": 95, "max": 100},
            "rightArm": {"current": 20, "max": 100},
        },
    }

    apply_effect_to_health(health, {"type": "heal", "value": 30})

    assert health["zones"]["leftArm"]["current"] == 100
    assert health["zones"]["rightArm"]["current"] == 45


def test_zone_healing_distributes_only_whole_points():
    health = {
        "current": 100,
        "max": 700,
        "zones": {
            name: {"current": 100, "max": 150}
            for name in ("head", "chest", "abdomen", "leftArm", "rightArm", "leftLeg")
        },
    }

    apply_effect_to_health(health, {"type": "heal", "value": 25})

    currents = [zone["current"] for zone in health["zones"].values()]
    assert currents == [105, 104, 104, 104, 104, 104]
    assert all(isinstance(value, int) for value in currents)


def test_internal_bleeding_keeps_anatomical_source():
    health = {"effects": []}
    apply_effect_to_health(health, {
        "id": "organ-tear",
        "type": "bleeding_internal_severe",
        "area": "chest",
    })

    bleeding = get_bleeding_state(health)

    assert bleeding["breakdown"]["internal"]["severe"] == 1
    assert bleeding["breakdown"]["internal"]["total"] == 3
    assert bleeding["effects"][0]["kind"] == "internal"
    assert bleeding["effects"][0]["area"] == "chest"


def test_delayed_treatment_activates_adjustment_and_duration_effect():
    health = {"painLevel": 4, "effects": []}
    delayed = {
        "type": "delayed_treatment",
        "remaining": 1,
        "tick": "turn_end",
        "adjustments": [{"field": "painLevel", "delta": -1, "min": 0, "max": 10}],
        "activate_effects": [{"type": "analgesia", "value": 1, "remaining": 8, "tick": "turn_end"}],
    }

    apply_expired_effects_to_health(health, [delayed])

    assert health["painLevel"] == 3
    assert any(effect["type"] == "analgesia" and effect["remaining"] == 8 for effect in health["effects"])


def test_blood_collection_kit_is_not_mistaken_for_blood_packet():
    profile = parse_consumable_effects(
        "Набор для забора крови. При использовании выкачивает кровь и преобразует Набор для забора крови в Пакет крови."
    )

    assert profile["direct"]["blood_collection"] is True
    assert "requires_infusion_tool" not in profile["direct"]
    assert not any(effect["type"] == "blood_recovery" for effect in profile["effects"])


def test_hinged_splint_is_not_mistaken_for_tourniquet():
    profile = parse_consumable_effects(
        "Шина Шарнирова. Используется при лечении переломов. При использовании со жгутом позволяет использовать его на любой конечности."
    )

    assert profile["direct"]["fracture_splint"] is True
    assert "applications" not in profile["direct"]
    assert "tourniquet" not in profile["direct"]


def test_adrenaline_keeps_its_own_action_point_profile():
    profile = parse_consumable_effects(
        "Адреналин. Ампула. +3 ОД на 3 хода. Убирает одышку. -50 здоровья -1 Уровень истощения. "
        "Нельзя использовать в один ход с энергетиками и эпинефрином"
    )

    assert profile["direct"]["action_points_delta"] == 3
    assert profile["direct"]["hp"] == -50
    assert "weight_delta" not in profile["direct"]


def test_movement_duration_is_applied_to_stat_modifier():
    profile = parse_consumable_effects(
        "Стимулятор. +2 к Силе на 3 перемещения."
    )

    strength = next(modifier for modifier in profile["modifiers"] if modifier["stat"] == "strength")
    assert profile["direct"]["duration"] == 3
    assert profile["direct"]["duration_phase"] == "movement_end"
    assert strength["remaining"] == 3


def test_pain_block_returns_accumulated_pain_on_expiry():
    health = {"painLevel": 1, "exhaustion": 0, "combatMeta": {"blockedPain": 3}, "effects": []}
    effect = {
        "type": "pain_block", "remaining": 1, "tick": "turn_end",
        "return_fraction": 1, "exhaustion_on_expire": 1,
    }

    apply_expired_effects_to_health(health, [effect])

    assert health["painLevel"] == 4
    assert health["exhaustion"] == 1
    assert "blockedPain" not in health["combatMeta"]
