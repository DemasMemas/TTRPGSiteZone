# app/models/lobby.py
from datetime import datetime, timezone
from app.extensions import db

class Lobby(db.Model):
    __tablename__ = 'lobbies'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    gm_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    is_active = db.Column(db.Boolean, default=True)
    invite_code = db.Column(db.String(10), unique=True, nullable=False)
    map_type = db.Column(db.String(20), nullable=False, default='empty')
    chunks_width = db.Column(db.Integer, nullable=False, default=16)
    chunks_height = db.Column(db.Integer, nullable=False, default=16)
    weather_settings = db.Column(db.JSON, default={})

    # связи
    gm = db.relationship('User', foreign_keys=[gm_id])
    participants = db.relationship('LobbyParticipant', backref='lobby', lazy=True, cascade='all, delete-orphan')