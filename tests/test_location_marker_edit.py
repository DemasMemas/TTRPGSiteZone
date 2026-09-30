from app.extensions import db
from app.models import (
    CharacterInteractionRequest, Location, LocationCharacter, LocationCombatState,
    LocationObject,
)


def _create_lobby(client, user, auth_headers):
    response = client.post(
        '/lobbies/',
        headers=auth_headers(user),
        json={'name': 'Marker edits', 'map_type': 'empty', 'chunks_width': 2, 'chunks_height': 3},
    )
    assert response.status_code == 201
    return response.get_json()['id']


def test_gm_can_rename_and_move_location_marker_without_regenerating_tiles(
    client, create_user, auth_headers, monkeypatch,
):
    gm = create_user('marker-gm')
    lobby_id = _create_lobby(client, gm, auth_headers)
    location = Location(
        lobby_id=lobby_id, name='Old name', world_tile_x=1, world_tile_z=2,
        tiles_data=[[{'terrain': 'grass', 'height': 1, 'objects': []}]],
    )
    db.session.add(location)
    db.session.commit()
    events = []
    monkeypatch.setattr('app.lobbies.socketio.emit', lambda name, payload, **kwargs: events.append((name, payload)))

    response = client.put(
        f'/lobbies/{lobby_id}/locations/{location.id}',
        headers=auth_headers(gm),
        json={'name': '  New name  ', 'world_tile_x': 63, 'world_tile_z': 95},
    )

    assert response.status_code == 200
    assert response.get_json()['location'] == {
        'id': location.id, 'name': 'New name', 'world_tile_x': 63, 'world_tile_z': 95,
    }
    assert location.tiles_data == [[{'terrain': 'grass', 'height': 1, 'objects': []}]]
    assert [name for name, _ in events] == ['location_updated']
    assert events[0][1]['location']['world_tile_x'] == 63
    listing = client.get(f'/lobbies/{lobby_id}/locations', headers=auth_headers(gm))
    assert listing.get_json()[0]['name'] == 'New name'
    assert listing.get_json()[0]['world_tile_z'] == 95


def test_location_marker_edit_rejects_outside_map_and_non_gm(
    client, create_user, auth_headers,
):
    gm = create_user('marker-owner')
    player = create_user('marker-player')
    lobby_id = _create_lobby(client, gm, auth_headers)
    joined = client.post(f'/lobbies/{lobby_id}/join', headers=auth_headers(player))
    assert joined.status_code == 200
    location = Location(lobby_id=lobby_id, name='Keep me', world_tile_x=2, world_tile_z=3)
    db.session.add(location)
    db.session.commit()
    url = f'/lobbies/{lobby_id}/locations/{location.id}'

    for payload in (
        {'world_tile_x': -1}, {'world_tile_x': 64}, {'world_tile_z': 96},
        {'world_tile_x': True}, {'name': '   '}, {'name': 'a' * 101},
    ):
        response = client.put(url, headers=auth_headers(gm), json=payload)
        assert response.status_code == 400
    denied = client.put(url, headers=auth_headers(player), json={'name': 'Taken'})
    assert denied.status_code == 403
    db.session.refresh(location)
    assert (location.name, location.world_tile_x, location.world_tile_z) == ('Keep me', 2, 3)


def test_deleting_location_removes_contents_and_emits_after_commit(
    client, create_user, auth_headers, monkeypatch,
):
    gm = create_user('marker-delete-gm')
    lobby_id = _create_lobby(client, gm, auth_headers)
    created = client.post(
        f'/lobbies/{lobby_id}/characters', headers=auth_headers(gm),
        json={'name': 'Visitor', 'data': {}},
    )
    assert created.status_code == 201
    location = Location(lobby_id=lobby_id, name='Delete me', world_tile_x=1, world_tile_z=2)
    db.session.add(location)
    db.session.flush()
    placed = LocationCharacter(
        location_id=location.id, character_id=created.get_json()['id'], pos_x=0, pos_y=0,
    )
    obj = LocationObject(location_id=location.id, type='chest', tile_x=0, tile_y=0)
    db.session.add_all([placed, obj])
    db.session.flush()
    combat = LocationCombatState(
        location_id=location.id, status='active', current_location_character_id=placed.id,
    )
    interaction = CharacterInteractionRequest(
        location_id=location.id, actor_location_character_id=placed.id,
        target_location_character_id=placed.id, actor_user_id=gm['id'],
        target_user_id=gm['id'], kind='trade', status='pending',
    )
    db.session.add_all([combat, interaction])
    db.session.commit()
    location_id = location.id
    placement_id = placed.id
    object_id = obj.id
    events = []
    monkeypatch.setattr('app.lobbies.socketio.emit', lambda name, payload, **kwargs: events.append((name, payload)))

    response = client.delete(
        f'/lobbies/{lobby_id}/locations/{location_id}', headers=auth_headers(gm),
    )

    assert response.status_code == 200
    assert db.session.get(Location, location_id) is None
    assert db.session.get(LocationCharacter, placement_id) is None
    assert db.session.get(LocationObject, object_id) is None
    assert LocationCombatState.query.filter_by(location_id=location_id).count() == 0
    assert CharacterInteractionRequest.query.filter_by(location_id=location_id).count() == 0
    assert events == [('location_deleted', {'lobby_id': lobby_id, 'location_id': location_id})]
