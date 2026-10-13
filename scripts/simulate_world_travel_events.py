"""Print fixed-seed travel-event rates without changing campaign data."""

from pathlib import Path
import random
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.world_travel_events import (  # noqa: E402
    OUTCOMES, SCENARIOS, outcome_probabilities, roll_travel_event,
)


def main():
    original_groups = {
        'nonempty': lambda outcome: not outcome.empty,
        'mutants': lambda outcome: outcome.key == 'mutants',
        'human attack': lambda outcome: outcome.key == 'human_attack',
        'human contact': lambda outcome: outcome.human_contact,
        'finds': lambda outcome: outcome.key in ('corpse', 'stash', 'abandoned_item', 'rare_artifact'),
        'anomalous/radiation': lambda outcome: outcome.key in (
            'anomaly', 'anomalous_field', 'trap_anomaly', 'double_radiation', 'teleport_anomaly',
        ),
        'potential combat': lambda outcome: outcome.potential_combat,
    }
    print('Original D4/D100 per step (direct category/range count):')
    for label, matches in original_groups.items():
        count = sum(outcome.width for outcome in OUTCOMES if matches(outcome))
        print(f'  {label:20} {count / 400:.2%}')
    print('Original route expectations (nonempty / direct potential combat):')
    for steps in (5, 12, 24, 48):
        print(f'  {steps:2} steps: {steps * 0.77:.2f} / {steps * 0.15:.2f}')
    print('Scenario | theoretical event/combat | simulated event/combat (100000 steps)')
    for index, scenario in enumerate(SCENARIOS):
        rng = random.Random(20261013 + index)
        outcomes = [roll_travel_event(scenario, rng) for _ in range(100_000)]
        chance = SCENARIOS[scenario][0]
        probabilities = outcome_probabilities(scenario)
        combat_probability = chance * sum(
            probabilities.get(outcome.key, 0)
            for outcome in OUTCOMES if outcome.potential_combat
        )
        events = sum(outcome is not None for outcome in outcomes)
        combats = sum(bool(outcome and outcome.potential_combat) for outcome in outcomes)
        print(f'{scenario:15} | {chance:.2%} / {combat_probability:.2%}'
              f' | {events / 1000:.2f}% / {combats / 1000:.2f}%')
        print('  route steps | expected events / potential combats')
        for steps in (5, 12, 24, 48):
            print(f'  {steps:11} | {steps * chance:.2f} / {steps * combat_probability:.2f}')


if __name__ == '__main__':
    main()
