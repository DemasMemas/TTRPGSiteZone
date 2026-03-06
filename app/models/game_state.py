# app/models/game_state.py
from datetime import datetime, timezone
from app.extensions import db

class GameState(db.Model):
    __tablename__ = 'game_states'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), unique=True, nullable=False)
    map_data = db.Column(db.JSON, nullable=False, default=lambda: {
        'width': 10,
        'height': 10,
        'markers': []
    })
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref=db.backref('game_state', uselist=False))