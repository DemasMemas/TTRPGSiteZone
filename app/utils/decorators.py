# app/utils/decorators.py
from functools import wraps
from flask import jsonify
from flask_jwt_extended import get_jwt_identity
from app.models import Lobby, LobbyParticipant
from app.services.exceptions import NotFoundError, PermissionDenied

def get_lobby_id_from_args(args, kwargs):
    """
    Извлекает lobby_id из аргументов функции.
    Ищет по имени 'lobby_id' в kwargs, затем в позиционных аргументах.
    Предполагается, что lobby_id – первый позиционный аргумент после self (если есть).
    """
    if 'lobby_id' in kwargs:
        return kwargs['lobby_id']
    # Если lobby_id не найден в kwargs, ищем в позиционных аргументах
    for arg in args:
        if isinstance(arg, int):
            # Если есть несколько int, может быть неверно, но мы полагаемся на соглашение
            return arg
    # Если функция имеет self, пропускаем его
    if args and hasattr(args[0], '__class__'):
        args = args[1:]
    for arg in args:
        if isinstance(arg, int):
            return arg
    raise ValueError("lobby_id not found in function arguments")

def requires_participant(f):
    """
    Декоратор, проверяющий, что текущий пользователь является участником лобби.
    В декорируемую функцию передаются дополнительные аргументы:
        lobby: объект Lobby
        participant: объект LobbyParticipant
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = int(get_jwt_identity())
        try:
            lobby_id = get_lobby_id_from_args(args, kwargs)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            return jsonify({'error': 'Lobby not found'}), 404

        participant = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, user_id=user_id
        ).first()
        if not participant:
            return jsonify({'error': 'You are not in this lobby'}), 403
        if participant.is_banned:
            return jsonify({'error': 'You are banned from this lobby'}), 403

        # Передаём lobby и participant в декорируемую функцию
        kwargs['lobby'] = lobby
        kwargs['participant'] = participant
        return f(*args, **kwargs)
    return decorated_function

def requires_gm(f):
    """
    Декоратор, проверяющий, что текущий пользователь является GM лобби.
    В декорируемую функцию передаётся дополнительный аргумент lobby.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        user_id = int(get_jwt_identity())
        try:
            lobby_id = get_lobby_id_from_args(args, kwargs)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            return jsonify({'error': 'Lobby not found'}), 404

        if lobby.gm_id != user_id:
            return jsonify({'error': 'You are not the GM of this lobby'}), 403

        kwargs['lobby'] = lobby
        return f(*args, **kwargs)
    return decorated_function