from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from flask import render_template
from flask_socketio import SocketIO

db = SQLAlchemy()
migrate = Migrate()
jwt = JWTManager()
socketio = SocketIO()

def create_app():
    app = Flask(__name__)
    app.config['JSON_AS_ASCII'] = False
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///app.db'
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['JWT_SECRET_KEY'] = 'super-secret-key'
    app.config['SECRET_KEY'] = 'super-secret-key'  # нужен для работы сессий SocketIO

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    socketio.init_app(app, cors_allowed_origins="*")  # для разработки разрешим все источники

    from app.auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix='/auth')

    from app.characters import characters_bp
    app.register_blueprint(characters_bp, url_prefix='/characters')

    from app.lobbies import lobbies_bp
    app.register_blueprint(lobbies_bp, url_prefix='/lobbies')

    # Позже подключим обработчики сокетов
    from app import socket_events  # создадим этот модуль

    @app.route('/')
    def index():
        return render_template('index.html')

    return app