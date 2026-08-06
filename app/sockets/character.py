import logging
from copy import deepcopy
from flask import request
from flask_socketio import emit, join_room, leave_room
from sqlalchemy.orm.attributes import flag_modified
from app.extensions import socketio, db
from app.models import Lobby, LobbyCharacter, LobbyParticipant, LocationCharacter
from app.services.character import CharacterService
from app.services.effects import normalize_effect_list, sync_health_derived_statuses
from app.services.health import apply_health_maximums, health_zones_to_location
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

    lobby = db.session.get(Lobby, character.lobby_id)
    is_gm = bool(lobby and lobby.gm_id == user.id)
    is_controller = LocationCharacter.query.filter_by(
        character_id=character.id,
        controlled_by=user.id,
    ).first() is not None
    if (
        character.owner_id != user.id
        and not is_gm
        and user.id not in (character.editable_to or [])
        and not is_controller
    ):
        emit('error', {'message': 'You cannot update this character'}, room=request.sid)
        return
    if 'visible_to' in updates and not is_gm:
        emit('error', {'message': 'Only GM can change visibility'}, room=request.sid)
        return
    if 'data' in updates and not is_gm:
        CharacterService.mark_added_items_as_player_created(
            character.data,
            updates['data'],
        )

    # Применяем обновления
    if 'data' in updates:
        character.data = updates['data']
    else:
        for key, value in updates.items():
            if hasattr(character, key):
                setattr(character, key, value)

    posture_updates = []
    if isinstance(character.data, dict):
        character_data = deepcopy(character.data)
        health = apply_health_maximums(character_data)
        character.data = character_data
        if isinstance(health, dict):
            health['effects'] = normalize_effect_list(health.get('effects') or [])
            sync_health_derived_statuses(health)
            character.data['health'] = health
        for loc_char in LocationCharacter.query.filter_by(character_id=character.id).all():
            if isinstance(health, dict):
                loc_char.effects = list(health.get('effects') or [])
                loc_char.hp_zones = health_zones_to_location(health)
                effect_types = {
                    str(effect.get('type') or '')
                    for effect in loc_char.effects
                    if isinstance(effect, dict) and effect.get('active', True)
                }
                zones = health.get('zones') if isinstance(health.get('zones'), dict) else {}
                head = zones.get('head') if isinstance(zones.get('head'), dict) else {}
                chest = zones.get('chest') if isinstance(zones.get('chest'), dict) else {}
                current_health = health.get('current')
                total_health_zero = current_health is not None and float(current_health) <= 0
                head_zero = float(head.get('max') or 0) > 0 and float(head.get('current') or 0) <= 0
                chest_zero = float(chest.get('max') or 0) > 0 and float(chest.get('current') or 0) <= 0
                incapacitated = bool(
                    effect_types.intersection({'shock', 'unconsciousness', 'critical_condition', 'death'})
                    or total_health_zero
                    or head_zero
                    or chest_zero
                )
                if incapacitated and loc_char.posture != 'prone':
                    loc_char.posture = 'prone'
                    loc_char.cover_object_id = None
                    loc_char.weapon_braced = False
                    loc_char.braced_weapon_index = None
                    posture_updates.append({
                        'location_id': loc_char.location_id,
                        'character_id': character.id,
                        'posture': 'prone',
                    })
                flag_modified(loc_char, 'effects')
            else:
                loc_char.effects = []
                flag_modified(loc_char, 'effects')

    db.session.commit()

    for posture_update in posture_updates:
        socketio.emit(
            'location_character_posture_updated',
            {
                'location_id': posture_update['location_id'],
                'character_id': posture_update['character_id'],
                'posture': posture_update['posture'],
            },
            room=f"location_{posture_update['location_id']}",
        )

    emit('character_data_updated', {
        'character_id': character_id,
        'updates': updates,
        'updated_by': user.id
    }, room=f"character_{character_id}", include_self=False)

    logger.debug("Character %s updated by %s", character_id, user.id)
