import pytest

from app.extensions import db
from app.lobbies import _world_group_speed
from app.models import (
    ChatMessage,
    Lobby,
    LobbyCharacter,
    LobbyParticipant,
    LocationCombatState,
    Location,
    LocationCharacter,
    WorldGroup,
    WorldMapEvent,
    WorldTravelEvent,
)
from app.models.templates import ItemTemplate


def create_lobby(client, user, auth_headers, name="Rookie camp"):
    response = client.post(
        "/lobbies/",
        headers=auth_headers(user),
        json={
            "name": name,
            "map_type": "empty",
            "chunks_width": 4,
            "chunks_height": 3,
        },
    )
    assert response.status_code == 201
    return response.get_json()


def join_lobby(client, lobby, user, auth_headers):
    response = client.post(
        f"/lobbies/{lobby['id']}/join",
        headers=auth_headers(user),
    )
    assert response.status_code == 200


def create_character(client, lobby, user, auth_headers, data=None):
    response = client.post(
        f"/lobbies/{lobby['id']}/characters",
        headers=auth_headers(user),
        json={"name": "Test character", "data": data or {}},
    )
    assert response.status_code == 201
    return response.get_json()


def test_gm_can_assign_location_teams_and_players_cannot_edit_them(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("teams-gm")
    player = create_user("teams-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    character = create_character(client, lobby, player, auth_headers)
    location = Location(lobby_id=lobby["id"], name="Team test", world_tile_x=0, world_tile_z=0)
    db.session.add(location)
    db.session.flush()
    location_character = LocationCharacter(
        location_id=location.id,
        character_id=character["id"],
        controlled_by=player["id"],
    )
    db.session.add(location_character)
    db.session.commit()

    url = f"/lobbies/{lobby['id']}/locations/{location.id}/teams"
    denied = client.put(
        url,
        headers=auth_headers(player),
        json={"assignments": [{"location_character_id": location_character.id, "team_name": "North", "team_color": "#457b9d"}]},
    )
    assert denied.status_code == 403

    updated = client.put(
        url,
        headers=auth_headers(gm),
        json={"assignments": [{"location_character_id": location_character.id, "team_name": "North", "team_color": "#457b9d"}]},
    )
    assert updated.status_code == 200
    assert updated.get_json()["characters"][0]["team_name"] == "North"
    assert updated.get_json()["characters"][0]["team_color"] == "#457b9d"

    invalid_color = client.put(
        url,
        headers=auth_headers(gm),
        json={"assignments": [{"location_character_id": location_character.id, "team_name": "North", "team_color": "red; background:black"}]},
    )
    assert invalid_color.status_code == 200
    assert invalid_color.get_json()["characters"][0]["team_color"] is None


@pytest.mark.parametrize(
    ("penalty", "distance", "label"),
    [
        (0, 3, "Без изменений"),
        (3, 3, "Без изменений"),
        (4, 2, "На треть медленнее"),
        (5, 2, "На треть медленнее"),
        (6, 2, "На треть медленнее"),
        (7, 1, "Вдвое медленнее"),
        (8, 1, "Втрое медленнее"),
        (9, 1, "Втрое медленнее"),
        (10, 0, "Группа не может идти"),
    ],
)
def test_world_group_speed_thresholds(penalty, distance, label):
    assert _world_group_speed(penalty) == (distance, label)


def test_lobby_creation_assigns_gm_and_membership(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("game-master")

    lobby = create_lobby(client, gm, auth_headers)

    assert lobby["gm_id"] == gm["id"]
    assert lobby["chunks_width"] == 4
    assert lobby["chunks_height"] == 3
    assert len(lobby["invite_code"]) == 6
    participant = db.session.get(
        LobbyParticipant,
        {"lobby_id": lobby["id"], "user_id": gm["id"]},
    )
    assert participant is not None


def test_lobby_creation_requires_authentication(client):
    response = client.post(
        "/lobbies/",
        json={"name": "No auth", "map_type": "empty"},
    )

    assert response.status_code == 401


def test_player_joins_by_code_and_can_open_lobby(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("join-gm")
    player = create_user("join-player")
    lobby = create_lobby(client, gm, auth_headers)

    joined = client.post(
        "/lobbies/join_by_code",
        headers=auth_headers(player),
        json={"code": lobby["invite_code"]},
    )
    details = client.get(
        f"/lobbies/{lobby['id']}",
        headers=auth_headers(player),
    )

    assert joined.status_code == 200
    assert joined.get_json()["lobby_id"] == lobby["id"]
    assert details.status_code == 200
    assert details.get_json()["name"] == "Rookie camp"


def test_joining_twice_is_idempotent(client, create_user, auth_headers):
    gm = create_user("idempotent-gm")
    player = create_user("idempotent-player")
    lobby = create_lobby(client, gm, auth_headers)
    endpoint = f"/lobbies/{lobby['id']}/join"

    first = client.post(endpoint, headers=auth_headers(player))
    second = client.post(endpoint, headers=auth_headers(player))

    assert first.status_code == 200
    assert second.status_code == 200


def test_lobby_detail_restores_participant_color(client, create_user, auth_headers):
    gm = create_user("color-gm")
    lobby = create_lobby(client, gm, auth_headers)

    changed = client.patch(
        "/auth/color",
        json={"color": "#4a7b52"},
        headers=auth_headers(gm),
    )
    detail = client.get(f"/lobbies/{lobby['id']}", headers=auth_headers(gm))

    assert changed.status_code == 200
    assert detail.status_code == 200
    participant = detail.get_json()["participants"][0]
    assert participant["color"] == "#4a7b52"


def test_only_gm_can_update_persisted_lobby_time(
    client, create_user, auth_headers
):
    gm = create_user("time-gm")
    player = create_user("time-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    endpoint = f"/lobbies/{lobby['id']}/time"

    forbidden = client.patch(
        endpoint,
        json={"game_day": 3, "game_time_minutes": 19 * 60 + 25},
        headers=auth_headers(player),
    )
    updated = client.patch(
        endpoint,
        json={"game_day": 3, "game_time_minutes": 19 * 60 + 25},
        headers=auth_headers(gm),
    )
    detail = client.get(f"/lobbies/{lobby['id']}", headers=auth_headers(player))

    assert forbidden.status_code == 403
    assert updated.status_code == 200
    assert detail.get_json()["game_day"] == 3
    assert detail.get_json()["game_time_minutes"] == 19 * 60 + 25
    count = LobbyParticipant.query.filter_by(
        lobby_id=lobby["id"],
        user_id=player["id"],
    ).count()
    assert count == 1


def test_world_group_creation_is_gm_only_and_validates_map_bounds(
    client, create_user, auth_headers
):
    gm = create_user("world-group-gm")
    player = create_user("world-group-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    endpoint = f"/lobbies/{lobby['id']}/world-groups"

    forbidden = client.post(
        endpoint,
        headers=auth_headers(player),
        json={"name": "Player party", "tile_x": 2, "tile_y": 3},
    )
    outside = client.post(
        endpoint,
        headers=auth_headers(gm),
        json={"name": "Outside", "tile_x": 128, "tile_y": 0},
    )
    created = client.post(
        endpoint,
        headers=auth_headers(gm),
        json={"name": "Rookies", "tile_x": 2, "tile_y": 3},
    )

    assert forbidden.status_code == 403
    assert outside.status_code == 400
    assert created.status_code == 201
    assert created.get_json()["name"] == "Rookies"
    assert WorldGroup.query.filter_by(lobby_id=lobby["id"]).count() == 1


def test_world_movement_takes_ten_minutes_and_respects_group_distance(
    client, create_user, auth_headers, monkeypatch
):
    gm = create_user("world-move-gm")
    player = create_user("world-move-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    created = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Road party", "tile_x": 10, "tile_y": 10},
    ).get_json()
    endpoint = f"/lobbies/{lobby['id']}/world-groups/{created['id']}/move"
    monkeypatch.setattr("app.lobbies.random.random", lambda: 1.0)

    too_far = client.post(
        endpoint,
        headers=auth_headers(player),
        json={"tile_x": 14, "tile_y": 10},
    )
    moved = client.post(
        endpoint,
        headers=auth_headers(player),
        json={"tile_x": 13, "tile_y": 13},
    )

    assert too_far.status_code == 400
    assert moved.status_code == 200
    assert moved.get_json()["event_pending"] is False
    assert moved.get_json()["time"] == {"game_day": 1, "game_time_minutes": 490}
    group = db.session.get(WorldGroup, created["id"])
    assert (group.tile_x, group.tile_y) == (13, 13)


def test_parallel_world_groups_advance_time_only_after_every_active_group_acts(
    client, create_user, auth_headers, monkeypatch
):
    gm = create_user("parallel-world-gm")
    player = create_user("parallel-world-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    first = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "First", "tile_x": 2, "tile_y": 2},
    ).get_json()
    second = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Second", "tile_x": 8, "tile_y": 8},
    ).get_json()
    monkeypatch.setattr("app.lobbies.random.random", lambda: 1.0)

    first_move = client.post(
        f"/lobbies/{lobby['id']}/world-groups/{first['id']}/move",
        headers=auth_headers(player),
        json={"tile_x": 3, "tile_y": 2},
    )
    repeated = client.post(
        f"/lobbies/{lobby['id']}/world-groups/{first['id']}/move",
        headers=auth_headers(player),
        json={"tile_x": 4, "tile_y": 2},
    )
    second_wait = client.post(
        f"/lobbies/{lobby['id']}/world-groups/{second['id']}/wait",
        headers=auth_headers(player),
    )

    assert first_move.status_code == 200
    assert first_move.get_json()["time_advanced"] is False
    assert first_move.get_json()["time"] is None
    assert repeated.status_code == 409
    assert second_wait.status_code == 200
    assert second_wait.get_json()["time_advanced"] is True
    assert second_wait.get_json()["time"] == {
        "game_day": 1,
        "game_time_minutes": 490,
    }


def test_gm_can_exclude_world_group_from_required_turns(
    client, create_user, auth_headers, monkeypatch
):
    gm = create_user("inactive-world-gm")
    lobby = create_lobby(client, gm, auth_headers)
    first = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Travellers", "tile_x": 2, "tile_y": 2},
    ).get_json()
    second = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Camp", "tile_x": 8, "tile_y": 8},
    ).get_json()
    disabled = client.patch(
        f"/lobbies/{lobby['id']}/world-groups/{second['id']}/turn-active",
        headers=auth_headers(gm),
        json={"active": False},
    )
    monkeypatch.setattr("app.lobbies.random.random", lambda: 1.0)

    moved = client.post(
        f"/lobbies/{lobby['id']}/world-groups/{first['id']}/move",
        headers=auth_headers(gm),
        json={"tile_x": 3, "tile_y": 2},
    )

    assert disabled.status_code == 200
    assert disabled.get_json()["group"]["turn_active"] is False
    assert moved.status_code == 200
    assert moved.get_json()["time_advanced"] is True


def test_gm_configures_persisted_world_group_members(
    client, create_user, auth_headers
):
    gm = create_user("world-members-gm")
    player = create_user("world-members-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    gm_character = create_character(
        client,
        lobby,
        gm,
        auth_headers,
        data={"equipment": {"armor": {"movementPenalty": 5}}},
    )
    player_character = create_character(client, lobby, player, auth_headers)
    group = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Mixed party", "tile_x": 3, "tile_y": 3},
    ).get_json()
    endpoint = f"/lobbies/{lobby['id']}/world-groups/{group['id']}/members"

    forbidden = client.patch(
        endpoint,
        headers=auth_headers(player),
        json={"character_ids": [player_character["id"]]},
    )
    invalid = client.patch(
        endpoint,
        headers=auth_headers(gm),
        json={"character_ids": [999999]},
    )
    updated = client.patch(
        endpoint,
        headers=auth_headers(gm),
        json={"character_ids": [gm_character["id"], player_character["id"]]},
    )
    player_view = client.get(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(player),
    ).get_json()

    assert forbidden.status_code == 403
    assert invalid.status_code == 400
    assert updated.status_code == 200
    assert [member["id"] for member in updated.get_json()["members"]] == [
        gm_character["id"],
        player_character["id"],
    ]
    assert updated.get_json()["movement_penalty"] == 5
    assert updated.get_json()["movement_distance"] == 2
    assert updated.get_json()["movement_speed_label"] == "На треть медленнее"
    assert player_view["available_characters"] == []
    assert len(player_view["groups"][0]["members"]) == 2
    assert db.session.get(WorldGroup, group["id"]).member_character_ids == [
        gm_character["id"],
        player_character["id"],
    ]


def test_random_world_event_blocks_travel_until_gm_resolves_it(
    client, create_user, auth_headers, monkeypatch
):
    gm = create_user("world-event-gm")
    player = create_user("world-event-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    created = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Event party", "tile_x": 5, "tile_y": 5},
    ).get_json()
    move_endpoint = f"/lobbies/{lobby['id']}/world-groups/{created['id']}/move"
    monkeypatch.setattr("app.lobbies.random.random", lambda: 0.0)
    monkeypatch.setattr(
        "app.lobbies.random.choice",
        lambda values: "Test world encounter",
    )

    moved = client.post(
        move_endpoint,
        headers=auth_headers(player),
        json={"tile_x": 6, "tile_y": 5},
    )
    blocked = client.post(
        move_endpoint,
        headers=auth_headers(player),
        json={"tile_x": 7, "tile_y": 5},
    )
    event = WorldTravelEvent.query.filter_by(group_id=created["id"]).one()
    hidden_list = client.get(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(player),
    ).get_json()
    visible_list = client.get(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
    ).get_json()
    forbidden = client.patch(
        f"/lobbies/{lobby['id']}/world-events/{event.id}",
        headers=auth_headers(player),
        json={"decision": "approve"},
    )
    approved = client.patch(
        f"/lobbies/{lobby['id']}/world-events/{event.id}",
        headers=auth_headers(gm),
        json={"decision": "approve"},
    )

    assert moved.status_code == 200
    assert moved.get_json()["event_pending"] is True
    assert blocked.status_code == 409
    assert hidden_list["pending_events"][0]["description"] is None
    assert visible_list["pending_events"][0]["description"] == "Test world encounter"
    assert forbidden.status_code == 403
    assert approved.status_code == 200
    assert approved.get_json()["status"] == "approved"
    assert ChatMessage.query.filter_by(
        lobby_id=lobby["id"],
        username="Событие",
    ).one().message == "Event party: Test world encounter"


def test_placed_world_event_is_hidden_and_stops_group_on_route(
    client, create_user, auth_headers, monkeypatch
):
    gm = create_user("placed-event-gm")
    player = create_user("placed-event-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    group = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Route party", "tile_x": 10, "tile_y": 10},
    ).get_json()
    event_endpoint = f"/lobbies/{lobby['id']}/world-map-events"

    forbidden = client.post(
        event_endpoint,
        headers=auth_headers(player),
        json={
            "name": "Ambush",
            "description": "Bandits open fire",
            "tile_x": 12,
            "tile_y": 10,
        },
    )
    created = client.post(
        event_endpoint,
        headers=auth_headers(gm),
        json={
            "name": "Ambush",
            "description": "Bandits open fire",
            "tile_x": 12,
            "tile_y": 10,
            "repeatable": False,
        },
    )
    player_view = client.get(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(player),
    ).get_json()
    monkeypatch.setattr("app.lobbies.random.random", lambda: 1.0)
    moved = client.post(
        f"/lobbies/{lobby['id']}/world-groups/{group['id']}/move",
        headers=auth_headers(player),
        json={"tile_x": 13, "tile_y": 10},
    )

    assert forbidden.status_code == 403
    assert created.status_code == 201
    assert player_view["map_events"] == []
    assert moved.status_code == 200
    assert moved.get_json()["placed_event_triggered"] is True
    assert moved.get_json()["event_pending"] is True
    assert (moved.get_json()["group"]["tile_x"], moved.get_json()["group"]["tile_y"]) == (12, 10)
    map_event = db.session.get(WorldMapEvent, created.get_json()["id"])
    assert map_event.is_active is False
    pending = WorldTravelEvent.query.filter_by(group_id=group["id"], status="pending").one()
    assert pending.world_map_event_id == map_event.id
    assert pending.description == "Ambush: Bandits open fire"


def test_repeatable_world_event_remains_on_map_after_trigger(
    client, create_user, auth_headers, monkeypatch
):
    gm = create_user("repeat-event-gm")
    lobby = create_lobby(client, gm, auth_headers)
    group = client.post(
        f"/lobbies/{lobby['id']}/world-groups",
        headers=auth_headers(gm),
        json={"name": "Repeat party", "tile_x": 4, "tile_y": 4},
    ).get_json()
    event = client.post(
        f"/lobbies/{lobby['id']}/world-map-events",
        headers=auth_headers(gm),
        json={
            "name": "Radiation field",
            "description": "The dosimeter crackles",
            "tile_x": 5,
            "tile_y": 5,
            "repeatable": True,
        },
    ).get_json()
    monkeypatch.setattr("app.lobbies.random.random", lambda: 1.0)

    moved = client.post(
        f"/lobbies/{lobby['id']}/world-groups/{group['id']}/move",
        headers=auth_headers(gm),
        json={"tile_x": 6, "tile_y": 6},
    )

    assert moved.status_code == 200
    assert moved.get_json()["group"]["tile_x"] == 5
    assert db.session.get(WorldMapEvent, event["id"]).is_active is True


def test_gm_rest_event_advances_lobby_time_for_selected_characters(
    client, create_user, auth_headers
):
    gm = create_user("rest-event-gm")
    player = create_user("rest-event-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    sleeper = create_character(
        client,
        lobby,
        player,
        auth_headers,
        data={
            "health": {
                "current": 100,
                "max": 700,
                "zones": {},
                "effects": [],
                "exhaustion": 1,
                "intoxication": 90,
                "needs": {
                    "day": 1,
                    "mealsToday": 1,
                    "drinksToday": 3,
                    "sleptToday": False,
                },
            },
        },
    )
    observer = create_character(
        client,
        lobby,
        gm,
        auth_headers,
        data={
            "health": {
                "current": 200,
                "max": 700,
                "zones": {},
                "stress": 5,
                "effects": [{
                    "type": "delayed_adjustment",
                    "remaining": 10,
                    "remaining_seconds": 600,
                    "time_unit": "minute",
                    "tick": "time_elapsed",
                    "adjustments": [{"field": "stress", "delta": -2, "min": 0}],
                }],
                "needs": {"day": 1, "mealsToday": 0, "drinksToday": 0},
            },
        },
    )
    inactive_npc = create_character(
        client,
        lobby,
        gm,
        auth_headers,
        data={
            "health": {
                "current": 300,
                "max": 700,
                "zones": {},
                "stress": 5,
                "effects": [{
                    "type": "delayed_adjustment",
                    "remaining": 10,
                    "remaining_seconds": 600,
                    "time_unit": "minute",
                    "tick": "time_elapsed",
                    "adjustments": [{"field": "stress", "delta": -2, "min": 0}],
                }],
                "needs": {"day": 1, "mealsToday": 0, "drinksToday": 0},
            },
        },
    )
    endpoint = f"/lobbies/{lobby['id']}/rest"

    activity = client.patch(
        f"/lobbies/{lobby['id']}/characters/time-active",
        headers=auth_headers(gm),
        json={"character_ids": [sleeper["id"], observer["id"]]},
    )

    forbidden = client.post(
        endpoint,
        headers=auth_headers(player),
        json={"type": "sleep", "character_ids": [sleeper["id"]]},
    )
    completed = client.post(
        endpoint,
        headers=auth_headers(gm),
        json={"type": "sleep", "character_ids": [sleeper["id"]]},
    )

    assert activity.status_code == 200
    assert forbidden.status_code == 403
    assert completed.status_code == 200
    assert completed.get_json()["game_day"] == 1
    assert completed.get_json()["game_time_minutes"] == 16 * 60

    sleeper_health = db.session.get(LobbyCharacter, sleeper["id"]).data["health"]
    observer_health = db.session.get(LobbyCharacter, observer["id"]).data["health"]
    inactive_health = db.session.get(LobbyCharacter, inactive_npc["id"]).data["health"]
    assert sleeper_health["current"] == 450
    assert sleeper_health["intoxication"] == 15
    assert sleeper_health["exhaustion"] == 1.5
    assert sleeper_health["needs"]["day"] == 2
    assert sleeper_health["needs"]["lastDay"]["missed"] == ["еда"]
    assert observer_health["current"] == 200
    assert observer_health["needs"]["day"] == 1
    assert observer_health["stress"] == 3
    assert observer_health["effects"] == []
    assert inactive_health["stress"] == 5
    assert inactive_health["effects"][0]["remaining_seconds"] == 600
    assert db.session.get(LobbyCharacter, inactive_npc["id"]).time_active is False


def test_banned_user_is_kept_only_in_banned_list(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("ban-list-gm")
    player = create_user("ban-list-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)

    response = client.post(
        f"/lobbies/{lobby['id']}/ban/{player['id']}",
        headers=auth_headers(gm),
    )
    details = client.get(
        f"/lobbies/{lobby['id']}",
        headers=auth_headers(gm),
    )
    participants = client.get(
        f"/lobbies/{lobby['id']}/participants_characters",
        headers=auth_headers(gm),
    )
    banned = client.get(
        f"/lobbies/{lobby['id']}/banned",
        headers=auth_headers(gm),
    )

    assert response.status_code == 200
    assert [item["user_id"] for item in details.get_json()["participants"]] == [gm["id"]]
    assert [item["user_id"] for item in participants.get_json()] == [gm["id"]]
    assert banned.get_json() == [{
        "user_id": player["id"],
        "username": player["username"],
    }]
    stored = db.session.get(
        LobbyParticipant,
        {"lobby_id": lobby["id"], "user_id": player["id"]},
    )
    assert stored.is_banned is True


def test_non_participant_cannot_open_private_lobby(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("private-gm")
    outsider = create_user("outsider")
    lobby = create_lobby(client, gm, auth_headers)

    response = client.get(
        f"/lobbies/{lobby['id']}",
        headers=auth_headers(outsider),
    )

    assert response.status_code == 403


def test_only_gm_can_delete_lobby(client, create_user, auth_headers):
    gm = create_user("delete-gm")
    player = create_user("delete-player")
    lobby = create_lobby(client, gm, auth_headers)
    client.post(
        f"/lobbies/{lobby['id']}/join",
        headers=auth_headers(player),
    )

    forbidden = client.delete(
        f"/lobbies/{lobby['id']}",
        headers=auth_headers(player),
    )
    deleted = client.delete(
        f"/lobbies/{lobby['id']}",
        headers=auth_headers(gm),
    )

    assert forbidden.status_code == 403
    assert deleted.status_code == 200
    db.session.expire_all()
    assert db.session.get(Lobby, lobby["id"]).is_active is False


def test_my_lobbies_validates_pagination(client, create_user, auth_headers):
    gm = create_user("pagination-gm")

    bad_limit = client.get("/lobbies/my?limit=0", headers=auth_headers(gm))
    bad_offset = client.get("/lobbies/my?offset=-1", headers=auth_headers(gm))

    assert bad_limit.status_code == 400
    assert bad_offset.status_code == 400


def test_lobby_schema_rejects_invalid_map_dimensions(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("validation-gm")

    response = client.post(
        "/lobbies/",
        headers=auth_headers(gm),
        json={
            "name": "Broken map",
            "map_type": "empty",
            "chunks_width": 0,
            "chunks_height": 3,
        },
    )

    assert response.status_code == 400


def test_gm_can_delete_character_owned_by_player(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("character-delete-gm")
    player = create_user("character-delete-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    character = create_character(client, lobby, player, auth_headers)
    location = Location(
        lobby_id=lobby["id"],
        name="Delete test",
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.flush()
    db.session.add(LocationCharacter(
        location_id=location.id,
        character_id=character["id"],
    ))
    db.session.commit()

    response = client.delete(
        f"/lobbies/characters/{character['id']}",
        headers=auth_headers(gm),
    )

    assert response.status_code == 200
    assert db.session.get(LobbyCharacter, character["id"]) is None
    assert LocationCharacter.query.filter_by(character_id=character["id"]).count() == 0


def test_only_gm_can_remove_character_model_from_location(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("despawn-gm")
    player = create_user("despawn-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    character = create_character(client, lobby, player, auth_headers)
    location = Location(
        lobby_id=lobby["id"],
        name="Despawn test",
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.flush()
    db.session.add(LocationCharacter(
        location_id=location.id,
        character_id=character["id"],
    ))
    db.session.commit()
    endpoint = (
        f"/lobbies/{lobby['id']}/locations/{location.id}"
        f"/characters/{character['id']}"
    )

    forbidden = client.delete(endpoint, headers=auth_headers(player))
    removed = client.delete(endpoint, headers=auth_headers(gm))

    assert forbidden.status_code == 403
    assert removed.status_code == 200
    assert db.session.get(LobbyCharacter, character["id"]) is not None
    assert LocationCharacter.query.filter_by(
        location_id=location.id,
        character_id=character["id"],
    ).count() == 0


def test_location_join_lookup_does_not_spawn_selected_character(
    client,
    create_user,
    auth_headers,
):
    from app.sockets.location import _find_existing_location_character

    gm = create_user("location-join-gm")
    lobby = create_lobby(client, gm, auth_headers)
    character = create_character(client, lobby, gm, auth_headers)
    location = Location(
        lobby_id=lobby["id"],
        name="Empty location",
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.commit()

    result = _find_existing_location_character(location.id, character["id"])

    assert result is None
    assert LocationCharacter.query.filter_by(
        location_id=location.id,
        character_id=character["id"],
    ).count() == 0


def test_controller_can_change_posture_outside_combat_for_free(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("posture-gm")
    player = create_user("posture-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, player, auth_headers)
    character = create_character(client, lobby, player, auth_headers)
    location = Location(
        lobby_id=lobby["id"],
        name="Posture test",
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.flush()
    location_character = LocationCharacter(
        location_id=location.id,
        character_id=character["id"],
        controlled_by=player["id"],
        posture="standing",
    )
    db.session.add(location_character)
    db.session.commit()

    response = client.patch(
        (
            f"/lobbies/{lobby['id']}/locations/{location.id}"
            f"/characters/{character['id']}/posture"
        ),
        headers=auth_headers(player),
        json={"posture": "prone"},
    )

    assert response.status_code == 200
    db.session.refresh(location_character)
    assert location_character.posture == "prone"
    assert location_character.action_points_current == 5
    assert location_character.movement_points_current == 0


def test_combat_start_rolls_tactics_initiative_only_for_selected_characters(
    client,
    create_user,
    auth_headers,
    monkeypatch,
):
    gm = create_user("initiative-gm")
    lobby = create_lobby(client, gm, auth_headers)
    first = create_character(
        client,
        lobby,
        gm,
        auth_headers,
        data={
            "skills": {
                "other": {
                    "tactics": {
                        "base": 16,
                        "bonus": 2,
                    }
                }
            }
        },
    )
    second = create_character(
        client,
        lobby,
        gm,
        auth_headers,
    )
    location = Location(
        lobby_id=lobby["id"],
        name="Initiative test",
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.flush()
    selected = LocationCharacter(
        location_id=location.id,
        character_id=first["id"],
    )
    excluded = LocationCharacter(
        location_id=location.id,
        character_id=second["id"],
    )
    db.session.add_all([selected, excluded])
    db.session.commit()
    monkeypatch.setattr("app.services.combat.random.randint", lambda start, end: 10)

    response = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/start",
        headers=auth_headers(gm),
        json={"location_character_ids": [selected.id]},
    )

    assert response.status_code == 200
    state = response.get_json()
    assert state["turn_order"] == [selected.id]
    selected_state = next(
        item for item in state["characters"]
        if item["location_character_id"] == selected.id
    )
    excluded_state = next(
        item for item in state["characters"]
        if item["location_character_id"] == excluded.id
    )
    assert selected_state["initiative_roll"] == 10
    assert selected_state["initiative_bonus"] == 4
    assert selected_state["initiative_total"] == 14
    assert excluded_state["initiative_roll"] is None
    chat_message = ChatMessage.query.filter_by(
        lobby_id=lobby["id"],
        username="Бой",
    ).one()
    assert "Инициатива:" in chat_message.message
    assert "Test character: d20 10 +4 = 14" in chat_message.message
    assert excluded_state["initiative_total"] is None


def test_only_gm_can_change_character_visibility(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("visibility-gm")
    owner = create_user("visibility-owner")
    viewer = create_user("visibility-viewer")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, owner, auth_headers)
    join_lobby(client, lobby, viewer, auth_headers)
    character = create_character(client, lobby, owner, auth_headers)
    endpoint = f"/lobbies/characters/{character['id']}/visibility"

    owner_response = client.put(
        endpoint,
        headers=auth_headers(owner),
        json={"visible_to": [viewer["id"]]},
    )
    gm_response = client.put(
        endpoint,
        headers=auth_headers(gm),
        json={"visible_to": [viewer["id"]]},
    )

    assert owner_response.status_code == 403
    assert gm_response.status_code == 200
    assert db.session.get(LobbyCharacter, character["id"]).visible_to == [viewer["id"]]


def test_edit_permission_implies_visibility_and_allows_sheet_update(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("edit-rights-gm")
    owner = create_user("edit-rights-owner")
    editor = create_user("edit-rights-editor")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, owner, auth_headers)
    join_lobby(client, lobby, editor, auth_headers)
    character = create_character(client, lobby, owner, auth_headers)

    access = client.put(
        f"/lobbies/characters/{character['id']}/visibility",
        headers=auth_headers(gm),
        json={"visible_to": [], "editable_to": [editor["id"]]},
    )
    opened = client.get(
        f"/lobbies/characters/{character['id']}",
        headers=auth_headers(editor),
    )
    updated = client.put(
        f"/lobbies/characters/{character['id']}",
        headers=auth_headers(editor),
        json={"data": {"notes": "Shared edit"}},
    )

    stored = db.session.get(LobbyCharacter, character["id"])
    assert access.status_code == 200
    assert opened.status_code == 200
    assert opened.get_json()["can_edit"] is True
    assert updated.status_code == 200
    assert stored.visible_to == [editor["id"]]
    assert stored.editable_to == [editor["id"]]
    assert stored.data["notes"] == "Shared edit"


def test_only_gm_or_controller_can_end_combat_turn(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("combat-end-gm")
    controller = create_user("combat-end-controller")
    spectator = create_user("combat-end-spectator")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, controller, auth_headers)
    join_lobby(client, lobby, spectator, auth_headers)
    controller_character = create_character(client, lobby, controller, auth_headers)
    spectator_character = create_character(client, lobby, spectator, auth_headers)
    location = Location(
        lobby_id=lobby["id"],
        name="Combat arena",
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.flush()
    controller_loc_char = LocationCharacter(
        location_id=location.id,
        character_id=controller_character["id"],
        controlled_by=controller["id"],
    )
    spectator_loc_char = LocationCharacter(
        location_id=location.id,
        character_id=spectator_character["id"],
        controlled_by=spectator["id"],
    )
    db.session.add_all([controller_loc_char, spectator_loc_char])
    db.session.flush()
    db.session.add(LocationCombatState(
        location_id=location.id,
        status="active",
        round_number=1,
        turn_index=0,
        turn_order=[spectator_loc_char.id, controller_loc_char.id],
        current_location_character_id=spectator_loc_char.id,
    ))
    db.session.commit()

    forbidden = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/end_turn",
        headers=auth_headers(controller),
        json={},
    )
    allowed_for_controller = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/end_turn",
        headers=auth_headers(spectator),
        json={},
    )
    allowed_for_gm = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/end_turn",
        headers=auth_headers(gm),
        json={},
    )

    assert forbidden.status_code == 403
    assert allowed_for_controller.status_code == 200
    assert allowed_for_gm.status_code == 200


def test_reload_can_be_paid_across_combat_turns(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("reload-pending-gm")
    actor = create_user("reload-pending-actor")
    other = create_user("reload-pending-other")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, actor, auth_headers)
    join_lobby(client, lobby, other, auth_headers)
    actor_character = create_character(client, lobby, actor, auth_headers, data={
        "weapons": [{"name": "Test rifle", "ergonomics": 60}],
        "health": {"effects": []},
    })
    other_character = create_character(client, lobby, other, auth_headers)
    location = Location(
        lobby_id=lobby["id"],
        name="Reload arena",
        world_tile_x=0,
        world_tile_z=0,
    )
    magazine = ItemTemplate(
        name="Test magazine",
        category="magazine",
        attributes={"reload_time_od": 6, "ergonomics": 0},
    )
    db.session.add_all([location, magazine])
    db.session.flush()
    actor_loc_char = LocationCharacter(
        location_id=location.id,
        character_id=actor_character["id"],
        controlled_by=actor["id"],
        action_points_current=2,
        action_points_max=5,
    )
    other_loc_char = LocationCharacter(
        location_id=location.id,
        character_id=other_character["id"],
        controlled_by=other["id"],
        action_points_current=5,
        action_points_max=5,
    )
    db.session.add_all([actor_loc_char, other_loc_char])
    db.session.flush()
    db.session.add(LocationCombatState(
        location_id=location.id,
        status="active",
        round_number=1,
        turn_index=0,
        turn_order=[actor_loc_char.id, other_loc_char.id],
        current_location_character_id=actor_loc_char.id,
    ))
    db.session.commit()

    started = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/action",
        headers=auth_headers(actor),
        json={
            "location_character_id": actor_loc_char.id,
            "action_key": "reload_weapon",
            "weapon_index": 0,
            "magazine_template_id": magazine.id,
            "pending_action_id": "reload-test-1",
        },
    )

    assert started.status_code == 200
    assert started.get_json()["pending_action"] is True
    db.session.refresh(actor_loc_char)
    assert actor_loc_char.action_points_current == 0
    pending = actor_loc_char.character.data["health"]["combatMeta"]["pendingAction"]
    assert pending["remaining_action_points"] == 4

    next_turn = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/end_turn",
        headers=auth_headers(other),
        json={},
    )
    assert next_turn.status_code == 200
    db.session.refresh(actor_loc_char)
    assert actor_loc_char.action_points_current == 1
    assert actor_loc_char.character.data["health"]["combatMeta"][
        "completedPendingActionId"
    ] == "reload-test-1"

    completed = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/action",
        headers=auth_headers(actor),
        json={
            "location_character_id": actor_loc_char.id,
            "action_key": "reload_weapon",
            "weapon_index": 0,
            "magazine_template_id": magazine.id,
            "resume_pending_action_id": "reload-test-1",
        },
    )

    assert completed.status_code == 200
    assert completed.get_json()["reload_weapon"]["action_points"] == 6
    db.session.refresh(actor_loc_char)
    assert actor_loc_char.action_points_current == 1
    assert "completedPendingActionId" not in actor_loc_char.character.data["health"]["combatMeta"]


def test_narrative_combat_action_spends_ap_rolls_and_writes_chat(
    client, create_user, auth_headers, monkeypatch
):
    gm = create_user("narrative-action-gm")
    actor = create_user("narrative-action-player")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, actor, auth_headers)
    character = create_character(client, lobby, actor, auth_headers, data={
        "skills": {"other": {"engineering": {"base": 12, "bonus": 0}}},
        "health": {"effects": [], "painLevel": 0, "exhaustion": 0},
    })
    location = Location(
        lobby_id=lobby["id"],
        name="Narrative arena",
        world_tile_x=0,
        world_tile_z=0,
    )
    db.session.add(location)
    db.session.flush()
    actor_loc_char = LocationCharacter(
        location_id=location.id,
        character_id=character["id"],
        controlled_by=actor["id"],
        action_points_current=5,
        action_points_max=5,
    )
    db.session.add(actor_loc_char)
    db.session.flush()
    db.session.add(LocationCombatState(
        location_id=location.id,
        status="active",
        round_number=1,
        turn_index=0,
        turn_order=[actor_loc_char.id],
        current_location_character_id=actor_loc_char.id,
    ))
    db.session.commit()
    monkeypatch.setattr("app.services.combat.random.randint", lambda *_: 15)

    response = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/action",
        headers=auth_headers(actor),
        json={
            "location_character_id": actor_loc_char.id,
            "action_key": "narrative_action",
            "action_points": 2,
            "narrative_action_name": "Перенаправляю питание терминала",
            "narrative_roll_required": True,
            "narrative_skill_path": "skills.other.engineering",
        },
    )

    assert response.status_code == 200
    payload = response.get_json()["narrative_action"]
    assert payload["name"] == "Перенаправляю питание терминала"
    assert payload["check"]["roll"] == 15
    assert payload["check"]["total"] == 16
    db.session.refresh(actor_loc_char)
    assert actor_loc_char.action_points_current == 3
    message = ChatMessage.query.filter_by(
        lobby_id=lobby["id"], username="Действие"
    ).one()
    assert "Затрачено ОД: 2" in message.message
    assert "Инженерия" in message.message


def test_player_may_move_and_add_marked_player_item(
    client,
    create_user,
    auth_headers,
):
    gm = create_user("inventory-gm")
    owner = create_user("inventory-owner")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, owner, auth_headers)
    existing_item = {
        "id": "item-existing",
        "templateId": 10,
        "name": "Bandage",
        "category": "consumable",
        "quantity": 1,
    }
    character = create_character(
        client,
        lobby,
        owner,
        auth_headers,
        data={"inventory": {"pockets": [existing_item], "backpack": []}},
    )
    endpoint = f"/lobbies/characters/{character['id']}"
    moved_data = {
        "inventory": {"pockets": [], "backpack": [existing_item]},
    }

    moved = client.put(
        endpoint,
        headers=auth_headers(owner),
        json={"data": moved_data},
    )
    player_add = client.put(
        endpoint,
        headers=auth_headers(owner),
        json={
            "data": {
                "inventory": {
                    "pockets": [],
                    "backpack": [
                        existing_item,
                        {
                            "id": "item-added",
                            "templateId": 11,
                            "name": "Medkit",
                            "category": "consumable",
                            "quantity": 1,
                        },
                    ],
                },
            },
        },
    )
    db.session.expire_all()
    saved_character = db.session.get(LobbyCharacter, character["id"])
    player_item = next(
        item
        for item in saved_character.data["inventory"]["backpack"]
        if item["id"] == "item-added"
    )
    gm_add = client.put(
        endpoint,
        headers=auth_headers(gm),
        json={
            "data": {
                "inventory": {
                    "pockets": [],
                    "backpack": [
                        existing_item,
                        {
                            "id": "item-added",
                            "templateId": 11,
                            "name": "Medkit",
                            "category": "consumable",
                            "quantity": 1,
                        },
                    ],
                },
            },
        },
    )

    assert moved.status_code == 200
    assert player_add.status_code == 200
    assert player_item["createdByPlayer"] is True
    assert gm_add.status_code == 200
