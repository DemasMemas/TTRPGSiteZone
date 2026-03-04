# app/__init__.py
from flask import Flask, render_template, jsonify
from app.extensions import db, migrate, jwt, socketio
from app.config import config_by_name
from app.services.exceptions import (
    ServiceError, ValidationError, NotFoundError, PermissionDenied
)
from marshmallow import ValidationError as MarshmallowValidationError

def create_app(config_name='default'):
    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    socketio.init_app(app, cors_allowed_origins="*")

    from app.auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix='/auth')

    from app.lobbies import lobbies_bp
    app.register_blueprint(lobbies_bp, url_prefix='/lobbies')

    from app.sockets import auth, chat, dice, markers

    @app.route('/')
    def index():
        return render_template('index.html')

    # ---- Централизованная обработка ошибок ----
    @app.errorhandler(ValidationError)
    @app.errorhandler(NotFoundError)
    @app.errorhandler(PermissionDenied)
    def handle_service_error(error):
        response = jsonify({
            'error': {
                'code': getattr(error, 'code', 400),
                'message': str(error)
            }
        })
        if isinstance(error, NotFoundError):
            response.status_code = 404
        elif isinstance(error, PermissionDenied):
            response.status_code = 403
        else:
            response.status_code = 400
        return response

    @app.errorhandler(MarshmallowValidationError)
    def handle_marshmallow_error(error):
        details = {}
        for field, messages in error.messages.items():
            details[field] = messages if isinstance(messages, list) else [messages]
        return jsonify({
            'error': {
                'code': 400,
                'message': 'Validation error',
                'details': details
            }
        }), 400

    @app.errorhandler(404)
    def handle_404(error):
        return jsonify({
            'error': {
                'code': 404,
                'message': 'Resource not found'
            }
        }), 404

    @app.errorhandler(500)
    def handle_500(error):
        return jsonify({
            'error': {
                'code': 500,
                'message': 'Internal server error'
            }
        }), 500

    return app