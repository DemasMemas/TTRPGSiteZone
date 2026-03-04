# app/sockets/kick.py
import logging
from flask_socketio import emit
from app.extensions import socketio

logger = logging.getLogger(__name__)

def kick_user(user_id, lobby_id):
    """Отправляет сигнал о кике пользователю."""
    logger.info(f"Kicking user {user_id} from lobby {lobby_id}")
    socketio.emit('kicked', {'reason': 'banned'}, room=f"user_{user_id}")