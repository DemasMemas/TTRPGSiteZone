"""Ephemeral world-map pings; no map or character state is changed."""
import time
import math
from flask import request
from app.extensions import db, socketio
from app.models import Lobby, LobbyParticipant, User
from .auth import sid_to_user, sid_to_lobby

_last_ping = {}
_measurements = {}
_last_measure = {}


def clear_measurement(sid):
    measurement = _measurements.pop(sid, None)
    _last_measure.pop(sid, None)
    if measurement:
        socketio.emit('map_measure', {'lobby_id': measurement['lobby_id'], 'id': sid, 'clear': True},
                      room=f"lobby_{measurement['lobby_id']}")


def sync_measurements(lobby_id, sid):
    socketio.emit('map_measure_snapshot', [m for m in _measurements.values() if str(m['lobby_id']) == str(lobby_id)], to=sid)


@socketio.on('map_measure')
def handle_map_measure(payload=None):
    user_id, lobby_id = sid_to_user.get(request.sid), sid_to_lobby.get(request.sid)
    lobby = db.session.get(Lobby, lobby_id) if lobby_id else None
    participant = db.session.get(LobbyParticipant, (lobby_id, user_id)) if lobby_id and user_id else None
    if not lobby or not lobby.is_active or not participant or participant.is_banned:
        return {'ok': False, 'error': 'Нет доступа к комнате'}
    if not isinstance(payload, dict):
        return {'ok': False, 'error': 'Некорректное измерение'}
    if payload.get('clear') is True:
        clear_measurement(request.sid)
        return {'ok': True}
    def point(value):
        if not isinstance(value, dict):
            return None
        values = [value.get(k) for k in ('x', 'y', 'z')]
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
            return None
        x,y,z = values
        if not (0 <= x < lobby.chunks_width*32 and 0 <= z < lobby.chunks_height*32 and -1000 <= y <= 1000):
            return None
        return dict(zip(('x','y','z'), values))
    start, end = point(payload.get('from')), point(payload.get('to'))
    final = payload.get('final', False)
    if not start or not end or type(final) is not bool:
        return {'ok': False, 'error': 'Точки измерения вне карты или некорректны'}
    now = time.monotonic()
    if not final and now-_last_measure.get(request.sid, -float('inf')) < .05:
        return {'ok': True, 'throttled': True}
    _last_measure[request.sid] = now
    user = db.session.get(User, user_id)
    measurement = {'id': request.sid, 'lobby_id': lobby.id, 'user_id': user_id, 'username': user.username,
                   'from': start, 'to': end, 'final': final}
    _measurements[request.sid] = measurement
    socketio.emit('map_measure', measurement, room=f'lobby_{lobby.id}')
    return {'ok': True}


@socketio.on('map_ping')
def handle_map_ping(payload=None):
    user_id = sid_to_user.get(request.sid)
    lobby_id = sid_to_lobby.get(request.sid)
    if not user_id or not lobby_id:
        return {'ok': False, 'error': 'Сначала войдите в комнату'}
    lobby = db.session.get(Lobby, lobby_id)
    participant = db.session.get(LobbyParticipant, (lobby_id, user_id))
    if not lobby or not lobby.is_active or not participant or participant.is_banned:
        return {'ok': False, 'error': 'Нет доступа к комнате'}
    if not isinstance(payload, dict):
        return {'ok': False, 'error': 'Некорректная точка'}
    x, y = payload.get('tile_x'), payload.get('tile_y')
    if type(x) is not int or type(y) is not int or not (0 <= x < lobby.chunks_width * 32 and 0 <= y < lobby.chunks_height * 32):
        return {'ok': False, 'error': 'Точка находится за пределами карты'}
    now = time.monotonic()
    for sid, timestamp in list(_last_ping.items()):
        if now - timestamp > 10:
            _last_ping.pop(sid, None)
    if now - _last_ping.get(request.sid, -float('inf')) < 0.5:
        return {'ok': False, 'error': 'Указатель можно отправлять раз в полсекунды'}
    _last_ping[request.sid] = now
    user = db.session.get(User, user_id)
    socketio.emit('map_ping', {'lobby_id': lobby.id, 'tile_x': x, 'tile_y': y,
        'user_id': user_id, 'username': user.username}, room=f'lobby_{lobby.id}')
    return {'ok': True}
