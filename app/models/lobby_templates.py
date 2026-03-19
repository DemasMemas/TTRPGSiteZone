# app/models/lobby_templates.py
from datetime import datetime, timezone
from app.extensions import db


class LobbyItemTemplate(db.Model):
    __tablename__ = 'lobby_item_templates'

    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)

    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    subcategory = db.Column(db.String(50))
    item_class = db.Column(db.String(50))
    description = db.Column(db.Text)
    price = db.Column(db.Integer, default=0)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)
    attributes = db.Column(db.JSON, nullable=False, default={})
    compatible_ids = db.Column(db.JSON, default=list)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref='item_templates')
    creator = db.relationship('User', foreign_keys=[created_by])