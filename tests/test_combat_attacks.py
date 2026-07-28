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
