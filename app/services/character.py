# app/services/character.py
from app.extensions import db
from app.models import LobbyCharacter, Lobby, LobbyParticipant
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError


class CharacterService:
    @staticmethod
    def create_character(lobby_id, owner_id, name, data=None):
        """Создаёт нового персонажа в лобби."""
        # Проверяем, что пользователь участник лобби
        participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=owner_id).first()
        if not participant:
            raise PermissionDenied("You are not in this lobby")

        character = LobbyCharacter(
            lobby_id=lobby_id,
            owner_id=owner_id,
            name=name,
            data=data or {},
            visible_to=[]
        )
        db.session.add(character)
        db.session.commit()
        return character

    @staticmethod
    def get_character(character_id, user_id):
        """Получение персонажа по ID (с проверкой доступа)."""
        character = LobbyCharacter.query.get(character_id)
        if not character:
            raise NotFoundError("Character not found")

        # Проверяем, что пользователь в том же лобби
        participant = LobbyParticipant.query.filter_by(
            lobby_id=character.lobby_id, user_id=user_id
        ).first()
        if not participant:
            raise PermissionDenied("Access denied")

        return character

    @staticmethod
    def update_character(character_id, user_id, updates):
        """Обновление персонажа (владелец или GM)."""
        character = LobbyCharacter.query.get(character_id)
        if not character:
            raise NotFoundError("Character not found")

        lobby = Lobby.query.get(character.lobby_id)
        if character.owner_id != user_id and lobby.gm_id != user_id:
            raise PermissionDenied("Permission denied")

        if 'name' in updates:
            character.name = updates['name']
        if 'data' in updates:
            character.data = updates['data']
        db.session.commit()
        return character

    @staticmethod
    def delete_character(character_id, user_id):
        """Удаление персонажа (владелец или GM)."""
        character = LobbyCharacter.query.get(character_id)
        if not character:
            raise NotFoundError("Character not found")

        lobby = Lobby.query.get(character.lobby_id)
        if character.owner_id != user_id and lobby.gm_id != user_id:
            raise PermissionDenied("Permission denied")

        db.session.delete(character)
        db.session.commit()

    @staticmethod
    def get_lobby_characters(lobby_id, user_id):
        """Возвращает список персонажей в лобби, видимых пользователю."""
        # Проверяем участие
        participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
        if not participant:
            raise PermissionDenied("You are not in this lobby")

        lobby = Lobby.query.get(lobby_id)
        is_gm = (lobby.gm_id == user_id)

        characters = LobbyCharacter.query.filter_by(lobby_id=lobby_id).all()
        result = []
        for c in characters:
            if c.owner_id == user_id or is_gm or user_id in c.visible_to:
                result.append({
                    'id': c.id,
                    'name': c.name,
                    'owner_id': c.owner_id,
                    'owner_username': c.owner.username,
                    'data': c.data,
                    'visible_to': c.visible_to,
                    'created_at': c.created_at,
                    'updated_at': c.updated_at
                })
        return result

    @staticmethod
    def set_visibility(character_id, gm_id, visible_to):
        """Устанавливает видимость персонажа (только GM)."""
        character = LobbyCharacter.query.get(character_id)
        if not character:
            raise NotFoundError("Character not found")

        lobby = Lobby.query.get(character.lobby_id)
        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can change visibility")

        if not isinstance(visible_to, list):
            raise ValidationError("visible_to must be a list")

        character.visible_to = visible_to
        db.session.commit()
        return character