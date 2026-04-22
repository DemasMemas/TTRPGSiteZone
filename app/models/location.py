from app.extensions import db
from datetime import datetime, timezone

class Location(db.Model):
    __tablename__ = 'locations'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text, default='')
    type = db.Column(db.String(20), nullable=False, default='exploration')  # battle, social, exploration
    grid_width = db.Column(db.Integer, nullable=False, default=20)
    grid_height = db.Column(db.Integer, nullable=False, default=20)
    tiles_data = db.Column(db.JSON, nullable=False, default=list)
    world_tile_x = db.Column(db.Integer, nullable=False)
    world_tile_z = db.Column(db.Integer, nullable=False)
    world_radius = db.Column(db.Integer, default=0)
    spawn_points = db.Column(db.JSON, default=list)  # [{x, y, character_id?}]
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))

    lobby = db.relationship('Lobby', backref='locations')