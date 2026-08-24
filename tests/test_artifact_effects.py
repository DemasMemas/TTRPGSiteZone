from app.services.artifact_effects import (
    apply_artifact_world_movement,
    artifact_passive_profile,
)


def _character_with_artifact(positive='', negative=''):
    return {
        'health': {'current': 500, 'max': 700, 'radiation': 0, 'painLevel': 2},
        'equipment': {
            'armor': {
                'containers': [{
                    'item': {
                        'name': 'Тестовый артефакт',
                        'category': 'artifact',
                        'attributes': {
                            'positive_effect': positive,
                            'negative_effect': negative,
                        },
                    },
                }],
            },
        },
    }


def test_artifact_passives_parse_protection_and_movement_effects():
    character = _character_with_artifact(
        'Защита от физического урона +15% Сила +2 -2 Радиации за перемещение',
        'Точность -1 Общее здоровье -25 за перемещение',
    )

    profile = artifact_passive_profile(character)

    assert profile['protection']['physical'] == 15
    assert profile['radiation_per_movement'] == -2
    assert profile['health_per_movement'] == -25
    assert profile['accuracy'] == -1


def test_conditional_artifact_modifier_requires_enough_radiation():
    character = _character_with_artifact(
        'Штраф перемещения -1, Если накоплено хотя бы 5 Радиации',
    )
    assert artifact_passive_profile(character)['movement_penalty'] == 0

    character['health']['radiation'] = 5
    assert artifact_passive_profile(character)['movement_penalty'] == -1


def test_world_movement_applies_artifact_health_radiation_and_pain():
    character = _character_with_artifact(
        '-2 Радиации за перемещение Общее здоровье +25 за перемещение Облегчает боль на 1 уровень',
    )
    character['health']['radiation'] = 4

    result = apply_artifact_world_movement(character)

    assert result['changed'] is True
    assert character['health']['current'] == 525
    assert character['health']['radiation'] == 2
    assert character['health']['painLevel'] == 1
