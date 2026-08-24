from app.extensions import db
from app.models import (
    Lobby,
    LobbyCharacter,
    Location,
    LocationCharacter,
    LocationCombatState,
    User,
)
from app.services.combat import CombatService


def health_data():
    return {
        "current": 700,
        "max": 700,
        "effects": [],
        "zones": {
            "head": {"current": 50, "max": 50},
            "chest": {"current": 150, "max": 150},
            "abdomen": {"current": 120, "max": 120},
            "leftArm": {"current": 90, "max": 90},
            "rightArm": {"current": 90, "max": 90},
            "leftLeg": {"current": 100, "max": 100},
            "rightLeg": {"current": 100, "max": 100},
        },
    }


def create_gunpoint_combat():
    user = User(username="gunpoint", email="gunpoint@example.com", password_hash="x")
    db.session.add(user)
    db.session.flush()
    lobby = Lobby(name="Gunpoint", gm_id=user.id, invite_code="GUNPOINT")
    db.session.add(lobby)
    db.session.flush()
    location = Location(
        lobby_id=lobby.id,
        name="Room",
        grid_width=10,
        grid_height=10,
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.flush()
    attacker = LobbyCharacter(
        lobby_id=lobby.id,
        owner_id=user.id,
        name="Attacker",
        data={
            "skills": {
                "physical": {
                    "agility": {"base": 10, "bonus": 0},
                    "melee": {"base": 10, "bonus": 0},
                    "shooting": {"base": 10, "bonus": 0},
                },
            },
            "health": health_data(),
            "weapons": [{
                "name": "Test pistol",
                "category": "weapon",
                "durability": 90,
                "maxDurability": 100,
                "installedMagazine": {
                    "ammo": [{
                        "name": "9x19",
                        "category": "ammo",
                        "quantity": 2,
                        "damage": 10,
                        "armor_piercing": 10,
                        "attributes": {
                            "damage": 10,
                            "armor_piercing": 10,
                            "caliber": "9x19",
                        },
                    }],
                },
            }],
        },
    )
    target = LobbyCharacter(
        lobby_id=lobby.id,
        owner_id=user.id,
        name="Target",
        data={"health": health_data()},
    )
    db.session.add_all([attacker, target])
    db.session.flush()
    placed_attacker = LocationCharacter(
        location_id=location.id,
        character_id=attacker.id,
        controlled_by=user.id,
        pos_x=2,
        pos_y=2,
        drawn_weapon_index=0,
        action_points_current=5,
        action_points_max=5,
    )
    placed_target = LocationCharacter(
        location_id=location.id,
        character_id=target.id,
        controlled_by=user.id,
        pos_x=3,
        pos_y=3,
        action_points_current=5,
        action_points_max=5,
    )
    db.session.add_all([placed_attacker, placed_target])
    db.session.flush()
    state = LocationCombatState(
        location_id=location.id,
        status="active",
        round_number=1,
        turn_index=0,
        turn_order=[placed_attacker.id, placed_target.id],
        current_location_character_id=placed_attacker.id,
    )
    db.session.add(state)
    db.session.commit()
    return user, location, attacker, target, placed_attacker, placed_target, state


def test_gunpoint_placement_and_reaction_shot_are_server_authoritative(app, monkeypatch):
    user, location, attacker, _, placed_attacker, placed_target, state = create_gunpoint_combat()
    rolls = iter([20])
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: next(rolls, 1))

    placement = CombatService.perform_action(
        location.id,
        user.id,
        placed_attacker.id,
        "place_gunpoint",
        target_character_id=placed_target.character_id,
        target_zone="chest",
    )

    assert placement["gunpoint"]["success"] is True
    assert placement["gunpoint"]["difficulty"] == 12
    assert placed_attacker.action_points_current == 3
    assert attacker.data["health"]["combatMeta"]["gunpoint"]["target_zone"] == "chest"

    state.current_location_character_id = placed_target.id
    state.turn_index = 1
    db.session.commit()
    shot = CombatService.perform_action(
        location.id,
        user.id,
        placed_attacker.id,
        "gunpoint_shot",
    )

    hit = shot["attack"]["results"][0]
    assert hit["roll"] == 1
    assert hit["automatic_hit"] is True
    assert hit["hit"] is True
    assert hit["zone"] == "chest"
    assert placed_attacker.action_points_current == 2
    assert attacker.data["weapons"][0]["installedMagazine"]["ammo"][0]["quantity"] == 1
    assert "gunpoint" not in attacker.data["health"]["combatMeta"]
    assert shot["attack"]["weapon_jam"]["triggered"] is True


def test_gunpoint_head_costs_three_action_points(app, monkeypatch):
    user, location, _, _, placed_attacker, placed_target, _ = create_gunpoint_combat()
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: 20)

    result = CombatService.perform_action(
        location.id,
        user.id,
        placed_attacker.id,
        "place_gunpoint",
        target_character_id=placed_target.character_id,
        target_zone="head",
    )

    assert result["gunpoint"]["difficulty"] == 15
    assert result["gunpoint"]["action_points"] == 3
    assert placed_attacker.action_points_current == 2


def test_zhuzha_u_reduces_gunpoint_difficulty_by_five():
    assert CombatService._gunpoint_weapon_difficulty_modifier(
        {"name": "Револьвер Жужа-У", "subcategory": "Пистолеты"}
    ) == -5


def test_every_pistol_reduces_gunpoint_difficulty_by_five():
    assert CombatService._gunpoint_weapon_difficulty_modifier(
        {"name": "Любой пистолет", "subcategory": "Пистолеты"}
    ) == -5
    assert CombatService._gunpoint_weapon_difficulty_modifier(
        {"name": "ПП", "subcategory": "Пистолеты-пулеметы"}
    ) == 0
