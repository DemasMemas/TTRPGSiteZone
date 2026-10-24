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
