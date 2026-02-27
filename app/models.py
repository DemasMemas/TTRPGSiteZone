from datetime import datetime, timezone

from app import db
from werkzeug.security import generate_password_hash, check_password_hash

class User(db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Lobby(db.Model):
    __tablename__ = 'lobbies'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    gm_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    is_active = db.Column(db.Boolean, default=True)
    invite_code = db.Column(db.String(10), unique=True, nullable=False)

    # связи
    gm = db.relationship('User', foreign_keys=[gm_id])
    participants = db.relationship('LobbyParticipant', backref='lobby', lazy=True, cascade='all, delete-orphan')

class LobbyParticipant(db.Model):
    __tablename__ = 'lobby_participants'
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    joined_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    is_banned = db.Column(db.Boolean, default=False)
    user = db.relationship('User')

class GameState(db.Model):
    __tablename__ = 'game_states'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), unique=True, nullable=False)
    map_data = db.Column(db.JSON, nullable=False, default={
        'width': 10,
        'height': 10,
        'markers': []
    })
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref=db.backref('game_state', uselist=False))

class ChatMessage(db.Model):
    __tablename__ = 'chat_messages'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    username = db.Column(db.String(80), nullable=False)
    message = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref='chat_messages')
    user = db.relationship('User')


class LobbyCharacter(db.Model):
    __tablename__ = 'lobby_characters'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)  # кто создал
    name = db.Column(db.String(100), nullable=False)
    data = db.Column(db.JSON, nullable=False, default={})
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref='characters')
    owner = db.relationship('User')