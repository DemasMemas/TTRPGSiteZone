# app/services/participant.py
import logging
from app.extensions import db
from app.models import Lobby, LobbyParticipant
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError

logger = logging.getLogger(__name__)

class ParticipantService:
    @staticmethod
    def join_lobby(user_id, lobby_id):
        """Добавляет пользователя в комнату (если он уже не участник)."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            raise NotFoundError("Lobby not found")

        # Проверяем, не забанен ли
        banned = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, user_id=user_id, is_banned=True
        ).first()
        if banned:
            raise PermissionDenied("You are banned from this lobby")

        participant = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, user_id=user_id
        ).first()
        if participant:
            # Уже участник – считаем успехом
            logger.info(f"User {user_id} already in lobby {lobby_id}")
            return participant

        participant = LobbyParticipant(lobby_id=lobby_id, user_id=user_id)
        db.session.add(participant)
        db.session.commit()
        logger.info(f"User {user_id} joined lobby {lobby_id}")
        return participant

    @staticmethod
    def leave_lobby(user_id, lobby_id):
        """Пользователь покидает комнату."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            raise NotFoundError("Lobby not found")

        participant = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, user_id=user_id
        ).first()
        if not participant:
            raise NotFoundError("You are not in this lobby")

        db.session.delete(participant)
        db.session.commit()
        logger.info(f"User {user_id} left lobby {lobby_id}")

    @staticmethod
    def ban_user(gm_id, lobby_id, target_user_id):
        """ГМ банит участника."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            raise NotFoundError("Lobby not found")

        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can ban participants")

        if target_user_id == gm_id:
            raise ValidationError("Cannot ban yourself")

        participant = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, user_id=target_user_id
        ).first()
        if not participant:
            raise NotFoundError("User is not in this lobby")

        participant.is_banned = True
        db.session.commit()
        logger.warning(f"User {target_user_id} banned from lobby {lobby_id} by GM {gm_id}")

        # Импортируем функцию кика из сокетов
        from app.sockets.kick import kick_user
        kick_user(target_user_id, lobby_id)

        return participant

    @staticmethod
    def unban_user(gm_id, lobby_id, target_user_id):
        """ГМ разбанивает участника."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            raise NotFoundError("Lobby not found")

        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can unban participants")

        participant = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, user_id=target_user_id
        ).first()
        if not participant:
            raise NotFoundError("User not found in lobby")

        if not participant.is_banned:
            raise ValidationError("User is not banned")

        participant.is_banned = False
        db.session.commit()
        logger.info(f"User {target_user_id} unbanned from lobby {lobby_id} by GM {gm_id}")

    @staticmethod
    def get_banned_list(gm_id, lobby_id):
        """Возвращает список забаненных пользователей."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            raise NotFoundError("Lobby not found")

        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can view banned list")

        banned = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, is_banned=True
        ).all()
        logger.debug(f"Banned list requested for lobby {lobby_id} by GM {gm_id}, count={len(banned)}")
        return [{'user_id': p.user_id, 'username': p.user.username} for p in banned]