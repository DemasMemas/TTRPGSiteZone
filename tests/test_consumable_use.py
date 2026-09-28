from copy import deepcopy

import pytest

from app.extensions import db
from app.models import ConsumableUse, LocationCombatState
from app.services.exceptions import ValidationError
from app.services.health import apply_health_maximums
from test_character_interactions import _setup_pair
from test_atomic_inventory import treatment_payload, treat


@pytest.fixture
def pair(client, create_user, auth_headers):
    pair = _setup_pair(client, create_user, auth_headers)
    for key in ('actor_character', 'target_character'):
        data = deepcopy(pair[key].data)
        apply_health_maximums(data)
        pair[key].data = data
    db.session.commit()
    return pair


def use_envelope(pair, *, operation_id='use-1', side_effects=None):
    return {
        'id': operation_id,
        'source': {'path': ['inventory', 'backpack', 0],
                   'snapshot': deepcopy(pair['actor_character'].data['inventory']['backpack'][0])},
        'side_effects': side_effects if side_effects is not None else {
            'exposure': {'item_name': 'Банка пива', 'price': 100, 'intoxication': 1},
            'action_points_delta': 2,
        },
        'combat_location_id': pair['location'].id,
    }


def self_payload(pair, **kwargs):
    data = pair['actor_character'].data_snapshot()
    data['inventory']['backpack'][0]['quantity'] = 1
    data['health']['current'] = 90
    return {'actor_updates': {'data': data}, 'consumable_use': use_envelope(pair, **kwargs)}


def apply_self(client, pair, auth_headers, payload, user=None):
    return client.post(f"/lobbies/characters/{pair['actor_character'].id}/consumable",
                       headers=auth_headers(user or pair['actor_user']), json=payload)


def test_self_consumable_saves_health_expense_exposure_and_ap_once(client, pair, auth_headers, monkeypatch):
    monkeypatch.setattr('app.services.addictions.random.random', lambda: 0)
    payload = self_payload(pair)
    response = apply_self(client, pair, auth_headers, payload)
    assert response.status_code == 200, response.json
    data = response.json['data']
    assert data['inventory']['backpack'][0]['quantity'] == 1
    assert data['health']['current'] == 90
    assert response.json['consumable_result']['addiction']['acquired']
    assert pair['actor_location'].action_points_current == 7
    assert ConsumableUse.query.count() == 1
    assert apply_self(client, pair, auth_headers, payload).status_code == 409
    assert pair['actor_location'].action_points_current == 7
    assert next(iter(pair['actor_character'].data['health']['addictions']['exposures'].values()))['dose'] == 1


def test_old_item_snapshot_rejects_new_operation_id_with_stale_result(client, pair, auth_headers):
    payload = self_payload(pair)
    assert apply_self(client, pair, auth_headers, payload).status_code == 200
    payload['consumable_use']['id'] = 'new-id-stale-sheet'
    payload['actor_updates']['data']['_revision'] = pair['actor_character'].revision
    assert apply_self(client, pair, auth_headers, payload).status_code == 409
    assert ConsumableUse.query.count() == 1
    assert pair['actor_location'].action_points_current == 7


def test_medical_failure_consumes_item_without_side_effects(client, pair, auth_headers):
    payload = self_payload(pair, side_effects={})
    response = apply_self(client, pair, auth_headers, payload)
    assert response.status_code == 200, response.json
    assert response.json['consumable_result'] == {}
    assert pair['actor_location'].action_points_current == 5
    assert not response.json['data']['health'].get('addictions')
    assert response.json['data']['inventory']['backpack'][0]['quantity'] == 1


@pytest.mark.parametrize('delta', [2, -2])
def test_treatment_affects_patient_not_doctor_and_needs_no_patient_edit_right(client, pair, auth_headers, delta):
    pair['lobby'].gm_id = pair['target_user']['id']
    db.session.commit()
    consent, payload = treatment_payload(pair)
    payload['consumable_use'] = use_envelope(pair)
    payload['consumable_use']['side_effects']['action_points_delta'] = delta
    initial_patient_ap = pair['target_location'].action_points_current
    response = treat(client, pair, auth_headers(pair['actor_user']), payload)
    assert response.status_code == 200, response.json
    assert consent.status == 'completed'
    assert pair['actor_location'].action_points_current == 5
    assert pair['target_location'].action_points_current == max(0, initial_patient_ap + delta)
    assert not pair['actor_character'].data['health'].get('addictions')
    assert response.json['target_data']['health']['addictions']['exposures']
    assert response.json['consumable_result']['action_points_delta'] == delta


@pytest.mark.parametrize('fault', ['commit', 'after_exposure', 'actor_revision', 'patient_revision', 'consent'])
def test_failed_treatment_rolls_back_every_side_effect_and_emits_nothing(client, pair, auth_headers, monkeypatch, fault):
    consent, payload = treatment_payload(pair)
    payload['consumable_use'] = use_envelope(pair)
    before_actor, before_target = deepcopy(pair['actor_character'].data), deepcopy(pair['target_character'].data)
    patient_ap = pair['target_location'].action_points_current
    events = []
    monkeypatch.setattr('app.lobbies.socketio.emit', lambda *args, **kwargs: events.append(args))
    if fault == 'commit':
        def fail():
            db.session.flush()
            raise ValidationError('Injected failure')
        monkeypatch.setattr(db.session, 'commit', fail)
    elif fault == 'after_exposure':
        payload['consumable_use']['side_effects']['action_points_delta'] = 'invalid'
    elif fault == 'actor_revision':
        payload['actor_updates']['data']['_revision'] = 0
    elif fault == 'patient_revision':
        payload['target_revision'] = 0
    else:
        consent.status = 'pending'
        db.session.commit()
    response = treat(client, pair, auth_headers(pair['actor_user']), payload)
    assert response.status_code in (400, 403, 409), response.json
    assert pair['actor_character'].data == before_actor
    assert pair['target_character'].data == before_target
    assert pair['target_location'].action_points_current == patient_ap
    assert consent.status == ('pending' if fault == 'consent' else 'accepted')
    assert ConsumableUse.query.count() == 0
    assert events == []


def test_self_failure_after_flush_restores_resources_and_receipt(client, pair, auth_headers, monkeypatch):
    payload = self_payload(pair)
    before = deepcopy(pair['actor_character'].data)
    def fail():
        db.session.flush()
        raise ValidationError('Injected failure')
    monkeypatch.setattr(db.session, 'commit', fail)
    assert apply_self(client, pair, auth_headers, payload).status_code == 400
    assert pair['actor_character'].data == before
    assert pair['actor_location'].action_points_current == 5
    assert ConsumableUse.query.count() == 0


def test_outside_combat_consumable_checks_addiction_without_ap(client, pair, auth_headers):
    LocationCombatState.query.one().status = 'idle'
    db.session.commit()
    payload = self_payload(pair, side_effects={'exposure': {'item_name': 'Банка пива', 'price': 100}})
    payload['consumable_use']['combat_location_id'] = None
    assert apply_self(client, pair, auth_headers, payload).status_code == 200
    assert pair['actor_location'].action_points_current == 5


def test_ended_combat_rolls_back_attempt_to_grant_ap(client, pair, auth_headers):
    payload = self_payload(pair)
    LocationCombatState.query.one().status = 'idle'
    db.session.commit()
    before = deepcopy(pair['actor_character'].data)
    assert apply_self(client, pair, auth_headers, payload).status_code == 400
    assert pair['actor_character'].data == before
    assert ConsumableUse.query.count() == 0


def test_stranger_cannot_apply_consumable(client, pair, auth_headers):
    response = apply_self(client, pair, auth_headers, self_payload(pair), user=pair['target_user'])
    assert response.status_code == 403
    assert ConsumableUse.query.count() == 0


def test_sheet_fallback_has_same_atomic_side_effects(client, pair, auth_headers):
    data = pair['actor_character'].data_snapshot()
    data['inventory']['backpack'][0]['quantity'] = 1
    payload = {
        'actor_character_id': pair['actor_character'].id,
        'actor_updates': {'data': data},
        'target_updates': {'data': pair['target_character'].data_snapshot()},
        'consumable_use': use_envelope(pair),
    }
    response = client.post(f"/lobbies/characters/{pair['target_character'].id}/treatment",
                           headers=auth_headers(pair['actor_user']), json=payload)
    assert response.status_code == 200, response.json
    assert response.json['target_data']['health']['addictions']['exposures']
    assert ConsumableUse.query.count() == 1


@pytest.mark.parametrize('side_effects', [
    {'unexpected': 1}, {'action_points_delta': True}, {'action_points_delta': float('inf')},
    {'exposure': {'item_name': 'Пиво', 'price': 'bad'}}, {'exposure': {'item_name': ''}},
])
def test_invalid_side_effects_never_commit(client, pair, auth_headers, side_effects):
    payload = self_payload(pair, side_effects=side_effects)
    assert apply_self(client, pair, auth_headers, payload).status_code == 400
    assert pair['actor_character'].data['inventory']['backpack'][0]['quantity'] == 2
    assert ConsumableUse.query.count() == 0


def test_consumable_migration_round_trip():
    from importlib import import_module
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import create_engine, inspect, text
    migration = import_module('migrations.versions.d1e2f3a4b5c6_consumable_uses')
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE lobby_characters (id INTEGER PRIMARY KEY)'))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert 'consumable_uses' in inspect(connection).get_table_names()
            assert len(inspect(connection).get_foreign_keys('consumable_uses')) == 2
            migration.downgrade()
            assert inspect(connection).get_table_names() == ['lobby_characters']
    engine.dispose()


def test_consumable_receipt_rejects_a_racing_session(pair):
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session
    with Session(db.engine) as first, Session(db.engine) as second:
        assert first.get(ConsumableUse, 'same-use') is None
        assert second.get(ConsumableUse, 'same-use') is None
        for session in (first, second):
            session.add(ConsumableUse(id='same-use', actor_character_id=pair['actor_character'].id,
                                      target_character_id=pair['target_character'].id))
        first.commit()
        with pytest.raises(IntegrityError):
            second.commit()
        second.rollback()
    assert ConsumableUse.query.count() == 1
