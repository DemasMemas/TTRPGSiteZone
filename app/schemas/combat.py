from marshmallow import Schema, fields


class CombatParticipantSchema(Schema):
    location_character_id = fields.Int(attribute='id')
    character_id = fields.Int(attribute='character.id', allow_none=True)
    name = fields.Method('get_name')
    owner_id = fields.Int(attribute='character.owner_id', allow_none=True)
    owner_username = fields.Method('get_owner_username')
    controlled_by = fields.Int(allow_none=True)
    x = fields.Int(attribute='pos_x')
    y = fields.Int(attribute='pos_y')
    status = fields.Str()
    initiative_bonus = fields.Int()
    initiative_roll = fields.Int(allow_none=True)
    initiative_total = fields.Int(allow_none=True)
    action_points_max = fields.Int()
    action_points_current = fields.Int()
    free_actions_max = fields.Int()
    free_actions_current = fields.Int()
    movement_points_max = fields.Int()
    movement_points_current = fields.Int()
    movement_mode_this_turn = fields.Str(allow_none=True)
    movement_distance_this_turn = fields.Int()
    correction_distance_this_turn = fields.Int()
    strenuous_movement_blocked_until_round = fields.Int()
    posture = fields.Str()
    hp_zones = fields.Dict()
    effects = fields.List(fields.Raw())
    is_current_turn = fields.Boolean(dump_default=False)

    def get_name(self, obj):
        return obj.character.name if obj.character else None

    def get_owner_username(self, obj):
        if not obj.character or not obj.character.owner:
            return None
        return obj.character.owner.username


class CombatStateSchema(Schema):
    location_id = fields.Int()
    status = fields.Str()
    round_number = fields.Int()
    turn_index = fields.Int()
    turn_order = fields.List(fields.Int())
    current_location_character_id = fields.Int(allow_none=True)
    current_character = fields.Nested(CombatParticipantSchema, allow_none=True)
    characters = fields.List(fields.Nested(CombatParticipantSchema))
