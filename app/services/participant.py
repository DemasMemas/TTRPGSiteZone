# app/services/participant.py
from app.extensions import db
from app.models import Lobby, LobbyParticipant
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError

class ParticipantService:
    @staticmethod
    def join_lobby(user_id, lobby_id):
        """Добавляет пользователя в лобби (если он уже не участник)."""
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
            return participant

        participant = LobbyParticipant(lobby_id=lobby_id, user_id=user_id)
        db.session.add(participant)
        db.session.commit()
        return participant

    @staticmethod
    def leave_lobby(user_id, lobby_id):
        """Пользователь покидает лобби (GM не может покинуть)."""
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

        # Импортируем функцию кика здесь, чтобы избежать циклического импорта
        from app.socket_events import kick_user
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
        return [{'user_id': p.user_id, 'username': p.user.username} for p in banned]