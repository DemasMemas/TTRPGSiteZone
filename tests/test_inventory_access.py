from copy import deepcopy

from app.extensions import db
from app.models.templates import ItemTemplate
from app.services.inventory_access import calculate_inventory_access


def template(name, category, *, subcategory=None, attributes=None):
    row = ItemTemplate(
        name=name,
        category=category,
        subcategory=subcategory,
        attributes=attributes or {},
        compatible_ids=[],
    )
    db.session.add(row)
    db.session.flush()
    return row


def item(row, **updates):
    value = {
        'templateId': row.id,
        'name': row.name,
        'category': row.category,
        'subcategory': row.subcategory,
        'attributes': deepcopy(row.attributes or {}),
        'quantity': 1,
    }
    value.update(updates)
    return value


def character_data(*, tactics=5, left_arm=50):
    return {
        'skills': {'other': {'tactics': {'base': tactics, 'bonus': 0}}},
        'health': {'zones': {
            'leftArm': {'current': left_arm},
            'rightArm': {'current': 50},
        }},
        'inventory': {'pockets': [], 'backpack': []},
        'equipment': {
            'belt': {'pouches': []},
            'vest': {'pouches': []},
        },
    }


def test_inventory_access_costs_pockets_backpack_and_disabled_arm(app):
    medicine = template('Бинт', 'consumable', subcategory='Травмы')
    data = character_data(left_arm=0)
    data['inventory']['pockets'].append(item(medicine))
    data['inventory']['backpack'].append(item(medicine))

    pocket = calculate_inventory_access(data, ['inventory', 'pockets', 0])
    backpack = calculate_inventory_access(data, ['inventory', 'backpack', 0])

    assert pocket['retrieval_action_points'] == 2
    assert pocket['limb_penalty'] == 1
    assert backpack['retrieval_action_points'] == 3


def test_compatible_medical_pouch_grants_tactics_use_discount(app):
    medicine = template('Бинт', 'consumable', subcategory='Травмы')
    pouch_template = template('Медицинский подсумок', 'pouch', attributes={
        'allowed_categories': ['med'],
    })
    data = character_data(tactics=14)
    data['skills']['other']['tactics']['bonus'] = 1
    pouch = item(pouch_template, contents=[item(medicine)])
    data['equipment']['belt']['pouches'].append(pouch)

    result = calculate_inventory_access(
        data, ['equipment', 'belt', 'pouches', 0, 'contents', 0],
    )

    assert result['source'] == 'compatible_pouch'
    assert result['retrieval_action_points'] == 0
    assert result['use_action_discount'] == 1


def test_nested_container_adds_its_access_cost(app):
    medicine = template('Бинт', 'consumable', subcategory='Травмы')
    case = template('Закрытый кейс', 'container', attributes={'access_action_points': 3})
    data = character_data()
    data['inventory']['backpack'].append(item(case, contents=[item(medicine)]))

    result = calculate_inventory_access(
        data, ['inventory', 'backpack', 0, 'contents', 0],
    )

    assert result['base_action_points'] == 5
    assert result['retrieval_action_points'] == 5
