from app.services.gas_mask_filters import consume_equipped_filter_charges


def make_filter(name, charges, *, quantity=1):
    return {
        "name": name,
        "category": "gas_mask_module",
        "subcategory": "filter",
        "quantity": quantity,
        "durability": charges,
        "maxDurability": charges,
        "attributes": {
            "slot_type": "filter",
            "durability": charges,
            "max_durability": charges,
            "filter_charges": charges,
        },
    }


def test_filter_charge_is_spent_without_replacement_before_empty():
    installed = make_filter("Installed", 3)
    installed["slotType"] = "filter"
    data = {
        "equipment": {"gasMask": {
            "autoReplaceFilters": True,
            "installedModules": [installed],
        }},
        "inventory": {"backpack": [make_filter("Spare", 10)]},
    }

    result = consume_equipped_filter_charges(data)

    assert result == {
        "changed": True, "consumed": 1, "removed": 0,
        "replaced": 0, "empty": 0,
    }
    assert installed["durability"] == 2
    assert data["inventory"]["backpack"][0]["name"] == "Spare"


def test_auto_replacement_discards_empty_filter_and_takes_one_from_stack():
    installed = make_filter("Empty next", 1)
    installed["slotType"] = "filter"
    data = {
        "equipment": {"helmet": {
            "autoReplaceFilters": True,
            "installedModules": [installed],
        }},
        "inventory": {"pockets": [make_filter("Spare", 10, quantity=2)]},
    }

    result = consume_equipped_filter_charges(data)

    replacement = data["equipment"]["helmet"]["installedModules"][0]
    assert result["removed"] == 1
    assert result["replaced"] == 1
    assert replacement["name"] == "Spare"
    assert replacement["durability"] == 10
    assert replacement["quantity"] == 1
    assert data["inventory"]["pockets"][0]["quantity"] == 1


def test_empty_filter_stays_installed_when_auto_replacement_is_disabled():
    installed = make_filter("Installed", 1)
    installed["slotType"] = "filter"
    spare = make_filter("Spare", 10)
    data = {
        "equipment": {"gasMask": {
            "autoReplaceFilters": False,
            "installedModules": [installed],
        }},
        "inventory": {"backpack": [spare]},
    }

    result = consume_equipped_filter_charges(data)

    assert result["empty"] == 1
    assert result["removed"] == 0
    assert installed["durability"] == 0
    assert data["inventory"]["backpack"] == [spare]
