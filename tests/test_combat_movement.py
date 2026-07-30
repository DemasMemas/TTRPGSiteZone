import pytest
from types import SimpleNamespace

from app.models import LobbyCharacter, LocationCharacter
from app.services.combat import COVER_CLASSES, CombatService
from app.services.exceptions import ValidationError


def movement_path(distance, cost=None, climb_cost=0):
    return {
        "path": [(step, 0) for step in range(distance + 1)],
        "cost": distance if cost is None else cost,
        "climb_cost": climb_cost,
    }


@pytest.mark.parametrize(
    ("mode", "distance", "expected_cost"),
    [
        ("walk", 5, 5),
        ("correction", 3, 0),
        ("run", 5, 3),
        ("sprint", 5, 2),
    ],
)
def test_movement_mode_costs_round_total_route_up(mode, distance, expected_cost):
    result = CombatService._movement_route_cost(movement_path(distance), mode)

    assert result["distance"] == distance
    assert result["movement_points"] == expected_cost


def test_climb_cost_is_not_reduced_by_running():
    result = CombatService._movement_route_cost(
        movement_path(5, cost=10, climb_cost=5),
        "run",
    )

    assert result["movement_points"] == 8
    assert result["climb_cost"] == 5


def test_unknown_movement_mode_is_rejected():
    with pytest.raises(ValidationError, match="Unknown movement mode"):
        CombatService._movement_route_cost(movement_path(1), "teleport")


def test_grapple_group_path_keeps_companion_offset(monkeypatch):
    location = SimpleNamespace(grid_width=6, grid_height=6)
    monkeypatch.setattr(
        CombatService,
        "_build_movement_map",
        staticmethod(lambda location, moving_character_id=None, ignored_character_ids=None: (set(), {})),
    )

    result = CombatService._find_movement_path(
        location,
        1,
        1,
        3,
        1,
        moving_character_id=10,
        ignored_character_ids=[10, 11],
        companion_offset=(0, 1),
    )

    assert result["path"][0] == (1, 1)
    assert result["path"][-1] == (3, 1)


def test_grapple_group_path_rejects_blocked_companion_destination(monkeypatch):
    location = SimpleNamespace(grid_width=6, grid_height=6)
    monkeypatch.setattr(
        CombatService,
        "_build_movement_map",
        staticmethod(
            lambda location, moving_character_id=None, ignored_character_ids=None: (
                {(3, 2)},
                {},
            )
        ),
    )

    result = CombatService._find_movement_path(
        location,
        1,
        1,
        3,
        1,
        moving_character_id=10,
        ignored_character_ids=[10, 11],
        companion_offset=(0, 1),
    )

    assert result is None


def test_new_turn_resets_distance_but_keeps_run_and_sprint_exhaustion():
    character = LocationCharacter(
        initiative_bonus=0,
        action_points_max=5,
        free_actions_max=1,
        movement_points_max=0,
        movement_mode_this_turn="walk",
        movement_distance_this_turn=8,
        correction_distance_this_turn=2,
        strenuous_movement_blocked_until_round=5,
    )

    CombatService._prepare_character_for_turn(character)

    assert character.movement_mode_this_turn is None
    assert character.movement_distance_this_turn == 0
    assert character.correction_distance_this_turn == 0
    assert character.strenuous_movement_blocked_until_round == 5


def test_initiative_bonus_uses_tactics_bonus_and_explicit_modifier():
    character = LocationCharacter(initiative_bonus=99)
    character.character = LobbyCharacter(data={
        "skills": {
            "other": {
                "tactics": {
                    "base": 16,
                    "bonus": 2,
                }
            }
        },
        "initiative_bonus": 3,
    })

    profile = CombatService._combat_profile(character)

    assert profile["initiative_bonus"] == 7


def test_movement_penalty_combines_weight_armor_and_temporary_modifier():
    character_data = {
        "inventory": {
            "pockets": [{"category": "consumable", "weight": 6, "quantity": 1}],
            "backpack": [{"category": "container", "weight": 4, "quantity": 1}],
        },
        "equipment": {"armor": {"movementPenalty": 2}},
        "health": {
            "combatMeta": {
                "consumableModifiers": [
                    {"stat": "movement_points", "value": -1, "remaining": 2},
                ],
            },
        },
    }
    location_character = LocationCharacter()
    location_character.character = LobbyCharacter(data=character_data)

    assert CombatService._movement_penalty(location_character) == 3


def test_powered_exoskeleton_sets_base_penalty_and_ignores_overload():
    character_data = {
        "inventory": {
            "pockets": [{"category": "item", "weight": 100, "quantity": 1}],
        },
        "equipment": {
            "armor": {
                "name": "Экзоскелет",
                "movementPenalty": 5,
                "installedModules": [{
                    "slotType": "exoskeleton_battery",
                    "attributes": {"remaining_days": 1},
                }],
            },
        },
        "health": {
            "zones": {
                "leftLeg": {"current": 0},
                "rightLeg": {"current": 100},
            },
        },
    }
    location_character = LocationCharacter()
    location_character.character = LobbyCharacter(data=character_data)

    assert CombatService._movement_penalty(location_character) == 8


def test_exoskeleton_blocks_run_and_sprint_even_when_powered():
    data = {
        "equipment": {
            "armor": {
                "name": "Экзоскелет",
                "installedModules": [{
                    "slotType": "exoskeleton_battery",
                    "attributes": {"remaining_days": 1},
                }],
            },
        },
    }

    CombatService._validate_equipment_movement(data, "walk")
    CombatService._validate_equipment_movement(data, "correction")
    with pytest.raises(ValidationError, match="unavailable in an exoskeleton"):
        CombatService._validate_equipment_movement(data, "run")
    with pytest.raises(ValidationError, match="unavailable in an exoskeleton"):
        CombatService._validate_equipment_movement(data, "sprint")


def test_powered_exoskeleton_adds_strength_level_and_roll_bonuses():
    data = {
        "skills": {"physical": {"strength": {"base": 10, "bonus": 0}}},
        "equipment": {
            "armor": {
                "name": "Экзоскелет",
                "installedModules": [{
                    "slotType": "exoskeleton_battery",
                    "attributes": {"remaining_days": 1},
                }],
            },
        },
    }
    character = LocationCharacter()
    character.character = LobbyCharacter(data=data)

    profile = CombatService._weapon_strength_profile(
        character,
        {"minStrength": 18},
    )

    assert profile["strength"] == 18
    assert profile["accuracy_penalty"] == 0
    assert CombatService._skill_modifier(data, "skills.physical.strength") == 4
    weight_details = CombatService._inventory_weight_details(data)
    assert weight_details["effective_strength"] == 18
    assert weight_details["weight_per_penalty"] == pytest.approx(7)


@pytest.mark.parametrize(
    "skill_path",
    [
        "skills.physical.strength",
        "skills.social.charisma",
        "skills.other.tactics",
    ],
)
def test_skill_bonus_is_added_to_value_before_roll_modifier(skill_path):
    category, skill = skill_path.split(".")[1:]
    data = {
        "skills": {
            category: {
                skill: {"base": 5, "bonus": 8},
            },
        },
    }

    assert CombatService._skill_value(data, skill_path) == 13
    assert CombatService._skill_modifier(data, skill_path) == 1


def test_exoskeleton_without_charged_battery_keeps_weight_penalty():
    character_data = {
        "inventory": {
            "pockets": [{"category": "item", "weight": 5, "quantity": 1}],
        },
        "equipment": {
            "armor": {
                "name": "Экзоскелет",
                "movementPenalty": 5,
                "installedModules": [],
            },
        },
    }
    location_character = LocationCharacter()
    location_character.character = LobbyCharacter(data=character_data)

    details = CombatService._movement_penalty_breakdown(character_data)

    assert details["powered_exoskeleton"] is False
    assert details["weight"] == 1
    assert CombatService._movement_penalty(location_character) == 6


def test_helmet_movement_penalty_is_added_but_integrated_helmet_is_not():
    data = {
        "equipment": {
            "armor": {"movementPenalty": 2},
            "helmet": {"movementPenalty": 1},
        },
    }

    details = CombatService._movement_penalty_breakdown(data)

    assert details["armor"] == 2
    assert details["helmet"] == 1
    assert details["total"] == 3

    data["equipment"]["helmet"]["integratedWithArmor"] = True
    integrated = CombatService._movement_penalty_breakdown(data)

    assert integrated["helmet"] == 0
    assert integrated["total"] == 2


def test_carrying_capacity_uses_strength_bonus_without_health_roll_penalties():
    character_data = {
        "skills": {
            "physical": {
                "strength": {"base": 5, "bonus": 0},
            },
        },
        "inventory": {
            "pockets": [{"category": "item", "weight": 3.5, "quantity": 1}],
        },
        "health": {
            "painLevel": 4,
            "exhaustion": 3,
            "blood": "severe",
        },
    }

    details = CombatService._inventory_weight_details(character_data)

    assert details["strength_bonus"] == -3
    assert details["weight_per_penalty"] == pytest.approx(3.5)
    assert details["penalty"] == 1


def test_skill_bonus_is_part_of_effective_strength_for_carrying_capacity():
    data = {
        "skills": {
            "physical": {
                "strength": {"base": 10, "bonus": 6},
            },
        },
    }

    details = CombatService._inventory_weight_details(data)

    assert details["effective_strength"] == 16
    assert details["weight_per_penalty"] == pytest.approx(6.5)


@pytest.mark.parametrize(
    ("armor_name", "covered", "not_covered"),
    [
        ("Армейский бронежилет", ("chest", "abdomen"), ("left_arm", "left_leg", "head")),
        ("Кожаная куртка", ("chest", "abdomen", "left_arm"), ("left_leg", "head")),
        ("Бронекостюм", ("chest", "abdomen", "left_arm", "left_leg"), ("head",)),
        ("Костюм Химзащиты", ("chest", "abdomen", "left_arm", "left_leg", "head"), ()),
    ],
)
def test_named_armor_uses_rulebook_protection_zones(armor_name, covered, not_covered):
    item = {"name": armor_name}

    for zone in covered:
        assert CombatService._armor_covers_zone("armor", item, {}, zone)
    for zone in not_covered:
        assert not CombatService._armor_covers_zone("armor", item, {}, zone)


def test_integrated_exoskeleton_helmet_uses_separate_head_protection():
    armor = {
        "name": "Экзоскелет",
        "protection": {"physical": 0.8},
    }
    character_data = {
        "equipment": {
            "armor": armor,
            "helmet": {
                "integratedWithArmor": True,
                "protection": {"physical": 0.7},
            },
        },
    }

    head_protection, head_layers = CombatService._target_armor(character_data, "head")
    torso_protection, _ = CombatService._target_armor(character_data, "chest")

    assert head_protection == 70
    assert torso_protection == 80
    assert len(head_layers) == 1
    assert head_layers[0]["item"] is armor


def test_integrated_helmet_accuracy_penalty_is_applied_once():
    character_data = {
        "equipment": {
            "armor": {
                "name": "Комбинезон ГРОБ",
                "protection": {"physical": 0.5},
            },
            "helmet": {
                "integratedWithArmor": True,
                "accuracyPenalty": 4,
            },
        },
    }

    assert CombatService._equipment_accuracy_penalty(character_data) == 4


@pytest.mark.parametrize(
    ("posture", "effective_required", "accuracy_penalty"),
    [
        ("standing", 8, 6),
        ("sitting", 6, 2),
        ("prone", 2, 0),
    ],
)
def test_weapon_strength_requirement_accounts_for_posture(
    posture,
    effective_required,
    accuracy_penalty,
):
    character = LocationCharacter(posture=posture)
    character.character = LobbyCharacter(data={
        "skills": {
            "physical": {
                "strength": {"base": 5, "bonus": 0},
            },
        },
    })

    profile = CombatService._weapon_strength_profile(
        character,
        {"minStrength": 8},
    )

    assert profile["effective_required"] == effective_required
    assert profile["accuracy_penalty"] == accuracy_penalty


def test_bipod_removes_strength_requirement_while_prone():
    character = LocationCharacter(posture="prone")
    character.character = LobbyCharacter(data={
        "skills": {
            "physical": {
                "strength": {"base": 1, "bonus": 0},
            },
        },
    })
    weapon = {
        "minStrength": 15,
        "installedModules": [{
            "name": "Сошки",
            "slotType": "handguard",
            "attributes": {"bipod": True},
        }],
    }

    profile = CombatService._weapon_strength_profile(character, weapon)

    assert profile["ignored_by_bipod"] is True
    assert profile["effective_required"] == 0
    assert profile["accuracy_penalty"] == 0


def test_legacy_root_movement_penalty_is_not_applied():
    location_character = LocationCharacter()
    location_character.character = LobbyCharacter(data={"movementPenalty": 9})

    assert CombatService._movement_penalty(location_character) == 0


def test_ammo_stack_weight_matches_inventory_rules():
    light_stack = {"category": "ammo", "quantity": 10, "volume": 0.02, "weight": 99}
    heavy_stack = {"category": "ammo", "quantity": 50, "volume": 0.02, "weight": 99}

    assert CombatService._item_total_weight(light_stack) == 0.1
    assert CombatService._item_total_weight(heavy_stack) == 0.25


@pytest.mark.parametrize(
    ("strength", "weight"),
    [
        (12, 5.5),
        (20, 7.5),
        (1, 2.5),
    ],
)
def test_strength_bonus_changes_weight_per_movement_penalty(strength, weight):
    character_data = {
        "skills": {
            "physical": {
                "strength": {"base": strength, "bonus": 0},
            },
        },
        "inventory": {
            "pockets": [{"category": "item", "weight": weight, "quantity": 1}],
        },
    }

    assert CombatService._inventory_movement_penalty(character_data) == 1


def test_equipped_backpack_reduces_weight_penalty():
    character_data = {
        "skills": {
            "physical": {
                "strength": {"base": 10, "bonus": 0},
            },
        },
        "inventory": {
            "backpack": [{"category": "item", "weight": 12, "quantity": 1}],
        },
        "equipment": {
            "backpack": {
                "category": "backpack",
                "attributes": {"limit": 40, "weight_reduction": 1},
            },
        },
    }

    assert CombatService._inventory_movement_penalty(character_data) == 1


@pytest.mark.parametrize(
    ("posture", "expected_cost"),
    [
        ("standing", 3),
        ("sitting", 6),
        ("prone", 9),
    ],
)
def test_posture_changes_walking_cost(posture, expected_cost):
    result = CombatService._movement_route_cost(
        movement_path(3),
        "walk",
        posture,
    )

    assert result["movement_points"] == expected_cost


def test_correction_movement_remains_free_while_sitting():
    result = CombatService._movement_route_cost(
        movement_path(3),
        "correction",
        "sitting",
    )

    assert result["movement_points"] == 0


@pytest.mark.parametrize(
    ("source", "target", "agility", "expected_cost"),
    [
        ("standing", "sitting", 14, 3),
        ("sitting", "standing", 14, 3),
        ("standing", "prone", 14, 6),
        ("prone", "standing", 14, 6),
    ],
)
def test_agility_reduces_posture_change_movement_cost(source, target, agility, expected_cost):
    location_character = LocationCharacter(posture=source)
    location_character.character = LobbyCharacter(data={
        "skills": {
            "physical": {
                "agility": {"base": agility, "bonus": 0},
            },
        },
    })

    options = CombatService._posture_change_options(location_character, target)

    assert options == [{"resource": "movement", "cost": expected_cost}]


def test_sitting_and_prone_transition_can_use_movement_or_action_points():
    location_character = LocationCharacter(posture="sitting")
    location_character.character = LobbyCharacter(data={})

    options = CombatService._posture_change_options(location_character, "prone")

    assert options == [
        {"resource": "movement", "cost": 4},
        {"resource": "action", "cost": 1},
    ]


def test_current_posture_cannot_be_selected_again():
    location_character = LocationCharacter(posture="standing")
    location_character.character = LobbyCharacter(data={})

    with pytest.raises(ValidationError, match="already"):
        CombatService._posture_change_options(location_character, "standing")


@pytest.mark.parametrize(
    ("posture", "movement_mode"),
    [
        ("sitting", "run"),
        ("sitting", "sprint"),
        ("prone", "run"),
        ("prone", "sprint"),
        ("prone", "correction"),
    ],
)
def test_posture_blocks_incompatible_movement_modes(posture, movement_mode):
    with pytest.raises(ValidationError):
        CombatService._validate_posture_movement(posture, movement_mode)


@pytest.mark.parametrize(
    ("posture", "movement_mode"),
    [
        ("standing", "walk"),
        ("standing", "run"),
        ("standing", "sprint"),
        ("standing", "correction"),
        ("sitting", "walk"),
        ("sitting", "correction"),
        ("prone", "walk"),
    ],
)
def test_posture_allows_compatible_movement_modes(posture, movement_mode):
    profile = CombatService._validate_posture_movement(posture, movement_mode)

    assert profile


@pytest.mark.parametrize(
    ("cover_class", "max_hp", "protection"),
    [
        ("conditional", 25, 0),
        ("flimsy", 50, 5),
        ("medium", 100, 20),
        ("strong", 200, 40),
        ("very_strong", 400, 60),
        ("titanium", 800, 90),
    ],
)
def test_cover_class_profiles(cover_class, max_hp, protection):
    cover = SimpleNamespace(properties={"cover_class": cover_class})

    profile = CombatService._cover_profile(cover)

    assert COVER_CLASSES[cover_class]["max_hp"] == max_hp
    assert profile["hp"] == max_hp
    assert profile["physical_protection"] == protection


def test_damaged_cover_loses_physical_protection_proportionally():
    cover = SimpleNamespace(properties={
        "cover_class": "strong",
        "cover_max_hp": 200,
        "cover_hp": 50,
    })

    profile = CombatService._cover_profile(cover)

    assert profile["physical_protection"] == 10


def test_object_between_shooter_and_target_intersects_fire_line():
    shooter = SimpleNamespace(pos_x=0, pos_y=0)
    target = SimpleNamespace(pos_x=4, pos_y=0)
    cover = SimpleNamespace(
        tile_x=2,
        tile_y=0,
        type="wall",
        properties={"dimensions": {"width": 1, "depth": 1}},
    )

    assert CombatService._line_object_entry(shooter, target, cover) == pytest.approx(0.375)


def test_object_outside_fire_line_does_not_intersect():
    shooter = SimpleNamespace(pos_x=0, pos_y=0)
    target = SimpleNamespace(pos_x=4, pos_y=0)
    cover = SimpleNamespace(
        tile_x=2,
        tile_y=2,
        type="wall",
        properties={"dimensions": {"width": 1, "depth": 1}},
    )

    assert CombatService._line_object_entry(shooter, target, cover) is None


@pytest.mark.parametrize(
    ("ergonomics", "draw", "reload_modifier", "aimed_cost", "accuracy"),
    [
        (0, 4, 2, 6, -2),
        (10, 4, 2, 6, -2),
        (11, 3, 2, 6, -1),
        (20, 3, 2, 6, -1),
        (21, 3, 1, 5, -1),
        (30, 3, 1, 5, -1),
        (31, 3, 1, 5, 0),
        (40, 3, 1, 5, 0),
        (41, 2, 1, 4, 0),
        (50, 2, 1, 4, 0),
        (51, 2, 0, 4, 0),
        (70, 2, 0, 4, 0),
        (71, 1, 0, 3, 0),
        (80, 1, 0, 3, 0),
        (81, 1, 0, 3, 1),
        (90, 1, 0, 3, 1),
        (91, 1, -1, 3, 1),
        (99, 1, -1, 3, 1),
        (100, 0, -2, 2, 2),
        (140, 0, -2, 2, 2),
    ],
)
def test_ergonomics_thresholds(ergonomics, draw, reload_modifier, aimed_cost, accuracy):
    profile = CombatService._ergonomics_effects(ergonomics)

    assert profile["draw_action_points"] == draw
    assert profile["reload_action_points_modifier"] == reload_modifier
    assert profile["aimed_shot_action_points"] == aimed_cost
    assert profile["accuracy_modifier"] == accuracy


def test_weapon_ergonomics_combines_all_available_sources():
    location_character = LocationCharacter(posture="sitting")
    location_character.character = LobbyCharacter(data={
        "skills": {
            "physical": {"shooting": {"base": 15, "bonus": 4}},
            "other": {"tactics": {"base": 10, "bonus": 3}},
        },
        "equipment": {
            "helmet": {"ergonomicsPenalty": 5},
        },
    })
    weapon = {
        "ergonomics": 20,
        "installedModules": [
            {"modifiers": {"ergonomics": "+5"}},
        ],
        "installedMagazine": {
            "ergonomics": -5,
        },
    }

    profile = CombatService._weapon_ergonomics_profile(location_character, weapon, 2)

    assert profile["value"] == 57
    assert profile["weapon_index"] == 2
    assert profile["shooting_value"] == 19
    assert profile["tactics_value"] == 13
    assert profile["posture_bonus"] == 10
    assert profile["module_modifier"] == 5
    assert profile["magazine_modifier"] == -5
    assert profile["helmet_penalty"] == 5
    assert profile["draw_action_points"] == 2
    assert profile["reload_action_points_modifier"] == 0
    assert profile["aimed_shot_action_points"] == 4


def test_active_weapon_is_read_from_persistent_character_data():
    location_character = LocationCharacter(drawn_weapon_index=None)
    location_character.character = LobbyCharacter(
        data={
            "weapons": [{"name": "first"}, {"name": "second"}],
            "activeWeaponIndex": 1,
        }
    )

    assert CombatService._persistent_weapon_index(location_character) == 1


def test_setting_active_weapon_updates_location_and_character_data():
    location_character = LocationCharacter(drawn_weapon_index=None)
    location_character.character = LobbyCharacter(
        data={"weapons": [{"name": "first"}, {"name": "second"}]}
    )

    CombatService._set_active_weapon(location_character, 1)

    assert location_character.drawn_weapon_index == 1
    assert location_character.character.data["activeWeaponIndex"] == 1


def test_invalid_persistent_weapon_index_is_ignored():
    location_character = LocationCharacter(drawn_weapon_index=None)
    location_character.character = LobbyCharacter(
        data={"weapons": [{"name": "only"}], "activeWeaponIndex": 4}
    )

    assert CombatService._persistent_weapon_index(location_character) is None


def test_aim_bonus_applies_only_to_same_target_and_weapon():
    location_character = LocationCharacter(
        aimed_target_character_id=12,
        aimed_weapon_index=1,
        aim_accuracy_bonus=4,
    )

    assert CombatService._aim_bonus_for_target(location_character, 12, 1) == 4
    assert CombatService._aim_bonus_for_target(location_character, 13, 1) == 0
    assert CombatService._aim_bonus_for_target(location_character, 12, 0) == 0


def test_clear_aim_resets_target_weapon_and_bonus():
    location_character = LocationCharacter(
        aimed_target_character_id=12,
        aimed_weapon_index=1,
        aim_accuracy_bonus=4,
    )

    CombatService._clear_aim(location_character)

    assert location_character.aimed_target_character_id is None
    assert location_character.aimed_weapon_index is None
    assert location_character.aim_accuracy_bonus == 0
