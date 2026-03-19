# app/models/templates.py
from datetime import datetime, timezone
from app.extensions import db


class ItemTemplate(db.Model):
    __tablename__ = 'item_templates'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)  # название
    category = db.Column(db.String(50), nullable=False,
                         index=True)  # категория (weapon, armor, helmet, consumable и т.д.)
    subcategory = db.Column(db.String(50), index=True)  # подкатегория (pistol, rifle, light_armor и т.п.)
    item_class = db.Column(db.String(50))  # класс/тип предмета (например, "Лёгкое", "Тяжёлое", "1", "2" и т.д.)
    description = db.Column(db.Text)  # описание

    # Базовые характеристики
    price = db.Column(db.Integer, default=0)
    weight = db.Column(db.Float, default=0.0)
    volume = db.Column(db.Float, default=0.0)  # объём/размер в инвентаре

    # Универсальный JSON для всех специфических атрибутов
    attributes = db.Column(db.JSON, nullable=False, default={})

    # Список ID шаблонов, с которыми этот предмет совместим (например, магазины для оружия)
    compatible_ids = db.Column(db.JSON, default=list)

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, onupdate=lambda: datetime.now(timezone.utc))