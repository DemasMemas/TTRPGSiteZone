"""Ephemeral world/local map tools; no map or character state is changed."""
import time
import math
from flask import request
from app.extensions import db, socketio
from app.models import Lobby, LobbyParticipant, User
from .auth import sid_to_user, sid_to_lobby
from .map_scope import map_bounds, map_point, map_floor

_last_ping = {}
_measurements = {}
_last_measure = {}


def tool_room(lobby_id, location_id=None):
    return f'location_{location_id}' if location_id is not None else f'lobby_{lobby_id}'


def clear_measurement(sid):
    measurement = _measurements.pop(sid, None)
    _last_measure.pop(sid, None)
    if measurement:
        socketio.emit('map_measure', {'lobby_id': measurement['lobby_id'], 'location_id': measurement.get('location_id'), 'id': sid, 'clear': True},
                      room=tool_room(measurement['lobby_id'], measurement.get('location_id')))


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
    location_id = payload.get('location_id')
    try:
        width, height = map_bounds(lobby, location_id)
        def point(value):
            result = map_point(value, width, height)
            if location_id is not None:
                result['floor_level'] = map_floor(value.get('floor_level', 0))
            return result
        start, end = point(payload.get('from')), point(payload.get('to'))
    except ValueError as error:
        return {'ok': False, 'error': str(error)}
    final = payload.get('final', False)
    if not start or not end or type(final) is not bool:
        return {'ok': False, 'error': 'Точки измерения вне карты или некорректны'}
    now = time.monotonic()
    if not final and now-_last_measure.get(request.sid, -float('inf')) < .05:
        return {'ok': True, 'throttled': True}
    _last_measure[request.sid] = now
    previous = _measurements.get(request.sid)
    if previous and previous.get('location_id') != location_id:
        clear_measurement(request.sid)
    user = db.session.get(User, user_id)
    measurement = {'id': request.sid, 'lobby_id': lobby.id, 'user_id': user_id, 'username': user.username,
                   'from': start, 'to': end, 'final': final}
    if location_id is not None:
        measurement['location_id'] = location_id
    _measurements[request.sid] = measurement
    socketio.emit('map_measure', measurement, room=tool_room(lobby.id, location_id))
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
    location_id = payload.get('location_id')
    scope = {}
    try:
        width, height = map_bounds(lobby, location_id)
        if location_id is not None:
            position = map_point(payload.get('position'), width, height)
            scope = {'location_id': location_id, 'position': position,
                     'floor_level': map_floor(payload.get('floor_level', 0))}
            x, y = math.floor(position['x']), math.floor(position['z'])
        else:
            x, y = payload.get('tile_x'), payload.get('tile_y')
            if type(x) is not int or type(y) is not int or not (0 <= x < width and 0 <= y < height):
                raise ValueError('Точка находится за пределами карты')
    except ValueError as error:
        return {'ok': False, 'error': str(error)}
    now = time.monotonic()
    for sid, timestamp in list(_last_ping.items()):
        if now - timestamp > 10:
            _last_ping.pop(sid, None)
    if now - _last_ping.get(request.sid, -float('inf')) < 0.5:
        return {'ok': False, 'error': 'Указатель можно отправлять раз в полсекунды'}
    _last_ping[request.sid] = now
    user = db.session.get(User, user_id)
    socketio.emit('map_ping', {'lobby_id': lobby.id, 'tile_x': x, 'tile_y': y,
        'user_id': user_id, 'username': user.username, **scope}, room=tool_room(lobby.id, location_id))
    return {'ok': True}
