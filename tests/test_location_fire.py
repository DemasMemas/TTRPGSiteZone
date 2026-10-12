from app.extensions import db
from app.models import LobbyCharacter, LocationCharacter, LocationObject


def test_fire_toggle_requires_owned_nearby_actor_or_gm(client, create_user, auth_headers):
    gm = create_user('fire-gm')
    player = create_user('fire-player')
    other = create_user('fire-other')
    lobby = client.post('/lobbies/', headers=auth_headers(gm), json={
        'name': 'Fire test', 'map_type': 'empty', 'chunks_width': 2, 'chunks_height': 2,
    }).get_json()
    lobby_id = lobby['id']
    client.post(f'/lobbies/{lobby_id}/join', headers=auth_headers(player))
    client.post(f'/lobbies/{lobby_id}/join', headers=auth_headers(other))
    tiles = [[{'terrain': 'grass', 'height': 1, 'objects': []} for _ in range(6)] for _ in range(6)]
    location = client.post(f'/lobbies/{lobby_id}/locations', headers=auth_headers(gm), json={
        'name': 'Fire location', 'world_tile_x': 1, 'world_tile_z': 1,
        'grid_width': 6, 'grid_height': 6, 'tiles_data': tiles,
    }).get_json()
    character = LobbyCharacter(lobby_id=lobby_id, owner_id=player['id'], name='Fire keeper', data={})
    db.session.add(character)
    db.session.flush()
    actor = LocationCharacter(location_id=location['id'], character_id=character.id, pos_x=2, pos_y=2)
    db.session.add(actor)
    db.session.commit()
    object_url = f'/lobbies/{lobby_id}/locations/{location["id"]}/objects'
    fire = client.post(object_url, headers=auth_headers(gm), json={
        'name': 'Костёр', 'type': 'campfire', 'tile_x': 2, 'tile_y': 3,
        'properties': {'is_lit': False, 'color': '#74604b'},
    }).get_json()
    patch_url = f'/lobbies/{lobby_id}/locations/objects/{fire["id"]}'
    payload = {'actor_character_id': character.id, 'properties': {'is_lit': True}}
    assert client.patch(patch_url, headers=auth_headers(other), json=payload).status_code == 403
    assert client.patch(patch_url, headers=auth_headers(player), json={
        **payload, 'properties': {'is_lit': True, 'color': '#ffffff'},
    }).status_code == 403
    response = client.patch(patch_url, headers=auth_headers(player), json=payload)
    assert response.status_code == 200
    assert response.get_json()['properties']['is_lit'] is True
    assert response.get_json()['properties']['color'] == '#74604b'

    client.patch(patch_url, headers=auth_headers(gm), json={'properties': {'gm_hidden': True}})
    assert client.patch(patch_url, headers=auth_headers(player), json={
        **payload, 'properties': {'is_lit': False},
    }).status_code == 403
    client.patch(patch_url, headers=auth_headers(gm), json={'properties': {'gm_hidden': False}})

    actor.pos_x = 5
    actor.pos_y = 5
    db.session.commit()
    assert client.patch(patch_url, headers=auth_headers(player), json={
        **payload, 'properties': {'is_lit': False},
    }).status_code == 400
    assert db.session.get(LocationObject, fire['id']).properties['is_lit'] is True
    assert client.patch(patch_url, headers=auth_headers(gm), json={
        'properties': {'is_lit': False},
    }).status_code == 200

    actor.pos_x = 2
    actor.pos_y = 2
    db.session.commit()
    wall_torch = client.post(object_url, headers=auth_headers(gm), json={
        'name': 'Настенный факел', 'type': 'wall_torch', 'tile_x': 2, 'tile_y': 3,
        'properties': {'is_lit': True, 'elevation': 1.25},
    }).get_json()
    wall_torch_url = f'/lobbies/{lobby_id}/locations/objects/{wall_torch["id"]}'
    assert client.patch(wall_torch_url, headers=auth_headers(player), json={
        'actor_character_id': character.id, 'properties': {'is_lit': False},
    }).status_code == 200

    for kind in ('ceiling_bulb', 'wall_bulb'):
        bulb = client.post(object_url, headers=auth_headers(gm), json={
            'name': kind, 'type': kind, 'tile_x': 2, 'tile_y': 3,
            'properties': {'is_on': True},
        }).get_json()
        bulb_url = f'/lobbies/{lobby_id}/locations/objects/{bulb["id"]}'
        assert client.patch(bulb_url, headers=auth_headers(player), json={
            'properties': {'is_on': False},
        }).status_code == 403
        assert client.patch(bulb_url, headers=auth_headers(player), json={
            'properties': {'light_color': '#000000'},
        }).status_code == 403
        assert db.session.get(LocationObject, bulb['id']).properties['is_on'] is True
        assert client.patch(bulb_url, headers=auth_headers(gm), json={
            'properties': {'is_on': False},
        }).status_code == 200
