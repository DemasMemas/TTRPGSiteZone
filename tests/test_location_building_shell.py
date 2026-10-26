"""Exercise actual JS-generated objects through the existing Python movement rules."""
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.models import LocationCharacter, LocationObject
from app.services.combat import CombatService
from app.services.location_navigation import find_path, surface
from app.extensions import db, socketio


def shell(shape='rectangle', condition='intact', storeys=2, basements=1, roof_type=None):
    script = """const fs=require('fs');
const roof='data:text/javascript;base64,'+fs.readFileSync('app/static/js/locationRoofSections.js').toString('base64');
const source=fs.readFileSync('app/static/js/locationHouseGenerator.js','utf8').replace("'./locationRoofSections.js'",JSON.stringify(roof));
import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
.then(m=>console.log(JSON.stringify(m.planBuildingShell(JSON.parse(process.argv[1])).objects)));
"""
    result = subprocess.run(['node', '-e', script, json.dumps(dict(minX=2, minZ=2, width=10,
        depth=10, storeys=storeys, basements=basements, shape=shape, condition=condition, seed='shell', buildingId='shell',roofType=roof_type))],
        cwd=Path(__file__).resolve().parents[1], check=True, capture_output=True, text=True, encoding='utf-8')
    return json.loads(result.stdout)


@pytest.mark.parametrize('shape', ['rectangle', 'L', 'U', 'C', 'compound'])
@pytest.mark.parametrize('condition', ['intact', 'ruins'])
def test_generated_entrance_basement_and_upper_connections(app, shape, condition):
    objects = [SimpleNamespace(id=i+1, **o) for i, o in enumerate(shell(shape, condition))]
    location = SimpleNamespace(id=1, grid_width=16, grid_height=16,
        tiles_data=[[{'height':1} for _ in range(16)] for _ in range(16)])
    with patch.object(LocationObject, 'query') as oq, patch.object(LocationCharacter, 'query') as cq:
        oq.filter_by.return_value.all.return_value = objects
        cq.filter_by.return_value.all.return_value = []
        maps = {level:CombatService._build_movement_map(location, floor_level=level) for level in [-1,0,1]}
        route = lambda a,b:find_path(location, objects, a, b, lambda level: maps[level])
        # Entry from outside, then a physical ladder into the basement, both directions.
        assert route((3,1,0), (3,3,0))
        assert route((3,3,0), (4,4,-1))
        assert route((4,4,-1), (3,3,0))
        assert bool(route((3,3,0), (3,3,1))) == (condition != 'ruins')
        if condition == 'ruins':
            for o in objects:
                if o.type == 'floor_opening' and o.properties['dimensions']['width'] == 2 and o.properties['level'] == 1:
                    assert surface(location, objects, o.tile_x, o.tile_y, 1) is None


def test_generated_four_storeys_and_two_basements_keep_separate_landings(app):
    objects = [SimpleNamespace(id=i+1, **o) for i,o in enumerate(shell('U', storeys=4, basements=2))]
    location = SimpleNamespace(id=1, grid_width=16, grid_height=16,
        tiles_data=[[{'height':1} for _ in range(16)] for _ in range(16)])
    with patch.object(LocationObject, 'query') as oq, patch.object(LocationCharacter, 'query') as cq:
        oq.filter_by.return_value.all.return_value = objects
        cq.filter_by.return_value.all.return_value = []
        maps = {level:CombatService._build_movement_map(location, floor_level=level) for level in range(-2,4)}
        for start, end in [((3,3,-2),(3,3,3)), ((3,3,3),(3,3,-2))]:
            route = find_path(location,objects,start,end,lambda level:maps[level])
            assert route
            assert {p['level'] for p in route['surfaces']} == set(range(-2,4))


@pytest.mark.parametrize('kind',['flat','shed','gable'])
def test_volume_roofs_do_not_introduce_phantom_floor_obstacles(app,kind):
    objects = [SimpleNamespace(id=i+1, **o) for i,o in enumerate(shell('T', roof_type=kind))]
    location=SimpleNamespace(id=1,grid_width=16,grid_height=16,tiles_data=[[{'height':1} for _ in range(16)] for _ in range(16)])
    with patch.object(LocationObject,'query') as oq,patch.object(LocationCharacter,'query') as cq:
        oq.filter_by.return_value.all.return_value=objects
        cq.filter_by.return_value.all.return_value=[]
        maps={level:CombatService._build_movement_map(location,floor_level=level) for level in [-1,0,1]}
        assert find_path(location,objects,(3,3,0),(4,4,-1),lambda level:maps[level])
        assert find_path(location,objects,(3,3,0),(3,3,1),lambda level:maps[level])
        for o in objects:
            if o.type=='roof':assert CombatService._object_movement_profile(o)=={'blocked':False,'climb_cost':0}


def test_generated_objects_keep_rest_socket_permissions_and_round_trip(client, app, create_user, auth_headers):
    gm, player = create_user('shell-gm'), create_user('shell-player')
    headers = auth_headers(gm)
    lobby = client.post('/lobbies/', headers=headers, json=dict(name='shell', map_type='empty',
        chunks_width=1, chunks_height=1)).get_json()
    api = f"/lobbies/{lobby['id']}"
    assert client.post(api+'/join', headers=auth_headers(player)).status_code == 200
    location = client.post(api+'/locations', headers=headers, json=dict(name='shell', world_tile_x=1,
        world_tile_z=1, grid_width=16, grid_height=16)).get_json()
    url = f"{api}/locations/{location['id']}"
    from app.sockets.location import handle_join_location
    socketio.on_event('join_location', handle_join_location)
    clients = [socketio.test_client(app), socketio.test_client(app)]
    try:
        for connection, user in zip(clients, [gm, player]):
            connection.emit('join_location', dict(token=user['token'], location_id=location['id']))
            assert any(e['name']=='joined_location' for e in connection.get_received())
        specs = shell('L', 'damaged',roof_type='gable')
        assert client.post(url+'/objects', headers=auth_headers(player), json=specs[0]).status_code == 403
        saved = []
        for spec in specs:
            response = client.post(url+'/objects', headers=headers, json=spec)
            assert response.status_code == 201
            saved.append(response.get_json())
        for connection in clients:
            created = [e['args'][0]['object'] for e in connection.get_received() if e['name']=='location_object_created']
            assert [o['id'] for o in created] == [o['id'] for o in saved]
        target = saved[0]
        assert client.delete(f"{api}/locations/objects/{target['id']}", headers=auth_headers(player)).status_code == 403
        assert client.patch(f"{api}/locations/objects/{target['id']}", headers=headers,
            json={'properties':{'dimensions':{'width':1.7,'depth':2,'height':.12},'color':'#887766'}}).status_code == 200
        db.session.remove()
        reloaded = client.get(url, headers=headers).get_json()['objects']
        assert len(reloaded) == len(specs)
        changed = next(o for o in reloaded if o['id']==target['id'])
        assert changed['properties']['dimensions']['width'] == 1.7
        assert changed['properties']['building_generation'] == specs[0]['properties']['building_generation']
        assert len(set(o['id'] for o in reloaded)) == len(specs)
        assert [o['properties'].get('roof_geometry') for o in reloaded if o['type']=='roof'] == [o['properties']['roof_geometry'] for o in saved if o['type']=='roof']
        for connection in clients:
            updates = [e for e in connection.get_received() if e['name']=='location_object_updated']
            assert len(updates) == 1
    finally:
        for connection in clients:
            connection.disconnect()
