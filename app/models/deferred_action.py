from app.extensions import db


class DeferredCombatAction(db.Model):
    __tablename__ = 'deferred_combat_actions'

    id = db.Column(db.String(120), primary_key=True)
    location_character_id = db.Column(db.Integer, db.ForeignKey('location_characters.id', ondelete='CASCADE'), nullable=False, index=True)
    payload = db.Column(db.JSON, nullable=False)
    label = db.Column(db.String(200), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='paying')
    remaining_action_points = db.Column(db.Integer, nullable=False)
    revision = db.Column(db.Integer, nullable=False, default=1, server_default='1')
    __mapper_args__ = {'version_id_col': revision}
