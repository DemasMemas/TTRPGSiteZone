# app/sockets/chat.py
from datetime import datetime, timezone

from flask import request
from flask_socketio import emit
from app.extensions import socketio, db
from app.models import ChatMessage
from .utils import get_user_from_token
from app.utils.dice import roll_dice as roll_dice_util

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
            result, description = roll_dice_util(expression)
            if result is None:
                # Ошибка в выражении — показываем только отправителю
                emit('new_message', {
                    'username': 'System',
                    'message': description,
                    'timestamp': datetime.now(timezone.utc).isoformat()
                }, room=request.sid)
                return
            else:
                final_text = f"/roll {expression}: {description}"
        else:
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