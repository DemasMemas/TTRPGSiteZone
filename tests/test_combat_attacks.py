from types import SimpleNamespace

import app.services.combat as combat_module
from app.services.combat import CombatService


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


def test_damage_pain_uses_round_total_and_large_single_hit_thresholds():
    assert CombatService._damage_pain_requirement(49, 49) == 0
    assert CombatService._damage_pain_requirement(50, 50) == 1
    assert CombatService._damage_pain_requirement(149, 100) == 1
    assert CombatService._damage_pain_requirement(150, 100) == 2
    assert CombatService._damage_pain_requirement(151, 151) == 2
    assert CombatService._damage_pain_requirement(201, 201) == 3


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
