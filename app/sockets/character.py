import logging

from flask import request
from flask_socketio import emit, join_room, leave_room
from sqlalchemy.orm.exc import StaleDataError

from app.extensions import socketio, db
from app.services.character import CharacterService
from app.services.character_events import (
    register_subscription, forget_subscription, publish_character_save,
)
from app.services.exceptions import ServiceError, PermissionDenied, ValidationError, ConflictError
from .utils import get_user_from_token

logger = logging.getLogger(__name__)


def _request_identity(data):
    if not isinstance(data, dict):
        raise ValidationError('Invalid character request')
    user = get_user_from_token(data.get('token')) if data.get('token') else None
    if not user:
        raise PermissionDenied('Invalid token')
    try:
        character_id = int(data['character_id'])
    except (KeyError, TypeError, ValueError):
        raise ValidationError('Invalid character ID')
    return user, character_id


def _error_response(error):
    db.session.rollback()
    emit('error', {'message': str(error)}, room=request.sid)
    return {'ok': False, 'error': str(error), 'code': error.code}


@socketio.on('join_character')
def handle_join_character(data):
    try:
        user, character_id = _request_identity(data)
        CharacterService.get_character(character_id, user.id)
    except ServiceError as error:
        return _error_response(error)
    register_subscription(request.sid, character_id, user.id)
    join_room(f'character_{character_id}')
    return {'ok': True, 'character_id': character_id}


@socketio.on('leave_character')
def handle_leave_character(data):
    try:
        _, character_id = _request_identity(data)
    except ServiceError as error:
        return _error_response(error)
    forget_subscription(request.sid, character_id)
    leave_room(f'character_{character_id}')
    return {'ok': True}


@socketio.on('update_character_data')
def handle_update_character_data(data):
    try:
        user, character_id = _request_identity(data)
        updates = data.get('updates')
        result = CharacterService.update_character(character_id, user.id, updates)
    except StaleDataError:
        return _error_response(ConflictError())
    except ServiceError as error:
        return _error_response(error)
    publish_character_save(result, updates, user.id, skip_sid=request.sid)
    logger.debug('Character %s updated by %s', character_id, user.id)
    return {'ok': True, 'character_id': character_id, 'data': result.character.data_snapshot()}
