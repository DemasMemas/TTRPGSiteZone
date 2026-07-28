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

    assert profile["value"] == 50
    assert profile["weapon_index"] == 2
    assert profile["shooting_value"] == 15
    assert profile["tactics_value"] == 10
    assert profile["posture_bonus"] == 10
    assert profile["module_modifier"] == 5
    assert profile["magazine_modifier"] == -5
    assert profile["helmet_penalty"] == 5
    assert profile["draw_action_points"] == 2
    assert profile["reload_action_points_modifier"] == 1
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
