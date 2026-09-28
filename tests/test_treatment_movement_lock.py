from copy import deepcopy

import pytest

from app.extensions import db
from app.models import CharacterInteractionRequest, LocationCombatState
from app.services.character_interaction import CharacterInteractionService
from test_character_interactions import _setup_pair


@pytest.fixture
def treatment(client, create_user, auth_headers):
    pair = _setup_pair(client, create_user, auth_headers)
    row = CharacterInteractionRequest(
        location_id=pair['location'].id,
        actor_location_character_id=pair['actor_location'].id,
        target_location_character_id=pair['target_location'].id,
        actor_user_id=pair['actor_user']['id'], target_user_id=pair['target_user']['id'],
        kind='treatment', status='in_progress', payload={'pending_action_id': 'treatment'},
    )
    db.session.add(row)
    db.session.commit()
    return pair, row


@pytest.mark.parametrize('meta', [
    {'pendingAction': {'id': 'treatment', 'remaining_action_points': 2}},
    {'completedPendingActionId': 'treatment'},
])
def test_patient_waits_for_completion_not_only_payment(treatment, meta):
    pair, row = treatment
    data = deepcopy(pair['actor_character'].data)
    data['health']['combatMeta'] = meta
    pair['actor_character'].data = data
    db.session.commit()
    assert CharacterInteractionService.movement_locked(pair['target_location'].id)
    assert row.status == 'in_progress'
    CharacterInteractionService.complete_treatment(row.id, pair['actor_user']['id'])
    assert not CharacterInteractionService.movement_locked(pair['target_location'].id)


def test_cancelled_payment_unlocks_patient_without_committing_an_outer_transaction(treatment):
    pair, row = treatment
    pair['actor_location'].action_points_current = 0
    assert not CharacterInteractionService.movement_locked(pair['target_location'].id)
    assert row.status == 'cancelled'
    db.session.rollback()
    assert row.status == 'in_progress'
    assert pair['actor_location'].action_points_current == 5


def test_stale_first_request_does_not_hide_another_active_procedure(treatment):
    pair, row = treatment
    data = deepcopy(pair['actor_character'].data)
    data['health']['combatMeta'] = {'completedPendingActionId': 'second-treatment'}
    pair['actor_character'].data = data
    another = CharacterInteractionRequest(
        location_id=row.location_id, actor_location_character_id=row.actor_location_character_id,
        target_location_character_id=row.target_location_character_id,
        actor_user_id=row.actor_user_id, target_user_id=row.target_user_id,
        kind='treatment', status='in_progress', payload={'pending_action_id': 'second-treatment'},
    )
    db.session.add(another)
    db.session.commit()
    assert CharacterInteractionService.movement_locked(pair['target_location'].id)
    assert another.status == 'in_progress'


def test_ended_combat_does_not_lock_patient_with_an_old_paid_marker(treatment):
    pair, row = treatment
    data = deepcopy(pair['actor_character'].data)
    data['health']['combatMeta'] = {'completedPendingActionId': 'treatment'}
    pair['actor_character'].data = data
    state = LocationCombatState.query.filter_by(location_id=pair['location'].id).one()
    state.status = 'idle'
    db.session.commit()
    assert not CharacterInteractionService.movement_locked(pair['target_location'].id)
    assert row.status == 'cancelled'
