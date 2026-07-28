from app.extensions import db
from app.models import (
    Lobby,
    LobbyCharacter,
    LobbyParticipant,
    LocationCombatState,
    Location,
    LocationCharacter,
)


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
    count = LobbyParticipant.query.filter_by(
        lobby_id=lobby["id"],
        user_id=player["id"],
    ).count()
    assert count == 1


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


def test_player_may_move_existing_item_but_cannot_add_another(
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
    assert player_add.status_code == 403
    assert gm_add.status_code == 200
