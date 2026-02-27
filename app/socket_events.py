from datetime import datetime, timezone
from app.utils.dice import roll_dice
import random

from flask import request
from flask_socketio import join_room, leave_room, emit
from flask_jwt_extended import decode_token
from app import socketio, db
from app.models import User, Lobby, LobbyParticipant, Character, GameState, ChatMessage

sid_to_user = {}
user_lobby = {}

# Вспомогательная функция для получения пользователя по токену
def get_user_from_token(token):
    try:
        decoded = decode_token(token)
        user_id = decoded['sub']
        return User.query.get(user_id)
    except:
        return None


@socketio.on('connect')
def handle_connect():
    print('Client connected')


@socketio.on('authenticate')
def handle_authenticate(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    if not token or not lobby_id:
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'})
        return

    # Проверяем, не забанен ли пользователь
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant:
        emit('error', {'message': 'You are not in this lobby'})
        return
    if participant.is_banned:
        emit('error', {'message': 'You are banned from this lobby'})
        return

    # Сохраняем информацию о подключении
    sid_to_user[request.sid] = user.id
    user_lobby[user.id] = lobby_id

    join_room(f"lobby_{lobby_id}")
    join_room(f"user_{user.id}")  # личная комната для кика

    emit('authenticated', {'username': user.username}, room=request.sid)

    # Оповещаем всех в лобби о новом участнике
    emit('user_joined', {'user_id': user.id, 'username': user.username}, room=f"lobby_{lobby_id}")

    # Отправляем новому участнику список текущих онлайн-пользователей
    online_users = [uid for uid, lid in user_lobby.items() if lid == lobby_id]
    emit('online_users', online_users, room=request.sid)

    # Загружаем историю чата (как и раньше)
    messages = ChatMessage.query.filter_by(lobby_id=lobby_id).order_by(ChatMessage.timestamp.desc()).limit(50).all()
    messages.reverse()
    history = [{'username': msg.username, 'message': msg.message, 'timestamp': msg.timestamp.isoformat()} for msg in
               messages]
    emit('chat_history', history, room=request.sid)


@socketio.on('send_message')
def handle_message(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    raw_message = data.get('message')
    if not token or not lobby_id or not raw_message:
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'})
        return

    # Проверяем, является ли сообщение командой
    final_text = raw_message
    if raw_message.startswith('/roll'):
        parts = raw_message.split(' ', 1)
        if len(parts) == 2:
            expression = parts[1]
            result, description = roll_dice(expression)
            if result is None:
                # Ошибка в выражении — показываем только отправителю
                emit('new_message', {
                    'username': 'System',
                    'message': description,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                }, room=request.sid)
                return
            else:
                # Формируем текст для сохранения и рассылки
                final_text = f"/roll {expression}: {description}"
        else:
            # Неправильный формат команды
            emit('new_message', {
                'username': 'System',
                'message': "Использование: /roll 2d6+3",
                'timestamp': datetime.now(timezone.utc).isoformat()
            }, room=request.sid)
            return

    # Сохраняем сообщение в БД
    msg = ChatMessage(
        lobby_id=lobby_id,
        user_id=user.id,
        username=user.username,
        message=final_text
    )
    db.session.add(msg)
    db.session.commit()

    # Рассылаем всем в комнате
    emit('new_message', {
        'username': user.username,
        'message': final_text,
        'timestamp': msg.timestamp.isoformat()
    }, room=f"lobby_{lobby_id}")


@socketio.on('disconnect')
def handle_disconnect():
    user_id = sid_to_user.pop(request.sid, None)
    if user_id:
        lobby_id = user_lobby.pop(user_id, None)
        if lobby_id:
            emit('user_left', {'user_id': user_id}, room=f"lobby_{lobby_id}")
    print('Client disconnected')


@socketio.on('roll_skill')
def handle_roll_skill(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    character_id = data.get('character_id')
    skill_name = data.get('skill_name')
    extra_modifier = data.get('extra_modifier', 0)

    if not all([token, lobby_id, character_id, skill_name]):
        emit('error', {'message': 'Missing data'}, room=request.sid)
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant:
        emit('error', {'message': 'You are not in this lobby'}, room=request.sid)
        return

    character = Character.query.get(character_id)
    if not character:
        emit('error', {'message': 'Character not found'}, room=request.sid)
        return

    lobby = Lobby.query.get(lobby_id)
    is_gm = (lobby.gm_id == user.id)
    if character.user_id != user.id and not is_gm:
        emit('error', {'message': 'You cannot roll for this character'}, room=request.sid)
        return

    # Универсальный поиск навыка
    char_data = character.data
    skill_bonus = None

    if isinstance(char_data, dict):
        # Прямой путь: data.skills
        if 'skills' in char_data:
            skill_bonus = char_data['skills'].get(skill_name)
        # Вложенный путь: data.data.skills
        elif 'data' in char_data and isinstance(char_data['data'], dict):
            if 'skills' in char_data['data']:
                skill_bonus = char_data['data']['skills'].get(skill_name)
            else:
                # Может быть skills прямо внутри data.data
                for k, v in char_data['data'].items():
                    if isinstance(v, dict) and skill_name in v:
                        skill_bonus = v[skill_name]
                        break
        else:
            # Обходим все поля верхнего уровня в поисках словаря, содержащего skill_name
            for k, v in char_data.items():
                if isinstance(v, dict) and skill_name in v:
                    skill_bonus = v[skill_name]
                    break

    if skill_bonus is None:
        print(f"ERROR: Skill {skill_name} not found in character data: {char_data}")
        emit('error', {'message': f'Skill {skill_name} not found'}, room=request.sid)
        return

    d20 = random.randint(1, 20)
    total = d20 + skill_bonus + extra_modifier
    roll_description = f"1d20 ({d20}) + {skill_bonus} (навык) + {extra_modifier} (мод) = **{total}**"
    message = f"{character.name} ({user.username}) совершил бросок {skill_name}: {roll_description}"

    emit('new_message', {
        'username': 'System (Roll)',
        'message': message,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }, room=f"lobby_{lobby_id}")

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

    # Рассылаем всем в лобби
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

def kick_user(user_id, lobby_id):
    socketio.emit('kicked', {'reason': 'banned'}, room=f"user_{user_id}")