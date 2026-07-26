import pytest

from app.models import LobbyCharacter, LocationCharacter
from app.services.combat import CombatService
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
