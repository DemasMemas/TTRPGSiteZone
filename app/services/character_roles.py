"""World-time and party eligibility for lobby characters."""


def _character_data(character_or_data):
    data = getattr(character_or_data, 'data', character_or_data)
    return data if isinstance(data, dict) else {}


def is_mutant(character_or_data):
    data = _character_data(character_or_data)
    basic = data.get('basic') if isinstance(data.get('basic'), dict) else {}
    if any(value is True for value in (
        data.get('is_mutant'), data.get('isMutant'),
        basic.get('is_mutant'), basic.get('isMutant'),
    )):
        return True
    labels = (
        data.get('character_type'), data.get('characterType'), data.get('species'),
        basic.get('character_type'), basic.get('characterType'), basic.get('species'),
    )
    return any('мутант' in str(value or '').strip().casefold() for value in labels)


def is_npc(character_or_data):
    data = _character_data(character_or_data)
    basic = data.get('basic') if isinstance(data.get('basic'), dict) else {}
    return (
        data.get('is_npc') is True
        or basic.get('is_npc') is True
        or data.get('character_type') == 'npc'
        or basic.get('character_type') == 'npc'
    )


def follows_world_time(character_or_data):
    return not is_mutant(character_or_data) and not is_npc(character_or_data)


def can_join_world_group(character_or_data):
    if is_mutant(character_or_data):
        return False
    if not is_npc(character_or_data):
        return True
    data = _character_data(character_or_data)
    basic = data.get('basic') if isinstance(data.get('basic'), dict) else {}
    return basic.get('can_join_group') is True
