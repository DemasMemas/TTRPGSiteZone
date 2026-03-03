# app/models/map_chunk.py
from datetime import datetime, timezone
from app.extensions import db

class MapChunk(db.Model):
    __tablename__ = 'map_chunks'
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), primary_key=True)
    chunk_x = db.Column(db.Integer, primary_key=True)
    chunk_y = db.Column(db.Integer, primary_key=True)
    data = db.Column(db.JSON, nullable=False, default=list)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref=db.backref('chunks', lazy='dynamic'))