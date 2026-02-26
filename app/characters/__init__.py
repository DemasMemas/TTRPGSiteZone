from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Character

characters_bp = Blueprint('characters', __name__)


@characters_bp.route('/', methods=['GET'])
@jwt_required()
def get_characters():
    user_id = get_jwt_identity()
    characters = Character.query.filter_by(user_id=user_id).all()
    return jsonify([{
        'id': c.id,
        'name': c.name,
        'data': c.data,
        'created_at': c.created_at,
        'updated_at': c.updated_at
    } for c in characters]), 200


@characters_bp.route('/', methods=['POST'])
@jwt_required()
def create_character():
    user_id = get_jwt_identity()
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'Name is required'}), 400

    character = Character(
        name=data['name'],
        user_id=user_id,
        data=data.get('data', {})  # если data не передана, будет пустой словарь
    )
    db.session.add(character)
    db.session.commit()

    return jsonify({
        'id': character.id,
        'name': character.name,
        'data': character.data
    }), 201


@characters_bp.route('/<int:character_id>', methods=['PUT'])
@jwt_required()
def update_character(character_id):
    user_id = get_jwt_identity()
    character = Character.query.filter_by(id=character_id, user_id=user_id).first()
    if not character:
        return jsonify({'error': 'Character not found'}), 404

    data = request.get_json()
    if 'name' in data:
        character.name = data['name']
    if 'data' in data:
        character.data = data['data']

    db.session.commit()
    return jsonify({
        'id': character.id,
        'name': character.name,
        'data': character.data
    }), 200


@characters_bp.route('/<int:character_id>', methods=['DELETE'])
@jwt_required()
def delete_character(character_id):
    user_id = get_jwt_identity()
    character = Character.query.filter_by(id=character_id, user_id=user_id).first()
    if not character:
        return jsonify({'error': 'Character not found'}), 404

    db.session.delete(character)
    db.session.commit()
    return jsonify({'message': 'Character deleted'}), 200