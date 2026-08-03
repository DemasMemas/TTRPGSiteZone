# app/lobbies/__init__.py
import json
import gzip
import io
import random
from copy import deepcopy
from datetime import datetime, timezone
from sqlalchemy.orm.attributes import flag_modified
from flask import Blueprint, request, jsonify, render_template, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.extensions import socketio, db
from app.services.lobby import LobbyService
from app.services.participant import ParticipantService
from app.services.map import MapService
from app.services.character import CharacterService
from app.services.combat import CombatService
from app.services.health import apply_health_maximums
from app.services.effects import (
    advance_timed_effects,
    apply_effect_to_health,
    normalize_effect_list,
    sync_health_derived_statuses,
)
from app.schemas.lobby import LobbyCreateSchema, LobbyDetailSchema, LobbyMySchema, LobbySchema
from app.schemas.participant import BannedUserSchema
from app.schemas.character import CharacterSchema, CharacterCreateSchema
from app.schemas.map import GameStateSchema, MapChunkSchema, TileUpdateSchema
from app.models import (
    GameState,
    ChatMessage,
    Lobby,
    LobbyCharacter,
    LobbyParticipant,
    LocationCombatState,
    User,
    WorldGroup,
    WorldTravelEvent,
)
from app.utils.decorators import requires_participant, requires_gm
from app.models.location import Location
from app.models.location_character import LocationCharacter
from app.models.location_object import LocationObject
from app.schemas.location import LocationCreateSchema, LocationSchema, LocationObjectSchema


def _emit_lobby_chat_message(lobby_id, user_id, message, username='Бой'):
    chat_message = ChatMessage(
        lobby_id=lobby_id,
        user_id=user_id,
        username=username,
        message=message,
    )
    db.session.add(chat_message)
    db.session.commit()
    payload = {
        'username': username,
        'message': message,
        'timestamp': chat_message.timestamp.isoformat(),
    }
    socketio.emit('new_message', payload, room=f"lobby_{lobby_id}")
    return payload

# Импорты для универсальных шаблонов
from app.models.templates import ItemTemplate
from app.schemas.templates import ItemTemplateSchema
from app.models.lobby_templates import LobbyItemTemplate
from app.schemas.lobby_templates import LobbyItemTemplateSchema

lobbies_bp = Blueprint('lobbies', __name__)

WORLD_EVENT_CHANCE = 0.25
WORLD_EVENT_DESCRIPTIONS = (
    'На пути обнаружены свежие следы неизвестной группы.',
    'Вдалеке слышны выстрелы. Источник звука находится неподалёку от маршрута.',
    'Детекторы фиксируют нестабильную аномальную активность впереди.',
    'Группа замечает заброшенный тайник у дороги.',
    'Путь пересекает след недавно прошедших мутантов.',
)


def _serialize_world_group(group):
    pending_event = next(
        (event for event in group.travel_events if event.status == 'pending'),
        None,
    )
    member_ids = [
        int(value) for value in (group.member_character_ids or [])
        if str(value).isdigit()
    ]
    characters_by_id = {
        character.id: character
        for character in LobbyCharacter.query.filter(
            LobbyCharacter.lobby_id == group.lobby_id,
            LobbyCharacter.id.in_(member_ids),
        ).all()
    } if member_ids else {}
    member_penalties = {
        character_id: CombatService._movement_penalty_breakdown(
            characters_by_id[character_id].data or {}
        )['total']
        for character_id in member_ids
        if character_id in characters_by_id
    }
    maximum_penalty = max(member_penalties.values(), default=0)
    movement_distance, speed_label = _world_group_speed(maximum_penalty)
    return {
        'id': group.id,
        'name': group.name,
        'tile_x': group.tile_x,
        'tile_y': group.tile_y,
        'has_pending_event': pending_event is not None,
        'members': [
            {
                'id': character_id,
                'name': characters_by_id[character_id].name,
                'movement_penalty': member_penalties[character_id],
            }
            for character_id in member_ids
            if character_id in characters_by_id
        ],
        'movement_penalty': maximum_penalty,
        'movement_distance': movement_distance,
        'movement_speed_label': speed_label,
    }


def _world_group_speed(maximum_penalty):
    if maximum_penalty >= 10:
        return 0, 'Группа не может идти'
    if maximum_penalty <= 3:
        return 3, 'Без изменений'
    if maximum_penalty <= 6:
        return 2, 'На треть медленнее'
    if maximum_penalty <= 7:
        return 1, 'Вдвое медленнее'
    return 1, 'Втрое медленнее'


def _serialize_world_event(event, *, reveal_description):
    return {
        'id': event.id,
        'group_id': event.group_id,
        'group_name': event.group.name,
        'description': event.description if reveal_description else None,
        'status': event.status,
        'from_tile_x': event.from_tile_x,
        'from_tile_y': event.from_tile_y,
        'to_tile_x': event.to_tile_x,
        'to_tile_y': event.to_tile_y,
        'created_at': event.created_at.isoformat(),
    }


def _advance_world_time(lobby, minutes):
    absolute_minutes = (
        (lobby.game_day or 1) * 1440
        + (lobby.game_time_minutes or 0)
        + minutes
    )
    lobby.game_day, lobby.game_time_minutes = divmod(absolute_minutes, 1440)
    updated_characters = []
    for character in LobbyCharacter.query.filter_by(
        lobby_id=lobby.id,
        time_active=True,
    ).all():
        character_data = dict(character.data or {})
        health = character_data.get('health')
        if not isinstance(health, dict):
            continue
        health['effects'] = advance_timed_effects(
            health,
            health.get('effects') or [],
            minutes * 60,
        )
        character.data = character_data
        flag_modified(character, 'data')
        updated_characters.append(character)
    return updated_characters


def _emit_world_time_updates(lobby, characters):
    payload = {
        'game_day': lobby.game_day,
        'game_time_minutes': lobby.game_time_minutes,
    }
    socketio.emit('lobby_time_updated', payload, room=f"lobby_{lobby.id}")
    for character in characters:
        socketio.emit(
            'character_data_updated',
            {
                'character_id': character.id,
                'updates': {'data': character.data},
                'updated_by': lobby.gm_id,
            },
            room=f"character_{character.id}",
        )
    return payload


@lobbies_bp.route('/<int:lobby_id>/world-groups', methods=['GET'])
@jwt_required()
@requires_participant
def list_world_groups(lobby_id, lobby, participant):
    groups = WorldGroup.query.filter_by(lobby_id=lobby_id).order_by(WorldGroup.id).all()
    events = WorldTravelEvent.query.filter_by(
        lobby_id=lobby_id,
        status='pending',
    ).order_by(WorldTravelEvent.created_at).all()
    is_gm = participant.user_id == lobby.gm_id
    available_characters = []
    if is_gm:
        available_characters = [
            {'id': character.id, 'name': character.name}
            for character in LobbyCharacter.query.filter_by(lobby_id=lobby_id)
            .order_by(LobbyCharacter.name, LobbyCharacter.id).all()
        ]
    return jsonify({
        'groups': [_serialize_world_group(group) for group in groups],
        'available_characters': available_characters,
        'pending_events': [
            _serialize_world_event(event, reveal_description=is_gm)
            for event in events
        ],
    }), 200


@lobbies_bp.route('/<int:lobby_id>/world-groups', methods=['POST'])
@jwt_required()
@requires_gm
def create_world_group(lobby_id, lobby):
    data = request.get_json(silent=True) or {}
    name = str(data.get('name') or '').strip()
    if not name or len(name) > 100:
        return jsonify({'error': 'Group name must contain from 1 to 100 characters'}), 400
    try:
        tile_x = int(data.get('tile_x'))
        tile_y = int(data.get('tile_y'))
    except (TypeError, ValueError):
        return jsonify({'error': 'tile_x and tile_y must be integers'}), 400
    if not (0 <= tile_x < lobby.chunks_width * 32 and 0 <= tile_y < lobby.chunks_height * 32):
        return jsonify({'error': 'World tile is outside the map'}), 400

    group = WorldGroup(
        lobby_id=lobby_id,
        name=name,
        tile_x=tile_x,
        tile_y=tile_y,
        member_character_ids=[],
        created_by=lobby.gm_id,
    )
    db.session.add(group)
    db.session.commit()
    payload = _serialize_world_group(group)
    socketio.emit('world_group_created', payload, room=f"lobby_{lobby_id}")
    return jsonify(payload), 201


@lobbies_bp.route('/<int:lobby_id>/world-groups/<int:group_id>/members', methods=['PATCH'])
@jwt_required()
@requires_gm
def update_world_group_members(lobby_id, group_id, lobby):
    group = WorldGroup.query.filter_by(id=group_id, lobby_id=lobby_id).first()
    if not group:
        return jsonify({'error': 'World group not found'}), 404
    data = request.get_json(silent=True) or {}
    try:
        member_ids = list(dict.fromkeys(int(value) for value in (data.get('character_ids') or [])))
    except (TypeError, ValueError):
        return jsonify({'error': 'character_ids must contain integers'}), 400
    existing_ids = {
        character_id for (character_id,) in db.session.query(LobbyCharacter.id).filter(
            LobbyCharacter.lobby_id == lobby_id,
            LobbyCharacter.id.in_(member_ids),
        ).all()
    } if member_ids else set()
    if set(member_ids) != existing_ids:
        return jsonify({'error': 'Character does not belong to this lobby'}), 400
    group.member_character_ids = member_ids
    db.session.commit()
    payload = _serialize_world_group(group)
    socketio.emit('world_group_updated', payload, room=f"lobby_{lobby_id}")
    return jsonify(payload), 200


@lobbies_bp.route('/<int:lobby_id>/world-groups/<int:group_id>', methods=['DELETE'])
@jwt_required()
@requires_gm
def delete_world_group(lobby_id, group_id, lobby):
    group = WorldGroup.query.filter_by(id=group_id, lobby_id=lobby_id).first()
    if not group:
        return jsonify({'error': 'World group not found'}), 404
    db.session.delete(group)
    db.session.commit()
    socketio.emit('world_group_deleted', {'id': group_id}, room=f"lobby_{lobby_id}")
    return '', 204


@lobbies_bp.route('/<int:lobby_id>/world-groups/<int:group_id>/move', methods=['POST'])
@jwt_required()
@requires_participant
def move_world_group(lobby_id, group_id, lobby, participant):
    group = WorldGroup.query.filter_by(id=group_id, lobby_id=lobby_id).first()
    if not group:
        return jsonify({'error': 'World group not found'}), 404
    pending = WorldTravelEvent.query.filter_by(group_id=group.id, status='pending').first()
    if pending:
        return jsonify({'error': 'The GM must resolve the pending travel event first'}), 409

    data = request.get_json(silent=True) or {}
    try:
        tile_x = int(data.get('tile_x'))
        tile_y = int(data.get('tile_y'))
    except (TypeError, ValueError):
        return jsonify({'error': 'tile_x and tile_y must be integers'}), 400
    if not (0 <= tile_x < lobby.chunks_width * 32 and 0 <= tile_y < lobby.chunks_height * 32):
        return jsonify({'error': 'World tile is outside the map'}), 400
    movement_profile = _serialize_world_group(group)
    movement_distance = movement_profile['movement_distance']
    requested_distance = max(abs(tile_x - group.tile_x), abs(tile_y - group.tile_y))
    if movement_distance <= 0:
        return jsonify({'error': 'The group cannot move with its current movement penalty'}), 400
    if requested_distance < 1 or requested_distance > movement_distance:
        return jsonify({
            'error': f'A world movement can reach no more than {movement_distance} tiles',
        }), 400

    from_x, from_y = group.tile_x, group.tile_y
    group.tile_x, group.tile_y = tile_x, tile_y
    updated_characters = _advance_world_time(lobby, 10)
    event = None
    if random.random() < WORLD_EVENT_CHANCE:
        event = WorldTravelEvent(
            lobby_id=lobby_id,
            group_id=group.id,
            description=random.choice(WORLD_EVENT_DESCRIPTIONS),
            from_tile_x=from_x,
            from_tile_y=from_y,
            to_tile_x=tile_x,
            to_tile_y=tile_y,
        )
        db.session.add(event)
    db.session.commit()

    group_payload = _serialize_world_group(group)
    time_payload = _emit_world_time_updates(lobby, updated_characters)
    socketio.emit('world_group_moved', group_payload, room=f"lobby_{lobby_id}")
    if event:
        socketio.emit(
            'world_travel_event_pending',
            _serialize_world_event(event, reveal_description=False),
            room=f"lobby_{lobby_id}",
        )
    return jsonify({
        'group': group_payload,
        'time': time_payload,
        'event_pending': event is not None,
    }), 200


@lobbies_bp.route('/<int:lobby_id>/world-events/<int:event_id>', methods=['PATCH'])
@jwt_required()
@requires_gm
def resolve_world_travel_event(lobby_id, event_id, lobby):
    event = WorldTravelEvent.query.filter_by(
        id=event_id,
        lobby_id=lobby_id,
        status='pending',
    ).first()
    if not event:
        return jsonify({'error': 'Pending world event not found'}), 404
    decision = str((request.get_json(silent=True) or {}).get('decision') or '').strip().lower()
    if decision not in {'approve', 'reject'}:
        return jsonify({'error': 'decision must be approve or reject'}), 400

    event.status = 'approved' if decision == 'approve' else 'rejected'
    event.resolved_at = datetime.now(timezone.utc)
    event.resolved_by = lobby.gm_id
    if decision == 'approve':
        _emit_lobby_chat_message(
            lobby_id,
            lobby.gm_id,
            f"{event.group.name}: {event.description}",
            username='Событие',
        )
    else:
        db.session.commit()
    payload = {
        'id': event.id,
        'group_id': event.group_id,
        'status': event.status,
    }
    socketio.emit('world_travel_event_resolved', payload, room=f"lobby_{lobby_id}")
    return jsonify(payload), 200

@lobbies_bp.route('/', methods=['POST'])
@jwt_required()
def create_lobby():
    user_id = int(get_jwt_identity())
    if request.content_type and 'multipart/form-data' in request.content_type:
        # Импорт из файла
        name = request.form.get('name')
        map_type = request.form.get('map_type')
        if not name or map_type != 'imported':
            return jsonify({'error': 'Invalid request'}), 400
        file = request.files.get('map_file')
        if not file:
            return jsonify({'error': 'No file uploaded'}), 400

        try:
            content = file.read().decode('utf-8')
            import_data = json.loads(content)
        except Exception:
            return jsonify({'error': 'Invalid JSON file'}), 400

        required_fields = ['lobby_name', 'map_type', 'chunks_width', 'chunks_height', 'chunks']
        if not all(field in import_data for field in required_fields):
            return jsonify({'error': 'Missing fields in import file'}), 400

        lobby = LobbyService.create_lobby(
            user_id=user_id,
            name=name,
            map_type='imported',
            import_data=import_data
        )
    else:
        schema = LobbyCreateSchema()
        data = schema.load(request.get_json())
        lobby = LobbyService.create_lobby(
            user_id=user_id,
            name=data['name'],
            map_type=data['map_type'],
            chunks_width=data['chunks_width'],
            chunks_height=data['chunks_height']
        )

    response_schema = LobbySchema()
    return jsonify(response_schema.dump(lobby)), 201

@lobbies_bp.route('/', methods=['GET'])
@jwt_required()
def list_lobbies():
    lobbies = LobbyService.list_active_lobbies()
    schema = LobbySchema(many=True)
    return jsonify(schema.dump(lobbies)), 200

@lobbies_bp.route('/<int:lobby_id>', methods=['GET'])
@jwt_required()
@requires_participant
def get_lobby(lobby_id, lobby, participant):
    schema = LobbyDetailSchema()
    return jsonify(schema.dump(lobby)), 200


@lobbies_bp.route('/<int:lobby_id>/time', methods=['PATCH'])
@jwt_required()
@requires_gm
def update_lobby_time(lobby_id, lobby):
    data = request.get_json(silent=True) or {}
    try:
        game_day = int(data.get('game_day'))
        game_time_minutes = int(data.get('game_time_minutes'))
    except (TypeError, ValueError):
        return jsonify({'error': 'game_day and game_time_minutes must be integers'}), 400
    if game_day < 1:
        return jsonify({'error': 'game_day must be at least 1'}), 400
    if not 0 <= game_time_minutes < 24 * 60:
        return jsonify({'error': 'game_time_minutes must be between 0 and 1439'}), 400

    previous_absolute_minutes = (lobby.game_day or 1) * 1440 + (lobby.game_time_minutes or 0)
    next_absolute_minutes = game_day * 1440 + game_time_minutes
    elapsed_seconds = max(0, next_absolute_minutes - previous_absolute_minutes) * 60
    lobby.game_day = game_day
    lobby.game_time_minutes = game_time_minutes
    updated_characters = []
    if elapsed_seconds > 0:
        for character in LobbyCharacter.query.filter_by(
            lobby_id=lobby_id,
            time_active=True,
        ).all():
            character_data = dict(character.data or {})
            health = character_data.get('health')
            if not isinstance(health, dict):
                continue
            health['effects'] = advance_timed_effects(
                health,
                health.get('effects') or [],
                elapsed_seconds,
            )
            character.data = character_data
            flag_modified(character, 'data')
            updated_characters.append(character)
    db.session.commit()
    payload = {'game_day': game_day, 'game_time_minutes': game_time_minutes}
    socketio.emit('lobby_time_updated', payload, room=f"lobby_{lobby_id}")
    for character in updated_characters:
        socketio.emit(
            'character_data_updated',
            {
                'character_id': character.id,
                'updates': {'data': character.data},
                'updated_by': lobby.gm_id,
            },
            room=f"character_{character.id}",
        )
    return jsonify(payload), 200


def _normalize_character_needs(health):
    needs = health.get('needs') if isinstance(health.get('needs'), dict) else {}
    return {
        'day': max(1, int(needs.get('day') or 1)),
        'mealsToday': max(0, min(3, int(needs.get('mealsToday') or 0))),
        'drinksToday': max(0, min(3, int(needs.get('drinksToday') or 0))),
        'sleptToday': needs.get('sleptToday') is True,
        'lastDay': needs.get('lastDay') if isinstance(needs.get('lastDay'), dict) else None,
    }


def _resolve_character_day(health, effects, *, slept):
    needs = _normalize_character_needs(health)
    missed = []
    if needs['mealsToday'] < 3:
        missed.append('еда')
    if needs['drinksToday'] < 3:
        missed.append('вода')
    if not slept and not needs['sleptToday']:
        missed.append('сон')
    health['exhaustion'] = max(
        0,
        min(10, float(health.get('exhaustion') or 0) + len(missed) - (0.5 if slept else 0)),
    )
    infection_blocked = any(
        effect.get('type') == 'infection_growth_block' and effect.get('active', True)
        for effect in effects
    )
    if not infection_blocked:
        health['infection'] = min(
            100,
            float(health.get('infection') or 0)
            + float(health.get('infectionGrowthPerDay') or 0),
        )

    survivors = []
    for effect in effects:
        if effect.get('tick') not in {'day_start', 'rest'}:
            survivors.append(effect)
            continue
        for adjustment in effect.get('adjustments') or []:
            if not isinstance(adjustment, dict) or not adjustment.get('field'):
                continue
            field = str(adjustment['field'])
            value = float(health.get(field) or 0) + float(adjustment.get('delta') or 0)
            if adjustment.get('min') is not None:
                value = max(float(adjustment['min']), value)
            if adjustment.get('max') is not None:
                value = min(float(adjustment['max']), value)
            health[field] = value
        if effect.get('remaining') is not None:
            effect['remaining'] = max(0, int(effect.get('remaining') or 0) - 1)
            if effect['remaining'] <= 0:
                continue
        survivors.append(effect)

    health['needs'] = {
        'day': needs['day'] + 1,
        'mealsToday': 0,
        'drinksToday': 0,
        'sleptToday': False,
        'lastDay': {
            'day': needs['day'],
            'meals': needs['mealsToday'],
            'drinks': needs['drinksToday'],
            'slept': slept or needs['sleptToday'],
            'missed': missed,
        },
    }
    return survivors


def _advance_exoskeleton_battery_day(character_data):
    armor = ((character_data.get('equipment') or {}).get('armor') or {})
    if str(armor.get('name') or '').strip().lower() != 'экзоскелет':
        return
    battery = next((
        module for module in armor.get('installedModules') or []
        if isinstance(module, dict) and module.get('slotType') == 'exoskeleton_battery'
    ), None)
    if not battery:
        armor['powered'] = False
        return
    attributes = battery.setdefault('attributes', {})
    attributes['remaining_days'] = max(0, float(attributes.get('remaining_days') or 0) - 1)
    armor['powered'] = attributes['remaining_days'] > 0


@lobbies_bp.route('/<int:lobby_id>/characters/time-active', methods=['PATCH'])
@jwt_required()
@requires_gm
def update_time_active_characters(lobby_id, lobby):
    data = request.get_json(silent=True) or {}
    try:
        active_ids = {int(value) for value in (data.get('character_ids') or [])}
    except (TypeError, ValueError):
        return jsonify({'error': 'character_ids must contain integers'}), 400
    characters = LobbyCharacter.query.filter_by(lobby_id=lobby_id).all()
    existing_ids = {character.id for character in characters}
    if not active_ids.issubset(existing_ids):
        return jsonify({'error': 'Character does not belong to this lobby'}), 400
    for character in characters:
        character.time_active = character.id in active_ids
    db.session.commit()
    socketio.emit(
        'character_time_activity_updated',
        {'character_ids': sorted(active_ids)},
        room=f"lobby_{lobby_id}",
    )
    return jsonify({'character_ids': sorted(active_ids)}), 200


@lobbies_bp.route('/<int:lobby_id>/rest', methods=['POST'])
@jwt_required()
@requires_gm
def start_lobby_rest(lobby_id, lobby):
    data = request.get_json(silent=True) or {}
    rest_type = str(data.get('type') or '').strip().lower()
    hours = {'rest': 1, 'sleep': 8}.get(rest_type)
    if hours is None:
        return jsonify({'error': 'type must be rest or sleep'}), 400
    try:
        selected_ids = {int(value) for value in (data.get('character_ids') or [])}
    except (TypeError, ValueError):
        return jsonify({'error': 'character_ids must contain integers'}), 400
    if not selected_ids:
        return jsonify({'error': 'Select at least one character'}), 400

    all_characters = LobbyCharacter.query.filter_by(lobby_id=lobby_id).all()
    characters = [character for character in all_characters if character.time_active]
    existing_ids = {character.id for character in characters}
    if not selected_ids.issubset(existing_ids):
        return jsonify({'error': 'Rest participants must be active characters'}), 400

    elapsed_seconds = hours * 3600
    absolute_minutes = (
        (lobby.game_day or 1) * 1440
        + (lobby.game_time_minutes or 0)
        + hours * 60
    )
    lobby.game_day, lobby.game_time_minutes = divmod(absolute_minutes, 1440)
    summaries = []
    for character in characters:
        character_data = dict(character.data or {})
        health = character_data.get('health')
        if not isinstance(health, dict):
            continue
        selected = character.id in selected_ids
        effects = advance_timed_effects(
            health,
            health.get('effects') or [],
            elapsed_seconds,
            include_turn_effects=selected,
        )
        healed = 0
        if selected:
            rest_bonus = next((
                effect for effect in effects if effect.get('type') == 'next_rest_healing'
            ), None)
            modifiers = ((health.get('combatMeta') or {}).get('consumableModifiers') or [])
            rest_modifier = next((
                modifier for modifier in modifiers
                if isinstance(modifier, dict) and modifier.get('stat') == 'rest_heal_multiplier'
            ), None)
            multiplier = max(
                1,
                float((rest_bonus or {}).get('value') or (rest_modifier or {}).get('value') or 1),
            )
            maximum = float(health.get('max') or 700)
            healed = maximum * (0.5 if rest_type == 'sleep' else 0.05) * multiplier
            apply_effect_to_health(health, {'type': 'heal', 'value': healed})
            effects = [effect for effect in effects if effect.get('type') != 'next_rest_healing']
            if isinstance(health.get('combatMeta'), dict):
                health['combatMeta']['consumableModifiers'] = [
                    modifier for modifier in modifiers
                    if not isinstance(modifier, dict) or modifier.get('stat') != 'rest_heal_multiplier'
                ]
            if rest_type == 'sleep':
                health['intoxication'] = max(0, float(health.get('intoxication') or 0) - 75)
                effects = _resolve_character_day(health, effects, slept=True)
                _advance_exoskeleton_battery_day(character_data)
        health['effects'] = normalize_effect_list(effects)
        sync_health_derived_statuses(health)
        character.data = character_data
        flag_modified(character, 'data')
        if selected:
            summaries.append({'character_id': character.id, 'name': character.name, 'healed': round(healed)})

    db.session.commit()
    time_payload = {
        'game_day': lobby.game_day,
        'game_time_minutes': lobby.game_time_minutes,
    }
    socketio.emit('lobby_time_updated', time_payload, room=f"lobby_{lobby_id}")
    for character in characters:
        socketio.emit(
            'character_data_updated',
            {
                'character_id': character.id,
                'updates': {'data': character.data},
                'updated_by': lobby.gm_id,
            },
            room=f"character_{character.id}",
        )
    return jsonify({
        **time_payload,
        'type': rest_type,
        'hours': hours,
        'characters': summaries,
    }), 200

@lobbies_bp.route('/<int:lobby_id>/join', methods=['POST'])
@jwt_required()
def join_lobby(lobby_id):
    user_id = int(get_jwt_identity())
    ParticipantService.join_lobby(user_id, lobby_id)
    return jsonify({'message': 'Joined lobby'}), 200

@lobbies_bp.route('/<int:lobby_id>/leave', methods=['POST'])
@jwt_required()
def leave_lobby(lobby_id):
    user_id = int(get_jwt_identity())
    ParticipantService.leave_lobby(user_id, lobby_id)
    return jsonify({'message': 'Left lobby'}), 200

@lobbies_bp.route('/<int:lobby_id>', methods=['DELETE'])
@jwt_required()
@requires_gm
def delete_lobby(lobby_id, lobby):
    LobbyService.delete_lobby(lobby_id, lobby.gm_id)  # gm_id берётся из lobby
    return jsonify({'message': 'Lobby deleted'}), 200

@lobbies_bp.route('/<int:lobby_id>/page')
def lobby_page(lobby_id):
    return render_template('lobby.html')

@lobbies_bp.route('/<int:lobby_id>/participants_characters', methods=['GET'])
@jwt_required()
@requires_participant
def get_participants_characters(lobby_id, lobby, participant):
    is_gm = (lobby.gm_id == participant.user_id)

    participants = LobbyParticipant.query.filter_by(
        lobby_id=lobby_id,
        is_banned=False,
    ).all()
    result = []
    for p in participants:
        user_data = {
            'user_id': p.user_id,
            'username': p.user.username,
            'color': p.user.color
        }
        participant_character_id = getattr(p, 'character_id', None)
        if participant_character_id:
            char = db.session.get(LobbyCharacter, participant_character_id)
            if char:
                user_data['character'] = {
                    'id': char.id,
                    'name': char.name,
                    'data': char.data
                }
            else:
                user_data['character'] = None
        else:
            user_data['character'] = None
        result.append(user_data)
    return jsonify(result), 200

@lobbies_bp.route('/<int:lobby_id>/map', methods=['GET'])
@jwt_required()
@requires_participant
def get_map(lobby_id, lobby, participant):
    game_state = GameState.query.filter_by(lobby_id=lobby_id).first()
    if not game_state:
        game_state = GameState(lobby_id=lobby_id)
        db.session.add(game_state)
        db.session.commit()

    schema = GameStateSchema()
    return jsonify(schema.dump(game_state.map_data)), 200

@lobbies_bp.route('/join_by_code', methods=['POST'])
@jwt_required()
def join_by_code():
    user_id = int(get_jwt_identity())
    data = request.get_json()
    code = data.get('code')
    if not code:
        return jsonify({'error': 'Code is required'}), 400
    lobby = LobbyService.join_by_code(user_id, code)
    return jsonify({'message': 'Joined lobby', 'lobby_id': lobby.id}), 200

@lobbies_bp.route('/my', methods=['GET'])
@jwt_required()
def get_my_lobbies():
    user_id = int(get_jwt_identity())
    limit = request.args.get('limit', type=int)
    offset = request.args.get('offset', default=0, type=int)

    # Валидация
    if limit is not None and (limit <= 0 or limit > 100):
        return jsonify({'error': 'limit must be between 1 and 100'}), 400
    if offset < 0:
        return jsonify({'error': 'offset must be non-negative'}), 400

    lobbies = LobbyService.get_my_lobbies(user_id, limit=limit, offset=offset)
    schema = LobbyMySchema(many=True)
    return jsonify(schema.dump(lobbies)), 200

@lobbies_bp.route('/<int:lobby_id>/ban/<int:user_id>', methods=['POST'])
@jwt_required()
@requires_gm
def ban_participant(lobby_id, lobby, user_id):
    ParticipantService.ban_user(lobby.gm_id, lobby_id, user_id)
    return jsonify({'message': 'User banned'}), 200

@lobbies_bp.route('/<int:lobby_id>/banned', methods=['GET'])
@jwt_required()
@requires_gm
def get_banned_participants(lobby_id, lobby):
    banned = ParticipantService.get_banned_list(lobby.gm_id, lobby_id)
    schema = BannedUserSchema(many=True)
    return jsonify(schema.dump(banned)), 200

@lobbies_bp.route('/<int:lobby_id>/unban/<int:user_id>', methods=['POST'])
@jwt_required()
@requires_gm
def unban_participant(lobby_id, lobby, user_id):
    ParticipantService.unban_user(lobby.gm_id, lobby_id, user_id)
    return jsonify({'message': 'User unbanned'}), 200

@lobbies_bp.route('/<int:lobby_id>/characters', methods=['GET'])
@jwt_required()
@requires_participant
def get_lobby_characters(lobby_id, lobby, participant):
    characters = CharacterService.get_lobby_characters(lobby_id, participant.user_id)
    schema = CharacterSchema(many=True)
    return jsonify(schema.dump(characters)), 200

@lobbies_bp.route('/<int:lobby_id>/characters', methods=['POST'])
@jwt_required()
@requires_participant
def create_lobby_character(lobby_id, lobby, participant):
    schema = CharacterCreateSchema()
    data = schema.load(request.get_json())
    character = CharacterService.create_character(
        lobby_id=lobby_id,
        owner_id=participant.user_id,
        name=data['name'],
        data=data.get('data', {})
    )

    socketio.emit('character_created', {
        'id': character.id,
        'name': character.name,
        'owner_id': character.owner_id,
        'owner_username': character.owner.username if character.owner else None,
        'data': character.data
    }, room=f"lobby_{lobby_id}")

    response_schema = CharacterSchema()
    return jsonify(response_schema.dump(character)), 201

@lobbies_bp.route('/characters/<int:character_id>', methods=['GET'])
@jwt_required()
def get_character(character_id):
    user_id = int(get_jwt_identity())
    character = CharacterService.get_character(character_id, user_id)
    schema = CharacterSchema()
    payload = schema.dump(character)
    lobby = db.session.get(Lobby, character.lobby_id)
    is_controller = LocationCharacter.query.filter_by(
        character_id=character.id,
        controlled_by=user_id,
    ).first() is not None
    payload['can_edit'] = bool(
        character.owner_id == user_id
        or (lobby and lobby.gm_id == user_id)
        or user_id in (character.editable_to or [])
        or is_controller
    )
    return jsonify(payload), 200

@lobbies_bp.route('/characters/<int:character_id>', methods=['PUT'])
@jwt_required()
def update_character(character_id):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    character = CharacterService.update_character(character_id, user_id, data)
    return jsonify({'message': 'Character updated'}), 200

@lobbies_bp.route('/characters/<int:character_id>', methods=['DELETE'])
@jwt_required()
def delete_character(character_id):
    user_id = int(get_jwt_identity())
    character = CharacterService.get_character(character_id, user_id)
    CharacterService.delete_character(character_id, user_id)
    socketio.emit('character_deleted', {'id': character_id}, room=f"lobby_{character.lobby_id}")
    return jsonify({'message': 'Character deleted'}), 200

@lobbies_bp.route('/characters/<int:character_id>/visibility', methods=['PUT'])
@jwt_required()
def set_character_visibility(character_id):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    if 'visible_to' not in data or not isinstance(data['visible_to'], list):
        return jsonify({'error': 'visible_to must be a list'}), 400
    editable_to = data.get('editable_to', [])
    if not isinstance(editable_to, list):
        return jsonify({'error': 'editable_to must be a list'}), 400
    character = CharacterService.set_visibility(
        character_id, user_id, data['visible_to'], editable_to
    )
    socketio.emit('character_updated', {
        'id': character.id,
        'visible_to': character.visible_to,
        'editable_to': character.editable_to,
    }, room=f"lobby_{character.lobby_id}")
    return jsonify({'message': 'Visibility updated'}), 200

@lobbies_bp.route('/<int:lobby_id>/chunks/<int:chunk_x>/<int:chunk_y>/tile/<int:tile_x>/<int:tile_y>', methods=['PATCH'])
@jwt_required()
@requires_gm
def update_tile(lobby_id, lobby, chunk_x, chunk_y, tile_x, tile_y):
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    schema = TileUpdateSchema()
    updates = schema.load(data)
    MapService.update_tile(lobby_id, lobby.gm_id, chunk_x, chunk_y, tile_x, tile_y, updates)
    allowed_fields = ['terrain', 'height', 'objects']
    safe_updates = {k: v for k, v in updates.items() if k in allowed_fields}
    socketio.emit('tile_updated', {
        'chunk_x': chunk_x,
        'chunk_y': chunk_y,
        'tile_x': tile_x,
        'tile_y': tile_y,
        'updates': safe_updates
    }, room=f"lobby_{lobby_id}")
    return jsonify({'message': 'Tile updated'}), 200

@lobbies_bp.route('/<int:lobby_id>/chunks', methods=['GET'])
@jwt_required()
@requires_participant
def get_chunks(lobby_id, lobby, participant):
    min_x = request.args.get('min_chunk_x', type=int)
    max_x = request.args.get('max_chunk_x', type=int)
    min_y = request.args.get('min_chunk_y', type=int)
    max_y = request.args.get('max_chunk_y', type=int)
    if None in (min_x, max_x, min_y, max_y):
        return jsonify({'error': 'Missing bounds'}), 400
    chunks = MapService.get_chunks(lobby_id, participant.user_id, (min_x, max_x, min_y, max_y))
    schema = MapChunkSchema(many=True)
    return jsonify(schema.dump(chunks)), 200

@lobbies_bp.route('/<int:lobby_id>/chunks/batch', methods=['POST'])
@jwt_required()
@requires_gm
def batch_update_tiles(lobby_id, lobby):
    data = request.get_json()
    if not data or not isinstance(data, list):
        return jsonify({'error': 'Expected a list of updates'}), 400

    MapService.batch_update_tiles(lobby_id, lobby.gm_id, data)
    socketio.emit('tiles_updated', data, room=f"lobby_{lobby_id}")
    return jsonify({'message': 'Tiles updated successfully'}), 200

@lobbies_bp.route('/<int:lobby_id>/export', methods=['GET'])
@jwt_required()
@requires_gm
def export_lobby(lobby_id, lobby):
    export_data = MapService.export_map(lobby_id, lobby.gm_id)
    json_str = json.dumps(export_data, ensure_ascii=False, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    gzip_buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=gzip_buffer, mode='wb') as f:
        f.write(json_bytes)
    gzip_buffer.seek(0)
    return send_file(
        gzip_buffer,
        as_attachment=True,
        download_name=f'lobby_{lobby_id}_map.json.gz',
        mimetype='application/gzip'
    )

@lobbies_bp.route('/<int:lobby_id>/weather', methods=['PATCH'])
@jwt_required()
@requires_gm
def update_weather(lobby_id, lobby):
    data = request.get_json()
    lobby.weather_settings = data
    db.session.commit()

    socketio.emit('weather_updated', data, room=f"lobby_{lobby_id}")
    return jsonify({'message': 'Weather updated'}), 200

@lobbies_bp.route('/joined', methods=['GET'])
@jwt_required()
def get_joined_lobbies():
    user_id = int(get_jwt_identity())
    limit = request.args.get('limit', type=int)
    offset = request.args.get('offset', default=0, type=int)

    if limit is not None and (limit <= 0 or limit > 100):
        return jsonify({'error': 'limit must be between 1 and 100'}), 400
    if offset < 0:
        return jsonify({'error': 'offset must be non-negative'}), 400

    lobbies = LobbyService.get_joined_lobbies(user_id, limit=limit, offset=offset)
    from app.schemas.lobby import LobbyMySchema
    schema = LobbyMySchema(many=True)
    return jsonify(schema.dump(lobbies)), 200


@lobbies_bp.route('/<int:lobby_id>/templates', methods=['GET'])
@jwt_required()
@requires_participant
def get_lobby_templates(lobby_id, lobby, participant):
    """Возвращает объединённый список глобальных и локальных шаблонов с фильтрацией по категории."""
    category = request.args.get('category')
    subcategory = request.args.get('subcategory')

    query_global = ItemTemplate.query
    query_local = LobbyItemTemplate.query.filter_by(lobby_id=lobby_id)

    if category:
        query_global = query_global.filter_by(category=category)
        query_local = query_local.filter_by(category=category)
    if subcategory:
        query_global = query_global.filter_by(subcategory=subcategory)
        query_local = query_local.filter_by(subcategory=subcategory)

    global_templates = query_global.all()
    local_templates = query_local.all()

    global_schema = ItemTemplateSchema(many=True)
    local_schema = LobbyItemTemplateSchema(many=True)

    return jsonify({
        'global': global_schema.dump(global_templates),
        'local': local_schema.dump(local_templates)
    })


@lobbies_bp.route('/<int:lobby_id>/templates', methods=['POST'])
@jwt_required()
@requires_gm
def create_lobby_template(lobby_id, lobby):
    """Создаёт новый кастомный шаблон в комнате."""
    data = request.get_json()
    schema = LobbyItemTemplateSchema()
    validated_data = schema.load(data)
    template = LobbyItemTemplate(
        lobby_id=lobby_id,
        created_by=int(get_jwt_identity()),
        **validated_data
    )
    db.session.add(template)
    db.session.commit()
    return jsonify(schema.dump(template)), 201


@lobbies_bp.route('/<int:lobby_id>/templates/<int:template_id>', methods=['PUT'])
@jwt_required()
@requires_gm
def update_lobby_template(lobby_id, lobby, template_id):
    template = LobbyItemTemplate.query.filter_by(id=template_id, lobby_id=lobby_id).first_or_404()
    data = request.get_json()
    schema = LobbyItemTemplateSchema(partial=True)
    validated_data = schema.load(data)
    for key, value in validated_data.items():
        setattr(template, key, value)
    db.session.commit()
    return jsonify(schema.dump(template))


@lobbies_bp.route('/<int:lobby_id>/templates/<int:template_id>', methods=['DELETE'])
@jwt_required()
@requires_gm
def delete_lobby_template(lobby_id, lobby, template_id):
    template = LobbyItemTemplate.query.filter_by(id=template_id, lobby_id=lobby_id).first_or_404()
    db.session.delete(template)
    db.session.commit()
    return '', 204

# ========== L O C A T I O N S   E N D P O I N T S ==========

@lobbies_bp.route('/<int:lobby_id>/locations', methods=['POST'])
@jwt_required()
@requires_gm
def create_location(lobby_id, lobby):
    schema = LocationCreateSchema()
    data = schema.load(request.get_json())
    location = Location(
        lobby_id=lobby_id,
        name=data['name'],
        description=data['description'],
        type=data['type'],
        grid_width=data['grid_width'],
        grid_height=data['grid_height'],
        tiles_data=data['tiles_data'],
        world_tile_x=data['world_tile_x'],
        world_tile_z=data['world_tile_z'],
        world_radius=data['world_radius'],
        spawn_points=data['spawn_points']
    )
    db.session.add(location)
    db.session.commit()

    socketio.emit('location_created', {
        'lobby_id': lobby_id,
        'location': {
            'id': location.id,
            'name': location.name,
            'type': location.type,
            'world_tile_x': location.world_tile_x,
            'world_tile_z': location.world_tile_z,
            'world_radius': location.world_radius
        }
    }, room=f"lobby_{lobby_id}")

    return jsonify({'id': location.id, 'message': 'Location created'}), 201


@lobbies_bp.route('/<int:lobby_id>/locations', methods=['GET'])
@jwt_required()
@requires_participant
def get_locations(lobby_id, lobby, participant):
    locations = Location.query.filter_by(lobby_id=lobby_id).all()
    result = [{
        'id': loc.id,
        'name': loc.name,
        'type': loc.type,
        'world_tile_x': loc.world_tile_x,
        'world_tile_z': loc.world_tile_z,
        'world_radius': loc.world_radius
    } for loc in locations]
    return jsonify(result), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>', methods=['GET'])
@jwt_required()
@requires_participant
def get_location_detail(lobby_id, location_id, lobby, participant):
    location = Location.query.get_or_404(location_id)
    if location.lobby_id != lobby_id:
        return jsonify({'error': 'Access denied'}), 403

    objects = LocationObject.query.filter_by(location_id=location.id).all()
    obj_schema = LocationObjectSchema(many=True)

    return jsonify({
        'id': location.id,
        'name': location.name,
        'description': location.description,
        'type': location.type,
        'grid_width': location.grid_width,
        'grid_height': location.grid_height,
        'tiles_data': location.tiles_data,
        'spawn_points': location.spawn_points,
        'objects': obj_schema.dump(objects)
    }), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>', methods=['PUT'])
@jwt_required()
@requires_gm
def update_location(lobby_id, location_id, lobby):
    location = Location.query.get_or_404(location_id)
    if location.lobby_id != lobby_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    allowed = ['name', 'description', 'type', 'grid_width', 'grid_height', 'tiles_data', 'spawn_points', 'world_radius']
    for field in allowed:
        if field in data:
            setattr(location, field, data[field])
    db.session.commit()

    all_updates = []
    for z, row in enumerate(location.tiles_data):
        for x, tile in enumerate(row):
            all_updates.append({
                'x': x,
                'z': z,
                'terrain': tile.get('terrain'),
                'height': tile.get('height'),
                'objects': tile.get('objects', [])
            })
    socketio.emit('location_tiles_updated', {
        'location_id': location.id,
        'updates': all_updates
    }, room=f"location_{location.id}")

    socketio.emit('location_updated', {
        'lobby_id': lobby_id,
        'location_id': location.id,
        'updates': {k: data[k] for k in allowed if k in data}
    }, room=f"lobby_{lobby_id}")

    return jsonify({'message': 'Location updated'}), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>', methods=['DELETE'])
@jwt_required()
@requires_gm
def delete_location(lobby_id, location_id, lobby):
    location = Location.query.get_or_404(location_id)
    if location.lobby_id != lobby_id:
        return jsonify({'error': 'Access denied'}), 403

    socketio.emit('location_deleted', {
        'lobby_id': lobby_id,
        'location_id': location.id
    }, room=f"lobby_{lobby_id}")

    db.session.delete(location)
    db.session.commit()
    return jsonify({'message': 'Location deleted'}), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/objects', methods=['POST'])
@jwt_required()
@requires_gm
def add_location_object(lobby_id, location_id, lobby):
    location = Location.query.get_or_404(location_id)
    if location.lobby_id != lobby_id:
        return jsonify({'error': 'Access denied'}), 403

    schema = LocationObjectSchema()
    data = schema.load(request.get_json())
    obj = LocationObject(
        location_id=location_id,
        name=data['name'],
        type=data['type'],
        tile_x=data['tile_x'],
        tile_y=data['tile_y'],
        properties=data.get('properties', {})
    )
    db.session.add(obj)
    db.session.commit()
    payload = schema.dump(obj)
    socketio.emit('location_object_created', {
        'location_id': location_id,
        'object': payload
    }, room=f"location_{location_id}")
    return jsonify(payload), 201


@lobbies_bp.route('/<int:lobby_id>/locations/objects/<int:object_id>', methods=['DELETE'])
@jwt_required()
@requires_gm
def delete_location_object(lobby_id, object_id, lobby):
    obj = LocationObject.query.get_or_404(object_id)
    location = Location.query.get(obj.location_id)
    if location.lobby_id != lobby_id:
        return jsonify({'error': 'Access denied'}), 403
    location_id = location.id
    db.session.delete(obj)
    db.session.commit()
    socketio.emit('location_object_deleted', {
        'location_id': location_id,
        'object_id': object_id
    }, room=f"location_{location_id}")
    return '', 204


@lobbies_bp.route('/<int:lobby_id>/locations/objects/<int:object_id>', methods=['PATCH'])
@jwt_required()
@requires_participant
def update_location_object(lobby_id, object_id, lobby, participant):
    obj = LocationObject.query.get_or_404(object_id)
    location = Location.query.get(obj.location_id)
    if location.lobby_id != lobby_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    if 'tile_x' in data:
        obj.tile_x = data['tile_x']
    if 'tile_y' in data:
        obj.tile_y = data['tile_y']
    if 'properties' in data and isinstance(data['properties'], dict):
        obj.properties = {**(obj.properties or {}), **data['properties']}
    db.session.commit()

    payload = LocationObjectSchema().dump(obj)
    socketio.emit('location_object_updated', {
        'location_id': location.id,
        'object': payload
    }, room=f"location_{location.id}")
    return jsonify(payload), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/spawn_character', methods=['POST'])
@jwt_required()
def spawn_character_in_location(lobby_id, location_id):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    character_id = data.get('character_id')
    tile_x = data.get('tile_x')
    tile_y = data.get('tile_y')
    assign_to_user_id = data.get('assign_to_user_id')  # может быть None

    if not character_id or tile_x is None or tile_y is None:
        return jsonify({'error': 'Missing parameters'}), 400

    location = Location.query.get(location_id)
    if not location or location.lobby_id != lobby_id:
        return jsonify({'error': 'Location not found'}), 404

    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant or participant.is_banned:
        return jsonify({'error': 'Access denied'}), 403

    is_gm = (lobby.gm_id == user_id)

    character = LobbyCharacter.query.get(character_id)
    if not character:
        return jsonify({'error': 'Character not found'}), 404
    if character.lobby_id != lobby_id:
        return jsonify({'error': 'Character not in this lobby'}), 403

    # Определяем, кому назначить управление
    if assign_to_user_id is not None:
        if not is_gm:
            return jsonify({'error': 'Only GM can assign character to another user'}), 403
        target_user_id = assign_to_user_id
        target_participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=target_user_id, is_banned=False).first()
        if not target_participant:
            return jsonify({'error': 'Target user not in lobby or banned'}), 400
    else:
        # По умолчанию владелец – тот, кто спавнит, если он владелец персонажа
        if character.owner_id != user_id and not is_gm:
            return jsonify({'error': 'You cannot spawn this character'}), 403
        target_user_id = user_id

    # Проверяем, не находится ли уже персонаж в этой локации (если да – перемещаем)
    existing = LocationCharacter.query.filter_by(location_id=location_id, character_id=character_id).order_by(
        LocationCharacter.last_action.desc().nullslast(),
        LocationCharacter.id.desc(),
    ).first()
    if existing:
        # Перемещаем на новые координаты
        existing.pos_x = tile_x
        existing.pos_y = tile_y
        existing.status = 'idle'
        if assign_to_user_id is not None:
            existing.controlled_by = target_user_id  # обновляем управление
        db.session.commit()
        loc_char = existing
        action = 'moved'
    else:
        # Создаём нового LocationCharacter
        character_data = deepcopy(character.data or {})
        hp_zones = apply_health_maximums(character_data).get('zones', {})
        character.data = character_data
        zones_dict = {
            'head': {'current': hp_zones.get('head', {}).get('current', 50), 'max': hp_zones.get('head', {}).get('max', 50)},
            'chest': {'current': hp_zones.get('chest', {}).get('current', 150), 'max': hp_zones.get('chest', {}).get('max', 150)},
            'abdomen': {'current': hp_zones.get('abdomen', {}).get('current', 120), 'max': hp_zones.get('abdomen', {}).get('max', 120)},
            'left_arm': {'current': hp_zones.get('leftArm', {}).get('current', 90), 'max': hp_zones.get('leftArm', {}).get('max', 90)},
            'right_arm': {'current': hp_zones.get('rightArm', {}).get('current', 90), 'max': hp_zones.get('rightArm', {}).get('max', 90)},
            'left_leg': {'current': hp_zones.get('leftLeg', {}).get('current', 100), 'max': hp_zones.get('leftLeg', {}).get('max', 100)},
            'right_leg': {'current': hp_zones.get('rightLeg', {}).get('current', 100), 'max': hp_zones.get('rightLeg', {}).get('max', 100)}
        }
        loc_char = LocationCharacter(
            location_id=location_id,
            character_id=character_id,
            pos_x=tile_x,
            pos_y=tile_y,
            status='idle',
            hp_zones=zones_dict,
            effects=[],
            controlled_by=target_user_id
        )
        db.session.add(loc_char)
        db.session.flush()
        profile = CombatService._combat_profile(loc_char)
        loc_char.initiative_bonus = profile['initiative_bonus']
        loc_char.action_points_max = profile['action_points']
        loc_char.action_points_current = profile['action_points']
        loc_char.free_actions_max = profile['free_actions']
        loc_char.free_actions_current = profile['free_actions']
        loc_char.movement_points_max = 0
        loc_char.movement_points_current = 0
        db.session.commit()
        action = 'spawned'

    # Уведомляем всех в локации через сокет
    socketio.emit('character_spawned', {
        'action': action,
        'character': {
            'id': character.id,
            'name': character.name,
            'owner_id': character.owner_id,           # создатель
            'controlled_by': target_user_id,          # <-- кто управляет
            'owner_username': User.query.get(target_user_id).username if target_user_id else None,
            'hp_zones': loc_char.hp_zones,
            'effects': loc_char.effects,
            'pos_x': loc_char.pos_x,
            'pos_y': loc_char.pos_y
        }
    }, room=f"location_{location_id}")

    return jsonify({'message': f'Character {action} successfully', 'location_character_id': loc_char.id}), 200


@lobbies_bp.route(
    '/<int:lobby_id>/locations/<int:location_id>/characters/<int:character_id>',
    methods=['DELETE'],
)
@jwt_required()
@requires_gm
def remove_character_from_location(
    lobby_id,
    location_id,
    character_id,
    lobby,
):
    location = Location.query.filter_by(id=location_id, lobby_id=lobby_id).first()
    if not location:
        return jsonify({'error': 'Location not found'}), 404

    location_characters = LocationCharacter.query.filter_by(
        location_id=location_id,
        character_id=character_id,
    ).all()
    if not location_characters:
        return jsonify({'error': 'Character is not in this location'}), 404

    removed_ids = {item.id for item in location_characters}
    combat_state = LocationCombatState.query.filter_by(location_id=location_id).first()
    if combat_state:
        old_order = list(dict.fromkeys(combat_state.turn_order or []))
        removed_current = combat_state.current_location_character_id in removed_ids
        current_index = (
            old_order.index(combat_state.current_location_character_id)
            if removed_current and combat_state.current_location_character_id in old_order
            else 0
        )
        new_order = [item_id for item_id in old_order if item_id not in removed_ids]
        combat_state.turn_order = new_order

        if not new_order:
            combat_state.current_location_character_id = None
            combat_state.turn_index = 0
            if combat_state.status == 'active':
                combat_state.status = 'idle'
        elif removed_current:
            next_index = min(current_index, len(new_order) - 1)
            combat_state.current_location_character_id = new_order[next_index]
            combat_state.turn_index = next_index
            if combat_state.status == 'active':
                next_character = db.session.get(
                    LocationCharacter,
                    combat_state.current_location_character_id,
                )
                if next_character:
                    CombatService._prepare_character_for_turn(next_character)
        elif combat_state.current_location_character_id in new_order:
            combat_state.turn_index = new_order.index(
                combat_state.current_location_character_id
            )

    for location_character in location_characters:
        db.session.delete(location_character)
    db.session.commit()

    socketio.emit(
        'location_character_removed',
        {
            'location_id': location_id,
            'character_id': character_id,
        },
        room=f"location_{location_id}",
    )
    if combat_state:
        socketio.emit(
            'combat_state_updated',
            CombatService._serialize_state(location, combat_state),
            room=f"location_{location_id}",
        )

    return jsonify({'message': 'Character removed from location'}), 200


@lobbies_bp.route(
    '/<int:lobby_id>/locations/<int:location_id>/characters/<int:character_id>/posture',
    methods=['PATCH'],
)
@jwt_required()
@requires_participant
def change_character_posture_outside_combat(
    lobby_id,
    location_id,
    character_id,
    lobby,
    participant,
):
    location = Location.query.filter_by(id=location_id, lobby_id=lobby_id).first()
    if not location:
        return jsonify({'error': 'Location not found'}), 404

    combat_state = LocationCombatState.query.filter_by(location_id=location_id).first()
    if combat_state and combat_state.status == 'active':
        return jsonify({'error': 'Use the combat action to change posture'}), 409

    location_character = LocationCharacter.query.filter_by(
        location_id=location_id,
        character_id=character_id,
    ).first()
    if not location_character:
        return jsonify({'error': 'Character is not in this location'}), 404

    user_id = participant.user_id
    can_control = (
        lobby.gm_id == user_id
        or location_character.controlled_by == user_id
        or (
            location_character.character
            and location_character.character.owner_id == user_id
        )
    )
    if not can_control:
        return jsonify({'error': 'You do not control this character'}), 403
    try:
        CombatService.ensure_character_can_act(location_character)
    except Exception as error:
        return jsonify({'error': str(error)}), 409

    target_posture = str((request.get_json() or {}).get('posture') or '').lower()
    if target_posture not in {'standing', 'sitting', 'prone'}:
        return jsonify({'error': 'Unknown posture'}), 400
    if target_posture == location_character.posture:
        return jsonify({'error': 'Character is already in this posture'}), 400

    location_character.posture = target_posture
    location_character.weapon_braced = False
    location_character.braced_weapon_index = None
    if target_posture == 'standing':
        location_character.cover_object_id = None
    db.session.commit()

    payload = {
        'location_id': location_id,
        'character_id': character_id,
        'posture': target_posture,
    }
    socketio.emit(
        'location_character_posture_updated',
        payload,
        room=f"location_{location_id}",
    )
    return jsonify(payload), 200


@lobbies_bp.route(
    '/<int:lobby_id>/locations/<int:location_id>/characters/<int:character_id>/interaction',
    methods=['GET'],
)
@jwt_required()
@requires_participant
def inspect_incapacitated_location_character(
    lobby_id,
    location_id,
    character_id,
    lobby,
    participant,
):
    actor_location_character_id = request.args.get('actor_location_character_id', type=int)
    if not actor_location_character_id:
        return jsonify({'error': 'actor_location_character_id is required'}), 400
    result = CombatService.inspect_incapacitated_character(
        location_id,
        participant.user_id,
        actor_location_character_id,
        character_id,
    )
    return jsonify(result), 200


@lobbies_bp.route(
    '/<int:lobby_id>/locations/<int:location_id>/characters/<int:character_id>/loot',
    methods=['POST'],
)
@jwt_required()
@requires_participant
def loot_incapacitated_location_character(
    lobby_id,
    location_id,
    character_id,
    lobby,
    participant,
):
    data = request.get_json() or {}
    actor_location_character_id = data.get('actor_location_character_id')
    if not actor_location_character_id:
        return jsonify({'error': 'actor_location_character_id is required'}), 400
    result = CombatService.loot_incapacitated_character(
        location_id,
        participant.user_id,
        actor_location_character_id,
        character_id,
        data.get('item_path'),
        data.get('amount', 1),
    )
    socketio.emit(
        'character_data_updated',
        {
            'character_id': character_id,
            'updates': {'data': result['target_data']},
            'updated_by': participant.user_id,
        },
        room=f"character_{character_id}",
    )
    actor = db.session.get(LocationCharacter, actor_location_character_id)
    if actor and actor.character:
        socketio.emit(
            'character_data_updated',
            {
                'character_id': actor.character.id,
                'updates': {'data': actor.character.data},
                'updated_by': participant.user_id,
            },
            room=f"character_{actor.character.id}",
        )
    return jsonify(result), 200


@lobbies_bp.route(
    '/<int:lobby_id>/locations/<int:location_id>/characters/<int:character_id>/treatment',
    methods=['PATCH'],
)
@jwt_required()
@requires_participant
def treat_incapacitated_location_character(
    lobby_id,
    location_id,
    character_id,
    lobby,
    participant,
):
    data = request.get_json() or {}
    actor_location_character_id = data.get('actor_location_character_id')
    if not actor_location_character_id:
        return jsonify({'error': 'actor_location_character_id is required'}), 400
    result = CombatService.update_incapacitated_character_health(
        location_id,
        participant.user_id,
        actor_location_character_id,
        character_id,
        data.get('health'),
    )
    socketio.emit(
        'character_data_updated',
        {
            'character_id': character_id,
            'updates': {'data': result['target_data']},
            'updated_by': participant.user_id,
        },
        room=f"character_{character_id}",
    )
    return jsonify(result), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/combat', methods=['GET'])
@jwt_required()
@requires_participant
def get_location_combat_state(lobby_id, location_id, lobby, participant):
    state = CombatService.get_state(location_id, participant.user_id)
    return jsonify(state), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/combat/start', methods=['POST'])
@jwt_required()
@requires_gm
def start_location_combat(lobby_id, location_id, lobby):
    data = request.get_json(silent=True) or {}
    state = CombatService.start_combat(
        location_id,
        lobby.gm_id,
        location_character_ids=data.get('location_character_ids'),
    )
    socketio.emit('combat_state_updated', state, room=f"location_{location_id}")
    participants = [
        character
        for character in (state.get('characters') or [])
        if character.get('initiative_roll') is not None
    ]
    participants.sort(
        key=lambda character: character.get('initiative_total') or 0,
        reverse=True,
    )
    initiative_lines = ['Инициатива:']
    for character in participants:
        bonus = character.get('initiative_bonus') or 0
        initiative_lines.append(
            f"{character.get('name') or 'Персонаж'}: "
            f"d20 {character.get('initiative_roll')} "
            f"{bonus:+d} = {character.get('initiative_total')}"
        )
    _emit_lobby_chat_message(
        lobby_id,
        lobby.gm_id,
        '\n'.join(initiative_lines),
    )
    return jsonify(state), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/combat/end_turn', methods=['POST'])
@jwt_required()
@requires_participant
def end_location_combat_turn(lobby_id, location_id, lobby, participant):
    data = request.get_json() or {}
    state = CombatService.end_turn(
        location_id,
        participant.user_id,
        location_character_id=data.get('location_character_id'),
    )
    socketio.emit('combat_state_updated', state, room=f"location_{location_id}")
    characters = LocationCharacter.query.filter_by(location_id=location_id).all()
    for loc_char in characters:
        character = loc_char.character
        if not character or not isinstance(character.data, dict):
            continue
        socketio.emit(
            'character_data_updated',
            {
                'character_id': character.id,
                'updates': {'data': character.data},
                'updated_by': 0,
            },
            room=f"character_{character.id}",
        )
    return jsonify(state), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/combat/end', methods=['POST'])
@jwt_required()
@requires_gm
def end_location_combat(lobby_id, location_id, lobby):
    state = CombatService.end_combat(location_id, lobby.gm_id)
    socketio.emit('combat_state_updated', state, room=f"location_{location_id}")
    characters = LocationCharacter.query.filter_by(location_id=location_id).all()
    for loc_char in characters:
        character = loc_char.character
        if not character or not isinstance(character.data, dict):
            continue
        socketio.emit(
            'character_data_updated',
            {
                'character_id': character.id,
                'updates': {'data': character.data},
                'updated_by': 0,
            },
            room=f"character_{character.id}",
        )
    return jsonify(state), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/combat/spend', methods=['POST'])
@jwt_required()
@requires_participant
def spend_location_combat_resources(lobby_id, location_id, lobby, participant):
    data = request.get_json() or {}
    location_character_id = data.get('location_character_id')
    if not location_character_id:
        return jsonify({'error': 'location_character_id is required'}), 400

    updated_character = CombatService.spend_resources(
        location_id,
        participant.user_id,
        location_character_id=location_character_id,
        action_points=data.get('action_points', 0),
        free_actions=data.get('free_actions', 0),
        movement_points=data.get('movement_points', 0),
        allow_deferred=bool(data.get('allow_deferred')),
        pending_action_id=data.get('pending_action_id'),
        pending_action_label=data.get('pending_action_label'),
    )
    state = updated_character.pop('state', None) or CombatService.get_state(location_id, participant.user_id)
    socketio.emit('combat_character_updated', updated_character, room=f"location_{location_id}")
    socketio.emit('combat_state_updated', state, room=f"location_{location_id}")
    return jsonify(updated_character), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/combat/adjust', methods=['POST'])
@jwt_required()
@requires_participant
def adjust_location_combat_resources(lobby_id, location_id, lobby, participant):
    data = request.get_json() or {}
    location_character_id = data.get('location_character_id')
    if not location_character_id:
        return jsonify({'error': 'location_character_id is required'}), 400
    updated_character = CombatService.adjust_resources(
        location_id,
        participant.user_id,
        location_character_id=location_character_id,
        action_points=data.get('action_points', 0),
        movement_points=data.get('movement_points', 0),
    )
    state = CombatService.get_state(location_id, participant.user_id)
    socketio.emit('combat_character_updated', updated_character, room=f"location_{location_id}")
    socketio.emit('combat_state_updated', state, room=f"location_{location_id}")
    return jsonify(updated_character), 200


@lobbies_bp.route('/<int:lobby_id>/locations/<int:location_id>/combat/action', methods=['POST'])
@jwt_required()
@requires_participant
def perform_location_combat_action(lobby_id, location_id, lobby, participant):
    data = request.get_json() or {}
    location_character_id = data.get('location_character_id')
    action_key = data.get('action_key')
    if not location_character_id or not action_key:
        return jsonify({'error': 'location_character_id and action_key are required'}), 400

    result = CombatService.perform_action(
        location_id,
        participant.user_id,
        location_character_id=location_character_id,
        action_key=action_key,
        weapon_index=data.get('weapon_index'),
        fire_mode=data.get('fire_mode'),
        shot_count=data.get('shot_count'),
        volley_count=data.get('volley_count'),
        action_points=data.get('action_points'),
        target_character_id=data.get('target_character_id'),
        target_character_ids=data.get('target_character_ids'),
        target_object_id=data.get('target_object_id'),
        area_center_x=data.get('area_center_x'),
        area_center_y=data.get('area_center_y'),
        target_x=data.get('target_x'),
        target_y=data.get('target_y'),
        posture=data.get('posture'),
        attack_type=data.get('attack_type'),
        target_zone=data.get('target_zone'),
        payment=data.get('payment'),
        magazine_template_id=data.get('magazine_template_id'),
        inventory_retrieval_action_points=data.get('inventory_retrieval_action_points'),
        inventory_use_action_discount=data.get('inventory_use_action_discount'),
        attribute_choice=data.get('attribute_choice'),
        pending_action_id=data.get('pending_action_id'),
        resume_pending_action_id=data.get('resume_pending_action_id'),
    )
    socketio.emit('combat_character_updated', result['character'], room=f"location_{location_id}")
    socketio.emit('combat_state_updated', result['state'], room=f"location_{location_id}")
    attack_summary = CombatService.format_attack_summary(result)
    if attack_summary:
        _emit_lobby_chat_message(
            lobby_id,
            participant.user_id,
            attack_summary,
        )
    affected_character_ids = {
        character_id
        for character_id in (
            [data.get('target_character_id')]
            + list(data.get('target_character_ids') or [])
        )
        if character_id
    }
    for character_id in affected_character_ids:
        target = db.session.get(LobbyCharacter, character_id)
        if target:
            socketio.emit(
                'character_data_updated',
                {
                    'character_id': target.id,
                    'updates': {'data': target.data},
                    'source': 'combat',
                },
                room=f"character_{target.id}",
            )
    return jsonify(result), 200
