"""Interior plans must work with the actual server collision and level routes."""
import json
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.extensions import db, socketio
from app.models import LocationObject, LocationCharacter
from app.services.combat import CombatService
from app.services.location_navigation import find_path


def interior(shape, condition, wealth='ordinary', seed='test'):
    script = """
const fs=require('fs'),url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const read=n=>fs.readFileSync('app/static/js/'+n,'utf8');
(async()=>{
const H=await import(url(read('locationHouseGenerator.js').replace("'./locationRoofSections.js'",JSON.stringify(url(read('locationRoofSections.js'))))));
const I=await import(url(read('locationInteriorGenerator.js').replace("'./locationArchitecture.js'",JSON.stringify(url(read('locationArchitecture.js'))))));
const opts=JSON.parse(process.argv[1]);
const shell=H.planBuildingShell({minX:2,minZ:2,width:12,depth:12,storeys:2,basements:1,buildingId:'b',...opts}).objects;
const plans=[-1,0,1].map(level=>I.planBuildingInterior(shell,{buildingId:'b',level,...opts}));
console.log(JSON.stringify({shell,plans}));})();
"""
    result = subprocess.run(['node', '-e', script, json.dumps(dict(shape=shape, condition=condition, wealth=wealth, seed=seed))],
                            check=True, capture_output=True, text=True, encoding='utf-8')
    return json.loads(result.stdout)


@pytest.mark.parametrize('shape', ['rectangle', 'L', 'U', 'C', 'T', 'cross', 'compound'])
@pytest.mark.parametrize('condition', ['intact', 'damaged', 'ruins'])
def test_layout_keeps_reachable_rooms_and_physical_level_connections(app, shape, condition):
    data = interior(shape, condition, wealth='rich')
    objects = [SimpleNamespace(id=i+1, **o) for i, o in enumerate(data['shell'] + [o for p in data['plans'] for o in p['objects']])]
    location = SimpleNamespace(id=1, grid_width=18, grid_height=18,
                               tiles_data=[[{'height': 1} for _ in range(18)] for _ in range(18)])
    with patch.object(LocationObject, 'query') as oq, patch.object(LocationCharacter, 'query') as cq:
        oq.filter_by.return_value.all.return_value = objects
        cq.filter_by.return_value.all.return_value = []
        maps = {level: CombatService._build_movement_map(location, floor_level=level) for level in [-1, 0, 1]}
        route = lambda a, b: find_path(location, objects, a, b, lambda level: maps[level])
        entry = next(o for o in objects if o.type == 'door' and o.properties.get('building_generation'))
        anchor = (entry.tile_x, entry.tile_y+1, 0)
        below = next(o for o in objects if o.type == 'ladder' and o.properties['level'] == -1)
        basement = (below.tile_x, below.tile_y, -1)
        assert route((entry.tile_x, entry.tile_y-1, 0), anchor)
        assert route(anchor, basement)
        assert route(basement, anchor)
        assert bool(route(anchor, (anchor[0], anchor[1], 1))) == (condition != 'ruins')
        # Compare to the shell: collapse may already isolate an area, but the
        # layout must not create an inaccessible room on previously usable floor.
        shell = [SimpleNamespace(id=i+1, **o) for i, o in enumerate(data['shell'])]
        oq.filter_by.return_value.all.return_value = shell
        old_maps = {level: CombatService._build_movement_map(location, floor_level=level) for level in [-1, 0, 1]}
        for level, plan in zip([-1, 0, 1], data['plans']):
            for room in plan['rooms']:
                candidates = [(c['x'], c['z'], level) for c in room['cells']
                              if find_path(location, shell, (anchor[0], anchor[1], level), (c['x'], c['z'], level), lambda l: old_maps[l])]
                if candidates:
                    assert any(route((anchor[0], anchor[1], level), c) for c in candidates), (shape, condition, level, room['name'])


def test_layout_replacement_is_atomic_scoped_and_synchronized(client, app, create_user, auth_headers):
    gm, player = create_user('interior-gm'), create_user('interior-player')
    headers = auth_headers(gm)
    lobby = client.post('/lobbies/', headers=headers, json=dict(name='interior', map_type='empty', chunks_width=1, chunks_height=1)).get_json()
    api = f"/lobbies/{lobby['id']}"
    client.post(api+'/join', headers=auth_headers(player))
    loc = client.post(api+'/locations', headers=headers, json=dict(name='interior', world_tile_x=1, world_tile_z=1, grid_width=18, grid_height=18)).get_json()
    url = f"{api}/locations/{loc['id']}"
    data = interior('rectangle', 'intact')
    original = client.post(url+'/objects/batch', headers=headers, json={'objects': data['shell']}).get_json()['objects']
    plans = data['plans']
    layout = client.post(url+'/objects/batch', headers=headers, json={'objects': plans[1]['objects']}).get_json()['objects']
    upper = client.post(url+'/objects/batch', headers=headers, json={'objects': plans[2]['objects']}).get_json()['objects']
    manual = client.post(url+'/objects', headers=headers, json=dict(type='wall', name='Manual', tile_x=12, tile_y=12,
                         properties={'building_id': 'b', 'level': 0})).get_json()
    from app.sockets.location import handle_join_location
    socketio.on_event('join_location', handle_join_location)
    peers = [socketio.test_client(app), socketio.test_client(app)]
    payload = {'objects': plans[1]['objects'], 'replace_layout': {'building_id': 'b', 'level': 0, 'object_ids': [o['id'] for o in layout]}}
    try:
        for peer, user in zip(peers, [gm, player]):
            peer.emit('join_location', dict(token=user['token'], location_id=loc['id']))
            peer.get_received()
        assert client.post(url+'/objects/batch', headers=auth_headers(player), json=payload).status_code == 403
        invalid = json.loads(json.dumps(payload))
        invalid['replace_layout']['object_ids'].append(manual['id'])
        assert client.post(url+'/objects/batch', headers=headers, json=invalid).status_code == 409
        invalid = json.loads(json.dumps(payload))
        invalid['objects'][0]['properties']['level'] = 1
        assert client.post(url+'/objects/batch', headers=headers, json=invalid).status_code == 400
        response = client.post(url+'/objects/batch', headers=headers, json=payload)
        assert response.status_code == 201
        changed = response.get_json()
        assert set(changed['deleted_ids']) == {o['id'] for o in layout}
        for peer in peers:
            events = [e for e in peer.get_received() if e['name'] == 'location_objects_changed']
            assert len(events) == 1
            assert events[0]['args'][0]['deleted_ids'] == changed['deleted_ids']
        db.session.remove()
        saved = client.get(url, headers=headers).get_json()['objects']
        assert {o['id'] for o in saved} == {o['id'] for o in original+upper+[manual]+changed['objects']}
        assert client.post(url+'/objects/batch', headers=headers, json=payload).status_code == 409
        assert client.get(url, headers=headers).get_json()['objects'] == saved
        cleared = client.post(url+'/objects/batch', headers=headers, json={'objects': [], 'replace_layout': {
            'building_id': 'b', 'level': 0, 'object_ids': [o['id'] for o in changed['objects']]}})
        assert cleared.status_code == 201
        assert cleared.get_json()['objects'] == []
        assert {o['id'] for o in client.get(url, headers=headers).get_json()['objects']} == {o['id'] for o in original+upper+[manual]}
    finally:
        for peer in peers:
            peer.disconnect()
