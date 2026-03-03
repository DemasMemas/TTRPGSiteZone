# app/sockets/utils.py
from flask_jwt_extended import decode_token
from app.models import User

def get_user_from_token(token):
    """Вспомогательная функция для получения пользователя по JWT-токену."""
    try:
        decoded = decode_token(token)
        user_id = decoded['sub']
        return User.query.get(user_id)
    except Exception:
        return None