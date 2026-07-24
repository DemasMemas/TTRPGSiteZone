from app.extensions import db
from app.models import Lobby, LobbyParticipant


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
