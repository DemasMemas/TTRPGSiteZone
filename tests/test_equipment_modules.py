from app.extensions import db
from app.models import LobbyCharacter, Location, LocationCharacter, LocationCombatState
from app.models.templates import ItemTemplate


def create_lobby(client, user, auth_headers):
    response = client.post(
        "/lobbies/",
        headers=auth_headers(user),
        json={"name": "Module test", "map_type": "empty", "chunks_width": 2, "chunks_height": 2},
    )
    assert response.status_code == 201
    return response.get_json()


def join_lobby(client, lobby, user, auth_headers):
    response = client.post(f"/lobbies/{lobby['id']}/join", headers=auth_headers(user))
    assert response.status_code == 200


def create_character(client, lobby, user, auth_headers, data):
    response = client.post(
        f"/lobbies/{lobby['id']}/characters",
        headers=auth_headers(user),
        json={"name": "Filter user", "data": data},
    )
    assert response.status_code == 201
    return response.get_json()


def templates():
    gas_mask = ItemTemplate(
        name="Test gas mask",
        category="gas_mask",
        volume=1,
        weight=1,
        attributes={"slots": [{"type": "filter", "label": "Фильтр", "maxItems": 1}]},
    )
    filter_template = ItemTemplate(
        name="Test filter",
        category="gas_mask_module",
        subcategory="filter",
        volume=0.2,
        weight=0.2,
        attributes={"slot_type": "filter", "filter_charges": 20},
    )
    db.session.add_all([gas_mask, filter_template])
    db.session.flush()
    return gas_mask, filter_template


def filter_item(template, *, quantity=1, charges=20):
    return {
        "id": "new-filter",
        "templateId": template.id,
        "name": template.name,
        "category": "gas_mask_module",
        "subcategory": "filter",
        "quantity": quantity,
        "durability": charges,
        "maxDurability": charges,
        "attributes": {
            "slot_type": "filter",
            "filter_charges": charges,
            "durability": charges,
            "max_durability": charges,
        },
    }


def character_data(gas_mask, filter_template, *, quantity=1):
    return {
        "health": {"effects": []},
        "inventory": {
            "pockets": [],
            "backpack": [filter_item(filter_template, quantity=quantity)],
        },
        "equipment": {
            "gasMask": {
                "templateId": gas_mask.id,
                "name": gas_mask.name,
                "category": "gas_mask",
                "installedModules": [{
                    "id": "old-filter",
                    "name": "Old filter",
                    "category": "gas_mask_module",
                    "subcategory": "filter",
                    "slotType": "filter",
                    "quantity": 1,
                    "durability": 3,
                    "maxDurability": 10,
                    "attributes": {"slot_type": "filter", "durability": 3, "max_durability": 10},
                }],
            },
        },
    }


def test_filter_replacement_and_removal_are_atomic_outside_combat(
    client, create_user, auth_headers,
):
    user = create_user("module-owner")
    lobby = create_lobby(client, user, auth_headers)
    gas_mask, filter_template = templates()
    character = create_character(
        client, lobby, user, auth_headers,
        character_data(gas_mask, filter_template, quantity=2),
    )

    installed = client.post(
        f"/lobbies/characters/{character['id']}/equipment-module",
        headers=auth_headers(user),
        json={
            "operation": "install",
            "slot_type": "filter",
            "target_path": ["equipment", "gasMask"],
            "item_path": ["inventory", "backpack", 0],
            "module_selection": {
                "target": {"templateId": gas_mask.id, "name": gas_mask.name, "category": "gas_mask"},
                "source": {"id": "new-filter", "templateId": filter_template.id, "name": filter_template.name},
            },
            "character_revision": character["data"]["_revision"],
        },
    )

    assert installed.status_code == 200
    data = installed.get_json()["data"]
    module = data["equipment"]["gasMask"]["installedModules"][0]
    assert module["name"] == "Test filter"
    assert module["durability"] == 20
    assert data["inventory"]["backpack"][0]["quantity"] == 1
    assert data["inventory"]["backpack"][1]["name"] == "Old filter"

    removed = client.post(
        f"/lobbies/characters/{character['id']}/equipment-module",
        headers=auth_headers(user),
        json={
            "operation": "uninstall",
            "slot_type": "filter",
            "target_path": ["equipment", "gasMask"],
            "module_selection": {
                "target": {"templateId": gas_mask.id, "name": gas_mask.name, "category": "gas_mask"},
            },
            "character_revision": data["_revision"],
        },
    )
    assert removed.status_code == 200
    removed_data = removed.get_json()["data"]
    assert removed_data["equipment"]["gasMask"]["installedModules"] == []
    assert [item["name"] for item in removed_data["inventory"]["backpack"]] == [
        "Test filter", "Old filter", "Test filter",
    ]


def test_filter_installation_uses_server_access_cost_and_can_finish_next_turn(
    client, create_user, auth_headers,
):
    gm = create_user("module-gm")
    actor_user = create_user("module-actor")
    other_user = create_user("module-other")
    lobby = create_lobby(client, gm, auth_headers)
    join_lobby(client, lobby, actor_user, auth_headers)
    join_lobby(client, lobby, other_user, auth_headers)
    gas_mask, filter_template = templates()
    actor_character = create_character(
        client, lobby, actor_user, auth_headers,
        character_data(gas_mask, filter_template),
    )
    other_character = create_character(
        client, lobby, other_user, auth_headers,
        {"health": {"effects": []}},
    )
    location = Location(lobby_id=lobby["id"], name="Module arena", world_tile_x=0, world_tile_z=0)
    db.session.add(location)
    db.session.flush()
    actor = LocationCharacter(
        location_id=location.id,
        character_id=actor_character["id"],
        controlled_by=actor_user["id"],
        action_points_current=1,
        action_points_max=5,
    )
    other = LocationCharacter(
        location_id=location.id,
        character_id=other_character["id"],
        controlled_by=other_user["id"],
        action_points_current=5,
        action_points_max=5,
    )
    db.session.add_all([actor, other])
    db.session.flush()
    db.session.add(LocationCombatState(
        location_id=location.id,
        status="active",
        round_number=1,
        turn_index=0,
        turn_order=[actor.id, other.id],
        current_location_character_id=actor.id,
    ))
    db.session.commit()
    payload = {
        "location_character_id": actor.id,
        "action_key": "change_equipment_module",
        "module_operation": "install",
        "module_slot_type": "filter",
        "module_target_path": ["equipment", "gasMask"],
        "module_selection": {
            "target": {"templateId": gas_mask.id, "name": gas_mask.name, "category": "gas_mask"},
            "source": {"id": "new-filter", "templateId": filter_template.id, "name": filter_template.name},
        },
        "item_path": ["inventory", "backpack", 0],
        "inventory_retrieval_action_points": 0,
        "pending_action_id": "filter-install-1",
    }

    started = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/action",
        headers=auth_headers(actor_user),
        json=payload,
    )
    assert started.status_code == 200
    assert started.get_json()["pending_action"] is True
    stored = db.session.get(LobbyCharacter, actor_character["id"])
    assert stored.data["inventory"]["backpack"][0]["name"] == "Test filter"
    assert stored.data["health"]["combatMeta"]["pendingAction"]["remaining_action_points"] == 1

    advanced = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/end_turn",
        headers=auth_headers(other_user),
        json={},
    )
    assert advanced.status_code == 200
    completed = client.post(
        f"/lobbies/{lobby['id']}/locations/{location.id}/combat/action",
        headers=auth_headers(actor_user),
        json={
            "location_character_id": actor.id,
            "action_key": "change_equipment_module",
            "resume_pending_action_id": "filter-install-1",
        },
    )
    assert completed.status_code == 200
    result = completed.get_json()
    assert result["module_change"]["action_points"] == 2
    assert result["module_change"]["inventory_access"]["source"] == "backpack"
    stored = db.session.get(LobbyCharacter, actor_character["id"])
    installed_modules = stored.data["equipment"]["gasMask"]["installedModules"]
    assert installed_modules[0]["name"] == "Test filter"
    assert stored.data["inventory"]["backpack"][0]["name"] == "Old filter"


def test_changed_filter_selection_is_rejected_without_inventory_mutation(
    client, create_user, auth_headers,
):
    user = create_user("module-conflict-owner")
    lobby = create_lobby(client, user, auth_headers)
    gas_mask, filter_template = templates()
    character = create_character(
        client, lobby, user, auth_headers,
        character_data(gas_mask, filter_template),
    )

    response = client.post(
        f"/lobbies/characters/{character['id']}/equipment-module",
        headers=auth_headers(user),
        json={
            "operation": "install",
            "slot_type": "filter",
            "target_path": ["equipment", "gasMask"],
            "item_path": ["inventory", "backpack", 0],
            "module_selection": {
                "target": {"templateId": gas_mask.id, "name": gas_mask.name},
                "source": {"id": "a-filter-that-is-no-longer-there"},
            },
            "character_revision": character["data"]["_revision"],
        },
    )

    assert response.status_code == 409
    stored = db.session.get(LobbyCharacter, character["id"])
    assert stored.data["inventory"]["backpack"][0]["id"] == "new-filter"
    assert stored.data["equipment"]["gasMask"]["installedModules"][0]["id"] == "old-filter"
