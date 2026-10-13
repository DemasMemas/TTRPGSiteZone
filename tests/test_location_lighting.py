import math
import pytest
from pathlib import Path
import re
from types import SimpleNamespace

from app.models import Location
from app.extensions import db
from app.models.map_chunk import MapChunk
from app.services.exceptions import ValidationError
from app.services.location_lighting import normalize_location_lighting
from app.services.combat import CombatService
from scripts.seed_visual_test_location import (
    SCENE_NAME, SCENE_HEIGHT, STRESS_SCENE_NAME, STRESS_WIDTH, STRESS_HEIGHT,
    create_visual_test_location, rebuild_visual_test_location,
    rebuild_both_visual_test_locations,
)


def test_location_lighting_rejects_invalid_sources():
    with pytest.raises(ValidationError):
        normalize_location_lighting({'mode': 'manual', 'ambient_color': 'red'}, 20, 20)
    with pytest.raises(ValidationError):
        normalize_location_lighting({'local_lights': [{}]}, 20, 20)
    with pytest.raises(ValidationError):
        normalize_location_lighting({'local_lights': [{
            'x': 21, 'z': 2, 'height': 2, 'color': '#ffffff',
            'intensity': 1, 'distance': 5,
        }]}, 20, 20)
    with pytest.raises(ValidationError):
        normalize_location_lighting({'local_lights': [{
            'x': 2, 'z': 2, 'height': 2, 'color': '#ffffff',
            'intensity': 1, 'distance': 5, 'kind': 'laser',
        }]}, 20, 20)
    spot = normalize_location_lighting({'local_lights': [{
        'x': 2, 'z': 2, 'height': 2, 'color': '#ffffff',
        'intensity': 1, 'distance': 5, 'kind': 'spot', 'azimuth': 90,
    }]}, 20, 20)['local_lights'][0]
    assert (spot['kind'], spot['azimuth']) == ('spot', 90)


def test_location_lighting_keeps_fixture_dimensions():
    light = {
        'x': 2, 'z': 2, 'height': 2, 'color': '#ffffff',
        'intensity': 1, 'distance': 5,
        'dimensions': {'width': 1.2, 'depth': 0.3, 'height': 0.5},
    }
    result = normalize_location_lighting({'local_lights': [light]}, 20, 20)
    assert result['local_lights'][0]['dimensions'] == light['dimensions']
    light['dimensions'] = {'width': 0, 'depth': 0.3, 'height': 0.5}
    with pytest.raises(ValidationError):
        normalize_location_lighting({'local_lights': [light]}, 20, 20)


def test_location_lighting_preserves_gm_hidden_flag():
    light = {'x': 2, 'z': 2, 'height': 2, 'color': '#ffffff', 'intensity': 1, 'distance': 5}
    assert normalize_location_lighting({'local_lights': [light]}, 20, 20)['local_lights'][0]['gm_hidden'] is False
    light['gm_hidden'] = True
    assert normalize_location_lighting({'local_lights': [light]}, 20, 20)['local_lights'][0]['gm_hidden'] is True
    light['gm_hidden'] = 1
    with pytest.raises(ValidationError):
        normalize_location_lighting({'local_lights': [light]}, 20, 20)


def test_location_lighting_accepts_many_sources_and_validates_dark_cells():
    lamp = {'x': 2, 'z': 2, 'height': 2, 'color': '#ffffff', 'intensity': 2, 'distance': 5}
    result = normalize_location_lighting({
        'local_lights': [lamp.copy() for _ in range(12)],
        'dark_tiles': [{'x': 1, 'z': 1}, {'x': 2, 'z': 1}],
    }, 5, 5)
    assert len(result['local_lights']) == 12
    assert result['dark_tiles'] == [{'x': 1, 'z': 1}, {'x': 2, 'z': 1}]
    for invalid in ([{'x': 5, 'z': 1}], [{'x': 1, 'z': 1}, {'x': 1, 'z': 1}], [{'x': 1.5, 'z': 1}]):
        with pytest.raises(ValidationError):
            normalize_location_lighting({'dark_tiles': invalid}, 5, 5)


def test_open_window_is_a_shooting_aperture_but_not_a_movement_door():
    wall = SimpleNamespace(type='wall', tile_x=2, tile_y=2, properties={
        'dimensions': {'width': 3, 'depth': 0.2, 'height': 2.4},
    })
    window = SimpleNamespace(type='window', tile_x=2, tile_y=2, properties={
        'elevation': 1, 'is_open': True,
        'dimensions': {'width': 1.2, 'depth': 0.14, 'height': 1},
    })
    shooter = SimpleNamespace(pos_x=2, pos_y=1)
    target = SimpleNamespace(pos_x=2, pos_y=3)
    assert CombatService._door_is_in_wall(window, wall)
    assert CombatService._line_through_door(shooter, target, window, wall, 1.5)
    assert not CombatService._line_through_door(shooter, target, window, wall, 0.5)
    assert CombatService._object_movement_profile(window)['blocked']


def test_gm_can_save_location_lighting_without_regenerating_tiles(client, create_user, auth_headers):
    gm = create_user('lighting-gm')
    player = create_user('lighting-player')
    lobby_response = client.post('/lobbies/', headers=auth_headers(gm), json={
        'name': 'Lighting test', 'map_type': 'empty', 'chunks_width': 2, 'chunks_height': 2,
    })
    lobby_id = lobby_response.get_json()['id']
    client.post(f'/lobbies/{lobby_id}/join', headers=auth_headers(player))
    tiles = [[{'terrain': 'grass', 'height': 1, 'objects': []} for _ in range(5)] for _ in range(5)]
    created = client.post(f'/lobbies/{lobby_id}/locations', headers=auth_headers(gm), json={
        'name': 'Dark room', 'world_tile_x': 10, 'world_tile_z': 10,
        'grid_width': 5, 'grid_height': 5, 'tiles_data': tiles,
    })
    assert created.status_code == 201
    location_id = created.get_json()['id']
    url = f'/lobbies/{lobby_id}/locations/{location_id}'
    lighting = {
        'mode': 'manual', 'ambient_intensity': 0.1, 'directional_intensity': 0,
        'dark_tiles': [{'x': 2, 'z': 2}],
        'local_lights': [{
            'x': 2.5, 'z': 2.5, 'height': 2, 'color': '#ffc477',
            'intensity': 3, 'distance': 6, 'kind': 'spot', 'azimuth': 45,
        }],
    }
    assert client.put(url, headers=auth_headers(player), json={'lighting': lighting}).status_code == 403
    updated = client.put(url, headers=auth_headers(gm), json={'lighting': lighting})
    assert updated.status_code == 200
    stored = db.session.get(Location, location_id)
    assert stored.tiles_data == tiles
    assert stored.lighting['mode'] == 'manual'
    assert stored.lighting['local_lights'][0]['color'] == '#ffc477'
    assert stored.lighting['local_lights'][0]['kind'] == 'spot'
    assert stored.lighting['local_lights'][0]['azimuth'] == 45
    assert stored.lighting['dark_tiles'] == [{'x': 2, 'z': 2}]
    assert client.get(url, headers=auth_headers(gm)).get_json()['lighting'] == stored.lighting
    invalid = client.put(url, headers=auth_headers(gm), json={'lighting': {'mode': 'manual', 'ambient_intensity': 9}})
    assert invalid.status_code == 400
    assert db.session.get(Location, location_id).lighting == stored.lighting


def test_visual_test_scene_is_created_only_once_in_selected_lobby(client, create_user, auth_headers):
    gm = create_user('scene-gm')
    response = client.post('/lobbies/', headers=auth_headers(gm), json={
        'name': 'Трава3', 'map_type': 'empty', 'chunks_width': 2, 'chunks_height': 2,
    })
    lobby_id = response.get_json()['id']
    if not MapChunk.query.filter_by(lobby_id=lobby_id, chunk_x=1, chunk_y=1).first():
        db.session.add(MapChunk(lobby_id=lobby_id, chunk_x=1, chunk_y=1, data=[]))
        db.session.commit()

    location, created = create_visual_test_location(lobby_id)
    assert created
    assert location.name == SCENE_NAME
    assert (location.world_tile_x, location.world_tile_z) == (32, 32)
    assert location.lighting['mode'] == 'manual'
    assert len(location.lighting['local_lights']) == 5
    assert len(location.lighting['dark_tiles']) > 100
    assert {light['kind'] for light in location.lighting['local_lights']} == {'point', 'spot'}
    assert len(location.objects) > 30
    assert len(location.tiles_data) == SCENE_HEIGHT
    assert {tile['terrain'] for row in location.tiles_data for tile in row} == {
        'grass', 'rock', 'sand', 'swamp', 'water',
    }
    assert all(location.tiles_data[z][x]['terrain'] == 'sand'
               for z in range(6, 11) for x in range(3))
    assert all(location.tiles_data[z][x]['terrain'] == 'grass'
               for z in range(11, 15) for x in range(3))
    assert location.tiles_data[20][5]['height'] >= 2.3
    assert location.tiles_data[20][8]['height'] > location.tiles_data[20][9]['height']
    assert location.tiles_data[22][23]['height'] == 2.6
    assert location.tiles_data[25][23]['height'] < 1.2
    assert sum(obj.get('type') == 'anomaly' for row in location.tiles_data for tile in row
               for obj in tile['objects']) == 48
    assert {obj.type for obj in location.objects} >= {
        'wall', 'floor', 'door', 'window', 'fence', 'table', 'chair',
        'box', 'military_crate', 'barrel', 'shelf',
    }
    catalog = (Path(__file__).resolve().parents[1] / 'app/static/js/locationAssetCatalog.js').read_text(encoding='utf-8')
    assets = re.findall(
        r"id: '([^']+)'[^\n]*kind: '(structure|decor|lamp)'[^\n]*color: '(#[0-9a-fA-F]{6})'",
        catalog,
    )
    assert {obj.type for obj in location.objects} == {
        asset_id for asset_id, kind, _ in assets if kind == 'structure'
    }
    assert {obj['type'] for row in location.tiles_data for tile in row for obj in tile['objects']} == {
        'anomaly', *(asset_id for asset_id, kind, _ in assets if kind == 'decor')
    }
    poster = location.tiles_data[3][9]['objects'][0]
    assert (poster['type'], poster['z'], poster['rotation'], poster['elevation']) == (
        'poster', 0.13, -90, 1.6,
    )
    for kind in ('wall_torch', 'wall_bulb'):
        fixture = next(obj for obj in location.objects if obj.type == kind)
        assert (fixture.tile_y, fixture.properties['rotation'], fixture.properties['offset_z']) == (
            14, math.pi, -0.2,
        )
    assert {light['color'] for light in location.lighting['local_lights']} == {
        color for _, kind, color in assets if kind == 'lamp'
    }
    walls = [obj for obj in location.objects if obj.type == 'wall']
    assert len(walls) == 12
    floors = [obj for obj in location.objects if obj.type == 'floor']
    assert {(obj.properties['dimensions']['width'], obj.properties['dimensions']['depth'])
            for obj in floors} == {(13, 11), (8, 6), (4, 4)}
    assert all(obj.properties['dimensions']['width'] >= 4 for obj in walls)
    doors = [obj for obj in location.objects if obj.type == 'door']
    assert len(doors) == 4
    for door in doors:
        door_x = door.tile_x + 0.5 + door.properties.get('offset_x', 0)
        door_z = door.tile_y + 0.5 + door.properties.get('offset_z', 0)
        assert any(
            abs((wall.tile_x + 0.5 + wall.properties.get('offset_x', 0)) - door_x) < 0.01
            if wall.properties.get('rotation') else
            abs((wall.tile_y + 0.5 + wall.properties.get('offset_z', 0)) - door_z) < 0.01
            for wall in walls
        )
    assert {(obj.tile_x, obj.tile_y) for obj in location.objects if obj.type == 'military_crate'} == {(12, 11)}
    assert all(obj.properties.get('contents') == [] for obj in location.objects
               if obj.type in {'box', 'military_crate'})
    assert (17, 20) in {(obj.tile_x, obj.tile_y) for obj in location.objects if obj.type == 'barrel'}
    main_door = next(obj for obj in doors if obj.tile_x == 9 and obj.tile_y == 14)
    main_door.properties = {**main_door.properties, 'is_open': True}
    blocked, climb = CombatService._build_movement_map(location)
    assert (9, 14) not in blocked
    assert (9, 13) not in blocked
    assert (9, 13) not in climb
    assert {obj.get('type') for row in location.tiles_data for tile in row
            for obj in tile['objects']} >= {'tree', 'rock', 'tent', 'poster'}
    assert any(obj.type == 'campfire' for obj in location.objects)
    participant_ids = {entry.character_id for entry in location.location_participants}
    assert len(participant_ids) == 5
    repeated, created = create_visual_test_location(lobby_id)
    assert not created
    assert repeated.id == location.id
    assert Location.query.filter_by(lobby_id=lobby_id, name=SCENE_NAME).count() == 1
    rebuilt, created = rebuild_visual_test_location(lobby_id)
    assert not created
    assert rebuilt.id == location.id
    assert {entry.character_id for entry in rebuilt.location_participants} == participant_ids
    assert len(rebuilt.location_participants) == 5

    stress = Location(
        lobby_id=lobby_id, name=STRESS_SCENE_NAME, type='exploration',
        grid_width=1, grid_height=1,
        tiles_data=[[{'terrain': 'grass', 'height': 1, 'objects': []}]],
        world_tile_x=33, world_tile_z=32,
    )
    db.session.add(stress)
    db.session.commit()
    standard_marker = (rebuilt.world_tile_x, rebuilt.world_tile_z)
    stress_marker = (stress.world_tile_x, stress.world_tile_z)
    standard, stress = rebuild_both_visual_test_locations(lobby_id)
    assert standard.id == location.id
    assert (standard.world_tile_x, standard.world_tile_z) == standard_marker
    assert (stress.world_tile_x, stress.world_tile_z) == stress_marker
    assert (stress.grid_width, stress.grid_height) == (STRESS_WIDTH, STRESS_HEIGHT)
    assert len(stress.tiles_data) == STRESS_HEIGHT
    assert all(len(row) == STRESS_WIDTH for row in stress.tiles_data)
    assert len(stress.objects) > len(standard.objects) + 35
    assert len(stress.location_participants) == 15
    assert len(stress.lighting['local_lights']) == 7
    assert sum(tile['terrain'] == 'grass' for row in stress.tiles_data for tile in row) > 1500
    assert MapChunk.query.filter_by(lobby_id=lobby_id, chunk_x=1, chunk_y=1).first().data == []
    stress_ids = {entry.character_id for entry in stress.location_participants}
    standard, stress = rebuild_both_visual_test_locations(lobby_id)
    assert len(stress.location_participants) == 15
    assert {entry.character_id for entry in stress.location_participants} == stress_ids
    assert len(stress.objects) > len(standard.objects) + 35


def test_resizing_location_cannot_leave_lamps_outside_grid(client, create_user, auth_headers):
    gm = create_user('lighting-resize-gm')
    lobby_id = client.post('/lobbies/', headers=auth_headers(gm), json={
        'name': 'Resize lights', 'map_type': 'empty', 'chunks_width': 1, 'chunks_height': 1,
    }).get_json()['id']
    tiles = [[{'terrain': 'grass', 'height': 1, 'objects': []} for _ in range(6)] for _ in range(6)]
    created = client.post(f'/lobbies/{lobby_id}/locations', headers=auth_headers(gm), json={
        'name': 'Room', 'world_tile_x': 2, 'world_tile_z': 2,
        'grid_width': 6, 'grid_height': 6, 'tiles_data': tiles,
        'lighting': {'local_lights': [{
            'x': 5.5, 'z': 5.5, 'height': 2, 'color': '#ffffff',
            'intensity': 2, 'distance': 6,
        }]},
    })
    assert created.status_code == 201
    location_id = created.get_json()['id']
    updated = client.put(f'/lobbies/{lobby_id}/locations/{location_id}',
                         headers=auth_headers(gm), json={'grid_width': 5, 'grid_height': 5})
    assert updated.status_code == 400
    db.session.expire_all()
    assert db.session.get(Location, location_id).grid_width == 6
