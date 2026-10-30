import pytest
from flask_jwt_extended import create_access_token
from app.extensions import db, socketio
from app.models import Lobby, LobbyParticipant, User, MapChunk


@pytest.fixture
def ping_case(app):
    from app.sockets import auth, map_tools
    for event, handler in {'connect': auth.handle_connect, 'disconnect': auth.handle_disconnect,
            'authenticate': auth.handle_authenticate, 'map_ping': map_tools.handle_map_ping,
            'map_measure': map_tools.handle_map_measure}.items():
        socketio.on_event(event, handler)
    map_tools._last_ping.clear()
    map_tools._measurements.clear(); map_tools._last_measure.clear()
    users = [User(username=f'ping-{i}', email=f'ping-{i}@example.test', password_hash='x') for i in range(3)]
    db.session.add_all(users)
    db.session.flush()
    lobby = Lobby(name='Ping', gm_id=users[0].id, invite_code='PING', chunks_width=2, chunks_height=1)
    other = Lobby(name='Other', gm_id=users[2].id, invite_code='OTHER')
    db.session.add_all([lobby, other])
    db.session.flush()
    db.session.add_all([LobbyParticipant(lobby_id=lobby.id, user_id=u.id) for u in users[:2]])
    db.session.add(LobbyParticipant(lobby_id=other.id, user_id=users[2].id))
    db.session.commit()
    connections = []
    for user, room in zip(users, [lobby, lobby, other]):
        connection = socketio.test_client(app)
        connection.emit('authenticate', {'token': create_access_token(identity=str(user.id)), 'lobby_id': room.id})
        connection.get_received()
        connections.append(connection)
    for connection in connections:
        connection.get_received()
    yield lobby, users, connections
    for connection in connections:
        if connection.is_connected():
            connection.disconnect()


@pytest.mark.parametrize('sender', [0, 1])
def test_gm_and_player_ping_reaches_only_their_room_without_saving_map(ping_case, sender):
    lobby, users, connections = ping_case
    before = MapChunk.query.count()
    result = connections[sender].emit('map_ping', {'tile_x': 63, 'tile_y': 31}, callback=True)
    assert result == {'ok': True}
    for connection in connections[:2]:
        event = next(e for e in connection.get_received() if e['name'] == 'map_ping')
        assert event['args'][0]['user_id'] == users[sender].id
        assert event['args'][0]['lobby_id'] == lobby.id
        assert event['args'][0]['tile_x'] == 63
    assert not any(e['name'] == 'map_ping' for e in connections[2].get_received())
    assert MapChunk.query.count() == before


def test_ping_rejects_bad_coordinates_banned_users_and_spam(ping_case):
    lobby, users, connections = ping_case
    connection = connections[1]
    for payload in [None, {}, {'tile_x': -1, 'tile_y': 0}, {'tile_x': 64, 'tile_y': 0},
            {'tile_x': 0, 'tile_y': 32}, {'tile_x': True, 'tile_y': 0}, {'tile_x': 1.5, 'tile_y': 0}]:
        assert connection.emit('map_ping', payload, callback=True)['ok'] is False
    assert connection.emit('map_ping', {'tile_x': 1, 'tile_y': 1}, callback=True)['ok'] is True
    assert connection.emit('map_ping', {'tile_x': 2, 'tile_y': 1}, callback=True)['ok'] is False
    db.session.get(LobbyParticipant, (lobby.id, users[1].id)).is_banned = True
    db.session.commit()
    assert connection.emit('map_ping', {'tile_x': 3, 'tile_y': 1}, callback=True)['ok'] is False


def test_ping_requires_authenticated_lobby_session(app):
    from app.sockets.map_tools import handle_map_ping
    socketio.on_event('map_ping', handle_map_ping)
    connection = socketio.test_client(app)
    try:
        assert connection.emit('map_ping', {'tile_x': 1, 'tile_y': 1}, callback=True)['ok'] is False
    finally:
        connection.disconnect()


@pytest.mark.parametrize('sender',[0,1])
def test_ruler_preview_final_clear_and_disconnect_are_shared_only_in_room(ping_case,sender):
    lobby,users,connections=ping_case
    before=MapChunk.query.count()
    payload={'from':{'x':31.5,'y':1,'z':10},'to':{'x':35,'y':2,'z':14},'final':False,'user_id':-1,'lobby_id':-1}
    assert connections[sender].emit('map_measure',payload,callback=True)=={'ok':True}
    for connection in connections[:2]:
        data=next(e['args'][0] for e in connection.get_received() if e['name']=='map_measure')
        assert data['from']==payload['from'] and data['user_id']==users[sender].id and not data['final']
    assert not any(e['name']=='map_measure' for e in connections[2].get_received())
    assert connections[sender].emit('map_measure',{**payload,'final':True},callback=True)=={'ok':True}
    recipient=connections[1-sender]
    assert next(e['args'][0] for e in recipient.get_received() if e['name']=='map_measure')['final']
    assert connections[sender].emit('map_measure',{'clear':True},callback=True)=={'ok':True}
    assert next(e['args'][0] for e in recipient.get_received() if e['name']=='map_measure')['clear']
    connections[sender].emit('map_measure',payload,callback=True);recipient.get_received()
    connections[sender].disconnect()
    assert next(e['args'][0] for e in recipient.get_received() if e['name']=='map_measure')['clear']
    assert MapChunk.query.count()==before


def test_ruler_snapshot_for_new_client_and_validation(app,ping_case):
    lobby,users,connections=ping_case
    valid={'from':{'x':1,'y':1,'z':1},'to':{'x':3,'y':1,'z':5},'final':True}
    for payload in [None,{}, {**valid,'from':{'x':True,'y':1,'z':1}},
                    {**valid,'to':{'x':float('nan'),'y':1,'z':1}},
                    {**valid,'to':{'x':64,'y':1,'z':1}},{**valid,'final':'yes'}]:
        assert connections[1].emit('map_measure',payload,callback=True)['ok'] is False
    connections[0].emit('map_measure',valid,callback=True)
    late=socketio.test_client(app)
    try:
        late.emit('authenticate',{'token':create_access_token(identity=str(users[1].id)),'lobby_id':lobby.id})
        snapshot=next(e['args'][0] for e in late.get_received() if e['name']=='map_measure_snapshot')
        assert len(snapshot)==1 and snapshot[0]['final'] and snapshot[0]['from']==valid['from']
    finally:late.disconnect()
    db.session.get(LobbyParticipant,(lobby.id,users[1].id)).is_banned=True;db.session.commit()
    assert connections[1].emit('map_measure',valid,callback=True)['ok'] is False


@pytest.fixture
def local_map_case(ping_case):
    from app.models import Location
    lobby, users, connections = ping_case
    local = Location(lobby_id=lobby.id, name='Local tools', world_tile_x=0, world_tile_z=0,
                     grid_width=80, grid_height=16, tiles_data=[])
    foreign = Location(lobby_id=Lobby.query.filter_by(gm_id=users[2].id).first().id,
                       name='Foreign', world_tile_x=0, world_tile_z=0, tiles_data=[])
    db.session.add_all([local, foreign]); db.session.commit()
    from app.sockets.location import handle_join_location
    socketio.on_event('join_location', handle_join_location)
    for index, connection in enumerate(connections[:2]):
        connection.emit('join_location', {'token': create_access_token(identity=str(users[index].id)), 'location_id': local.id})
        connection.get_received()
    return lobby, users, connections, local, foreign


def test_local_ping_uses_local_bounds_exact_height_and_floor(local_map_case):
    lobby, users, connections, local, foreign = local_map_case
    payload = {'location_id': local.id, 'position': {'x': 70.25, 'y': 5.7, 'z': 3.5}, 'floor_level': 1}
    assert connections[1].emit('map_ping', payload, callback=True) == {'ok': True}
    for connection in connections[:2]:
        event = next(e['args'][0] for e in connection.get_received() if e['name'] == 'map_ping')
        assert event['location_id'] == local.id and event['position'] == payload['position'] and event['floor_level'] == 1
        assert event['user_id'] == users[1].id
    assert not any(e['name'] == 'map_ping' for e in connections[2].get_received())
    for bad in [{**payload, 'location_id': foreign.id}, {**payload, 'location_id': True},
                {**payload, 'floor_level': 1.5}, {**payload, 'position': {'x': 80, 'y': 1, 'z': 0}}]:
        assert connections[0].emit('map_ping', bad, callback=True)['ok'] is False
    db.session.get(LobbyParticipant, (lobby.id, users[1].id)).is_banned = True
    db.session.commit(); connections[1].get_received()
    connections[1].emit('join_location', {'token': create_access_token(identity=str(users[1].id)), 'location_id': local.id})
    assert all(e['name'] not in ['joined_location', 'map_measure_snapshot'] for e in connections[1].get_received())


def test_local_measure_scope_switch_snapshot_and_validation(app, local_map_case):
    lobby, users, connections, local, foreign = local_map_case
    payload = {'location_id': local.id, 'from': {'x': 70, 'y': 1, 'z': 1, 'floor_level': 0},
               'to': {'x': 73, 'y': 5, 'z': 1, 'floor_level': 1}, 'final': True}
    assert connections[0].emit('map_measure', payload, callback=True) == {'ok': True}
    event = next(e['args'][0] for e in connections[1].get_received() if e['name'] == 'map_measure')
    assert event['from'] == payload['from'] and event['to'] == payload['to'] and event['location_id'] == local.id
    late = socketio.test_client(app)
    try:
        late.emit('authenticate', {'token': create_access_token(identity=str(users[1].id)), 'lobby_id': lobby.id})
        snapshot = next(e['args'][0] for e in late.get_received() if e['name'] == 'map_measure_snapshot')
        assert snapshot[0]['location_id'] == local.id
    finally:
        late.disconnect()
    for bad in [{**payload, 'location_id': foreign.id}, {**payload, 'to': {'x': 1, 'y': float('inf'), 'z': 1}},
                {**payload, 'to': {**payload['to'], 'floor_level': True}}]:
        assert connections[0].emit('map_measure', bad, callback=True)['ok'] is False
    connections[1].get_received()
    assert connections[0].emit('map_measure', {'from': {'x': 1, 'y': 1, 'z': 1}, 'to': {'x': 2, 'y': 1, 'z': 1}, 'final': True}, callback=True)['ok']
    events = [e['args'][0] for e in connections[1].get_received() if e['name'] == 'map_measure']
    assert events[0]['clear'] and events[0]['location_id'] == local.id
    assert events[1].get('location_id') is None


def test_local_marker_access_move_visibility_and_reload(local_map_case):
    from app.sockets import markers as handlers
    from app.models import GameState
    for name in ['get_markers', 'add_marker', 'update_marker', 'move_marker', 'delete_marker']:
        socketio.on_event(name, getattr(handlers, 'handle_' + name))
    lobby, users, connections, local, foreign = local_map_case
    def send(sender, event, **values):
        connections[sender].emit(event, {'token': create_access_token(identity=str(users[sender].id)), 'lobby_id': lobby.id, **values})
    marker = {'type': 'cache', 'name': 'Local cache', 'position': {'x': 70, 'y': 4, 'z': 2},
              'visibleTo': ['all'], 'location_id': local.id, 'floor_level': 1, 'surface_offset': .25}
    send(1, 'add_marker', marker=marker)
    added = next(e['args'][0] for e in connections[0].get_received() if e['name'] == 'marker_added')
    marker_id = added['id']
    assert added['location_id'] == local.id and added['floor_level'] == 1
    send(0, 'move_marker', marker_id=marker_id, position={'x': 72, 'y': 4.5, 'z': 2}, floor_level=1, surface_offset=.5)
    moved = next(e['args'][0] for e in connections[1].get_received() if e['name'] == 'marker_moved')
    assert moved['position']['x'] == 72 and moved['surface_offset'] == .5
    send(1, 'update_marker', marker_id=marker_id, updates={'name': 'Saved', 'visibleTo': [users[1].id]})
    send(1, 'get_markers')
    listing = next(e['args'][0] for e in connections[1].get_received() if e['name'] == 'markers_list')
    assert listing[0]['name'] == 'Saved' and listing[0]['location_id'] == local.id
    # A non-owner cannot move/delete another user's mark, even if it is visible.
    gm_marker = {**marker, 'name': 'GM', 'visibleTo': ['all']}
    send(0, 'add_marker', marker=gm_marker)
    gm_id = next(e['args'][0]['id'] for e in connections[1].get_received() if e['name'] == 'marker_added')
    send(1, 'delete_marker', marker_id=gm_id)
    assert any(e['name'] == 'error' for e in connections[1].get_received())
    send(1, 'add_marker', marker={**marker, 'location_id': foreign.id})
    assert any(e['name'] == 'error' for e in connections[1].get_received())
    send(1, 'update_marker', marker_id=marker_id, updates={'location_id': foreign.id})
    assert any(e['name'] == 'error' for e in connections[1].get_received())
    saved = db.session.query(GameState).filter_by(lobby_id=lobby.id).one().map_data['markers']
    assert next(m for m in saved if m['id'] == marker_id)['surface_offset'] == .5
    send(1, 'delete_marker', marker_id=marker_id)
    assert any(e['name'] == 'marker_deleted' for e in connections[0].get_received())


def test_route_order_is_independent_for_world_and_each_location():
    from app.sockets.markers import reorder_route_points, compact_route_points
    markers = [dict(id='world', type='route_point', routeId='same', routeOrder=1),
               dict(id='local-a', type='route_point', routeId='same', routeOrder=1, location_id=1),
               dict(id='local-b', type='route_point', routeId='same', routeOrder=1, location_id=2)]
    assert reorder_route_points(markers, 'same', 1, location_id=1) == ['local-a']
    assert [m['routeOrder'] for m in markers] == [1, 2, 1]
    assert compact_route_points(markers, 'same', location_id=1) == ['local-a']
    assert [m['routeOrder'] for m in markers] == [1, 1, 1]
