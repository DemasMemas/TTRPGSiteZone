import pytest

from app.extensions import db
from app.models.templates import ItemTemplate
from app.services.combat import CombatService
from app.services.exceptions import ValidationError


def add_template(name, category, *, subcategory=None, weight=0, attributes=None):
    template = ItemTemplate(
        name=name,
        category=category,
        subcategory=subcategory,
        weight=weight,
        volume=1,
        attributes=attributes or {},
        compatible_ids=[],
    )
    db.session.add(template)
    db.session.flush()
    return template


def inventory_item(template, **updates):
    item = {
        "templateId": template.id,
        "name": template.name,
        "category": template.category,
        "subcategory": template.subcategory,
        "weight": template.weight,
        "attributes": dict(template.attributes or {}),
        "quantity": 1,
    }
    item.update(updates)
    return item


def test_armor_equipment_cost_includes_inventory_retrieval_and_preserves_item(app):
    armor = add_template(
        "Medium armor",
        "armor",
        subcategory="Средняя",
        weight=8,
        attributes={
            "max_durability": 40,
            "movement_penalty": 3,
            "protection": {"physical": 0.4},
            "protection_zones": ["chest", "abdomen"],
        },
    )
    data = {
        "inventory": {"backpack": [inventory_item(armor, durability=27)], "pockets": []},
        "equipment": {},
    }

    details = CombatService.equipment_action_details(
        data,
        "equip",
        "armor",
        item_path=["inventory", "backpack", 0],
        retrieval_action_points=2,
        in_combat=True,
    )
    result = CombatService.apply_equipment_action(data, details)

    assert details["action_points"] == 22
    assert result["action_points"] == 22
    assert data["inventory"]["backpack"] == []
    assert data["equipment"]["armor"]["durability"] == 27
    assert data["equipment"]["armor"]["movementPenalty"] == 3

    remove = CombatService.equipment_action_details(
        data,
        "unequip",
        "armor",
        in_combat=True,
    )
    CombatService.apply_equipment_action(data, remove)
    assert remove["action_points"] == 10
    assert "armor" not in data["equipment"]
    assert data["inventory"]["backpack"][0]["durability"] == 27


@pytest.mark.parametrize(
    ("weight", "equip_cost", "remove_cost"),
    [(2, 2, 1), (2.1, 4, 3)],
)
def test_helmet_cost_uses_two_kilogram_boundary(app, weight, equip_cost, remove_cost):
    helmet = add_template("Helmet", "helmet", weight=weight)
    data = {
        "inventory": {"backpack": [inventory_item(helmet)], "pockets": []},
        "equipment": {},
    }
    equip = CombatService.equipment_action_details(
        data,
        "equip",
        "helmet",
        item_path=["inventory", "backpack", 0],
        in_combat=True,
    )
    assert equip["action_points"] == equip_cost
    CombatService.apply_equipment_action(data, equip)
    remove = CombatService.equipment_action_details(
        data,
        "unequip",
        "helmet",
        in_combat=True,
    )
    assert remove["action_points"] == remove_cost


def test_integrated_helmet_follows_armor(app):
    armor = add_template(
        "Sealed suit",
        "armor",
        subcategory="Научная",
        attributes={
            "integrated_helmet": True,
            "integrated_helmet_name": "Suit helmet",
            "integrated_helmet_profile": {
                "physical": 0.35,
                "accuracyPenalty": 3,
                "charismaPenalty": 2,
            },
        },
    )
    data = {
        "inventory": {"backpack": [inventory_item(armor)], "pockets": []},
        "equipment": {},
    }
    equip = CombatService.equipment_action_details(
        data,
        "equip",
        "armor",
        item_path=["inventory", "backpack", 0],
        in_combat=True,
    )
    CombatService.apply_equipment_action(data, equip)
    assert data["equipment"]["helmet"]["integratedWithArmor"] is True
    assert data["equipment"]["helmet"]["name"] == "Suit helmet"
    assert data["equipment"]["helmet"]["protection"]["physical"] == 0.35

    remove = CombatService.equipment_action_details(data, "unequip", "armor", in_combat=True)
    CombatService.apply_equipment_action(data, remove)
    assert "helmet" not in data["equipment"]


@pytest.mark.parametrize(
    "occupied_slot",
    [
        {"helmet": {"templateId": 999, "name": "Helmet"}},
        {"gasMask": {"templateId": 998, "name": "Gas mask"}},
    ],
)
def test_integrated_helmet_armor_does_not_overwrite_head_equipment(app, occupied_slot):
    armor = add_template(
        "Sealed armor",
        "armor",
        attributes={"integrated_helmet": True},
    )
    data = {
        "inventory": {"backpack": [inventory_item(armor)]},
        "equipment": occupied_slot,
    }

    with pytest.raises(ValidationError, match="Remove the"):
        CombatService.equipment_action_details(
            data,
            "equip",
            "armor",
            item_path=["inventory", "backpack", 0],
        )


def test_visor_helmet_and_gas_mask_are_mutually_exclusive(app):
    helmet = add_template(
        "Visor helmet",
        "helmet",
        attributes={"integrated_visor": True},
    )
    gas_mask = add_template("Gas mask", "gas_mask")
    data = {
        "inventory": {
            "backpack": [inventory_item(helmet), inventory_item(gas_mask)],
        },
        "equipment": {"gasMask": {"templateId": gas_mask.id, "name": gas_mask.name}},
    }

    with pytest.raises(ValidationError, match="cannot be worn"):
        CombatService.equipment_action_details(
            data,
            "equip",
            "helmet",
            item_path=["inventory", "backpack", 0],
        )


def test_exoskeleton_requires_tools_and_engineering_and_is_blocked_in_combat(app):
    exoskeleton = add_template(
        "Экзоскелет",
        "armor",
        subcategory="Экзоскелет",
        attributes={"is_exoskeleton": True, "requires_exoskeleton_battery": True},
    )
    simple_tool = {
        "name": "Упрощенные инструменты бронника",
        "category": "tool",
        "quantity": 1,
        "attributes": {"repair_profile": {"kind": "armor", "max_item_class": 2}},
    }
    advanced_tool = {
        "name": "Расширенные инструменты бронника",
        "category": "tool",
        "quantity": 1,
        "attributes": {
            "repair_profile": {"kind": "armor", "engineering_min": 17},
        },
    }
    data = {
        "skills": {"other": {"engineering": {"base": 18, "bonus": 0}}},
        "inventory": {
            "backpack": [inventory_item(exoskeleton), simple_tool, advanced_tool],
            "pockets": [],
        },
        "equipment": {},
    }
    with pytest.raises(ValidationError, match="during combat"):
        CombatService.equipment_action_details(
            data,
            "equip",
            "armor",
            item_path=["inventory", "backpack", 0],
            in_combat=True,
        )

    equip = CombatService.equipment_action_details(
        data,
        "equip",
        "armor",
        item_path=["inventory", "backpack", 0],
        in_combat=False,
    )
    assert equip["duration_minutes"] == 10
    CombatService.apply_equipment_action(data, equip)
    remove = CombatService.equipment_action_details(
        data,
        "unequip",
        "armor",
        in_combat=False,
    )
    assert remove["duration_minutes"] == 60
