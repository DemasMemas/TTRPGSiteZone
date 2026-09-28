from copy import deepcopy

from sqlalchemy.orm.attributes import flag_modified

from app.extensions import db
from app.models import ConsumableUse, DeferredCombatAction, LocationCombatState
from app.models.templates import ItemTemplate
from app.services.consumable_effects import parse_consumable_effects
from app.services.general_consumable import _apply_profile
from test_consumable_use import pair


def install_consumable(pair, name, description, *, quantity=2, health=None):
    profile = parse_consumable_effects(f"{name}. {description}")
    template = ItemTemplate(
        name=name,
        category="consumable",
        description=description,
        price=500,
        attributes={"consumable": profile, "uses": profile["direct"].get("uses")},
    )
    db.session.add(template)
    db.session.flush()
    item = {
        "id": f"general-{template.id}",
        "templateId": template.id,
        "name": name,
        "category": "consumable",
        "quantity": quantity,
    }
    data = deepcopy(pair["actor_character"].data)
    data["inventory"]["backpack"] = [item]
    if health:
        data.setdefault("health", {}).update(health)
    pair["actor_character"].data = data
    flag_modified(pair["actor_character"], "data")
    db.session.commit()
    return item, profile


def application():
    return {"kind": "self", "actionPoints": 0}


def source(item):
    return {
        "path": ["inventory", "backpack", 0],
        "snapshot": deepcopy(item),
    }


def apply_general(client, pair, auth_headers, item, *, operation="general-1", deferred=None, combat=False):
    return client.post(
        f"/lobbies/characters/{pair['actor_character'].id}/general-consumable",
        headers=auth_headers(pair["actor_user"]),
        json={
            "operation_id": operation,
            "deferred_action_id": deferred,
            "source": source(item),
            "application": application(),
            "combat_location_id": pair["location"].id if combat else None,
            "actor_location_character_id": pair["actor_location"].id if combat else None,
        },
    )


def test_food_and_drink_are_applied_and_consumed_on_server(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    item, _ = install_consumable(
        pair,
        "Банка пива",
        "-1 Радиация. -1 Уровень стресса. +20 Опьянения.",
        health={"radiation": 10, "stress": 4, "intoxication": 0},
    )

    response = apply_general(client, pair, auth_headers, item)

    assert response.status_code == 200, response.json
    health = response.json["data"]["health"]
    assert health["radiation"] == 9
    assert health["stress"] == 3
    assert health["intoxication"] == 20
    stored = response.json["data"]["inventory"]["backpack"][0]
    assert stored["quantity"] == 1
    assert stored["uses"] == 1
    assert ConsumableUse.query.count() == 1


def test_consumable_stress_reduction_expires_manifestation(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    item, _ = install_consumable(
        pair, "Успокоительный чай", "-1 Стресса.", quantity=1,
        health={
            "stress": 2,
            "effects": [{
                "type": "stress_effect", "name": "Временная паника",
                "active": True, "expires_on_stress_decrease": True,
            }],
        },
    )

    response = apply_general(client, pair, auth_headers, item, operation="stress-relief")

    assert response.status_code == 200, response.json
    assert response.json["data"]["health"]["stress"] == 1
    effect = next(
        entry for entry in response.json["data"]["health"]["effects"]
        if entry["type"] == "stress_effect"
    )
    assert effect["active"] is False


def test_delayed_tablet_effect_is_saved_by_server(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    item, _ = install_consumable(pair, "Анальгин", "Снижает боль после 2 ходов.", quantity=1)

    response = apply_general(client, pair, auth_headers, item)

    assert response.status_code == 200, response.json
    effects = response.json["data"]["health"]["effects"]
    assert any(effect["type"] == "delayed_treatment" for effect in effects)
    assert response.json["data"]["inventory"]["backpack"] == []


def test_smoking_consumes_match_and_keeps_lighter(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    cigarette, _ = install_consumable(
        pair, "Сигареты дешёвые", "Снижение стресса через 5 минут. 20 использований.", quantity=1,
    )
    data = deepcopy(pair["actor_character"].data)
    data["inventory"]["backpack"] = [
        {"id": "matches", "name": "Спички", "category": "misc", "quantity": 1},
        cigarette,
    ]
    pair["actor_character"].data = data
    flag_modified(pair["actor_character"], "data")
    db.session.commit()
    body = {
        "operation_id": "smoke-1",
        "source": {"path": ["inventory", "backpack", 1], "snapshot": deepcopy(cigarette)},
        "application": application(),
    }

    response = client.post(
        f"/lobbies/characters/{pair['actor_character'].id}/general-consumable",
        headers=auth_headers(pair["actor_user"]), json=body,
    )

    assert response.status_code == 200, response.json
    inventory = response.json["data"]["inventory"]["backpack"]
    assert len(inventory) == 1
    assert inventory[0]["name"] == "Сигареты дешёвые"
    assert inventory[0]["uses"] == 19
    assert response.json["consumable_result"]["requirements"]["fire_source"] == "Спички"


def test_water_requirement_is_spent_atomically(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    sugar, _ = install_consumable(pair, "Сахар", "Нужна 2/3 бутылки воды. -1 Стресса.", quantity=1)
    water = {
        "id": "water", "name": "Вода", "category": "consumable", "quantity": 1,
        "uses": 3, "maxUses": 3, "attributes": {"uses_remaining": 3, "uses": 3},
    }
    data = deepcopy(pair["actor_character"].data)
    data["inventory"]["backpack"] = [water, sugar]
    pair["actor_character"].data = data
    flag_modified(pair["actor_character"], "data")
    db.session.commit()

    response = client.post(
        f"/lobbies/characters/{pair['actor_character'].id}/general-consumable",
        headers=auth_headers(pair["actor_user"]),
        json={
            "operation_id": "sugar-1",
            "source": {"path": ["inventory", "backpack", 1], "snapshot": deepcopy(sugar)},
            "application": application(),
        },
    )

    assert response.status_code == 200, response.json
    inventory = response.json["data"]["inventory"]["backpack"]
    assert len(inventory) == 2
    assert inventory[0]["name"] == "Вода"
    assert inventory[0]["uses"] == 1
    assert inventory[1]["name"] == "Сахар"
    assert inventory[1]["uses"] == 2
    assert response.json["consumable_result"]["requirements"]["water_charges"] == 2


def test_missing_requirement_rolls_back_selected_item(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    cigarette, _ = install_consumable(
        pair, "Сигареты дешёвые", "Снижение стресса через 5 минут. 20 использований.", quantity=1,
    )
    before = deepcopy(pair["actor_character"].data)

    response = apply_general(client, pair, auth_headers, cigarette, operation="smoke-no-fire")

    assert response.status_code == 400
    assert pair["actor_character"].data == before
    assert ConsumableUse.query.count() == 0


def test_injectable_cannot_bypass_medicine_route(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    item, _ = install_consumable(pair, "Тестовая ампула", "Ампула. +5 ХП.", quantity=1)
    before = deepcopy(pair["actor_character"].data)

    response = apply_general(client, pair, auth_headers, item)

    assert response.status_code == 400
    assert pair["actor_character"].data == before
    assert ConsumableUse.query.count() == 0


def test_general_consumable_is_paid_with_backpack_access_in_combat(client, pair, auth_headers):
    item, _ = install_consumable(pair, "Хлеб", "Закрывает потребность в еде.", quantity=1)
    selection = {
        "source": source(item),
        "application": application(),
        "target_character_id": pair["actor_character"].id,
        "treatment_request_id": None,
        "server_authoritative": True,
        "server_operation": "general",
    }
    response = client.post(
        f"/lobbies/{pair['lobby'].id}/locations/{pair['location'].id}/combat/spend",
        headers=auth_headers(pair["actor_user"]),
        json={
            "location_character_id": pair["actor_location"].id,
            "action_points": 2,
            "allow_deferred": True,
            "pending_action_id": "general-combat-1",
            "pending_action_label": "Хлеб",
            "consumable_selection": selection,
        },
    )
    assert response.status_code == 200, response.json
    row = db.session.get(DeferredCombatAction, "general-combat-1")
    assert row.status == "ready"
    assert row.payload["required_action_points"] == 2
    assert "medicine_roll" not in row.payload

    response = apply_general(
        client, pair, auth_headers, item,
        operation=row.id, deferred=row.id, combat=True,
    )

    assert response.status_code == 200, response.json
    assert response.json["data"]["inventory"]["backpack"] == []
    assert response.json["data"]["health"]["needs"]["mealsToday"] == 1
    assert pair["actor_location"].action_points_current == 3
    assert db.session.get(DeferredCombatAction, row.id).status == "completed"


def test_general_consumable_rejects_client_underpayment(client, pair, auth_headers):
    item, _ = install_consumable(
        pair, "Медленная еда", "Закрывает потребность в еде. Время использования - 4 ОД.",
        quantity=1,
    )
    before_ap = pair["actor_location"].action_points_current
    selection = {
        "source": source(item),
        "application": application(),
        "target_character_id": pair["actor_character"].id,
        "treatment_request_id": None,
        "server_authoritative": True,
        "server_operation": "general",
    }

    response = client.post(
        f"/lobbies/{pair['lobby'].id}/locations/{pair['location'].id}/combat/spend",
        headers=auth_headers(pair["actor_user"]),
        json={
            "location_character_id": pair["actor_location"].id,
            "action_points": 5,  # Server requires 4 use + 2 backpack access.
            "allow_deferred": True,
            "pending_action_id": "underpaid-general",
            "pending_action_label": "Медленная еда",
            "consumable_selection": selection,
        },
    )

    assert response.status_code == 400
    assert pair["actor_location"].action_points_current == before_ap
    assert db.session.get(DeferredCombatAction, "underpaid-general") is None
    assert pair["actor_character"].data["inventory"]["backpack"][0]["quantity"] == 1


def test_repeated_operation_does_not_apply_or_consume_twice(client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    item, _ = install_consumable(pair, "Хлеб", "Закрывает потребность в еде.", quantity=2)
    first = apply_general(client, pair, auth_headers, item)
    assert first.status_code == 200, first.json
    after_first = deepcopy(pair["actor_character"].data)

    repeated = apply_general(client, pair, auth_headers, item)

    assert repeated.status_code == 409
    assert pair["actor_character"].data == after_first
    assert ConsumableUse.query.count() == 1


def test_second_dose_refreshes_positive_duration_and_accumulates_costs(
        client, pair, auth_headers):
    LocationCombatState.query.one().status = "idle"
    item, _ = install_consumable(
        pair, "Тестовый стимулятор", "Временный тестовый эффект.", quantity=1,
        health={"current": 100, "max": 100, "exhaustion": 0},
    )
    template = db.session.get(ItemTemplate, item["templateId"])
    template.attributes = {
        "uses": 1,
        "consumable": {
            "effects": [],
            "modifiers": [],
            "direct": {
                "strength_delta": 4,
                "duration": 3,
                "duration_phase": "turn_end",
                "exhaustion_delta": 1,
                "hp": -5,
                "hp_max_delta": 20,
                "post_duration_hp_delta": -10,
            },
        },
    }
    first_item = {**item, "id": "dose-a"}
    second_item = {**item, "id": "dose-b"}
    data = deepcopy(pair["actor_character"].data)
    data["inventory"]["backpack"] = [first_item, second_item]
    pair["actor_character"].data = data
    flag_modified(pair["actor_character"], "data")
    db.session.commit()

    first = apply_general(
        client, pair, auth_headers, first_item, operation="refresh-dose-a",
    )
    assert first.status_code == 200, first.json

    data = deepcopy(pair["actor_character"].data)
    modifier = data["health"]["combatMeta"]["consumableModifiers"][0]
    modifier["remaining"] = 1
    modifier["remaining_seconds"] = 6
    crash = next(
        effect for effect in data["health"]["effects"]
        if effect["type"] == "stimulant_crash"
    )
    crash["remaining"] = 1
    crash["remaining_seconds"] = 6
    pair["actor_character"].data = data
    flag_modified(pair["actor_character"], "data")
    db.session.commit()

    second = apply_general(
        client, pair, auth_headers, second_item, operation="refresh-dose-b",
    )

    assert second.status_code == 200, second.json
    health = second.json["data"]["health"]
    modifiers = health["combatMeta"]["consumableModifiers"]
    assert len(modifiers) == 1
    assert modifiers[0]["value"] == 4
    assert modifiers[0]["remaining"] == 3
    assert modifiers[0]["remaining_seconds"] == 18
    assert health["exhaustion"] == 2
    assert health["current"] == 90
    assert health["max"] == 120
    crashes = [effect for effect in health["effects"] if effect["type"] == "stimulant_crash"]
    assert len(crashes) == 1
    assert crashes[0]["remaining"] == 3
    assert crashes[0]["remaining_seconds"] == 18
    current_crash = next(
        adjustment for adjustment in crashes[0]["onExpire"]
        if adjustment["field"] == "current"
    )
    assert current_crash["delta"] == -20


def test_stress_resistance_profiles_create_timed_effects():
    suppressor_profile = parse_consumable_effects(
        "Подавитель эмоций. Действует 6 перемещений. -25 Пси-состояний."
    )
    harmony_profile = parse_consumable_effects(
        "Стимулятор Гармония. -3 Стресса. -20 Пси-состояний. Действует 30 минут."
    )
    health = {"stress": 5, "psyState": 30, "effects": [], "combatMeta": {}}

    assert _apply_profile(
        health,
        suppressor_profile,
        suppressor_profile["direct"],
        {"id": "suppressor-1", "name": "Подавитель эмоций"},
        in_combat=True,
    ) is True
    suppressor = next(
        effect for effect in health["effects"]
        if effect["type"] == "stress_resistance"
    )
    assert suppressor["remaining"] == 6
    assert suppressor["tick"] == "movement_end"
    assert suppressor["stress_advantage"] is True
    assert suppressor["stress_attack_block_chance"] == 50

    assert _apply_profile(
        health,
        harmony_profile,
        harmony_profile["direct"],
        {"id": "harmony-1", "name": "Стимулятор Гармония"},
        in_combat=False,
    ) is True
    harmony = next(
        effect for effect in health["effects"]
        if effect["source"] == "Стимулятор Гармония"
    )
    assert harmony["remaining"] == 30
    assert harmony["remaining_seconds"] == 30 * 60
    assert harmony["tick"] == "time_elapsed"
    assert harmony["stress_advantage"] is True
    assert harmony["stress_attack_block_chance"] == 0
