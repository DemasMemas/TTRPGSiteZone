import logging

from flask import request
from flask_socketio import emit, join_room, leave_room
from sqlalchemy.orm.attributes import flag_modified

from app.extensions import socketio, db
from app.models import LobbyParticipant, LobbyCharacter
from app.models.location import Location
from app.models.location_character import LocationCharacter
from app.services.combat import CombatService
from app.services.exceptions import ServiceError
from app.services.effects import normalize_effect_list, sync_health_derived_statuses
from app.sockets.utils import get_user_from_token

logger = logging.getLogger(__name__)


def _find_existing_location_character(location_id, character_id):
    if not character_id:
        return None
    return LocationCharacter.query.filter_by(
        location_id=location_id,
        character_id=character_id,
    ).order_by(
        LocationCharacter.last_action.desc().nullslast(),
        LocationCharacter.id.desc(),
    ).first()


@socketio.on('join_location')
def handle_join_location(data):
    token = data.get('token')
    location_id = data.get('location_id')
    character_id = data.get('character_id')
    if not token or not location_id:
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    location = Location.query.get(location_id)
    if not location:
        emit('error', {'message': 'Location not found'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(
        lobby_id=location.lobby_id,
        user_id=user.id,
    ).first()
    if not participant:
        emit('error', {'message': 'Not in lobby'}, room=request.sid)
        return

    loc_char = None
    if character_id:
        character = LobbyCharacter.query.get(character_id)
        if not character:
            character_id = None
        else:
            loc_char = _find_existing_location_character(
                location_id,
                character_id,
            )

            is_gm = location.lobby.gm_id == user.id
            is_controller = bool(loc_char and loc_char.controlled_by == user.id)
            if loc_char and (
                character.owner_id == user.id
                or is_controller
                or is_gm
            ):
                if loc_char.character and isinstance(loc_char.character.data, dict):
                    health = loc_char.character.data.get('health')
                    if isinstance(health, dict):
                        loc_char.effects = normalize_effect_list(
                            health.get('effects') or []
                        )
                        sync_health_derived_statuses(health)
                        flag_modified(loc_char, 'effects')
                        db.session.commit()
            else:
                # Joining a sublocation never creates or claims a model.
                loc_char = None
                character_id = None

    join_room(f"location_{location_id}")
    emit(
        'joined_location',
        {
            'location_id': location_id,
            'character_id': character_id if loc_char else None,
            'x': loc_char.pos_x if loc_char else 0,
            'y': loc_char.pos_y if loc_char else 0,
        },
        room=request.sid,
    )

    all_chars = LocationCharacter.query.filter_by(location_id=location_id).all()
    state = []
    for lc in all_chars:
        character = lc.character
        if not character:
            continue
        state.append({
            'character_id': character.id,
            'name': character.name,
            'owner_id': character.owner_id,
            'controlled_by': lc.controlled_by,
            'owner_username': character.owner.username if character.owner else None,
            'hp_zones': lc.hp_zones,
            'effects': lc.effects,
            'x': lc.pos_x,
            'y': lc.pos_y,
            'status': lc.status,
        })
    emit('location_state', state, room=request.sid)

    combat_state = CombatService.get_state(location_id, user.id)
    emit('combat_state', combat_state, room=request.sid)


@socketio.on('leave_location')
def handle_leave_location(data):
    token = data.get('token')
    location_id = data.get('location_id')
    character_id = data.get('character_id')
    if not token or not location_id:
        return

    user = get_user_from_token(token)
    if not user:
        return

    room = f"location_{location_id}"
    leave_room(room)
    emit('left_location', {'character_id': character_id}, room=request.sid)


@socketio.on('move_in_location')
def handle_move_in_location(data):
    token = data.get('token')
    location_id = data.get('location_id')
    character_id = data.get('character_id')
    new_x = data.get('x')
    new_y = data.get('y')
    special_action = data.get('special_action')
    object_id = data.get('object_id')
    climb_mode = data.get('climb_mode')
    movement_mode = data.get('movement_mode')
    if not all([token, location_id, character_id, new_x is not None, new_y is not None]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    try:
        moved_character, cost, combat_state = CombatService.move_character(
            location_id,
            user.id,
            character_id,
            new_x,
            new_y,
            special_action,
            object_id,
            climb_mode,
            movement_mode,
        )
    except ServiceError as exc:
        db.session.rollback()
        current_character = LocationCharacter.query.filter_by(
            location_id=location_id,
            character_id=character_id,
        ).first()
        emit(
            'movement_rejected',
            {
                'character_id': character_id,
                'x': current_character.pos_x if current_character else None,
                'y': current_character.pos_y if current_character else None,
                'message': str(exc),
            },
            room=request.sid,
        )
        return

    emit(
        'character_moved',
        {
            'character_id': character_id,
            'x': moved_character.pos_x,
            'y': moved_character.pos_y,
            'movement_cost': cost,
            'movement_mode': movement_mode,
        },
        room=f"location_{location_id}",
    )

    if combat_state:
        socketio.emit('combat_state_updated', combat_state, room=f"location_{location_id}")


@socketio.on('update_location_tiles')
def handle_update_location_tiles(data):
    token = data.get('token')
    location_id = data.get('location_id')
    updates = data.get('updates', [])
    if not token or not location_id or not updates:
        return

    user = get_user_from_token(token)
    if not user:
        return

    location = Location.query.get(location_id)
    if not location:
        return

    if location.lobby.gm_id != user.id:
        emit('error', {'message': 'Only GM can edit location tiles'}, room=request.sid)
        return

    tiles = location.tiles_data
    if not isinstance(tiles, list):
        tiles = []
    changed = []

    for upd in updates:
        x = upd.get('x')
        z = upd.get('z')
        if x is None or z is None:
            continue
        if 0 <= z < len(tiles) and 0 <= x < len(tiles[0]):
            tile = dict(tiles[z][x])
            terrain_changed = False
            height_changed = False
            objects_changed = False
            radiation_changed = False

            if 'terrain' in upd and tile.get('terrain') != upd['terrain']:
                tile['terrain'] = upd['terrain']
                terrain_changed = True
            if 'height' in upd and tile.get('height') != upd['height']:
                tile['height'] = upd['height']
                height_changed = True
            if 'objects' in upd and tile.get('objects') != upd['objects']:
                tile['objects'] = upd['objects']
                objects_changed = True
            if 'radiation' in upd and tile.get('radiation') != upd['radiation']:
                tile['radiation'] = upd['radiation']
                radiation_changed = True

            if terrain_changed or height_changed or objects_changed or radiation_changed:
                tiles[z][x] = tile
                changed.append({
                    'x': x,
                    'z': z,
                    'terrain': tile.get('terrain'),
                    'height': tile.get('height'),
                    'objects': tile.get('objects'),
                    'radiation': tile.get('radiation'),
                })

    if changed:
        location.tiles_data = tiles
        flag_modified(location, "tiles_data")
        db.session.commit()
        socketio.emit('location_tiles_updated', {
            'location_id': location_id,
            'updates': changed,
        }, room=f"location_{location_id}")
        logger.info(f"Location {location_id} tiles updated by GM {user.id}")
