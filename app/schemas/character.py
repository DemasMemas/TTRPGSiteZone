# app/schemas/character.py
from marshmallow import Schema, fields, validate

class CharacterCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    data = fields.Dict(load_default=dict)

class CharacterSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str()
    owner_id = fields.Int()
    owner_username = fields.Method("get_owner_username")
    data = fields.Method('get_data')
    visible_to = fields.List(fields.Int())
    editable_to = fields.List(fields.Int())
    time_active = fields.Bool()
    created_at = fields.DateTime()
    updated_at = fields.DateTime()
    revision = fields.Int(dump_only=True)

    def get_data(self, obj):
        return obj.data_snapshot()

    def get_owner_username(self, obj):
        return obj.owner.username if obj.owner is not None else None
