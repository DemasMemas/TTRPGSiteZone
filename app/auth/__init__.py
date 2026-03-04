import logging
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from app.extensions import db
from app.models import User
from app.schemas.user import UserSchema, UserLoginSchema, UserProfileSchema

logger = logging.getLogger(__name__)
auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    schema = UserSchema()
    data = schema.load(request.get_json())
    user = User(username=data['username'], email=data['email'])
    user.set_password(data['password'])
    db.session.add(user)
    db.session.commit()
    logger.info(f"New user registered: {user.username}")
    return jsonify({'message': 'User created successfully'}), 201

@auth_bp.route('/login', methods=['POST'])
def login():
    schema = UserLoginSchema()
    data = schema.load(request.get_json())
    user = User.query.filter_by(username=data['username']).first()
    if not user or not user.check_password(data['password']):
        logger.warning(f"Failed login attempt for username: {data['username']}")
        return jsonify({'error': 'Invalid credentials'}), 401
    access_token = create_access_token(identity=str(user.id))
    logger.info(f"User logged in: {user.username}")
    return jsonify({'access_token': access_token, 'user_id': user.id}), 200

@auth_bp.route('/profile', methods=['GET'])
@jwt_required()
def profile():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    schema = UserProfileSchema()
    return jsonify(schema.dump(user)), 200