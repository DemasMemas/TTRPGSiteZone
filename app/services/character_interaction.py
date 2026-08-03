import random
from copy import deepcopy
from datetime import datetime, timezone

from sqlalchemy.orm.attributes import flag_modified

from app.extensions import db
from app.models import CharacterInteractionRequest, LocationCombatState
from app.models.location_character import LocationCharacter
from app.services.combat import CombatService
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError


class CharacterInteractionService:
    OPEN_STATUSES = {'pending', 'accepted', 'forced', 'in_progress'}

    @staticmethod
    def _controlled_by(location_character, user_id, is_gm=False):
        if is_gm:
            return True
        character = location_character.character
        return bool(
            location_character.controlled_by == user_id
            or (character and character.owner_id == user_id)
        )

    @staticmethod
    def _pair(location_id, user_id, actor_location_character_id, target_character_id):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
        actor = LocationCharacter.query.filter_by(
            id=actor_location_character_id,
            location_id=location_id,
        ).first()
        target = LocationCharacter.query.filter_by(
            character_id=target_character_id,
            location_id=location_id,
        ).first()
        if not actor or not target or actor.id == target.id:
            raise NotFoundError('Interaction target not found')
        if not CharacterInteractionService._controlled_by(actor, user_id, is_gm):
            raise PermissionDenied('You do not control the acting character')
        CombatService.ensure_character_can_act(actor)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if state and state.status == 'active' and state.current_location_character_id != actor.id:
            raise PermissionDenied("It is not this character's turn")
        if state and state.status == 'active' and not CombatService._is_adjacent(actor, target):
            raise ValidationError('The target must be in an adjacent tile')
        return location, actor, target

    @staticmethod
    def _target_user_id(location, target):
        return (
            target.controlled_by
            or (target.character.owner_id if target.character else None)
            or location.lobby.gm_id
        )

    @staticmethod
    def _serialize(request_row):
        actor = db.session.get(LocationCharacter, request_row.actor_location_character_id)
        target = db.session.get(LocationCharacter, request_row.target_location_character_id)
        serialized = {
            'id': request_row.id,
            'location_id': request_row.location_id,
            'kind': request_row.kind,
            'status': request_row.status,
            'actor_location_character_id': request_row.actor_location_character_id,
            'actor_character_id': actor.character_id if actor else None,
            'actor_name': actor.character.name if actor and actor.character else 'Персонаж',
            'target_location_character_id': request_row.target_location_character_id,
            'target_character_id': target.character_id if target else None,
            'target_name': target.character.name if target and target.character else 'Персонаж',
            'actor_user_id': request_row.actor_user_id,
            'target_user_id': request_row.target_user_id,
            'payload': request_row.payload or {},
            'result': request_row.result or {},
        }
        if request_row.kind == 'trade':
            serialized['actor_data'] = deepcopy(
                actor.character.data
                if actor and actor.character and isinstance(actor.character.data, dict)
                else {}
            )
            serialized['target_data'] = deepcopy(
                target.character.data
                if target and target.character and isinstance(target.character.data, dict)
                else {}
            )
        return serialized

    @staticmethod
    def interaction_snapshot(location_id, user_id, actor_location_character_id, target_character_id):
        _, actor, target = CharacterInteractionService._pair(
            location_id,
            user_id,
            actor_location_character_id,
            target_character_id,
        )
        condition = CombatService._location_character_condition(target)
        return CombatService._incapacitated_character_snapshot(actor, target, condition)

    @staticmethod
    def create_request(
        location_id,
        user_id,
        actor_location_character_id,
        target_character_id,
        kind,
        payload=None,
    ):
        if kind not in {'treatment', 'trade'}:
            raise ValidationError('Unknown interaction type')
        location, actor, target = CharacterInteractionService._pair(
            location_id,
            user_id,
            actor_location_character_id,
            target_character_id,
        )
        if CombatService._location_character_condition(target)['state'] != 'active':
            raise ValidationError('Consent is only required from a conscious character')
        target_user_id = CharacterInteractionService._target_user_id(location, target)
        clean_payload = deepcopy(payload) if isinstance(payload, dict) else {}
        request_row = CharacterInteractionRequest(
            location_id=location_id,
            actor_location_character_id=actor.id,
            target_location_character_id=target.id,
            actor_user_id=user_id,
            target_user_id=target_user_id,
            kind=kind,
            status='accepted' if target_user_id == user_id else 'pending',
            payload=clean_payload,
        )
        db.session.add(request_row)
        db.session.flush()
        if request_row.status == 'accepted' and kind == 'trade':
            CharacterInteractionService._complete_trade(request_row)
        else:
            db.session.commit()
        return CharacterInteractionService._serialize(request_row)

    @staticmethod
    def _strength_roll(location_character):
        data = (
            location_character.character.data
            if location_character.character and isinstance(location_character.character.data, dict)
            else {}
        )
        bonus = CombatService._skill_modifier(data, 'skills.physical.strength')
        die = random.randint(1, 20)
        return {'roll': die, 'bonus': bonus, 'total': die + bonus}

    @staticmethod
    def respond(request_id, user_id, decision):
        request_row = db.session.get(CharacterInteractionRequest, request_id)
        if not request_row or request_row.status != 'pending':
            raise NotFoundError('Interaction request is no longer pending')
        location = CombatService._get_location(request_row.location_id)
        is_gm = location.lobby.gm_id == user_id
        target = db.session.get(LocationCharacter, request_row.target_location_character_id)
        if not target or not CharacterInteractionService._controlled_by(target, user_id, is_gm):
            raise PermissionDenied('You do not control the target character')
        actor = db.session.get(LocationCharacter, request_row.actor_location_character_id)
        state = LocationCombatState.query.filter_by(location_id=request_row.location_id).first()
        if not actor or (
            state
            and state.status == 'active'
            and not CombatService._is_adjacent(actor, target)
        ):
            raise ValidationError('The characters are no longer adjacent')

        accepted = str(decision).lower() == 'accept'
        result = {'decision': 'accept' if accepted else 'decline'}
        if accepted:
            request_row.status = 'accepted'
        elif request_row.kind == 'treatment':
            actor_roll = CharacterInteractionService._strength_roll(actor)
            target_roll = CharacterInteractionService._strength_roll(target)
            forced = actor_roll['total'] > target_roll['total']
            request_row.status = 'forced' if forced else 'rejected'
            result.update({
                'forced': forced,
                'actor_strength': actor_roll,
                'target_strength': target_roll,
            })
        else:
            request_row.status = 'rejected'
        request_row.result = result
        request_row.resolved_at = datetime.now(timezone.utc)
        if request_row.status == 'accepted' and request_row.kind == 'trade':
            CharacterInteractionService._complete_trade(request_row)
        else:
            db.session.commit()
        return CharacterInteractionService._serialize(request_row)

    @staticmethod
    def _resolve_item_path(character_data, item_id, fallback_path):
        def walk(value, path):
            if isinstance(value, list):
                for index, item in enumerate(value):
                    if isinstance(item, dict) and item_id is not None and item.get('id') == item_id:
                        return path + [index]
                    found = walk(item, path + [index])
                    if found:
                        return found
            elif isinstance(value, dict):
                for key, child in value.items():
                    if key in {'inventory', 'equipment', 'contents', 'pouches', 'backpack', 'pockets'}:
                        found = walk(child, path + [key])
                        if found:
                            return found
            return None

        if item_id is not None:
            found = walk(character_data, [])
            if found:
                return found
        return list(fallback_path or [])

    @staticmethod
    def _apply_offer(source_data, target_data, offer):
        moved = []
        normalized = []
        for entry in offer or []:
            if not isinstance(entry, dict):
                continue
            path = CharacterInteractionService._resolve_item_path(
                source_data,
                entry.get('item_id'),
                entry.get('path'),
            )
            normalized.append((path, max(1, int(entry.get('amount') or 1))))
        normalized.sort(
            key=lambda value: tuple(
                (1, part) if isinstance(part, int) else (0, str(part))
                for part in value[0]
            ),
            reverse=True,
        )
        for path, amount in normalized:
            item = CombatService._take_inventory_item(source_data, path, amount)
            target_inventory = target_data.setdefault('inventory', {})
            backpack = target_inventory.setdefault('backpack', [])
            if not isinstance(backpack, list):
                backpack = []
                target_inventory['backpack'] = backpack
            backpack.append(item)
            moved.append({'name': item.get('name', 'Предмет'), 'amount': item.get('quantity', 1)})
        return moved

    @staticmethod
    def _complete_trade(request_row):
        actor = db.session.get(LocationCharacter, request_row.actor_location_character_id)
        target = db.session.get(LocationCharacter, request_row.target_location_character_id)
        state = LocationCombatState.query.filter_by(location_id=request_row.location_id).first()
        if not actor or not target or (
            state
            and state.status == 'active'
            and not CombatService._is_adjacent(actor, target)
        ):
            raise ValidationError('The characters are no longer adjacent')
        CombatService.ensure_character_can_act(actor)
        if state and state.status == 'active':
            if state.current_location_character_id != actor.id:
                raise PermissionDenied("It is not this character's turn")
            if actor.action_points_current < 2:
                raise ValidationError('Not enough action points for trade')

        actor_data = deepcopy(actor.character.data or {})
        target_data = deepcopy(target.character.data or {})
        payload = request_row.payload or {}
        actor_moved = CharacterInteractionService._apply_offer(
            actor_data,
            target_data,
            payload.get('actor_offer'),
        )
        target_moved = CharacterInteractionService._apply_offer(
            target_data,
            actor_data,
            payload.get('target_offer'),
        )
        if state and state.status == 'active':
            actor.action_points_current -= 2
            CombatService._clear_aim(actor)
        actor.character.data = actor_data
        target.character.data = target_data
        flag_modified(actor.character, 'data')
        flag_modified(target.character, 'data')
        request_row.status = 'completed'
        request_row.result = {
            **(request_row.result or {}),
            'action_points': 2 if state and state.status == 'active' else 0,
            'actor_to_target': actor_moved,
            'target_to_actor': target_moved,
        }
        request_row.resolved_at = datetime.now(timezone.utc)
        db.session.commit()

    @staticmethod
    def mark_treatment_in_progress(request_id, user_id, pending_action_id=None):
        request_row = db.session.get(CharacterInteractionRequest, request_id)
        if not request_row or request_row.kind != 'treatment':
            raise NotFoundError('Treatment request not found')
        if request_row.actor_user_id != user_id or request_row.status not in {'accepted', 'forced'}:
            raise PermissionDenied('Treatment request cannot be started')
        request_row.status = 'in_progress'
        request_row.payload = {
            **(request_row.payload or {}),
            'pending_action_id': str(pending_action_id or ''),
        }
        flag_modified(request_row, 'payload')
        db.session.commit()
        return CharacterInteractionService._serialize(request_row)

    @staticmethod
    def complete_treatment(request_id, user_id):
        request_row = db.session.get(CharacterInteractionRequest, request_id)
        if not request_row or request_row.kind != 'treatment':
            raise NotFoundError('Treatment request not found')
        if request_row.actor_user_id != user_id:
            raise PermissionDenied('Treatment request does not belong to this user')
        if request_row.status not in {'accepted', 'forced', 'in_progress'}:
            raise ValidationError('Treatment request is not active')
        request_row.status = 'completed'
        request_row.resolved_at = datetime.now(timezone.utc)
        db.session.commit()
        return CharacterInteractionService._serialize(request_row)

    @staticmethod
    def validate_treatment(request_id, actor, target):
        request_row = db.session.get(CharacterInteractionRequest, request_id)
        if not request_row or request_row.kind != 'treatment':
            raise NotFoundError('Treatment consent not found')
        if (
            request_row.actor_location_character_id != actor.id
            or request_row.target_location_character_id != target.id
            or request_row.status not in {'accepted', 'forced', 'in_progress'}
        ):
            raise PermissionDenied('Treatment was not authorized')
        return request_row

    @staticmethod
    def movement_locked(location_character_id):
        request_row = CharacterInteractionRequest.query.filter(
            CharacterInteractionRequest.target_location_character_id == location_character_id,
            CharacterInteractionRequest.kind == 'treatment',
            CharacterInteractionRequest.status == 'in_progress',
        ).first()
        if not request_row:
            return False
        actor = db.session.get(LocationCharacter, request_row.actor_location_character_id)
        actor_data = actor.character.data if actor and actor.character and isinstance(actor.character.data, dict) else {}
        pending_action = ((actor_data.get('health') or {}).get('combatMeta') or {}).get('pendingAction') or {}
        expected_id = str((request_row.payload or {}).get('pending_action_id') or '')
        if expected_id and str(pending_action.get('id') or '') == expected_id:
            return True
        request_row.status = 'cancelled'
        request_row.resolved_at = datetime.now(timezone.utc)
        db.session.commit()
        return False
