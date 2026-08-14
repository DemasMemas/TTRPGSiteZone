# app/services/character.py
import logging
from collections import Counter
from sqlalchemy.orm import joinedload
from app.extensions import db
from app.models import LobbyCharacter, Lobby, LobbyParticipant, LocationCharacter
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError
from app.services.health import apply_health_maximums, health_zones_to_location
from app.services.inventory import normalize_inventory_ammo_stacks

logger = logging.getLogger(__name__)

class CharacterService:
    @staticmethod
    def _item_totals(character_data):
        """Count item quantities regardless of their current container or slot."""
        totals = Counter()

        def visit(value):
            if isinstance(value, list):
                for item in value:
                    visit(item)
                return
            if not isinstance(value, dict):
                return

            template_id = value.get('templateId')
            looks_like_item = (
                template_id is not None
                or (
                    value.get('id')
                    and any(key in value for key in ('category', 'weight', 'volume', 'quantity'))
                )
            )
            if looks_like_item:
                if template_id is not None:
                    key = f"template:{template_id}"
                else:
                    key = (
                        f"custom:{value.get('category', '')}:"
                        f"{str(value.get('name', '')).strip().casefold()}"
                    )
                try:
                    quantity = float(value.get('quantity', 1) or 0)
                except (TypeError, ValueError):
                    quantity = 1
                totals[key] += max(0, quantity)

            for nested in value.values():
                visit(nested)

        visit(character_data if isinstance(character_data, dict) else {})
        return totals

    @staticmethod
    def mark_added_items_as_player_created(current_data, updated_data):
        """Mark quantities introduced by a player without flagging moved items."""
        remaining = CharacterService._item_totals(current_data)

        def visit(value):
            if isinstance(value, list):
                for item in value:
                    visit(item)
                return
            if not isinstance(value, dict):
                return

            template_id = value.get('templateId')
            looks_like_item = (
                template_id is not None
                or (
                    value.get('id')
                    and any(key in value for key in ('category', 'weight', 'volume', 'quantity'))
                )
            )
            if looks_like_item:
                key = (
                    f"template:{template_id}"
                    if template_id is not None
                    else (
                        f"custom:{value.get('category', '')}:"
                        f"{str(value.get('name', '')).strip().casefold()}"
                    )
                )
                try:
                    quantity = max(0, float(value.get('quantity', 1) or 0))
                except (TypeError, ValueError):
                    quantity = 1
                existing_quantity = max(0, remaining.get(key, 0))
                if quantity > existing_quantity:
                    value['createdByPlayer'] = True
                remaining[key] = max(0, existing_quantity - quantity)

            for nested in value.values():
                visit(nested)

        visit(updated_data if isinstance(updated_data, dict) else {})
        return updated_data

    @staticmethod
    def create_character(lobby_id, owner_id, name, data=None):
        participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=owner_id).first()
        if not participant:
            raise PermissionDenied("You are not in this lobby")

        character_data = dict(data or {})
        normalize_inventory_ammo_stacks(character_data)
        apply_health_maximums(character_data)
        character = LobbyCharacter(
            lobby_id=lobby_id,
            owner_id=owner_id,
            name=name,
            data=character_data,
            visible_to=[],
            editable_to=[],
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

        lobby = Lobby.query.get(character.lobby_id)
        participant = LobbyParticipant.query.filter_by(
            lobby_id=character.lobby_id, user_id=user_id
        ).first()
        if not participant:
            raise PermissionDenied("Access denied")
        is_controller = LocationCharacter.query.filter_by(
            character_id=character_id,
            controlled_by=user_id,
        ).first() is not None
        if (
            character.owner_id != user_id
            and lobby.gm_id != user_id
            and user_id not in (character.visible_to or [])
            and user_id not in (character.editable_to or [])
            and not is_controller
        ):
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
        is_controller = LocationCharacter.query.filter_by(
            character_id=character.id,
            controlled_by=user_id,
        ).first() is not None
        if (
            character.owner_id != user_id
            and lobby.gm_id != user_id
            and user_id not in (character.editable_to or [])
            and not is_controller
        ):
            raise PermissionDenied("Only owner or GM can update character")

        is_gm = lobby.gm_id == user_id

        # Видимость персонажей является инструментом ведущего.
        if 'visible_to' in updates:
            if not is_gm:
                raise PermissionDenied("Only GM can change visibility")
            character.visible_to = list(updates['visible_to'])

        # Разрешаем обновление остальных полей
        if 'name' in updates:
            character.name = updates['name']
        if 'data' in updates:
            character_data = dict(updates['data'] or {})
            normalize_inventory_ammo_stacks(character_data)
            if not is_gm:
                CharacterService.mark_added_items_as_player_created(
                    character.data,
                    character_data,
                )
            health = apply_health_maximums(character_data)
            character.data = character_data
            for loc_char in LocationCharacter.query.filter_by(character_id=character.id).all():
                loc_char.hp_zones = health_zones_to_location(health)

        db.session.commit()
        logger.debug("Character %s updated by user %s", character_id, user_id)
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

        # Location entries reference the character without database-level cascade.
        LocationCharacter.query.filter_by(character_id=character.id).delete(
            synchronize_session=False
        )
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
            if c.owner_id == user_id or is_gm or user_id in (c.visible_to or []) or user_id in (c.editable_to or []):
                result.append(c)
        return result

    @staticmethod
    def set_visibility(character_id, gm_id, visible_to, editable_to=None):
        """Устанавливает видимость и право редактирования персонажа (только GM)."""
        character = LobbyCharacter.query.get(character_id)
        if not character:
            raise NotFoundError("Character not found")

        lobby = Lobby.query.get(character.lobby_id)
        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can change visibility")

        if not isinstance(visible_to, list):
            raise ValidationError("visible_to must be a list")
        if editable_to is None:
            editable_to = character.editable_to or []
        if not isinstance(editable_to, list):
            raise ValidationError("editable_to must be a list")

        editable = list(dict.fromkeys(int(user_id) for user_id in editable_to))
        character.editable_to = editable
        character.visible_to = list(dict.fromkeys([
            *(int(user_id) for user_id in visible_to),
            *editable,
        ]))
        db.session.commit()
        logger.info(
            "Access of character %s set to visible=%s editable=%s by GM %s",
            character_id, character.visible_to, editable, gm_id,
        )
        return character
