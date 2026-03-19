# app/lobbies/__init__.py
import json
import gzip
import io
from flask import Blueprint, request, jsonify, render_template, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.extensions import socketio, db
from app.services.lobby import LobbyService
from app.services.participant import ParticipantService
from app.services.map import MapService
from app.services.character import CharacterService
from app.schemas.lobby import LobbyCreateSchema, LobbyDetailSchema, LobbyMySchema, LobbySchema
from app.schemas.participant import BannedUserSchema
from app.schemas.character import CharacterSchema, CharacterCreateSchema
from app.schemas.map import GameStateSchema, MapChunkSchema, TileUpdateSchema
from app.models import LobbyParticipant, GameState, LobbyCharacter
from app.utils.decorators import requires_participant, requires_gm

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

@lobbies_bp.route('/<int:lobby_id>/select_character', methods=['POST'])
@jwt_required()
@requires_participant
def select_character(lobby_id, lobby, participant):
    data = request.get_json()
    character_id = data.get('character_id')
    if not character_id:
        return jsonify({'error': 'character_id required'}), 400

    character = LobbyCharacter.query.filter_by(id=character_id, owner_id=participant.user_id).first()
    if not character:
        return jsonify({'error': 'Character not found or not yours'}), 404

    participant.character_id = character_id
    db.session.commit()
    return jsonify({'message': 'Character selected'}), 200

@lobbies_bp.route('/<int:lobby_id>/participants_characters', methods=['GET'])
@jwt_required()
@requires_participant
def get_participants_characters(lobby_id, lobby, participant):
    is_gm = (lobby.gm_id == participant.user_id)

    participants = LobbyParticipant.query.filter_by(lobby_id=lobby_id).all()
    result = []
    for p in participants:
        user_data = {
            'user_id': p.user_id,
            'username': p.user.username
        }
        if p.character_id:
            char = LobbyCharacter.query.get(p.character_id)
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
    return jsonify(schema.dump(character)), 200

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
    character = CharacterService.set_visibility(character_id, user_id, data['visible_to'])
    socketio.emit('character_updated', {
        'id': character.id,
        'visible_to': character.visible_to
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