from __future__ import annotations

from app import create_app
from app.extensions import db
from app.models.templates import ItemTemplate
from app.services.consumable_effects import parse_consumable_effects


MANUAL_CONSUMABLE_FIXUPS = {
    "Протеин": {
        "direct": {
            "rest_heal_multiplier": 2,
            "requires_water_fraction": 1 / 3,
        },
        "effects": [
            {"type": "generic", "name": "Отдых x2", "value": 2, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Требует воды 1/3", "value": 0, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Антисептический тампон": {
        "effects": [
            {"type": "generic", "name": "Бонус медикамента +1", "value": 1, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Останавливает лёгкое кровотечение", "value": 0, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Пластырь с гемостатиком": {
        "effects": [
            {"type": "generic", "name": "Бонус медикамента +2", "value": 2, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Останавливает среднее кровотечение", "value": 0, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Пластырь \"Стазис\"": {
        "effects": [
            {"type": "generic", "name": "Бонус медикамента +3", "value": 3, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Останавливает среднее/сильное кровотечение", "value": 0, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Губка коллагеновая": {
        "direct": {
            "bleeding_stop_light_cost": 1,
            "bleeding_stop_medium_cost": 2,
            "bleeding_stop_type": "external",
        },
        "effects": [
            {"type": "generic", "name": "Останавливает слабое кровотечение", "value": 0, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Останавливает среднее кровотечение", "value": 0, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Пенициллин (Таблетка)": {
        "effects": [
            {"type": "generic", "name": "Снижение заражения -5", "value": -5, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Блок заражения", "value": 0, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Сангвинил (Таблетка)": {
        "effects": [
            {"type": "generic", "name": "Снижение заражения -50", "value": -50, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Блок заражения", "value": 0, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Настойка мяты": {
        "effects": [
            {"type": "generic", "name": "Снижение заражения -25", "value": -25, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Истощение +1", "value": 1, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Аугментин (Таблетка)": {
        "effects": [
            {"type": "generic", "name": "Снижение заражения -75", "value": -75, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Самогон": {
        "direct": {
            "radiation_delta": -2.5,
            "intoxication_delta": 25,
            "exhaustion_delta": -0.5,
            "uses": 8,
        },
        "effects": [
            {"type": "generic", "name": "Опьянение +25", "value": 25, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Истощение -1/2", "value": -0.5, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Использований 8", "value": 8, "source": "direct", "note": "manual_fixup"},
        ],
    },
    "Ибупрофен (Таблетка)": {
        "effects": [
            {"type": "generic", "name": "Боль -1", "value": -1, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Температура -0.5", "value": -0.5, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Заражение -10", "value": -10, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Стресс -1", "value": -1, "source": "direct", "note": "manual_fixup"},
            {"type": "generic", "name": "Длительность 10", "value": 10, "source": "direct", "note": "manual_fixup"},
        ],
    },
}


def main() -> int:
    app = create_app()
    with app.app_context():
        items = ItemTemplate.query.filter_by(category="consumable").all()
        updated = 0
        for item in items:
            description = item.description or item.attributes.get("raw_description", "")
            profile = parse_consumable_effects(f"{item.name}. {description}")
            manual = MANUAL_CONSUMABLE_FIXUPS.get(item.name)
            if manual:
                profile["direct"].update(manual.get("direct", {}))
                if manual.get("effects"):
                    profile["effects"] = list(manual["effects"])
            attrs = dict(item.attributes or {})
            attrs["consumable"] = profile
            attrs["effects"] = profile["effects"]
            attrs["modifiers"] = profile["modifiers"]
            attrs["status_removals"] = profile["status_removals"]
            attrs["status_additions"] = profile["status_additions"]
            attrs["requirements"] = profile["requirements"]
            item.attributes = attrs
            updated += 1
        db.session.commit()
        print(f"Updated {updated} consumables")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
