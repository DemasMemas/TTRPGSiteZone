# app/models/templates.py
from datetime import datetime
from app.extensions import db

class WeaponTemplate(db.Model):
    __tablename__ = 'weapon_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50))
    accuracy = db.Column(db.Integer, default=0)
    noise = db.Column(db.Integer, default=0)
    ammo = db.Column(db.String(50))
    range = db.Column(db.Integer, default=0)
    ergonomics = db.Column(db.Integer, default=0)
    burst = db.Column(db.String(10))
    damage = db.Column(db.Integer, default=0)
    durability = db.Column(db.Integer, default=100)
    fire_rate = db.Column(db.Integer, default=0)
    weight = db.Column(db.Float, default=0.0)
    caliber = db.Column(db.String(20))
    magazine_size = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class MeleeWeaponTemplate(db.Model):
    __tablename__ = 'melee_weapon_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50))
    damage = db.Column(db.Integer, default=0)
    durability = db.Column(db.Integer, default=100)
    weight = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class ArmorTemplate(db.Model):
    __tablename__ = 'armor_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    max_durability = db.Column(db.Integer, default=1)
    material = db.Column(db.String(50))
    movement_penalty = db.Column(db.Integer, default=0)
    container_slots = db.Column(db.Integer, default=0)
    protection = db.Column(db.JSON, default={})
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class HelmetTemplate(db.Model):
    __tablename__ = 'helmet_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    max_durability = db.Column(db.Integer, default=1)
    material = db.Column(db.String(50))
    accuracy_penalty = db.Column(db.Integer, default=0)
    ergonomics_penalty = db.Column(db.Integer, default=0)
    charisma_bonus = db.Column(db.Integer, default=0)
    protection = db.Column(db.JSON, default={})
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class GasMaskTemplate(db.Model):
    __tablename__ = 'gas_mask_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    max_durability = db.Column(db.Integer, default=1)
    filter_capacity = db.Column(db.Integer, default=0)
    material = db.Column(db.String(50))
    accuracy_penalty = db.Column(db.Integer, default=0)
    ergonomics_penalty = db.Column(db.Integer, default=0)
    charisma_bonus = db.Column(db.Integer, default=0)
    protection = db.Column(db.JSON, default={})
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class DetectorTemplate(db.Model):
    __tablename__ = 'detector_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(50))
    bonus = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class ContainerTemplate(db.Model):
    __tablename__ = 'container_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class ArtifactTemplate(db.Model):
    __tablename__ = 'artifact_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class BackpackTemplate(db.Model):
    __tablename__ = 'backpack_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    limit = db.Column(db.Integer, default=0)          # объём
    weight_reduction = db.Column(db.Integer, default=0)  # снижение штрафа веса
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class ConsumableTemplate(db.Model):
    __tablename__ = 'consumable_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class CraftingMaterialTemplate(db.Model):
    __tablename__ = 'crafting_material_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class ModificationTemplate(db.Model):
    __tablename__ = 'modification_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(50))
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class BackgroundTemplate(db.Model):
    __tablename__ = 'background_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    pluses = db.Column(db.Text)
    minuses = db.Column(db.Text)
    skill_bonuses = db.Column(db.JSON, default=list)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class SpecialTraitTemplate(db.Model):
    __tablename__ = 'special_trait_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    effect = db.Column(db.String(200))
    cost = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class OrganizationTemplate(db.Model):
    __tablename__ = 'organization_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

class EffectTemplate(db.Model):
    __tablename__ = 'effect_templates'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)