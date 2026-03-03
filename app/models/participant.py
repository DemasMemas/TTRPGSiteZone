# app/models/participant.py
from datetime import datetime, timezone
from app.extensions import db

class LobbyParticipant(db.Model):
    __tablename__ = 'lobby_participants'
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), primary_key=True)
    joined_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    is_banned = db.Column(db.Boolean, default=False)
    user = db.relationship('User')