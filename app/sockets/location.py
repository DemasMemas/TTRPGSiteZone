import logging
from flask import request
from flask_socketio import emit, join_room, leave_room
from sqlalchemy.orm.attributes import flag_modified

from app.extensions import socketio, db
from app.models.location import Location
from app.models.location_character import LocationCharacter
from app.sockets.utils import get_user_from_token
from app.models import LobbyParticipant, LobbyCharacter

logger = logging.getLogger(__name__)


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
        lobby_id=location.lobby_id, user_id=user.id
    ).first()
    if not participant:
        emit('error', {'message': 'Not in lobby'}, room=request.sid)
        return

    is_gm = (location.lobby.gm_id == user.id)

    # Если есть character_id, создаём/обновляем LocationCharacter (для перемещения)
    loc_char = None
    if character_id:
        character = LobbyCharacter.query.get(character_id)
        if not character or character.owner_id != user.id:
            emit('error', {'message': 'Character not found or not owned'}, room=request.sid)
            return
        loc_char = LocationCharacter.query.filter_by(
            location_id=location_id, character_id=character_id
        ).first()
        if not loc_char:
            spawn = None
            for sp in location.spawn_points:
                taken = LocationCharacter.query.filter_by(
                    location_id=location_id, pos_x=sp.get('x'), pos_y=sp.get('y')
                ).first()
                if not taken:
                    spawn = sp
                    break
            if not spawn:
                spawn = {'x': 0, 'y': 0}
            loc_char = LocationCharacter(
                location_id=location_id,
                character_id=character_id,
                pos_x=spawn['x'],
                pos_y=spawn['y'],
                status='idle'
            )
            db.session.add(loc_char)
            db.session.commit()

    # ВСЕГДА добавляем клиента в комнату локации, чтобы он получал обновления карты
    join_room(f"location_{location_id}")
    emit('joined_location', {
        'location_id': location_id,
        'character_id': character_id,
        'x': loc_char.pos_x if loc_char else 0,
        'y': loc_char.pos_y if loc_char else 0
    }, room=request.sid)

    # Отправляем текущее состояние всех персонажей (если есть)
    all_chars = LocationCharacter.query.filter_by(location_id=location_id).all()
    state = []
    for lc in all_chars:
        character = lc.character
        state.append({
            'character_id': character.id,
            'name': character.name,
            'owner_id': character.owner_id,
            'owner_username': character.owner.username if character.owner else None,
            'hp_zones': lc.hp_zones,
            'effects': lc.effects,
            'x': lc.pos_x,
            'y': lc.pos_y,
            'status': lc.status
        })
    emit('location_state', state, room=request.sid)

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
    if not all([token, location_id, character_id, new_x is not None, new_y is not None]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    loc_char = LocationCharacter.query.filter_by(
        location_id=location_id, character_id=character_id
    ).first()
    if not loc_char:
        emit('error', {'message': 'Character not in location'}, room=request.sid)
        return

    # Проверка прав: персонаж должен принадлежать пользователю или пользователь – GM
    location = Location.query.get(location_id)
    if not location:
        return
    lobby = location.lobby
    is_gm = (lobby.gm_id == user.id)
    if not is_gm and loc_char.character.owner_id != user.id:
        emit('error', {'message': 'Permission denied'}, room=request.sid)
        return

    # Проверка границ
    if not (0 <= new_x < location.grid_width and 0 <= new_y < location.grid_height):
        emit('error', {'message': 'Out of bounds'}, room=request.sid)
        return

    # Здесь можно добавить проверку на проходимость (tiles_data)
    # Например, tile = location.tiles_data[new_y][new_x], если terrain == 'water' – нельзя

    loc_char.pos_x = new_x
    loc_char.pos_y = new_y
    loc_char.last_action = db.func.now()
    db.session.commit()

    emit('character_moved', {
        'character_id': character_id,
        'x': new_x,
        'y': new_y
    }, room=f"location_{location_id}")

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

    # Только GM может редактировать
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
            tile = dict(tiles[z][x])  # копируем
            terrain_changed = False
            height_changed = False
            objects_changed = False
            radiation_changed = False   # <-- добавить

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
                radiation_changed = True   # <-- добавить

            if terrain_changed or height_changed or objects_changed or radiation_changed:
                tiles[z][x] = tile
                changed.append({
                    'x': x, 'z': z,
                    'terrain': tile.get('terrain'),
                    'height': tile.get('height'),
                    'objects': tile.get('objects'),
                    'radiation': tile.get('radiation')   # <-- добавить
                })

    if changed:
        location.tiles_data = tiles
        flag_modified(location, "tiles_data")
        db.session.commit()
        socketio.emit('location_tiles_updated', {
            'location_id': location_id,
            'updates': changed
        }, room=f"location_{location_id}")
        logger.info(f"Location {location_id} tiles updated by GM {user.id}")