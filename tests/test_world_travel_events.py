import random

from app.services.world_travel_events import (
    OUTCOMES, SCENARIOS, outcome_probabilities, roll_travel_event,
)


def test_original_d100_tables_are_complete_without_overlaps():
    assert set(outcome.category for outcome in OUTCOMES) == {1, 2, 3, 4}
    for category in range(1, 5):
        results = [number for outcome in OUTCOMES if outcome.category == category
                   for number in range(outcome.start, outcome.end + 1)]
        assert sorted(results) == list(range(1, 101))
    assert sum(outcome.width for outcome in OUTCOMES if outcome.empty) == 92
    assert sum(outcome.width for outcome in OUTCOMES if outcome.potential_combat) == 60


def test_configured_probabilities_and_base_protection():
    for scenario, (chance, _) in SCENARIOS.items():
        probabilities = outcome_probabilities(scenario)
        assert abs(sum(probabilities.values()) - 1) < 1e-12
        assert not any(outcome.empty and outcome.key in probabilities for outcome in OUTCOMES)
        if scenario == 'near_base':
            assert not any(outcome.potential_combat and outcome.key in probabilities
                           for outcome in OUTCOMES)
            assert 'anomaly' in probabilities
            assert 'trader' in probabilities
        if scenario == 'wild':
            combat = chance * sum(probabilities.get(outcome.key, 0)
                                  for outcome in OUTCOMES if outcome.potential_combat)
            assert 0.05 <= combat <= 0.10
            assert 0.25 <= chance <= 0.40


def test_forest_humans_rare_and_road_humans_more_common():
    def humans(scenario):
        chance = SCENARIOS[scenario][0]
        odds = outcome_probabilities(scenario)
        return chance * sum(odds.get(outcome.key, 0)
                            for outcome in OUTCOMES if outcome.human_contact)

    assert 0 < humans('forest') < humans('wild') < humans('road')
    forest = outcome_probabilities('forest')
    wild = outcome_probabilities('wild')
    assert forest['trader'] < wild['trader']
    assert forest['passerby'] < wild['passerby']
    def combats(scenario):
        odds = outcome_probabilities(scenario)
        return SCENARIOS[scenario][0] * sum(odds.get(outcome.key, 0)
                                           for outcome in OUTCOMES if outcome.potential_combat)
    assert combats('road') < combats('wild')


def test_rolls_include_empty_steps_and_never_return_empty_card():
    rng = random.Random(1407)
    results = [roll_travel_event('wild', rng) for _ in range(20000)]
    cards = [outcome for outcome in results if outcome]
    assert 0.34 < len(cards) / len(results) < 0.38
    assert all(not outcome.empty for outcome in cards)
    assert len([outcome for outcome in results if outcome and outcome.potential_combat]) / len(results) < 0.10
