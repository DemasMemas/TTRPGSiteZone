import math
import random
import heapq
import re
from copy import deepcopy

from app.extensions import db
from app.models import Location, LocationCharacter, LocationCombatState, LobbyParticipant, LobbyCharacter, LocationObject
from app.models.templates import ItemTemplate
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError
from app.services.effects import advance_timed_effects, apply_effect_to_health, apply_expired_effects_to_health, apply_periodic_effects_to_health, normalize_character_effects, normalize_effect_list, sync_health_derived_statuses, tick_effects
from app.services.health import BASE_ORGAN_MAXIMUMS, apply_health_maximums
from sqlalchemy.orm.attributes import flag_modified


DEFAULT_ACTION_POINTS = 5
DEFAULT_FREE_ACTIONS = 1
DEFAULT_MOVEMENT_POINTS = 6
DEFAULT_CONVERSION_BASE = 10

ARMOR_MATERIAL_COEFFICIENTS = {
    'текстиль': 0.5,
    'композит': 1.0,
    'кевлар': 1.5,
    'плита': 2.0,
}
ARMOR_STAGE_LABELS = [
    '1. Целая',
    '2. Немного повреждена',
    '3. Повреждена',
    '4. Сильно повреждена',
    '5. Поломана',
]
HIT_ZONES = {
    'head', 'chest', 'abdomen',
    'left_arm', 'right_arm', 'left_leg', 'right_leg',
}

POSTURES = {
    'standing': {
        'label': 'Стоя',
        'movement_multiplier': 1,
        'walk_max_distance': 10,
        'shooting_bonus': 0,
        'ergonomics_bonus': 0,
        'stealth_bonus': 0,
        'can_run': True,
        'can_sprint': True,
        'can_correction': True,
        'can_use_low_cover': False,
    },
    'sitting': {
        'label': 'Сидя',
        'movement_multiplier': 2,
        'walk_max_distance': 5,
        'shooting_bonus': 1,
        'ergonomics_bonus': 10,
        'stealth_bonus': 2,
        'can_run': False,
        'can_sprint': False,
        'can_correction': True,
        'can_use_low_cover': True,
    },
    'prone': {
        'label': 'Лёжа',
        'movement_multiplier': 3,
        'walk_max_distance': 3,
        'shooting_bonus': 2,
        'ergonomics_bonus': 20,
        'stealth_bonus': 4,
        'can_run': False,
        'can_sprint': False,
        'can_correction': False,
        'can_use_low_cover': True,
    },
}

MOVEMENT_MODES = {
    'walk': {
        'label': 'Ходьба',
        'max_distance': 10,
        'movement_divisor': 1,
        'action_points': 0,
        'free_actions': 0,
    },
    'correction': {
        'label': 'Корректировка',
        'max_distance': 3,
        'movement_divisor': None,
        'action_points': 0,
        'free_actions': 1,
    },
    'run': {
        'label': 'Бег',
        'max_distance': 20,
        'movement_divisor': 2,
        'action_points': 2,
        'free_actions': 0,
    },
    'sprint': {
        'label': 'Спринт',
        'max_distance': 30,
        'movement_divisor': 3,
        'action_points': 4,
        'free_actions': 0,
    },
}

COVER_CLASSES = {
    'conditional': {'label': 'Условное', 'max_hp': 25, 'physical_protection': 0},
    'flimsy': {'label': 'Хлипкое', 'max_hp': 50, 'physical_protection': 5},
    'medium': {'label': 'Средней прочности', 'max_hp': 100, 'physical_protection': 20},
    'strong': {'label': 'Прочное', 'max_hp': 200, 'physical_protection': 40},
    'very_strong': {'label': 'Очень прочное', 'max_hp': 400, 'physical_protection': 60},
    'titanium': {'label': 'Титановое', 'max_hp': 800, 'physical_protection': 90},
    'special': {'label': 'Особое', 'max_hp': 200, 'physical_protection': 0},
}


ACTION_CATALOG = [
    {'key': 'attack', 'label': 'Атака', 'action_points': 3, 'free_actions': 0, 'movement_points': 0},
    {'key': 'aim', 'label': 'Прицеливание', 'action_points': 1, 'free_actions': 0, 'movement_points': 0},
    {'key': 'draw_weapon', 'label': 'Достать оружие', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'stow_weapon', 'label': 'Освободить руки', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'reload_weapon', 'label': 'Сменить магазин', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'clear_weapon_jam', 'label': 'Устранить клин', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'change_posture', 'label': 'Смена положения', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'defend', 'label': 'Защита', 'action_points': 2, 'free_actions': 0, 'movement_points': 0},
    {'key': 'use_item', 'label': 'Использовать предмет', 'action_points': 1, 'free_actions': 0, 'movement_points': 0},
    {'key': 'convert_free_action_to_movement', 'label': 'Получить ОП', 'action_points': 2, 'free_actions': 1, 'movement_points': 0},
    {'key': 'take_cover', 'label': 'Занять укрытие', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'leave_cover', 'label': 'Покинуть укрытие', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'brace_weapon', 'label': 'Поставить оружие на упор', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'melee_swing', 'label': 'Замах', 'action_points': 1, 'free_actions': 0, 'movement_points': 0},
    {'key': 'melee_block', 'label': 'Блок', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'melee_disarm', 'label': 'Выхватить вещь', 'action_points': 3, 'free_actions': 0, 'movement_points': 0},
    {'key': 'melee_shove', 'label': 'Толкание', 'action_points': 2, 'free_actions': 0, 'movement_points': 0},
    {'key': 'grapple', 'label': 'Захват', 'action_points': 4, 'free_actions': 0, 'movement_points': 0},
    {'key': 'grapple_escape', 'label': 'Освободиться', 'action_points': 4, 'free_actions': 0, 'movement_points': 0},
    {'key': 'grapple_release', 'label': 'Отпустить', 'action_points': 0, 'free_actions': 1, 'movement_points': 0},
    {'key': 'grapple_strengthen', 'label': 'Усилить хват', 'action_points': 3, 'free_actions': 0, 'movement_points': 0},
    {'key': 'grapple_choke', 'label': 'Удушение', 'action_points': 5, 'free_actions': 0, 'movement_points': 0},
    {'key': 'grapple_pain_hold', 'label': 'Болевой прием', 'action_points': 3, 'free_actions': 0, 'movement_points': 0},
    {'key': 'grapple_desperate_attack', 'label': 'Отчаянная атака', 'action_points': 3, 'free_actions': 0, 'movement_points': 0},
    {'key': 'grapple_live_shield', 'label': 'Живой щит', 'action_points': 3, 'free_actions': 0, 'movement_points': 0},
    {'key': 'recover_from_shock', 'label': 'Попытаться очнуться', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
]


class CombatService:
    WEAPON_JAM_RESULTS = {
        1: {'label': 'Гильза осталась в затворе', 'fix_ap': 1, 'durability_loss': 0, 'blocks_fire': True},
        2: {'label': 'Печная труба', 'fix_ap': 2, 'durability_loss': 1, 'blocks_fire': True},
        3: {'label': 'Смятый патрон сместил затвор', 'fix_ap': 4, 'durability_loss': 3, 'blocks_fire': True},
        4: {'label': 'Сбит прицел', 'fix_ap': 4, 'durability_loss': 3, 'accuracy_penalty': 2},
        5: {'label': 'Искривлён приклад', 'fix_ap': 4, 'durability_loss': 4, 'shooting_disadvantage': True},
        6: {'label': 'Натяжение пружины', 'fix_ap': 4, 'durability_loss': 4, 'extra_wear_per_shot': 1},
        7: {'label': 'Взрыв патрона в оружии', 'fix_ap': 4, 'durability_loss': 5, 'accuracy_penalty': 4},
        8: {'label': 'Двойная подача заклинила затвор', 'fix_ap': 5, 'durability_loss': 5, 'blocks_fire': True},
        9: {'label': 'Искривлён спусковой механизм', 'fix_ap': 5, 'durability_loss': 6, 'blocks_fire': True},
        10: {'label': 'Повреждены курок, затвор и рама', 'fix_ap': 8, 'durability_loss': 10, 'blocks_fire': True},
        11: {'label': 'Разрыв ствола', 'durability_loss': 10, 'accuracy_penalty': 5, 'repair_required': 'increase'},
        12: {'label': 'Разрушены боёк и затвор', 'durability_loss': 15, 'blocks_fire': True, 'repair_required': 'full'},
    }

    @staticmethod
    def _coerce_int(value, default=0):
        try:
            if value is None:
                return default
            return int(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _character_condition(character_data):
        data = character_data if isinstance(character_data, dict) else {}
        health = data.get('health') if isinstance(data.get('health'), dict) else {}
        effects = normalize_effect_list(health.get('effects') or [])
        active_types = {
            effect.get('type')
            for effect in effects
            if effect.get('active', True)
            and (
                effect.get('remaining') is None
                or CombatService._coerce_float(effect.get('remaining'), 0) > 0
            )
        }
        zones = health.get('zones') if isinstance(health.get('zones'), dict) else {}
        head_health = CombatService._coerce_float(
            (zones.get('head') or {}).get('current'), 1
        )
        chest_health = CombatService._coerce_float(
            (zones.get('chest') or {}).get('current'), 1
        )
        organs = health.get('organs') if isinstance(health.get('organs'), dict) else {}
        brain_health = CombatService._coerce_float(
            (organs.get('brain') or {}).get('current'), 1
        )
        skull_health = CombatService._coerce_float(
            (organs.get('skull') or {}).get('current'), 1
        )
        if 'death' in active_types or brain_health <= 0 or skull_health <= 0:
            return {'state': 'dead', 'label': 'Мёртв', 'can_act': False, 'can_recover': False}

        temperature = CombatService._coerce_float(health.get('temperature'), 36)
        current_health = CombatService._coerce_float(health.get('current'), 1)
        blood_stage = str(health.get('bloodStage') or health.get('blood') or 'normal').lower()
        critical = bool(
            active_types.intersection({'critical_condition', 'unconsciousness', 'sleep'})
            or current_health <= 0
            or head_health <= 0
            or chest_health <= 0
            or blood_stage == 'critical'
            or temperature <= 29
            or temperature >= 41
        )
        if critical:
            return {
                'state': 'critical',
                'label': 'Критическое состояние',
                'can_act': False,
                'can_recover': False,
            }
        if 'shock' in active_types:
            pain_level = max(0, CombatService._coerce_int(health.get('painLevel'), 0))
            return {
                'state': 'pain_shock',
                'label': 'Болевой шок',
                'can_act': False,
                'can_recover': pain_level < 10,
            }
        return {'state': 'active', 'label': 'В сознании', 'can_act': True, 'can_recover': False}

    @staticmethod
    def _location_character_condition(loc_char):
        character = getattr(loc_char, 'character', None)
        data = character.data if character and isinstance(character.data, dict) else {}
        return CombatService._character_condition(data)

    @staticmethod
    def ensure_character_can_act(loc_char, action_key=None):
        condition = CombatService._location_character_condition(loc_char)
        if condition['state'] == 'active':
            return condition
        if condition['state'] == 'pain_shock' and action_key == 'recover_from_shock':
            if not condition.get('can_recover', False):
                raise ValidationError("Pain must be reduced below 10 before recovering from pain shock")
            return condition
        if condition['state'] == 'dead':
            raise ValidationError("A dead character cannot act")
        if condition['state'] == 'pain_shock':
            raise ValidationError("Only an attempt to regain consciousness is available during pain shock")
        raise ValidationError("A character in critical condition cannot act")

    @staticmethod
    def _cover_profile(obj):
        properties = dict(getattr(obj, 'properties', {}) or {})
        cover_class = str(properties.get('cover_class') or 'medium').lower()
        base = COVER_CLASSES.get(cover_class, COVER_CLASSES['medium'])
        max_hp = max(1, CombatService._coerce_int(properties.get('cover_max_hp'), base['max_hp']))
        current_hp = max(0, min(max_hp, CombatService._coerce_int(properties.get('cover_hp'), max_hp)))
        base_protection = max(
            0,
            min(100, CombatService._coerce_int(
                properties.get('cover_base_physical_protection'),
                base['physical_protection'],
            )),
        )
        current_protection = max(
            0,
            min(base_protection, CombatService._coerce_int(
                properties.get('cover_physical_protection'),
                round(base_protection * current_hp / max_hp),
            )),
        )
        return {
            'class': cover_class,
            'label': base['label'],
            'hp': current_hp,
            'max_hp': max_hp,
            'base_physical_protection': base_protection,
            'physical_protection': current_protection,
            'mesh_hit_chance': 25 if properties.get('mesh_cover') else 100,
        }

    @staticmethod
    def _is_cover_object(obj):
        properties = getattr(obj, 'properties', {}) or {}
        obj_type = str(getattr(obj, 'type', '') or '').lower()
        if properties.get('cover_enabled') is False:
            return False
        if obj_type in {'floor', 'ground_item', 'campfire', 'anomaly'}:
            return False
        if obj_type == 'door' and properties.get('is_open'):
            return False
        return CombatService._object_height(obj) >= 0.3

    @staticmethod
    def apply_cover_damage(obj, damage, damage_type):
        profile = CombatService._cover_profile(obj)
        damage = max(0, CombatService._coerce_int(damage, 0))
        normalized_damage_type = str(damage_type or '').strip().lower()
        destructive = normalized_damage_type in {
            'explosive', 'blast', 'взрывной', 'взрыв',
            'crushing', 'blunt', 'дробящий', 'дробление',
        }
        remaining_hp = max(0, profile['hp'] - damage)
        remaining_protection = min(
            profile['physical_protection'],
            round(profile['base_physical_protection'] * remaining_hp / profile['max_hp']),
        )
        properties = dict(obj.properties or {})
        properties.update({
            'cover_class': profile['class'],
            'cover_max_hp': profile['max_hp'],
            'cover_hp': remaining_hp,
            'cover_base_physical_protection': profile['base_physical_protection'],
            'cover_physical_protection': remaining_protection,
        })
        obj.properties = properties
        flag_modified(obj, 'properties')
        destroyed = destructive and remaining_hp <= 0
        result = {
            'destroyed': destroyed,
            'class': profile['class'], 'label': profile['label'],
            'hp': remaining_hp, 'max_hp': profile['max_hp'],
            'base_physical_protection': profile['base_physical_protection'],
            'physical_protection': remaining_protection,
            'mesh_hit_chance': profile['mesh_hit_chance'],
        }
        if destroyed:
            LocationCharacter.query.filter_by(cover_object_id=obj.id).update({
                'cover_object_id': None,
                'weapon_braced': False,
                'braced_weapon_index': None,
            })
            db.session.delete(obj)
        return result

    @staticmethod
    def _characters_behind_cover(location_id, shooter, cover):
        candidates = []
        for target in LocationCharacter.query.filter_by(location_id=location_id).all():
            if target.id == shooter.id:
                continue
            continuation_distance = CombatService._cover_continuation_distance(
                shooter, cover, target
            )
            if continuation_distance is None:
                continue
            candidates.append((continuation_distance, target))
        return [
            target
            for _, target in sorted(candidates, key=lambda item: item[0])
        ]

    @staticmethod
    def _cover_continuation_distance(shooter, cover, target, max_tiles=3):
        """Return distance behind cover only for cells on the aimed ray."""
        start_x = float(shooter.pos_x) + 0.5
        start_y = float(shooter.pos_y) + 0.5
        cover_x = float(cover.tile_x) + 0.5
        cover_y = float(cover.tile_y) + 0.5
        target_x = float(target.pos_x) + 0.5
        target_y = float(target.pos_y) + 0.5

        ray_x = cover_x - start_x
        ray_y = cover_y - start_y
        scale = max(abs(ray_x), abs(ray_y))
        if scale <= 1e-9:
            return None
        direction_x = ray_x / scale
        direction_y = ray_y / scale
        direction_length_sq = direction_x ** 2 + direction_y ** 2

        target_offset_x = target_x - cover_x
        target_offset_y = target_y - cover_y
        distance_along_ray = (
            target_offset_x * direction_x + target_offset_y * direction_y
        ) / direction_length_sq
        if distance_along_ray <= 0:
            return None

        perpendicular_distance = abs(
            target_offset_x * direction_y - target_offset_y * direction_x
        ) / math.sqrt(direction_length_sq)
        if perpendicular_distance > 0.5:
            return None

        width, depth = CombatService._object_dimensions(cover)
        exit_distances = []
        if abs(direction_x) > 1e-9:
            exit_distances.append((width / 2) / abs(direction_x))
        if abs(direction_y) > 1e-9:
            exit_distances.append((depth / 2) / abs(direction_y))
        cover_exit = min(exit_distances) if exit_distances else 0
        distance_behind_cover = distance_along_ray - cover_exit
        if distance_behind_cover <= 0 or distance_behind_cover > max_tiles:
            return None
        return distance_behind_cover

    @staticmethod
    def _line_object_entry(shooter, target, obj):
        width, depth = CombatService._object_dimensions(obj)
        center_x = float(obj.tile_x) + 0.5
        center_y = float(obj.tile_y) + 0.5
        bounds = (
            center_x - width / 2,
            center_x + width / 2,
            center_y - depth / 2,
            center_y + depth / 2,
        )
        start_x = float(shooter.pos_x) + 0.5
        start_y = float(shooter.pos_y) + 0.5
        end_x = float(target.pos_x) + 0.5
        end_y = float(target.pos_y) + 0.5
        dx = end_x - start_x
        dy = end_y - start_y
        lower, upper = 0.0, 1.0
        for origin, delta, minimum, maximum in (
            (start_x, dx, bounds[0], bounds[1]),
            (start_y, dy, bounds[2], bounds[3]),
        ):
            if abs(delta) < 1e-9:
                if origin < minimum or origin > maximum:
                    return None
                continue
            first = (minimum - origin) / delta
            second = (maximum - origin) / delta
            if first > second:
                first, second = second, first
            lower = max(lower, first)
            upper = min(upper, second)
            if lower > upper:
                return None
        if lower <= 0.01 or lower >= 0.99:
            return None
        return lower

    @staticmethod
    def _cover_analysis(location_id, shooter, target):
        shooter_eye = {'standing': 1.65, 'sitting': 1.05, 'prone': 0.35}[
            CombatService._posture_key(shooter)
        ]
        zone_heights = {
            'standing': {
                'left_leg': 0.55, 'right_leg': 0.55, 'abdomen': 1.0,
                'chest': 1.35, 'left_arm': 1.25, 'right_arm': 1.25, 'head': 1.7,
            },
            'sitting': {
                'left_leg': 0.25, 'right_leg': 0.25, 'abdomen': 0.55,
                'chest': 0.85, 'left_arm': 0.8, 'right_arm': 0.8, 'head': 1.1,
            },
            'prone': {
                'left_leg': 0.2, 'right_leg': 0.2, 'abdomen': 0.25,
                'chest': 0.3, 'left_arm': 0.3, 'right_arm': 0.3, 'head': 0.4,
            },
        }[CombatService._posture_key(target)]
        blocked = {}
        objects = LocationObject.query.filter_by(location_id=location_id).all()
        for obj in objects:
            if not CombatService._is_cover_object(obj):
                continue
            entry = CombatService._line_object_entry(shooter, target, obj)
            if entry is None:
                continue
            height = CombatService._object_height(obj)
            for zone, target_height in zone_heights.items():
                ray_height = shooter_eye + (target_height - shooter_eye) * entry
                if ray_height <= height:
                    previous = blocked.get(zone)
                    if not previous or entry < previous['distance_factor']:
                        blocked[zone] = {
                            'object_id': obj.id,
                            'object_name': obj.name or obj.type,
                            'object_height': height,
                            'distance_factor': round(entry, 4),
                            **CombatService._cover_profile(obj),
                        }
        grade, accuracy_penalty, disadvantage, targetable = (
            CombatService._cover_grade(len(blocked), len(zone_heights))
        )
        return {
            'grade': grade,
            'blocked_zones': list(blocked),
            'zones': blocked,
            'accuracy_penalty': accuracy_penalty,
            'disadvantage': disadvantage,
            'targetable': targetable,
        }

    @staticmethod
    def _cover_grade(blocked_count, total_zones=7):
        blocked_count = max(0, CombatService._coerce_int(blocked_count, 0))
        total_zones = max(1, CombatService._coerce_int(total_zones, 7))
        if blocked_count == 0:
            grade, accuracy_penalty, disadvantage, targetable = 'none', 0, False, True
        elif blocked_count <= 3:
            grade, accuracy_penalty, disadvantage, targetable = 'half', 2, False, True
        elif blocked_count < total_zones:
            grade, accuracy_penalty, disadvantage, targetable = 'three_quarters', 2, True, True
        else:
            grade, accuracy_penalty, disadvantage, targetable = 'full', 0, False, False
        return grade, accuracy_penalty, disadvantage, targetable

    @staticmethod
    def _persistent_weapon_index(loc_char):
        character = getattr(loc_char, 'character', None)
        data = character.data if character and isinstance(character.data, dict) else {}
        weapons = data.get('weapons') if isinstance(data.get('weapons'), list) else []
        index = CombatService._coerce_int(data.get('activeWeaponIndex'), -1)
        return index if 0 <= index < len(weapons) else None

    @staticmethod
    def _set_active_weapon(loc_char, weapon_index):
        character = getattr(loc_char, 'character', None)
        if not character or not isinstance(character.data, dict):
            loc_char.drawn_weapon_index = weapon_index
            return
        data = dict(character.data)
        if weapon_index is None:
            data.pop('activeWeaponIndex', None)
        else:
            data['activeWeaponIndex'] = weapon_index
        character.data = data
        flag_modified(character, 'data')
        loc_char.drawn_weapon_index = weapon_index

    @staticmethod
    def _clear_aim(loc_char):
        loc_char.aimed_target_character_id = None
        loc_char.aimed_weapon_index = None
        loc_char.aim_accuracy_bonus = 0

    @staticmethod
    def _aim_bonus_for_target(loc_char, target_character_id, weapon_index):
        if (
            target_character_id is not None
            and loc_char.aimed_target_character_id == target_character_id
            and loc_char.aimed_weapon_index == weapon_index
        ):
            return max(0, CombatService._coerce_int(loc_char.aim_accuracy_bonus, 0))
        return 0

    @staticmethod
    def _skill_value(character_data, skill_path):
        current = character_data if isinstance(character_data, dict) else {}
        for part in skill_path.split('.'):
            if not isinstance(current, dict):
                return 0
            current = current.get(part)
        if not isinstance(current, dict):
            return 0
        stat_name = skill_path.split('.')[-1]
        equipment_bonus = (
            CombatService._exoskeleton_power_profile(character_data)['strength_level_bonus']
            if skill_path == 'skills.physical.strength'
            else 0
        )
        return max(
            0,
            CombatService._coerce_int(current.get('base'), 0)
            + CombatService._coerce_int(current.get('bonus'), 0)
            + CombatService._consumable_stat_value_bonus(character_data, stat_name)
            + equipment_bonus,
        )

    @staticmethod
    def _apply_numeric_modifier(value, modifier):
        text = str(modifier if modifier is not None else '').strip()
        if not text:
            return value
        if text.startswith('='):
            return CombatService._coerce_int(text[1:], 0)
        return value + CombatService._coerce_int(text, 0)

    @staticmethod
    def _ergonomics_effects(value):
        ergonomics = max(0, CombatService._coerce_int(value, 0))
        if ergonomics <= 10:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 4, 2, 2, -2
        elif ergonomics <= 20:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 3, 2, 2, -1
        elif ergonomics <= 30:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 3, 1, 1, -1
        elif ergonomics <= 40:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 3, 1, 1, 0
        elif ergonomics <= 50:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 2, 1, 0, 0
        elif ergonomics <= 70:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 2, 0, 0, 0
        elif ergonomics <= 80:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 1, 0, -1, 0
        elif ergonomics <= 90:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 1, 0, -1, 1
        elif ergonomics <= 99:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 1, -1, -1, 1
        else:
            draw_cost, reload_modifier, aimed_modifier, accuracy_modifier = 0, -2, -2, 2
        return {
            'value': ergonomics,
            'draw_action_points': draw_cost,
            'reload_action_points_modifier': reload_modifier,
            'aimed_shot_action_points_modifier': aimed_modifier,
            'aimed_shot_action_points': max(0, 4 + aimed_modifier),
            'accuracy_modifier': accuracy_modifier,
        }

    @staticmethod
    def _weapon_ergonomics_profile(loc_char, weapon, weapon_index=None):
        character = getattr(loc_char, 'character', None)
        data = character.data if character and isinstance(character.data, dict) else {}
        weapon = weapon if isinstance(weapon, dict) else {}
        template = None
        template_id = CombatService._coerce_int(weapon.get('templateId'), 0)
        if template_id:
            template = db.session.get(ItemTemplate, template_id)
        template_attributes = template.attributes if template and isinstance(template.attributes, dict) else {}

        raw_base = weapon.get('ergonomics')
        if raw_base is None:
            raw_base = (weapon.get('attributes') or {}).get('ergonomics')
        if raw_base is None:
            raw_base = template_attributes.get('ergonomics')
        base_ergonomics = CombatService._coerce_int(raw_base, 0)
        weapon_ergonomics = base_ergonomics
        module_modifier = 0
        for module in weapon.get('installedModules') or []:
            if not isinstance(module, dict):
                continue
            modifiers = module.get('modifiers')
            if not isinstance(modifiers, dict):
                modifiers = (module.get('attributes') or {}).get('modifiers') or {}
            before = weapon_ergonomics
            weapon_ergonomics = CombatService._apply_numeric_modifier(
                weapon_ergonomics,
                modifiers.get('ergonomics'),
            )
            module_modifier += weapon_ergonomics - before
            if (
                module.get('slotType') == 'handguard'
                and (module.get('bipod') or (module.get('attributes') or {}).get('bipod') or module.get('name') == 'Сошки')
                and module.get('deployed')
            ):
                weapon_ergonomics += 75
                module_modifier += 75

        magazine = weapon.get('installedMagazine')
        magazine = magazine if isinstance(magazine, dict) else {}
        magazine_modifier = magazine.get('ergonomics')
        if magazine_modifier is None:
            magazine_modifier = (magazine.get('attributes') or {}).get('ergonomics')
        if magazine_modifier is None:
            magazine_template_id = CombatService._coerce_int(magazine.get('templateId'), 0)
            if magazine_template_id:
                magazine_template = db.session.get(ItemTemplate, magazine_template_id)
                magazine_attributes = (
                    magazine_template.attributes
                    if magazine_template and isinstance(magazine_template.attributes, dict)
                    else {}
                )
                magazine_modifier = magazine_attributes.get('ergonomics')
        magazine_modifier = CombatService._coerce_int(magazine_modifier, 0)

        equipment = data.get('equipment') if isinstance(data.get('equipment'), dict) else {}
        helmet = equipment.get('helmet') if isinstance(equipment.get('helmet'), dict) else {}
        helmet_penalty = helmet.get('ergonomicsPenalty')
        if helmet_penalty is None:
            helmet_penalty = helmet.get('ergonomics_penalty')
        if helmet_penalty is None:
            helmet_penalty = (helmet.get('attributes') or {}).get('ergonomics_penalty')
        helmet_penalty = max(0, CombatService._coerce_int(helmet_penalty, 0))
        gas_mask = equipment.get('gasMask') if isinstance(equipment.get('gasMask'), dict) else {}
        gas_mask_penalty = gas_mask.get('ergonomicsPenalty')
        if gas_mask_penalty is None:
            gas_mask_penalty = gas_mask.get('ergonomics_penalty')
        if gas_mask_penalty is None:
            gas_mask_penalty = (gas_mask.get('attributes') or {}).get('ergonomics_penalty')
        gas_mask_penalty = max(0, CombatService._coerce_int(gas_mask_penalty, 0))

        posture = CombatService._posture_key(loc_char)
        posture_bonus = POSTURES[posture]['ergonomics_bonus']
        shooting_value = (
            CombatService._skill_value(data, 'skills.physical.shooting')
            + CombatService._health_roll_modifier(data, 'skills.physical.shooting')
        )
        tactics_value = (
            CombatService._skill_value(data, 'skills.other.tactics')
            + CombatService._health_roll_modifier(data, 'skills.other.tactics')
        )
        effective_value = max(
            0,
            weapon_ergonomics
            + shooting_value
            + tactics_value
            + posture_bonus
            + magazine_modifier
            - helmet_penalty
            - gas_mask_penalty,
        )
        effects = CombatService._ergonomics_effects(effective_value)
        return {
            'weapon_index': weapon_index,
            'base_weapon_ergonomics': base_ergonomics,
            'module_modifier': module_modifier,
            'shooting_value': shooting_value,
            'tactics_value': tactics_value,
            'posture_bonus': posture_bonus,
            'magazine_modifier': magazine_modifier,
            'helmet_penalty': helmet_penalty,
            'gas_mask_penalty': gas_mask_penalty,
            **effects,
        }

    @staticmethod
    def _weapon_strength_profile(loc_char, weapon):
        character = getattr(loc_char, 'character', None)
        data = character.data if character and isinstance(character.data, dict) else {}
        weapon = weapon if isinstance(weapon, dict) else {}
        template = None
        template_id = CombatService._coerce_int(weapon.get('templateId'), 0)
        if template_id:
            template = db.session.get(ItemTemplate, template_id)
        template_attributes = template.attributes if template and isinstance(template.attributes, dict) else {}
        attributes = weapon.get('attributes') if isinstance(weapon.get('attributes'), dict) else {}
        required = CombatService._coerce_int(
            weapon.get(
                'minStrength',
                weapon.get(
                    'min_strength',
                    attributes.get('min_strength', template_attributes.get('min_strength')),
                ),
            ),
            0,
        )
        base_required = required
        has_bipod = False
        for module in weapon.get('installedModules') or []:
            if not isinstance(module, dict):
                continue
            module_attributes = module.get('attributes') if isinstance(module.get('attributes'), dict) else {}
            modifiers = module.get('modifiers')
            modifiers = modifiers if isinstance(modifiers, dict) else module_attributes.get('modifiers', {})
            modifier = modifiers.get('min_strength') if isinstance(modifiers, dict) else None
            if modifier is None and isinstance(modifiers, dict):
                modifier = modifiers.get('required_strength')
            required = CombatService._apply_numeric_modifier(required, modifier)
            has_bipod = has_bipod or bool(
                module.get('slotType') == 'handguard'
                and (
                    module.get('bipod')
                    or module_attributes.get('bipod')
                    or module.get('name') == 'Сошки'
                )
            )

        posture = CombatService._posture_key(loc_char)
        posture_reduction = {'standing': 0, 'sitting': 2, 'prone': 6}[posture]
        ignored_by_bipod = posture == 'prone' and has_bipod
        effective_required = 0 if ignored_by_bipod else max(0, required - posture_reduction)
        strength = (
            CombatService._skill_value(data, 'skills.physical.strength')
        )
        deficit = max(0, effective_required - strength)
        return {
            'base_required': base_required,
            'module_modifier': required - base_required,
            'posture_reduction': posture_reduction,
            'effective_required': effective_required,
            'strength': strength,
            'deficit': deficit,
            'accuracy_penalty': deficit * 2,
            'ignored_by_bipod': ignored_by_bipod,
        }

    @staticmethod
    def _posture_key(loc_char):
        posture = str(getattr(loc_char, 'posture', None) or 'standing').lower()
        return posture if posture in POSTURES else 'standing'

    @staticmethod
    def _posture_change_options(loc_char, target_posture):
        source = CombatService._posture_key(loc_char)
        target = str(target_posture or '').lower()
        if target not in POSTURES:
            raise ValidationError("Unknown posture")
        if source == target:
            raise ValidationError("Character is already in this posture")

        data = loc_char.character.data if loc_char.character and isinstance(loc_char.character.data, dict) else {}
        agility_bonus = CombatService._skill_modifier(data, 'skills.physical.agility')
        transition = frozenset((source, target))
        if transition == frozenset(('standing', 'sitting')):
            return [{'resource': 'movement', 'cost': max(0, 5 - agility_bonus)}]
        if transition == frozenset(('sitting', 'prone')):
            return [
                {'resource': 'movement', 'cost': 4},
                {'resource': 'action', 'cost': 1},
            ]
        if transition == frozenset(('standing', 'prone')):
            return [{'resource': 'movement', 'cost': max(0, 8 - agility_bonus)}]
        raise ValidationError("Unsupported posture transition")

    @staticmethod
    def _validate_posture_movement(posture, movement_mode):
        posture_key = posture if posture in POSTURES else 'standing'
        posture_profile = POSTURES[posture_key]
        if movement_mode == 'run' and not posture_profile['can_run']:
            raise ValidationError("Running is only possible while standing")
        if movement_mode == 'sprint' and not posture_profile['can_sprint']:
            raise ValidationError("Sprinting is only possible while standing")
        if movement_mode == 'correction' and not posture_profile['can_correction']:
            raise ValidationError("Correction movement is unavailable while prone")
        return posture_profile

    @staticmethod
    def _validate_equipment_movement(character_data, movement_mode):
        profile = CombatService._exoskeleton_power_profile(character_data)
        if (
            movement_mode in {'run', 'sprint'}
            and profile['blocks_strenuous_movement']
        ):
            raise ValidationError("Running and sprinting are unavailable in an exoskeleton")
        return profile

    @staticmethod
    def _strenuous_movement_is_blocked(character, movement_mode, current_round):
        if movement_mode not in {'run', 'sprint'}:
            return False
        # Breathlessness starts after selecting the mode, but must not interrupt
        # further movement segments made with that mode in the same turn.
        if character.movement_mode_this_turn == movement_mode:
            return False
        blocked_until = character.strenuous_movement_blocked_until_round or 0
        return blocked_until > 0 and current_round <= blocked_until

    @staticmethod
    def _movement_route_cost(path, movement_mode, posture='standing'):
        mode = MOVEMENT_MODES.get(movement_mode)
        if not mode:
            raise ValidationError("Unknown movement mode")
        posture_profile = POSTURES.get(posture, POSTURES['standing'])
        route = path if isinstance(path, dict) else {}
        route_tiles = route.get('path') if isinstance(route.get('path'), list) else []
        distance = max(0, len(route_tiles) - 1)
        raw_cost = max(0, CombatService._coerce_int(route.get('cost'), distance))
        climb_cost = max(0, CombatService._coerce_int(route.get('climb_cost'), 0))
        travel_cost = max(0, raw_cost - climb_cost)
        divisor = mode['movement_divisor']
        adjusted_travel_cost = travel_cost * posture_profile['movement_multiplier']
        movement_cost = 0 if divisor is None else math.ceil(adjusted_travel_cost / divisor)
        return {
            'distance': distance,
            'movement_points': movement_cost + climb_cost,
            'climb_cost': climb_cost,
        }

    @staticmethod
    def _get_location(location_id):
        location = Location.query.get(location_id)
        if not location:
            raise NotFoundError("Location not found")
        return location

    @staticmethod
    def _ensure_access(location, user_id):
        if location.lobby.gm_id == user_id:
            return True
        participant = LobbyParticipant.query.filter_by(
            lobby_id=location.lobby_id,
            user_id=user_id,
        ).first()
        if not participant or participant.is_banned:
            raise PermissionDenied("Access denied")
        return False

    @staticmethod
    def _get_or_create_state(location_id):
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state:
            state = LocationCombatState(location_id=location_id)
            db.session.add(state)
            db.session.flush()
        return state

    @staticmethod
    def _unique_location_characters(characters):
        unique_by_character = {}
        for character in sorted(characters, key=lambda item: item.id, reverse=True):
            if character.character_id not in unique_by_character:
                unique_by_character[character.character_id] = character
        return list(unique_by_character.values())

    @staticmethod
    def _combat_profile(loc_char):
        character = loc_char.character
        data = character.data if character and isinstance(character.data, dict) else {}
        combat_data = data.get('combat', {}) if isinstance(data, dict) else {}

        initiative_bonus = (
            CombatService._skill_modifier(data, 'skills.other.tactics')
            + CombatService._coerce_int(
                combat_data.get(
                    'initiative_bonus',
                    data.get('initiative_bonus', 0),
                ),
                0,
            )
        )
        movement_points = combat_data.get(
            'movement_points',
            combat_data.get(
                'speed',
                data.get('movement_points', data.get('speed', loc_char.movement_points_max or DEFAULT_MOVEMENT_POINTS)),
            ),
        )
        action_points = combat_data.get('action_points', data.get('action_points', DEFAULT_ACTION_POINTS))
        action_points = CombatService._coerce_int(action_points, DEFAULT_ACTION_POINTS) + CombatService._consumable_stat_bonus(data, 'action_points')
        if CombatService._disabled_limb_penalties(data)['all']:
            action_points -= 2
        free_actions = combat_data.get('free_actions', data.get('free_actions', DEFAULT_FREE_ACTIONS))
        movement_penalty = CombatService._movement_penalty(loc_char)
        movement_gain = max(0, DEFAULT_CONVERSION_BASE - movement_penalty)

        return {
            'initiative_bonus': CombatService._coerce_int(initiative_bonus, 0),
            'movement_points': max(0, CombatService._coerce_int(movement_points, movement_gain * max(1, CombatService._coerce_int(free_actions, DEFAULT_FREE_ACTIONS)))),
            'action_points': max(0, CombatService._coerce_int(action_points, DEFAULT_ACTION_POINTS)),
            'free_actions': max(0, CombatService._coerce_int(free_actions, DEFAULT_FREE_ACTIONS)),
            'movement_penalty': movement_penalty,
            'movement_gain': movement_gain,
        }

    @staticmethod
    def _movement_penalty(loc_char):
        character = loc_char.character
        data = character.data if character and isinstance(character.data, dict) else {}
        return CombatService._movement_penalty_breakdown(data)['total']

    @staticmethod
    def _movement_penalty_breakdown(data):
        data = data if isinstance(data, dict) else {}
        equipment = data.get('equipment', {}) if isinstance(data, dict) else {}
        armor = equipment.get('armor', {}) if isinstance(equipment, dict) else {}
        helmet = equipment.get('helmet', {}) if isinstance(equipment, dict) else {}
        helmet = helmet if isinstance(helmet, dict) else {}

        armor_penalty = (
            armor.get('movementPenalty')
            if isinstance(armor, dict) else None
        )
        if armor_penalty is None and isinstance(armor, dict):
            armor_penalty = armor.get('movement_penalty')
        helmet_attributes = (
            CombatService._template_attributes(helmet)
            if isinstance(helmet, dict) else {}
        )
        helmet_penalty = 0 if helmet.get('integratedWithArmor') else (
            helmet.get(
                'movementPenalty',
                helmet.get(
                    'movement_penalty',
                    helmet_attributes.get('movement_penalty', 0),
                ),
            )
            if isinstance(helmet, dict) else 0
        )

        weight_details = CombatService._inventory_weight_details(data)
        weight_penalty = weight_details['penalty']
        temporary_penalty = CombatService._consumable_stat_bonus(data, 'movement_points')
        limb_penalty = CombatService._disabled_limb_penalties(data)['movement']
        health = data.get('health', {}) if isinstance(data, dict) else {}
        effects = normalize_effect_list(health.get('effects') or []) if isinstance(health, dict) else []
        suppressed_fracture_areas = {
            str(effect.get('area') or '').strip().lower()
            for effect in effects
            if effect.get('suppress_fracture')
            and effect.get('active', True)
            and (effect.get('remaining') is None or CombatService._coerce_float(effect.get('remaining'), 0) > 0)
        }
        fracture_penalty = 0
        for effect in effects:
            if not effect.get('active', True):
                continue
            if effect.get('remaining') is not None and CombatService._coerce_float(effect.get('remaining'), 0) <= 0:
                continue
            effect_type = str(effect.get('type') or '').strip()
            area = str(effect.get('area') or '').strip().lower()
            if area in suppressed_fracture_areas:
                continue
            if effect_type in {'fracture', 'fracture_fixed', 'fracture_unfixed'} and any(token in area for token in ('leg', 'foot')):
                fracture_penalty += 2 if effect_type == 'fracture_fixed' else 3
            elif effect_type == 'fracture_sequela' and any(token in area for token in ('leg', 'foot')):
                fracture_penalty += 1
        limb_penalty += fracture_penalty
        exoskeleton = CombatService._exoskeleton_power_profile(data)
        if exoskeleton['is_exoskeleton']:
            if exoskeleton['powered']:
                armor_penalty = 5
                weight_penalty = 0
        total = max(
            0,
            CombatService._coerce_int(armor_penalty, 0)
            + CombatService._coerce_int(helmet_penalty, 0)
            + weight_penalty
            + temporary_penalty
            + limb_penalty,
        )
        return {
            'total': total,
            'armor': CombatService._coerce_int(armor_penalty, 0),
            'helmet': CombatService._coerce_int(helmet_penalty, 0),
            'weight': weight_penalty,
            'weight_raw': weight_details['raw_penalty'],
            'backpack_reduction': weight_details['backpack_reduction'],
            'weight_per_penalty': weight_details['weight_per_penalty'],
            'total_weight': weight_details['total_weight'],
            'temporary': temporary_penalty,
            'injuries': limb_penalty,
            'is_exoskeleton': exoskeleton['is_exoskeleton'],
            'powered_exoskeleton': exoskeleton['powered'],
        }

    @staticmethod
    def _exoskeleton_power_profile(character_data):
        data = character_data if isinstance(character_data, dict) else {}
        equipment = data.get('equipment') if isinstance(data.get('equipment'), dict) else {}
        armor = equipment.get('armor') if isinstance(equipment.get('armor'), dict) else {}
        attributes = CombatService._template_attributes(armor)
        armor_name = str(armor.get('name') or '').strip().lower().replace('ё', 'е')
        is_exoskeleton = armor_name == 'экзоскелет' or bool(
            armor.get('isExoskeleton') or attributes.get('is_exoskeleton')
        )
        powered = False
        if is_exoskeleton:
            battery = next(
                (
                    module for module in armor.get('installedModules', [])
                    if isinstance(module, dict)
                    and (
                        module.get('slotType') == 'exoskeleton_battery'
                        or (module.get('attributes') or {}).get('slot_type') == 'exoskeleton_battery'
                    )
                ),
                None,
            )
            if battery is not None:
                battery_attributes = (
                    battery.get('attributes')
                    if isinstance(battery.get('attributes'), dict)
                    else {}
                )
                powered = CombatService._coerce_float(
                    battery_attributes.get('remaining_days'),
                    0,
                ) > 0
            elif armor.get('requiresExoskeletonBattery') is False:
                powered = bool(armor.get('powered', attributes.get('powered')))
        return {
            'is_exoskeleton': is_exoskeleton,
            'powered': powered,
            'strength_level_bonus': 8 if powered else 0,
            'blocks_strenuous_movement': is_exoskeleton,
        }

    @staticmethod
    def _item_total_weight(item):
        if not isinstance(item, dict):
            return 0.0
        category = item.get('category')
        quantity = max(0, CombatService._coerce_int(item.get('quantity'), 1))
        try:
            base_weight = float(item.get('weight') or 0)
        except (TypeError, ValueError):
            base_weight = 0.0

        if category == 'magazine':
            ammo = item.get('ammo') if isinstance(item.get('ammo'), list) else []
            current_ammo = sum(
                max(0, CombatService._coerce_int(stack.get('quantity'), 0))
                for stack in ammo
                if isinstance(stack, dict)
            )
            weight_key = 'loadedWeight' if current_ammo > 0 else 'emptyWeight'
            try:
                base_weight = float(item.get(weight_key) or 0)
            except (TypeError, ValueError):
                base_weight = 0.0
        elif category == 'ammo':
            if quantity <= 0:
                return 0.0
            try:
                single_volume = float(item.get('volume') or 0.02)
            except (TypeError, ValueError):
                single_volume = 0.02
            return 0.1 if single_volume * quantity < 0.5 else 0.25

        total = base_weight * max(1, quantity)
        for key in ('contents', 'installedModules'):
            nested = item.get(key)
            if isinstance(nested, list):
                total += sum(CombatService._item_total_weight(child) for child in nested)
        return total

    @staticmethod
    def _inventory_movement_penalty(character_data):
        return CombatService._inventory_weight_details(character_data)['penalty']

    @staticmethod
    def _inventory_weight_details(character_data):
        if not isinstance(character_data, dict):
            return {
                'penalty': 0,
                'raw_penalty': 0,
                'backpack_reduction': 0,
                'weight_per_penalty': 5.0,
                'total_weight': 0.0,
                'effective_strength': 10,
                'strength_bonus': 0,
            }
        inventory = character_data.get('inventory')
        inventory = inventory if isinstance(inventory, dict) else {}
        equipment = character_data.get('equipment')
        equipment = equipment if isinstance(equipment, dict) else {}

        carried_items = []
        for key in ('backpack', 'pockets'):
            values = inventory.get(key)
            if isinstance(values, list):
                carried_items.extend(values)
        for group in ('belt', 'vest'):
            container = equipment.get(group)
            pouches = container.get('pouches') if isinstance(container, dict) else []
            for pouch in pouches if isinstance(pouches, list) else []:
                if isinstance(pouch, dict) and isinstance(pouch.get('contents'), list):
                    carried_items.extend(pouch['contents'])
        weapons = character_data.get('weapons')
        if isinstance(weapons, list):
            carried_items.extend(weapons)

        total_weight = sum(CombatService._item_total_weight(item) for item in carried_items)
        strength = ((character_data.get('skills') or {}).get('physical') or {}).get('strength')
        effective_strength = (
            CombatService._skill_value(character_data, 'skills.physical.strength')
            if isinstance(strength, dict)
            else 10
        )
        strength_capacity_modifier = math.floor((effective_strength - 10) / 2)
        weight_per_penalty = max(
            0.5,
            5 * (1 + strength_capacity_modifier * 0.1),
        )
        backpack_reduction = 0
        backpack = equipment.get('backpack')
        if isinstance(backpack, dict):
            attributes = backpack.get('attributes')
            attributes = attributes if isinstance(attributes, dict) else {}
            backpack_reduction = max(
                0,
                CombatService._coerce_int(attributes.get('weight_reduction'), 0),
            )
        raw_penalty = math.floor(total_weight / weight_per_penalty)
        return {
            'penalty': max(0, raw_penalty - backpack_reduction),
            'raw_penalty': raw_penalty,
            'backpack_reduction': backpack_reduction,
            'weight_per_penalty': weight_per_penalty,
            'total_weight': total_weight,
            'effective_strength': effective_strength,
            'strength_bonus': strength_capacity_modifier,
        }

    @staticmethod
    def _health_roll_modifier(
        character_data,
        skill_path,
        include_pain=True,
        include_blood=True,
        include_psy=True,
    ):
        health = character_data.get('health') if isinstance(character_data, dict) else {}
        if not isinstance(health, dict):
            return 0
        modifier = 0
        if include_pain:
            modifier -= CombatService._coerce_int(health.get('painLevel'), 0)
        exhaustion = CombatService._coerce_int(health.get('exhaustion'), 0)
        modifier -= {1: 1, 2: 2, 3: 4}.get(exhaustion, 6 if exhaustion >= 4 else 0)
        if include_blood:
            blood_stage = str(
                health.get('blood') or health.get('bloodStage') or 'normal'
            ).lower()
            modifier -= {
                'light': 2,
                'medium': 3,
                'severe': 5,
            }.get(blood_stage, 0)
        limb_penalties = CombatService._disabled_limb_penalties(character_data)
        modifier -= limb_penalties['all']
        if skill_path == 'skills.physical.shooting':
            modifier -= limb_penalties['shooting']
        elif skill_path == 'skills.physical.melee':
            modifier -= limb_penalties['melee']
        elif skill_path == 'skills.physical.agility':
            modifier -= limb_penalties['agility']

        temperature = CombatService._coerce_float(health.get('temperature'), 36.0)
        if 30 <= temperature <= 33:
            modifier -= 7
        elif 38 <= temperature <= 39:
            modifier -= 3
        elif 40 <= temperature < 41:
            modifier -= 7

        for zone in (health.get('zones') or {}).values():
            if not isinstance(zone, dict):
                continue
            penalties = zone.get('penalties') if isinstance(zone.get('penalties'), dict) else {}
            modifier -= CombatService._coerce_int(zone.get('rollPenalty', zone.get('roll_penalty')), 0)
            modifier -= CombatService._coerce_int(zone.get('skillPenalty'), 0)
            modifier -= CombatService._coerce_int(penalties.get('all', penalties.get('roll')), 0)
            modifier -= CombatService._coerce_int(penalties.get(skill_path), 0)
            modifier -= CombatService._coerce_int(
                penalties.get('physical' if skill_path.startswith('skills.physical.') else 'other'), 0
            )

        active_effects = normalize_effect_list(health.get('effects') or [])
        suppressed_fracture_areas = {
            str(effect.get('area') or '').strip().lower()
            for effect in active_effects
            if effect.get('suppress_fracture')
            and effect.get('active', True)
            and (effect.get('remaining') is None or CombatService._coerce_float(effect.get('remaining'), 0) > 0)
        }
        for effect in active_effects:
            if not effect.get('active', True):
                continue
            if effect.get('remaining') is not None and CombatService._coerce_float(effect.get('remaining'), 0) <= 0:
                continue
            modifiers = effect.get('modifiers') if isinstance(effect.get('modifiers'), dict) else {}
            modifier -= CombatService._coerce_int(
                effect.get('rollPenalty', effect.get('roll_penalty', effect.get('skillPenalty', 0))), 0
            )
            modifier -= CombatService._coerce_int(modifiers.get('all'), 0)
            modifier -= CombatService._coerce_int(modifiers.get(skill_path), 0)
            modifier -= CombatService._coerce_int(
                modifiers.get('physical' if skill_path.startswith('skills.physical.') else 'other'), 0
            )
            if effect.get('type') == 'stimulant_crash':
                modifier -= CombatService._coerce_int(effect.get('phase_penalty', effect.get('value', 0)), 0)
            if skill_path.startswith('skills.physical.'):
                effect_type = str(effect.get('type') or '').strip()
                area = str(effect.get('area') or '').strip().lower()
                if area in suppressed_fracture_areas:
                    continue
                if effect_type in {'fracture', 'fracture_fixed', 'fracture_unfixed'} and any(token in area for token in ('arm', 'hand')):
                    modifier -= 1 if effect_type == 'fracture_fixed' else 2
                elif effect_type == 'fracture_sequela' and any(token in area for token in ('arm', 'hand')):
                    modifier -= 1

        if include_psy and skill_path == 'skills.physical.will':
            psy_state = CombatService._coerce_int(health.get('psyState', health.get('psy_state')), 0)
            modifier -= 1 if psy_state >= 10 else 0
        return modifier

    @staticmethod
    def _zone_current_health(character_data, zone):
        health = character_data.get('health') if isinstance(character_data, dict) else {}
        zones = health.get('zones') if isinstance(health, dict) else {}
        if not isinstance(zones, dict):
            return None
        value = zones.get(zone)
        if not isinstance(value, dict):
            return None
        return CombatService._coerce_float(value.get('current'), None)

    @staticmethod
    def _disabled_limb_penalties(character_data):
        left_arm = CombatService._zone_current_health(character_data, 'leftArm')
        right_arm = CombatService._zone_current_health(character_data, 'rightArm')
        left_leg = CombatService._zone_current_health(character_data, 'leftLeg')
        right_leg = CombatService._zone_current_health(character_data, 'rightLeg')
        abdomen = CombatService._zone_current_health(character_data, 'abdomen')
        health = character_data.get('health') if isinstance(character_data, dict) else {}
        effects = normalize_effect_list(health.get('effects') or []) if isinstance(health, dict) else []
        catastrophic_by_area = {
            str(effect.get('area') or ''): str(effect.get('type') or '')
            for effect in effects
            if effect.get('active', True) and effect.get('type') in {'mangled_limb', 'amputation'}
        }
        arm_values = {'leftArm': left_arm, 'rightArm': right_arm}
        leg_values = {'leftLeg': left_leg, 'rightLeg': right_leg}
        disabled_arms = sum(
            value is not None and value <= 0 or area in catastrophic_by_area
            for area, value in arm_values.items()
        )
        leg_penalties = []
        for area, value in leg_values.items():
            injury_type = catastrophic_by_area.get(area)
            if injury_type == 'amputation':
                leg_penalties.append(6)
            elif injury_type == 'mangled_limb':
                leg_penalties.append(5)
            elif value is not None and value <= 0:
                leg_penalties.append(3)
            else:
                leg_penalties.append(0)
        disabled_legs = sum(penalty > 0 for penalty in leg_penalties)
        return {
            'all': 3 if abdomen is not None and abdomen <= 0 else 0,
            'shooting': 3 * disabled_arms,
            'melee': 3 * disabled_arms,
            'agility': sum(leg_penalties),
            'movement': sum(leg_penalties),
            'sprint_blocked': disabled_legs > 0,
            'unusable_arms': disabled_arms,
        }

    @staticmethod
    def _has_roll_disadvantage(character_data, skill_path):
        health = character_data.get('health') if isinstance(character_data, dict) else {}
        if not isinstance(health, dict):
            return False
        psy_state = CombatService._coerce_int(health.get('psyState', health.get('psy_state')), 0)
        return (
            skill_path == 'skills.physical.shooting' and psy_state >= 30
        ) or (
            skill_path == 'skills.physical.will' and psy_state >= 40
        )

    @staticmethod
    def _item_attributes(item):
        if not isinstance(item, dict):
            return {}
        attributes = item.get('attributes')
        return attributes if isinstance(attributes, dict) else {}

    @staticmethod
    def _template_attributes(item):
        attributes = CombatService._item_attributes(item)
        template_id = CombatService._coerce_int(item.get('templateId'), 0) if isinstance(item, dict) else 0
        if template_id:
            template = db.session.get(ItemTemplate, template_id)
            if template and isinstance(template.attributes, dict):
                merged = dict(template.attributes)
                merged.update(attributes)
                return merged
        return attributes

    @staticmethod
    def _weapon_template(item):
        template_id = CombatService._coerce_int(
            item.get('templateId'), 0
        ) if isinstance(item, dict) else 0
        return db.session.get(ItemTemplate, template_id) if template_id else None

    @staticmethod
    def _manual_cycle_type(weapon):
        attributes = CombatService._template_attributes(weapon)
        explicit = weapon.get('manualCycle') or attributes.get('manual_cycle')
        if explicit:
            return str(explicit)
        name = str(weapon.get('name') or '').strip().lower().replace('ё', 'е')
        if any(value in name for value in (
            'суслик', 'малинова', 'мачеха 51', 'свет-99', 'пылесос'
        )) or re.search(r'(?:^|\s)ау(?:\s|$)', name):
            return 'bolt'
        if any(value in name for value in (
            'гора б88', 'гора 580б2', 'ремень 787', 'спаситель 70', 'д-2', 'д2'
        )):
            return 'pump'
        return None

    @staticmethod
    def _weapon_durability(weapon):
        weapon = weapon if isinstance(weapon, dict) else {}
        attributes = CombatService._template_attributes(weapon)
        maximum = max(1, CombatService._coerce_int(
            weapon.get('maxDurability', weapon.get('max_durability', attributes.get('max_durability', 100))),
            100,
        ))
        current = max(0, min(maximum, CombatService._coerce_int(
            weapon.get('durability', maximum), maximum
        )))
        weapon['maxDurability'] = maximum
        weapon['durability'] = current
        jam = weapon.get('jam')
        if isinstance(jam, dict):
            requirement = jam.get('repair_required')
            if requirement == 'increase' and current > CombatService._coerce_int(
                jam.get('durability_after'), current
            ):
                weapon.pop('jam', None)
            elif requirement == 'full' and current >= maximum:
                weapon.pop('jam', None)
        return current, maximum

    @staticmethod
    def _weapon_wear_multiplier(weapon, ammo_profile=None):
        template = CombatService._weapon_template(weapon)
        subcategory = str(
            (template.subcategory if template else None)
            or weapon.get('subcategory')
            or ''
        ).strip().lower().replace('ё', 'е')
        multiplier = 2 if subcategory in {
            'пистолеты', 'снайперские винтовки', 'пулеметы'
        } else 1
        variant = str((ammo_profile or {}).get('ammo_variant') or '').strip().lower()
        if variant and variant not in {'base', 'standard', 'обычный', 'обычная'}:
            multiplier *= 2
        return multiplier

    @staticmethod
    def _apply_weapon_wear(weapon, amount):
        current, maximum = CombatService._weapon_durability(weapon)
        loss = max(0, CombatService._coerce_int(amount, 0))
        weapon['durability'] = max(0, current - loss)
        return {'before': current, 'after': weapon['durability'], 'maximum': maximum, 'loss': loss}

    @staticmethod
    def _weapon_jam_profile(durability):
        value = max(0, CombatService._coerce_int(durability, 0))
        if value <= 0:
            return 20, 12, 6
        if value <= 10:
            return 15, 12, 2
        if value <= 30:
            return 10, 12, 0
        if value <= 45:
            return 7, 10, 0
        if value <= 60:
            return 4, 8, 0
        if value <= 75:
            return 2, 6, 0
        if value <= 90:
            return 1, 4, 0
        return 0, 0, 0

    @staticmethod
    def _roll_weapon_jam(weapon):
        if isinstance(weapon.get('jam'), dict):
            return None
        current, _ = CombatService._weapon_durability(weapon)
        chance, die, bonus = CombatService._weapon_jam_profile(current)
        if chance <= 0:
            return {'triggered': False, 'check_roll': None, 'chance': 0}
        check_roll = random.randint(1, 20)
        if check_roll > chance:
            return {'triggered': False, 'check_roll': check_roll, 'chance': chance}
        strength_roll = random.randint(1, die) + bonus
        result_number = min(12, strength_roll)
        jam = {
            'result': result_number,
            'check_roll': check_roll,
            'chance': chance,
            'strength_roll': strength_roll,
            **CombatService.WEAPON_JAM_RESULTS[result_number],
        }
        wear = CombatService._apply_weapon_wear(weapon, jam.get('durability_loss', 0))
        jam['durability_after'] = wear['after']
        weapon['jam'] = jam
        return {'triggered': True, **jam}

    @staticmethod
    def _consume_weapon_ammo(weapon, shots):
        remaining = max(0, CombatService._coerce_int(shots, 0))
        magazine = weapon.get('installedMagazine')
        stacks = magazine.get('ammo') if isinstance(magazine, dict) else None
        if not isinstance(stacks, list):
            stacks = weapon.get('fixedAmmo') if isinstance(weapon.get('fixedAmmo'), list) else None
        if isinstance(stacks, list):
            while remaining > 0 and stacks:
                stack = stacks[-1]
                quantity = max(0, CombatService._coerce_int(stack.get('quantity'), 0))
                consumed = min(remaining, quantity)
                stack['quantity'] = quantity - consumed
                remaining -= consumed
                if stack['quantity'] <= 0:
                    stacks.pop()
            weapon['ammo'] = sum(
                max(0, CombatService._coerce_int(stack.get('quantity'), 0))
                for stack in stacks if isinstance(stack, dict)
            )
            if isinstance(magazine, dict):
                magazine['weight'] = CombatService._coerce_float(
                    magazine.get('loadedWeight'), 0.25
                ) if weapon['ammo'] > 0 else CombatService._coerce_float(
                    magazine.get('emptyWeight'), 0
                )
        else:
            weapon['ammo'] = max(0, CombatService._coerce_int(weapon.get('ammo'), 0) - remaining)

    @staticmethod
    def _weapon_use_wear(weapon, *, fire_mode=None, shot_count=1, volley_count=1, ammo_profile=None, butt=False):
        multiplier = CombatService._weapon_wear_multiplier(weapon, ammo_profile)
        units = 0
        if not weapon.get('_usedInCurrentCombat'):
            weapon['_usedInCurrentCombat'] = True
            units += 1
        if butt:
            units += 1
        elif fire_mode == 'burst':
            units += max(1, CombatService._coerce_int(volley_count, 1))
        elif fire_mode in {'suppression', 'area'}:
            units += max(1, CombatService._coerce_int(volley_count, 1))
        elif CombatService._coerce_int(shot_count, 1) > 1:
            units += max(1, CombatService._coerce_int(shot_count, 1) // 2)
        return CombatService._apply_weapon_wear(weapon, units * multiplier)

    @staticmethod
    def _is_pistol_weapon(item):
        if not isinstance(item, dict):
            return False
        subcategory = str(item.get('subcategory') or '').strip().lower()
        template_id = CombatService._coerce_int(item.get('templateId'), 0)
        if template_id:
            template = db.session.get(ItemTemplate, template_id)
            if template:
                subcategory = str(template.subcategory or subcategory).strip().lower()
        return subcategory == 'пистолеты'

    @staticmethod
    def _aimed_zone_difficulty_penalty(zone):
        return 5 if zone == 'head' else 0

    @staticmethod
    def _parse_percent(value, default=0.0):
        if isinstance(value, (int, float)):
            return float(value)
        match = re.search(r'-?\d+(?:[.,]\d+)?', str(value or ''))
        if not match:
            return default
        try:
            return float(match.group(0).replace(',', '.'))
        except ValueError:
            return default

    @staticmethod
    def _protection_percent(value, default=0.0):
        parsed = CombatService._parse_percent(value, default)
        return parsed * 100 if 0 < abs(parsed) <= 1 else parsed

    @staticmethod
    def _random_hit_zone(roll, aimed_zone=None, melee=False):
        if aimed_zone in {'head', 'chest', 'abdomen', 'left_arm', 'right_arm', 'left_leg', 'right_leg'}:
            return aimed_zone
        if melee:
            return {
                1: 'right_leg', 2: 'left_leg', 3: 'abdomen',
                4: 'chest', 5: 'left_arm', 6: 'right_arm',
            }.get(random.randint(1, 6), 'chest')
        if roll <= 3:
            return 'left_arm'
        if roll <= 6:
            return 'left_leg'
        if roll <= 9:
            return 'abdomen'
        if roll <= 12:
            return 'right_leg'
        if roll <= 14:
            return 'abdomen'
        if roll <= 19:
            return 'chest'
        return 'head'

    @staticmethod
    def _weapon_damage_profile(weapon, attack_type=None):
        attributes = CombatService._template_attributes(weapon)
        damage = CombatService._coerce_float(attributes.get('damage', weapon.get('damage', 0)), 0)
        penetration = CombatService._parse_percent(
            attributes.get('armor_piercing', attributes.get('penetration', weapon.get('armor_piercing', 0))),
            0,
        )
        if -1 < penetration < 1:
            penetration *= 100
        bleeding = attributes.get('bleeding', attributes.get('bleeding_level', ''))
        if attack_type:
            attack_modifiers = attributes.get('attack_modifiers') or {}
            selected = attack_modifiers.get(attack_type) if isinstance(attack_modifiers, dict) else None
            if isinstance(selected, dict):
                damage += CombatService._coerce_float(selected.get('damage'), 0)
                penetration += CombatService._parse_percent(selected.get('armor_piercing'), 0)
            else:
                attack_name = str(attack_type).lower()
                if 'кол' in attack_name:
                    damage *= 1.25
                    penetration += 10
                elif 'реж' in attack_name:
                    damage *= 0.75
                    penetration = max(0, penetration - 10)
                elif 'всп' in attack_name:
                    damage *= 1.35
                    penetration += 10
                elif 'круг' in attack_name:
                    penetration = max(0, penetration - 10)
        melee_damage_type = attributes.get(
            'melee_damage_type',
            attributes.get('attack_type', weapon.get('attackType')),
        )
        attack_name = str(attack_type or '').strip().lower().replace('ё', 'е')
        if attack_name:
            if 'круг' in attack_name:
                allowed_attacks = [
                    str(item or '').strip().lower().replace('ё', 'е')
                    for item in (attributes.get('allowed_attacks') or [])
                ]
                melee_damage_type = (
                    'slashing'
                    if any('руб' in item for item in allowed_attacks)
                    else 'crushing'
                )
            else:
                melee_damage_type = attack_type
        return {
            'damage': max(0, damage),
            'armor_piercing': penetration,
            'weight': max(0, CombatService._coerce_float(
                weapon.get('weight', attributes.get('weight', 0)),
                0,
            )),
            'bleeding': bleeding,
            'accuracy': attributes.get('accuracy', weapon.get('accuracy', 0)),
            'effective_range': CombatService._coerce_int(
                attributes.get('effective_range', attributes.get('range', weapon.get('range', 0))), 0
            ),
            'damage_type': attributes.get('damage_type', 'physical'),
            'melee_damage_type': melee_damage_type,
            'weight_class': attributes.get(
                'weight_class',
                weapon.get('weightClass', weapon.get('weight_class', 'heavy')),
            ),
        }

    @staticmethod
    def _ranged_damage_profile(weapon):
        magazine = weapon.get('installedMagazine') or {}
        stacks = magazine.get('ammo') if isinstance(magazine, dict) else []
        if not isinstance(stacks, list) or not stacks:
            stacks = weapon.get('fixedAmmo') if isinstance(weapon.get('fixedAmmo'), list) else []
        stack = next((
            item
            for item in reversed(stacks or [])
            if isinstance(item, dict)
            and CombatService._coerce_int(item.get('quantity'), 0) > 0
        ), None)
        if not stack:
            return CombatService._weapon_damage_profile(weapon), None
        profile = CombatService._weapon_damage_profile(stack)
        attributes = CombatService._template_attributes(stack)
        profile['caliber'] = attributes.get('caliber', stack.get('caliber'))
        profile['ammo_variant'] = (
            attributes.get('ammo_variant')
            or stack.get('ammo_variant')
            or attributes.get('ammo_kind')
        )
        profile['ammo_name'] = stack.get('name') or attributes.get('name')
        return profile, stack

    @staticmethod
    def _virtual_melee_profile(attack_type, weapon=None, character_data=None):
        attack_key = str(attack_type or '').strip().lower()
        if attack_key == 'unarmed':
            strength_bonus = CombatService._skill_modifier(
                character_data or {}, 'skills.physical.strength'
            )
            return {
                'damage': max(10, 10 * strength_bonus),
                'armor_piercing': 0,
                'bleeding': '',
                'accuracy': 0,
                'damage_type': 'physical',
                'melee_damage_type': 'crushing',
                'weight_class': 'light',
                'weight': 0,
                'skip_strength_scaling': True,
            }
        if attack_key == 'firearm_butt':
            weapon = weapon if isinstance(weapon, dict) else {}
            attributes = CombatService._template_attributes(weapon)
            weight = CombatService._coerce_float(
                weapon.get('weight', attributes.get('weight', 0)), 0
            )
            return {
                'damage': 25 if weight <= 1 else 40,
                'armor_piercing': 0,
                'bleeding': '',
                'accuracy': 0,
                'damage_type': 'physical',
                'melee_damage_type': 'crushing',
                'weight_class': 'light' if weight <= 1 else 'heavy',
                'weight': max(0, weight),
            }
        if attack_key == 'grapple_desperate':
            strength_bonus = CombatService._skill_modifier(
                character_data or {}, 'skills.physical.strength'
            )
            return {
                'damage': max(0, 10 + 5 * strength_bonus),
                'armor_piercing': 0,
                'bleeding': '',
                'accuracy': 0,
                'damage_type': 'physical',
                'melee_damage_type': 'crushing',
                'weight_class': 'heavy',
                'weight': 0,
                'skip_strength_scaling': True,
            }
        return None

    @staticmethod
    def _melee_action_cost(profile, attack_type=None):
        profile = profile if isinstance(profile, dict) else {}
        attack_key = str(attack_type or '').strip().lower().replace('ё', 'е')
        if attack_key == 'unarmed':
            return 2
        weight_class = str(profile.get('weight_class') or '').strip().lower()
        if 'очень' in weight_class or 'heavy_plus' in weight_class:
            base_cost = 4
        elif 'лег' in weight_class or weight_class == 'light':
            base_cost = 2
        else:
            base_cost = 3
        modifier = 0
        if 'кол' in attack_key:
            modifier = 1
        elif 'реж' in attack_key:
            modifier = -1
        elif 'всп' in attack_key:
            modifier = 2
        elif 'круг' in attack_key:
            modifier = 1
        return max(1, base_cost + modifier)

    @staticmethod
    def _crushing_damage_multiplier(profile):
        profile = profile if isinstance(profile, dict) else {}
        damage_type = str(profile.get('melee_damage_type') or '').strip().lower()
        if 'дроб' not in damage_type and damage_type != 'crushing':
            return None
        weight = max(0, CombatService._coerce_float(profile.get('weight'), 0))
        return min(1.0, (20 + 5 * weight) / 100)

    @staticmethod
    def _is_adjacent(first, second):
        return max(
            abs(first.pos_x - second.pos_x),
            abs(first.pos_y - second.pos_y),
        ) == 1

    @staticmethod
    def _is_behind(attacker, target):
        facing_x = CombatService._coerce_int(getattr(target, 'facing_x', 0), 0)
        facing_y = CombatService._coerce_int(getattr(target, 'facing_y', 1), 1)
        relative_x = attacker.pos_x - target.pos_x
        relative_y = attacker.pos_y - target.pos_y
        return facing_x * relative_x + facing_y * relative_y < 0

    @staticmethod
    def _opposed_roll(character_data, skill_path, attribute_paths=(), disadvantage=False):
        skill = CombatService._skill_modifier(character_data, skill_path)
        attribute = max(
            (
                CombatService._skill_modifier(character_data, path)
                for path in attribute_paths
            ),
            default=0,
        )
        rolls = [random.randint(1, 20)]
        if disadvantage:
            rolls.append(random.randint(1, 20))
        roll = min(rolls)
        return {
            'roll': roll,
            'rolls': rolls,
            'bonus': skill + attribute,
            'total': roll + skill + attribute,
            'critical_success': roll == 20,
            'critical_failure': roll == 1,
        }

    @staticmethod
    def _has_free_hand(loc_char):
        if loc_char.drawn_weapon_index is None:
            return True
        data = loc_char.character.data if loc_char.character and isinstance(loc_char.character.data, dict) else {}
        weapons = data.get('weapons') if isinstance(data.get('weapons'), list) else []
        index = CombatService._coerce_int(loc_char.drawn_weapon_index, -1)
        if not 0 <= index < len(weapons):
            return True
        weapon = weapons[index] if isinstance(weapons[index], dict) else {}
        attributes = CombatService._template_attributes(weapon)
        hands = attributes.get('hands', weapon.get('hands'))
        if hands is not None:
            return CombatService._coerce_int(hands, 2) <= 1
        return not bool(
            attributes.get('two_handed')
            or weapon.get('twoHanded')
            or weapon.get('two_handed')
        )

    @staticmethod
    def _has_usable_free_hand(loc_char):
        if not CombatService._has_free_hand(loc_char):
            return False
        data = (
            loc_char.character.data
            if loc_char and loc_char.character and isinstance(loc_char.character.data, dict)
            else {}
        )
        health = data.get('health') if isinstance(data.get('health'), dict) else {}
        zones = health.get('zones') if isinstance(health.get('zones'), dict) else {}
        arm_values = []
        for aliases in (('leftArm', 'left_arm'), ('rightArm', 'right_arm')):
            zone = next(
                (zones.get(key) for key in aliases if isinstance(zones.get(key), dict)),
                None,
            )
            if zone is None:
                arm_values.append(1)
            else:
                arm_values.append(CombatService._coerce_float(zone.get('current'), 0))
        functional_arms = sum(1 for value in arm_values if value > 0)
        occupied_hands = 0 if loc_char.drawn_weapon_index is None else 1
        return functional_arms > occupied_hands

    @staticmethod
    def _clear_grapple(holder, captive=None):
        if not holder:
            return
        if captive is None and holder.grapple_target_id:
            captive = db.session.get(LocationCharacter, holder.grapple_target_id)
        holder.grapple_target_id = None
        holder.grapple_strengthened = False
        holder.grapple_choke_rounds = 0
        holder.grapple_live_shield = False
        if captive and captive.grappled_by_id == holder.id:
            captive.grappled_by_id = None

    @staticmethod
    def _release_invalid_grapples(location_id):
        holders = LocationCharacter.query.filter(
            LocationCharacter.location_id == location_id,
            LocationCharacter.grapple_target_id.isnot(None),
        ).all()
        for holder in holders:
            captive = db.session.get(LocationCharacter, holder.grapple_target_id)
            holder_condition = CombatService._location_character_condition(holder)
            invalid = bool(
                not captive
                or captive.location_id != location_id
                or captive.grappled_by_id != holder.id
                or holder_condition['state'] in {'critical', 'dead'}
                or not CombatService._has_usable_free_hand(holder)
            )
            if invalid:
                CombatService._clear_grapple(holder, captive)

    @staticmethod
    def _sync_grapple_facing(holder, captive=None):
        if not holder:
            return
        if captive is None and holder.grapple_target_id:
            captive = db.session.get(LocationCharacter, holder.grapple_target_id)
        if captive:
            captive.facing_x = CombatService._coerce_int(holder.facing_x, 0)
            captive.facing_y = CombatService._coerce_int(holder.facing_y, 1)

    @staticmethod
    def _live_shield_target(holder):
        if not holder or not getattr(holder, 'grapple_live_shield', False):
            return None
        target_id = getattr(holder, 'grapple_target_id', None)
        return db.session.get(LocationCharacter, target_id) if target_id else None

    @staticmethod
    def _caliber_key(value):
        return re.sub(
            r'[^0-9a-zа-я]+',
            '',
            str(value or '').strip().lower().replace('х', 'x'),
        )

    @staticmethod
    def _is_buckshot_profile(profile):
        profile = profile if isinstance(profile, dict) else {}
        variant = str(profile.get('ammo_variant') or '').strip().lower()
        ammo_name = str(profile.get('ammo_name') or '').strip().lower()
        return (
            CombatService._caliber_key(profile.get('caliber')) == '12x70'
            and (variant == 'buckshot' or 'картеч' in ammo_name)
        )

    @staticmethod
    def _is_12x70_slug_profile(profile):
        profile = profile if isinstance(profile, dict) else {}
        variant = str(profile.get('ammo_variant') or '').strip().lower()
        ammo_name = str(profile.get('ammo_name') or '').strip().lower()
        return (
            CombatService._caliber_key(profile.get('caliber')) == '12x70'
            and (variant == 'slug' or 'пуля' in ammo_name)
        )

    @staticmethod
    def _is_mutant_character(character_data):
        data = character_data if isinstance(character_data, dict) else {}
        basic = data.get('basic') if isinstance(data.get('basic'), dict) else {}
        if any(
            bool(value)
            for value in (
                data.get('is_mutant'),
                data.get('isMutant'),
                basic.get('is_mutant'),
                basic.get('isMutant'),
            )
        ):
            return True
        labels = (
            data.get('character_type'),
            data.get('characterType'),
            data.get('species'),
            basic.get('character_type'),
            basic.get('characterType'),
            basic.get('species'),
        )
        return any('мутант' in str(value or '').strip().lower() for value in labels)

    @staticmethod
    def _behind_armor_damage_multiplier(
        profile,
        *,
        target_data=None,
        penetration_deficit=0,
    ):
        profile = profile if isinstance(profile, dict) else {}
        variant = str(profile.get('ammo_variant') or '').strip().lower()
        caliber = CombatService._caliber_key(profile.get('caliber'))
        if CombatService._is_12x70_slug_profile(profile):
            multiplier = 0.10 if variant in {'ep', 'эп', 'rip'} else (1 / 3)
        elif CombatService._is_buckshot_profile(profile):
            multiplier = (
                0.50
                if (
                    CombatService._is_mutant_character(target_data)
                    and CombatService._coerce_float(penetration_deficit, 0) >= 10
                )
                else 0.0
            )
        elif variant in {'ep', 'эп', 'rip'}:
            multiplier = 0.0
        else:
            multiplier = 0.25 if caliber in {'9x39', '127x55'} else 0.20
        if (
            multiplier > 0
            and CombatService._exoskeleton_power_profile(target_data)['is_exoskeleton']
        ):
            multiplier /= 2
        return multiplier

    @staticmethod
    def _armor_covers_zone(slot, item, attributes, zone):
        zone_group = (
            'head' if zone == 'head'
            else 'torso' if zone in {'chest', 'abdomen'}
            else 'arms' if zone in {'left_arm', 'right_arm'}
            else 'legs'
        )
        name = str(item.get('name') or '').strip().lower()
        if slot == 'armor':
            torso_only = {'армейский бронежилет'}
            torso_and_arms = {
                'кожаная куртка',
                'бандитская куртка',
                'броня путника',
            }
            full_body = {
                'костюм химзащиты',
                'комбинезон купол',
                'комбинезон купол м',
                'комбинезон купол-м',
                'комбинезон гроб',
                'экзоскелет',
            }
            normalized_name = name.replace('ё', 'е')
            if normalized_name in torso_only:
                return zone_group == 'torso'
            if normalized_name in torso_and_arms:
                return zone_group in {'torso', 'arms'}
            if normalized_name in full_body:
                return zone_group in {'torso', 'arms', 'legs', 'head'}
        declared = attributes.get('protection_zones')
        if isinstance(declared, list) and declared:
            normalized = {str(value).strip().lower() for value in declared}
            if zone_group == 'head':
                return bool(normalized & {'head', 'crown', 'back', 'ears', 'face'})
            return zone_group in normalized
        return zone == 'head' if slot in {'helmet', 'gasMask'} else zone != 'head'

    @staticmethod
    def _armor_stage_penalty(item, damage_type='physical'):
        stage = max(1, min(5, CombatService._coerce_int(item.get('stage'), 1)))
        penalty = 0
        if stage >= 3 and damage_type == 'physical':
            penalty += 10
        if stage >= 4:
            penalty += 10
        if stage >= 5:
            penalty += 25
            penalty += max(0, CombatService._coerce_int(item.get('brokenProtectionLoss'), 0))
        return penalty

    @staticmethod
    def _armor_stage_capacity(item, attributes):
        base_durability = CombatService._coerce_float(
            item.get(
                'durability',
                item.get(
                    'maxDurability',
                    attributes.get('max_durability', attributes.get('durability', 1)),
                ),
            ),
            1,
        )
        material = str(
            item.get('material')
            or attributes.get('material')
            or attributes.get('armor_type')
            or 'композит'
        ).strip().lower()
        coefficient = ARMOR_MATERIAL_COEFFICIENTS.get(material, 1.0)
        return max(1, math.floor(10 * coefficient * max(0, base_durability)))

    @staticmethod
    def _damage_armor_item(item, attributes, incoming_damage):
        damage = max(0, CombatService._coerce_float(incoming_damage, 0))
        if damage <= 0:
            return None
        stage = max(1, min(5, CombatService._coerce_int(item.get('stage'), 1)))
        capacity = max(
            1,
            CombatService._coerce_float(
                item.get('stageDurability'),
                CombatService._armor_stage_capacity(item, attributes),
            ),
        )
        item['stageDurability'] = capacity
        current = CombatService._coerce_float(
            item.get('currentStageDurability'),
            capacity if stage < 5 else 0,
        )
        original_stage = stage
        remaining = damage
        while remaining > 0 and stage < 5:
            available = max(0, current)
            if remaining < available:
                current = available - remaining
                remaining = 0
                break
            remaining -= available
            stage += 1
            current = capacity if stage < 5 else 0

        if stage >= 5 and remaining > 0:
            previous_broken_damage = max(0, CombatService._coerce_float(item.get('brokenDamage'), 0))
            total_broken_damage = previous_broken_damage + remaining
            previous_losses = math.floor(previous_broken_damage / 50)
            total_losses = math.floor(total_broken_damage / 50)
            new_losses = max(0, total_losses - previous_losses)
            item['brokenDamage'] = total_broken_damage
            if new_losses:
                durability = max(
                    0,
                    CombatService._coerce_int(
                        item.get('durability', attributes.get('max_durability', 1)),
                        1,
                    ) - new_losses,
                )
                item['durability'] = durability
                item['brokenProtectionLoss'] = (
                    max(0, CombatService._coerce_int(item.get('brokenProtectionLoss'), 0))
                    + new_losses
                )

        item['stage'] = stage
        item['currentStageDurability'] = max(0, current)
        item['condition'] = ARMOR_STAGE_LABELS[stage - 1]
        return {
            'name': item.get('name'),
            'stage_before': original_stage,
            'stage_after': stage,
            'stage_durability': item['currentStageDurability'],
            'damage': damage,
        }

    @staticmethod
    def _is_gas_mask_item(slot, item, attributes):
        attributes = attributes if isinstance(attributes, dict) else {}
        category = str(item.get('category') or '').strip().lower()
        return bool(
            slot == 'gasMask'
            or category == 'gas_mask'
            or attributes.get('requires_filter')
            or attributes.get('is_gas_mask')
        )

    @staticmethod
    def _damage_gas_mask(item, source):
        if not isinstance(item, dict):
            return None
        source_key = str(source or '').strip().lower()
        durability_damage = 1 if source_key == 'anomaly' else (
            10 if source_key in {'bullet', 'melee'} else 0
        )
        before = max(0, CombatService._coerce_int(item.get('durability'), 0))
        after = max(0, before - durability_damage)
        item['durability'] = after
        item.pop('stage', None)
        item.pop('stageDurability', None)
        item.pop('currentStageDurability', None)
        item.pop('brokenDamage', None)
        item.pop('brokenProtectionLoss', None)
        item['condition'] = 'Целый' if after > 0 else 'Сломан'
        return {
            'name': item.get('name'),
            'durability_before': before,
            'durability_after': after,
            'damage': durability_damage,
            'source': source_key,
        }

    @staticmethod
    def _is_gas_or_chemical_profile(profile):
        profile = profile if isinstance(profile, dict) else {}
        values = {
            str(profile.get('damage_type') or '').strip().lower(),
            str(profile.get('ammo_variant') or '').strip().lower(),
            str(profile.get('ammo_kind') or '').strip().lower(),
        }
        return bool(values & {'gas', 'chemical', 'химический', 'газовый', 'газ'})

    @staticmethod
    def _functioning_gas_protection(character_data):
        equipment = (
            character_data.get('equipment')
            if isinstance(character_data, dict)
            and isinstance(character_data.get('equipment'), dict)
            else {}
        )
        for slot in ('gasMask', 'helmet'):
            item = equipment.get(slot)
            if not isinstance(item, dict):
                continue
            attributes = CombatService._template_attributes(item)
            if (
                CombatService._is_gas_mask_item(slot, item, attributes)
                and CombatService._coerce_int(
                    item.get(
                        'durability',
                        item.get(
                            'maxDurability',
                            attributes.get('max_durability', 0),
                        ),
                    ),
                    0,
                ) > 0
            ):
                return item
        return None

    @staticmethod
    def _integrated_helmet_profile(armor):
        if not isinstance(armor, dict):
            return None
        name = str(armor.get('name') or '').strip().lower().replace('ё', 'е')
        fixed_profiles = {
            'костюм химзащиты': (0, 2, 2),
            'комбинезон купол': (10, 3, 3),
            'комбинезон купол м': (35, 2, 3),
            'комбинезон купол-м': (35, 2, 3),
            'комбинезон гроб': (40, 4, 4),
        }
        if name == 'экзоскелет':
            protection = armor.get('protection')
            protection = protection if isinstance(protection, dict) else {}
            physical = max(
                0,
                CombatService._protection_percent(protection.get('physical'), 0) - 10,
            )
            return {
                'physical': physical,
                'charisma_penalty': 0,
                'accuracy_penalty': 2,
            }
        profile = fixed_profiles.get(name)
        if not profile:
            attributes = CombatService._template_attributes(armor)
            configured = attributes.get('integrated_helmet_profile')
            if not isinstance(configured, dict):
                return None
            return {
                'physical': CombatService._protection_percent(configured.get('physical'), 0),
                'charisma_penalty': max(0, CombatService._coerce_int(configured.get('charisma_penalty'), 0)),
                'accuracy_penalty': max(0, CombatService._coerce_int(configured.get('accuracy_penalty'), 0)),
            }
        physical, charisma_penalty, accuracy_penalty = profile
        return {
            'physical': physical,
            'charisma_penalty': charisma_penalty,
            'accuracy_penalty': accuracy_penalty,
        }

    @staticmethod
    def _equipment_accuracy_penalty(character_data):
        equipment = character_data.get('equipment') if isinstance(character_data, dict) else {}
        equipment = equipment if isinstance(equipment, dict) else {}
        armor = equipment.get('armor') if isinstance(equipment.get('armor'), dict) else {}
        integrated_profile = CombatService._integrated_helmet_profile(armor)
        if integrated_profile:
            return integrated_profile['accuracy_penalty']

        total = 0
        for slot in ('helmet', 'gasMask'):
            item = equipment.get(slot) if isinstance(equipment.get(slot), dict) else {}
            penalty = item.get('accuracyPenalty')
            if penalty is None:
                penalty = item.get('accuracy_penalty')
            if penalty is None:
                penalty = (item.get('attributes') or {}).get('accuracy_penalty')
            total += max(0, CombatService._coerce_int(penalty, 0))
        return total

    @staticmethod
    def _target_armor(target_data, zone):
        equipment = target_data.get('equipment') if isinstance(target_data, dict) else {}
        equipment = equipment if isinstance(equipment, dict) else {}
        candidates = []
        armor_item = equipment.get('armor') if isinstance(equipment.get('armor'), dict) else {}
        integrated_profile = (
            CombatService._integrated_helmet_profile(armor_item)
            if zone == 'head'
            else None
        )
        if integrated_profile:
            candidates.append((
                'integratedHelmet',
                armor_item,
                CombatService._template_attributes(armor_item),
                {'physical': integrated_profile['physical']},
            ))
        for slot in ('armor', 'helmet', 'gasMask'):
            item = equipment.get(slot)
            if isinstance(item, dict):
                if integrated_profile and zone == 'head':
                    continue
                attrs = CombatService._template_attributes(item)
                if not CombatService._armor_covers_zone(slot, item, attrs, zone):
                    continue
                protection = item.get('protection')
                if not isinstance(protection, dict):
                    protection = attrs.get('protection') if isinstance(attrs.get('protection'), dict) else {}
                candidates.append((slot, item, attrs, protection))
        zone_group = 'head' if zone == 'head' else ('torso' if zone in {'chest', 'abdomen'} else zone)
        total = 0.0
        details = []
        for slot, item, attrs, protection in candidates:
            is_gas_mask = CombatService._is_gas_mask_item(slot, item, attrs)
            if is_gas_mask and CombatService._coerce_int(
                item.get(
                    'durability',
                    item.get('maxDurability', attrs.get('max_durability', 0)),
                ),
                0,
            ) <= 0:
                continue
            value = protection.get(zone_group, protection.get('physical', 0))
            parsed = max(0.0, min(100.0, CombatService._protection_percent(value, 0)))
            if not is_gas_mask:
                parsed = max(0.0, parsed - CombatService._armor_stage_penalty(item, 'physical'))
            if parsed:
                total = max(total, parsed)
            if parsed or is_gas_mask:
                details.append({
                    'slot': slot,
                    'item': item,
                    'attributes': attrs,
                    'protection': parsed,
                    'is_gas_mask': is_gas_mask,
                })
        return total, details

    @staticmethod
    def _normalize_caliber(value):
        return (
            str(value or '').strip().lower()
            .replace('×', 'x').replace('*', 'x').replace('х', 'x')
            .replace(' ', '').replace(',', '.')
        )

    @staticmethod
    def _firearm_bleeding_modifier(profile):
        caliber = CombatService._normalize_caliber(profile.get('caliber'))
        modifier = 0
        if caliber.startswith('18x45'):
            modifier -= 20
        elif caliber.startswith(('9x18', '9x19')):
            modifier -= 1
        elif caliber.startswith(('12x70', '7.62x39', '7.62x51', '7.62x54', '9x39')):
            modifier += 2
        elif caliber.startswith('12.7x55') or 'аккумулятор' in caliber:
            modifier += 3
        variant = str(profile.get('ammo_variant') or '').strip().lower()
        modifier += {
            'ubp': -2,
            'bp': -1,
            'incendiary': -1,
            'ep': 2,
            'rip': 4,
            'explosive': 8,
        }.get(variant, 0)
        return modifier

    @staticmethod
    def _roll_firearm_bleeding(profile, armor, forced_roll=None):
        penetration = CombatService._coerce_float(profile.get('armor_piercing'), 0)
        if armor > 0 and penetration - armor < 10:
            return {
                'roll': None,
                'modifier': CombatService._firearm_bleeding_modifier(profile),
                'total': None,
                'stage': None,
                'blocked_by_armor': True,
            }
        roll = (
            max(1, min(6, CombatService._coerce_int(forced_roll, 1)))
            if forced_roll is not None
            else random.randint(1, 6)
        )
        modifier = CombatService._firearm_bleeding_modifier(profile)
        total = roll + modifier
        if total >= 8:
            stage = 'extreme'
        elif total >= 6:
            stage = 'severe'
        elif total >= 4:
            stage = 'medium'
        elif total >= 3:
            stage = 'light'
        else:
            stage = None
        return {
            'roll': roll,
            'modifier': modifier,
            'total': total,
            'stage': stage,
            'blocked_by_armor': False,
        }

    @staticmethod
    def _trauma_effects(zone, roll):
        bleeding = {
            'chest': {
                5: ('internal', 'light'), 8: ('external', 'light'),
                13: ('internal', 'medium'), 15: ('external', 'light'),
                18: ('internal', 'medium'),
            },
            'abdomen': {
                4: ('internal', 'medium'), 5: ('internal', 'light'),
                7: ('internal', 'severe'), 9: ('external', 'light'),
                12: ('external', 'light'), 14: ('internal', 'medium'),
                16: ('internal', 'light'), 19: ('internal', 'severe'),
            },
            'head': {
                7: ('internal', 'severe'), 9: ('external', 'extreme'),
            },
            'limb': {
                4: ('internal', 'light'), 6: ('internal', 'medium'),
                8: ('external', 'light'), 11: ('external', 'severe'),
            },
        }
        pain = {
            'chest': {2: 1, 10: 3, 19: 1},
            'abdomen': {2: 1, 3: 3, 11: 1, 13: 3, 15: 1, 18: 3},
            'head': {3: 3, 15: 1},
            'limb': {2: 2, 5: 1, 9: 3, 12: 1, 14: 1, 15: 2, 17: 3, 19: 2},
        }
        organs = {
            'chest': {
                1: 'heart', 3: 'rightLung', 4: 'leftLung', 6: 'rightLung',
                7: 'leftLung', 12: 'leftLung', 14: 'rightLung',
                16: 'rightLung', 17: 'leftLung', 20: 'spine',
            },
            'abdomen': {
                1: 'kidney', 6: 'stomach', 10: 'liver',
                17: 'spine', 20: 'kidney',
            },
            'head': {
                1: 'jaw', 4: 'rightEye', 6: 'nose', 8: 'rightEar',
                13: 'jaw', 14: 'leftEye', 16: 'nose', 17: 'jaw',
                20: 'leftEar',
            },
        }
        group = 'limb' if zone in {'left_arm', 'right_arm', 'left_leg', 'right_leg'} else zone
        return {
            'bleeding': bleeding.get(group, {}).get(roll),
            'pain': pain.get(group, {}).get(roll, 0),
            'fracture': group == 'limb' and roll in {3, 7, 10, 16, 18, 20},
            'shock': (
                (zone == 'chest' and roll in {9, 11})
                or (zone == 'abdomen' and roll == 8)
                or (zone == 'head' and roll in {10, 18})
            ),
            'organ': organs.get(group, {}).get(roll),
            'fall_or_drop': group == 'limb' and roll in {1, 13},
        }

    @staticmethod
    def _apply_organ_damage(health, organ_key, damage, area):
        if organ_key == 'kidney':
            organ_key = random.choice(('rightKidney', 'leftKidney'))
        maximum = BASE_ORGAN_MAXIMUMS.get(organ_key)
        if not maximum:
            return None
        organs = health.setdefault('organs', {})
        organ = organs.setdefault(organ_key, {'current': maximum, 'max': maximum})
        organ['max'] = maximum
        before = max(0, CombatService._coerce_float(organ.get('current'), maximum))
        organ['current'] = max(0, before - max(0, damage))
        result = {
            'organ': organ_key, 'current_before': before,
            'current': organ['current'], 'max': maximum,
            'disabled': before > 0 and organ['current'] <= 0,
        }
        if not result['disabled']:
            return result

        apply_effect_to_health(health, {
            'type': 'organ_loss', 'name': 'Повреждённый орган',
            'area': organ_key, 'source': 'organ_damage', 'tick': 'manual',
        })
        pain = {
            'heart': 10, 'rightLung': 5, 'leftLung': 5,
            'rightKidney': 8, 'leftKidney': 8, 'stomach': 8,
            'liver': 8, 'rightEye': 2, 'leftEye': 2,
            'rightEar': 2, 'leftEar': 2, 'nose': 2, 'jaw': 4, 'spine': 10,
        }.get(organ_key, 0)
        if pain:
            apply_effect_to_health(health, {
                'type': 'pain', 'value': pain,
                'source': 'disabled_organ', 'area': organ_key,
            })
        bleeding = {
            'rightLung': 'severe', 'leftLung': 'severe',
            'rightKidney': 'extreme', 'leftKidney': 'extreme',
            'stomach': 'severe',
        }.get(organ_key)
        if bleeding:
            apply_effect_to_health(health, {
                'type': f'bleeding_internal_{bleeding}',
                'source': 'disabled_organ', 'area': area,
            })
            result['bleeding'] = {'kind': 'internal', 'stage': bleeding, 'area': area}

        both_lungs = all(
            CombatService._coerce_float((organs.get(key) or {}).get('current'), BASE_ORGAN_MAXIMUMS[key]) <= 0
            for key in ('rightLung', 'leftLung')
        )
        both_kidneys = all(
            CombatService._coerce_float((organs.get(key) or {}).get('current'), BASE_ORGAN_MAXIMUMS[key]) <= 0
            for key in ('rightKidney', 'leftKidney')
        )
        if organ_key == 'brain':
            apply_effect_to_health(health, {
                'type': 'death', 'name': 'Смерть',
                'source': 'brain_destroyed', 'tick': 'manual',
            })
            result['death'] = True
        else:
            death_seconds = (
                60 if organ_key == 'heart' or both_lungs
                else 3600 if organ_key in {'spine', 'liver'} or both_kidneys
                else None
            )
            if death_seconds:
                apply_effect_to_health(health, {
                    'type': 'organ_failure',
                    'name': 'Смертельное повреждение органа',
                    'area': organ_key, 'source': 'organ_damage',
                    'tick': 'time_elapsed',
                    'remaining': 1,
                    'time_unit': 'minute' if death_seconds == 60 else 'hour',
                    'remaining_seconds': death_seconds,
                    'duration_seconds': death_seconds,
                    'death_on_expire': True,
                })
                result['death_in_seconds'] = death_seconds
        return result

    @staticmethod
    def _damage_pain_requirement(accumulated_damage, single_hit_damage):
        accumulated = max(0, CombatService._coerce_float(accumulated_damage, 0))
        single_hit = max(0, CombatService._coerce_float(single_hit_damage, 0))
        accumulated_pain = 0 if accumulated < 50 else 1 + math.floor((accumulated - 50) / 100)
        single_hit_pain = 3 if single_hit > 200 else (2 if single_hit > 150 else 0)
        return max(accumulated_pain, single_hit_pain)

    @staticmethod
    def _apply_attack_damage(
        target,
        damage,
        zone,
        profile,
        *,
        bleeding_result=None,
        round_number=None,
        allow_bleeding=True,
        trauma_checks=1,
        trauma_difficulty_modifier=0,
    ):
        character = target.character
        data = dict(character.data or {})
        health = apply_health_maximums(data)
        maximum = CombatService._coerce_float(health.get('max'), 700)
        health['max'] = maximum
        current = CombatService._coerce_float(health.get('current'), maximum)
        health['current'] = max(0, current - damage)
        zones = health.setdefault('zones', {})
        zone_key = zone
        camel_zone = {
            'left_arm': 'leftArm', 'right_arm': 'rightArm',
            'left_leg': 'leftLeg', 'right_leg': 'rightLeg',
        }.get(zone, zone)
        if camel_zone in zones:
            zone_key = camel_zone
        zone_data = zones.setdefault(zone_key, {'current': 0, 'max': 0})
        zone_max = CombatService._coerce_float(zone_data.get('max'), 0)
        zone_data['max'] = zone_max
        zone_current_before = CombatService._coerce_float(zone_data.get('current'), zone_max)
        zone_data['current'] = max(0, zone_current_before - damage)
        fatal_vital_hit = bool(
            zone_current_before <= 0 and zone_key in {'head', 'chest'}
        )
        if fatal_vital_hit:
            apply_effect_to_health(health, {
                'type': 'death',
                'name': 'Смерть',
                'area': zone_key,
                'source': 'hit_disabled_vital_zone',
                'tick': 'manual',
            })
        previous_destruction = CombatService._coerce_float(
            zone_data.get('destructionDamage'),
            max(0, zone_max - min(zone_max, zone_current_before)),
        )
        zone_data['destructionDamage'] = max(0, previous_destruction + max(0, damage))
        active_effects = normalize_effect_list(health.get('effects') or [])
        minimum_limb_health = max([
            CombatService._coerce_float(effect.get('minimum_limb_health'), 0)
            for effect in active_effects
            if effect.get('type') == 'temporary_limb_restoration'
            and str(effect.get('area') or '') == str(zone_key)
            and effect.get('active', True)
            and (effect.get('remaining') is None or CombatService._coerce_float(effect.get('remaining'), 0) > 0)
        ] or [0])
        if minimum_limb_health > 0:
            zone_data['current'] = max(minimum_limb_health, zone_data['current'])
        catastrophic_limb_injury = None
        limb_zones = {'leftArm', 'rightArm', 'leftLeg', 'rightLeg'}
        if zone_key in limb_zones and zone_max > 0 and minimum_limb_health <= 0:
            destruction_ratio = zone_data['destructionDamage'] / zone_max
            active_area_effects = [
                effect for effect in normalize_effect_list(health.get('effects') or [])
                if effect.get('active', True) and str(effect.get('area') or '') == str(zone_key)
            ]
            has_amputation = any(effect.get('type') == 'amputation' for effect in active_area_effects)
            has_mangled_limb = any(effect.get('type') == 'mangled_limb' for effect in active_area_effects)
            if destruction_ratio >= 5 and not has_amputation:
                loss_roll = random.randint(1, 6)
                loss_extent = (
                    'entire_limb' if loss_roll <= 2
                    else 'elbow_or_knee' if loss_roll <= 4
                    else 'hand_or_foot'
                )
                health['effects'] = [
                    effect for effect in normalize_effect_list(health.get('effects') or [])
                    if not (
                        effect.get('type') == 'mangled_limb'
                        and str(effect.get('area') or '') == str(zone_key)
                    )
                ]
                apply_effect_to_health(health, {
                    'type': 'amputation',
                    'name': 'Утраченная конечность',
                    'area': zone_key,
                    'source': 'catastrophic_limb_damage',
                    'tick': 'manual',
                    'loss_roll': loss_roll,
                    'loss_extent': loss_extent,
                    'treatment_window_seconds': 3600,
                })
                apply_effect_to_health(health, {
                    'type': 'shock', 'area': zone_key,
                    'source': 'catastrophic_limb_damage',
                })
                catastrophic_limb_injury = {
                    'type': 'amputation',
                    'area': zone_key,
                    'damage_ratio': destruction_ratio,
                    'loss_roll': loss_roll,
                    'loss_extent': loss_extent,
                }
            elif destruction_ratio >= 3 and not has_mangled_limb and not has_amputation:
                apply_effect_to_health(health, {
                    'type': 'mangled_limb',
                    'name': 'Искореженная конечность',
                    'area': zone_key,
                    'source': 'catastrophic_limb_damage',
                    'tick': 'manual',
                })
                apply_effect_to_health(health, {
                    'type': 'shock', 'area': zone_key,
                    'source': 'catastrophic_limb_damage',
                })
                catastrophic_limb_injury = {
                    'type': 'mangled_limb',
                    'area': zone_key,
                    'damage_ratio': destruction_ratio,
                }
        meta = health.setdefault('combatMeta', {})
        current_round = max(0, CombatService._coerce_int(round_number, 0))
        if damage > 0:
            meta['injuryRound'] = current_round
            if meta.get('damageStressRound') != current_round:
                stress_blocked = CombatService._coerce_int(meta.get('stressBlockTurns'), 0) > 0
                if not stress_blocked:
                    apply_effect_to_health(health, {
                        'type': 'stress', 'value': 1, 'source': 'combat_damage'
                    })
                meta['damageStressRound'] = current_round
            if meta.get('damagePainRound') != current_round:
                meta['damagePainRound'] = current_round
                meta['damageTakenThisRound'] = 0
                meta['damagePainAppliedThisRound'] = 0
            accumulated = CombatService._coerce_float(meta.get('damageTakenThisRound'), 0) + damage
            previous_pain = CombatService._coerce_int(meta.get('damagePainAppliedThisRound'), 0)
            required_pain = CombatService._damage_pain_requirement(accumulated, damage)
            pain_delta = max(0, required_pain - previous_pain)
            if pain_delta:
                apply_effect_to_health(health, {
                    'type': 'pain', 'value': pain_delta, 'source': 'combat_damage'
                })
            meta['damageTakenThisRound'] = accumulated
            meta['damagePainAppliedThisRound'] = max(previous_pain, required_pain)
        if zone_current_before > 0 and zone_data['current'] <= 0:
            disabled_zone_pain = {
                'left_arm': 4,
                'right_arm': 4,
                'left_leg': 3,
                'right_leg': 3,
                'abdomen': 3,
            }.get(zone, 0)
            if disabled_zone_pain:
                apply_effect_to_health(health, {
                    'type': 'pain',
                    'value': disabled_zone_pain,
                    'source': 'disabled_body_zone',
                    'area': zone_key,
                })
            if zone in {'head', 'chest'}:
                apply_effect_to_health(health, {
                    'type': 'shock',
                    'source': 'disabled_body_zone',
                    'area': zone_key,
                })
        created_bleedings = []
        if allow_bleeding and bleeding_result and bleeding_result.get('stage'):
            created_bleedings.append({
                'kind': 'external',
                'stage': bleeding_result['stage'],
                'area': zone_key,
                'source': 'firearm_wound',
            })
            apply_effect_to_health(health, {
                'type': f"bleeding_external_{bleeding_result['stage']}",
                'area': zone_key,
                'value': 1,
                'source': 'firearm_wound',
            })
        bleeding_type = str(profile.get('bleeding') or '').lower()
        bleeding_map = {'легкое': 'light', 'лёгкое': 'light', 'среднее': 'medium', 'сильное': 'severe', 'экстремальное': 'extreme'}
        stage = next((suffix for label, suffix in bleeding_map.items() if label in bleeding_type), None)
        if allow_bleeding and stage:
            kind = 'internal' if 'внут' in bleeding_type else 'external'
            created_bleedings.append({
                'kind': kind,
                'stage': stage,
                'area': zone_key,
                'source': 'combat_attack',
            })
            apply_effect_to_health(health, {
                'type': f'bleeding_{kind}_{stage}',
                'area': zone_key,
                'value': 1,
                'source': 'combat_attack',
            })
        trauma_chance_roll = None
        trauma_roll = None
        trauma = None
        traumas = []
        if damage >= 11:
            for _ in range(max(0, CombatService._coerce_int(trauma_checks, 1))):
                trauma_chance_roll = random.randint(1, 100)
                threshold = {
                    'head': 0,
                    'chest': 50,
                    'abdomen': 30,
                    'left_arm': 70,
                    'right_arm': 70,
                    'left_leg': 70,
                    'right_leg': 70,
                }.get(zone, 70)
                threshold = max(
                    0,
                    threshold + CombatService._coerce_int(
                        trauma_difficulty_modifier, 0
                    ),
                )
                if trauma_chance_roll < threshold:
                    continue
                trauma_roll = random.randint(1, 20)
                trauma_rules = CombatService._trauma_effects(zone, trauma_roll)
                trauma = {
                    'type': 'additional_trauma',
                    'area': zone_key,
                    'chance_roll': trauma_chance_roll,
                    'roll': trauma_roll,
                    'fracture': bool(trauma_rules['fracture']),
                    'bleeding': (
                        {
                            'kind': trauma_rules['bleeding'][0],
                            'stage': trauma_rules['bleeding'][1],
                        }
                        if trauma_rules['bleeding']
                        else None
                    ),
                    'pain': trauma_rules['pain'],
                    'shock': bool(trauma_rules['shock']),
                    'organ': trauma_rules['organ'],
                    'fall_or_drop': trauma_rules['fall_or_drop'],
                }
                traumas.append(trauma)
                effects = normalize_effect_list(health.get('effects') or [])
                effects.append(trauma)
                health['effects'] = effects
                if trauma_rules['fracture']:
                    apply_effect_to_health(health, {
                        'type': 'fracture', 'area': zone_key, 'source': 'combat_attack'
                    })
                if allow_bleeding and trauma_rules['bleeding']:
                    kind, trauma_stage = trauma_rules['bleeding']
                    created_bleedings.append({
                        'kind': kind,
                        'stage': trauma_stage,
                        'area': zone_key,
                        'source': 'additional_trauma',
                    })
                    apply_effect_to_health(health, {
                        'type': f'bleeding_{kind}_{trauma_stage}', 'area': zone_key,
                        'source': 'combat_attack'
                    })
                if trauma_rules['pain']:
                    apply_effect_to_health(health, {
                        'type': 'pain', 'value': trauma_rules['pain'],
                        'source': 'combat_attack'
                    })
                if trauma_rules['shock']:
                    apply_effect_to_health(health, {
                        'type': 'shock', 'area': zone_key, 'source': 'combat_attack'
                    })
                if trauma_rules['organ']:
                    organ_damage = CombatService._apply_organ_damage(
                        health, trauma_rules['organ'], damage, zone_key
                    )
                    trauma['organ_damage'] = organ_damage
                    if organ_damage and organ_damage.get('bleeding'):
                        created_bleedings.append(organ_damage['bleeding'])
        sync_health_derived_statuses(health)
        resulting_condition = CombatService._character_condition(data)
        if resulting_condition['state'] in {'pain_shock', 'critical', 'dead'}:
            target.posture = 'prone'
            target.cover_object_id = None
            target.weapon_braced = False
            target.braced_weapon_index = None
        character.data = data
        flag_modified(character, 'data')
        target.hp_zones = health.get('zones') or target.hp_zones
        flag_modified(target, 'hp_zones')
        health['lastTrauma'] = trauma
        health['lastTraumas'] = traumas
        health['_attackOutcome'] = {
            'bleedings': created_bleedings,
            'additional_traumas': traumas,
            'catastrophic_limb_injury': catastrophic_limb_injury,
            'death': fatal_vital_hit,
        }
        return health

    @staticmethod
    def _resolve_attack(
        target,
        attacker,
        attack_details,
        *,
        melee=False,
        attack_type=None,
        aimed_zone=None,
        forced_roll=None,
        profile_override=None,
        profile_adjusted=False,
        ignore_live_shield=False,
        ignore_cover=False,
    ):
        attacker_data = attacker.character.data if attacker.character and isinstance(attacker.character.data, dict) else {}
        target_data = target.character.data if target.character and isinstance(target.character.data, dict) else {}
        target_character = getattr(target, 'character', None)
        target_character_id = getattr(
            target,
            'character_id',
            getattr(target_character, 'id', None),
        )
        target_name = getattr(target_character, 'name', None)
        weapons = attacker_data.get('weapons') or []
        weapon_index = CombatService._coerce_int(attack_details.get('weapon_index'), -1)
        weapon = weapons[weapon_index] if 0 <= weapon_index < len(weapons) else {}
        if melee:
            profile = (
                CombatService._virtual_melee_profile(attack_type, weapon, attacker_data)
                or CombatService._weapon_damage_profile(weapon, attack_type)
            )
            skill = CombatService._skill_modifier(attacker_data, 'skills.physical.melee')
            difficulty = CombatService._coerce_int(
                attack_details.get('hit_difficulty'),
                12 - skill - CombatService._parse_percent(profile.get('accuracy', 0), 0),
            )
            rolls = [forced_roll if forced_roll is not None else random.randint(1, 20)]
            has_disadvantage = bool(
                attack_details.get('melee_disadvantage')
                or CombatService._has_roll_disadvantage(
                    attacker_data, 'skills.physical.melee'
                )
            )
            has_advantage = bool(
                attack_details.get('melee_advantage')
                or getattr(target, 'grappled_by_id', None)
            )
            if forced_roll is None and has_advantage != has_disadvantage:
                rolls.append(random.randint(1, 20))
            if has_advantage and not has_disadvantage:
                roll = max(rolls)
            elif has_disadvantage and not has_advantage:
                roll = min(rolls)
            else:
                roll = rolls[0]
            hit = roll == 20 or (roll != 1 and roll >= difficulty)
            result = {
                'roll': roll,
                'rolls': rolls,
                'difficulty': difficulty,
                'hit': hit,
                'mode': 'melee',
                'target_character_id': target_character_id,
                'target_name': target_name,
            }
            if not hit:
                return result
            zone = CombatService._random_hit_zone(random.randint(1, 6), aimed_zone, melee=True)
            strength_bonus = CombatService._skill_modifier(attacker_data, 'skills.physical.strength')
            if not profile.get('skip_strength_scaling'):
                profile['damage'] *= max(0, 1 + 0.1 * strength_bonus)
            if attack_details.get('swing_bonus'):
                profile['damage'] *= 1.25
        else:
            if isinstance(profile_override, dict):
                profile = dict(profile_override)
            else:
                profile, _ = CombatService._ranged_damage_profile(weapon)
            difficulty = attack_details['hit_difficulty']
            rolls = [forced_roll if forced_roll is not None else random.randint(1, 20)]
            if (
                forced_roll is None
                and attack_details.get('shooting_disadvantage')
            ):
                rolls.append(random.randint(1, 20))
            roll = min(rolls)
            hit = roll == 20 or (roll != 1 and roll >= difficulty)
            result = {
                'roll': roll,
                'rolls': rolls,
                'difficulty': difficulty,
                'hit': hit,
                'mode': attack_details['fire_mode'],
                'strength_requirement': attack_details.get('strength_requirement'),
                'target_character_id': target_character_id,
                'target_name': target_name,
            }
            if not profile_adjusted:
                if (
                    attack_details.get('target_distance') is not None
                    and CombatService._is_buckshot_profile(profile)
                ):
                    distance_over = max(0, attack_details['target_distance'] - 5)
                    profile['damage'] = max(0, profile['damage'] - 50 * distance_over)
                    profile['armor_piercing'] = max(
                        0,
                        profile['armor_piercing'] - 5 * distance_over,
                    )
                elif attack_details.get('target_distance') is not None and profile.get('effective_range', 0):
                    distance_over = max(0, attack_details['target_distance'] - profile['effective_range'])
                    if distance_over:
                        profile['damage'] *= max(0.1, 1 - 0.05 * distance_over)
                        profile['armor_piercing'] = max(0, profile['armor_piercing'] - 5 * distance_over)
            live_shield = (
                None
                if ignore_live_shield
                else CombatService._live_shield_target(target)
            )
            if not hit:
                if live_shield and aimed_zone == 'head':
                    shield_result = CombatService._resolve_attack(
                        live_shield,
                        attacker,
                        attack_details,
                        aimed_zone='head',
                        forced_roll=20,
                        profile_override=profile,
                        profile_adjusted=True,
                        ignore_live_shield=True,
                    )
                    result.update({
                        'zone': 'head',
                        'damage': 0,
                        'combined_damage': shield_result.get('damage', 0),
                        'live_shield_hit': True,
                        'live_shield_reason': 'aimed_head_miss',
                        'live_shield_result': shield_result,
                    })
                cover_analysis = attack_details.get('cover') or {}
                if (
                    attack_details.get('fire_mode') == 'unaimed'
                    and cover_analysis.get('blind_fire')
                    and not ignore_cover
                ):
                    cover_zones = cover_analysis.get('zones') or {}
                    cover_details = next(iter(cover_zones.values()), None)
                    cover = (
                        db.session.get(LocationObject, cover_details.get('object_id'))
                        if isinstance(cover_details, dict)
                        else None
                    )
                    if cover:
                        cover_profile = CombatService._cover_profile(cover)
                        incoming_penetration = CombatService._coerce_float(
                            profile.get('armor_piercing'), 0
                        )
                        cover_damage = CombatService.apply_cover_damage(
                            cover,
                            profile.get('damage'),
                            profile.get('damage_type') or 'bullet',
                        )
                        result['automatic_cover_hit'] = True
                        result['cover_hit'] = {
                            'object_id': cover.id,
                            'object_name': cover.name or cover.type,
                            'protection': cover_profile['physical_protection'],
                            'penetrated': (
                                incoming_penetration
                                >= cover_profile['physical_protection']
                            ),
                            'damage': cover_damage,
                        }
                return result
            zone = CombatService._random_hit_zone(random.randint(1, 20), aimed_zone)
            cover_zone = (
                ((attack_details.get('cover') or {}).get('zones') or {}).get(zone)
                if not ignore_cover
                else None
            )
            if cover_zone:
                cover = db.session.get(LocationObject, cover_zone.get('object_id'))
                cover_profile = CombatService._cover_profile(cover) if cover else None
                if cover and cover_profile and random.randint(1, 100) <= cover_profile['mesh_hit_chance']:
                    incoming_penetration = CombatService._coerce_float(profile.get('armor_piercing'), 0)
                    cover_damage = CombatService.apply_cover_damage(
                        cover,
                        profile.get('damage'),
                        profile.get('damage_type') or 'bullet',
                    )
                    penetrated = incoming_penetration >= cover_profile['physical_protection']
                    result['cover_hit'] = {
                        'object_id': cover.id,
                        'object_name': cover.name or cover.type,
                        'protection': cover_profile['physical_protection'],
                        'penetrated': penetrated,
                        'damage': cover_damage,
                    }
                    if not penetrated:
                        result.update({
                            'zone': zone, 'damage': 0, 'combined_damage': 0,
                            'blocked_by_cover': True,
                        })
                        return result
                    profile['armor_piercing'] = max(
                        0, incoming_penetration - cover_profile['physical_protection']
                    )
            live_shield_result = None
            if live_shield and zone != 'head':
                live_shield_result = CombatService._resolve_attack(
                    live_shield,
                    attacker,
                    attack_details,
                    aimed_zone=zone,
                    forced_roll=20,
                    profile_override=profile,
                    profile_adjusted=True,
                    ignore_live_shield=True,
                )
                incoming_penetration = CombatService._coerce_float(
                    profile.get('armor_piercing'), 0
                )
                shield_armor = CombatService._coerce_float(
                    live_shield_result.get('armor'), 0
                )
                remaining_penetration = max(0, incoming_penetration - shield_armor)
                if incoming_penetration < shield_armor:
                    result.update({
                        'zone': zone,
                        'damage': 0,
                        'combined_damage': live_shield_result.get('damage', 0),
                        'live_shield_hit': True,
                        'live_shield_blocked': True,
                        'live_shield_result': live_shield_result,
                    })
                    return result
                profile['armor_piercing'] = remaining_penetration
        if (
            CombatService._is_gas_or_chemical_profile(profile)
            and CombatService._functioning_gas_protection(target_data)
        ):
            result.update({
                'zone': zone,
                'base_damage': profile['damage'],
                'armor': 100,
                'armor_piercing': profile['armor_piercing'],
                'effective_armor': 100,
                'penetration_deficit': 100,
                'damage_multiplier': 0,
                'damage': 0,
                'armor_damage': [],
                'bleeding_check': None,
                'gas_or_chemical_blocked': True,
                'health': (target_data.get('health') or {}).get('current'),
                'zone_health': (
                    (target_data.get('health') or {}).get('zones') or {}
                ).get({
                    'left_arm': 'leftArm', 'right_arm': 'rightArm',
                    'left_leg': 'leftLeg', 'right_leg': 'rightLeg',
                }.get(zone, zone), {}).get('current'),
            })
            return result
        armor, armor_layers = CombatService._target_armor(target_data, zone)
        armor_damage = []
        for layer in armor_layers:
            if layer.get('is_gas_mask'):
                damage_result = CombatService._damage_gas_mask(
                    layer['item'],
                    'melee' if melee else 'bullet',
                )
            else:
                damage_result = CombatService._damage_armor_item(
                    layer['item'],
                    layer['attributes'],
                    profile['damage'],
                )
            if damage_result:
                armor_damage.append(damage_result)
        effective_armor = max(0.0, armor - profile['armor_piercing'])
        penetration_deficit = max(0.0, effective_armor)
        damage_reduction_steps = math.ceil(penetration_deficit / 5) if penetration_deficit else 0
        damage_multiplier = max(0.0, 1 - damage_reduction_steps * 0.25)
        crushing_non_penetration = False
        crushing_multiplier = (
            CombatService._crushing_damage_multiplier(profile)
            if melee and penetration_deficit > 0
            else None
        )
        if crushing_multiplier is not None:
            damage_multiplier = crushing_multiplier
            crushing_non_penetration = True
        behind_armor_multiplier = 0.0
        full_non_penetration = bool(
            not melee
            and armor > 0
            and penetration_deficit > 0
            and damage_multiplier <= 0
        )
        buckshot_mutant_non_penetration = bool(
            not melee
            and penetration_deficit >= 10
            and CombatService._is_buckshot_profile(profile)
            and CombatService._is_mutant_character(target_data)
        )
        if full_non_penetration or buckshot_mutant_non_penetration:
            behind_armor_multiplier = CombatService._behind_armor_damage_multiplier(
                profile,
                target_data=target_data,
                penetration_deficit=penetration_deficit,
            )
            damage_multiplier = behind_armor_multiplier
        final_damage = max(0, round(profile['damage'] * damage_multiplier))
        allow_bleeding = bool(
            melee
            or armor <= 0
            or profile['armor_piercing'] - armor >= 10
        )
        bleeding_result = (
            None
            if melee
            else CombatService._roll_firearm_bleeding(profile, armor)
        )
        trauma_checks = 1
        trauma_difficulty_modifier = 0
        if not melee and CombatService._is_buckshot_profile(profile):
            trauma_checks = math.floor(final_damage / 50)
            trauma_difficulty_modifier = -20
        elif (
            not melee
            and CombatService._caliber_key(profile.get('caliber')) == '127x55'
            and armor <= profile['armor_piercing']
        ):
            trauma_checks = 2
        health = CombatService._apply_attack_damage(
            target,
            final_damage,
            zone,
            profile,
            bleeding_result=bleeding_result,
            round_number=attack_details.get('round_number'),
            allow_bleeding=allow_bleeding,
            trauma_checks=trauma_checks,
            trauma_difficulty_modifier=trauma_difficulty_modifier,
        )
        attack_outcome = health.pop('_attackOutcome', {})
        result.update({
            'zone': zone,
            'base_damage': profile['damage'],
            'armor': armor,
            'armor_piercing': profile['armor_piercing'],
            'effective_armor': effective_armor,
            'penetration_deficit': penetration_deficit,
            'damage_multiplier': damage_multiplier,
            'behind_armor_multiplier': behind_armor_multiplier,
            'crushing_non_penetration': crushing_non_penetration,
            'crushing_damage_multiplier': (
                crushing_multiplier if crushing_non_penetration else None
            ),
            'full_non_penetration': full_non_penetration,
            'buckshot_mutant_non_penetration': buckshot_mutant_non_penetration,
            'damage': final_damage,
            'armor_damage': armor_damage,
            'bleeding_check': bleeding_result,
            'bleedings': attack_outcome.get('bleedings') or [],
            'additional_traumas': attack_outcome.get('additional_traumas') or [],
            'catastrophic_limb_injury': attack_outcome.get('catastrophic_limb_injury'),
            'death': bool(attack_outcome.get('death')),
            'health': health.get('current'),
            'zone_health': (
                health.get('zones') or {}
            ).get({'left_arm': 'leftArm', 'right_arm': 'rightArm', 'left_leg': 'leftLeg', 'right_leg': 'rightLeg'}.get(zone, zone), {}).get('current'),
        })
        if not melee and 'live_shield_result' in locals() and live_shield_result:
            result.update({
                'live_shield_hit': True,
                'live_shield_blocked': False,
                'live_shield_result': live_shield_result,
                'combined_damage': (
                    final_damage + live_shield_result.get('damage', 0)
                ),
            })
        return result

    @staticmethod
    def _resolve_cover_attack(location_id, cover, attacker, attack_details):
        attacker_data = attacker.character.data if attacker.character else {}
        weapons = (attacker_data or {}).get('weapons') or []
        weapon_index = CombatService._coerce_int(attack_details.get('weapon_index'), -1)
        weapon = weapons[weapon_index] if 0 <= weapon_index < len(weapons) else {}
        profile, _ = CombatService._ranged_damage_profile(weapon)
        result = {
            'roll': None, 'rolls': [], 'difficulty': None,
            'hit': True, 'automatic_cover_hit': True,
            'mode': attack_details.get('fire_mode'),
            'target_object_id': cover.id,
            'target_name': cover.name or cover.type,
        }
        cover_profile = CombatService._cover_profile(cover)
        cover_damage = CombatService.apply_cover_damage(
            cover, profile.get('damage'), profile.get('damage_type') or 'bullet'
        )
        penetration = CombatService._coerce_float(profile.get('armor_piercing'), 0)
        penetrated = penetration >= cover_profile['physical_protection']
        result.update({
            'cover_hit': True,
            'cover_penetrated': penetrated,
            'cover_protection': cover_profile['physical_protection'],
            'cover_damage': cover_damage,
            'damage': 0,
        })
        if not penetrated:
            return result
        behind = CombatService._characters_behind_cover(location_id, attacker, cover)
        if not behind:
            return result
        target = behind[0]
        continued_profile = dict(profile)
        continued_profile['armor_piercing'] = max(
            0, penetration - cover_profile['physical_protection']
        )
        continued_details = dict(attack_details)
        continued_details['target_character_id'] = target.character_id
        continued_details['cover'] = None
        target_distance = max(
            abs(attacker.pos_x - target.pos_x), abs(attacker.pos_y - target.pos_y)
        )
        continued_details['target_distance'] = target_distance
        continued_details['shooting_disadvantage'] = True
        continued_difficulty = CombatService._coerce_int(
            attack_details.get('continuation_hit_difficulty'),
            12,
        )
        if getattr(target, 'movement_mode_this_turn', None) in {'run', 'sprint'}:
            continued_difficulty += 2
        weapon_range = CombatService._coerce_int(
            attack_details.get('weapon_range'), 0
        )
        cover_distance = CombatService._coerce_int(
            attack_details.get('target_distance'), 0
        )
        if weapon_range and target_distance > weapon_range >= cover_distance:
            continued_difficulty += 2
        continued_details['hit_difficulty'] = max(1, continued_difficulty)
        target_result = CombatService._resolve_attack(
            target, attacker, continued_details,
            profile_override=continued_profile,
            profile_adjusted=True,
            ignore_cover=True,
        )
        result.update({
            'target_behind_cover_id': target.character_id,
            'target_behind_cover_name': getattr(target.character, 'name', None),
            'target_behind_cover_result': target_result,
            'damage': target_result.get('damage', 0),
            'combined_damage': target_result.get('combined_damage', target_result.get('damage', 0)),
        })
        return result

    @staticmethod
    def _resolve_shot_sequence(
        targets,
        attacker,
        attack_details,
        *,
        aimed_zone=None,
        share_hit_roll=False,
    ):
        results = []
        shared_roll = None
        for index in range(CombatService._coerce_int(attack_details.get('shot_count'), 0)):
            if not targets:
                break
            target = targets[index % len(targets)]
            result = CombatService._resolve_attack(
                target,
                attacker,
                attack_details,
                aimed_zone=aimed_zone,
                forced_roll=shared_roll if share_hit_roll else None,
            )
            if index == 0 and share_hit_roll:
                shared_roll = result.get('roll')
            if share_hit_roll:
                result['shared_hit_roll'] = True
            results.append(result)
        return results

    @staticmethod
    def format_attack_summary(result):
        attack = result.get('attack') if isinstance(result, dict) else None
        if not isinstance(attack, dict):
            return None
        results = attack.get('results')
        if not isinstance(results, list) or not results:
            return None

        zone_labels = {
            'head': 'голова',
            'chest': 'грудь',
            'abdomen': 'живот',
            'left_arm': 'левая рука',
            'right_arm': 'правая рука',
            'left_leg': 'левая нога',
            'right_leg': 'правая нога',
        }
        bleeding_kind_labels = {
            'external': 'внешнее',
            'internal': 'внутреннее',
        }
        bleeding_stage_labels = {
            'light': 'лёгкое',
            'medium': 'среднее',
            'severe': 'сильное',
            'extreme': 'экстремальное',
        }
        mode_labels = {
            'melee': 'атака ближнего боя',
            'unaimed': 'неприцельный выстрел',
            'rapid': 'беглый выстрел',
            'aimed': 'прицельный выстрел',
            'burst': 'очередь',
            'area': 'огонь по области',
        }

        actor = (
            (result.get('character') or {}).get('name')
            or 'Персонаж'
        )
        mode = mode_labels.get(
            results[0].get('mode'),
            attack.get('attack_type') or attack.get('fire_mode') or 'атака',
        )
        lines = [f"{actor}: {mode}."]
        for index, hit_result in enumerate(results, start=1):
            target_name = hit_result.get('target_name') or 'цель'
            rolls = hit_result.get('rolls') or [hit_result.get('roll')]
            rolls = [roll for roll in rolls if roll is not None]
            roll_text = '/'.join(str(roll) for roll in rolls) or '—'
            difficulty = hit_result.get('difficulty', '—')
            prefix = f"{index}. {target_name}: d20 {roll_text}, СЛ {difficulty}"
            if not hit_result.get('hit'):
                lines.append(f"{prefix} — промах.")
                cover_impact = hit_result.get('cover_hit')
                if isinstance(cover_impact, dict):
                    cover_state = cover_impact.get('damage') or {}
                    protection_before = round(CombatService._coerce_float(
                        cover_impact.get('protection'), 0
                    ))
                    protection_after = round(CombatService._coerce_float(
                        cover_state.get('physical_protection'), protection_before
                    ))
                    lines.append(
                        f"   Пуля попала в {cover_impact.get('object_name') or 'укрытие'}: "
                        f"без проверки; "
                        f"защита {protection_before}% → {protection_after}%, ОЗ "
                        f"{cover_state.get('hp', '—')}/{cover_state.get('max_hp', '—')}."
                    )
                continue

            if hit_result.get('cover_hit') is True:
                cover_state = hit_result.get('cover_damage') or {}
                protection_before = round(CombatService._coerce_float(
                    hit_result.get('cover_protection'), 0
                ))
                protection_after = round(CombatService._coerce_float(
                    cover_state.get('physical_protection'), protection_before
                ))
                cover_prefix = (
                    f"{index}. {target_name}: без проверки"
                    if hit_result.get('automatic_cover_hit')
                    else prefix
                )
                lines.append(
                    f"{cover_prefix} — попадание по укрытию; защита "
                    f"{protection_before}% → {protection_after}%, ОЗ "
                    f"{cover_state.get('hp', '—')}/{cover_state.get('max_hp', '—')}; "
                    f"пробитие: {'да' if hit_result.get('cover_penetrated') else 'нет'}."
                )
                behind_result = hit_result.get('target_behind_cover_result')
                if isinstance(behind_result, dict):
                    if not behind_result.get('hit'):
                        behind_rolls = behind_result.get('rolls') or [behind_result.get('roll')]
                        behind_rolls = [roll for roll in behind_rolls if roll is not None]
                        behind_roll_text = '/'.join(str(roll) for roll in behind_rolls) or '—'
                        lines.append(
                            f"   За укрытием: {hit_result.get('target_behind_cover_name') or 'цель'}, "
                            f"d20 {behind_roll_text}, СЛ {behind_result.get('difficulty', '—')} — промах."
                        )
                        continue
                    behind_zone = zone_labels.get(
                        behind_result.get('zone'),
                        behind_result.get('zone') or 'неизвестная зона',
                    )
                    lines.append(
                        f"   За укрытием: {hit_result.get('target_behind_cover_name') or 'цель'}, "
                        f"{behind_zone}, урон {round(CombatService._coerce_float(behind_result.get('damage'), 0))}."
                    )
                continue

            zone = zone_labels.get(
                hit_result.get('zone'),
                hit_result.get('zone') or 'неизвестная зона',
            )
            damage = round(CombatService._coerce_float(
                hit_result.get('damage'),
                0,
            ))
            armor = round(CombatService._coerce_float(
                hit_result.get('armor'),
                0,
            ))
            penetration = round(CombatService._coerce_float(
                hit_result.get('armor_piercing'),
                0,
            ))
            lines.append(
                f"{prefix} — попадание: {zone}, урон {damage}; "
                f"защита {armor}%, пробитие {penetration}%."
            )
            cover_impact = hit_result.get('cover_hit')
            if isinstance(cover_impact, dict):
                cover_state = cover_impact.get('damage') or {}
                protection_before = round(CombatService._coerce_float(
                    cover_impact.get('protection'), 0
                ))
                protection_after = round(CombatService._coerce_float(
                    cover_state.get('physical_protection'), protection_before
                ))
                lines.append(
                    f"   Укрытие {cover_impact.get('object_name') or ''}: защита "
                    f"{protection_before}% → {protection_after}%, ОЗ "
                    f"{cover_state.get('hp', '—')}/{cover_state.get('max_hp', '—')}; "
                    f"пробитие: {'да' if cover_impact.get('penetrated') else 'нет'}."
                )

            bleedings = hit_result.get('bleedings') or []
            if bleedings:
                bleeding_labels = []
                for bleeding in bleedings:
                    kind = bleeding_kind_labels.get(
                        bleeding.get('kind'),
                        bleeding.get('kind') or '',
                    )
                    stage = bleeding_stage_labels.get(
                        bleeding.get('stage'),
                        bleeding.get('stage') or '',
                    )
                    bleeding_labels.append(f"{stage} {kind}".strip())
                lines.append(
                    f"   Кровотечение: {', '.join(bleeding_labels)}."
                )
            else:
                lines.append("   Кровотечение: нет.")

            traumas = hit_result.get('additional_traumas') or []
            if traumas:
                trauma_labels = []
                for trauma in traumas:
                    consequences = []
                    if trauma.get('fracture'):
                        consequences.append('перелом')
                    trauma_bleeding = trauma.get('bleeding')
                    if isinstance(trauma_bleeding, dict):
                        kind = bleeding_kind_labels.get(
                            trauma_bleeding.get('kind'),
                            trauma_bleeding.get('kind') or '',
                        )
                        stage = bleeding_stage_labels.get(
                            trauma_bleeding.get('stage'),
                            trauma_bleeding.get('stage') or '',
                        )
                        consequences.append(
                            f"{stage} {kind} кровотечение".strip()
                        )
                    if trauma.get('pain'):
                        consequences.append(f"боль +{trauma['pain']}")
                    if trauma.get('shock'):
                        consequences.append('шок')
                    details = ', '.join(consequences) or 'без доп. эффекта'
                    trauma_labels.append(
                        f"d20 {trauma.get('roll', '—')} ({details})"
                    )
                lines.append(
                    f"   Доп. травма: {'; '.join(trauma_labels)}."
                )
            else:
                lines.append("   Доп. травма: нет.")

            catastrophic = hit_result.get('catastrophic_limb_injury')
            if isinstance(catastrophic, dict):
                if catastrophic.get('type') == 'amputation':
                    extent_labels = {
                        'entire_limb': 'целиком',
                        'elbow_or_knee': 'по локоть/колено',
                        'hand_or_foot': 'по кисть/ступню',
                    }
                    extent = extent_labels.get(
                        catastrophic.get('loss_extent'),
                        catastrophic.get('loss_extent') or 'не указано',
                    )
                    lines.append(
                        f"   Конечность утрачена: {extent}, "
                        f"1к6 = {catastrophic.get('loss_roll', '—')}."
                    )
                else:
                    lines.append("   Конечность искорежена.")
            if hit_result.get('death'):
                lines.append("   Смертельное попадание в выбитую жизненно важную зону.")

        if len(results) > 1:
            lines.append(
                f"Итого: попаданий {attack.get('hits', 0)}/{len(results)}, "
                f"урон {round(CombatService._coerce_float(attack.get('damage_total'), 0))}."
            )
        wear = attack.get('weapon_wear')
        if isinstance(wear, dict) and wear.get('loss'):
            lines.append(
                f"Прочность оружия: {wear.get('before')} -> {wear.get('after')} "
                f"(-{wear.get('loss')})."
            )
        jam = attack.get('weapon_jam')
        if isinstance(jam, dict) and jam.get('triggered'):
            lines.append(
                f"Клин: d20 {jam.get('check_roll')} (порог {jam.get('chance')}), "
                f"результат {jam.get('strength_roll')} - {jam.get('label')}."
            )
        return '\n'.join(lines)

    @staticmethod
    def _coerce_float(value, default=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _skill_modifier(character_data, skill_path, include_pain=True):
        return (
            CombatService._base_skill_modifier(character_data, skill_path)
            + CombatService._health_roll_modifier(
                character_data,
                skill_path,
                include_pain,
            )
        )

    @staticmethod
    def _base_skill_modifier(character_data, skill_path):
        current = character_data if isinstance(character_data, dict) else {}
        for part in skill_path.split('.'):
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(part)
        if not isinstance(current, dict):
            return 0
        skill_value = CombatService._skill_value(character_data, skill_path)
        return math.floor((skill_value - 10) / 2)

    @staticmethod
    def _consumable_stat_value_bonus(character_data, stat_name):
        if not isinstance(character_data, dict):
            return 0
        health = character_data.get('health') if isinstance(character_data.get('health'), dict) else {}
        combat_meta = health.get('combatMeta') if isinstance(health.get('combatMeta'), dict) else {}
        modifiers = combat_meta.get('consumableModifiers')
        if not isinstance(modifiers, list):
            return 0
        total = 0
        for item in modifiers:
            if not isinstance(item, dict):
                continue
            remaining = item.get('remaining')
            if remaining is not None and CombatService._coerce_int(remaining, 0) <= 0:
                continue
            if str(item.get('stat') or '').strip() in {stat_name, f'{stat_name}_delta'}:
                total += CombatService._coerce_int(item.get('value', 0), 0)
        return total

    @staticmethod
    def _consumable_stat_bonus(character_data, stat_name):
        if not isinstance(character_data, dict):
            return 0
        health = character_data.get('health') if isinstance(character_data.get('health'), dict) else {}
        combat_meta = health.get('combatMeta') if isinstance(health, dict) and isinstance(health.get('combatMeta'), dict) else {}
        modifiers = combat_meta.get('consumableModifiers')
        if not isinstance(modifiers, list):
            return 0
        total = 0
        for item in modifiers:
            if not isinstance(item, dict):
                continue
            remaining = item.get('remaining')
            if remaining is not None and CombatService._coerce_int(remaining, 0) <= 0:
                continue
            item_stat = str(item.get('stat') or '').strip()
            if item_stat in {stat_name, f'{stat_name}_delta', 'generic', 'generic_multiplier'}:
                total += CombatService._coerce_int(item.get('value', 0), 0)
        return total

    @staticmethod
    def _bleeding_modifier_total(health):
        if not isinstance(health, dict):
            return 0
        combat_meta = health.get('combatMeta') if isinstance(health.get('combatMeta'), dict) else {}
        modifiers = combat_meta.get('bleedingModifiers')
        if isinstance(modifiers, list):
            total = 0
            for item in modifiers:
                if isinstance(item, dict):
                    remaining = item.get('remaining')
                    if remaining is not None and CombatService._coerce_int(remaining, 0) <= 0:
                        continue
                    total += CombatService._coerce_int(item.get('value', 0), 0)
                else:
                    total += CombatService._coerce_int(item, 0)
            return total
        return CombatService._coerce_int(combat_meta.get('bleedingModifierTotal', health.get('bleedingModifierTotal', 0)), 0)

    @staticmethod
    def _advance_blood_stage(stage):
        order = ['normal', 'light', 'medium', 'severe', 'critical']
        current = str(stage or 'normal').lower()
        if current not in order:
            current = 'normal'
        index = order.index(current)
        next_index = min(len(order) - 1, index + 1)
        return order[next_index]

    @staticmethod
    def _bleeding_check_profile(character_data):
        health = (
            character_data.get('health')
            if isinstance(character_data, dict)
            else {}
        )
        if not isinstance(health, dict):
            health = {}
        bleeding = (
            health.get('bleeding')
            if isinstance(health.get('bleeding'), dict)
            else {}
        )
        severity = CombatService._coerce_int(
            bleeding.get('totalSeverity', health.get('bleedingSeverity', 0)),
            0,
        )
        stage_penalty = CombatService._coerce_int(
            bleeding.get(
                'stagePenalty',
                health.get('bleedingStagePenalty', 0),
            ),
            0,
        )
        modifier_total = CombatService._bleeding_modifier_total(health)
        will_bonus = CombatService._base_skill_modifier(
            character_data,
            'skills.physical.will',
        )
        state_modifier = CombatService._health_roll_modifier(
            character_data,
            'skills.physical.will',
            include_pain=False,
            include_blood=False,
            include_psy=False,
        )
        return {
            'severity': severity,
            'stagePenalty': stage_penalty,
            'modifierTotal': modifier_total,
            'willBonus': will_bonus,
            'stateModifier': state_modifier,
            'difficulty': max(
                0,
                5
                + severity
                - stage_penalty
                + modifier_total
                - will_bonus
                - state_modifier,
            ),
        }

    @staticmethod
    def _resolve_bleeding_check(loc_char):
        if not loc_char or not getattr(loc_char, 'character', None):
            return None
        character = loc_char.character
        character_data = character.data if isinstance(character.data, dict) else {}
        health = character_data.get('health')
        if not isinstance(health, dict):
            return None

        active_effects = normalize_effect_list(health.get('effects') or [])
        if any(effect.get('type') == 'blood_loss_freeze' and effect.get('active', True) for effect in active_effects):
            return None

        sync_health_derived_statuses(health)
        bleeding = health.get('bleeding') if isinstance(health.get('bleeding'), dict) else {}
        profile = CombatService._bleeding_check_profile(character_data)
        severity = profile['severity']
        if severity <= 0:
            return None

        stage = str(health.get('blood') or health.get('bloodStage') or 'normal').lower()
        stage_penalty = profile['stagePenalty']
        modifier_total = profile['modifierTotal']
        will_bonus = profile['willBonus']
        state_modifier = profile['stateModifier']
        roll = random.randint(1, 20)
        # Проверка кровопотери не является обычной проверкой Воли и не получает
        # Помеху от пси-состояния.
        disadvantage = False
        total = roll
        difficulty = profile['difficulty']
        success = total >= difficulty

        meta = health.setdefault('combatMeta', {})
        meta['bleedingCheck'] = {
            'roll': roll,
            'bonus': will_bonus,
            'total': total,
            'difficulty': difficulty,
            'severity': severity,
            'stagePenalty': stage_penalty,
            'modifierTotal': modifier_total,
            'stateModifier': state_modifier,
            'disadvantage': disadvantage,
            'success': success,
        }

        if not success:
            health['blood'] = CombatService._advance_blood_stage(stage)
        health['bloodStage'] = str(health.get('blood') or stage or 'normal').lower()
        sync_health_derived_statuses(health)
        character_data['health'] = health
        character.data = character_data
        flag_modified(character, 'data')
        return meta['bleedingCheck']

    @staticmethod
    def _tick_character_effects(loc_char, phase='turn_end'):
        if not loc_char:
            return loc_char
        effects = loc_char.effects if isinstance(loc_char.effects, list) else []
        loc_char.effects = tick_effects(effects, phase=phase)
        return loc_char

    @staticmethod
    def _apply_periodic_health_effects(loc_char, phase='turn_end'):
        if not loc_char or not getattr(loc_char, 'character', None):
            return loc_char
        character_data = loc_char.character.data if isinstance(loc_char.character.data, dict) else {}
        health = character_data.get('health')
        if not isinstance(health, dict):
            return loc_char
        active_effects = normalize_effect_list(health.get('effects') or [])
        apply_periodic_effects_to_health(health, active_effects, phase=phase)
        apply_expired_effects_to_health(health, active_effects, phase=phase)
        health['effects'] = tick_effects(active_effects, phase=phase)
        combat_meta = health.get('combatMeta') if isinstance(health.get('combatMeta'), dict) else None
        if isinstance(combat_meta, dict):
            for key in ('bleedingModifiers',):
                items = combat_meta.get(key)
                if not isinstance(items, list):
                    continue
                updated = []
                for item in items:
                    if not isinstance(item, dict):
                        updated.append(item)
                        continue
                    remaining = item.get('remaining')
                    if remaining is None:
                        updated.append(item)
                        continue
                    tick_phase = item.get('tick') or 'turn_end'
                    if tick_phase != phase:
                        updated.append(item)
                        continue
                    next_remaining = max(0, CombatService._coerce_int(remaining, 0) - 1)
                    if next_remaining > 0:
                        updated.append({**item, 'remaining': next_remaining})
                combat_meta[key] = updated
        character_data['health'] = health
        loc_char.character.data = character_data
        flag_modified(loc_char.character, 'data')
        return loc_char

    @staticmethod
    def _advance_character_time(loc_char, elapsed_seconds):
        if not loc_char or not getattr(loc_char, 'character', None):
            return loc_char
        character_data = loc_char.character.data if isinstance(loc_char.character.data, dict) else {}
        health = character_data.get('health')
        if not isinstance(health, dict):
            return loc_char
        health['effects'] = advance_timed_effects(
            health,
            health.get('effects') or [],
            elapsed_seconds,
        )
        character_data['health'] = health
        loc_char.character.data = character_data
        flag_modified(loc_char.character, 'data')
        CombatService._sync_location_effects_from_character(loc_char)
        return loc_char

    @staticmethod
    def _sync_location_effects_from_character(loc_char):
        if not loc_char or not getattr(loc_char, 'character', None):
            return loc_char
        character_data = loc_char.character.data if isinstance(loc_char.character.data, dict) else {}
        normalize_character_effects(character_data)
        loc_char.character.data = character_data
        flag_modified(loc_char.character, 'data')
        health = character_data.get('health') if isinstance(character_data, dict) else {}
        if isinstance(health, dict):
            loc_char.effects = normalize_effect_list(health.get('effects') or [])
        else:
            loc_char.effects = []
        if CombatService._character_condition(character_data)['state'] in {
            'pain_shock', 'critical', 'dead',
        }:
            loc_char.posture = 'prone'
            loc_char.cover_object_id = None
            loc_char.weapon_braced = False
            loc_char.braced_weapon_index = None
        return loc_char

    @staticmethod
    def _apply_end_of_round_pain_recovery(loc_chars):
        for loc_char in loc_chars or []:
            character = getattr(loc_char, 'character', None)
            if not character or not isinstance(character.data, dict):
                continue
            data = character.data
            health = data.get('health')
            if not isinstance(health, dict):
                continue
            meta = health.setdefault('combatMeta', {})
            pain_level = max(0, CombatService._coerce_int(health.get('painLevel', 0), 0))
            pain_increased = bool(meta.get('painIncreased', False))
            if not pain_increased and pain_level > 0:
                health['painLevel'] = pain_level - 1
            meta['painSnapshot'] = health.get('painLevel', 0)
            meta['painIncreased'] = False
            character.data = data
            flag_modified(character, 'data')

    @staticmethod
    def _resolve_pain_shock_check(loc_char, round_number):
        character = getattr(loc_char, 'character', None)
        if not character or not isinstance(character.data, dict):
            return None
        data = character.data
        health = data.get('health') if isinstance(data.get('health'), dict) else {}
        pain_level = max(0, CombatService._coerce_int(health.get('painLevel'), 0))
        if pain_level < 5 or CombatService._character_condition(data)['state'] != 'active':
            return None
        meta = health.setdefault('combatMeta', {})
        previous_check = meta.get('lastPainShockCheck')
        if (
            isinstance(previous_check, dict)
            and CombatService._coerce_int(previous_check.get('round'), 0) == round_number
        ):
            return None
        if CombatService._coerce_int(meta.get('painShockRecoveredRound'), 0) == round_number:
            return None

        blood_stage = str(health.get('blood') or health.get('bloodStage') or 'normal').lower()
        recovered_triggers = {
            'strenuous_movement': (
                getattr(loc_char, 'movement_mode_this_turn', None) in {'run', 'sprint'}
            ),
            'fired': CombatService._coerce_int(meta.get('firedRound'), 0) == round_number,
            'new_injury': CombatService._coerce_int(meta.get('injuryRound'), 0) == round_number,
            'exhaustion': CombatService._coerce_float(health.get('exhaustion'), 0) > 0,
            'severe_blood_loss': blood_stage in {'severe', 'critical'},
        }
        if meta.get('painShockRecovered') and not any(recovered_triggers.values()):
            return None

        will_bonus = CombatService._skill_modifier(
            data,
            'skills.physical.will',
            include_pain=False,
        )
        difficulty = max(1, pain_level * 2 - will_bonus)
        guaranteed = pain_level >= 10
        roll = None if guaranteed else random.randint(1, 20)
        success = False if guaranteed else (
            roll == 20 or (roll != 1 and roll >= difficulty)
        )
        result = {
            'kind': 'pain_shock_fall',
            'round': round_number,
            'roll': roll,
            'will_bonus': will_bonus,
            'difficulty': difficulty,
            'success': success,
            'pain_level': pain_level,
            'guaranteed': guaranteed,
            'recovered_triggers': recovered_triggers,
        }
        meta['lastPainShockCheck'] = result
        if not success:
            apply_effect_to_health(health, {
                'type': 'shock',
                'name': 'Болевой шок',
                'source': 'pain_end_turn',
                'tick': 'manual',
            })
            loc_char.posture = 'prone'
            loc_char.cover_object_id = None
            loc_char.weapon_braced = False
            loc_char.braced_weapon_index = None
        data['health'] = health
        character.data = data
        flag_modified(character, 'data')
        return result

    @staticmethod
    def _object_height(obj):
        if isinstance(obj, dict):
            obj_type = obj.get('type') or obj.get('object_type') or ''
            properties = obj.get('properties') or {}
            dimensions = properties.get('dimensions') or {}
            raw_height = dimensions.get('height', properties.get('height', obj.get('height')))
        else:
            obj_type = getattr(obj, 'type', '') or ''
            properties = getattr(obj, 'properties', {}) or {}
            dimensions = properties.get('dimensions') or {}
            raw_height = dimensions.get('height', properties.get('height', getattr(obj, 'height', None)))

        try:
            height = float(raw_height)
            if height > 0:
                return height
        except (TypeError, ValueError):
            pass

        if obj_type == 'fence':
            return 1.2
        if obj_type == 'chair':
            return 0.9
        if obj_type == 'chest':
            return 1.0
        if obj_type == 'table':
            return 1.0
        if obj_type == 'shelf':
            return 2.0
        if obj_type in {'tree', 'rock', 'house', 'tent', 'wall'}:
            return 2.5
        return 1.5

    @staticmethod
    def _object_dimensions(obj):
        if isinstance(obj, dict):
            obj_type = obj.get('type') or obj.get('object_type') or ''
            properties = obj.get('properties') or {}
            dimensions = properties.get('dimensions') or {}
        else:
            obj_type = getattr(obj, 'type', '') or ''
            properties = getattr(obj, 'properties', {}) or {}
            dimensions = properties.get('dimensions') or {}

        defaults = {
            'door': {'width': 0.9, 'depth': 0.18},
            'table': {'width': 1.4, 'depth': 0.8},
            'chair': {'width': 0.55, 'depth': 0.55},
            'shelf': {'width': 1.0, 'depth': 0.35},
            'chest': {'width': 0.9, 'depth': 0.6},
            'fence': {'width': 2.0, 'depth': 0.15},
            'wall': {'width': 1.5, 'depth': 0.2},
        }
        fallback = defaults.get(obj_type, {'width': 1.0, 'depth': 1.0})
        try:
            width = float(dimensions.get('width', properties.get('width', fallback['width'])))
        except (TypeError, ValueError):
            width = fallback['width']
        try:
            depth = float(dimensions.get('depth', properties.get('depth', fallback['depth'])))
        except (TypeError, ValueError):
            depth = fallback['depth']

        rotation = 0.0
        try:
            rotation = float(properties.get('rotation', 0) or 0)
        except (TypeError, ValueError):
            rotation = 0.0
        quarter_turns = int(round(rotation / (math.pi / 2))) % 4
        if quarter_turns % 2 == 1:
            width, depth = depth, width

        return max(0.1, width), max(0.1, depth)

    @staticmethod
    def _object_footprint_tiles(obj):
        if isinstance(obj, dict):
            tile_x = obj.get('tile_x', obj.get('x'))
            tile_y = obj.get('tile_y', obj.get('z'))
        else:
            tile_x = getattr(obj, 'tile_x', getattr(obj, 'x', None))
            tile_y = getattr(obj, 'tile_y', getattr(obj, 'z', None))
        if tile_x is None or tile_y is None:
            return set()

        width, depth = CombatService._object_dimensions(obj)
        center_x = float(tile_x) + 0.5
        center_y = float(tile_y) + 0.5
        min_x = center_x - (width / 2)
        max_x = center_x + (width / 2)
        min_y = center_y - (depth / 2)
        max_y = center_y + (depth / 2)

        tiles = set()
        for x in range(math.floor(min_x), math.floor(max_x - 0.0001) + 1):
            for y in range(math.floor(min_y), math.floor(max_y - 0.0001) + 1):
                if min_x < x + 1 and max_x > x and min_y < y + 1 and max_y > y:
                    tiles.add((x, y))
        return tiles

    @staticmethod
    def _grid_move_cost(start_x, start_y, end_x, end_y):
        return max(abs(end_x - start_x), abs(end_y - start_y))

    @staticmethod
    def _object_movement_profile(obj):
        if not obj:
            return {'blocked': False, 'climb_cost': 0}

        if isinstance(obj, dict):
            obj_type = obj.get('type') or obj.get('object_type') or ''
            properties = obj.get('properties') or {}
        else:
            obj_type = getattr(obj, 'type', '') or ''
            properties = getattr(obj, 'properties', {}) or {}

        low_climb_types = {'table', 'chair', 'chest', 'box', 'barrier'}
        high_climb_types = {'fence'}
        too_high_types = {'tree', 'rock', 'house', 'tent', 'wall', 'shelf', 'anomaly'}
        height = CombatService._object_height(obj)

        if properties.get('passable') is True or obj_type == 'campfire':
            return {'blocked': False, 'climb_cost': 0}

        if obj_type == 'door':
            if properties.get('is_open'):
                return {'blocked': False, 'climb_cost': 0}
            if properties.get('climbable'):
                return {'blocked': False, 'climb_cost': max(1, CombatService._coerce_int(properties.get('climb_cost'), 12))}
            return {'blocked': True, 'climb_cost': 0}

        if properties.get('blocks_movement') is False or properties.get('block_movement') is False:
            return {'blocked': False, 'climb_cost': 0}

        if properties.get('climbable') or obj_type in low_climb_types or height <= 1.05:
            climb_cost = properties.get('climb_cost')
            if climb_cost is None:
                climb_cost = 5
            return {'blocked': False, 'climb_cost': max(1, CombatService._coerce_int(climb_cost, 5))}

        if obj_type in high_climb_types or (height > 1.05 and height <= 1.6):
            climb_cost = properties.get('climb_cost')
            if climb_cost is None:
                climb_cost = 12
            return {'blocked': False, 'climb_cost': max(1, CombatService._coerce_int(climb_cost, 12))}

        if properties.get('blocks_movement') is True or properties.get('block_movement') is True:
            return {'blocked': True, 'climb_cost': 0}

        if obj_type in too_high_types or height > 1.8:
            return {'blocked': True, 'climb_cost': 0}

        return {'blocked': True, 'climb_cost': 0}

    @staticmethod
    def _build_movement_map(
        location,
        moving_character_id=None,
        ignored_character_ids=None,
    ):
        blocked_tiles = set()
        climb_cost_tiles = {}
        ignored_ids = {
            CombatService._coerce_int(item, -1)
            for item in (ignored_character_ids or [])
        }
        if moving_character_id is not None:
            ignored_ids.add(CombatService._coerce_int(moving_character_id, -1))

        tiles = location.tiles_data if isinstance(location.tiles_data, list) else []
        for y, row in enumerate(tiles):
            if not isinstance(row, list):
                continue
            for x, tile in enumerate(row):
                if not isinstance(tile, dict):
                    continue
                for obj in tile.get('objects') or []:
                    profile = CombatService._object_movement_profile(obj)
                    footprint_source = {
                        **obj,
                        'tile_x': obj.get('tile_x', obj.get('x', x)),
                        'tile_y': obj.get('tile_y', obj.get('z', y)),
                    }
                    for footprint_tile in CombatService._object_footprint_tiles(footprint_source):
                        if profile['blocked']:
                            blocked_tiles.add(footprint_tile)
                            climb_cost_tiles.pop(footprint_tile, None)
                        elif profile['climb_cost'] > 0 and footprint_tile not in blocked_tiles:
                            climb_cost_tiles[footprint_tile] = max(climb_cost_tiles.get(footprint_tile, 0), profile['climb_cost'])

        for obj in LocationObject.query.filter_by(location_id=location.id).all():
            profile = CombatService._object_movement_profile(obj)
            for coords in CombatService._object_footprint_tiles(obj):
                if profile['blocked']:
                    blocked_tiles.add(coords)
                    climb_cost_tiles.pop(coords, None)
                elif profile['climb_cost'] > 0 and coords not in blocked_tiles:
                    climb_cost_tiles[coords] = max(climb_cost_tiles.get(coords, 0), profile['climb_cost'])

        for character in CombatService._unique_location_characters(
            LocationCharacter.query.filter_by(location_id=location.id).all()
        ):
            if CombatService._coerce_int(character.character_id, -1) in ignored_ids:
                continue
            blocked_tiles.add((character.pos_x, character.pos_y))
            climb_cost_tiles.pop((character.pos_x, character.pos_y), None)

        return blocked_tiles, climb_cost_tiles

    @staticmethod
    def _find_climb_landing(location, object_item, actor_character):
        occupied_tiles = CombatService._object_footprint_tiles(object_item)
        if not occupied_tiles:
            return None

        blocked_tiles, climb_cost_tiles = CombatService._build_movement_map(location, actor_character.character_id)
        actor_x = actor_character.pos_x
        actor_y = actor_character.pos_y
        nearest_object_distance = min(
            (max(abs(actor_x - tile_x), abs(actor_y - tile_y)) for tile_x, tile_y in occupied_tiles),
            default=float('inf'),
        )
        if nearest_object_distance > 1:
            return None
        candidate_tiles = []
        seen = set()
        center_x = sum(tile_x + 0.5 for tile_x, _ in occupied_tiles) / len(occupied_tiles)
        center_y = sum(tile_y + 0.5 for _, tile_y in occupied_tiles) / len(occupied_tiles)
        actor_vector_x = center_x - (actor_x + 0.5)
        actor_vector_y = center_y - (actor_y + 0.5)

        for ox, oy in occupied_tiles:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    tx = ox + dx
                    ty = oy + dy
                    if tx < 0 or ty < 0 or tx >= location.grid_width or ty >= location.grid_height:
                        continue
                    if (tx, ty) in occupied_tiles or (tx, ty) in seen:
                        continue
                    seen.add((tx, ty))
                    candidate_tiles.append((tx, ty))

        candidate_tiles.sort(
            key=lambda tile: (
                -(((tile[0] + 0.5) - (actor_x + 0.5)) * actor_vector_x + ((tile[1] + 0.5) - (actor_y + 0.5)) * actor_vector_y),
                -max(abs(tile[0] - actor_x), abs(tile[1] - actor_y)),
                abs(tile[0] - actor_x) + abs(tile[1] - actor_y),
            )
        )

        for tx, ty in candidate_tiles:
            if tx == actor_x and ty == actor_y:
                continue
            if (tx, ty) in blocked_tiles:
                continue
            if climb_cost_tiles.get((tx, ty), 0) > 0:
                continue
            return tx, ty
        return None

    @staticmethod
    def _find_movement_path(
        location,
        start_x,
        start_y,
        end_x,
        end_y,
        moving_character_id=None,
        ignored_character_ids=None,
        companion_offset=None,
    ):
        if start_x == end_x and start_y == end_y:
            return {'cost': 0, 'path': [(start_x, start_y)], 'climb_cost': 0}

        blocked_tiles, climb_cost_tiles = CombatService._build_movement_map(
            location,
            moving_character_id,
            ignored_character_ids,
        )
        width = location.grid_width
        height = location.grid_height

        def in_bounds(x, y):
            return 0 <= x < width and 0 <= y < height

        def step_cost(x, y):
            if (x, y) in blocked_tiles:
                return None
            return 1 + max(0, climb_cost_tiles.get((x, y), 0))

        def companion_can_occupy(x, y):
            if not companion_offset:
                return True
            companion_x = x + companion_offset[0]
            companion_y = y + companion_offset[1]
            return bool(
                in_bounds(companion_x, companion_y)
                and (companion_x, companion_y) not in blocked_tiles
                and climb_cost_tiles.get((companion_x, companion_y), 0) <= 0
            )

        def heuristic(x, y):
            return max(abs(end_x - x), abs(end_y - y))

        if (
            climb_cost_tiles.get((end_x, end_y), 0) > 0
            or not companion_can_occupy(end_x, end_y)
        ):
            return None

        directions = [
            (1, 0), (-1, 0), (0, 1), (0, -1),
            (1, 1), (1, -1), (-1, 1), (-1, -1),
        ]

        open_heap = [(0, 0, start_x, start_y)]
        came_from = {}
        best_cost = {(start_x, start_y): 0}
        counter = 1

        while open_heap:
            _, current_cost, x, y = heapq.heappop(open_heap)
            if current_cost != best_cost.get((x, y)):
                continue
            if x == end_x and y == end_y:
                path = [(x, y)]
                cursor = (x, y)
                while cursor in came_from:
                    cursor = came_from[cursor]
                    path.append(cursor)
                path.reverse()
                climb_cost_total = sum(climb_cost_tiles.get(step, 0) for step in path[1:])
                return {'cost': current_cost, 'path': path, 'climb_cost': climb_cost_total}

            for dx, dy in directions:
                nx = x + dx
                ny = y + dy
                if not in_bounds(nx, ny):
                    continue

                move_cost = step_cost(nx, ny)
                if move_cost is None or not companion_can_occupy(nx, ny):
                    continue
                if nx == end_x and ny == end_y and climb_cost_tiles.get((nx, ny), 0) > 0:
                    continue

                new_cost = current_cost + move_cost
                if new_cost >= best_cost.get((nx, ny), float('inf')):
                    continue

                best_cost[(nx, ny)] = new_cost
                came_from[(nx, ny)] = (x, y)
                heapq.heappush(open_heap, (new_cost + heuristic(nx, ny), new_cost, nx, ny))

        return None

    @staticmethod
    def _prepare_character_for_turn(loc_char):
        profile = CombatService._combat_profile(loc_char)
        condition = CombatService._location_character_condition(loc_char)
        loc_char.initiative_bonus = profile['initiative_bonus']
        loc_char.action_points_max = profile['action_points']
        loc_char.action_points_current = profile['action_points'] if condition['can_act'] else 0
        loc_char.free_actions_max = profile['free_actions']
        loc_char.free_actions_current = profile['free_actions'] if condition['can_act'] else 0
        loc_char.movement_points_max = 0
        loc_char.movement_points_current = 0
        loc_char.movement_mode_this_turn = None
        loc_char.movement_distance_this_turn = 0
        loc_char.correction_distance_this_turn = 0
        loc_char.melee_block_round = None
        loc_char.melee_block_effectiveness = 0
        loc_char.melee_swing_round = None
        if getattr(loc_char, 'character', None) and isinstance(loc_char.character.data, dict):
            data = loc_char.character.data
            health = data.get('health') if isinstance(data.get('health'), dict) else {}
            meta = health.setdefault('combatMeta', {})
            meta['consumableUsage'] = {}
            pending_action = meta.get('pendingAction')
            if isinstance(pending_action, dict):
                remaining_cost = max(
                    0,
                    CombatService._coerce_int(pending_action.get('remaining_action_points'), 0),
                )
                paid = min(loc_char.action_points_current, remaining_cost)
                loc_char.action_points_current -= paid
                remaining_cost -= paid
                pending_action['remaining_action_points'] = remaining_cost
                if remaining_cost <= 0:
                    meta.pop('pendingAction', None)
                    meta['completedPendingActionId'] = pending_action.get('id')
            data['health'] = health
            loc_char.character.data = data
            flag_modified(loc_char.character, 'data')
        return loc_char

    @staticmethod
    def _serialize_character(loc_char, current_turn_id=None):
        character = loc_char.character
        profile = CombatService._combat_profile(loc_char)
        posture = CombatService._posture_key(loc_char)
        posture_profile = POSTURES[posture]
        posture_change_options = {}
        for target_posture in POSTURES:
            if target_posture == posture:
                continue
            posture_change_options[target_posture] = CombatService._posture_change_options(
                loc_char,
                target_posture,
            )
        data = character.data if character and isinstance(character.data, dict) else {}
        weapons = data.get('weapons') if isinstance(data.get('weapons'), list) else []
        weapon_ergonomics = [
            CombatService._weapon_ergonomics_profile(loc_char, weapon, index)
            for index, weapon in enumerate(weapons)
        ]
        health = data.get('health') if isinstance(data, dict) else {}
        if not isinstance(health, dict):
            health = {}
        bleeding_profile = CombatService._bleeding_check_profile(data)
        condition = CombatService._character_condition(data)
        return {
            'location_character_id': loc_char.id,
            'character_id': character.id if character else None,
            'name': character.name if character else None,
            'owner_id': character.owner_id if character else None,
            'owner_username': character.owner.username if character and character.owner else None,
            'controlled_by': loc_char.controlled_by,
            'x': loc_char.pos_x,
            'y': loc_char.pos_y,
            'status': loc_char.status,
            'initiative_bonus': loc_char.initiative_bonus or 0,
            'initiative_roll': loc_char.initiative_roll,
            'initiative_total': loc_char.initiative_total,
            'action_points_max': loc_char.action_points_max if loc_char.action_points_max is not None else DEFAULT_ACTION_POINTS,
            'action_points_current': loc_char.action_points_current or 0,
            'free_actions_max': loc_char.free_actions_max if loc_char.free_actions_max is not None else DEFAULT_FREE_ACTIONS,
            'free_actions_current': loc_char.free_actions_current or 0,
            'movement_points_max': loc_char.movement_points_max if loc_char.movement_points_max is not None else profile['movement_points'],
            'movement_points_current': loc_char.movement_points_current or 0,
            'movement_penalty': profile['movement_penalty'],
            'pending_action': (
                health.get('combatMeta', {}).get('pendingAction')
                if isinstance(health.get('combatMeta'), dict)
                else None
            ),
            'completed_pending_action_id': (
                health.get('combatMeta', {}).get('completedPendingActionId')
                if isinstance(health.get('combatMeta'), dict)
                else None
            ),
            'movement_gain': profile['movement_gain'],
            'is_exoskeleton': CombatService._exoskeleton_power_profile(data)['is_exoskeleton'],
            'powered_exoskeleton': CombatService._exoskeleton_power_profile(data)['powered'],
            'movement_mode_this_turn': loc_char.movement_mode_this_turn,
            'movement_distance_this_turn': loc_char.movement_distance_this_turn or 0,
            'correction_distance_this_turn': loc_char.correction_distance_this_turn or 0,
            'strenuous_movement_blocked_until_round': loc_char.strenuous_movement_blocked_until_round or 0,
            'posture': posture,
            'posture_label': posture_profile['label'],
            'posture_change_options': posture_change_options,
            'posture_modifiers': {
                'shooting_bonus': posture_profile['shooting_bonus'],
                'ergonomics_bonus': posture_profile['ergonomics_bonus'],
                'stealth_bonus': posture_profile['stealth_bonus'],
                'movement_multiplier': posture_profile['movement_multiplier'],
                'walk_max_distance': posture_profile['walk_max_distance'],
                'can_run': posture_profile['can_run'],
                'can_sprint': (
                    posture_profile['can_sprint']
                    and not CombatService._disabled_limb_penalties(data)['sprint_blocked']
                ),
                'can_correction': posture_profile['can_correction'],
                'can_use_low_cover': posture_profile['can_use_low_cover'],
            },
            'weapon_ergonomics': weapon_ergonomics,
            'drawn_weapon_index': loc_char.drawn_weapon_index,
            'aimed_target_character_id': loc_char.aimed_target_character_id,
            'aimed_weapon_index': loc_char.aimed_weapon_index,
            'aim_accuracy_bonus': max(0, CombatService._coerce_int(loc_char.aim_accuracy_bonus, 0)),
            'cover_object_id': loc_char.cover_object_id,
            'weapon_braced': bool(loc_char.weapon_braced),
            'braced_weapon_index': loc_char.braced_weapon_index,
            'facing_x': CombatService._coerce_int(loc_char.facing_x, 0),
            'facing_y': CombatService._coerce_int(loc_char.facing_y, 1),
            'melee_swing_round': loc_char.melee_swing_round,
            'melee_block_round': loc_char.melee_block_round,
            'melee_block_effectiveness': loc_char.melee_block_effectiveness or 0,
            'grapple_target_id': loc_char.grapple_target_id,
            'grappled_by_id': loc_char.grappled_by_id,
            'grapple_strengthened': bool(loc_char.grapple_strengthened),
            'grapple_choke_rounds': loc_char.grapple_choke_rounds or 0,
            'grapple_live_shield': bool(loc_char.grapple_live_shield),
            'hp_zones': loc_char.hp_zones,
            'effects': loc_char.effects,
            'pain_level': CombatService._coerce_int(health.get('painLevel', 0), 0),
            'exhaustion': CombatService._coerce_int(health.get('exhaustion', 0), 0),
            'stress': CombatService._coerce_int(health.get('stress', 0), 0),
            'radiation': CombatService._coerce_int(health.get('radiation', 0), 0),
            'blood': health.get('blood') or health.get('bloodStage') or 'normal',
            'blood_stage': health.get('bloodStage') or health.get('blood') or 'normal',
            'bleeding_severity': CombatService._coerce_int(health.get('bleedingSeverity', 0), 0),
            'bleeding_difficulty': bleeding_profile['difficulty'],
            'bleeding_modifier_total': CombatService._coerce_int(health.get('bleedingModifierTotal', 0), 0),
            'will_bonus': bleeding_profile['willBonus'],
            'bleeding': health.get('bleeding', {}),
            'condition': condition,
            'is_current_turn': loc_char.id == current_turn_id,
        }

    @staticmethod
    def _can_end_turn_for_character(loc_char, user_id, is_gm=False):
        if is_gm:
            return True
        character = getattr(loc_char, 'character', None)
        if character and character.owner_id == user_id:
            return True
        return loc_char.controlled_by == user_id

    @staticmethod
    def _validate_incapacitated_interaction(
        location_id,
        user_id,
        actor_location_character_id,
        target_character_id,
    ):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
        actor = LocationCharacter.query.filter_by(
            id=actor_location_character_id,
            location_id=location_id,
        ).first()
        target = LocationCharacter.query.filter_by(
            character_id=target_character_id,
            location_id=location_id,
        ).first()
        if not actor or not target or actor.id == target.id:
            raise NotFoundError("Interaction target not found")
        if not CombatService._can_end_turn_for_character(actor, user_id, is_gm=is_gm):
            raise PermissionDenied("You do not control the acting character")
        CombatService.ensure_character_can_act(actor)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if (
            state
            and state.status == 'active'
            and state.current_location_character_id != actor.id
        ):
            raise PermissionDenied("It is not this character's turn")
        if not CombatService._is_adjacent(actor, target):
            raise ValidationError("The target must be in an adjacent tile")
        condition = CombatService._location_character_condition(target)
        if condition['state'] == 'active':
            raise ValidationError("Only an incapacitated character can be searched or examined")
        return actor, target, condition

    @staticmethod
    def inspect_incapacitated_character(
        location_id,
        user_id,
        actor_location_character_id,
        target_character_id,
    ):
        actor, target, condition = CombatService._validate_incapacitated_interaction(
            location_id,
            user_id,
            actor_location_character_id,
            target_character_id,
        )
        return CombatService._incapacitated_character_snapshot(
            actor,
            target,
            condition,
        )

    @staticmethod
    def _incapacitated_character_snapshot(actor, target, condition=None):
        target_data = (
            deepcopy(target.character.data)
            if target.character and isinstance(target.character.data, dict)
            else {}
        )
        health = target_data.get('health') if isinstance(target_data.get('health'), dict) else {}
        condition = condition or CombatService._location_character_condition(target)
        return {
            'actor_character_id': actor.character_id,
            'target_character_id': target.character_id,
            'target_name': target.character.name if target.character else 'Персонаж',
            'condition': condition,
            'health': {
                'current': health.get('current'),
                'max': health.get('max'),
                'blood_stage': health.get('bloodStage') or health.get('blood') or 'normal',
                'pain_level': CombatService._coerce_int(health.get('painLevel'), 0),
                'effects': normalize_effect_list(health.get('effects') or []),
            },
            'target_data': target_data,
        }

    @staticmethod
    def _take_inventory_item(character_data, path, amount):
        if not isinstance(path, list) or not path or path[0] not in {'inventory', 'equipment'}:
            raise ValidationError("Invalid inventory path")
        current = character_data
        for key in path[:-1]:
            if isinstance(current, list):
                index = CombatService._coerce_int(key, -1)
                if index < 0 or index >= len(current):
                    raise NotFoundError("Item not found")
                current = current[index]
            elif isinstance(current, dict) and key in current:
                current = current[key]
            else:
                raise NotFoundError("Item not found")
        index = CombatService._coerce_int(path[-1], -1)
        if not isinstance(current, list) or index < 0 or index >= len(current):
            raise NotFoundError("Item not found")
        item = current[index]
        if not isinstance(item, dict):
            return current.pop(index)
        quantity = max(1, CombatService._coerce_int(item.get('quantity'), 1))
        transfer_amount = max(1, min(CombatService._coerce_int(amount, 1), quantity))
        transferred = deepcopy(item)
        transferred['quantity'] = transfer_amount
        if transfer_amount == quantity:
            current.pop(index)
        else:
            item['quantity'] = quantity - transfer_amount
        return transferred

    @staticmethod
    def loot_incapacitated_character(
        location_id,
        user_id,
        actor_location_character_id,
        target_character_id,
        item_path,
        amount=1,
    ):
        actor, target, _ = CombatService._validate_incapacitated_interaction(
            location_id,
            user_id,
            actor_location_character_id,
            target_character_id,
        )
        actor_data = (
            deepcopy(actor.character.data)
            if actor.character and isinstance(actor.character.data, dict)
            else {}
        )
        target_data = (
            deepcopy(target.character.data)
            if target.character and isinstance(target.character.data, dict)
            else {}
        )
        transferred = CombatService._take_inventory_item(
            target_data,
            item_path,
            amount,
        )
        inventory = actor_data.setdefault('inventory', {})
        backpack = inventory.setdefault('backpack', [])
        if not isinstance(backpack, list):
            backpack = []
            inventory['backpack'] = backpack
        backpack.append(transferred)
        actor.character.data = actor_data
        target.character.data = target_data
        flag_modified(actor.character, 'data')
        flag_modified(target.character, 'data')
        db.session.commit()
        return CombatService._incapacitated_character_snapshot(
            actor,
            target,
            CombatService._location_character_condition(target),
        )

    @staticmethod
    def update_incapacitated_character_health(
        location_id,
        user_id,
        actor_location_character_id,
        target_character_id,
        health,
    ):
        actor, target, _ = CombatService._validate_incapacitated_interaction(
            location_id,
            user_id,
            actor_location_character_id,
            target_character_id,
        )
        if not isinstance(health, dict):
            raise ValidationError("Health data is required")
        target_data = (
            deepcopy(target.character.data)
            if target.character and isinstance(target.character.data, dict)
            else {}
        )
        target_data['health'] = deepcopy(health)
        normalize_character_effects(target_data)
        target.character.data = target_data
        flag_modified(target.character, 'data')
        CombatService._sync_location_effects_from_character(target)
        db.session.commit()
        return CombatService._incapacitated_character_snapshot(
            actor,
            target,
            CombatService._location_character_condition(target),
        )

    @staticmethod
    def _serialize_state(location, state):
        characters = CombatService._unique_location_characters(
            LocationCharacter.query.filter_by(location_id=location.id).all()
        )
        turn_order = list(dict.fromkeys(state.turn_order or []))
        order_map = {character_id: index for index, character_id in enumerate(turn_order)}

        if state.turn_order:
            ordered_characters = sorted(
                characters,
                key=lambda item: (
                    order_map.get(item.id, len(order_map) + 1),
                    -(item.initiative_total or 0),
                    item.id,
                ),
            )
        else:
            ordered_characters = sorted(
                characters,
                key=lambda item: (-(item.initiative_total or 0), item.id),
            )

        current_character = next(
            (item for item in ordered_characters if item.id == state.current_location_character_id),
            None,
        )

        return {
            'location_id': location.id,
            'status': state.status,
            'round_number': state.round_number,
            'turn_index': state.turn_index,
            'turn_order': turn_order,
            'current_location_character_id': state.current_location_character_id,
            'current_character': CombatService._serialize_character(
                current_character,
                current_turn_id=state.current_location_character_id,
            ) if current_character else None,
            'characters': [
                CombatService._serialize_character(
                    item,
                    current_turn_id=state.current_location_character_id,
                )
                for item in ordered_characters
            ],
            'available_actions': CombatService.action_catalog(current_character) if current_character else [],
        }

    @staticmethod
    def action_catalog(loc_char=None):
        if not loc_char:
            return [dict(action) for action in ACTION_CATALOG]
        profile = CombatService._combat_profile(loc_char)
        movement_gain = profile['movement_gain']
        return [
            dict(action) if action['key'] != 'convert_free_action_to_movement'
            else {**action, 'movement_points_gain': movement_gain}
            for action in ACTION_CATALOG
        ]

    @staticmethod
    def get_state(location_id, user_id):
        location = CombatService._get_location(location_id)
        CombatService._ensure_access(location, user_id)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state:
            state = LocationCombatState(
                location_id=location_id,
                status='idle',
                round_number=0,
                turn_index=0,
                turn_order=[],
                current_location_character_id=None,
            )
        return CombatService._serialize_state(location, state)

    @staticmethod
    def start_combat(location_id, user_id, location_character_ids=None):
        location = CombatService._get_location(location_id)
        CombatService._ensure_access(location, user_id)
        if location.lobby.gm_id != user_id:
            raise PermissionDenied("Only GM can start combat")

        available_characters = CombatService._unique_location_characters(
            LocationCharacter.query.filter_by(location_id=location_id).all()
        )
        if not available_characters:
            raise ValidationError("No characters are present in this location")
        available_by_id = {item.id: item for item in available_characters}
        if location_character_ids is None:
            loc_chars = available_characters
        else:
            if not isinstance(location_character_ids, (list, tuple, set)):
                raise ValidationError("Combat participants must be a list")
            selected_ids = list(dict.fromkeys(
                CombatService._coerce_int(value, 0)
                for value in location_character_ids
            ))
            if not selected_ids or any(value <= 0 for value in selected_ids):
                raise ValidationError("Select at least one combat participant")
            missing_ids = [
                value for value in selected_ids if value not in available_by_id
            ]
            if missing_ids:
                raise ValidationError("Selected character is not in this location")
            loc_chars = [available_by_id[value] for value in selected_ids]

        state = CombatService._get_or_create_state(location_id)
        if state.status == 'active':
            raise ValidationError("Combat is already active")

        selected_location_ids = {item.id for item in loc_chars}
        for loc_char in available_characters:
            character_data = (
                loc_char.character.data
                if loc_char.character and isinstance(loc_char.character.data, dict)
                else {}
            )
            weapons = character_data.get('weapons') if isinstance(character_data.get('weapons'), list) else []
            changed_weapons = False
            for weapon in weapons:
                if isinstance(weapon, dict) and weapon.pop('_usedInCurrentCombat', None) is not None:
                    changed_weapons = True
            if changed_weapons:
                loc_char.character.data = character_data
                flag_modified(loc_char.character, 'data')
            profile = CombatService._combat_profile(loc_char)
            loc_char.initiative_bonus = profile['initiative_bonus']
            if loc_char.id not in selected_location_ids:
                loc_char.initiative_roll = None
                loc_char.initiative_total = None
                continue
            loc_char.initiative_roll = random.randint(1, 20)
            loc_char.initiative_total = loc_char.initiative_roll + loc_char.initiative_bonus
            loc_char.strenuous_movement_blocked_until_round = 0
            loc_char.drawn_weapon_index = CombatService._persistent_weapon_index(loc_char)
            CombatService._clear_aim(loc_char)
            CombatService._prepare_character_for_turn(loc_char)
            CombatService._sync_location_effects_from_character(loc_char)

        ordered_chars = sorted(
            loc_chars,
            key=lambda item: (
                -(item.initiative_total or 0),
                -(item.initiative_bonus or 0),
                item.id,
            ),
        )

        state.status = 'active'
        state.round_number = 1
        state.turn_index = 0
        state.turn_order = [item.id for item in ordered_chars]
        state.current_location_character_id = ordered_chars[0].id
        db.session.commit()

        return CombatService._serialize_state(location, state)

    @staticmethod
    def end_turn(location_id, user_id, location_character_id=None, _continue_pending=False):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
        CombatService._release_invalid_grapples(location_id)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state:
            raise ValidationError("Combat is not active")
        if state.status != 'active':
            raise ValidationError("Combat is not active")
        if not state.turn_order:
            raise ValidationError("Turn order is empty")

        ending_round = max(1, state.round_number or 1)
        current_character_id = state.current_location_character_id
        if location_character_id is None:
            location_character_id = current_character_id

        if location_character_id != current_character_id and not is_gm:
            raise PermissionDenied("It is not this character's turn")

        if location_character_id != current_character_id and is_gm:
            current_character_id = location_character_id

        current_character = LocationCharacter.query.filter_by(
            id=current_character_id,
            location_id=location_id,
        ).first()
        if not current_character:
            raise NotFoundError("Current character not found")
        if not _continue_pending and not CombatService._can_end_turn_for_character(current_character, user_id, is_gm=is_gm):
            raise PermissionDenied("You do not control this character")

        state.turn_order = list(dict.fromkeys(state.turn_order or []))
        current_index = state.turn_order.index(current_character_id)
        next_index = (current_index + 1) % len(state.turn_order)
        next_character_id = state.turn_order[next_index]
        next_character = LocationCharacter.query.filter_by(
            id=next_character_id,
            location_id=location_id,
        ).first()
        if not next_character:
            raise NotFoundError("Next character not found")

        CombatService._tick_character_effects(current_character, phase='turn_end')
        CombatService._apply_periodic_health_effects(current_character, phase='turn_end')
        CombatService._resolve_bleeding_check(current_character)
        pain_shock_check = CombatService._resolve_pain_shock_check(
            current_character,
            ending_round,
        )
        current_data = (
            current_character.character.data
            if current_character.character
            and isinstance(current_character.character.data, dict)
            else {}
        )
        current_health = current_data.get('health')
        current_meta = (
            current_health.get('combatMeta')
            if isinstance(current_health, dict)
            and isinstance(current_health.get('combatMeta'), dict)
            else {}
        )
        if current_meta.pop('circularAttackRound', None) == ending_round:
            apply_effect_to_health(current_health, {
                'type': 'circular_attack_recovery',
                'name': 'Восстановление после круговой атаки',
                'remaining': 1,
                'tick': 'turn_end',
                'rollPenalty': 2,
                'source': 'circular_attack',
            })
            current_character.character.data = current_data
            flag_modified(current_character.character, 'data')
        CombatService._release_invalid_grapples(location_id)
        CombatService._sync_location_effects_from_character(current_character)

        if next_index == 0:
            round_characters = CombatService._unique_location_characters(
                LocationCharacter.query.filter_by(location_id=location_id).all()
            )
            CombatService._apply_end_of_round_pain_recovery(round_characters)
            for round_character in round_characters:
                CombatService._advance_character_time(round_character, 6)
            state.round_number += 1
        state.turn_index = next_index
        state.current_location_character_id = next_character_id
        CombatService._prepare_character_for_turn(next_character)
        CombatService._sync_location_effects_from_character(next_character)
        db.session.commit()

        next_data = (
            next_character.character.data
            if next_character.character and isinstance(next_character.character.data, dict)
            else {}
        )
        next_health = next_data.get('health') if isinstance(next_data.get('health'), dict) else {}
        next_meta = next_health.get('combatMeta') if isinstance(next_health.get('combatMeta'), dict) else {}
        pending_action = next_meta.get('pendingAction')
        if isinstance(pending_action, dict) and CombatService._coerce_int(
            pending_action.get('remaining_action_points'), 0
        ) > 0:
            return CombatService.end_turn(
                location_id,
                user_id,
                location_character_id=next_character.id,
                _continue_pending=True,
            )

        payload = CombatService._serialize_state(location, state)
        payload['pain_shock_check'] = pain_shock_check
        return payload

    @staticmethod
    def spend_resources(
        location_id,
        user_id,
        location_character_id,
        action_points=0,
        free_actions=0,
        movement_points=0,
        *,
        allow_deferred=False,
        pending_action_id=None,
        pending_action_label=None,
    ):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
        CombatService._release_invalid_grapples(location_id)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state:
            raise ValidationError("Combat is not active")
        if state.status != 'active':
            raise ValidationError("Combat is not active")
        character = LocationCharacter.query.filter_by(
            id=location_character_id,
            location_id=location_id,
        ).first()
        if not character:
            raise NotFoundError("Character not found")

        if state.status == 'active' and state.current_location_character_id != character.id:
            raise PermissionDenied("It is not this character's turn")
        CombatService.ensure_character_can_act(character)

        action_points = max(0, CombatService._coerce_int(action_points, 0))
        free_actions = max(0, CombatService._coerce_int(free_actions, 0))
        movement_points = max(0, CombatService._coerce_int(movement_points, 0))

        deferred = action_points > character.action_points_current
        if deferred and not allow_deferred:
            raise ValidationError("Not enough action points")
        if free_actions > character.free_actions_current:
            raise ValidationError("Not enough free actions")
        if movement_points > character.movement_points_current:
            raise ValidationError("Not enough movement points")

        if deferred:
            paid_action_points = max(0, character.action_points_current)
            character.action_points_current = 0
            character_data = character.character.data if isinstance(character.character.data, dict) else {}
            health = character_data.setdefault('health', {})
            meta = health.setdefault('combatMeta', {})
            meta['pendingAction'] = {
                'id': str(pending_action_id or f'action-{character.id}-{db.func.now()}'),
                'label': str(pending_action_label or 'Длительное действие'),
                'total_action_points': action_points,
                'remaining_action_points': action_points - paid_action_points,
            }
            meta.pop('completedPendingActionId', None)
            character.character.data = character_data
            flag_modified(character.character, 'data')
        else:
            character.action_points_current -= action_points
        character.free_actions_current -= free_actions
        character.movement_points_current -= movement_points
        CombatService._clear_aim(character)
        character.last_action = db.func.now()
        db.session.commit()
        serialized = CombatService._serialize_character(
            character,
            current_turn_id=state.current_location_character_id,
        )
        serialized['payment_complete'] = not deferred
        if deferred:
            serialized['pending_action_id'] = meta['pendingAction']['id']
            serialized['state'] = CombatService.end_turn(
                location_id,
                user_id,
                location_character_id=character.id,
            )
        return serialized

    @staticmethod
    def adjust_resources(location_id, user_id, location_character_id, action_points=0, movement_points=0):
        location = CombatService._get_location(location_id)
        CombatService._ensure_access(location, user_id)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state or state.status != 'active':
            raise ValidationError("Combat is not active")
        character = LocationCharacter.query.filter_by(id=location_character_id, location_id=location_id).first()
        if not character:
            raise NotFoundError("Character not found")

        data = character.character.data if character.character and isinstance(character.character.data, dict) else {}
        if state.current_location_character_id != character.id:
            raise PermissionDenied("It is not this character's turn")
        CombatService.ensure_character_can_act(character)
        action_points = max(-10, min(10, CombatService._coerce_int(action_points, 0)))
        movement_points = max(-50, min(50, CombatService._coerce_int(movement_points, 0)))
        character.action_points_current = max(0, character.action_points_current + action_points)
        character.movement_points_current = max(0, character.movement_points_current + movement_points)
        CombatService._release_invalid_grapples(location_id)
        character.last_action = db.func.now()
        db.session.commit()
        return CombatService._serialize_character(character, current_turn_id=state.current_location_character_id)

    @staticmethod
    def perform_action(
        location_id,
        user_id,
        location_character_id,
        action_key,
        weapon_index=None,
        fire_mode=None,
        shot_count=None,
        volley_count=None,
        action_points=None,
        target_character_id=None,
        target_character_ids=None,
        target_object_id=None,
        area_center_x=None,
        area_center_y=None,
        target_x=None,
        target_y=None,
        posture=None,
        attack_type=None,
        target_zone=None,
        payment=None,
        magazine_template_id=None,
        inventory_retrieval_action_points=None,
        inventory_use_action_discount=None,
        attribute_choice=None,
        pending_action_id=None,
        resume_pending_action_id=None,
    ):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
        CombatService._release_invalid_grapples(location_id)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state or state.status != 'active':
            raise ValidationError("Combat is not active")

        character = LocationCharacter.query.filter_by(
            id=location_character_id,
            location_id=location_id,
        ).first()
        if not character:
            raise NotFoundError("Character not found")

        data = (
            character.character.data
            if character.character and isinstance(character.character.data, dict)
            else {}
        )

        if state.current_location_character_id != character.id:
            raise PermissionDenied("It is not this character's turn")
        CombatService.ensure_character_can_act(character, action_key)

        health = data.setdefault('health', {})
        combat_meta = health.setdefault('combatMeta', {})
        resumed_paid_action = bool(
            resume_pending_action_id
            and str(combat_meta.get('completedPendingActionId') or '') == str(resume_pending_action_id)
        )
        if resume_pending_action_id and not resumed_paid_action:
            raise ValidationError("The pending action has not been paid yet")

        action = next((item for item in ACTION_CATALOG if item['key'] == action_key), None)
        if not action:
            raise ValidationError("Unknown action")

        attack_details = None
        aim_details = None
        posture_details = None
        draw_details = None
        reload_details = None
        clear_jam_details = None
        cover_details = None
        brace_details = None
        melee_action_details = None
        special_action_cost = None
        resolved_hits = []
        current_round = max(1, state.round_number or 1)
        if action_key == 'recover_from_shock':
            health = data.setdefault('health', {})
            pain_level = max(0, CombatService._coerce_int(health.get('painLevel'), 0))
            if pain_level >= 10:
                raise ValidationError("Pain must be reduced below 10 before recovering from pain shock")
            meta = health.setdefault('combatMeta', {})
            if CombatService._coerce_int(meta.get('shockRecoveryRound'), 0) == current_round:
                raise ValidationError("An attempt to regain consciousness has already been made this turn")
            meta['shockRecoveryRound'] = current_round
            will_bonus = CombatService._skill_modifier(
                data, 'skills.physical.will', include_pain=False
            )
            medicine_bonus = CombatService._coerce_int(meta.get('willShockBonus'), 0)
            advantage = bool(meta.get('willShockAdvantage'))
            rolls = [random.randint(1, 20) for _ in range(2 if advantage else 1)]
            roll = max(rolls)
            difficulty = max(1, 12 - will_bonus - medicine_bonus)
            success = roll == 20 or (roll != 1 and roll >= difficulty)
            if success:
                health['effects'] = [
                    effect for effect in normalize_effect_list(health.get('effects') or [])
                    if effect.get('type') != 'shock'
                ]
                meta['painShockRecoveredRound'] = current_round
                meta['painShockRecovered'] = True
                meta.pop('willShockBonus', None)
                meta.pop('willShockAdvantage', None)
            character.posture = 'prone'
            character.cover_object_id = None
            character.weapon_braced = False
            character.braced_weapon_index = None
            character.character.data = data
            flag_modified(character.character, 'data')
            CombatService._sync_location_effects_from_character(character)
            special_action_cost = 0
            melee_action_details = {
                'kind': 'recover_from_shock',
                'rolls': rolls,
                'roll': roll,
                'will_bonus': will_bonus,
                'medicine_bonus': medicine_bonus,
                'difficulty': difficulty,
                'total': roll,
                'success': success,
                'ends_turn': True,
            }
        if (
            character.grappled_by_id
            and action_key not in {
                'grapple_escape', 'grapple_desperate_attack', 'recover_from_shock'
            }
        ):
            raise ValidationError("A grappled character can only escape or make a desperate attack")
        if (
            character.melee_block_round == current_round
            and action_key != 'melee_block'
        ):
            character.melee_block_round = None
            character.melee_block_effectiveness = 0

        if action_key == 'melee_swing':
            if character.melee_swing_round == current_round:
                raise ValidationError("Swing can only be prepared once per turn")
            character.melee_swing_round = current_round
            melee_action_details = {'prepared': True, 'damage_bonus_percent': 25}

        if action_key == 'melee_block':
            block_cost = CombatService._coerce_int(action_points, 0)
            if block_cost not in {1, 2, 3, 4}:
                raise ValidationError("Block must cost from 1 to 4 action points")
            block_base = {1: 2, 2: 3, 3: 4, 4: 7}[block_cost]
            strength_bonus = max(
                0,
                CombatService._skill_modifier(
                    data, 'skills.physical.strength', include_pain=False
                ),
            )
            character.melee_block_round = current_round
            character.melee_block_effectiveness = block_base + strength_bonus
            special_action_cost = block_cost
            melee_action_details = {
                'block_cost': block_cost,
                'effectiveness': character.melee_block_effectiveness,
            }

        targeted_melee_actions = {'melee_disarm', 'melee_shove', 'grapple'}
        target = None
        if action_key in targeted_melee_actions:
            target = LocationCharacter.query.filter_by(
                location_id=location_id,
                character_id=target_character_id,
            ).first()
            if not target or target.id == character.id:
                raise ValidationError("Target character not found")
            if not CombatService._is_adjacent(character, target):
                raise ValidationError("Melee target must be in an adjacent tile")
            character.facing_x = 0 if target.pos_x == character.pos_x else (1 if target.pos_x > character.pos_x else -1)
            character.facing_y = 0 if target.pos_y == character.pos_y else (1 if target.pos_y > character.pos_y else -1)
            CombatService._sync_grapple_facing(character)

        if action_key == 'melee_disarm':
            if not CombatService._has_free_hand(character):
                raise ValidationError("A free hand is required to take an item")
            actor_bonus = CombatService._skill_modifier(
                data, 'skills.physical.melee'
            )
            target_data = target.character.data if target.character else {}
            target_bonus = CombatService._skill_modifier(
                target_data, 'skills.physical.melee'
            )
            roll = random.randint(1, 20)
            difficulty = 8 - actor_bonus + target_bonus
            if target.drawn_weapon_index is not None:
                difficulty += 4
            success = roll == 20 or (roll != 1 and roll >= difficulty)
            removed_weapon_index = target.drawn_weapon_index if success else None
            transferred_weapon = None
            if success and removed_weapon_index is not None:
                target_weapons = (
                    target_data.get('weapons')
                    if isinstance(target_data.get('weapons'), list)
                    else []
                )
                if 0 <= removed_weapon_index < len(target_weapons):
                    transferred_weapon = target_weapons.pop(removed_weapon_index)
                    actor_weapons = data.setdefault('weapons', [])
                    actor_weapons.append(transferred_weapon)
                    character.drawn_weapon_index = len(actor_weapons) - 1
                    character.character.data = data
                    target.character.data = target_data
                    flag_modified(character.character, 'data')
                    flag_modified(target.character, 'data')
                target.drawn_weapon_index = None
                CombatService._clear_aim(target)
            elif success:
                target.drawn_weapon_index = None
                CombatService._clear_aim(target)
            melee_action_details = {
                'roll': roll,
                'difficulty': difficulty,
                'success': success,
                'removed_weapon_index': removed_weapon_index,
                'transferred_item': (
                    transferred_weapon.get('name')
                    if isinstance(transferred_weapon, dict)
                    else None
                ),
            }

        if action_key == 'melee_shove':
            target_data = target.character.data if target.character else {}
            charge_bonus = (
                3
                if (
                    character.movement_mode_this_turn in {'run', 'sprint'}
                    and (character.movement_distance_this_turn or 0) >= 3
                )
                else 0
            )
            if charge_bonus:
                special_action_cost = 1
            actor_roll = CombatService._opposed_roll(
                data, 'skills.physical.strength'
            )
            actor_roll['total'] += charge_bonus
            defender_roll = CombatService._opposed_roll(
                target_data, 'skills.physical.strength'
            )
            success = (
                actor_roll['critical_success']
                or (
                    not actor_roll['critical_failure']
                    and actor_roll['total'] > defender_roll['total']
                )
            )
            push_distance = 3 if success and actor_roll['total'] - defender_roll['total'] >= 5 else (1 if success else 0)
            moved = 0
            if push_distance:
                dx = 0 if target.pos_x == character.pos_x else (1 if target.pos_x > character.pos_x else -1)
                dy = 0 if target.pos_y == character.pos_y else (1 if target.pos_y > character.pos_y else -1)
                blocked, _ = CombatService._build_movement_map(
                    location, target.character_id
                )
                for step in range(1, push_distance + 1):
                    destination = (target.pos_x + dx, target.pos_y + dy)
                    if (
                        destination in blocked
                        or not (0 <= destination[0] < location.grid_width)
                        or not (0 <= destination[1] < location.grid_height)
                    ):
                        break
                    target.pos_x, target.pos_y = destination
                    moved = step
            melee_action_details = {
                'attacker': actor_roll,
                'defender': defender_roll,
                'charge_bonus': charge_bonus,
                'success': success,
                'distance': moved,
                'target_fell': success,
                'attacker_fell': False,
            }
            if success:
                target.posture = 'prone'
            elif defender_roll['total'] - actor_roll['total'] >= 10:
                dx = 0 if target.pos_x == character.pos_x else (1 if target.pos_x > character.pos_x else -1)
                dy = 0 if target.pos_y == character.pos_y else (1 if target.pos_y > character.pos_y else -1)
                destination = (target.pos_x + dx, target.pos_y + dy)
                blocked, _ = CombatService._build_movement_map(
                    location, character.character_id
                )
                if (
                    destination not in blocked
                    and 0 <= destination[0] < location.grid_width
                    and 0 <= destination[1] < location.grid_height
                ):
                    character.pos_x, character.pos_y = destination
                character.posture = 'prone'
                melee_action_details['attacker_fell'] = True

        if action_key == 'grapple':
            if not CombatService._has_usable_free_hand(character):
                raise ValidationError("At least one free hand is required for a grapple")
            if character.grapple_target_id or character.grappled_by_id:
                raise ValidationError("Character is already in a grapple")
            if target.grapple_target_id or target.grappled_by_id:
                raise ValidationError("Target is already in a grapple")
            target_data = target.character.data if target.character else {}
            paths = (
                ('skills.physical.strength',)
                if attribute_choice == 'strength'
                else (
                    ('skills.physical.agility',)
                    if attribute_choice == 'agility'
                    else ('skills.physical.strength', 'skills.physical.agility')
                )
            )
            behind = CombatService._is_behind(character, target)
            actor_roll = CombatService._opposed_roll(
                data,
                'skills.physical.melee',
                paths,
            )
            if behind:
                extra = random.randint(1, 20)
                actor_roll['rolls'].append(extra)
                actor_roll['roll'] = max(actor_roll['roll'], extra)
                actor_roll['total'] = actor_roll['roll'] + actor_roll['bonus']
            defender_roll = CombatService._opposed_roll(
                target_data,
                'skills.physical.melee',
                ('skills.physical.strength', 'skills.physical.agility'),
            )
            success = (
                actor_roll['critical_success']
                or (
                    not actor_roll['critical_failure']
                    and actor_roll['total'] > defender_roll['total']
                )
            )
            if success:
                character.grapple_target_id = target.id
                target.grappled_by_id = character.id
            melee_action_details = {
                'attacker': actor_roll,
                'defender': defender_roll,
                'from_behind': behind,
                'success': success,
            }

        if action_key in {
            'grapple_escape', 'grapple_release', 'grapple_strengthen',
            'grapple_choke', 'grapple_pain_hold', 'grapple_desperate_attack',
            'grapple_live_shield',
        }:
            holder = (
                LocationCharacter.query.filter_by(
                    id=character.grappled_by_id,
                    location_id=location_id,
                ).first()
                if character.grappled_by_id
                else character
            )
            captive = (
                character
                if character.grappled_by_id
                else LocationCharacter.query.filter_by(
                    id=character.grapple_target_id,
                    location_id=location_id,
                ).first()
            )
            if not holder or not captive or holder.grapple_target_id != captive.id:
                raise ValidationError("Character is not in the required grapple state")
            if action_key == 'grapple_release':
                if holder.id != character.id:
                    raise ValidationError("Only the holder can release the grapple")
                CombatService._clear_grapple(holder, captive)
                melee_action_details = {'released': True}
            elif action_key == 'grapple_escape':
                if captive.id != character.id:
                    raise ValidationError("Only the captive can escape")
                holder_data = holder.character.data if holder.character else {}
                captive_roll = CombatService._opposed_roll(
                    data,
                    'skills.physical.melee',
                    ('skills.physical.strength', 'skills.physical.agility'),
                    disadvantage=bool(holder.grapple_strengthened),
                )
                holder_roll = CombatService._opposed_roll(
                    holder_data,
                    'skills.physical.melee',
                    ('skills.physical.strength', 'skills.physical.agility'),
                )
                success = captive_roll['total'] > holder_roll['total']
                if success:
                    CombatService._clear_grapple(holder, captive)
                melee_action_details = {
                    'captive': captive_roll,
                    'holder': holder_roll,
                    'success': success,
                }
            elif action_key == 'grapple_desperate_attack':
                if captive.id != character.id:
                    raise ValidationError("Only the captive can use a desperate attack")
                target_character_id = holder.character_id
                attack_type = 'grapple_desperate'
                attack_details = {
                    'weapon_index': -1,
                    'attack_type': attack_type,
                    'action_points': 3,
                    'round_number': state.round_number,
                    'target_character_id': holder.character_id,
                    'target_distance': 1,
                    'melee': True,
                    'melee_disadvantage': True,
                    'hit_difficulty': (
                        12 - CombatService._skill_modifier(
                            data, 'skills.physical.melee'
                        )
                    ),
                }
            elif holder.id != character.id:
                raise ValidationError("Only the holder can use this action")
            elif action_key == 'grapple_strengthen':
                holder.grapple_strengthened = True
                melee_action_details = {'strengthened': True}
            elif action_key == 'grapple_live_shield':
                holder.grapple_live_shield = True
                CombatService._sync_grapple_facing(holder, captive)
                melee_action_details = {
                    'live_shield': True,
                    'cover_grade': 'three_quarters',
                }
            elif action_key == 'grapple_choke':
                holder.grapple_choke_rounds = (holder.grapple_choke_rounds or 0) + 1
                captive_data = captive.character.data if captive.character else {}
                will_roll = random.randint(1, 20)
                will_bonus = CombatService._skill_modifier(
                    captive_data, 'skills.physical.will'
                )
                difficulty = 10 + 2 * holder.grapple_choke_rounds
                success = will_roll == 20 or (
                    will_roll != 1 and will_roll + will_bonus >= difficulty
                )
                if not success and captive.character:
                    health = captive_data.setdefault('health', {})
                    apply_effect_to_health(health, {
                        'type': 'unconscious',
                        'name': 'Без сознания',
                        'remaining': random.randint(1, 6) + 1,
                        'duration_unit': 'round',
                        'source': 'grapple_choke',
                    })
                    captive.character.data = captive_data
                    flag_modified(captive.character, 'data')
                melee_action_details = {
                    'roll': will_roll,
                    'bonus': will_bonus,
                    'difficulty': difficulty,
                    'success': success,
                }
            elif action_key == 'grapple_pain_hold':
                captive_data = captive.character.data if captive.character else {}
                will_roll = random.randint(1, 20)
                will_bonus = CombatService._skill_modifier(
                    captive_data, 'skills.physical.will'
                )
                total = will_roll + will_bonus
                failed_by = max(0, 14 - total)
                if failed_by and captive.character:
                    health = captive_data.setdefault('health', {})
                    health.setdefault('combatMeta', {})['injuryRound'] = current_round
                    health['painLevel'] = CombatService._coerce_int(
                        health.get('painLevel'), 0
                    ) + 3
                    if failed_by > 5:
                        apply_effect_to_health(health, {
                            'type': 'fracture',
                            'name': 'Перелом руки',
                            'area': 'arm',
                            'source': 'grapple_pain_hold',
                        })
                    if failed_by > 10:
                        apply_effect_to_health(health, {
                            'type': 'pain_shock',
                            'name': 'Болевой шок',
                            'source': 'grapple_pain_hold',
                        })
                    captive.character.data = captive_data
                    flag_modified(captive.character, 'data')
                melee_action_details = {
                    'roll': will_roll,
                    'bonus': will_bonus,
                    'difficulty': 14,
                    'failed_by': failed_by,
                    'pain_added': 3 if failed_by else 0,
                    'fracture': failed_by > 5,
                    'pain_shock': failed_by > 10,
                }
        if action_key == 'take_cover':
            cover_object = LocationObject.query.filter_by(
                id=target_object_id,
                location_id=location_id,
            ).first()
            if not cover_object:
                raise ValidationError("Cover object not found")
            if not CombatService._is_cover_object(cover_object):
                raise ValidationError("Object cannot be used as cover")
            footprint = CombatService._object_footprint_tiles(cover_object)
            distance = min(
                (
                    max(abs(character.pos_x - tile_x), abs(character.pos_y - tile_y))
                    for tile_x, tile_y in footprint
                ),
                default=999,
            )
            if distance > 1:
                raise ValidationError("Character must be adjacent to cover")
            height = CombatService._object_height(cover_object)
            if height <= 1.05 and CombatService._posture_key(character) == 'standing':
                raise ValidationError("Sit down before taking low cover")
            character.cover_object_id = cover_object.id
            character.weapon_braced = False
            character.braced_weapon_index = None
            cover_details = {
                'occupied': True,
                'object_id': cover_object.id,
                'height': height,
                **CombatService._cover_profile(cover_object),
            }

        if action_key == 'leave_cover':
            character.cover_object_id = None
            character.weapon_braced = False
            character.braced_weapon_index = None
            cover_details = {'occupied': False}

        if action_key == 'brace_weapon':
            if character.drawn_weapon_index is None:
                raise ValidationError("Draw a weapon first")
            cover_object = db.session.get(LocationObject, character.cover_object_id)
            if not cover_object or cover_object.location_id != location_id:
                raise ValidationError("Take cover first")
            payment_key = str(payment or '').lower()
            costs = {
                'action': ('action_points_current', 1),
                'free': ('free_actions_current', 1),
                'movement': ('movement_points_current', 3),
            }
            if payment_key not in costs:
                raise ValidationError("Choose action, free, or movement payment")
            field, cost = costs[payment_key]
            if getattr(character, field) < cost:
                raise ValidationError("Not enough resources")
            setattr(character, field, getattr(character, field) - cost)
            character.weapon_braced = True
            character.braced_weapon_index = character.drawn_weapon_index
            drawn_weapon = (character.data.get('weapons') or [])[character.drawn_weapon_index]
            bipod = next(
                (
                    module for module in (drawn_weapon.get('installedModules') or [])
                    if isinstance(module, dict)
                    and module.get('slotType') == 'handguard'
                    and (
                        module.get('bipod')
                        or (module.get('attributes') or {}).get('bipod')
                        or module.get('name') == 'Сошки'
                    )
                ),
                None,
            )
            brace_ergonomics_bonus = 75 if bipod else 10
            brace_details = {
                'weapon_index': character.drawn_weapon_index,
                'payment': payment_key,
                'cost': cost,
                'accuracy_bonus': 1,
                'ergonomics_bonus': brace_ergonomics_bonus,
            }
        if action_key == 'change_posture':
            target_posture = str(posture or '').lower()
            options = CombatService._posture_change_options(character, target_posture)
            selected_payment = str(payment or 'movement').lower()
            selected = next(
                (option for option in options if option['resource'] == selected_payment),
                None,
            )
            if not selected:
                raise ValidationError("Invalid posture payment method")
            if selected_payment == 'movement':
                if character.movement_points_current < selected['cost']:
                    raise ValidationError("Not enough movement points")
                character.movement_points_current -= selected['cost']
            else:
                if character.action_points_current < selected['cost']:
                    raise ValidationError("Not enough action points")
                character.action_points_current -= selected['cost']
            source_posture = CombatService._posture_key(character)
            character.posture = target_posture
            character.weapon_braced = False
            character.braced_weapon_index = None
            if target_posture == 'standing' and character.cover_object_id:
                occupied_cover = db.session.get(LocationObject, character.cover_object_id)
                if occupied_cover and CombatService._object_height(occupied_cover) <= 1.05:
                    character.cover_object_id = None
            posture_details = {
                'from': source_posture,
                'to': target_posture,
                **selected,
            }

        if action_key == 'draw_weapon':
            weapons = (character.character.data or {}).get('weapons') or []
            weapon_index = CombatService._coerce_int(weapon_index, -1)
            if weapon_index < 0 or weapon_index >= len(weapons):
                raise ValidationError("Weapon not found")
            ergonomics_profile = CombatService._weapon_ergonomics_profile(
                character,
                weapons[weapon_index],
                weapon_index,
            )
            draw_cost = ergonomics_profile['draw_action_points']
            if character.action_points_current < draw_cost:
                raise ValidationError("Not enough action points")
            character.action_points_current -= draw_cost
            CombatService._set_active_weapon(character, weapon_index)
            CombatService._clear_aim(character)
            draw_details = {
                'weapon_index': weapon_index,
                'action_points': draw_cost,
                'ergonomics': ergonomics_profile,
            }

        if action_key == 'reload_weapon':
            weapons = (character.character.data or {}).get('weapons') or []
            weapon_index = CombatService._coerce_int(weapon_index, -1)
            if weapon_index < 0 or weapon_index >= len(weapons):
                raise ValidationError("Weapon not found")
            magazine_template = db.session.get(
                ItemTemplate,
                CombatService._coerce_int(magazine_template_id, 0),
            )
            if not magazine_template or magazine_template.category != 'magazine':
                raise ValidationError("Magazine not found")
            magazine_attributes = (
                magazine_template.attributes
                if isinstance(magazine_template.attributes, dict)
                else {}
            )
            candidate_weapon = dict(weapons[weapon_index] or {})
            candidate_weapon['installedMagazine'] = {
                'templateId': magazine_template.id,
                'ergonomics': magazine_attributes.get('ergonomics', 0),
            }
            ergonomics_profile = CombatService._weapon_ergonomics_profile(
                character,
                candidate_weapon,
                weapon_index,
            )
            base_reload_cost = max(
                0,
                CombatService._coerce_int(magazine_attributes.get('reload_time_od'), 0),
            )
            reload_cost = max(
                0,
                base_reload_cost + ergonomics_profile['reload_action_points_modifier'],
            )
            retrieval_cost = max(
                0,
                min(20, CombatService._coerce_int(inventory_retrieval_action_points, 0)),
            )
            use_discount = max(
                0,
                min(20, CombatService._coerce_int(inventory_use_action_discount, 0)),
            )
            reload_cost = max(0, reload_cost - use_discount) + retrieval_cost
            special_action_cost = reload_cost
            reload_details = {
                'weapon_index': weapon_index,
                'magazine_template_id': magazine_template.id,
                'base_action_points': base_reload_cost,
                'ergonomics_modifier': ergonomics_profile['reload_action_points_modifier'],
                'inventory_retrieval_action_points': retrieval_cost,
                'inventory_use_action_discount': use_discount,
                'action_points': reload_cost,
            }

        if action_key == 'clear_weapon_jam':
            weapons = (character.character.data or {}).get('weapons') or []
            weapon_index = CombatService._coerce_int(weapon_index, -1)
            if weapon_index < 0 or weapon_index >= len(weapons):
                raise ValidationError("Weapon not found")
            if character.drawn_weapon_index != weapon_index:
                raise ValidationError("Draw this weapon first")
            weapon = weapons[weapon_index] or {}
            CombatService._weapon_durability(weapon)
            jam = weapon.get('jam')
            if not isinstance(jam, dict):
                raise ValidationError("Weapon is not jammed")
            if jam.get('repair_required'):
                raise ValidationError("This malfunction requires weapon repair")
            shooting = CombatService._skill_value(data, 'skills.physical.shooting')
            reduction = 2 if shooting >= 20 else (1 if shooting >= 15 else 0)
            clear_cost = max(0, CombatService._coerce_int(jam.get('fix_ap'), 0) - reduction)
            special_action_cost = clear_cost
            clear_jam_details = {
                'weapon_index': weapon_index,
                'result': jam.get('result'),
                'label': jam.get('label'),
                'base_action_points': CombatService._coerce_int(jam.get('fix_ap'), 0),
                'skill_reduction': reduction,
                'action_points': clear_cost,
            }

        if action_key == 'aim':
            weapons = (character.character.data or {}).get('weapons') or []
            weapon_index = CombatService._coerce_int(weapon_index, -1)
            if weapon_index < 0 or weapon_index >= len(weapons):
                raise ValidationError("Weapon not found")
            if character.drawn_weapon_index != weapon_index:
                raise ValidationError("Draw this weapon first")
            target = LocationCharacter.query.filter_by(
                location_id=location_id,
                character_id=target_character_id,
            ).first()
            if not target or target.id == character.id:
                raise ValidationError("Aim target not found")
            aim_details = {
                'weapon_index': weapon_index,
                'target_character_id': target_character_id,
                'accuracy_bonus': (
                    CombatService._coerce_int(character.aim_accuracy_bonus, 0) + 1
                    if character.aimed_target_character_id == target_character_id
                    and character.aimed_weapon_index == weapon_index
                    else 1
                ),
            }

        if action_key == 'attack' and not fire_mode:
            weapons = (character.character.data or {}).get('weapons') or []
            attack_type_key = str(attack_type or '').strip().lower().replace('ё', 'е')
            circular_attack = 'круг' in attack_type_key
            melee_targets = []
            if circular_attack:
                selected_ids = list(dict.fromkeys(target_character_ids or []))
                if not selected_ids and target_character_id:
                    selected_ids = [target_character_id]
                if not 1 <= len(selected_ids) <= 3:
                    raise ValidationError("A circular attack requires 1 to 3 targets")
                target_lookup = {
                    item.character_id: item
                    for item in LocationCharacter.query.filter(
                        LocationCharacter.location_id == location_id,
                        LocationCharacter.character_id.in_(selected_ids),
                    ).all()
                }
                melee_targets = [
                    target_lookup[target_id]
                    for target_id in selected_ids
                    if target_id in target_lookup
                ]
                if (
                    len(melee_targets) != len(selected_ids)
                    or any(target.id == character.id for target in melee_targets)
                ):
                    raise ValidationError("Circular attack target not found")
                if any(
                    not CombatService._is_adjacent(character, target)
                    for target in melee_targets
                ):
                    raise ValidationError("All circular attack targets must be adjacent")
                target = melee_targets[0]
                target_character_id = target.character_id
                target_character_ids = selected_ids
            else:
                if not target_character_id:
                    raise ValidationError("Target character is required")
                target = LocationCharacter.query.filter_by(
                    location_id=location_id,
                    character_id=target_character_id,
                ).first()
                if not target or target.id == character.id:
                    raise ValidationError("Target character not found")
                melee_targets = [target]
            weapon_index = CombatService._coerce_int(weapon_index, -1)
            weapon = {}
            if attack_type_key == 'unarmed':
                weapon_index = -1
            else:
                if weapon_index < 0 or weapon_index >= len(weapons):
                    raise ValidationError("Weapon not found")
                weapon = weapons[weapon_index] or {}
                if weapon_index != character.drawn_weapon_index:
                    raise ValidationError("Draw this weapon first")
                if attack_type_key == 'firearm_butt':
                    template = (
                        db.session.get(ItemTemplate, weapon.get('templateId'))
                        if weapon.get('templateId') else None
                    )
                    if template and template.category != 'weapon':
                        raise ValidationError("Only a firearm can use a butt attack")
            distance = max(abs(character.pos_x - target.pos_x), abs(character.pos_y - target.pos_y))
            if not circular_attack and distance != 1:
                raise ValidationError("Melee target must be in an adjacent tile")
            character.facing_x = 0 if target.pos_x == character.pos_x else (1 if target.pos_x > character.pos_x else -1)
            character.facing_y = 0 if target.pos_y == character.pos_y else (1 if target.pos_y > character.pos_y else -1)
            profile = (
                CombatService._virtual_melee_profile(
                    attack_type_key,
                    weapon,
                    character.character.data or {},
                )
                or CombatService._weapon_damage_profile(weapon, attack_type)
            )
            melee_bonus = CombatService._skill_modifier(
                character.character.data or {}, 'skills.physical.melee'
            )
            accuracy = CombatService._coerce_int(profile.get('accuracy'), 0)
            aimed_melee = str(payment or '').strip().lower() == 'aimed'
            if circular_attack and aimed_melee:
                raise ValidationError("A circular attack cannot be aimed")
            swing_prepared = character.melee_swing_round == current_round
            if aimed_melee and not swing_prepared:
                raise ValidationError("Prepare a swing before an aimed melee attack")
            if aimed_melee and target_zone not in HIT_ZONES:
                raise ValidationError("Choose a valid body part for an aimed melee attack")
            behind = CombatService._is_behind(character, target)
            block_penalty = max(
                0,
                CombatService._coerce_int(target.melee_block_effectiveness, 0),
            )
            aimed_penalty = 4 if aimed_melee and target_zone == 'head' else (2 if aimed_melee else 0)
            hit_difficulty = (
                (8 - melee_bonus * 2 if behind else 12 - melee_bonus)
                + block_penalty
                + aimed_penalty
                + (3 if circular_attack else 0)
                - accuracy
            )
            melee_cost = CombatService._melee_action_cost(profile, attack_type_key)
            attack_details = {
                'weapon_index': weapon_index,
                'attack_type': attack_type,
                'action_points': melee_cost,
                'round_number': state.round_number,
                'target_character_id': target_character_id,
                'target_character_ids': target_character_ids if circular_attack else None,
                'target_distance': distance,
                'melee': True,
                'circular_attack': circular_attack,
                'hit_difficulty': hit_difficulty,
                'aimed_melee': aimed_melee,
                'from_behind': behind,
                'block_penalty': block_penalty,
                'aimed_penalty': aimed_penalty,
                'swing_bonus': swing_prepared,
                'melee_advantage': bool(target.grappled_by_id),
                'melee_bonus': melee_bonus,
                'weapon_accuracy': accuracy,
            }

        if action_key == 'attack' and fire_mode:
            if fire_mode not in {'unaimed', 'rapid', 'aimed', 'burst', 'suppression', 'area'}:
                raise ValidationError("Unknown fire mode")
            weapons = (character.character.data or {}).get('weapons') or []
            weapon_index = CombatService._coerce_int(weapon_index, -1)
            if weapon_index < 0 or weapon_index >= len(weapons):
                raise ValidationError("Weapon not found")
            if character.drawn_weapon_index != weapon_index:
                raise ValidationError("Draw this weapon first")
            weapon = weapons[weapon_index] or {}
            CombatService._weapon_durability(weapon)
            active_jam = weapon.get('jam') if isinstance(weapon.get('jam'), dict) else None
            if active_jam and active_jam.get('blocks_fire'):
                raise ValidationError("Clear the weapon jam before firing")
            if weapon.get('requiresManualCycle'):
                raise ValidationError("Cycle the weapon action before firing")
            profile = weapon.get('fireModes') or (weapon.get('attributes') or {}).get('fire_modes')
            if not profile and weapon.get('templateId'):
                template = db.session.get(ItemTemplate, weapon.get('templateId'))
                profile = (template.attributes or {}).get('fire_modes') if template else None
            profile = profile or {}
            ergonomics_profile = CombatService._weapon_ergonomics_profile(
                character,
                weapon,
                weapon_index,
            )
            strength_profile = CombatService._weapon_strength_profile(
                character,
                weapon,
            )
            shots = max(1, CombatService._coerce_int(shot_count, 1))
            volley_count = CombatService._coerce_int(volley_count, 1)
            single_options = profile.get('single_shot_options') or [1]
            supports_burst = bool(profile.get('supports_burst'))
            machine_gun = bool(profile.get('machine_gun_burst'))
            burst_size = CombatService._coerce_int(profile.get('burst_size'), 0)

            single_fire = fire_mode in {'unaimed', 'rapid', 'aimed'}
            requested_action_points = CombatService._coerce_int(action_points, 0)
            expected_action_points = {
                'unaimed': 1 if CombatService._is_pistol_weapon(weapon) else 2,
                'rapid': 1,
                'aimed': ergonomics_profile['aimed_shot_action_points'],
                'burst': 3,
                'area': 5,
            }.get(fire_mode)
            if fire_mode == 'suppression':
                if requested_action_points not in {3, 5}:
                    raise ValidationError("Suppression costs 3 or 5 action points")
                expected_action_points = requested_action_points
            if requested_action_points != expected_action_points:
                raise ValidationError("Invalid action point cost")
            allowed_volley_counts = {1}
            if fire_mode == 'area' or (
                fire_mode == 'suppression' and expected_action_points == 5
            ):
                allowed_volley_counts = {1, 2}
            if volley_count not in allowed_volley_counts:
                raise ValidationError("Invalid volley count")
            if fire_mode == 'rapid' and character.rapid_fire_round == state.round_number:
                raise ValidationError("Rapid fire can only be used once per turn")
            if fire_mode == 'aimed' and (
                character.aimed_target_character_id != target_character_id or
                character.aimed_weapon_index != weapon_index
            ):
                raise ValidationError("Aiming is required before an aimed shot")
            if fire_mode == 'aimed' and target_zone not in HIT_ZONES:
                raise ValidationError("Choose a valid body part for an aimed shot")
            if single_fire and shots not in single_options:
                raise ValidationError("Unsupported single-fire option")
            if not single_fire and not supports_burst:
                raise ValidationError("Weapon does not support automatic fire")
            if not single_fire and not machine_gun and shots != burst_size * volley_count:
                raise ValidationError("Invalid burst size")
            if not single_fire and machine_gun and (
                shots < 2 * volley_count or shots % volley_count != 0
            ):
                raise ValidationError("Invalid machine gun burst size")
            target_object = None
            if fire_mode == 'suppression':
                target_object = LocationObject.query.filter_by(
                    id=target_object_id,
                    location_id=location_id,
                ).first()
                if not target_object:
                    raise ValidationError("Cover object is required")
            elif fire_mode == 'area':
                target_character_ids = list(dict.fromkeys(target_character_ids or []))
                if not 1 <= len(target_character_ids) <= 3:
                    raise ValidationError("Area fire requires 1 to 3 targets")
                targets = LocationCharacter.query.filter(
                    LocationCharacter.location_id == location_id,
                    LocationCharacter.character_id.in_(target_character_ids),
                ).all()
                if len(targets) != len(target_character_ids):
                    raise ValidationError("Area fire target not found")
                area_center_x = CombatService._coerce_int(area_center_x, -1)
                area_center_y = CombatService._coerce_int(area_center_y, -1)
                if not (
                    0 <= area_center_x < location.grid_width and
                    0 <= area_center_y < location.grid_height
                ):
                    raise ValidationError("Area fire center is invalid")
                if any(
                    abs(target.pos_x - area_center_x) > 2 or abs(target.pos_y - area_center_y) > 2
                    for target in targets
                ):
                    raise ValidationError("Area fire targets must fit inside a 5 by 5 area")
            elif not target_character_id:
                target_object = LocationObject.query.filter_by(
                    id=target_object_id,
                    location_id=location_id,
                ).first()
                if not target_object or not CombatService._is_cover_object(target_object):
                    raise ValidationError("Target character or cover is required")

            magazine = weapon.get('installedMagazine') or {}
            ammo_stacks = magazine.get('ammo')
            if isinstance(ammo_stacks, list):
                available_ammo = sum(
                    max(0, CombatService._coerce_int(stack.get('quantity'), 0))
                    for stack in ammo_stacks
                    if isinstance(stack, dict)
                )
            else:
                available_ammo = max(0, CombatService._coerce_int(weapon.get('ammo'), 0))
            if available_ammo < shots:
                raise ValidationError("Not enough ammo")
            range_target = None
            if target_character_id:
                range_target = LocationCharacter.query.filter_by(
                    location_id=location_id,
                    character_id=target_character_id,
                ).first()
            target_distance = (
                max(
                    abs(character.pos_x - range_target.pos_x),
                    abs(character.pos_y - range_target.pos_y),
                )
                if range_target
                else (
                    max(
                        abs(character.pos_x - target_object.tile_x),
                        abs(character.pos_y - target_object.tile_y),
                    )
                    if target_object else None
                )
            )
            weapon_range = CombatService._coerce_int(
                weapon.get('range', (weapon.get('attributes') or {}).get('range')),
                0,
            )
            accuracy_in_range = bool(
                target_distance is not None
                and weapon_range > 0
                and target_distance <= weapon_range
            )
            attack_details = {
                'weapon_index': weapon_index,
                'fire_mode': fire_mode,
                'shot_count': shots,
                'volley_count': volley_count,
                'action_points': expected_action_points,
                'round_number': state.round_number,
                'target_character_id': target_character_id,
                'target_character_ids': target_character_ids,
                'target_object_id': target_object_id,
                'direct_cover_attack': bool(target_object and not target_character_id),
                'area_center_x': area_center_x,
                'area_center_y': area_center_y,
                'posture': CombatService._posture_key(character),
                'posture_shooting_bonus': POSTURES[CombatService._posture_key(character)]['shooting_bonus'],
                'posture_ergonomics_bonus': POSTURES[CombatService._posture_key(character)]['ergonomics_bonus'],
                'shooter_movement_mode': character.movement_mode_this_turn,
                'ergonomics': ergonomics_profile,
                'strength_requirement': strength_profile,
                'target_distance': target_distance,
                'weapon_range': weapon_range,
                'ergonomics_accuracy_applied': (
                    ergonomics_profile['accuracy_modifier']
                    if accuracy_in_range
                    else 0
                ),
                'shooting_roll_modifier': CombatService._health_roll_modifier(
                    data,
                    'skills.physical.shooting',
                ),
                'shooting_disadvantage': CombatService._has_roll_disadvantage(
                    data,
                    'skills.physical.shooting',
                ) or bool(active_jam and active_jam.get('shooting_disadvantage')),
                'weapon_jam_before_shot': deepcopy(active_jam),
                'weapon_jam_accuracy_penalty': max(
                    0, CombatService._coerce_int(
                        active_jam.get('accuracy_penalty') if active_jam else 0, 0
                    )
                ),
                'aim_accuracy_bonus': CombatService._aim_bonus_for_target(
                    character,
                    target_character_id,
                    weapon_index,
                ),
                'weapon_braced': bool(
                    character.weapon_braced
                    and character.braced_weapon_index == weapon_index
                ),
                'brace_accuracy_bonus': (
                    1
                    if character.weapon_braced and character.braced_weapon_index == weapon_index
                    else 0
                ),
                'brace_ergonomics_bonus': (
                    75
                    if any(
                        isinstance(module, dict)
                        and module.get('slotType') == 'handguard'
                        and (
                            module.get('bipod')
                            or (module.get('attributes') or {}).get('bipod')
                            or module.get('name') == 'Сошки'
                        )
                        for module in (weapon.get('installedModules') or [])
                    )
                    and (
                        character.posture == 'prone'
                        or (
                            character.weapon_braced
                            and character.braced_weapon_index == weapon_index
                        )
                    )
                    else (
                        10
                        if character.weapon_braced and character.braced_weapon_index == weapon_index
                        else 0
                    )
                ),
            }
            shooting_bonus = CombatService._skill_modifier(
                data, 'skills.physical.shooting'
            )
            weapon_accuracy = CombatService._coerce_int(
                weapon.get('accuracy', (weapon.get('attributes') or {}).get('accuracy')), 0
            )
            hit_difficulty = 12 - shooting_bonus - weapon_accuracy
            hit_difficulty += CombatService._equipment_accuracy_penalty(data)
            hit_difficulty += strength_profile['accuracy_penalty']
            hit_difficulty += attack_details['weapon_jam_accuracy_penalty']
            hit_difficulty -= attack_details['ergonomics_accuracy_applied']
            hit_difficulty -= attack_details['posture_shooting_bonus']
            hit_difficulty += CombatService._coerce_int(
                attack_details['aim_accuracy_bonus'] * -1, 0
            )
            if attack_details['shooter_movement_mode'] in {'run', 'sprint'}:
                hit_difficulty += 2
            elif attack_details['shooter_movement_mode'] == 'walk':
                hit_difficulty += 0
            if range_target and range_target.movement_mode_this_turn in {'run', 'sprint'}:
                hit_difficulty += 2
            if target_distance is not None and weapon_range and target_distance > weapon_range:
                hit_difficulty += 2
            if range_target:
                cover_analysis = CombatService._cover_analysis(
                    location_id,
                    character,
                    range_target,
                )
                if not cover_analysis['targetable']:
                    cover_analysis['blind_fire'] = True
                    cover_analysis['targetable'] = True
                    attack_details['shooting_disadvantage'] = True
                attack_details['cover'] = cover_analysis
                hit_difficulty += cover_analysis.get('accuracy_penalty', 0)
                if range_target.grapple_live_shield and range_target.grapple_target_id:
                    live_shield = CombatService._live_shield_target(range_target)
                    previous_penalty = cover_analysis.get('accuracy_penalty', 0)
                    live_shield_zones = [
                        zone for zone in HIT_ZONES if zone != 'head'
                    ]
                    cover_analysis.update({
                        'grade': 'three_quarters',
                        'blocked_zones': list(dict.fromkeys(
                            list(cover_analysis.get('blocked_zones') or [])
                            + live_shield_zones
                        )),
                        'accuracy_penalty': max(2, previous_penalty),
                        'disadvantage': True,
                        'targetable': True,
                        'live_shield': True,
                        'live_shield_character_id': (
                            live_shield.character_id if live_shield else None
                        ),
                    })
                    hit_difficulty += max(0, 2 - previous_penalty)
                    attack_details['shooting_disadvantage'] = True
            if fire_mode == 'aimed':
                hit_difficulty += CombatService._aimed_zone_difficulty_penalty(target_zone)
            if target_object and not target_character_id:
                attack_details['continuation_hit_difficulty'] = max(1, hit_difficulty)
            attack_details['hit_difficulty'] = max(1, hit_difficulty)
            attack_details['target_zone'] = target_zone if fire_mode == 'aimed' else None

        if action_key == 'convert_free_action_to_movement':
            gain = max(0, DEFAULT_CONVERSION_BASE - CombatService._movement_penalty(character))
            if character.free_actions_current >= 1:
                character.free_actions_current -= 1
            elif character.action_points_current >= 2:
                character.action_points_current -= 2
            else:
                raise ValidationError("Not enough action points")
            character.movement_points_max += gain
            character.movement_points_current += gain
            CombatService._clear_aim(character)
        elif action_key == 'change_posture':
            CombatService._clear_aim(character)
        elif action_key == 'draw_weapon':
            pass
        elif action_key == 'stow_weapon':
            CombatService._set_active_weapon(character, None)
            CombatService._clear_aim(character)
        else:
            action_point_cost = (
                special_action_cost
                if special_action_cost is not None
                else (
                    attack_details['action_points']
                    if action_key == 'attack' and attack_details
                    else action['action_points']
                )
            )
            if not resumed_paid_action and character.action_points_current < action_point_cost:
                if not pending_action_id:
                    raise ValidationError("Not enough action points")
                paid_action_points = max(0, character.action_points_current)
                character.action_points_current = 0
                combat_meta['pendingAction'] = {
                    'id': str(pending_action_id),
                    'label': str(action.get('label') or action_key),
                    'total_action_points': action_point_cost,
                    'remaining_action_points': action_point_cost - paid_action_points,
                }
                combat_meta.pop('completedPendingActionId', None)
                character.character.data = data
                flag_modified(character.character, 'data')
                character.last_action = db.func.now()
                db.session.commit()
                ended_state = CombatService.end_turn(
                    location_id,
                    user_id,
                    location_character_id=character.id,
                )
                return {
                    'character': CombatService._serialize_character(
                        character,
                        current_turn_id=ended_state.get('current_location_character_id'),
                    ),
                    'state': ended_state,
                    'action': action_key,
                    'pending_action': True,
                    'pending_action_id': str(pending_action_id),
                    'attack': None,
                    'aim': None,
                    'posture_change': None,
                    'draw_weapon': None,
                    'reload_weapon': None,
                    'clear_weapon_jam': None,
                    'cover': None,
                    'brace_weapon': None,
                    'melee_action': None,
                }
            if not resumed_paid_action:
                character.action_points_current -= action_point_cost
            if action_key == 'clear_weapon_jam' and clear_jam_details:
                weapons = data.get('weapons') or []
                cleared_weapon = weapons[clear_jam_details['weapon_index']]
                cleared_weapon.pop('jam', None)
                character.character.data = data
                flag_modified(character.character, 'data')
            if action_key == 'attack' and attack_details and fire_mode == 'rapid':
                character.rapid_fire_round = state.round_number
            if action_key == 'aim' and aim_details:
                character.aimed_target_character_id = aim_details['target_character_id']
                character.aimed_weapon_index = aim_details['weapon_index']
                character.aim_accuracy_bonus = aim_details['accuracy_bonus']
            elif action_key == 'attack' and attack_details:
                if attack_details.get('melee') and attack_details.get('swing_bonus'):
                    character.melee_swing_round = None
                selected_target = attack_details.get('target_character_id')
                if (
                    selected_target != character.aimed_target_character_id
                    or weapon_index != character.aimed_weapon_index
                ):
                    CombatService._clear_aim(character)
            else:
                CombatService._clear_aim(character)

        if attack_details:
            if attack_details.get('melee'):
                if attack_details.get('circular_attack'):
                    circular_targets = [
                        LocationCharacter.query.filter_by(
                            location_id=location_id,
                            character_id=target_id,
                        ).first()
                        for target_id in (attack_details.get('target_character_ids') or [])
                    ]
                    for target in (item for item in circular_targets if item):
                        target_details = dict(attack_details)
                        target_details['target_character_id'] = target.character_id
                        target_details['from_behind'] = CombatService._is_behind(
                            character,
                            target,
                        )
                        target_details['block_penalty'] = max(
                            0,
                            CombatService._coerce_int(
                                target.melee_block_effectiveness,
                                0,
                            ),
                        )
                        target_details['melee_advantage'] = bool(target.grappled_by_id)
                        target_details['hit_difficulty'] = (
                            (
                                8 - target_details['melee_bonus'] * 2
                                if target_details['from_behind']
                                else 12 - target_details['melee_bonus']
                            )
                            + target_details['block_penalty']
                            + 3
                            - target_details['weapon_accuracy']
                        )
                        resolved_hits.append(CombatService._resolve_attack(
                            target,
                            character,
                            target_details,
                            melee=True,
                            attack_type=attack_type,
                        ))
                else:
                    target = LocationCharacter.query.filter_by(
                        location_id=location_id,
                        character_id=attack_details['target_character_id'],
                    ).first()
                    resolved_hits.append(CombatService._resolve_attack(
                        target, character, attack_details,
                        melee=True,
                        attack_type=attack_type,
                        aimed_zone=target_zone,
                    ))
                if (
                    action_key == 'grapple_desperate_attack'
                    and resolved_hits[-1].get('hit')
                    and resolved_hits[-1].get('damage', 0) >= 10
                    and target.character
                ):
                    target_data = target.character.data if isinstance(target.character.data, dict) else {}
                    health = target_data.setdefault('health', {})
                    health['painLevel'] = CombatService._coerce_int(
                        health.get('painLevel'), 0
                    ) + 3
                    target.character.data = target_data
                    flag_modified(target.character, 'data')
            elif fire_mode not in {'suppression'}:
                targets = []
                if attack_details.get('direct_cover_attack'):
                    cover = db.session.get(
                        LocationObject, attack_details.get('target_object_id')
                    )
                    if cover:
                        for _ in range(max(1, attack_details.get('shot_count', 1))):
                            resolved_hits.append(CombatService._resolve_cover_attack(
                                location_id, cover, character, attack_details
                            ))
                elif fire_mode == 'area':
                    targets = [
                        LocationCharacter.query.filter_by(
                            location_id=location_id, character_id=target_id
                        ).first()
                        for target_id in (target_character_ids or [])
                    ]
                    targets = [item for item in targets if item]
                else:
                    target = LocationCharacter.query.filter_by(
                        location_id=location_id,
                        character_id=target_character_id,
                    ).first()
                    if target:
                        targets = [target]
                if attack_details.get('direct_cover_attack'):
                    pass
                elif fire_mode == 'area':
                    primary = targets[0] if targets else None
                    if primary:
                        first = CombatService._resolve_attack(
                            primary, character, attack_details, aimed_zone=target_zone
                        )
                        resolved_hits.append(first)
                        if first.get('hit'):
                            extra_hits = min(2, max(0, (first['roll'] - first['difficulty']) // 4))
                            for index in range(extra_hits):
                                target = targets[(index + 1) % len(targets)]
                                resolved_hits.append(CombatService._resolve_attack(
                                    target, character, attack_details,
                                    aimed_zone=target_zone, forced_roll=20
                                ))
                else:
                    resolved_hits.extend(CombatService._resolve_shot_sequence(
                        targets,
                        character,
                        attack_details,
                        aimed_zone=target_zone,
                        share_hit_roll=(
                            single_fire and attack_details['shot_count'] > 1
                        ),
                    ))
            attack_details['results'] = resolved_hits
            attack_details['hits'] = sum(1 for item in resolved_hits if item.get('hit'))
            attack_details['damage_total'] = sum(
                item.get('combined_damage', item.get('damage', 0))
                for item in resolved_hits
            )
            if attack_details.get('circular_attack'):
                health = data.setdefault('health', {})
                health.setdefault('combatMeta', {})['circularAttackRound'] = current_round
                character.character.data = data
                flag_modified(character.character, 'data')
            elif not attack_details.get('melee'):
                health = data.setdefault('health', {})
                health.setdefault('combatMeta', {})['firedRound'] = current_round
                character.character.data = data
                flag_modified(character.character, 'data')

            weapon_index_for_wear = CombatService._coerce_int(
                attack_details.get('weapon_index'), -1
            )
            weapons = data.get('weapons') if isinstance(data.get('weapons'), list) else []
            if 0 <= weapon_index_for_wear < len(weapons):
                used_weapon = weapons[weapon_index_for_wear]
                if attack_details.get('melee'):
                    if str(attack_details.get('attack_type') or '').strip().lower() == 'firearm_butt':
                        attack_details['weapon_wear'] = CombatService._weapon_use_wear(
                            used_weapon, butt=True
                        )
                else:
                    ammo_profile, _ = CombatService._ranged_damage_profile(used_weapon)
                    previous_jam = used_weapon.get('jam') if isinstance(used_weapon.get('jam'), dict) else None
                    CombatService._consume_weapon_ammo(
                        used_weapon, attack_details.get('shot_count', 1)
                    )
                    attack_details['weapon_wear'] = CombatService._weapon_use_wear(
                        used_weapon,
                        fire_mode=attack_details.get('fire_mode'),
                        shot_count=attack_details.get('shot_count', 1),
                        volley_count=attack_details.get('volley_count', 1),
                        ammo_profile=ammo_profile,
                    )
                    if previous_jam and previous_jam.get('extra_wear_per_shot'):
                        extra_loss = (
                            CombatService._coerce_int(previous_jam.get('extra_wear_per_shot'), 0)
                            * CombatService._coerce_int(attack_details.get('shot_count'), 1)
                        )
                        attack_details['spring_wear'] = CombatService._apply_weapon_wear(
                            used_weapon, extra_loss
                        )
                    attack_details['weapon_jam'] = CombatService._roll_weapon_jam(used_weapon)
                    if CombatService._manual_cycle_type(used_weapon):
                        used_weapon['requiresManualCycle'] = True
                    attack_details['ammo_remaining'] = CombatService._coerce_int(
                        used_weapon.get('ammo'), 0
                    )
                character.character.data = data
                flag_modified(character.character, 'data')

        CombatService._release_invalid_grapples(location_id)
        if resumed_paid_action:
            combat_meta.pop('completedPendingActionId', None)
            character.character.data = data
            flag_modified(character.character, 'data')
        character.last_action = db.func.now()
        db.session.commit()
        if action_key == 'recover_from_shock':
            ended_state = CombatService.end_turn(
                location_id,
                user_id,
                location_character_id=character.id,
            )
            return {
                'character': CombatService._serialize_character(
                    character,
                    current_turn_id=ended_state.get('current_location_character_id'),
                ),
                'state': ended_state,
                'action': action_key,
                'attack': None,
                'aim': None,
                'posture_change': None,
                'draw_weapon': None,
                'reload_weapon': None,
                'clear_weapon_jam': None,
                'cover': None,
                'brace_weapon': None,
                'melee_action': melee_action_details,
            }
        return {
            'character': CombatService._serialize_character(character, current_turn_id=state.current_location_character_id),
            'state': CombatService._serialize_state(location, state),
            'action': action_key,
            'attack': attack_details,
            'aim': aim_details,
            'posture_change': posture_details,
            'draw_weapon': draw_details,
            'reload_weapon': reload_details,
            'clear_weapon_jam': clear_jam_details,
            'cover': cover_details,
            'brace_weapon': brace_details,
            'melee_action': melee_action_details,
        }

    @staticmethod
    def move_character(
        location_id,
        user_id,
        character_id,
        new_x,
        new_y,
        special_action=None,
        object_id=None,
        climb_mode=None,
        movement_mode=None,
    ):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
        CombatService._release_invalid_grapples(location_id)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        character = LocationCharacter.query.filter_by(
            character_id=character_id,
            location_id=location_id,
        ).order_by(
            LocationCharacter.last_action.desc().nullslast(),
            LocationCharacter.id.desc(),
        ).first()
        if not character:
            raise NotFoundError("Character not in location")

        if not is_gm and character.controlled_by not in (None, user_id):
            raise PermissionDenied("Permission denied")
        CombatService.ensure_character_can_act(character)
        if character.grappled_by_id:
            raise ValidationError("A grappled character cannot move independently")

        grapple_captive = (
            LocationCharacter.query.filter_by(
                id=character.grapple_target_id,
                location_id=location_id,
            ).first()
            if character.grapple_target_id
            else None
        )
        if character.grapple_target_id and not grapple_captive:
            character.grapple_target_id = None
            character.grapple_strengthened = False
            character.grapple_choke_rounds = 0
            character.grapple_live_shield = False

        if state and state.status == 'active' and not is_gm and state.current_location_character_id != character.id:
            raise PermissionDenied("It is not this character's turn")

        if special_action == 'climb':
            if grapple_captive:
                raise ValidationError("A character cannot climb while holding a grapple")
            if CombatService._posture_key(character) != 'standing':
                raise ValidationError("Stand up before climbing")
            climb_object = None
            if object_id is not None:
                climb_object = LocationObject.query.filter_by(
                    id=object_id,
                    location_id=location_id,
                ).first()
            if not climb_object:
                raise NotFoundError("Object not found")

            landing = CombatService._find_climb_landing(location, climb_object, character)
            if not landing:
                raise ValidationError("No landing tile")

            profile = CombatService._object_movement_profile(climb_object)
            climb_cost = max(1, profile.get('climb_cost') or 0)
            ap_cost = 3 if climb_cost >= 12 else 1

            if state and state.status == 'active':
                if character.movement_points_current >= climb_cost:
                    character.movement_points_current -= climb_cost
                elif character.action_points_current >= ap_cost:
                    character.action_points_current -= ap_cost
                else:
                    raise ValidationError("Not enough movement points")

            character.pos_x, character.pos_y = landing
            CombatService._clear_aim(character)
            character.last_action = db.func.now()
            CombatService._apply_periodic_health_effects(character, phase='movement_end')
            CombatService._sync_location_effects_from_character(character)
            db.session.commit()
            state_payload = CombatService._serialize_state(location, state) if state else None
            return character, climb_cost, state_payload

        try:
            new_x = int(new_x)
            new_y = int(new_y)
        except (TypeError, ValueError):
            raise ValidationError("Invalid coordinates")

        if not (0 <= new_x < location.grid_width and 0 <= new_y < location.grid_height):
            raise ValidationError("Out of bounds")

        companion_offset = (
            (
                grapple_captive.pos_x - character.pos_x,
                grapple_captive.pos_y - character.pos_y,
            )
            if grapple_captive
            else None
        )
        ignored_character_ids = (
            [character.character_id, grapple_captive.character_id]
            if grapple_captive
            else None
        )
        path = CombatService._find_movement_path(
            location,
            character.pos_x,
            character.pos_y,
            new_x,
            new_y,
            character.character_id,
            ignored_character_ids=ignored_character_ids,
            companion_offset=companion_offset,
        )
        if not path:
            raise ValidationError("Path is blocked")

        cost = path['cost']
        climb_cost = path.get('climb_cost', 0)
        if state and state.status == 'active':
            movement_mode = str(movement_mode or '').lower()
            mode = MOVEMENT_MODES.get(movement_mode)
            if not mode:
                raise ValidationError("Choose a movement mode")
            posture = CombatService._posture_key(character)
            posture_profile = CombatService._validate_posture_movement(posture, movement_mode)

            current_round = max(1, state.round_number or 1)
            if CombatService._strenuous_movement_is_blocked(
                character, movement_mode, current_round
            ):
                raise ValidationError("Running and sprinting are blocked by exhaustion")
            character_data = (
                character.character.data
                if character.character and isinstance(character.character.data, dict)
                else {}
            )
            CombatService._validate_equipment_movement(character_data, movement_mode)
            if (
                movement_mode == 'sprint'
                and CombatService._disabled_limb_penalties(character_data)['sprint_blocked']
            ):
                raise ValidationError("Sprinting is unavailable with a disabled leg")

            route_cost = CombatService._movement_route_cost(path, movement_mode, posture)
            distance = route_cost['distance']
            movement_cost = route_cost['movement_points']
            if distance <= 0:
                return character, 0, CombatService._serialize_state(location, state)

            used_mode = character.movement_mode_this_turn
            if used_mode and used_mode != movement_mode:
                raise ValidationError("Movement modes cannot be mixed in one turn")
            selecting_mode = not used_mode
            mode_action_points = mode['action_points'] if selecting_mode else 0
            mode_free_actions = mode['free_actions'] if selecting_mode else 0
            if movement_mode == 'correction':
                used_distance = character.correction_distance_this_turn or 0
            else:
                used_distance = character.movement_distance_this_turn or 0

            max_distance = (
                posture_profile['walk_max_distance']
                if movement_mode == 'walk'
                else mode['max_distance']
            )
            if used_distance + distance > max_distance:
                raise ValidationError(
                    f"{mode['label']} distance is limited to {max_distance} meters per turn"
                )
            if character.action_points_current < mode_action_points:
                raise ValidationError("Not enough action points")
            if character.free_actions_current < mode_free_actions:
                raise ValidationError("Not enough free actions")

            if movement_cost <= character.movement_points_current:
                character.movement_points_current -= movement_cost
            elif (
                route_cost['climb_cost'] > 0
                and character.movement_points_current >= movement_cost - route_cost['climb_cost']
            ):
                ap_cost = 3 if route_cost['climb_cost'] >= 10 else 1
                if character.action_points_current < mode_action_points + ap_cost:
                    raise ValidationError("Not enough movement points")
                character.movement_points_current -= movement_cost - route_cost['climb_cost']
                character.action_points_current -= ap_cost
            else:
                raise ValidationError("Not enough movement points")

            character.action_points_current -= mode_action_points
            character.free_actions_current -= mode_free_actions
            if movement_mode == 'correction':
                character.movement_mode_this_turn = movement_mode
                character.correction_distance_this_turn = used_distance + distance
            else:
                character.movement_mode_this_turn = movement_mode
                character.movement_distance_this_turn = used_distance + distance

            if movement_mode == 'run':
                character.strenuous_movement_blocked_until_round = max(
                    character.strenuous_movement_blocked_until_round or 0,
                    current_round + 1,
                )
            elif movement_mode == 'sprint':
                character.strenuous_movement_blocked_until_round = max(
                    character.strenuous_movement_blocked_until_round or 0,
                    current_round + 2,
                )
            cost = movement_cost

        previous_x, previous_y = character.pos_x, character.pos_y
        character.pos_x = new_x
        character.pos_y = new_y
        if grapple_captive and companion_offset:
            grapple_captive.pos_x = new_x + companion_offset[0]
            grapple_captive.pos_y = new_y + companion_offset[1]
            grapple_captive.cover_object_id = None
            grapple_captive.weapon_braced = False
            grapple_captive.braced_weapon_index = None
            CombatService._clear_aim(grapple_captive)
        path_tiles = path.get('path') or []
        if len(path_tiles) >= 2:
            before_x, before_y = path_tiles[-2]
            character.facing_x = 0 if new_x == before_x else (1 if new_x > before_x else -1)
            character.facing_y = 0 if new_y == before_y else (1 if new_y > before_y else -1)
        elif new_x != previous_x or new_y != previous_y:
            character.facing_x = 0 if new_x == previous_x else (1 if new_x > previous_x else -1)
            character.facing_y = 0 if new_y == previous_y else (1 if new_y > previous_y else -1)
        CombatService._sync_grapple_facing(character)
        character.cover_object_id = None
        character.weapon_braced = False
        character.braced_weapon_index = None
        CombatService._clear_aim(character)
        character.last_action = db.func.now()
        CombatService._apply_periodic_health_effects(character, phase='movement_end')
        CombatService._sync_location_effects_from_character(character)
        db.session.commit()

        state_payload = CombatService._serialize_state(location, state) if state else None
        return character, cost, state_payload

    @staticmethod
    def end_combat(location_id, user_id):
        location = CombatService._get_location(location_id)
        CombatService._ensure_access(location, user_id)
        if location.lobby.gm_id != user_id:
            raise PermissionDenied("Only GM can end combat")

        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state:
            raise ValidationError("Combat is not active")

        state.status = 'idle'
        state.round_number = 0
        state.turn_index = 0
        state.turn_order = []
        state.current_location_character_id = None

        loc_chars = LocationCharacter.query.filter_by(location_id=location_id).all()
        for loc_char in loc_chars:
            loc_char.initiative_roll = None
            loc_char.initiative_total = None
            loc_char.movement_points_current = 0
            loc_char.movement_mode_this_turn = None
            loc_char.movement_distance_this_turn = 0
            loc_char.correction_distance_this_turn = 0
            loc_char.strenuous_movement_blocked_until_round = 0
            loc_char.melee_swing_round = None
            loc_char.melee_block_round = None
            loc_char.melee_block_effectiveness = 0
            loc_char.grapple_target_id = None
            loc_char.grappled_by_id = None
            loc_char.grapple_strengthened = False
            loc_char.grapple_choke_rounds = 0
            loc_char.grapple_live_shield = False
            CombatService._set_active_weapon(loc_char, loc_char.drawn_weapon_index)
            CombatService._clear_aim(loc_char)
            character = getattr(loc_char, 'character', None)
            if character and isinstance(character.data, dict):
                data = character.data
                for weapon in data.get('weapons') or []:
                    if isinstance(weapon, dict):
                        weapon.pop('_usedInCurrentCombat', None)
                health = data.get('health') if isinstance(data.get('health'), dict) else {}
                meta = health.setdefault('combatMeta', {})
                for key in ('consumableModifiers', 'bleedingModifiers'):
                    values = meta.get(key)
                    if isinstance(values, list):
                        meta[key] = [value for value in values if not (
                            isinstance(value, dict)
                            and (value.get('scope') == 'combat' or value.get('note') == 'hematogen')
                        )]
                effects = normalize_effect_list(health.get('effects') or [])
                untreated = [effect for effect in effects if effect.get('type') == 'untreated_wound']
                meta['untreatedWoundsAfterCombat'] = len(untreated)
                health['effects'] = [
                    effect for effect in effects
                    if effect.get('scope') != 'combat' and effect.get('type') != 'shock'
                ]
                meta.pop('shockRecoveryRound', None)
                meta.pop('painShockRecoveredRound', None)
                meta.pop('painShockRecovered', None)
                meta.pop('firedRound', None)
                meta.pop('injuryRound', None)
                sync_health_derived_statuses(health)
                data['health'] = health
                character.data = data
                flag_modified(character, 'data')
            CombatService._sync_location_effects_from_character(loc_char)

        db.session.commit()
        return CombatService._serialize_state(location, state)
