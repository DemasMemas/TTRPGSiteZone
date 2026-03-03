# app/sockets/auth.py
from flask import request
from flask_socketio import join_room, leave_room, emit
from app.extensions import socketio, db
from app.models import LobbyParticipant, ChatMessage
from .utils import get_user_from_token

# Глобальные словари для отслеживания подключений
sid_to_user = {}
user_lobby = {}

@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    user_id = sid_to_user.pop(request.sid, None)
    if user_id:
        lobby_id = user_lobby.pop(user_id, None)
        if lobby_id:
            emit('user_left', {'user_id': user_id}, room=f"lobby_{lobby_id}")
    print('Client disconnected')

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

    # Загружаем историю чата
    messages = ChatMessage.query.filter_by(lobby_id=lobby_id).order_by(ChatMessage.timestamp.desc()).limit(50).all()
    messages.reverse()
    history = [{'username': msg.username, 'message': msg.message, 'timestamp': msg.timestamp.isoformat()} for msg in messages]
    emit('chat_history', history, room=request.sid)

# Функция для кика (вызывается из сервиса участников)
def kick_user(user_id, lobby_id):
    socketio.emit('kicked', {'reason': 'banned'}, room=f"user_{user_id}")