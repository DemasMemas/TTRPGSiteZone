from datetime import datetime, timezone

from app.extensions import db
from app.utils.defaults import empty_list


class LocationCombatState(db.Model):
    __tablename__ = 'location_combat_states'

    id = db.Column(db.Integer, primary_key=True)
    location_id = db.Column(
        db.Integer,
        db.ForeignKey('locations.id', ondelete='CASCADE'),
        unique=True,
        nullable=False,
    )
    status = db.Column(db.String(20), nullable=False, default='idle')
    round_number = db.Column(db.Integer, nullable=False, default=0)
    turn_index = db.Column(db.Integer, nullable=False, default=0)
    turn_order = db.Column(db.JSON, nullable=False, default=empty_list)
    current_location_character_id = db.Column(
        db.Integer,
        db.ForeignKey('location_characters.id'),
        nullable=True,
    )
    reaction_pending_location_character_id = db.Column(
        db.Integer,
        db.ForeignKey('location_characters.id'),
        nullable=True,
    )
    reaction_return_location_character_id = db.Column(
        db.Integer,
        db.ForeignKey('location_characters.id'),
        nullable=True,
    )
    started_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))

    location = db.relationship(
        'Location',
        backref=db.backref('combat_state', uselist=False, cascade='all, delete-orphan'),
    )
    current_character = db.relationship(
        'LocationCharacter',
        foreign_keys=[current_location_character_id],
    )
