# app/schemas/map.py
from marshmallow import Schema, fields

class GameStateSchema(Schema):
    width = fields.Int()
    height = fields.Int()
    markers = fields.List(fields.Dict())

class MapChunkSchema(Schema):
    chunk_x = fields.Int()
    chunk_y = fields.Int()
    data = fields.List(fields.List(fields.Dict()))

class TileUpdateSchema(Schema):
    terrain = fields.Str(allow_none=True)
    height = fields.Float(allow_none=True)
    objects = fields.List(fields.Dict(), allow_none=True)