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


def test_manual_zone_health_edit_resets_accumulated_destruction_damage():
    current = {
        "health": {
            "zones": {
                "leftLeg": {"current": 10, "max": 100, "destructionDamage": 490},
            },
            "combatMeta": {"damageTakenThisRound": 90, "damagePainAppliedThisRound": 1},
        },
    }
    updated = {
        "health": {
            "zones": {
                "leftLeg": {"current": 60, "max": 100, "destructionDamage": 490},
            },
            "combatMeta": {"damageTakenThisRound": 90, "damagePainAppliedThisRound": 1},
        },
    }

    CharacterService.apply_manual_field_resets(
        current,
        updated,
        ["health.zones.leftLeg.current"],
    )

    assert updated["health"]["zones"]["leftLeg"]["destructionDamage"] == 0
    assert "damageTakenThisRound" not in updated["health"]["combatMeta"]
    assert "damagePainAppliedThisRound" not in updated["health"]["combatMeta"]


def test_system_zone_health_change_keeps_accumulated_destruction_damage():
    current = {"health": {"zones": {"leftLeg": {"current": 10, "max": 100}}}}
    updated = {
        "health": {
            "zones": {
                "leftLeg": {"current": 60, "max": 100, "destructionDamage": 490},
            },
        },
    }

    CharacterService.apply_manual_field_resets(current, updated, [])

    assert updated["health"]["zones"]["leftLeg"]["destructionDamage"] == 490
