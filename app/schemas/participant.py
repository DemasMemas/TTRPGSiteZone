# app/schemas/participant.py
from marshmallow import Schema, fields

class ParticipantSchema(Schema):
    user_id = fields.Int()
    username = fields.Str(attribute='user.username')
    joined_at = fields.DateTime()
    is_banned = fields.Bool()

class BannedUserSchema(Schema):
    user_id = fields.Int()
    username = fields.Str()