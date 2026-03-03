# app/schemas/character.py
from marshmallow import Schema, fields, validate

class CharacterCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    data = fields.Dict(load_default={})

class CharacterSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str()
    owner_id = fields.Int()
    owner_username = fields.Method("get_owner_username")
    data = fields.Dict()
    visible_to = fields.List(fields.Int())
    created_at = fields.DateTime()
    updated_at = fields.DateTime()

    def get_owner_username(self, obj):
        return obj.owner.username if obj.owner is not None else None