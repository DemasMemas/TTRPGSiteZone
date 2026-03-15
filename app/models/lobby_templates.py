# app/models/lobby_templates.py
from datetime import datetime
from app.extensions import db

class LobbyWeaponTemplate(db.Model):
    __tablename__ = 'lobby_weapon_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
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

    lobby = db.relationship('Lobby', backref='weapon_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyMeleeWeaponTemplate(db.Model):
    __tablename__ = 'lobby_melee_weapon_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    category = db.Column(db.String(50))
    damage = db.Column(db.Integer, default=0)
    durability = db.Column(db.Integer, default=100)
    weight = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='melee_weapon_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyArmorTemplate(db.Model):
    __tablename__ = 'lobby_armor_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    max_durability = db.Column(db.Integer, default=1)
    material = db.Column(db.String(50))
    movement_penalty = db.Column(db.Integer, default=0)
    container_slots = db.Column(db.Integer, default=0)
    protection = db.Column(db.JSON, default={})  # {physical, chemical, thermal, electric, radiation}
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='armor_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyHelmetTemplate(db.Model):
    __tablename__ = 'lobby_helmet_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    max_durability = db.Column(db.Integer, default=1)
    material = db.Column(db.String(50))
    accuracy_penalty = db.Column(db.Integer, default=0)
    ergonomics_penalty = db.Column(db.Integer, default=0)
    charisma_bonus = db.Column(db.Integer, default=0)
    protection = db.Column(db.JSON, default={})
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='helmet_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyGasMaskTemplate(db.Model):
    __tablename__ = 'lobby_gas_mask_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
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

    lobby = db.relationship('Lobby', backref='gas_mask_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyDetectorTemplate(db.Model):
    __tablename__ = 'lobby_detector_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(50))  # 'anomaly' или 'artifact'
    bonus = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='detector_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyContainerTemplate(db.Model):
    __tablename__ = 'lobby_container_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='container_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyArtifactTemplate(db.Model):
    __tablename__ = 'lobby_artifact_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='artifact_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyBackpackTemplate(db.Model):
    __tablename__ = 'lobby_backpack_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    limit = db.Column(db.Integer, default=0)  # объём
    weight_reduction = db.Column(db.Integer, default=0)  # снижение штрафа веса
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='backpack_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyConsumableTemplate(db.Model):
    __tablename__ = 'lobby_consumable_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='consumable_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyCraftingMaterialTemplate(db.Model):
    __tablename__ = 'lobby_crafting_material_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='crafting_material_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyModificationTemplate(db.Model):
    __tablename__ = 'lobby_modification_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(50))  # например, 'weapon', 'armor', 'helmet' и т.д.
    effect = db.Column(db.String(200))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='modification_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyBackgroundTemplate(db.Model):
    __tablename__ = 'lobby_background_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    pluses = db.Column(db.Text)
    minuses = db.Column(db.Text)
    skill_bonuses = db.Column(db.JSON, default=list)  # список {skill, bonus}
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='background_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbySpecialTraitTemplate(db.Model):
    __tablename__ = 'lobby_special_trait_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    effect = db.Column(db.String(200))
    cost = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='special_trait_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyOrganizationTemplate(db.Model):
    __tablename__ = 'lobby_organization_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='organization_templates')
    creator = db.relationship('User', foreign_keys=[created_by])

class LobbyEffectTemplate(db.Model):
    __tablename__ = 'lobby_effect_templates'
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey('lobbies.id', ondelete='CASCADE'), nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    lobby = db.relationship('Lobby', backref='effect_templates')
    creator = db.relationship('User', foreign_keys=[created_by])