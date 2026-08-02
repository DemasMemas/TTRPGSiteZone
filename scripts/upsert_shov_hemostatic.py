from __future__ import annotations

from app import create_app
from app.extensions import db
from app.models.templates import ItemTemplate
from app.services.consumable_effects import parse_consumable_effects


NAME = 'Гемостатик "Шов"'
DESCRIPTION = (
    "Ампула. Останавливает Сильное внутреннее кровотечение. "
    "Не пригодно для внешних кровотечений. Бонус медикамента -8"
)


def main() -> int:
    app = create_app()
    with app.app_context():
        # Remove the mojibake row created by an older console-based seed attempt.
        broken = ItemTemplate.query.filter_by(
            name='?????????? "???"',
            category="consumable",
        ).all()
        for item in broken:
            db.session.delete(item)

        profile = parse_consumable_effects(f"{NAME}. {DESCRIPTION}")
        attributes = {
            "section": "Кровь",
            "import_tier": "1",
            "consumable": profile,
            "effects": profile["effects"],
            "uses": profile["direct"].get("uses"),
            "duration": profile["direct"].get("duration"),
            "delay": profile["direct"].get("delay"),
            "raw_description": DESCRIPTION,
            "modifiers": profile["modifiers"],
            "status_removals": profile["status_removals"],
            "status_additions": profile["status_additions"],
            "requirements": profile["requirements"],
        }

        item = ItemTemplate.query.filter_by(name=NAME, category="consumable").first()
        created = item is None
        if item is None:
            item = ItemTemplate(name=NAME, category="consumable")

        item.subcategory = "Кровь"
        item.item_class = "1"
        item.description = DESCRIPTION
        item.price = 750
        item.weight = 0.0
        item.volume = 0.2
        item.attributes = attributes
        db.session.add(item)
        db.session.commit()

        print(f"{'Created' if created else 'Updated'} {NAME} (id={item.id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
