from app.extensions import db
from datetime import datetime, timezone


class LocationCharacter(db.Model):
    __tablename__ = 'location_characters'
    id = db.Column(db.Integer, primary_key=True)
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=False)
    character_id = db.Column(db.Integer, db.ForeignKey('lobby_characters.id'), nullable=False)
    pos_x = db.Column(db.Integer, nullable=False, default=0)
    pos_y = db.Column(db.Integer, nullable=False, default=0)
    status = db.Column(db.String(20), default='idle')
    last_action = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    controlled_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    controller = db.relationship('User', foreign_keys=[controlled_by])

    hp_zones = db.Column(db.JSON, nullable=False, default=lambda: {
        'head': {'current': 50, 'max': 50},
        'chest': {'current': 150, 'max': 150},
        'abdomen': {'current': 120, 'max': 120},
        'left_arm': {'current': 90, 'max': 90},
        'right_arm': {'current': 90, 'max': 90},
        'left_leg': {'current': 100, 'max': 100},
        'right_leg': {'current': 100, 'max': 100}
    })
    effects = db.Column(db.JSON, default=list)

    location = db.relationship('Location', backref='location_participants')
    character = db.relationship('LobbyCharacter')