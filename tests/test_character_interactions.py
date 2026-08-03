from app.extensions import db
from app.models import (
    CharacterInteractionRequest,
    Lobby,
    LobbyCharacter,
    LobbyParticipant,
    Location,
    LocationCharacter,
    LocationCombatState,
)
from app.services.combat import CombatService
from app.services.exceptions import ValidationError


def _setup_pair(client, create_user, auth_headers):
    actor_user = create_user('interaction-actor')
    target_user = create_user('interaction-target')
    lobby = Lobby(name='Interaction lobby', gm_id=actor_user['id'], invite_code='PAIR01')
    db.session.add(lobby)
    db.session.flush()
    db.session.add_all([
        LobbyParticipant(lobby_id=lobby.id, user_id=actor_user['id']),
        LobbyParticipant(lobby_id=lobby.id, user_id=target_user['id']),
    ])
    actor_character = LobbyCharacter(
        lobby_id=lobby.id,
        owner_id=actor_user['id'],
        name='Doctor',
        data={
            'inventory': {'backpack': [
                {'id': 'actor-bandage', 'name': 'Бинт', 'quantity': 2, 'category': 'consumable'},
            ], 'pockets': []},
            'skills': {'physical': {'strength': {'base': 10, 'bonus': 0}}},
            'health': {'current': 100, 'max': 100, 'effects': []},
        },
    )
    target_character = LobbyCharacter(
        lobby_id=lobby.id,
        owner_id=target_user['id'],
        name='Patient',
        data={
            'inventory': {'backpack': [
                {'id': 'target-water', 'name': 'Вода', 'quantity': 3, 'category': 'consumable'},
            ], 'pockets': []},
            'skills': {'physical': {'strength': {'base': 10, 'bonus': 0}}},
            'health': {'current': 80, 'max': 100, 'effects': []},
        },
    )
    db.session.add_all([actor_character, target_character])
    db.session.flush()
    location = Location(lobby_id=lobby.id, name='Clinic', world_tile_x=0, world_tile_z=0)
    db.session.add(location)
    db.session.flush()
    actor_location = LocationCharacter(
        location_id=location.id,
        character_id=actor_character.id,
        controlled_by=actor_user['id'],
        pos_x=1,
        pos_y=1,
        action_points_current=5,
    )
    target_location = LocationCharacter(
        location_id=location.id,
        character_id=target_character.id,
        controlled_by=target_user['id'],
        pos_x=2,
        pos_y=1,
    )
    db.session.add_all([actor_location, target_location])
    db.session.flush()
    combat = LocationCombatState(
        location_id=location.id,
        status='active',
        round_number=1,
        turn_index=0,
        turn_order=[actor_location.id, target_location.id],
        current_location_character_id=actor_location.id,
    )
    db.session.add(combat)
    db.session.commit()
    return {
        'actor_user': actor_user,
        'target_user': target_user,
        'lobby': lobby,
        'actor_character': actor_character,
        'target_character': target_character,
        'location': location,
        'actor_location': actor_location,
        'target_location': target_location,
    }


def test_trade_moves_both_offers_atomically_and_costs_two_ap(
    client,
    create_user,
    auth_headers,
):
    pair = _setup_pair(client, create_user, auth_headers)
    create = client.post(
        f"/lobbies/{pair['lobby'].id}/locations/{pair['location'].id}/character-interactions",
        headers=auth_headers(pair['actor_user']),
        json={
            'actor_location_character_id': pair['actor_location'].id,
            'target_character_id': pair['target_character'].id,
            'kind': 'trade',
            'payload': {
                'actor_offer': [{
                    'item_id': 'actor-bandage',
                    'path': ['inventory', 'backpack', 0],
                    'amount': 1,
                    'name': 'Бинт',
                }],
                'target_offer': [{
                    'item_id': 'target-water',
                    'path': ['inventory', 'backpack', 0],
                    'amount': 2,
                    'name': 'Вода',
                }],
            },
        },
    )
    assert create.status_code == 201
    pending = create.get_json()
    assert pending['status'] == 'pending'
    assert db.session.get(LocationCharacter, pair['actor_location'].id).action_points_current == 5

    response = client.post(
        f"/lobbies/{pair['lobby'].id}/character-interactions/{pending['id']}/response",
        headers=auth_headers(pair['target_user']),
        json={'decision': 'accept'},
    )

    assert response.status_code == 200
    assert response.get_json()['status'] == 'completed'
    actor = db.session.get(LobbyCharacter, pair['actor_character'].id)
    target = db.session.get(LobbyCharacter, pair['target_character'].id)
    assert db.session.get(LocationCharacter, pair['actor_location'].id).action_points_current == 3
    assert [(item['name'], item['quantity']) for item in actor.data['inventory']['backpack']] == [
        ('Бинт', 1),
        ('Вода', 2),
    ]
    assert [(item['name'], item['quantity']) for item in target.data['inventory']['backpack']] == [
        ('Вода', 1),
        ('Бинт', 1),
    ]


def test_refused_treatment_uses_strength_and_locks_patient_while_in_progress(
    client,
    create_user,
    auth_headers,
    monkeypatch,
):
    pair = _setup_pair(client, create_user, auth_headers)
    rolls = iter([20, 1])
    monkeypatch.setattr('app.services.character_interaction.random.randint', lambda _a, _b: next(rolls))
    create = client.post(
        f"/lobbies/{pair['lobby'].id}/locations/{pair['location'].id}/character-interactions",
        headers=auth_headers(pair['actor_user']),
        json={
            'actor_location_character_id': pair['actor_location'].id,
            'target_character_id': pair['target_character'].id,
            'kind': 'treatment',
            'payload': {'procedure': {'item_name': 'Шина', 'application': 'Зафиксировать перелом'}},
        },
    ).get_json()

    response = client.post(
        f"/lobbies/{pair['lobby'].id}/character-interactions/{create['id']}/response",
        headers=auth_headers(pair['target_user']),
        json={'decision': 'decline'},
    )
    assert response.status_code == 200
    assert response.get_json()['status'] == 'forced'
    assert response.get_json()['result']['actor_strength']['total'] > response.get_json()['result']['target_strength']['total']

    actor_character = db.session.get(LobbyCharacter, pair['actor_character'].id)
    actor_data = dict(actor_character.data)
    actor_data['health'] = {
        **actor_data.get('health', {}),
        'combatMeta': {
            'pendingAction': {'id': 'treatment-pending', 'remaining_action_points': 2},
        },
    }
    actor_character.data = actor_data
    db.session.commit()

    progress = client.patch(
        f"/lobbies/{pair['lobby'].id}/character-interactions/{create['id']}/progress",
        headers=auth_headers(pair['actor_user']),
        json={'pending_action_id': 'treatment-pending'},
    )
    assert progress.status_code == 200
    assert db.session.get(CharacterInteractionRequest, create['id']).status == 'in_progress'

    try:
        CombatService.move_character(
            pair['location'].id,
            pair['target_user']['id'],
            pair['target_character'].id,
            2,
            2,
        )
        assert False, 'movement must be blocked during treatment'
    except ValidationError as error:
        assert 'treatment' in str(error).lower()


def test_interaction_distance_is_ignored_outside_combat(
    client,
    create_user,
    auth_headers,
):
    pair = _setup_pair(client, create_user, auth_headers)
    combat = LocationCombatState.query.filter_by(location_id=pair['location'].id).one()
    combat.status = 'idle'
    pair['target_location'].pos_x = 30
    pair['target_location'].pos_y = 30
    db.session.commit()

    response = client.post(
        f"/lobbies/{pair['lobby'].id}/locations/{pair['location'].id}/character-interactions",
        headers=auth_headers(pair['actor_user']),
        json={
            'actor_location_character_id': pair['actor_location'].id,
            'target_character_id': pair['target_character'].id,
            'kind': 'treatment',
            'payload': {'procedure': {'item_name': 'Бинт'}},
        },
    )

    assert response.status_code == 201
    assert response.get_json()['status'] == 'pending'
