from datetime import datetime, timezone

from app.extensions import db


class ConsumableUse(db.Model):
    __tablename__ = 'consumable_uses'

    id = db.Column(db.String(120), primary_key=True)
    actor_character_id = db.Column(db.Integer, db.ForeignKey('lobby_characters.id', ondelete='CASCADE'), nullable=False)
    target_character_id = db.Column(db.Integer, db.ForeignKey('lobby_characters.id', ondelete='CASCADE'), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
