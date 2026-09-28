from app.extensions import db
from app.models import LobbyCharacter, LocationCharacter
from app.services.character import CharacterService
from app.services.character_interaction import CharacterInteractionService
from app.services.character_merge import merge_sheet_data
from app.services.combat import CombatService
from app.services.exceptions import ConflictError, NotFoundError, ValidationError
from app.services.transaction import atomic_operation
from app.services.consumable_use import apply_consumable_use, validate_consumable_use
from app.services.deferred_consumable import claim_completion, finish_completion


class TreatmentService:
    @staticmethod
    @atomic_operation
    def finish(location_id, user_id, target_id, payload):
        actor = LocationCharacter.query.filter_by(
            id=payload.get('actor_location_character_id'), location_id=location_id,
        ).first()
        target = LocationCharacter.query.filter_by(character_id=target_id, location_id=location_id).first()
        if not actor or not target or actor.id == target.id:
            raise NotFoundError('Interaction target not found')
        CharacterService.check_access(actor.character, user_id, edit=True)
        completion = claim_completion(actor.character, target.character, user_id, payload.get('consumable_use'), payload.get('interaction_request_id'))
        validate_consumable_use(actor.character, payload.get('consumable_use'))
        if not isinstance(payload.get('actor_updates'), dict) or not isinstance(payload['actor_updates'].get('data'), dict):
            raise ValidationError('Doctor update is required')
        revision = payload.get('target_revision')
        health = payload.get('health')
        if not isinstance(health, dict):
            raise ValidationError('Health data is required')
        if type(revision) is not int or revision <= 0 or revision > target.character.revision:
            raise ConflictError()
        if revision != target.character.revision:
            base = payload.get('target_base_health')
            if not isinstance(base, dict):
                raise ConflictError()
            health = merge_sheet_data(base, health, (target.character.data or {}).get('health', {}))
        # Consent, consciousness, turn and distance checks remain in the combat service.
        CombatService.update_incapacitated_character_health(
            location_id, user_id, actor.id, target_id, health,
            payload.get('interaction_request_id'), commit=False,
        )
        result = CharacterService.update_character(actor.character_id, user_id, payload['actor_updates'], commit=False)
        CharacterService.sync_location_health(target.character, target.character.data['health'])
        interaction = None
        if payload.get('interaction_request_id'):
            # A GM may finish the doctor's saved procedure after a reconnect.
            consent_user = user_id
            if completion:
                consent_user = CharacterInteractionService.validate_treatment(
                    payload['interaction_request_id'], actor, target,
                ).actor_user_id
            interaction = CharacterInteractionService.complete_treatment(
                payload['interaction_request_id'], consent_user, commit=False,
            )
        use_result = apply_consumable_use(actor.character, target.character, payload.get('consumable_use'), location_id=location_id)
        finish_completion(actor.character, completion)
        return result, target, interaction, use_result

    @staticmethod
    @atomic_operation
    def finish_sheets(user_id, target_id, payload):
        for key in ('actor_updates', 'target_updates'):
            if not isinstance(payload.get(key), dict) or not isinstance(payload[key].get('data'), dict):
                raise ValidationError('Character data is required')
        actor_id = payload.get('actor_character_id')
        target = db.session.get(LobbyCharacter, target_id)
        actor = db.session.get(LobbyCharacter, actor_id) if type(actor_id) is int else None
        if not actor or not target or actor.id == target.id or actor.lobby_id != target.lobby_id:
            raise ValidationError('Invalid treatment pair')
        CharacterService.check_access(actor, user_id, edit=True)
        CharacterService.check_access(target, user_id, edit=True)
        completion = claim_completion(actor, target, user_id, payload.get('consumable_use'))
        validate_consumable_use(actor, payload.get('consumable_use'))
        # This fallback is only for users already allowed to edit both sheets.
        actor_result = CharacterService.update_character(actor.id, user_id, payload.get('actor_updates'), commit=False)
        target_result = CharacterService.update_character(target.id, user_id, payload.get('target_updates'), commit=False)
        use_result = apply_consumable_use(actor, target, payload.get('consumable_use'))
        finish_completion(actor, completion)
        return actor_result, target_result, use_result

    @staticmethod
    @atomic_operation
    def finish_self(user_id, character_id, payload):
        if not isinstance(payload.get('actor_updates'), dict) or not isinstance(payload['actor_updates'].get('data'), dict):
            raise ValidationError('Character data is required')
        if not isinstance(payload.get('consumable_use'), dict):
            raise ValidationError('Consumable use is required')
        character = CharacterService.get_character(character_id, user_id)
        CharacterService.check_access(character, user_id, edit=True)
        completion = claim_completion(character, character, user_id, payload['consumable_use'])
        validate_consumable_use(character, payload['consumable_use'])
        result = CharacterService.update_character(character_id, user_id, payload['actor_updates'], commit=False)
        use_result = apply_consumable_use(result.character, result.character, payload['consumable_use'])
        finish_completion(result.character, completion)
        return result, use_result
