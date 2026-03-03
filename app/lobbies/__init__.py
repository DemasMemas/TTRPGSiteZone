# app/lobbies/__init__.py
import json
import gzip
import io
from flask import Blueprint, request, jsonify, render_template, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from marshmallow import ValidationError as MarshmallowValidationError
from app.extensions import socketio, db
from app.services.lobby import LobbyService
from app.services.participant import ParticipantService
from app.services.map import MapService
from app.services.character import CharacterService
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError as ServiceValidationError
from app.schemas.lobby import LobbyCreateSchema, LobbyDetailSchema, LobbyMySchema, LobbySchema
from app.schemas.participant import ParticipantSchema, BannedUserSchema
from app.schemas.character import CharacterSchema, CharacterCreateSchema
from app.schemas.map import GameStateSchema, MapChunkSchema, TileUpdateSchema
from app.models import LobbyParticipant, GameState, LobbyCharacter

lobbies_bp = Blueprint('lobbies', __name__)

def handle_service_error(e):
    if isinstance(e, NotFoundError):
        return jsonify({'error': str(e)}), 404
    if isinstance(e, PermissionDenied):
        return jsonify({'error': str(e)}), 403
    if isinstance(e, ServiceValidationError):
        return jsonify({'error': str(e)}), 400
    return jsonify({'error': 'Internal server error'}), 500

@lobbies_bp.route('/', methods=['POST'])
@jwt_required()
def create_lobby():
    user_id = int(get_jwt_identity())
    try:
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
            except Exception as e:
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
    except MarshmallowValidationError as e:
        error_messages = []
        for field, messages in e.messages.items():
            error_messages.append(f"{field}: {', '.join(messages)}")
        return jsonify({'error': '; '.join(error_messages)}), 400
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/', methods=['GET'])
@jwt_required()
def list_lobbies():
    try:
        lobbies = LobbyService.list_active_lobbies()
        # Используем LobbySchema (или можно создать отдельный список)
        schema = LobbySchema(many=True)
        return jsonify(schema.dump(lobbies)), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>', methods=['GET'])
@jwt_required()
def get_lobby(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        lobby = LobbyService.get_lobby(lobby_id, user_id)
        schema = LobbyDetailSchema()
        return jsonify(schema.dump(lobby)), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/join', methods=['POST'])
@jwt_required()
def join_lobby(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        ParticipantService.join_lobby(user_id, lobby_id)
        return jsonify({'message': 'Joined lobby'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/leave', methods=['POST'])
@jwt_required()
def leave_lobby(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        ParticipantService.leave_lobby(user_id, lobby_id)
        return jsonify({'message': 'Left lobby'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>', methods=['DELETE'])
@jwt_required()
def delete_lobby(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        LobbyService.delete_lobby(lobby_id, user_id)
        return jsonify({'message': 'Lobby deleted'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/page')
def lobby_page(lobby_id):
    return render_template('lobby.html')

@lobbies_bp.route('/<int:lobby_id>/select_character', methods=['POST'])
@jwt_required()
def select_character(lobby_id):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    character_id = data.get('character_id')
    if not character_id:
        return jsonify({'error': 'character_id required'}), 400

    character = LobbyCharacter.query.filter_by(id=character_id, owner_id=user_id).first()
    if not character:
        return jsonify({'error': 'Character not found or not yours'}), 404

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'You are not in this lobby'}), 403

    participant.character_id = character_id
    db.session.commit()
    return jsonify({'message': 'Character selected'}), 200

@lobbies_bp.route('/<int:lobby_id>/participants_characters', methods=['GET'])
@jwt_required()
def get_participants_characters(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
        if not participant:
            return jsonify({'error': 'You are not in this lobby'}), 403

        lobby = LobbyService.get_lobby(lobby_id, user_id)
        is_gm = (lobby.gm_id == user_id)

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
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/map', methods=['GET'])
@jwt_required()
def get_map(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
        if not participant:
            return jsonify({'error': 'Not in lobby'}), 403

        game_state = GameState.query.filter_by(lobby_id=lobby_id).first()
        if not game_state:
            game_state = GameState(lobby_id=lobby_id)
            db.session.add(game_state)
            db.session.commit()

        schema = GameStateSchema()
        return jsonify(schema.dump(game_state.map_data)), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/join_by_code', methods=['POST'])
@jwt_required()
def join_by_code():
    user_id = int(get_jwt_identity())
    data = request.get_json()
    code = data.get('code')
    if not code:
        return jsonify({'error': 'Code is required'}), 400
    try:
        lobby = LobbyService.join_by_code(user_id, code)
        return jsonify({'message': 'Joined lobby', 'lobby_id': lobby.id}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/my', methods=['GET'])
@jwt_required()
def get_my_lobbies():
    user_id = int(get_jwt_identity())
    try:
        lobbies = LobbyService.get_my_lobbies(user_id)
        schema = LobbyMySchema(many=True)
        return jsonify(schema.dump(lobbies)), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/ban/<int:user_id>', methods=['POST'])
@jwt_required()
def ban_participant(lobby_id, user_id):
    current_user_id = int(get_jwt_identity())
    try:
        ParticipantService.ban_user(current_user_id, lobby_id, user_id)
        return jsonify({'message': 'User banned'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/banned', methods=['GET'])
@jwt_required()
def get_banned_participants(lobby_id):
    current_user_id = int(get_jwt_identity())
    try:
        banned = ParticipantService.get_banned_list(current_user_id, lobby_id)
        schema = BannedUserSchema(many=True)
        return jsonify(schema.dump(banned)), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/unban/<int:user_id>', methods=['POST'])
@jwt_required()
def unban_participant(lobby_id, user_id):
    current_user_id = int(get_jwt_identity())
    try:
        ParticipantService.unban_user(current_user_id, lobby_id, user_id)
        return jsonify({'message': 'User unbanned'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/characters', methods=['GET'])
@jwt_required()
def get_lobby_characters(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        characters = CharacterService.get_lobby_characters(lobby_id, user_id)
        schema = CharacterSchema(many=True)
        return jsonify(schema.dump(characters)), 200
    except Exception as e:
        return handle_service_error(e)


@lobbies_bp.route('/<int:lobby_id>/characters', methods=['POST'])
@jwt_required()
def create_lobby_character(lobby_id):
    user_id = int(get_jwt_identity())
    schema = CharacterCreateSchema()
    try:
        data = schema.load(request.get_json())
    except MarshmallowValidationError as e:
        error_messages = []
        for field, messages in e.messages.items():
            error_messages.append(f"{field}: {', '.join(messages)}")
        return jsonify({'error': '; '.join(error_messages)}), 400

    try:
        character = CharacterService.create_character(
            lobby_id=lobby_id,
            owner_id=user_id,
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
    except Exception as e:
        print(f"Error creating character: {e}")
        import traceback
        traceback.print_exc()
        return handle_service_error(e)

@lobbies_bp.route('/characters/<int:character_id>', methods=['GET'])
@jwt_required()
def get_character(character_id):
    user_id = int(get_jwt_identity())
    try:
        character = CharacterService.get_character(character_id, user_id)
        schema = CharacterSchema()
        return jsonify(schema.dump(character)), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/characters/<int:character_id>', methods=['PUT'])
@jwt_required()
def update_character(character_id):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    try:
        character = CharacterService.update_character(character_id, user_id, data)
        return jsonify({'message': 'Character updated'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/characters/<int:character_id>', methods=['DELETE'])
@jwt_required()
def delete_character(character_id):
    user_id = int(get_jwt_identity())
    try:
        character = CharacterService.get_character(character_id, user_id)
        CharacterService.delete_character(character_id, user_id)
        socketio.emit('character_deleted', {'id': character_id}, room=f"lobby_{character.lobby_id}")
        return jsonify({'message': 'Character deleted'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/characters/<int:character_id>/visibility', methods=['PUT'])
@jwt_required()
def set_character_visibility(character_id):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    if 'visible_to' not in data or not isinstance(data['visible_to'], list):
        return jsonify({'error': 'visible_to must be a list'}), 400
    try:
        character = CharacterService.set_visibility(character_id, user_id, data['visible_to'])
        socketio.emit('character_updated', {
            'id': character.id,
            'visible_to': character.visible_to
        }, room=f"lobby_{character.lobby_id}")
        return jsonify({'message': 'Visibility updated'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/chunks/<int:chunk_x>/<int:chunk_y>/tile/<int:tile_x>/<int:tile_y>', methods=['PATCH'])
@jwt_required()
def update_tile(lobby_id, chunk_x, chunk_y, tile_x, tile_y):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    schema = TileUpdateSchema()
    try:
        updates = schema.load(data)
    except MarshmallowValidationError as e:
        error_messages = []
        for field, messages in e.messages.items():
            error_messages.append(f"{field}: {', '.join(messages)}")
        return jsonify({'error': '; '.join(error_messages)}), 400

    try:
        MapService.update_tile(lobby_id, user_id, chunk_x, chunk_y, tile_x, tile_y, updates)
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
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/chunks', methods=['GET'])
@jwt_required()
def get_chunks(lobby_id):
    user_id = int(get_jwt_identity())
    min_x = request.args.get('min_chunk_x', type=int)
    max_x = request.args.get('max_chunk_x', type=int)
    min_y = request.args.get('min_chunk_y', type=int)
    max_y = request.args.get('max_chunk_y', type=int)
    if None in (min_x, max_x, min_y, max_y):
        return jsonify({'error': 'Missing bounds'}), 400
    try:
        chunks = MapService.get_chunks(lobby_id, user_id, (min_x, max_x, min_y, max_y))
        schema = MapChunkSchema(many=True)
        return jsonify(schema.dump(chunks)), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/chunks/batch', methods=['POST'])
@jwt_required()
def batch_update_tiles(lobby_id):
    user_id = int(get_jwt_identity())
    data = request.get_json()
    if not data or not isinstance(data, list):
        return jsonify({'error': 'Expected a list of updates'}), 400

    # Можно добавить валидацию каждого элемента, но для краткости пропустим
    try:
        MapService.batch_update_tiles(lobby_id, user_id, data)
        socketio.emit('tiles_updated', data, room=f"lobby_{lobby_id}")
        return jsonify({'message': 'Tiles updated successfully'}), 200
    except Exception as e:
        return handle_service_error(e)

@lobbies_bp.route('/<int:lobby_id>/export', methods=['GET'])
@jwt_required()
def export_lobby(lobby_id):
    user_id = int(get_jwt_identity())
    try:
        export_data = MapService.export_map(lobby_id, user_id)
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
    except Exception as e:
        return handle_service_error(e)