# app/sockets/utils.py
import logging
from flask_jwt_extended import decode_token
from app.models import User

logger = logging.getLogger(__name__)

def get_user_from_token(token):
    """Вспомогательная функция для получения пользователя по JWT-токену."""
    try:
        decoded = decode_token(token)
        user_id = decoded['sub']
        return User.query.get(user_id)
    except Exception as e:
        logger.error(f"Token decode error: {e}")
        return None