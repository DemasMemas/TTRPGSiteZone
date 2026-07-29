from app.services.character import CharacterService


def test_player_added_template_item_is_marked():
    current = {"inventory": {"pockets": []}}
    updated = {
        "inventory": {
            "pockets": [
                {"id": "new-item", "templateId": 42, "name": "Water", "quantity": 1}
            ]
        }
    }

    CharacterService.mark_added_items_as_player_created(current, updated)

    assert updated["inventory"]["pockets"][0]["createdByPlayer"] is True


def test_moving_existing_item_does_not_mark_it_as_player_created():
    item = {"id": "existing-item", "templateId": 42, "name": "Water", "quantity": 1}
    current = {"inventory": {"pockets": [dict(item)], "backpack": []}}
    updated = {"inventory": {"pockets": [], "backpack": [dict(item)]}}

    CharacterService.mark_added_items_as_player_created(current, updated)

    assert "createdByPlayer" not in updated["inventory"]["backpack"][0]


def test_increasing_stack_marks_resulting_stack_as_player_created():
    current = {
        "inventory": {
            "pockets": [
                {"id": "ammo", "templateId": 77, "name": "Ammo", "quantity": 5}
            ]
        }
    }
    updated = {
        "inventory": {
            "pockets": [
                {"id": "ammo", "templateId": 77, "name": "Ammo", "quantity": 8}
            ]
        }
    }

    CharacterService.mark_added_items_as_player_created(current, updated)

    assert updated["inventory"]["pockets"][0]["createdByPlayer"] is True
