import pytest

from app.services.inventory import ammo_slot_limit, normalize_inventory_ammo_stacks


def ammo(caliber, quantity, item_id="ammo-1"):
    return {
        "id": item_id,
        "category": "ammo",
        "quantity": quantity,
        "volume": 0.01,
        "attributes": {"caliber": caliber},
    }


@pytest.mark.parametrize(
    ("caliber", "expected_limit"),
    [
        ("9*18", 50),
        ("9x19", 50),
        ("9*21", 50),
        (".45 аср", 50),
        ("5.45*39", 50),
        ("5.56x45", 50),
        ("18*45", 50),
        ("5.7*28", 50),
        ("7.62*25", 50),
        ("12*70", 25),
        ("7.62*39", 25),
        ("7.62*51", 25),
        ("7.62*54", 25),
        ("12,7x55", 25),
        ("9*39", 25),
        ("СП-4", 25),
    ],
)
def test_ammo_slot_limits_accept_all_configured_calibers(caliber, expected_limit):
    assert ammo_slot_limit(ammo(caliber, 1)) == expected_limit


def test_inventory_ammo_is_split_without_changing_total_quantity():
    data = {"inventory": {"pockets": [ammo("9x19", 120)], "backpack": []}}

    normalize_inventory_ammo_stacks(data)

    stacks = data["inventory"]["pockets"]
    assert [stack["quantity"] for stack in stacks] == [50, 50, 20]
    assert len({stack["id"] for stack in stacks}) == 3
    assert sum(stack["quantity"] for stack in stacks) == 120


def test_large_caliber_uses_twenty_five_round_slot_limit_in_nested_container():
    data = {
        "inventory": {
            "pockets": [],
            "backpack": [{"category": "container", "contents": [ammo("7.62*54", 60)]}],
        }
    }

    normalize_inventory_ammo_stacks(data)

    stacks = data["inventory"]["backpack"][0]["contents"]
    assert [stack["quantity"] for stack in stacks] == [25, 25, 10]


def test_loaded_magazine_ammo_is_not_split_by_inventory_slot_limit():
    magazine = {
        "category": "magazine",
        "ammo": [{"category": "ammo", "quantity": 60, "attributes": {"caliber": "9x19"}}],
    }
    data = {"inventory": {"pockets": [magazine], "backpack": []}}

    normalize_inventory_ammo_stacks(data)

    assert data["inventory"]["pockets"][0]["ammo"][0]["quantity"] == 60
