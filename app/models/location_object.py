from app.extensions import db

class LocationObject(db.Model):
    __tablename__ = 'location_objects'
    id = db.Column(db.Integer, primary_key=True)
    location_id = db.Column(db.Integer, db.ForeignKey('locations.id'), nullable=False)
    name = db.Column(db.String(100))
    type = db.Column(db.String(50))   # door, chest, cover, wall
    tile_x = db.Column(db.Integer, nullable=False)
    tile_y = db.Column(db.Integer, nullable=False)
    properties = db.Column(db.JSON, default=dict)  # {'locked': False, 'health': 50}

    location = db.relationship('Location', backref='objects')