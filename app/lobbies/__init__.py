from flask import Blueprint, request, jsonify, render_template
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Lobby, LobbyParticipant, User, Character

lobbies_bp = Blueprint('lobbies', __name__)

@lobbies_bp.route('/', methods=['POST'])
@jwt_required()
def create_lobby():
    user_id = get_jwt_identity()
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Lobby name is required'}), 400

    lobby = Lobby(name=data['name'], gm_id=user_id)
    db.session.add(lobby)
    db.session.flush()  # <-- добавляем эту строку

    participant = LobbyParticipant(lobby_id=lobby.id, user_id=user_id)
    db.session.add(participant)
    db.session.commit()

    return jsonify({
        'id': lobby.id,
        'name': lobby.name,
        'gm_id': lobby.gm_id,
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
    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    participants = [{'user_id': p.user_id, 'username': p.user.username} for p in lobby.participants]
    return jsonify({
        'id': lobby.id,
        'name': lobby.name,
        'gm_id': lobby.gm_id,
        'gm_username': lobby.gm.username,
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
    if LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first():
        return jsonify({'error': 'Already in lobby'}), 400

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
    lobby = Lobby.query.get(lobby_id)
    if not lobby or not lobby.is_active:
        return jsonify({'error': 'Lobby not found'}), 404

    if lobby.gm_id != user_id:
        return jsonify({'error': 'Only GM can delete lobby'}), 403

    lobby.is_active = False  # мягкое удаление
    db.session.commit()
    return jsonify({'message': 'Lobby deleted'}), 200

@lobbies_bp.route('/<int:lobby_id>/page', methods=['GET'])
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
    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user_id).first()
    if not participant:
        return jsonify({'error': 'You are not in this lobby'}), 403

    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        return jsonify({'error': 'Lobby not found'}), 404

    is_gm = (lobby.gm_id == user_id)
    participants = LobbyParticipant.query.filter_by(lobby_id=lobby_id).all()
    result = []
    for p in participants:
        if not is_gm and p.user_id != user_id:
            continue
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
            else:
                user_data['character'] = None
        else:
            user_data['character'] = None
        result.append(user_data)
    return jsonify(result), 200