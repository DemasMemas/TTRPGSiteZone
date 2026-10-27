import json
import subprocess

from app.extensions import socketio
from app.models import LocationObject
from app.services.combat import CombatService
from app.services.location_navigation import surface
from test_location_furniture import furniture


def test_building_anomalies_roundtrip_physical_levels_and_stale_generation(client, app, create_user, auth_headers):
    gm = create_user('building-anomalies-gm')
    headers = auth_headers(gm)
    lobby = client.post('/lobbies/', headers=headers, json=dict(name='anomalies', map_type='empty', chunks_width=1, chunks_height=1)).get_json()
    api = f"/lobbies/{lobby['id']}"
    loc = client.post(api+'/locations', headers=headers, json=dict(name='anomalies', world_tile_x=1, world_tile_z=1, grid_width=18, grid_height=18)).get_json()
    url = f"{api}/locations/{loc['id']}"
    data = furniture(shellOptions={'wealth': 'rich'})
    specs = [{k: v for k, v in o.items() if k not in {'id', 'revision'}} for o in data['source']+data['plan']['objects']]
    source = client.post(url+'/objects/batch', headers=headers, json={'objects': specs}).get_json()['objects']
    script = """
const {modules}=require('./tests/location_furniture_fixture.cjs');
const source=JSON.parse(require('fs').readFileSync(0,'utf8'));
modules().then(({B})=>console.log(JSON.stringify(B.planBuildingAnomalies(source,{buildingId:'b',seed:'server',catalog:[{key:'vspishka',name:'Искра',visual:'electric'}]}))));
"""
    plan = json.loads(subprocess.run(['node', '-e', script], input=json.dumps(source), capture_output=True, text=True, encoding='utf-8', check=True).stdout)
    assert plan['objects']
    payload = {'objects': plan['objects'], 'generate_anomalies': {'building_id': 'b', 'source_versions': plan['sourceVersions']}}
    from app.sockets.location import handle_join_location
    socketio.on_event('join_location', handle_join_location)
    peers = [socketio.test_client(app), socketio.test_client(app)]
    try:
        for peer in peers:
            peer.emit('join_location', dict(token=gm['token'], location_id=loc['id']))
            peer.get_received()
        result = client.post(url+'/objects/batch', headers=headers, json=payload)
        assert result.status_code == 201, result.get_json()
        created = result.get_json()['objects']
        for peer in peers:
            events = [e for e in peer.get_received() if e['name'] == 'location_objects_changed']
            assert len(events) == 1 and events[0]['args'][0]['objects'] == created
        assert client.post(url+'/objects/batch', headers=headers, json=payload).status_code == 409
        from app.models import Location
        location = app.extensions['sqlalchemy'].session.get(Location, loc['id'])
        objects = LocationObject.query.filter_by(location_id=loc['id']).all()
        for obj in created:
            level = obj['properties']['level']
            blocked, costs = CombatService._build_movement_map(location, floor_level=level)
            assert (obj['tile_x'], obj['tile_y']) not in blocked
            assert surface(location, objects, obj['tile_x'], obj['tile_y'], level)
            assert any(a['object_id'] == obj['id'] for a in CombatService._anomalies_at_tile(location, obj['tile_x'], obj['tile_y'], floor_level=level))
            assert not any(a['object_id'] == obj['id'] for a in CombatService._anomalies_at_tile(location, obj['tile_x'], obj['tile_y'], floor_level=level+1))
        target = created[0]
        assert client.patch(f"{api}/locations/objects/{target['id']}", headers=headers, json={'properties': {'offset_x': .1}}).status_code == 200
        saved = client.get(url, headers=headers).get_json()['objects']
        assert next(o for o in saved if o['id'] == target['id'])['properties']['offset_x'] == .1
        assert all(o in saved for o in source)
        assert client.delete(f"{api}/locations/objects/{target['id']}", headers=headers).status_code == 204
    finally:
        for peer in peers:
            peer.disconnect()
