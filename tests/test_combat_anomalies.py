from app.extensions import db
from app.models import Lobby, LobbyCharacter, Location, LocationCharacter, LocationCombatState, User
from app.services.anomaly_profiles import ANOMALY_PROFILES, anomaly_profile
from app.services.combat import CombatService


def _health():
    return {"current": 700, "max": 700, "effects": [], "combatMeta": {}}


def _combat_with_anomaly(key="otboynik"):
    user = User(username="anomaly", email="anomaly@example.com", password_hash="x")
    db.session.add(user)
    db.session.flush()
    lobby = Lobby(name="Anomalies", gm_id=user.id, invite_code="ANOMALY")
    db.session.add(lobby)
    db.session.flush()
    tiles = [[{"terrain": "grass", "height": 1, "objects": []} for _ in range(6)] for _ in range(6)]
    tiles[2][2]["objects"] = [{"type": "anomaly", "anomalyKey": key}]
    location = Location(
        lobby_id=lobby.id, name="Field", grid_width=6, grid_height=6,
        world_tile_x=0, world_tile_z=0, tiles_data=tiles,
    )
    db.session.add(location)
    db.session.flush()
    actor = LobbyCharacter(
        lobby_id=lobby.id, owner_id=user.id, name="Walker",
        data={
            "skills": {"physical": {
                "agility": {"base": 10, "bonus": 0},
                "will": {"base": 10, "bonus": 0},
            }},
            "health": _health(),
        },
    )
    other = LobbyCharacter(lobby_id=lobby.id, owner_id=user.id, name="Other", data={"health": _health()})
    db.session.add_all([actor, other])
    db.session.flush()
    placed = LocationCharacter(
        location_id=location.id, character_id=actor.id, controlled_by=user.id,
        pos_x=1, pos_y=2, action_points_current=5, action_points_max=5,
        movement_points_current=20, movement_points_max=20,
    )
    placed_other = LocationCharacter(
        location_id=location.id, character_id=other.id, controlled_by=user.id,
        pos_x=5, pos_y=5, action_points_current=5, action_points_max=5,
    )
    db.session.add_all([placed, placed_other])
    db.session.flush()
    state = LocationCombatState(
        location_id=location.id, status="active", round_number=1, turn_index=0,
        turn_order=[placed.id, placed_other.id], current_location_character_id=placed.id,
    )
    db.session.add(state)
    db.session.commit()
    return user, location, actor, placed, placed_other


def test_anomaly_catalog_has_all_rulebook_entries():
    assert len(ANOMALY_PROFILES) == 48
    assert anomaly_profile("batut")["name"] == "Батут"
    assert anomaly_profile("mozgotrobilka")["category"] == "psi"


def test_anomaly_is_passable_and_stops_route_on_first_anomaly(app):
    user, location, actor, placed, _ = _combat_with_anomaly()
    assert CombatService._object_movement_profile({"type": "anomaly"})["blocked"] is False

    moved, _, _ = CombatService.move_character(
        location.id, user.id, actor.id, 4, 2, movement_mode="walk",
    )

    assert (moved.pos_x, moved.pos_y) == (2, 2)
    active = actor.data["health"]["combatMeta"]["activeAnomaly"]
    assert active["key"] == "otboynik"


def test_successful_escape_costs_three_ap_and_moves_without_damage(app, monkeypatch):
    user, location, actor, placed, _ = _combat_with_anomaly()
    placed.pos_x = placed.pos_y = 2
    CombatService._enter_anomaly(placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1)
    db.session.commit()
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: 20)

    result = CombatService.perform_action(
        location.id, user.id, placed.id, "escape_anomaly", target_x=1, target_y=2,
    )

    assert result["anomaly"]["outcome"] == "success"
    assert result["anomaly"]["exits"] is True
    assert (placed.pos_x, placed.pos_y) == (1, 2)
    assert placed.action_points_current == 2
    assert actor.data["health"]["current"] == 700
    assert "activeAnomaly" not in actor.data["health"]["combatMeta"]


def test_natural_one_deals_125_percent_and_keeps_character_trapped(app, monkeypatch):
    user, location, actor, placed, _ = _combat_with_anomaly()
    placed.pos_x = placed.pos_y = 2
    CombatService._enter_anomaly(placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1)
    db.session.commit()
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: 1)

    result = CombatService.perform_action(
        location.id, user.id, placed.id, "escape_anomaly", target_x=1, target_y=2,
    )

    assert result["anomaly"]["outcome"] == "critical_failure"
    assert result["anomaly"]["exposure"]["damage"] == 250
    assert (placed.pos_x, placed.pos_y) == (2, 2)
    assert actor.data["health"]["combatMeta"]["activeAnomaly"]["rounds"] == 1


def test_psi_anomaly_uses_will_for_escape(app, monkeypatch):
    user, location, actor, placed, _ = _combat_with_anomaly("ekho")
    placed.pos_x = placed.pos_y = 2
    CombatService._enter_anomaly(placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1)
    db.session.commit()
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: 20)

    result = CombatService.perform_action(
        location.id, user.id, placed.id, "escape_anomaly", target_x=1, target_y=2,
    )

    assert result["anomaly"]["category"] == "psi"
    assert result["anomaly"]["check"]["success"] is True


def test_remaining_in_anomaly_applies_full_exposure_at_turn_end(app):
    _, location, actor, placed, _ = _combat_with_anomaly()
    placed.pos_x = placed.pos_y = 2
    CombatService._enter_anomaly(placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1)

    result = CombatService._resolve_anomaly_end_turn(placed, 1)

    assert result["fraction"] == 1.0
    assert result["damage"] == 200
    assert actor.data["health"]["current"] == 500
    assert actor.data["health"]["combatMeta"]["activeAnomaly"]["rounds"] == 1


def test_fall_anomaly_uses_existing_fall_rules(app, monkeypatch):
    _, location, actor, placed, _ = _combat_with_anomaly("batut")
    placed.pos_x = placed.pos_y = 2
    active = CombatService._enter_anomaly(
        placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1,
    )
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: 20)

    result = CombatService._apply_anomaly_exposure(placed, active, 1, round_number=1)

    assert result["fall"]["height"] == 9
    assert result["fall"]["success"] is True
    assert result["damage"] == 140
    assert actor.data["health"]["current"] == 560


def test_throwing_anomaly_ejects_character_in_entry_direction(app, monkeypatch):
    _, location, actor, placed, _ = _combat_with_anomaly("batut")
    placed.pos_x = placed.pos_y = 2
    active = CombatService._enter_anomaly(
        placed,
        CombatService._anomalies_at_tile(location, 2, 2)[0],
        1,
        previous_position=(1, 2),
    )
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: 20)

    result = CombatService._resolve_anomaly_end_turn(placed, 1)

    assert result["ejected_to"] == {"x": 3, "y": 2}
    assert (placed.pos_x, placed.pos_y) == (3, 2)
    assert "activeAnomaly" not in actor.data["health"]["combatMeta"]


def test_escalating_electric_anomaly_uses_third_round_damage(app):
    _, location, _, placed, _ = _combat_with_anomaly("katushka")
    placed.pos_x = placed.pos_y = 2
    active = CombatService._enter_anomaly(
        placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1,
    )
    active["rounds"] = 2

    result = CombatService._apply_anomaly_exposure(placed, active, 1, round_number=3)

    assert result["damage"] == 200


def test_web_and_tesla_damage_depends_on_escape_failure_margin(app):
    _, location, _, placed, _ = _combat_with_anomaly("pautina")
    placed.pos_x = placed.pos_y = 2
    active = CombatService._enter_anomaly(
        placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1,
    )

    result = CombatService._apply_anomaly_exposure(
        placed, active, 0.5, round_number=1, escape_margin=3,
    )

    assert result["hit_count"] == 3
    assert result["damage"] == 75


def test_trap_uses_second_discharge_after_first_round(app):
    _, location, _, placed, _ = _combat_with_anomaly("kapkan")
    placed.pos_x = placed.pos_y = 2
    active = CombatService._enter_anomaly(
        placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1,
    )
    active["rounds"] = 1

    result = CombatService._apply_anomaly_exposure(
        placed, active, 1, round_number=2,
    )

    assert result["damage"] == 300


def test_ionic_fog_uses_walking_damage_during_escape_attempt(app):
    _, location, _, placed, _ = _combat_with_anomaly("ionny_tuman")
    placed.pos_x = placed.pos_y = 2
    active = CombatService._enter_anomaly(
        placed, CombatService._anomalies_at_tile(location, 2, 2)[0], 1,
    )

    result = CombatService._apply_anomaly_exposure(
        placed, active, 0.5, round_number=1, escape_margin=4,
    )

    assert result["damage"] == 100
