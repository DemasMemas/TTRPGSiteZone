from copy import deepcopy
from functools import wraps
from inspect import signature

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified

from app.extensions import db
from app.models import DeferredCombatAction, LocationCharacter
from app.services.exceptions import ConflictError, PermissionDenied, ValidationError


def _bound_items(actor, payload):
    data = actor.character.data or {}
    result = {}
    if payload.get('loading') is not None:
        from app.services.ammo_loading import loading_bindings
        result['loading'] = loading_bindings(data, payload['loading'])
    weapon_index = payload.get('weapon_index')
    if weapon_index is not None:
        try:
            index = int(weapon_index)
            weapons = data.get('weapons') or []
            if 0 <= index < len(weapons):
                result['weapon'] = deepcopy(weapons[index])
        except (TypeError, ValueError):
            pass
    if payload.get('item_path'):
        item = data
        try:
            for key in payload['item_path']:
                item = item[key]
            result['item'] = deepcopy(item)
        except (KeyError, IndexError, TypeError):
            result['item'] = None
    return result


def snapshot_action_arguments(arguments):
    return deepcopy({key: value for key, value in arguments.items()
                     if key not in {'location_id', 'user_id', 'pending_action_id', 'resume_pending_action_id'}})


def durable_combat_action(operation):
    call_signature = signature(operation)

    @wraps(operation)
    def run(*args, **kwargs):
        call = call_signature.bind(*args, **kwargs)
        call.apply_defaults()
        values = call.arguments
        resume_id = values.get('resume_pending_action_id')
        pending_id = values.get('pending_action_id')
        try:
            if resume_id:
                row = db.session.get(DeferredCombatAction, str(resume_id))
                actor = db.session.get(LocationCharacter, values['location_character_id'])
                if not row or not actor or row.location_character_id != actor.id or actor.location_id != values['location_id']:
                    raise ValidationError('Сохранённое действие не найдено. Старое действие нужно начать заново.')
                from app.services.combat import CombatService
                is_gm = CombatService._ensure_access(actor.location, values['user_id'])
                if not CombatService._can_end_turn_for_character(actor, values['user_id'], is_gm=is_gm):
                    raise PermissionDenied('Вы не управляете этим персонажем')
                if row.status != 'ready':
                    raise ConflictError('Действие ещё не оплачено, уже завершено или отменено')
                if row.payload.get('action_key') == 'consumable_use':
                    raise ValidationError('Лечение завершается через сохранённую процедуру применения расходника')
                saved_payload = deepcopy(row.payload)
                bindings = saved_payload.pop('_bindings', {})
                if bindings != _bound_items(actor, saved_payload):
                    raise ValidationError('Оружие или предмет длительного действия изменились. Отмените действие и выберите их заново.')
                # Claim and apply in the same transaction. The version check rejects a racing resume.
                row.status = 'completed'
                db.session.flush()
                return operation(location_id=values['location_id'], user_id=values['user_id'],
                                 **saved_payload, resume_pending_action_id=row.id)
            if pending_id is not None:
                if not isinstance(pending_id, str) or not 1 <= len(pending_id) <= 120:
                    raise ValidationError('Некорректный идентификатор длительного действия')
                if db.session.get(DeferredCombatAction, pending_id):
                    raise ConflictError('Действие с этим идентификатором уже принято')
            return operation(*args, **kwargs)
        except IntegrityError as error:
            db.session.rollback()
            raise ConflictError() from error
        except Exception:
            db.session.rollback()
            raise
    return run


def ensure_no_deferred_action(actor):
    unfinished = DeferredCombatAction.query.filter_by(location_character_id=actor.id).filter(
        DeferredCombatAction.status.in_(('paying', 'ready')),
    ).first()
    if unfinished:
        raise ValidationError('Сначала завершите или отмените предыдущее длительное действие')


def remember_action(actor, pending, payload):
    ensure_no_deferred_action(actor)
    db.session.add(DeferredCombatAction(
        id=pending['id'], location_character_id=actor.id,
        payload={**payload, '_bindings': _bound_items(actor, payload)},
        label=pending['label'][:200], remaining_action_points=pending['remaining_action_points'],
    ))


def update_action_payment(actor, action_id, remaining):
    if actor.id is None:
        return
    row = db.session.get(DeferredCombatAction, str(action_id))
    if row and row.location_character_id == actor.id and row.status == 'paying':
        row.remaining_action_points = remaining
        row.status = 'paying' if remaining > 0 else 'ready'
        if row.status == 'ready':
            from app.services.deferred_consumable import prepare_medicine_roll
            prepare_medicine_roll(row)


def serialize_deferred_action(actor, health):
    if actor.id is None:
        return None
    meta = health.get('combatMeta') or {}
    action_id = meta.get('completedPendingActionId') or (meta.get('pendingAction') or {}).get('id')
    if not action_id:
        return None
    row = db.session.get(DeferredCombatAction, str(action_id))
    if not row or row.location_character_id != actor.id or row.status not in {'paying', 'ready'}:
        return None
    return {'id': row.id, 'label': row.label, 'status': row.status,
            'remaining_action_points': row.remaining_action_points,
            'action_key': row.payload['action_key'],
            # Older reload records contain only a payment, not an inventory selection.
            'server_executable': row.payload['action_key'] != 'consumable_use' and (
                row.payload['action_key'] != 'reload_weapon' or bool(row.payload.get('item_path'))),
            'client_executable': row.payload['action_key'] == 'consumable_use'}


def preserve_action_payment(current_data, incoming_data):
    current = ((current_data or {}).get('health') or {}).get('combatMeta') or {}
    health = incoming_data.setdefault('health', {})
    if not isinstance(health, dict):
        return
    meta = health.setdefault('combatMeta', {})
    if not isinstance(meta, dict):
        meta = health['combatMeta'] = {}
    for key in ('pendingAction', 'completedPendingActionId'):
        if key in current:
            meta[key] = deepcopy(current[key])
        else:
            meta.pop(key, None)


def cancel_deferred_action(actor, action_id):
    row = db.session.get(DeferredCombatAction, str(action_id))
    if not row or row.location_character_id != actor.id or row.status not in {'paying', 'ready'}:
        raise ValidationError('Нет активного длительного действия')
    row.status = 'cancelled'
    from app.services.deferred_consumable import cancel_treatment
    cancel_treatment(row)
    data = deepcopy(actor.character.data or {})
    meta = data.setdefault('health', {}).setdefault('combatMeta', {})
    if (meta.get('pendingAction') or {}).get('id') == row.id:
        meta.pop('pendingAction', None)
    if meta.get('completedPendingActionId') == row.id:
        meta.pop('completedPendingActionId', None)
    actor.character.data = data
    flag_modified(actor.character, 'data')


def cancel_actor_actions(actor):
    for row in DeferredCombatAction.query.filter_by(location_character_id=actor.id).filter(
        DeferredCombatAction.status.in_(('paying', 'ready')),
    ).all():
        cancel_deferred_action(actor, row.id)
