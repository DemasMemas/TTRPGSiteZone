from app.extensions import db
from datetime import datetime, timezone

class LocationCharacter(db.Model):
    __tablename__ = 'location_characters'
    id = db.Column(db.Integer, primary_key=True)
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=False)
    character_id = db.Column(db.Integer, db.ForeignKey('lobby_characters.id'), nullable=False)
    pos_x = db.Column(db.Integer, nullable=False, default=0)
    pos_y = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(20), default='idle')  # idle, in_combat
    last_action = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    location = db.relationship('Location', backref='participants')
    character = db.relationship('LobbyCharacter')