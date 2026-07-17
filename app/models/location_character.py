from app.extensions import db
from datetime import datetime, timezone
from app.utils.defaults import default_hp_zones, empty_list


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

    hp_zones = db.Column(db.JSON, nullable=False, default=default_hp_zones)
    effects = db.Column(db.JSON, default=empty_list)

    location = db.relationship('Location', backref='location_participants')
    character = db.relationship('LobbyCharacter')
