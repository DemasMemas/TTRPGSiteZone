# app/auth/__init__.py
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from marshmallow import ValidationError as MarshmallowValidationError
from app.extensions import db
from app.models import User
from app.schemas.user import UserSchema, UserLoginSchema, UserProfileSchema

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    schema = UserSchema()
    try:
        data = schema.load(request.get_json())
    except MarshmallowValidationError as err:
        error_messages = []
        for field, messages in err.messages.items():
            error_messages.append(f"{field}: {', '.join(messages)}")
        return jsonify({'error': '; '.join(error_messages)}), 400

    # Дополнительная проверка уже выполняется в валидаторах схемы
    user = User(username=data['username'], email=data['email'])
    user.set_password(data['password'])
    db.session.add(user)
    db.session.commit()

    return jsonify({'message': 'User created successfully'}), 201

@auth_bp.route('/login', methods=['POST'])
def login():
    schema = UserLoginSchema()
    try:
        data = schema.load(request.get_json())
    except MarshmallowValidationError as err:
        return jsonify({'error': err.messages}), 400

    user = User.query.filter_by(username=data['username']).first()
    if not user or not user.check_password(data['password']):
        return jsonify({'error': 'Invalid credentials'}), 401

    access_token = create_access_token(identity=str(user.id))
    return jsonify({
        'access_token': access_token,
        'user_id': user.id
    }), 200

@auth_bp.route('/profile', methods=['GET'])
@jwt_required()
def profile():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    schema = UserProfileSchema()
    return jsonify(schema.dump(user)), 200