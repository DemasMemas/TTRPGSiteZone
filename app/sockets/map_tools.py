"""Ephemeral world-map pings; no map or character state is changed."""
import time
from flask import request
from app.extensions import db, socketio
from app.models import Lobby, LobbyParticipant, User
from .auth import sid_to_user, sid_to_lobby

_last_ping = {}


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
