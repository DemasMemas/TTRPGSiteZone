# app/sockets/auth.py
import logging
from flask import request
from flask_socketio import join_room, leave_room, emit
from app.extensions import socketio, db
from app.models import LobbyParticipant, ChatMessage
from .utils import get_user_from_token

logger = logging.getLogger(__name__)

# Глобальные словари для отслеживания подключений
sid_to_user = {}
user_lobby = {}

@socketio.on('connect')
def handle_connect():
    logger.info('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    user_id = sid_to_user.pop(request.sid, None)
    if user_id:
        lobby_id = user_lobby.pop(user_id, None)
        if lobby_id:
            emit('user_left', {'user_id': user_id}, room=f"lobby_{lobby_id}")
            logger.info(f"User {user_id} left lobby {lobby_id}")
    logger.info('Client disconnected')

@socketio.on('authenticate')
def handle_authenticate(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    if not token or not lobby_id:
        return

    user = get_user_from_token(token)
    if not user:
        logger.warning("Authentication failed: invalid token")
        emit('error', {'message': 'Invalid token'})
        return

    # Проверяем, не забанен ли пользователь
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant:
        logger.warning(f"User {user.id} tried to authenticate in lobby {lobby_id} but is not a participant")
        emit('error', {'message': 'You are not in this lobby'})
        return
    if participant.is_banned:
        logger.warning(f"Banned user {user.id} tried to authenticate in lobby {lobby_id}")
        emit('error', {'message': 'You are banned from this lobby'})
        return

    # Сохраняем информацию о подключении
    sid_to_user[request.sid] = user.id
    user_lobby[user.id] = lobby_id

    join_room(f"lobby_{lobby_id}")
    join_room(f"user_{user.id}")  # личная комната для кика

    emit('authenticated', {'username': user.username}, room=request.sid)
    logger.info(f"User {user.id} ({user.username}) authenticated in lobby {lobby_id}")

    # Оповещаем всех в лобби о новом участнике
    emit('user_joined', {'user_id': user.id, 'username': user.username}, room=f"lobby_{lobby_id}")

    # Отправляем новому участнику список текущих онлайн-пользователей
    online_users = [uid for uid, lid in user_lobby.items() if lid == lobby_id]
    emit('online_users', online_users, room=request.sid)

    # Загружаем историю чата
    messages = ChatMessage.query.filter_by(lobby_id=lobby_id).order_by(ChatMessage.timestamp.desc()).limit(50).all()
    messages.reverse()
    history = [{'username': msg.username, 'message': msg.message, 'timestamp': msg.timestamp.isoformat()} for msg in messages]
    emit('chat_history', history, room=request.sid)

# Функция для кика (вызывается из сервиса участников)
def kick_user(user_id, lobby_id):
    logger.info(f"Kicking user {user_id} from lobby {lobby_id}")
    socketio.emit('kicked', {'reason': 'banned'}, room=f"user_{user_id}")