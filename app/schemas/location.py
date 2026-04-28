from marshmallow import Schema, fields, validate

class LocationCreateSchema(Schema):
    name = fields.Str(required=True, validate=validate.Length(min=1, max=100))
    description = fields.Str(load_default='')
    type = fields.Str(load_default='exploration', validate=validate.OneOf(['battle', 'social', 'exploration']))
    grid_width = fields.Int(load_default=20, validate=validate.Range(min=5, max=200))
    grid_height = fields.Int(load_default=20, validate=validate.Range(min=5, max=200))
    tiles_data = fields.List(fields.List(fields.Dict()), load_default=[])
    world_tile_x = fields.Int(required=True)
    world_tile_z = fields.Int(required=True)
    world_radius = fields.Int(load_default=0)
    spawn_points = fields.List(fields.Dict(), load_default=[])

class LocationSchema(Schema):
    id = fields.Int(dump_only=True)
    lobby_id = fields.Int(dump_only=True)
    name = fields.Str()
    description = fields.Str()
    type = fields.Str()
    grid_width = fields.Int(load_default=20, validate=validate.Range(min=5, max=200))
    grid_height = fields.Int(load_default=20, validate=validate.Range(min=5, max=200))
    tiles_data = fields.List(fields.Dict())
    world_tile_x = fields.Int()
    world_tile_z = fields.Int()
    world_radius = fields.Int()
    spawn_points = fields.List(fields.Dict())
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class LocationObjectSchema(Schema):
    id = fields.Int(dump_only=True)
    location_id = fields.Int(load_only=True)
    name = fields.Str()
    type = fields.Str()
    tile_x = fields.Int()
    tile_y = fields.Int()
    properties = fields.Dict()