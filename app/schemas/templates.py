# app/schemas/templates.py
from marshmallow import Schema, fields

class WeaponTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    category = fields.Str()
    accuracy = fields.Int()
    noise = fields.Int()
    ammo = fields.Str()
    range = fields.Int()
    ergonomics = fields.Int()
    burst = fields.Str()
    damage = fields.Int()
    durability = fields.Int()
    fire_rate = fields.Int()
    weight = fields.Float()
    caliber = fields.Str()
    magazine_size = fields.Int()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class MeleeWeaponTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    category = fields.Str()
    damage = fields.Int()
    durability = fields.Int()
    weight = fields.Float()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class ArmorTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    max_durability = fields.Int()
    material = fields.Str()
    movement_penalty = fields.Int()
    container_slots = fields.Int()
    protection = fields.Dict()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class HelmetTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    max_durability = fields.Int()
    material = fields.Str()
    accuracy_penalty = fields.Int()
    ergonomics_penalty = fields.Int()
    charisma_bonus = fields.Int()
    protection = fields.Dict()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class GasMaskTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    max_durability = fields.Int()
    filter_capacity = fields.Int()
    material = fields.Str()
    accuracy_penalty = fields.Int()
    ergonomics_penalty = fields.Int()
    charisma_bonus = fields.Int()
    protection = fields.Dict()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class DetectorTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    type = fields.Str()
    bonus = fields.Int()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class ContainerTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    effect = fields.Str()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class ArtifactTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    weight = fields.Float()
    volume = fields.Float()
    effect = fields.Str()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class BackpackTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    limit = fields.Int()
    weight_reduction = fields.Int()   # новое поле
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class ConsumableTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    weight = fields.Float()
    volume = fields.Float()
    effect = fields.Str()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class CraftingMaterialTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    weight = fields.Float()
    volume = fields.Float()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class ModificationTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    type = fields.Str()
    effect = fields.Str()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class BackgroundTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    pluses = fields.Str()
    minuses = fields.Str()
    skill_bonuses = fields.List(fields.Dict())
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class SpecialTraitTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    effect = fields.Str()
    cost = fields.Int()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class OrganizationTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    description = fields.Str()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)

class EffectTemplateSchema(Schema):
    id = fields.Int(dump_only=True)
    name = fields.Str(required=True)
    description = fields.Str()
    created_at = fields.DateTime(dump_only=True)
    updated_at = fields.DateTime(dump_only=True)