import copy

from flask import Blueprint, request, jsonify, render_template
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db, socketio
from app.models import Lobby, LobbyParticipant, User, GameState, LobbyCharacter, MapChunk
import random
import string

CHUNK_SIZE = 32

lobbies_bp = Blueprint('lobbies', __name__)

@lobbies_bp.route('/', methods=['POST'])
@jwt_required()
def create_lobby():
    user_id = get_jwt_identity()
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Lobby name is required'}), 400

    map_type = data.get('map_type', 'empty')  # по умолчанию 'empty'
    if map_type not in ['empty', 'random', 'predefined']:
        return jsonify({'error': 'Invalid map type'}), 400

    code = generate_invite_code()
    while Lobby.query.filter_by(invite_code=code).first():
        code = generate_invite_code()

    lobby = Lobby(name=data['name'], gm_id=user_id, invite_code=code, map_type=map_type)
    db.session.add(lobby)
    db.session.flush()

    participant = LobbyParticipant(lobby_id=lobby.id, user_id=user_id)
    db.session.add(participant)
    db.session.commit()

    return jsonify({
        'id': lobby.id,
        'name': lobby.name,
        'gm_id': lobby.gm_id,
        'invite_code': lobby.invite_code,
        'created_at': lobby.created_at
    }), 201

@lobbies_bp.route('/', methods=['GET'])
@jwt_required()
def list_lobbies():
    lobbies = Lobby.query.filter_by(is_active=True).all()
    result = []
    for lobby in lobbies:
        result.append({
            'id': lobby.id,
            'name': lobby.name,
            'gm_id': lobby.gm_id,
            'participants_count': len(lobby.participants)
        })
    return jsonify(result), 200

@lobbies_bp.route('/<int:lobby_id>', methods=['GET'])
@jwt_required()
def get_lobby(lobby_id):
    user_id = get_jwt_identity()
    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    # Проверим, что пользователь является участником (опционально, но лучше оставить)
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'You are not in this lobby'}), 403

    participants = [{'user_id': p.user_id, 'username': p.user.username} for p in lobby.participants]
    return jsonify({
        'id': lobby.id,
        'name': lobby.name,
        'gm_id': lobby.gm_id,
        'gm_username': lobby.gm.username,
        'invite_code': lobby.invite_code,  # <-- добавили
        'participants': participants,
        'created_at': lobby.created_at
    }), 200

@lobbies_bp.route('/<int:lobby_id>/join', methods=['POST'])
@jwt_required()
def join_lobby(lobby_id):
    user_id = get_jwt_identity()
    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    # Проверяем, не участник ли уже
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if participant:
        # Если уже есть – всё равно считаем успехом (перенаправляем в лобби)
        return jsonify({'message': 'Already in lobby'}), 200

    participant = LobbyParticipant(lobby_id=lobby_id, user_id=user_id)
    db.session.add(participant)
    db.session.commit()
    return jsonify({'message': 'Joined lobby'}), 200

@lobbies_bp.route('/<int:lobby_id>/leave', methods=['POST'])
@jwt_required()
def leave_lobby(lobby_id):
    user_id = get_jwt_identity()
    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'Not in lobby'}), 400

    # ГМ не может покинуть лобби (или можно разрешить, но тогда лобби останется без ГМ)
    if lobby.gm_id == user_id:
        return jsonify({'error': 'GM cannot leave lobby'}), 400

    db.session.delete(participant)
    db.session.commit()
    return jsonify({'message': 'Left lobby'}), 200

@lobbies_bp.route('/<int:lobby_id>', methods=['DELETE'])
@jwt_required()
def delete_lobby(lobby_id):
    user_id = get_jwt_identity()

    try:
        user_id = int(user_id)
    except ValueError:
        return jsonify({'error': 'Invalid user id'}), 400

    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    if lobby.gm_id != user_id:
        return jsonify({'error': 'Only GM can delete lobby'}), 403

    lobby.is_active = False  # мягкое удаление
    db.session.commit()
    return jsonify({'message': 'Lobby deleted'}), 200

@lobbies_bp.route('/<int:lobby_id>/page')
def lobby_page(lobby_id):
    return render_template('lobby.html')

@lobbies_bp.route('/<int:lobby_id>/select_character', methods=['POST'])
@jwt_required()
def select_character(lobby_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    character_id = data.get('character_id')
    if not character_id:
        return jsonify({'error': 'character_id required'}), 400

    character = LobbyCharacter.query.filter_by(id=character_id, user_id=user_id).first()
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
    user_id = get_jwt_identity()
    print(f"DEBUG: user_id={user_id}, lobby_id={lobby_id}")

    # Проверяем, что пользователь состоит в лобби
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        print("DEBUG: User not in lobby")
        return jsonify({'error': 'You are not in this lobby'}), 403

    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        print("DEBUG: Lobby not found")
        return jsonify({'error': 'Lobby not found'}), 404

    is_gm = (lobby.gm_id == user_id)
    print(f"DEBUG: is_gm={is_gm}")

    # Получаем всех участников лобби
    participants = LobbyParticipant.query.filter_by(lobby_id=lobby_id).all()
    print(f"DEBUG: Found {len(participants)} participants in lobby")

    result = []
    for p in participants:
        # Если не ГМ и это не текущий пользователь, пропускаем
        pass

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
                print(f"DEBUG: Participant {p.user_id} has character {char.name}")
            else:
                user_data['character'] = None
                print(f"DEBUG: Participant {p.user_id} has invalid character_id {p.character_id}")
        else:
            user_data['character'] = None
            print(f"DEBUG: Participant {p.user_id} has no character selected")

        result.append(user_data)

    print(f"DEBUG: Returning {len(result)} participants")
    return jsonify(result), 200

@lobbies_bp.route('/<int:lobby_id>/map', methods=['GET'])
@jwt_required()
def get_map(lobby_id):
    user_id = get_jwt_identity()
    # Проверяем, что пользователь в лобби
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'Not in lobby'}), 403

    game_state = GameState.query.filter_by(lobby_id=lobby_id).first()
    if not game_state:
        # Если нет состояния, создаём пустое
        game_state = GameState(lobby_id=lobby_id)
        db.session.add(game_state)
        db.session.commit()

    return jsonify(game_state.map_data), 200

def generate_invite_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

@lobbies_bp.route('/join_by_code', methods=['POST'])
@jwt_required()
def join_by_code():
    user_id = get_jwt_identity()
    data = request.get_json()
    code = data.get('code')
    if not code:
        return jsonify({'error': 'Code is required'}), 400

    lobby = Lobby.query.filter_by(invite_code=code, is_active=True).first()
    if not lobby:
        return jsonify({'error': 'Invalid or inactive code'}), 404

    # Проверяем, не участник ли уже
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby.id, user_id=user_id).first()
    if participant:
        return jsonify({'message': 'Already in lobby', 'lobby_id': lobby.id}), 200

    participant = LobbyParticipant(lobby_id=lobby.id, user_id=user_id)
    db.session.add(participant)
    db.session.commit()
    return jsonify({'message': 'Joined lobby', 'lobby_id': lobby.id}), 200

@lobbies_bp.route('/my', methods=['GET'])
@jwt_required()
def get_my_lobbies():
    user_id = get_jwt_identity()
    try:
        user_id = int(user_id)
    except:
        return jsonify({'error': 'Invalid user id'}), 400

    lobbies = Lobby.query.filter_by(gm_id=user_id, is_active=True).all()
    result = [{
        'id': l.id,
        'name': l.name,
        'created_at': l.created_at,
        'invite_code': l.invite_code
    } for l in lobbies]
    return jsonify(result), 200

@lobbies_bp.route('/<int:lobby_id>/ban/<int:user_id>', methods=['POST'])
@jwt_required()
def ban_participant(lobby_id, user_id):
    current_user_id = get_jwt_identity()
    try:
        current_user_id = int(current_user_id)
    except:
        return jsonify({'error': 'Invalid user id'}), 400

    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    # Только ГМ может банить
    if lobby.gm_id != current_user_id:
        return jsonify({'error': 'Only GM can ban participants'}), 403

    # Нельзя забанить самого ГМа
    if user_id == current_user_id:
        return jsonify({'error': 'Cannot ban yourself'}), 400

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'User is not in this lobby'}), 404

    participant.is_banned = True
    db.session.commit()

    from app.socket_events import kick_user
    kick_user(user_id, lobby_id)

    return jsonify({'message': 'User banned'}), 200

@lobbies_bp.route('/<int:lobby_id>/banned', methods=['GET'])
@jwt_required()
def get_banned_participants(lobby_id):
    current_user_id = get_jwt_identity()
    try:
        current_user_id = int(current_user_id)
    except:
        return jsonify({'error': 'Invalid user id'}), 400

    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    if lobby.gm_id != current_user_id:
        return jsonify({'error': 'Only GM can view banned list'}), 403

    banned = LobbyParticipant.query.filter_by(lobby_id=lobby_id, is_banned=True).all()
    result = [{
        'user_id': p.user_id,
        'username': p.user.username
    } for p in banned]
    return jsonify(result), 200


@lobbies_bp.route('/<int:lobby_id>/unban/<int:user_id>', methods=['POST'])
@jwt_required()
def unban_participant(lobby_id, user_id):
    current_user_id = get_jwt_identity()
    try:
        current_user_id = int(current_user_id)
    except:
        return jsonify({'error': 'Invalid user id'}), 400

    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    if lobby.gm_id != current_user_id:
        return jsonify({'error': 'Only GM can unban participants'}), 403

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'User not found in lobby'}), 404

    if not participant.is_banned:
        return jsonify({'error': 'User is not banned'}), 400

    participant.is_banned = False
    db.session.commit()
    return jsonify({'message': 'User unbanned'}), 200

@lobbies_bp.route('/<int:lobby_id>/characters', methods=['GET'])
@jwt_required()
def get_lobby_characters(lobby_id):
    user_id = get_jwt_identity()
    try:
        user_id = int(user_id)
    except:
        return jsonify({'error': 'Invalid user id'}), 400

    # Проверяем, что пользователь участник лобби
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'You are not in this lobby'}), 403

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

    return jsonify(result), 200

@lobbies_bp.route('/<int:lobby_id>/characters', methods=['POST'])
@jwt_required()
def create_lobby_character(lobby_id):
    user_id = get_jwt_identity()
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'You are not in this lobby'}), 403

    character = LobbyCharacter(
        lobby_id=lobby_id,
        owner_id=user_id,
        name=data['name'],
        data=data.get('data', {}),
        visible_to=[]
    )
    db.session.add(character)
    db.session.commit()

    socketio.emit('character_created', {
        'id': character.id,
        'name': character.name,
        'owner_id': character.owner_id,
        'owner_username': character.owner.username,
        'data': character.data
    }, room=f"lobby_{lobby_id}")

    return jsonify({
        'id': character.id,
        'name': character.name,
        'owner_id': character.owner_id,
        'data': character.data
    }), 201

@lobbies_bp.route('/characters/<int:character_id>', methods=['GET'])
@jwt_required()
def get_character(character_id):
    user_id = get_jwt_identity()
    character = LobbyCharacter.query.get(character_id)
    if not character:
        return jsonify({'error': 'Character not found'}), 404

    # Проверяем, что пользователь в том же лобби
    participant = LobbyParticipant.query.filter_by(lobby_id=character.lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'Access denied'}), 403

    return jsonify({
        'id': character.id,
        'name': character.name,
        'owner_id': character.owner_id,
        'owner_username': character.owner.username,
        'data': character.data,
        'created_at': character.created_at,
        'updated_at': character.updated_at
    }), 200

@lobbies_bp.route('/characters/<int:character_id>', methods=['PUT'])
@jwt_required()
def update_character(character_id):
    user_id = get_jwt_identity()
    character = LobbyCharacter.query.get(character_id)
    if not character:
        return jsonify({'error': 'Character not found'}), 404

    # Проверяем права: владелец или ГМ
    lobby = Lobby.query.get(character.lobby_id)
    if character.owner_id != user_id and lobby.gm_id != user_id:
        return jsonify({'error': 'Permission denied'}), 403

    data = request.get_json()
    if 'name' in data:
        character.name = data['name']
    if 'data' in data:
        character.data = data['data']
    db.session.commit()
    return jsonify({'message': 'Character updated'}), 200

@lobbies_bp.route('/characters/<int:character_id>', methods=['DELETE'])
@jwt_required()
def delete_character(character_id):
    user_id = get_jwt_identity()
    try:
        user_id = int(user_id)
    except:
        return jsonify({'error': 'Invalid user id'}), 400

    character = LobbyCharacter.query.get(character_id)
    if not character:
        return jsonify({'error': 'Character not found'}), 404

    lobby = Lobby.query.get(character.lobby_id)
    if character.owner_id != user_id and lobby.gm_id != user_id:
        return jsonify({'error': 'Permission denied'}), 403

    db.session.delete(character)
    db.session.commit()
    socketio.emit('character_deleted', {'id': character_id}, room=f"lobby_{character.lobby_id}")

    return jsonify({'message': 'Character deleted'}), 200

@lobbies_bp.route('/characters/<int:character_id>/visibility', methods=['PUT'])
@jwt_required()
def set_character_visibility(character_id):
    user_id = get_jwt_identity()
    try:
        user_id = int(user_id)
    except:
        return jsonify({'error': 'Invalid user id'}), 400

    character = LobbyCharacter.query.get(character_id)
    if not character:
        return jsonify({'error': 'Character not found'}), 404

    lobby = Lobby.query.get(character.lobby_id)
    # Только ГМ может менять видимость
    if lobby.gm_id != user_id:
        return jsonify({'error': 'Only GM can change visibility'}), 403

    data = request.get_json()
    if 'visible_to' not in data or not isinstance(data['visible_to'], list):
        return jsonify({'error': 'visible_to must be a list of user_ids'}), 400

    character.visible_to = data['visible_to']
    db.session.commit()

    # Оповещаем всех в лобби об изменении (чтобы обновили список)
    from app import socketio
    socketio.emit('character_updated', {
        'id': character.id,
        'visible_to': character.visible_to
    }, room=f"lobby_{character.lobby_id}")

    return jsonify({'message': 'Visibility updated'}), 200

@lobbies_bp.route('/<int:lobby_id>/chunks/<int:chunk_x>/<int:chunk_y>/tile/<int:tile_x>/<int:tile_y>', methods=['PATCH'])
@jwt_required()
def update_tile(lobby_id, chunk_x, chunk_y, tile_x, tile_y):
    user_id = get_jwt_identity()
    try:
        user_id = int(user_id)
    except ValueError:
        return jsonify({'error': 'Invalid user id'}), 400

    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        return jsonify({'error': 'Lobby not found'}), 404

    if lobby.gm_id != user_id:
        return jsonify({'error': 'Only GM can edit tiles'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    if not (0 <= tile_x < CHUNK_SIZE and 0 <= tile_y < CHUNK_SIZE):
        return jsonify({'error': f'Tile coordinates must be between 0 and {CHUNK_SIZE-1}'}), 400

    chunk = MapChunk.query.filter_by(lobby_id=lobby_id, chunk_x=chunk_x, chunk_y=chunk_y).first()
    if not chunk:
        chunk = MapChunk(lobby_id=lobby_id, chunk_x=chunk_x, chunk_y=chunk_y, data=default_chunk_data())
        db.session.add(chunk)

    # Проверка структуры (опционально)
    if not chunk.data or len(chunk.data) != CHUNK_SIZE or len(chunk.data[0]) != CHUNK_SIZE:
        chunk.data = default_chunk_data()

    new_chunk_data = copy.deepcopy(chunk.data)
    for key, value in data.items():
        new_chunk_data[tile_y][tile_x][key] = value
    chunk.data = new_chunk_data

    try:
        db.session.commit()
        print(f"✅ Tile ({tile_x},{tile_y}) in chunk ({chunk_x},{chunk_y}) updated and committed")

    except Exception as e:
        db.session.rollback()
        print(f"Error committing: {e}")
        return jsonify({'error': 'Database error'}), 500

    allowed_fields = ['type', 'color', 'height']
    safe_updates = {k: v for k, v in data.items() if k in allowed_fields}
    socketio.emit('tile_updated', {
        'chunk_x': chunk_x,
        'chunk_y': chunk_y,
        'tile_x': tile_x,
        'tile_y': tile_y,
        'updates': safe_updates
    }, room=f"lobby_{lobby_id}")

    return jsonify({'message': 'Tile updated'}), 200

def default_chunk_data():
    return [[{'type': 'grass', 'color': '#3a5f0b', 'height': 1.0} for _ in range(CHUNK_SIZE)] for _ in range(CHUNK_SIZE)]

@lobbies_bp.route('/<int:lobby_id>/chunks', methods=['GET'])
@jwt_required()
def get_chunks(lobby_id):
    user_id = get_jwt_identity()
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'Not in lobby'}), 403

    min_x = request.args.get('min_chunk_x', type=int)
    max_x = request.args.get('max_chunk_x', type=int)
    min_y = request.args.get('min_chunk_y', type=int)
    max_y = request.args.get('max_chunk_y', type=int)
    if None in (min_x, max_x, min_y, max_y):
        return jsonify({'error': 'Missing bounds'}), 400

    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        return jsonify({'error': 'Lobby not found'}), 404

    result = []
    for cx in range(min_x, max_x + 1):
        for cy in range(min_y, max_y + 1):
            chunk = MapChunk.query.filter_by(lobby_id=lobby_id, chunk_x=cx, chunk_y=cy).first()
            if chunk:
                print(
                    f"📦 Returning existing chunk ({cx},{cy}) from DB, first tile: {chunk.data[0][0] if chunk.data else 'no data'}")
            else:
                print(f"🆕 Creating new chunk ({cx},{cy}) with map_type {lobby.map_type}")
                data = generate_chunk_data(lobby_id, cx, cy, lobby.map_type)
                chunk = MapChunk(lobby_id=lobby_id, chunk_x=cx, chunk_y=cy, data=data)
                db.session.add(chunk)
            result.append({
                'chunk_x': chunk.chunk_x,
                'chunk_y': chunk.chunk_y,
                'data': chunk.data
            })
    db.session.commit()
    return jsonify(result), 200

def generate_chunk_data(lobby_id, chunk_x, chunk_y, map_type):
    CHUNK_SIZE = 32
    MAX_CHUNK = 15
    data = []
    for y in range(CHUNK_SIZE):
        row = []
        for x in range(CHUNK_SIZE):
            global_x = chunk_x * CHUNK_SIZE + x
            global_y = chunk_y * CHUNK_SIZE + y

            # базовая высота
            base_height = 1.0
            # небольшая вариация для микрорельефа (кроме воды)
            height_variation = random.uniform(-0.05, 0.05)

            if map_type == 'empty':
                tile_type = 'grass'
                color = '#3a5f0b'
                height = base_height + height_variation

            elif map_type == 'random':
                r = random.random()
                if r < 0.1:
                    tile_type = 'forest'
                    color = '#2d5a27'
                elif r < 0.12:
                    tile_type = 'house'
                    color = '#8B4513'
                else:
                    tile_type = 'grass'
                    color = '#3a5f0b'
                height = base_height + height_variation

            elif map_type == 'predefined':
                # края мира: например, отступ 2 тайла от границы
                margin = 2
                max_global = (MAX_CHUNK + 1) * CHUNK_SIZE - 1
                if (global_x < margin or global_x > max_global - margin or
                    global_y < margin or global_y > max_global - margin):
                    tile_type = 'water'
                    color = '#1E90FF'
                    height = 0.8  # вода чуть ниже, без вариации
                else:
                    r = random.random()
                    if r < 0.15:
                        tile_type = 'forest'
                        color = '#2d5a27'
                    elif r < 0.18:
                        tile_type = 'house'
                        color = '#8B4513'
                    else:
                        tile_type = 'grass'
                        color = '#3a5f0b'
                    height = base_height + height_variation
            else:
                tile_type = 'grass'
                color = '#3a5f0b'
                height = base_height

            row.append({
                'type': tile_type,
                'color': color,
                'height': round(height, 3)  # округлим для читаемости
            })
        data.append(row)
    return data