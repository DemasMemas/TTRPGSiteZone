from app.extensions import db
from app.models import LobbyCharacter


def _create_lobby(client, user, auth_headers):
    response = client.post(
        "/lobbies/",
        headers=auth_headers(user),
        json={
            "name": "Realtime sync",
            "map_type": "empty",
            "chunks_width": 2,
            "chunks_height": 2,
        },
    )
    assert response.status_code == 201
    return response.get_json()


def _create_character(client, lobby, user, auth_headers, data):
    response = client.post(
        f"/lobbies/{lobby['id']}/characters",
        headers=auth_headers(user),
        json={"name": "Shooter", "data": data},
    )
    assert response.status_code == 201
    return response.get_json()


def test_magazine_install_http_fallback_is_broadcast_to_character_viewers(
    client,
    create_user,
    auth_headers,
    monkeypatch,
):
    owner = create_user("magazine-owner")
    observer = create_user("magazine-observer")
    lobby = _create_lobby(client, owner, auth_headers)
    joined = client.post(
        f"/lobbies/{lobby['id']}/join",
        headers=auth_headers(observer),
    )
    assert joined.status_code == 200

    magazine = {
        "id": "mag-1",
        "templateId": 101,
        "name": "Magazine 9x19",
        "category": "magazine",
        "ammo": [],
        "attributes": {"caliber": "9x19", "capacity": 15},
    }
    character = _create_character(
        client,
        lobby,
        owner,
        auth_headers,
        {
            "inventory": {"pockets": [], "backpack": [magazine]},
            "weapons": [{"name": "Pistol", "installedMagazine": None}],
        },
    )
    updated_data = {
        "inventory": {"pockets": [], "backpack": []},
        "weapons": [{"name": "Pistol", "installedMagazine": magazine}],
    }

    events = []

    def capture_emit(event, payload, **kwargs):
        events.append((event, payload, kwargs))

    monkeypatch.setattr("app.lobbies.socketio.emit", capture_emit)
    response = client.put(
        f"/lobbies/characters/{character['id']}",
        headers=auth_headers(owner),
        json={"data": updated_data},
    )

    assert response.status_code == 200
    updates = [event for event in events if event[0] == "character_data_updated"]
    assert len(updates) == 1
    _, payload, options = updates[0]
    assert options["room"] == f"character_{character['id']}"
    received_data = payload["updates"]["data"]
    assert received_data["inventory"]["backpack"] == []
    assert received_data["weapons"][0]["installedMagazine"]["id"] == "mag-1"

    stored = db.session.get(LobbyCharacter, character["id"])
    assert stored.data["inventory"]["backpack"] == []
    assert stored.data["weapons"][0]["installedMagazine"]["id"] == "mag-1"
