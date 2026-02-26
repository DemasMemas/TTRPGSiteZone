from datetime import datetime, timezone
from app.utils.dice import roll_dice
import random

from flask import request
from flask_socketio import join_room, leave_room, emit
from flask_jwt_extended import decode_token
from app import socketio, db
from app.models import User, Lobby, LobbyParticipant, Character


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
    # При подключении клиент должен отправить токен и id лобби
    # Мы пока просто принимаем соединение
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

    # Проверяем, что пользователь состоит в этом лобби
    from app.models import LobbyParticipant
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant:
        emit('error', {'message': 'You are not in this lobby'})
        return

    # Сохраняем информацию о пользователе в сессии сокета
    # В SocketIO есть request.sid, можно хранить соответствие в словаре, но проще использовать комнаты
    join_room(f"lobby_{lobby_id}")
    emit('authenticated', {'username': user.username}, room=request.sid)
    # Уведомляем других, что пользователь подключился
    emit('user_joined', {'username': user.username}, room=f"lobby_{lobby_id}")

@socketio.on('send_message')
def handle_message(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    message = data.get('message')
    if not token or not lobby_id or not message:
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'})
        return

    # Проверяем, является ли сообщение командой
    if message.startswith('/roll'):
        parts = message.split(' ', 1)
        if len(parts) == 2:
            expression = parts[1]
            result, description = roll_dice(expression)
            if result is None:
                # Если ошибка, отправляем только автору?
                emit('new_message', {
                    'username': 'System',
                    'message': description,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                }, room=request.sid)  # только отправителю
                return
            else:
                # Отправляем результат всем
                emit('new_message', {
                    'username': user.username,
                    'message': f"/roll {expression}: {description}",
                    'timestamp': datetime.now(timezone.utc).isoformat()
                }, room=f"lobby_{lobby_id}")
                return
        else:
            emit('new_message', {
                'username': 'System',
                'message': "Использование: /roll 2d6+3",
                'timestamp': datetime.now(timezone.utc).isoformat()
            }, room=request.sid)
            return

    # Обычное сообщение
    emit('new_message', {
        'username': user.username,
        'message': message,
        'timestamp': datetime.now(timezone.utc).isoformat()
    }, room=f"lobby_{lobby_id}")

@socketio.on('disconnect')
def handle_disconnect():
    # При отключении можно удалить пользователя из комнат (но комнаты автоматически очищаются при отключении)
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

    skill_bonus = character.data.get('skills', {}).get(skill_name)
    if skill_bonus is None:
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