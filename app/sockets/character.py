import logging
from flask import request
from flask_socketio import emit, join_room, leave_room
from app.extensions import socketio, db
from app.models import LobbyCharacter, LobbyParticipant
from .utils import get_user_from_token

logger = logging.getLogger(__name__)

@socketio.on('join_character')
def handle_join_character(data):
    token = data.get('token')
    character_id = data.get('character_id')
    if not token or not character_id:
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'})
        return

    character = LobbyCharacter.query.get(character_id)
    if not character:
        emit('error', {'message': 'Character not found'})
        return

    participant = LobbyParticipant.query.filter_by(
        lobby_id=character.lobby_id, user_id=user.id
    ).first()
    if not participant:
        emit('error', {'message': 'You are not in this lobby'})
        return

    room = f"character_{character_id}"
    join_room(room)
    logger.info(f"User {user.id} joined character room {room}")

@socketio.on('leave_character')
def handle_leave_character(data):
    token = data.get('token')
    character_id = data.get('character_id')
    if not token or not character_id:
        return

    user = get_user_from_token(token)
    if not user:
        return

    room = f"character_{character_id}"
    leave_room(room)
    logger.info(f"User {user.id} left character room {room}")

@socketio.on('update_character_data')
def handle_update_character_data(data):
    token = data.get('token')
    character_id = data.get('character_id')
    updates = data.get('updates')
    if not token or not character_id or updates is None:
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    character = LobbyCharacter.query.get(character_id)
    if not character:
        emit('error', {'message': 'Character not found'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(
        lobby_id=character.lobby_id, user_id=user.id
    ).first()
    if not participant:
        emit('error', {'message': 'You are not in this lobby'}, room=request.sid)
        return

    # Применяем обновления
    if 'data' in updates:
        character.data = updates['data']
    else:
        for key, value in updates.items():
            if hasattr(character, key):
                setattr(character, key, value)
    db.session.commit()

    emit('character_data_updated', {
        'character_id': character_id,
        'updates': updates,
        'updated_by': user.id
    }, room=f"character_{character_id}", include_self=False)

    logger.info(f"Character {character_id} updated by {user.id}")