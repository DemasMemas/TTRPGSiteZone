import logging
from flask import request
from flask_socketio import emit, join_room, leave_room
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
    if not all([token, location_id, character_id]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    # Проверяем, что персонаж принадлежит пользователю
    character = LobbyCharacter.query.get(character_id)
    if not character or character.owner_id != user.id:
        emit('error', {'message': 'Character not found or not owned'}, room=request.sid)
        return

    # Проверяем, что локация существует
    location = Location.query.get(location_id)
    if not location:
        emit('error', {'message': 'Location not found'}, room=request.sid)
        return

    # Проверяем, что пользователь в лобби локации
    participant = LobbyParticipant.query.filter_by(
        lobby_id=location.lobby_id, user_id=user.id
    ).first()
    if not participant:
        emit('error', {'message': 'Not in lobby'}, room=request.sid)
        return

    # Создаём или обновляем запись LocationCharacter
    loc_char = LocationCharacter.query.filter_by(
        location_id=location_id, character_id=character_id
    ).first()
    if not loc_char:
        # Найти свободную спавн-точку
        spawn = None
        for sp in location.spawn_points:
            # Проверяем, не занята ли точка
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
    else:
        # Обновляем статус, если нужно
        pass
    db.session.commit()

    join_room(f"location_{location_id}")
    emit('joined_location', {
        'location_id': location_id,
        'character_id': character_id,
        'x': loc_char.pos_x,
        'y': loc_char.pos_y
    }, room=request.sid)

    # Отправить текущее состояние локации (всех персонажей)
    all_chars = LocationCharacter.query.filter_by(location_id=location_id).all()
    state = [{
        'character_id': lc.character_id,
        'x': lc.pos_x,
        'y': lc.pos_y,
        'status': lc.status
    } for lc in all_chars]
    emit('location_state', state, room=request.sid)


@socketio.on('leave_location')
def handle_leave_location(data):
    token = data.get('token')
    location_id = data.get('location_id')
    character_id = data.get('character_id')
    if not all([token, location_id, character_id]):
        return

    user = get_user_from_token(token)
    if not user:
        return

    room = f"location_{location_id}"
    leave_room(room)

    # Не удаляем запись LocationCharacter, просто помечаем, что вышел (опционально)
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