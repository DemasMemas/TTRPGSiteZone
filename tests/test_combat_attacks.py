from types import SimpleNamespace

import pytest

import app.services.combat as combat_module
from app.services.combat import CombatService
from app.services.effects import sync_health_derived_statuses
from app.services.exceptions import ValidationError


def test_ranged_hit_zone_boundaries_follow_rules():
    assert CombatService._random_hit_zone(1) == "left_arm"
    assert CombatService._random_hit_zone(6) == "left_leg"
    assert CombatService._random_hit_zone(14) == "abdomen"
    assert CombatService._random_hit_zone(19) == "chest"
    assert CombatService._random_hit_zone(20) == "head"


def test_aimed_shot_can_override_hit_zone():
    assert CombatService._random_hit_zone(1, "head") == "head"


def test_melee_attack_variants_change_damage_and_penetration():
    weapon = {
        "damage": 100,
        "armor_piercing": 20,
    }

    piercing = CombatService._weapon_damage_profile(weapon, "колющий")
    cutting = CombatService._weapon_damage_profile(weapon, "режущий")

    assert piercing["damage"] == 125
    assert piercing["armor_piercing"] == 30
    assert cutting["damage"] == 75
    assert cutting["armor_piercing"] == 10


def test_unarmed_damage_uses_strength_bonus_with_minimum_ten():
    weak = {"skills": {"physical": {"strength": {"base": 5, "bonus": 0}}}}
    strong = {"skills": {"physical": {"strength": {"base": 18, "bonus": 0}}}}

    assert CombatService._virtual_melee_profile("unarmed", character_data=weak)["damage"] == 10
    assert CombatService._virtual_melee_profile("unarmed", character_data=strong)["damage"] == 40


def test_firearm_butt_uses_grip_damage_for_weapons_up_to_one_kilogram():
    grip = CombatService._virtual_melee_profile("firearm_butt", {"weight": 0.5})
    boundary = CombatService._virtual_melee_profile("firearm_butt", {"weight": 1})
    butt = CombatService._virtual_melee_profile("firearm_butt", {"weight": 3.5})

    assert grip["damage"] == 25
    assert boundary["damage"] == 25
    assert CombatService._melee_action_cost(boundary, "firearm_butt") == 2
    assert butt["damage"] == 40
    assert grip["armor_piercing"] == 0
    assert grip["melee_damage_type"] == "crushing"
    assert butt["melee_damage_type"] == "crushing"


def test_crushing_damage_multiplier_uses_twenty_percent_plus_five_per_kilogram():
    assert CombatService._crushing_damage_multiplier({
        "melee_damage_type": "crushing",
        "weight": 0,
    }) == 0.20
    assert CombatService._crushing_damage_multiplier({
        "melee_damage_type": "Дробящий",
        "weight": 1,
    }) == 0.25
    assert CombatService._crushing_damage_multiplier({
        "melee_damage_type": "crushing",
        "weight": 3,
    }) == 0.35


def test_unarmed_crushing_attack_deals_twenty_percent_on_non_penetration(
    monkeypatch,
):
    monkeypatch.setattr(CombatService, "_target_armor", lambda data, zone: (100, []))
    monkeypatch.setattr(
        CombatService,
        "_apply_attack_damage",
        lambda *args, **kwargs: {
            "current": 698,
            "zones": {"chest": {"current": 148}},
        },
    )
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": []}))
    target = SimpleNamespace(character=SimpleNamespace(data={}), hp_zones={})

    result = CombatService._resolve_attack(
        target,
        attacker,
        {
            "weapon_index": -1,
            "attack_type": "unarmed",
            "hit_difficulty": 1,
            "round_number": 1,
            "melee": True,
        },
        melee=True,
        attack_type="unarmed",
        aimed_zone="chest",
        forced_roll=20,
    )

    assert result["crushing_non_penetration"] is True
    assert result["crushing_damage_multiplier"] == 0.20
    assert result["base_damage"] == 10
    assert result["damage"] == 2


def test_melee_action_cost_uses_attack_and_weight_class_rules():
    assert CombatService._melee_action_cost(
        {"weight_class": "light"}, "unarmed"
    ) == 2
    assert CombatService._melee_action_cost({"weight_class": "light"}, "\u0440\u0443\u0431\u044f\u0449\u0438\u0439") == 2
    assert CombatService._melee_action_cost({"weight_class": "heavy"}, "\u0440\u0443\u0431\u044f\u0449\u0438\u0439") == 3
    assert CombatService._melee_action_cost({"weight_class": "heavy_plus"}, "\u0440\u0443\u0431\u044f\u0449\u0438\u0439") == 4
    assert CombatService._melee_action_cost({"weight_class": "heavy"}, "\u0440\u0435\u0436\u0443\u0449\u0438\u0439") == 2
    assert CombatService._melee_action_cost({"weight_class": "heavy"}, "\u043a\u043e\u043b\u044e\u0449\u0438\u0439") == 4
    assert CombatService._melee_action_cost({"weight_class": "heavy"}, "\u0432\u0441\u043f\u0430\u0440\u044b\u0432\u0430\u044e\u0449\u0438\u0439") == 5
    assert CombatService._melee_action_cost({"weight_class": "heavy"}, "\u043a\u0440\u0443\u0433\u043e\u0432\u043e\u0439") == 4


def test_circular_attack_uses_slashing_or_crushing_damage_profile(app):
    with app.app_context():
        slashing = CombatService._weapon_damage_profile(
            {
                "attributes": {
                    "damage": 40,
                    "allowed_attacks": ["\u0420\u0443\u0431\u044f\u0449\u0438\u0439", "\u041a\u0440\u0443\u0433\u043e\u0432\u043e\u0439"],
                }
            },
            "\u041a\u0440\u0443\u0433\u043e\u0432\u043e\u0439",
        )
        crushing = CombatService._weapon_damage_profile(
            {
                "attributes": {
                    "damage": 40,
                    "allowed_attacks": ["\u0414\u0440\u043e\u0431\u044f\u0449\u0438\u0439", "\u041a\u0440\u0443\u0433\u043e\u0432\u043e\u0439"],
                }
            },
            "\u041a\u0440\u0443\u0433\u043e\u0432\u043e\u0439",
        )

    assert slashing["melee_damage_type"] == "slashing"
    assert crushing["melee_damage_type"] == "crushing"


def test_melee_adjacency_includes_diagonal_but_not_two_tiles():
    actor = SimpleNamespace(pos_x=5, pos_y=5)

    assert CombatService._is_adjacent(
        actor, SimpleNamespace(pos_x=6, pos_y=6)
    )
    assert not CombatService._is_adjacent(
        actor, SimpleNamespace(pos_x=7, pos_y=5)
    )


def test_attack_summary_lists_each_target_damage_bleeding_and_trauma():
    summary = CombatService.format_attack_summary({
        "character": {"name": "Атакующий"},
        "attack": {
            "hits": 1,
            "damage_total": 42,
            "results": [
                {
                    "target_name": "Первая цель",
                    "roll": 17,
                    "rolls": [17],
                    "difficulty": 12,
                    "hit": True,
                    "mode": "melee",
                    "zone": "right_arm",
                    "damage": 42,
                    "armor": 20,
                    "armor_piercing": 30,
                    "bleedings": [{
                        "kind": "external",
                        "stage": "medium",
                    }],
                    "additional_traumas": [{
                        "roll": 8,
                        "fracture": True,
                        "bleeding": None,
                        "pain": 1,
                        "shock": False,
                    }],
                },
                {
                    "target_name": "Вторая цель",
                    "roll": 4,
                    "rolls": [4],
                    "difficulty": 15,
                    "hit": False,
                    "mode": "melee",
                },
            ],
        },
    })

    assert "Первая цель: d20 17, СЛ 12 — попадание: правая рука, урон 42" in summary
    assert "Кровотечение: среднее внешнее." in summary
    assert "Доп. травма: d20 8 (перелом, боль +1)." in summary
    assert "Вторая цель: d20 4, СЛ 15 — промах." in summary
    assert "Итого: попаданий 1/2, урон 42." in summary


def test_cover_attack_summary_shows_protection_and_target_behind_cover():
    summary = CombatService.format_attack_summary({
        "character": {"name": "Стрелок"},
        "attack": {
            "results": [{
                "target_name": "Стул",
                "roll": 12,
                "rolls": [12],
                "difficulty": 5,
                "hit": True,
                "mode": "unaimed",
                "cover_hit": True,
                "cover_penetrated": True,
                "cover_protection": 20,
                "cover_damage": {
                    "physical_protection": 0,
                    "hp": 100,
                    "max_hp": 100,
                },
                "target_behind_cover_name": "Цель",
                "target_behind_cover_result": {
                    "hit": True,
                    "zone": "chest",
                    "damage": 15,
                },
            }],
        },
    })

    assert "защита 20% → 0%, ОЗ 100/100; пробитие: да" in summary
    assert "За укрытием: Цель, грудь, урон 15" in summary


@pytest.mark.parametrize(
    ("effects", "expected_state"),
    [
        ([{"type": "pain_shock", "name": "Болевой шок"}], "pain_shock"),
        ([{"type": "unconscious", "name": "Без сознания"}], "critical"),
        ([{"type": "critical_condition"}], "critical"),
        ([{"type": "death"}], "dead"),
    ],
)
def test_character_condition_recognizes_incapacitating_effects(effects, expected_state):
    condition = CombatService._character_condition({"health": {"current": 100, "effects": effects}})

    assert condition["state"] == expected_state
    assert condition["can_act"] is False


def test_pain_shock_only_allows_recovery_attempt():
    character = SimpleNamespace(
        character=SimpleNamespace(
            data={"health": {"current": 100, "effects": [{"type": "shock"}]}}
        )
    )

    with pytest.raises(ValidationError, match="Only an attempt"):
        CombatService.ensure_character_can_act(character, "attack")

    condition = CombatService.ensure_character_can_act(character, "recover_from_shock")
    assert condition["can_recover"] is True


@pytest.mark.parametrize("effect_type", ["critical_condition", "death"])
def test_critical_and_dead_characters_cannot_use_recovery(effect_type):
    character = SimpleNamespace(
        character=SimpleNamespace(
            data={"health": {"current": 100, "effects": [{"type": effect_type}]}}
        )
    )

    with pytest.raises(ValidationError):
        CombatService.ensure_character_can_act(character, "recover_from_shock")


def test_end_turn_pain_shock_check_uses_pain_times_two_minus_will_bonus(monkeypatch):
    data = {
        "skills": {"physical": {"will": {"base": 14, "bonus": 0}}},
        "health": {"current": 100, "painLevel": 6, "effects": []},
    }
    character = SimpleNamespace(data=data)
    location_character = SimpleNamespace(
        character=character,
        posture="standing",
        cover_object_id=1,
        weapon_braced=True,
        braced_weapon_index=0,
    )
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: 9)
    monkeypatch.setattr(combat_module, "flag_modified", lambda instance, key: None)

    result = CombatService._resolve_pain_shock_check(location_character, 2)

    assert result["will_bonus"] == 2
    assert result["difficulty"] == 10
    assert result["success"] is False
    assert location_character.posture == "prone"
    assert CombatService._character_condition(data)["state"] == "pain_shock"
    assert data["health"]["painLevel"] == 6


def test_bleeding_check_keeps_base_will_bonus_separate_from_blood_penalty():
    data = {
        "skills": {"physical": {"will": {"base": 5, "bonus": 0}}},
        "health": {
            "blood": "light",
            "effects": [{
                "type": "bleeding_external_severe",
                "area": "rightArm",
            }],
        },
    }
    sync_health_derived_statuses(data["health"])

    profile = CombatService._bleeding_check_profile(data)

    assert profile["willBonus"] == -3
    assert profile["stateModifier"] == 0
    assert profile["severity"] == 5
    assert profile["stagePenalty"] == 1
    assert profile["difficulty"] == 12


def test_bleeding_check_applies_exhaustion_without_changing_will_bonus():
    data = {
        "skills": {"physical": {"will": {"base": 5, "bonus": 0}}},
        "health": {
            "blood": "normal",
            "exhaustion": 1,
            "effects": [{
                "type": "bleeding_external_light",
                "area": "leftArm",
            }],
        },
    }
    sync_health_derived_statuses(data["health"])

    profile = CombatService._bleeding_check_profile(data)

    assert profile["willBonus"] == -3
    assert profile["stateModifier"] == -1
    assert profile["difficulty"] == 10


def test_pain_shock_check_is_skipped_in_recovery_round(monkeypatch):
    data = {
        "skills": {"physical": {"will": {"base": 10, "bonus": 0}}},
        "health": {
            "current": 100,
            "painLevel": 5,
            "effects": [],
            "combatMeta": {"painShockRecovered": True},
        },
    }
    location_character = SimpleNamespace(character=SimpleNamespace(data=data))
    monkeypatch.setattr(
        combat_module.random,
        "randint",
        lambda start, end: pytest.fail("No roll should be made"),
    )

    assert CombatService._resolve_pain_shock_check(location_character, 4) is None
    assert data["health"]["painLevel"] == 5


def test_pain_below_five_does_not_require_shock_check(monkeypatch):
    data = {"health": {"current": 100, "painLevel": 4, "effects": []}}
    location_character = SimpleNamespace(character=SimpleNamespace(data=data))
    monkeypatch.setattr(
        combat_module.random,
        "randint",
        lambda start, end: pytest.fail("No roll should be made"),
    )

    assert CombatService._resolve_pain_shock_check(location_character, 2) is None


def test_recovered_character_checks_again_after_running(monkeypatch):
    data = {
        "skills": {"physical": {"will": {"base": 10, "bonus": 0}}},
        "health": {
            "current": 100,
            "painLevel": 5,
            "effects": [],
            "combatMeta": {"painShockRecovered": True},
        },
    }
    location_character = SimpleNamespace(
        character=SimpleNamespace(data=data),
        movement_mode_this_turn="run",
        posture="standing",
        cover_object_id=None,
        weapon_braced=False,
        braced_weapon_index=None,
    )
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: 9)
    monkeypatch.setattr(combat_module, "flag_modified", lambda instance, key: None)

    result = CombatService._resolve_pain_shock_check(location_character, 3)

    assert result["difficulty"] == 10
    assert result["recovered_triggers"]["strenuous_movement"] is True
    assert result["success"] is False


def test_pain_ten_applies_guaranteed_shock_and_blocks_recovery():
    health = {"current": 100, "painLevel": 10, "effects": []}

    sync_health_derived_statuses(health)
    data = {"health": health}
    condition = CombatService._character_condition(data)

    assert condition["state"] == "pain_shock"
    assert condition["can_recover"] is False
    with pytest.raises(ValidationError, match="reduced below 10"):
        CombatService.ensure_character_can_act(
            SimpleNamespace(character=SimpleNamespace(data=data)),
            "recover_from_shock",
        )


def test_back_attack_uses_target_facing():
    target = SimpleNamespace(pos_x=5, pos_y=5, facing_x=0, facing_y=1)

    assert CombatService._is_behind(
        SimpleNamespace(pos_x=5, pos_y=4), target
    )
    assert not CombatService._is_behind(
        SimpleNamespace(pos_x=5, pos_y=6), target
    )


def test_duplet_reuses_one_hit_roll_for_sequential_impacts(monkeypatch):
    forced_rolls = []

    def resolve(target, attacker, details, **kwargs):
        forced_rolls.append(kwargs.get("forced_roll"))
        return {
            "roll": kwargs.get("forced_roll") or 14,
            "hit": True,
            "damage": 10,
        }

    monkeypatch.setattr(CombatService, "_resolve_attack", resolve)
    results = CombatService._resolve_shot_sequence(
        [SimpleNamespace()],
        SimpleNamespace(),
        {"shot_count": 2},
        share_hit_roll=True,
    )

    assert forced_rolls == [None, 14]
    assert len(results) == 2
    assert all(result["shared_hit_roll"] for result in results)


def test_cover_continuation_only_accepts_three_cells_on_the_shot_line():
    shooter = SimpleNamespace(pos_x=0, pos_y=0)
    cover = SimpleNamespace(
        tile_x=2,
        tile_y=0,
        type="crate",
        properties={"dimensions": {"width": 1, "depth": 1}},
    )

    assert CombatService._cover_continuation_distance(
        shooter, cover, SimpleNamespace(pos_x=3, pos_y=0)
    ) == pytest.approx(0.5)
    assert CombatService._cover_continuation_distance(
        shooter, cover, SimpleNamespace(pos_x=5, pos_y=0)
    ) == pytest.approx(2.5)
    assert CombatService._cover_continuation_distance(
        shooter, cover, SimpleNamespace(pos_x=6, pos_y=0)
    ) is None
    assert CombatService._cover_continuation_distance(
        shooter, cover, SimpleNamespace(pos_x=3, pos_y=1)
    ) is None


def test_characters_behind_cover_include_second_and_third_cells(monkeypatch):
    shooter = SimpleNamespace(id=1, pos_x=0, pos_y=0)
    second_cell = SimpleNamespace(id=2, pos_x=4, pos_y=0)
    third_cell = SimpleNamespace(id=3, pos_x=5, pos_y=0)
    too_far = SimpleNamespace(id=4, pos_x=6, pos_y=0)
    cover = SimpleNamespace(
        tile_x=2,
        tile_y=0,
        type="crate",
        properties={"dimensions": {"width": 1, "depth": 1}},
    )

    class FakeQuery:
        def filter_by(self, **kwargs):
            return self

        def all(self):
            return [shooter, third_cell, too_far, second_cell]

    monkeypatch.setattr(
        combat_module,
        "LocationCharacter",
        SimpleNamespace(query=FakeQuery()),
    )

    assert CombatService._characters_behind_cover(1, shooter, cover) == [
        second_cell,
        third_cell,
    ]


def test_cover_attack_summary_reports_secondary_miss_without_unknown_zone():
    summary = CombatService.format_attack_summary({
        "character": {"name": "Стрелок"},
        "attack": {
            "results": [{
                "target_name": "Ящик",
                "roll": 15,
                "rolls": [15],
                "difficulty": 5,
                "hit": True,
                "mode": "unaimed",
                "cover_hit": True,
                "cover_penetrated": True,
                "cover_protection": 20,
                "cover_damage": {"physical_protection": 0, "hp": 0, "max_hp": 50},
                "target_behind_cover_name": "Цель",
                "target_behind_cover_result": {
                    "hit": False,
                    "roll": 4,
                    "rolls": [16, 4],
                    "difficulty": 12,
                    "damage": 0,
                },
            }],
        },
    })

    assert "За укрытием: Цель, d20 16/4, СЛ 12 — промах." in summary
    assert "неизвестная зона" not in summary


def test_unaimed_blind_fire_miss_can_damage_cover(monkeypatch):
    cover = SimpleNamespace(id=7, name="Ящик", type="crate")
    attacker = SimpleNamespace(
        character=SimpleNamespace(data={"weapons": [{}]}),
    )
    target = SimpleNamespace(
        character_id=2,
        character=SimpleNamespace(id=2, name="Цель", data={}),
        grapple_live_shield=False,
        grapple_target_id=None,
    )
    rolls = iter([3])
    cover_damage_calls = []

    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: next(rolls))
    monkeypatch.setattr(
        "app.services.combat.db.session.get",
        lambda model, object_id: cover if object_id == cover.id else None,
    )
    monkeypatch.setattr(
        CombatService,
        "_cover_profile",
        lambda obj: {"physical_protection": 20},
    )

    def apply_cover_damage(obj, damage, damage_type):
        cover_damage_calls.append((obj, damage, damage_type))
        return {
            "hp": 50,
            "max_hp": 100,
            "physical_protection": 10,
        }

    monkeypatch.setattr(CombatService, "apply_cover_damage", apply_cover_damage)

    result = CombatService._resolve_attack(
        target,
        attacker,
        {
            "weapon_index": 0,
            "fire_mode": "unaimed",
            "hit_difficulty": 12,
            "shooting_disadvantage": False,
            "cover": {
                "blind_fire": True,
                "zones": {"chest": {"object_id": cover.id}},
            },
        },
        profile_override={
            "damage": 50,
            "armor_piercing": 30,
            "damage_type": "bullet",
        },
        profile_adjusted=True,
    )

    assert result["hit"] is False
    assert result["automatic_cover_hit"] is True
    assert result["cover_hit"]["object_id"] == cover.id
    assert result["cover_hit"]["penetrated"] is True
    assert cover_damage_calls == [(cover, 50, "bullet")]

    summary = CombatService.format_attack_summary({
        "character": {"name": "Стрелок"},
        "attack": {"results": [result]},
    })
    assert "Цель: d20 3, СЛ 12 — промах." in summary
    assert "Пуля попала в Ящик: без проверки" in summary
    assert "защита 20% → 10%, ОЗ 50/100" in summary


def test_penetrated_cover_requires_disadvantaged_hit_roll_against_target(monkeypatch):
    attacker = SimpleNamespace(
        pos_x=0,
        pos_y=0,
        character=SimpleNamespace(data={"weapons": [{}]}),
    )
    target = SimpleNamespace(
        character_id=2,
        pos_x=3,
        pos_y=0,
        movement_mode_this_turn="run",
        character=SimpleNamespace(name="Target", data={}),
    )
    cover = SimpleNamespace(id=7, name="Crate", type="crate")
    resolved = {}

    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({"damage": 50, "armor_piercing": 40}, None),
    )
    monkeypatch.setattr(
        CombatService,
        "_cover_profile",
        lambda obj: {"physical_protection": 20},
    )
    monkeypatch.setattr(
        CombatService,
        "apply_cover_damage",
        lambda *args: {"hp": 50, "max_hp": 100, "physical_protection": 10},
    )
    monkeypatch.setattr(
        CombatService,
        "_characters_behind_cover",
        lambda *args: [target],
    )

    def resolve_attack(*args, **kwargs):
        resolved["details"] = args[2]
        resolved["kwargs"] = kwargs
        return {"hit": False, "roll": 4, "rolls": [15, 4], "damage": 0}

    monkeypatch.setattr(CombatService, "_resolve_attack", resolve_attack)
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: 20)

    result = CombatService._resolve_cover_attack(
        1,
        cover,
        attacker,
        {
            "weapon_index": 0,
            "fire_mode": "unaimed",
            "hit_difficulty": 5,
            "continuation_hit_difficulty": 11,
            "shooting_disadvantage": False,
            "target_distance": 2,
            "weapon_range": 10,
        },
    )

    assert resolved["details"]["shooting_disadvantage"] is True
    assert resolved["details"]["hit_difficulty"] == 13
    assert "forced_roll" not in resolved["kwargs"]
    assert result["automatic_cover_hit"] is True
    assert result["rolls"] == []
    assert result["difficulty"] is None
    assert result["target_behind_cover_result"]["hit"] is False
    assert result["damage"] == 0


def test_aimed_head_miss_hits_live_shield_head(monkeypatch):
    shield = SimpleNamespace(
        character=SimpleNamespace(data={"marker": "shield"}),
        hp_zones={},
        grapple_live_shield=False,
        grapple_target_id=None,
    )
    holder = SimpleNamespace(
        character=SimpleNamespace(data={"marker": "holder"}),
        hp_zones={},
        grapple_live_shield=True,
        grapple_target_id=2,
    )
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": [{}]}))
    monkeypatch.setattr(CombatService, "_live_shield_target", lambda target: shield)
    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({
            "damage": 100,
            "armor_piercing": 20,
            "bleeding": "",
            "effective_range": 0,
        }, None),
    )
    monkeypatch.setattr(CombatService, "_target_armor", lambda data, zone: (0, []))
    damaged = []

    def apply_damage(target, damage, zone, profile, **kwargs):
        damaged.append((target, damage, zone))
        return {"current": 600, "zones": {"head": {"current": 0}}}

    monkeypatch.setattr(CombatService, "_apply_attack_damage", apply_damage)
    result = CombatService._resolve_attack(
        holder,
        attacker,
        {
            "weapon_index": 0,
            "hit_difficulty": 10,
            "fire_mode": "aimed",
            "round_number": 1,
        },
        aimed_zone="head",
        forced_roll=1,
    )

    assert result["hit"] is False
    assert result["live_shield_reason"] == "aimed_head_miss"
    assert damaged == [(shield, 100, "head")]


def test_live_shield_takes_same_zone_before_remaining_penetration_hits_holder(
    monkeypatch,
):
    shield = SimpleNamespace(
        character=SimpleNamespace(data={"marker": "shield"}),
        hp_zones={},
        grapple_live_shield=False,
        grapple_target_id=None,
    )
    holder = SimpleNamespace(
        character=SimpleNamespace(data={"marker": "holder"}),
        hp_zones={},
        grapple_live_shield=True,
        grapple_target_id=2,
    )
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": [{}]}))
    monkeypatch.setattr(CombatService, "_live_shield_target", lambda target: shield)
    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({
            "damage": 100,
            "armor_piercing": 40,
            "bleeding": "",
            "effective_range": 0,
        }, None),
    )
    monkeypatch.setattr(
        CombatService,
        "_target_armor",
        lambda data, zone: ((20, []) if data.get("marker") == "shield" else (10, [])),
    )
    damaged = []

    def apply_damage(target, damage, zone, profile, **kwargs):
        damaged.append((target, damage, zone, profile["armor_piercing"]))
        return {"current": 600, "zones": {"chest": {"current": 50}}}

    monkeypatch.setattr(CombatService, "_apply_attack_damage", apply_damage)
    result = CombatService._resolve_attack(
        holder,
        attacker,
        {
            "weapon_index": 0,
            "hit_difficulty": 1,
            "fire_mode": "unaimed",
            "round_number": 1,
        },
        aimed_zone="chest",
        forced_roll=20,
    )

    assert damaged[0] == (shield, 100, "chest", 40)
    assert damaged[1] == (holder, 100, "chest", 20)
    assert result["live_shield_blocked"] is False
    assert result["combined_damage"] == 200


def test_behind_armor_damage_uses_caliber_rules_and_ammo_exceptions():
    assert CombatService._behind_armor_damage_multiplier({"caliber": "7.62x39"}) == 0.20
    assert CombatService._behind_armor_damage_multiplier({"caliber": "9х39"}) == 0.25
    assert CombatService._behind_armor_damage_multiplier({"caliber": "12.7x55"}) == 0.25
    assert CombatService._behind_armor_damage_multiplier({
        "caliber": "7.62x39", "ammo_variant": "ep",
    }) == 0
    assert CombatService._behind_armor_damage_multiplier({
        "caliber": "12x70", "ammo_name": "12x70 Картечь",
    }) == 0


def test_12x70_slug_and_exoskeleton_use_special_behind_armor_damage():
    slug = {"caliber": "12x70", "ammo_name": "12х70 Пуля"}
    expanding_slug = {**slug, "ammo_variant": "ep"}
    exoskeleton = {
        "equipment": {
            "armor": {
                "name": "Экзоскелет",
                "attributes": {"is_exoskeleton": True},
            },
        },
    }

    assert CombatService._behind_armor_damage_multiplier(slug) == pytest.approx(1 / 3)
    assert CombatService._behind_armor_damage_multiplier(expanding_slug) == 0.10
    assert CombatService._behind_armor_damage_multiplier(
        slug, target_data=exoskeleton,
    ) == pytest.approx(1 / 6)


def test_buckshot_deals_half_damage_to_mutant_on_large_non_penetration():
    buckshot = {"caliber": "12x70", "ammo_name": "12х70 Картечь"}
    mutant = {"basic": {"species": "Мутант"}}

    assert CombatService._behind_armor_damage_multiplier(
        buckshot,
        target_data=mutant,
        penetration_deficit=10,
    ) == 0.50
    assert CombatService._behind_armor_damage_multiplier(
        buckshot,
        target_data={"basic": {"species": "Человек"}},
        penetration_deficit=20,
    ) == 0


def test_full_non_penetration_applies_behind_armor_damage(monkeypatch):
    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({
            "damage": 100,
            "armor_piercing": 0,
            "bleeding": "",
            "caliber": "7.62x39",
            "effective_range": 0,
        }, None),
    )
    monkeypatch.setattr(CombatService, "_target_armor", lambda data, zone: (100, []))
    monkeypatch.setattr(
        CombatService,
        "_apply_attack_damage",
        lambda *args, **kwargs: {
            "current": 680,
            "zones": {"chest": {"current": 130}},
        },
    )
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": [{}]}))
    target = SimpleNamespace(character=SimpleNamespace(data={}), hp_zones={})

    result = CombatService._resolve_attack(
        target,
        attacker,
        {
            "weapon_index": 0,
            "hit_difficulty": 1,
            "fire_mode": "single",
            "round_number": 1,
        },
        aimed_zone="chest",
        forced_roll=20,
    )

    assert result["full_non_penetration"] is True
    assert result["behind_armor_multiplier"] == 0.20
    assert result["damage"] == 20


def test_127x55_full_penetration_checks_additional_trauma_twice(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({
            "damage": 130,
            "armor_piercing": 60,
            "bleeding": "",
            "caliber": "12.7x55",
            "effective_range": 0,
        }, None),
    )
    monkeypatch.setattr(CombatService, "_target_armor", lambda data, zone: (40, []))

    def capture_damage(*args, **kwargs):
        captured.update(kwargs)
        return {"current": 570, "zones": {"chest": {"current": 20}}}

    monkeypatch.setattr(CombatService, "_apply_attack_damage", capture_damage)
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": [{}]}))
    target = SimpleNamespace(character=SimpleNamespace(data={}), hp_zones={})

    CombatService._resolve_attack(
        target,
        attacker,
        {
            "weapon_index": 0,
            "hit_difficulty": 1,
            "fire_mode": "single",
            "round_number": 1,
        },
        aimed_zone="chest",
        forced_roll=20,
    )

    assert captured["trauma_checks"] == 2


def test_buckshot_loses_fixed_damage_and_penetration_after_five_meters(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({
            "damage": 250,
            "armor_piercing": 25,
            "bleeding": "",
            "caliber": "12x70",
            "ammo_name": "12х70 Картечь",
            "effective_range": 10,
        }, None),
    )
    monkeypatch.setattr(CombatService, "_target_armor", lambda data, zone: (0, []))

    def capture_damage(target, damage, zone, profile, **kwargs):
        captured.update({"damage": damage, "profile": profile, **kwargs})
        return {"current": 550, "zones": {"chest": {"current": 0}}}

    monkeypatch.setattr(CombatService, "_apply_attack_damage", capture_damage)
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": [{}]}))
    target = SimpleNamespace(character=SimpleNamespace(data={}), hp_zones={})

    CombatService._resolve_attack(
        target,
        attacker,
        {
            "weapon_index": 0,
            "hit_difficulty": 1,
            "fire_mode": "rapid",
            "round_number": 1,
            "target_distance": 7,
        },
        aimed_zone="chest",
        forced_roll=20,
    )

    assert captured["damage"] == 150
    assert captured["profile"]["armor_piercing"] == 15
    assert captured["trauma_checks"] == 3
    assert captured["trauma_difficulty_modifier"] == -20


def test_buckshot_mutant_rule_overrides_partial_damage_at_ten_percent_deficit(
    monkeypatch,
):
    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({
            "damage": 250,
            "armor_piercing": 5,
            "bleeding": "",
            "caliber": "12x70",
            "ammo_name": "12х70 Картечь",
            "effective_range": 10,
        }, None),
    )
    monkeypatch.setattr(CombatService, "_target_armor", lambda data, zone: (20, []))
    monkeypatch.setattr(
        CombatService,
        "_apply_attack_damage",
        lambda *args, **kwargs: {
            "current": 575,
            "zones": {"chest": {"current": 25}},
        },
    )
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": [{}]}))
    target = SimpleNamespace(
        character=SimpleNamespace(data={"basic": {"species": "Мутант"}}),
        hp_zones={},
    )

    result = CombatService._resolve_attack(
        target,
        attacker,
        {
            "weapon_index": 0,
            "hit_difficulty": 1,
            "fire_mode": "single",
            "round_number": 1,
            "target_distance": 5,
        },
        aimed_zone="chest",
        forced_roll=20,
    )

    assert result["full_non_penetration"] is False
    assert result["buckshot_mutant_non_penetration"] is True
    assert result["damage_multiplier"] == 0.50
    assert result["damage"] == 125


def test_armor_is_reduced_by_ammo_penetration_before_damage():
    effective_armor = max(0, 60 - 20)
    damage_reduction_steps = (effective_armor + 4) // 5
    damage = round(100 * max(0, 1 - damage_reduction_steps * 0.25))

    assert effective_armor == 40
    assert damage == 0


def test_armor_damage_advances_stage_and_carries_over_damage():
    armor = {
        "name": "Test armor",
        "durability": 10,
        "material": "композит",
        "stage": 1,
        "stageDurability": 100,
        "currentStageDurability": 100,
    }

    result = CombatService._damage_armor_item(armor, {}, 150)

    assert result["stage_before"] == 1
    assert result["stage_after"] == 2
    assert armor["currentStageDurability"] == 50


def test_broken_armor_loses_durability_and_protection_per_50_damage():
    armor = {
        "durability": 10,
        "material": "композит",
        "stage": 5,
        "currentStageDurability": 0,
    }

    CombatService._damage_armor_item(armor, {}, 120)

    assert armor["durability"] == 8
    assert armor["brokenProtectionLoss"] == 2


def test_gas_mask_has_no_stages_and_loses_fixed_durability():
    gas_mask = {
        "name": "Противогаз",
        "durability": 25,
        "stage": 3,
        "currentStageDurability": 4,
    }

    bullet = CombatService._damage_gas_mask(gas_mask, "bullet")
    anomaly = CombatService._damage_gas_mask(gas_mask, "anomaly")

    assert bullet["durability_after"] == 15
    assert anomaly["durability_after"] == 14
    assert gas_mask["durability"] == 14
    assert "stage" not in gas_mask
    assert "currentStageDurability" not in gas_mask


def test_broken_gas_mask_loses_all_protection():
    data = {
        "equipment": {
            "gasMask": {
                "name": "Противогаз",
                "category": "gas_mask",
                "durability": 0,
                "protection": {"physical": 0.75},
            },
        },
    }

    protection, layers = CombatService._target_armor(data, "head")

    assert protection == 0
    assert layers == []
    assert CombatService._functioning_gas_protection(data) is None


def test_functioning_gas_mask_fully_blocks_gas_projectile(monkeypatch):
    monkeypatch.setattr(
        CombatService,
        "_ranged_damage_profile",
        lambda weapon: ({
            "damage": 80,
            "armor_piercing": 100,
            "bleeding": "",
            "effective_range": 20,
            "damage_type": "chemical",
        }, None),
    )
    target_data = {
        "health": {
            "current": 700,
            "zones": {"head": {"current": 50, "max": 50}},
        },
        "equipment": {
            "gasMask": {
                "name": "Противогаз",
                "category": "gas_mask",
                "durability": 30,
                "protection": {"physical": 0.1},
            },
        },
    }
    attacker = SimpleNamespace(character=SimpleNamespace(data={"weapons": [{}]}))
    target = SimpleNamespace(character=SimpleNamespace(data=target_data), hp_zones={})

    result = CombatService._resolve_attack(
        target,
        attacker,
        {
            "weapon_index": 0,
            "hit_difficulty": 1,
            "fire_mode": "single",
            "round_number": 1,
        },
        aimed_zone="head",
        forced_roll=20,
    )

    assert result["gas_or_chemical_blocked"] is True
    assert result["damage"] == 0
    assert target_data["health"]["current"] == 700
    assert target_data["equipment"]["gasMask"]["durability"] == 30


def test_firearm_bleeding_uses_caliber_and_ammo_variant_modifiers():
    profile = {
        "caliber": "7.62x39",
        "ammo_variant": "ep",
        "armor_piercing": 50,
    }

    result = CombatService._roll_firearm_bleeding(profile, armor=20, forced_roll=3)

    assert result == {
        "roll": 3,
        "modifier": 4,
        "total": 7,
        "stage": "severe",
        "blocked_by_armor": False,
    }


def test_firearm_bleeding_is_blocked_when_armor_is_penetrated_by_less_than_ten():
    profile = {
        "caliber": "7.62x39",
        "ammo_variant": None,
        "armor_piercing": 35,
    }

    result = CombatService._roll_firearm_bleeding(profile, armor=30, forced_roll=6)

    assert result["stage"] is None
    assert result["roll"] is None
    assert result["blocked_by_armor"] is True


def test_blocked_penetration_prevents_profile_and_trauma_bleeding(monkeypatch):
    monkeypatch.setattr(combat_module, "flag_modified", lambda *args, **kwargs: None)
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: end)
    character = SimpleNamespace(data={
        "health": {
            "current": 700,
            "max": 700,
            "zones": {"chest": {"current": 150, "max": 150}},
            "effects": [],
        },
    })
    target = SimpleNamespace(character=character, hp_zones={})

    CombatService._apply_attack_damage(
        target,
        20,
        "chest",
        {"bleeding": "Сильное"},
        bleeding_result={"stage": "extreme"},
        allow_bleeding=False,
        round_number=1,
    )

    effects = character.data["health"]["effects"]
    assert not any("bleeding" in str(effect.get("type")) for effect in effects)


def test_damage_pain_uses_round_total_and_large_single_hit_thresholds():
    assert CombatService._damage_pain_requirement(49, 49) == 0
    assert CombatService._damage_pain_requirement(50, 50) == 1
    assert CombatService._damage_pain_requirement(149, 100) == 1
    assert CombatService._damage_pain_requirement(150, 100) == 2
    assert CombatService._damage_pain_requirement(151, 151) == 2
    assert CombatService._damage_pain_requirement(201, 201) == 3


def test_limb_damage_at_three_and_five_limits_creates_catastrophic_injuries(monkeypatch):
    monkeypatch.setattr(combat_module, "flag_modified", lambda *args, **kwargs: None)
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: start)
    character = SimpleNamespace(data={
        "health": {
            "current": 700,
            "max": 700,
            "zones": {"leftArm": {"current": 100, "max": 100}},
            "effects": [],
        },
    })
    target = SimpleNamespace(character=character, hp_zones={})

    CombatService._apply_attack_damage(
        target, 300, "left_arm", {}, allow_bleeding=False, round_number=1
    )
    effects = character.data["health"]["effects"]
    assert any(effect["type"] == "mangled_limb" for effect in effects)
    assert any(effect["type"] == "shock" for effect in effects)

    CombatService._apply_attack_damage(
        target, 200, "left_arm", {}, allow_bleeding=False, round_number=1
    )
    effects = character.data["health"]["effects"]
    amputation = next(effect for effect in effects if effect["type"] == "amputation")
    assert not any(effect["type"] == "mangled_limb" for effect in effects)
    assert amputation["loss_roll"] == 1
    assert amputation["loss_extent"] == "entire_limb"
    assert character.data["health"]["zones"]["leftArm"]["destructionDamage"] == 500


def test_mangled_and_missing_legs_have_increased_penalties():
    mangled = {
        "health": {
            "zones": {"leftLeg": {"current": 0, "max": 100}},
            "effects": [{"type": "mangled_limb", "area": "leftLeg"}],
        },
    }
    missing = {
        "health": {
            "zones": {"leftLeg": {"current": 0, "max": 100}},
            "effects": [{"type": "amputation", "area": "leftLeg"}],
        },
    }

    assert CombatService._disabled_limb_penalties(mangled)["movement"] == 5
    assert CombatService._disabled_limb_penalties(missing)["movement"] == 6


def test_disabled_limbs_apply_combat_and_movement_penalties():
    data = {
        "health": {
            "zones": {
                "leftArm": {"current": 0, "max": 90},
                "rightArm": {"current": 90, "max": 90},
                "leftLeg": {"current": 0, "max": 100},
                "rightLeg": {"current": 100, "max": 100},
                "abdomen": {"current": 0, "max": 120},
            }
        }
    }

    penalties = CombatService._disabled_limb_penalties(data)

    assert penalties["all"] == 3
    assert penalties["shooting"] == 3
    assert penalties["melee"] == 3
    assert penalties["agility"] == 3
    assert penalties["movement"] == 3
    assert penalties["sprint_blocked"] is True


def test_fixed_fracture_penalties_are_lower_for_arms_and_legs():
    arm_data = {
        "health": {
            "effects": [
                {"type": "fracture_fixed", "area": "leftArm", "active": True},
            ],
        },
    }
    leg_data = {
        "health": {
            "effects": [
                {"type": "fracture_fixed", "area": "rightLeg", "active": True},
            ],
        },
    }

    assert CombatService._skill_modifier(arm_data, "skills.physical.shooting") == -1
    assert CombatService._movement_penalty_breakdown(leg_data)["injuries"] == 2


def test_systemic_limb_treatment_suppresses_regular_and_fixed_fracture_penalties():
    data = {
        "health": {
            "effects": [
                {"type": "fracture", "area": "leftArm", "active": True},
                {"type": "fracture_fixed", "area": "rightLeg", "active": True},
                {
                    "type": "temporary_limb_restoration",
                    "area": "leftArm",
                    "suppress_fracture": True,
                    "remaining": 10,
                    "active": True,
                },
                {
                    "type": "temporary_limb_restoration",
                    "area": "rightLeg",
                    "suppress_fracture": True,
                    "remaining": 10,
                    "active": True,
                },
            ],
        },
    }

    assert CombatService._skill_modifier(data, "skills.physical.shooting") == 0
    assert CombatService._movement_penalty_breakdown(data)["injuries"] == 0


def test_aimed_head_shot_adds_five_difficulty():
    assert CombatService._aimed_zone_difficulty_penalty("head") == 5
    assert CombatService._aimed_zone_difficulty_penalty("chest") == 0


def test_only_pistol_subcategory_gets_cheap_unaimed_shot():
    assert CombatService._is_pistol_weapon({"subcategory": "пистолеты"}) is True
    assert CombatService._is_pistol_weapon({"subcategory": "пистолеты-пулеметы"}) is False


def test_fixed_magazine_uses_the_next_loaded_ammo_stack():
    weapon = {
        "fixedAmmo": [
            {
                "name": "standard",
                "quantity": 2,
                "attributes": {
                    "damage": 50,
                    "penetration": 0.2,
                    "caliber": "12x70",
                },
            },
            {
                "name": "RIP",
                "quantity": 1,
                "ammo_variant": "rip",
                "attributes": {
                    "damage": 150,
                    "penetration": 0.1,
                    "caliber": "12x70",
                    "ammo_variant": "rip",
                },
            },
        ]
    }

    profile, stack = CombatService._ranged_damage_profile(weapon)

    assert stack["name"] == "RIP"
    assert profile["damage"] == 150
    assert profile["armor_piercing"] == 10
    assert profile["ammo_variant"] == "rip"


def test_skill_rolls_use_blood_loss_stage_not_bleeding_severity():
    data = {
        "health": {
            "painLevel": 0,
            "exhaustion": 0,
            "bloodStage": "medium",
            "bleedingSeverity": 8,
            "temperature": 36.6,
            "zones": {},
            "effects": [],
        }
    }

    modifier = CombatService._health_roll_modifier(
        data,
        "skills.physical.shooting",
    )

    assert modifier == -3


def test_damage_adds_stress_once_per_round_and_pain_from_round_total(monkeypatch):
    monkeypatch.setattr(combat_module, "flag_modified", lambda *args, **kwargs: None)
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: 1)
    character = SimpleNamespace(data={
        "health": {
            "current": 700,
            "max": 700,
            "painLevel": 0,
            "stress": 0,
            "zones": {"chest": {"current": 150, "max": 150}},
            "effects": [],
        }
    })
    target = SimpleNamespace(character=character, hp_zones={})
    profile = {"bleeding": ""}

    CombatService._apply_attack_damage(
        target, 25, "chest", profile, round_number=3
    )
    CombatService._apply_attack_damage(
        target, 25, "chest", profile, round_number=3
    )

    health = character.data["health"]
    assert health["stress"] == 1
    assert health["painLevel"] == 1

    CombatService._apply_attack_damage(
        target, 25, "chest", profile, round_number=4
    )

    assert health["stress"] == 2
    assert health["painLevel"] == 1


def test_disabling_arm_adds_zone_pain_only_once(monkeypatch):
    monkeypatch.setattr(combat_module, "flag_modified", lambda *args, **kwargs: None)
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: 1)
    character = SimpleNamespace(data={
        "health": {
            "current": 700,
            "max": 700,
            "painLevel": 0,
            "stress": 0,
            "zones": {"leftArm": {"current": 10, "max": 90}},
            "effects": [],
        }
    })
    target = SimpleNamespace(character=character, hp_zones={})

    CombatService._apply_attack_damage(
        target, 10, "left_arm", {"bleeding": ""}, round_number=1
    )
    CombatService._apply_attack_damage(
        target, 10, "left_arm", {"bleeding": ""}, round_number=1
    )

    assert character.data["health"]["painLevel"] == 4


@pytest.mark.parametrize("zone", ["head", "chest"])
def test_hitting_disabled_vital_zone_kills_character(monkeypatch, zone):
    monkeypatch.setattr(combat_module, "flag_modified", lambda *args, **kwargs: None)
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: 1)
    zone_max = 50 if zone == "head" else 150
    character = SimpleNamespace(data={
        "health": {
            "current": 500,
            "max": 700,
            "zones": {zone: {"current": 0, "max": zone_max}},
            "effects": [],
        }
    })
    target = SimpleNamespace(
        character=character,
        hp_zones={},
        posture="standing",
        cover_object_id=None,
        weapon_braced=False,
        braced_weapon_index=None,
    )

    health = CombatService._apply_attack_damage(
        target, 0, zone, {"bleeding": ""}, round_number=1
    )

    death = next(effect for effect in health["effects"] if effect["type"] == "death")
    assert death["source"] == "hit_disabled_vital_zone"
    assert death["area"] == zone
    assert health["_attackOutcome"]["death"] is True
    assert target.posture == "prone"


@pytest.mark.parametrize("zone", ["head", "chest"])
def test_disabling_vital_zone_makes_character_critical_and_prone(monkeypatch, zone):
    monkeypatch.setattr(combat_module, "flag_modified", lambda *args, **kwargs: None)
    monkeypatch.setattr(combat_module.random, "randint", lambda start, end: 1)
    zone_max = 50 if zone == "head" else 150
    character = SimpleNamespace(data={
        "health": {
            "current": 500,
            "max": 700,
            "zones": {zone: {"current": 1, "max": zone_max}},
            "effects": [],
        }
    })
    target = SimpleNamespace(
        character=character,
        hp_zones={},
        posture="standing",
        cover_object_id=42,
        weapon_braced=True,
        braced_weapon_index=0,
    )

    health = CombatService._apply_attack_damage(
        target, 1, zone, {"bleeding": ""}, round_number=1
    )

    assert CombatService._character_condition(character.data)["state"] == "critical"
    assert not any(effect["type"] == "death" for effect in health["effects"])
    assert target.posture == "prone"
    assert target.cover_object_id is None
    assert target.weapon_braced is False


def test_disabled_chest_is_critical_and_cannot_recover_from_shock():
    condition = CombatService._character_condition({
        "health": {
            "current": 500,
            "zones": {"chest": {"current": 0, "max": 150}},
            "effects": [{"type": "shock", "active": True}],
        }
    })

    assert condition["state"] == "critical"
    assert condition["can_recover"] is False


def test_disabled_head_is_critical_but_not_dead_without_brain_or_skull_damage():
    condition = CombatService._character_condition({
        "health": {
            "current": 500,
            "zones": {"head": {"current": 0, "max": 50}},
            "organs": {
                "brain": {"current": 1, "max": 1},
                "skull": {"current": 1, "max": 1},
            },
            "effects": [],
        }
    })

    assert condition["state"] == "critical"
    assert condition["can_recover"] is False


def test_destroyed_lung_gets_own_health_bleeding_and_pain():
    health = {"effects": [], "painLevel": 0}

    result = CombatService._apply_organ_damage(
        health, "rightLung", 50, "chest"
    )

    assert result["disabled"] is True
    assert health["organs"]["rightLung"]["current"] == 0
    assert health["painLevel"] == 5
    assert any(
        effect["type"] == "bleeding_internal_severe"
        and effect["area"] == "chest"
        for effect in health["effects"]
    )


def test_destroyed_heart_starts_one_minute_death_timer():
    health = {"effects": [], "painLevel": 0}

    result = CombatService._apply_organ_damage(health, "heart", 20, "chest")

    failure = next(
        effect for effect in health["effects"]
        if effect["type"] == "organ_failure"
    )
    assert result["death_in_seconds"] == 60
    assert failure["remaining_seconds"] == 60
    assert failure["death_on_expire"] is True


@pytest.mark.parametrize(
    ("durability", "chance", "die", "bonus"),
    [
        (100, 0, 0, 0),
        (90, 1, 4, 0),
        (75, 2, 6, 0),
        (60, 4, 8, 0),
        (45, 7, 10, 0),
        (30, 10, 12, 0),
        (10, 15, 12, 2),
        (0, 20, 12, 6),
    ],
)
def test_weapon_jam_thresholds_follow_equipment_rules(
    durability, chance, die, bonus
):
    assert CombatService._weapon_jam_profile(durability) == (chance, die, bonus)


def test_weapon_jam_is_saved_and_applies_its_durability_loss(monkeypatch):
    rolls = iter([1, 4])
    monkeypatch.setattr(combat_module.random, "randint", lambda *_: next(rolls))
    weapon = {"durability": 90, "maxDurability": 100}

    result = CombatService._roll_weapon_jam(weapon)

    assert result["triggered"] is True
    assert result["result"] == 4
    assert weapon["jam"]["accuracy_penalty"] == 2
    assert weapon["durability"] == 87


def test_weapon_wear_is_once_per_combat_plus_each_duplet():
    weapon = {
        "durability": 100,
        "maxDurability": 100,
        "subcategory": "Пистолеты",
    }

    first = CombatService._weapon_use_wear(weapon, fire_mode="unaimed")
    second = CombatService._weapon_use_wear(weapon, fire_mode="unaimed")
    duplet = CombatService._weapon_use_wear(
        weapon, fire_mode="unaimed", shot_count=2
    )

    assert first["loss"] == 2
    assert second["loss"] == 0
    assert duplet["loss"] == 2
    assert weapon["durability"] == 96


def test_nonstandard_ammunition_doubles_weapon_wear_again():
    weapon = {"durability": 100, "maxDurability": 100}

    wear = CombatService._weapon_use_wear(
        weapon,
        fire_mode="burst",
        volley_count=1,
        ammo_profile={"ammo_variant": "bp"},
    )

    assert wear["loss"] == 4
    assert weapon["durability"] == 96


def test_weapon_ammo_is_consumed_from_next_stack_on_server():
    weapon = {
        "installedMagazine": {
            "ammo": [
                {"name": "9x19", "quantity": 2},
                {"name": "9x19 БП", "quantity": 3},
            ]
        }
    }

    CombatService._consume_weapon_ammo(weapon, 4)

    assert weapon["installedMagazine"]["ammo"] == [
        {"name": "9x19", "quantity": 1}
    ]
    assert weapon["ammo"] == 1


def test_repair_clears_catastrophic_jam_only_at_required_durability():
    weapon = {
        "durability": 99,
        "maxDurability": 100,
        "jam": {"result": 12, "repair_required": "full"},
    }
    CombatService._weapon_durability(weapon)
    assert "jam" in weapon

    weapon["durability"] = 100
    CombatService._weapon_durability(weapon)
    assert "jam" not in weapon


def test_barrel_rupture_clears_after_at_least_one_point_is_repaired():
    weapon = {
        "durability": 20,
        "maxDurability": 100,
        "jam": {
            "result": 11,
            "repair_required": "increase",
            "durability_after": 20,
        },
    }
    CombatService._weapon_durability(weapon)
    assert "jam" in weapon

    weapon["durability"] = 21
    CombatService._weapon_durability(weapon)
    assert "jam" not in weapon


def test_narrative_skill_check_uses_conditions_and_disadvantage(monkeypatch):
    rolls = iter([18, 4])
    monkeypatch.setattr(combat_module.random, "randint", lambda *_: next(rolls))
    character_data = {
        "skills": {"physical": {"shooting": {"base": 10, "bonus": 0}}},
        "health": {"painLevel": 2, "exhaustion": 0, "psyState": 30, "effects": []},
    }

    check = CombatService._narrative_skill_check(
        character_data, "skills.physical.shooting"
    )

    assert check["rolls"] == [18, 4]
    assert check["roll"] == 4
    assert check["disadvantage"] is True
    assert check["status_modifier"] == -2
    assert check["total"] == 2


def test_narrative_social_check_adds_charisma_modifier(monkeypatch):
    monkeypatch.setattr(combat_module.random, "randint", lambda *_: 10)
    character_data = {
        "skills": {
            "social": {
                "persuasion": {"base": 12, "bonus": 0},
                "charisma": {"base": 14, "bonus": 0},
            }
        },
        "health": {"effects": []},
    }

    check = CombatService._narrative_skill_check(
        character_data, "skills.social.persuasion"
    )

    assert check["skill_modifier"] == 1
    assert check["related_modifier"] == 2
    assert check["total"] == 13
