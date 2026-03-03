from flask import Flask, render_template
from app.extensions import db, migrate, jwt, socketio
from app.config import config_by_name


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

    from app import socket_events

    @app.route('/')
    def index():
        return render_template('index.html')

    return app