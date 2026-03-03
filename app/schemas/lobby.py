# app/schemas/lobby.py
from marshmallow import Schema, fields, validate, validates, ValidationError
from app.constants import MAX_CHUNKS_WIDTH, MAX_CHUNKS_HEIGHT
from app.models import Lobby

class LobbyCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    map_type = fields.Str(load_default='empty', validate=validate.OneOf(['empty', 'random', 'predefined', 'imported']))
    chunks_width = fields.Int(load_default=16, validate=validate.Range(min=1, max=MAX_CHUNKS_WIDTH))
    chunks_height = fields.Int(load_default=16, validate=validate.Range(min=1, max=MAX_CHUNKS_HEIGHT))

class LobbySchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str()
    gm_id = fields.Int()
    invite_code = fields.Str()
    created_at = fields.DateTime()
    is_active = fields.Bool()
    map_type = fields.Str()
    chunks_width = fields.Int()
    chunks_height = fields.Int()

class LobbyResponseSchema(LobbySchema):
    participants_count = fields.Method("get_participants_count")
    gm_username = fields.Method("get_gm_username")

    def get_participants_count(self, obj):
        return len(obj.participants)

    def get_gm_username(self, obj):
        return obj.gm.username if obj.gm else None

class LobbyDetailSchema(LobbyResponseSchema):
    participants = fields.Nested('ParticipantSchema', many=True, only=('user_id', 'username'))

class LobbyMySchema(Schema):
    id = fields.Int()
    name = fields.Str()
    created_at = fields.DateTime()
    invite_code = fields.Str()