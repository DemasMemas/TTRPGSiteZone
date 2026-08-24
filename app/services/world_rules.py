"""Normalized rulebook catalogs for world travel content."""

from __future__ import annotations

import json
import random
import re
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def world_rules():
    path = Path(__file__).resolve().parents[1] / "data" / "world_rules.json"
    return json.loads(path.read_text(encoding="utf-8"))


def anomaly_field_catalog():
    return world_rules()["anomaly_fields"]


def anomaly_field_profile(name):
    normalized = str(name or "").strip().casefold()
    return next(
        (item for item in anomaly_field_catalog() if item["name"].casefold() == normalized),
        None,
    )


def artifact_catalog():
    return world_rules()["artifacts"]


def mutant_catalog():
    return world_rules()["mutants"]


def mutant_profile(name):
    normalized = str(name or '').strip().casefold()
    return next(
        (item for item in mutant_catalog() if item['name'].casefold() == normalized),
        None,
    )


def _zone_pair(raw):
    values = [int(value) for value in re.findall(r'\d+', str(raw or ''))]
    if not values:
        return 0, 0
    return values[0], values[-1]


def _mutant_attack_profile(attack):
    effect = str(attack.get('effect') or '')
    damage_match = re.search(r'(\d+)\s*(?:урон|Урон)', effect)
    penetration_match = re.search(r'(\d+)%\s*Бронепробит', effect, re.IGNORECASE)
    action_match = re.search(r'(\d+)\s*ОД', effect, re.IGNORECASE)
    return {
        'damage': int(damage_match.group(1)) if damage_match else 0,
        'armor_piercing': int(penetration_match.group(1)) if penetration_match else 0,
        'action_points': int(action_match.group(1)) if action_match else 0,
    }


def mutant_character_data(profile, variant_name=None):
    arm_hp, leg_hp = _zone_pair(profile.get('zones', {}).get('limbs'))
    chest_hp, _ = _zone_pair(profile.get('zones', {}).get('chest'))
    abdomen_hp, _ = _zone_pair(profile.get('zones', {}).get('abdomen'))
    head_hp, _ = _zone_pair(profile.get('zones', {}).get('head'))
    maximum = int(profile.get('health') or 0)
    skills = profile.get('skills') or {}
    selected_variant = next((
        variant for variant in (profile.get('variants') or [])
        if str(variant.get('name') or '').casefold() == str(variant_name or '').casefold()
    ), None)
    variant_text = ' '.join((selected_variant or {}).get('traits') or [])
    physical_bonus = sum(
        int(value) for value in re.findall(
            r'Физическ\w* защит\w* увеличен\w* на\s*(\d+)',
            variant_text,
            re.IGNORECASE,
        )
    )
    zone_health_bonus = sum(
        int(value) for value in re.findall(
            r'Здоровье в каждой части тела увеличено на\s*(\d+)',
            variant_text,
            re.IGNORECASE,
        )
    )
    damage_bonus = sum(
        int(value) for value in re.findall(
            r'Урон(?: и бронепробитие)? каждой атаки увеличен\w* на\s*(\d+)',
            variant_text,
            re.IGNORECASE,
        )
    )
    penetration_bonus = sum(
        int(value) for value in re.findall(
            r'(?:Урон и бронепробитие|Бронепробитие) каждой атаки увеличен\w* на\s*(\d+)',
            variant_text,
            re.IGNORECASE,
        )
    )
    attacks = []
    for index, attack in enumerate(profile.get('attacks') or []):
        parsed = _mutant_attack_profile(attack)
        is_battle_cry = 'клич' in str(attack.get('name') or '').casefold()
        if not is_battle_cry:
            parsed['damage'] += damage_bonus
            parsed['armor_piercing'] += penetration_bonus
        attacks.append({
            'id': f"mutant-attack-{profile['source_order']}-{index}",
            'name': 'Боевой клич' if is_battle_cry else attack['name'],
            'category': 'melee_weapon',
            'naturalWeapon': True, 'weight': 0,
            'durability': 100, 'maxDurability': 100,
            'attributes': {
                **parsed,
                'allowed_attacks': [attack['name']],
                'attack_modifiers': {attack['name']: {}},
                'melee_damage_type': attack.get('attack_type') or 'Дробящий',
                'weight_class': 'Тяжелое',
                'skip_strength_scaling': True,
                'natural_weapon': True,
                'raw_effect': attack.get('effect') or '',
                'special_action': 'mutant_battle_cry' if is_battle_cry else None,
            },
        })
    return {
        'basic': {
            'species': 'Мутант', 'is_mutant': True,
            'mutant_type': profile['name'],
            'mutant_variant': selected_variant['name'] if selected_variant else None,
        },
        'is_mutant': True,
        'health': {
            'current': maximum, 'max': maximum, 'effects': [],
            'zones': {
                'leftArm': {'current': arm_hp + zone_health_bonus, 'max': arm_hp + zone_health_bonus},
                'rightArm': {'current': arm_hp + zone_health_bonus, 'max': arm_hp + zone_health_bonus},
                'leftLeg': {'current': leg_hp + zone_health_bonus, 'max': leg_hp + zone_health_bonus},
                'rightLeg': {'current': leg_hp + zone_health_bonus, 'max': leg_hp + zone_health_bonus},
                'chest': {'current': chest_hp + zone_health_bonus, 'max': chest_hp + zone_health_bonus},
                'abdomen': {'current': abdomen_hp + zone_health_bonus, 'max': abdomen_hp + zone_health_bonus},
                'head': {'current': head_hp + zone_health_bonus, 'max': head_hp + zone_health_bonus},
            },
        },
        'skills': {
            'physical': {
                'agility': {'base': skills.get('agility', 0), 'bonus': 0},
                'melee': {'base': skills.get('melee', 0), 'bonus': 0},
                'strength': {'base': skills.get('strength', 0), 'bonus': 0},
                'will': {'base': skills.get('will', 0), 'bonus': 0},
                'awareness': {'base': skills.get('attention', 0), 'bonus': 0},
                'shooting': {'base': skills.get('shooting', 0), 'bonus': 0},
            },
            'other': {
                'tactics': {'base': skills.get('tactics', 0), 'bonus': 0},
                'stealth': {'base': skills.get('stealth', 0), 'bonus': 0},
            },
        },
        'movement': {'base': profile.get('movement', 0)},
        'mutant': {
            'profile': profile['name'],
            'physical_protection': profile.get('physical_protection', 0) + physical_bonus,
            'anomaly_protection': profile.get('anomaly_protection', 0),
            'attack_range': skills.get('range', 1),
            'automatic_attacks': bool(profile.get('automatic_attacks')),
            'traits': list(profile.get('traits') or []),
            'variant': selected_variant,
            'attacks': profile.get('attacks') or [],
        },
        'weapons': attacks,
        'inventory': {'pockets': [], 'backpack': []},
    }


def roll_artifact_class(field_rank, *, random_value=None):
    rank = max(1, min(4, int(field_rank)))
    common = ("trash", "1", "2", "3")[rank - 1]
    rare = ("1", "2", "3", "x")[rank - 1]
    value = random.random() if random_value is None else float(random_value)
    return common if value < 0.75 else rare


def guaranteed_artifact_class(field_rank):
    return ("trash", "1", "2", "3")[max(1, min(4, int(field_rank))) - 1]


def random_artifact(artifact_class, field_type=None, *, chooser=None):
    candidates = [
        item for item in artifact_catalog()
        if item["artifact_class"] == artifact_class
    ]
    if field_type:
        prefix = str(field_type).strip().casefold().replace("ё", "е")
        typed = [
            item for item in candidates
            if str(item.get("anomaly_type") or "").casefold().replace("ё", "е").startswith(prefix[:5])
        ]
        if typed:
            candidates = typed
    if not candidates:
        return None
    return (chooser or random.choice)(candidates)
