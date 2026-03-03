# app/models/character.py
from datetime import datetime, timezone
from app.extensions import db

class LobbyCharacter(db.Model):
    __tablename__ = 'lobby_characters'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    data = db.Column(db.JSON, nullable=False, default={})
    visible_to = db.Column(db.JSON, nullable=False, default=list)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref='characters')
    owner = db.relationship('User', foreign_keys=[owner_id])