# app/lobbies/__init__.py
import json
import gzip
import io
from copy import deepcopy
from flask import Blueprint, request, jsonify, render_template, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.extensions import socketio, db
from app.services.lobby import LobbyService
from app.services.participant import ParticipantService
from app.services.map import MapService
from app.services.character import CharacterService
from app.services.combat import CombatService
from app.services.health import apply_health_maximums
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
    allowed = ['name', 'description', 'type', 'tiles_data', 'spawn_points']
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
    )
    state = CombatService.get_state(location_id, participant.user_id)
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
