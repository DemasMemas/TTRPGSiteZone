from marshmallow import Schema, fields
from .templates import ItemTemplateSchema

class LobbyItemTemplateSchema(ItemTemplateSchema):
    lobby_id = fields.Int(load_only=True)
    created_by = fields.Int(dump_only=True)