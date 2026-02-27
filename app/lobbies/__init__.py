from flask import Blueprint, request, jsonify, render_template, redirect
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Lobby, LobbyParticipant, User, Character, GameState
import random
import string

lobbies_bp = Blueprint('lobbies', __name__)

@lobbies_bp.route('/', methods=['POST'])
@jwt_required()
def create_lobby():
    user_id = get_jwt_identity()
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Lobby name is required'}), 400

    # Генерируем уникальный код
    code = generate_invite_code()
    # Проверяем на уникальность (на случай коллизии)
    while Lobby.query.filter_by(invite_code=code).first():
        code = generate_invite_code()

    lobby = Lobby(name=data['name'], gm_id=user_id, invite_code=code)
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

    character = Character.query.filter_by(id=character_id, user_id=user_id).first()
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
            char = Character.query.get(p.character_id)
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