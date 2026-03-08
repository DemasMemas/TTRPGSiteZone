# app/services/character.py
import logging
from sqlalchemy.orm import joinedload
from app.extensions import db
from app.models import LobbyCharacter, Lobby, LobbyParticipant
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError

logger = logging.getLogger(__name__)

class CharacterService:
    @staticmethod
    def create_character(lobby_id, owner_id, name, data=None):
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
        db.session.refresh(character, attribute_names=['owner'])
        logger.info(f"Character '{name}' (id={character.id}) created by user {owner_id} in lobby {lobby_id}")
        return character

    @staticmethod
    def get_character(character_id, user_id):
        """Получение персонажа по ID (с проверкой доступа)."""
        character = LobbyCharacter.query.get(character_id)
        if not character:
            raise NotFoundError("Character not found")

        # Проверяем, что пользователь в той же комнате
        participant = LobbyParticipant.query.filter_by(
            lobby_id=character.lobby_id, user_id=user_id
        ).first()
        if not participant:
            raise PermissionDenied("Access denied")

        return character

    @staticmethod
    def update_character(character_id, user_id, updates):
        """Обновление персонажа (любой участник лобби может менять поля, кроме visible_to)."""
        character = LobbyCharacter.query.get(character_id)
        if not character:
            raise NotFoundError("Character not found")

        # Проверяем, что пользователь вообще в лобби
        participant = LobbyParticipant.query.filter_by(
            lobby_id=character.lobby_id, user_id=user_id
        ).first()
        if not participant:
            raise PermissionDenied("You are not in this lobby")

        lobby = Lobby.query.get(character.lobby_id)

        # Если пытаются изменить visible_to, проверяем права (только владелец или GM)
        if 'visible_to' in updates:
            if character.owner_id != user_id and lobby.gm_id != user_id:
                raise PermissionDenied("Only owner or GM can change visibility")
            character.visible_to = list(updates['visible_to'])

        # Разрешаем обновление остальных полей
        if 'name' in updates:
            character.name = updates['name']
        if 'data' in updates:
            # Можно разрешить менять data всем
            character.data = updates['data']

        db.session.commit()
        logger.info(f"Character {character_id} updated by user {user_id}")
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
        logger.info(f"Character {character_id} deleted by user {user_id}")

    @staticmethod
    def get_lobby_characters(lobby_id, user_id):
        """Возвращает список персонажей в комнаты, видимых пользователю."""
        participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
        if not participant:
            raise PermissionDenied("You are not in this lobby")

        lobby = Lobby.query.get(lobby_id)
        is_gm = (lobby.gm_id == user_id)

        # Явно загружаем связанного владельца
        characters = LobbyCharacter.query.filter_by(lobby_id=lobby_id).options(
            joinedload(LobbyCharacter.owner)
        ).all()

        result = []
        for c in characters:
            if c.owner_id == user_id or is_gm or user_id in c.visible_to:
                result.append(c)
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

        character.visible_to = list(visible_to)
        db.session.commit()
        logger.info(f"Visibility of character {character_id} set to {visible_to} by GM {gm_id}")
        return character