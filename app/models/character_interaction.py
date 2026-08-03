from datetime import datetime, timezone

from app.extensions import db


class CharacterInteractionRequest(db.Model):
    __tablename__ = 'character_interaction_requests'

    id = db.Column(db.Integer, primary_key=True)
    location_id = db.Column(
        db.Integer,
        db.ForeignKey('locations.id', ondelete='CASCADE'),
        nullable=False,
        index=True,
    )
    actor_location_character_id = db.Column(
        db.Integer,
        db.ForeignKey('location_characters.id', ondelete='CASCADE'),
        nullable=False,
    )
    target_location_character_id = db.Column(
        db.Integer,
        db.ForeignKey('location_characters.id', ondelete='CASCADE'),
        nullable=False,
    )
    actor_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    target_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending', index=True)
    payload = db.Column(db.JSON, nullable=False, default=dict)
    result = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    resolved_at = db.Column(db.DateTime, nullable=True)

