# app/sockets/markers.py
from datetime import datetime, timezone

from flask import request
from flask_socketio import emit
from app.extensions import socketio, db
from app.models import LobbyParticipant, GameState
from .utils import get_user_from_token

@socketio.on('add_marker')
def handle_add_marker(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    x = data.get('x')
    y = data.get('y')
    marker_type = data.get('type', 'default')

    if not all([token, lobby_id, x is not None, y is not None]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant:
        emit('error', {'message': 'Not in lobby'}, room=request.sid)
        return

    # Загружаем или создаём GameState
    game_state = GameState.query.filter_by(lobby_id=lobby_id).first()
    if not game_state:
        game_state = GameState(lobby_id=lobby_id)
        db.session.add(game_state)

    # Добавляем метку
    markers = game_state.map_data.get('markers', [])
    new_marker = {
        'id': len(markers) + 1,  # простой ID
        'x': x,
        'y': y,
        'type': marker_type,
        'created_by': user.username
    }
    markers.append(new_marker)
    game_state.map_data['markers'] = markers
    db.session.commit()

    emit('marker_added', new_marker, room=f"lobby_{lobby_id}")

@socketio.on('move_marker')
def handle_move_marker(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    marker_id = data.get('marker_id')
    new_x = data.get('x')
    new_y = data.get('y')

    if not all([token, lobby_id, marker_id, new_x is not None, new_y is not None]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    game_state = GameState.query.filter_by(lobby_id=lobby_id).first()
    if not game_state:
        return

    markers = game_state.map_data.get('markers', [])
    for marker in markers:
        if marker.get('id') == marker_id:
            marker['x'] = new_x
            marker['y'] = new_y
            break

    game_state.map_data['markers'] = markers
    db.session.commit()

    emit('marker_moved', {'id': marker_id, 'x': new_x, 'y': new_y}, room=f"lobby_{lobby_id}")

@socketio.on('delete_marker')
def handle_delete_marker(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    marker_id = data.get('marker_id')

    if not all([token, lobby_id, marker_id]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    game_state = GameState.query.filter_by(lobby_id=lobby_id).first()
    if not game_state:
        return

    markers = game_state.map_data.get('markers', [])
    markers = [m for m in markers if m.get('id') != marker_id]
    game_state.map_data['markers'] = markers
    db.session.commit()

    emit('marker_deleted', {'id': marker_id}, room=f"lobby_{lobby_id}")