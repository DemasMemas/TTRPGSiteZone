import math
import random
import heapq
import re

from app.extensions import db
from app.models import Location, LocationCharacter, LocationCombatState, LobbyParticipant, LobbyCharacter, LocationObject
from app.models.templates import ItemTemplate
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError
from app.services.effects import advance_timed_effects, apply_effect_to_health, apply_expired_effects_to_health, apply_periodic_effects_to_health, normalize_character_effects, normalize_effect_list, sync_health_derived_statuses, tick_effects
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
    {'key': 'change_posture', 'label': 'Смена положения', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'defend', 'label': 'Защита', 'action_points': 2, 'free_actions': 0, 'movement_points': 0},
    {'key': 'use_item', 'label': 'Использовать предмет', 'action_points': 1, 'free_actions': 0, 'movement_points': 0},
    {'key': 'convert_free_action_to_movement', 'label': 'Получить ОП', 'action_points': 2, 'free_actions': 1, 'movement_points': 0},
    {'key': 'take_cover', 'label': 'Занять укрытие', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'leave_cover', 'label': 'Покинуть укрытие', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
    {'key': 'brace_weapon', 'label': 'Поставить оружие на упор', 'action_points': 0, 'free_actions': 0, 'movement_points': 0},
]


class CombatService:
    @staticmethod
    def _coerce_int(value, default=0):
        try:
            if value is None:
                return default
            return int(value)
        except (TypeError, ValueError):
            return default

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
        remaining_hp = max(0, profile['hp'] - damage)
        properties = dict(obj.properties or {})
        properties.update({
            'cover_class': profile['class'],
            'cover_max_hp': profile['max_hp'],
            'cover_hp': remaining_hp,
            'cover_base_physical_protection': profile['base_physical_protection'],
            'cover_physical_protection': round(
                profile['base_physical_protection'] * remaining_hp / profile['max_hp']
            ),
        })
        obj.properties = properties
        flag_modified(obj, 'properties')
        destroyed = str(damage_type or '').lower() in {'explosive', 'blast', 'взрывной'} and remaining_hp <= 0
        if destroyed:
            LocationCharacter.query.filter_by(cover_object_id=obj.id).update({
                'cover_object_id': None,
                'weapon_braced': False,
                'braced_weapon_index': None,
            })
            db.session.delete(obj)
        return {'destroyed': destroyed, **CombatService._cover_profile(obj)}

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
        blocked_count = len(blocked)
        if blocked_count == 0:
            grade, accuracy_penalty, disadvantage, targetable = 'none', 0, False, True
        elif blocked_count <= 3:
            grade, accuracy_penalty, disadvantage, targetable = 'half', 2, False, True
        elif blocked_count < len(zone_heights):
            grade, accuracy_penalty, disadvantage, targetable = 'three_quarters', 2, True, True
        else:
            grade, accuracy_penalty, disadvantage, targetable = 'full', 0, False, False
        return {
            'grade': grade,
            'blocked_zones': list(blocked),
            'zones': blocked,
            'accuracy_penalty': accuracy_penalty,
            'disadvantage': disadvantage,
            'targetable': targetable,
        }

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
        return max(0, CombatService._coerce_int(current.get('base'), 0))

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

        armor_penalty = (
            armor.get('movementPenalty')
            if isinstance(armor, dict) else None
        )
        if armor_penalty is None and isinstance(armor, dict):
            armor_penalty = armor.get('movement_penalty')

        weight_details = CombatService._inventory_weight_details(data)
        weight_penalty = weight_details['penalty']
        temporary_penalty = CombatService._consumable_stat_bonus(data, 'movement_points')
        limb_penalty = CombatService._disabled_limb_penalties(data)['movement']
        armor_name = str(armor.get('name') or '').strip().lower() if isinstance(armor, dict) else ''
        armor_attributes = CombatService._template_attributes(armor) if isinstance(armor, dict) else {}
        is_exoskeleton = armor_name == 'экзоскелет' or bool(armor_attributes.get('is_exoskeleton'))
        is_powered = False
        if is_exoskeleton:
            explicit_power = armor.get('powered', armor_attributes.get('powered'))
            battery = next(
                (
                    module for module in armor.get('installedModules', [])
                    if isinstance(module, dict) and module.get('slotType') == 'exoskeleton_battery'
                ),
                None,
            )
            if battery is not None:
                battery_attributes = battery.get('attributes', {})
                remaining_days = CombatService._coerce_float(
                    battery_attributes.get('remaining_days') if isinstance(battery_attributes, dict) else 0,
                    0,
                )
                is_powered = remaining_days > 0
            elif explicit_power is not None and armor.get('requiresExoskeletonBattery') is False:
                is_powered = bool(explicit_power)
            if is_powered:
                armor_penalty = 5
                weight_penalty = 0
        total = max(
            0,
            CombatService._coerce_int(armor_penalty, 0)
            + weight_penalty
            + temporary_penalty
            + limb_penalty,
        )
        return {
            'total': total,
            'armor': CombatService._coerce_int(armor_penalty, 0),
            'weight': weight_penalty,
            'weight_raw': weight_details['raw_penalty'],
            'backpack_reduction': weight_details['backpack_reduction'],
            'weight_per_penalty': weight_details['weight_per_penalty'],
            'total_weight': weight_details['total_weight'],
            'temporary': temporary_penalty,
            'injuries': limb_penalty,
            'powered_exoskeleton': bool(is_exoskeleton and is_powered),
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
        strength = strength if isinstance(strength, dict) else {}
        strength_bonus = (
            math.floor((CombatService._coerce_int(strength.get('base'), 10) - 10) / 2)
            + CombatService._coerce_int(strength.get('bonus'), 0)
            + CombatService._consumable_stat_bonus(character_data, 'strength')
        )
        weight_per_penalty = max(0.5, 5 * (1 + strength_bonus * 0.1))
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
            'strength_bonus': strength_bonus,
        }

    @staticmethod
    def _health_roll_modifier(character_data, skill_path, include_pain=True):
        health = character_data.get('health') if isinstance(character_data, dict) else {}
        if not isinstance(health, dict):
            return 0
        modifier = 0
        if include_pain:
            modifier -= CombatService._coerce_int(health.get('painLevel'), 0)
        exhaustion = CombatService._coerce_int(health.get('exhaustion'), 0)
        modifier -= {1: 1, 2: 2, 3: 4}.get(exhaustion, 6 if exhaustion >= 4 else 0)
        blood_stage = str(health.get('blood') or health.get('bloodStage') or 'normal').lower()
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

        for effect in normalize_effect_list(health.get('effects') or []):
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

        if skill_path == 'skills.physical.will':
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
        disabled_arms = sum(value is not None and value <= 0 for value in (left_arm, right_arm))
        disabled_legs = sum(value is not None and value <= 0 for value in (left_leg, right_leg))
        return {
            'all': 3 if abdomen is not None and abdomen <= 0 else 0,
            'shooting': 3 * disabled_arms,
            'melee': 3 * disabled_arms,
            'agility': 3 * disabled_legs,
            'movement': 3 * disabled_legs,
            'sprint_blocked': disabled_legs > 0,
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
        return {
            'damage': max(0, damage),
            'armor_piercing': penetration,
            'bleeding': bleeding,
            'accuracy': attributes.get('accuracy', weapon.get('accuracy', 0)),
            'effective_range': CombatService._coerce_int(
                attributes.get('effective_range', attributes.get('range', weapon.get('range', 0))), 0
            ),
            'damage_type': attributes.get('damage_type', 'physical'),
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
        return profile, stack

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
            value = protection.get(zone_group, protection.get('physical', 0))
            parsed = max(0.0, min(100.0, CombatService._protection_percent(value, 0)))
            parsed = max(0.0, parsed - CombatService._armor_stage_penalty(item, 'physical'))
            if parsed:
                total = max(total, parsed)
                details.append({
                    'slot': slot,
                    'item': item,
                    'attributes': attrs,
                    'protection': parsed,
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
        }

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
    ):
        character = target.character
        data = dict(character.data or {})
        health = data.setdefault('health', {})
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
        meta = health.setdefault('combatMeta', {})
        current_round = max(0, CombatService._coerce_int(round_number, 0))
        if damage > 0:
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
        if bleeding_result and bleeding_result.get('stage'):
            apply_effect_to_health(health, {
                'type': f"bleeding_external_{bleeding_result['stage']}",
                'area': zone_key,
                'value': 1,
                'source': 'firearm_wound',
            })
        bleeding_type = str(profile.get('bleeding') or '').lower()
        bleeding_map = {'легкое': 'light', 'лёгкое': 'light', 'среднее': 'medium', 'сильное': 'severe', 'экстремальное': 'extreme'}
        stage = next((suffix for label, suffix in bleeding_map.items() if label in bleeding_type), None)
        if stage:
            kind = 'internal' if 'внут' in bleeding_type else 'external'
            apply_effect_to_health(health, {
                'type': f'bleeding_{kind}_{stage}',
                'area': zone_key,
                'value': 1,
                'source': 'combat_attack',
            })
        trauma_chance_roll = None
        trauma_roll = None
        trauma = None
        if damage >= 11:
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
            if trauma_chance_roll >= threshold:
                trauma_roll = random.randint(1, 20)
                trauma_rules = CombatService._trauma_effects(zone, trauma_roll)
                trauma = {
                    'type': 'additional_trauma',
                    'area': zone_key,
                    'chance_roll': trauma_chance_roll,
                    'roll': trauma_roll,
                }
                effects = normalize_effect_list(health.get('effects') or [])
                effects.append(trauma)
                health['effects'] = effects
                if trauma_rules['fracture']:
                    apply_effect_to_health(health, {
                        'type': 'fracture', 'area': zone_key, 'source': 'combat_attack'
                    })
                if trauma_rules['bleeding']:
                    kind, trauma_stage = trauma_rules['bleeding']
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
        sync_health_derived_statuses(health)
        character.data = data
        flag_modified(character, 'data')
        target.hp_zones = health.get('zones') or target.hp_zones
        flag_modified(target, 'hp_zones')
        health['lastTrauma'] = trauma
        return health

    @staticmethod
    def _resolve_attack(target, attacker, attack_details, *, melee=False, attack_type=None, aimed_zone=None, forced_roll=None):
        attacker_data = attacker.character.data if attacker.character and isinstance(attacker.character.data, dict) else {}
        target_data = target.character.data if target.character and isinstance(target.character.data, dict) else {}
        weapon = ((attacker_data.get('weapons') or [])[attack_details['weapon_index']])
        if melee:
            profile = CombatService._weapon_damage_profile(weapon, attack_type)
            skill = CombatService._skill_modifier(attacker_data, 'skills.physical.melee')
            difficulty = 12 - skill - CombatService._parse_percent(profile.get('accuracy', 0), 0)
            rolls = [forced_roll if forced_roll is not None else random.randint(1, 20)]
            if forced_roll is None and CombatService._has_roll_disadvantage(
                attacker_data, 'skills.physical.melee'
            ):
                rolls.append(random.randint(1, 20))
            roll = min(rolls)
            hit = roll == 20 or (roll != 1 and roll >= difficulty)
            result = {
                'roll': roll,
                'rolls': rolls,
                'difficulty': difficulty,
                'hit': hit,
                'mode': 'melee',
            }
            if not hit:
                return result
            zone = CombatService._random_hit_zone(random.randint(1, 6), aimed_zone, melee=True)
            strength_bonus = CombatService._skill_modifier(attacker_data, 'skills.physical.strength')
            profile['damage'] *= max(0, 1 + 0.1 * strength_bonus)
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
            }
            if not hit:
                return result
            zone = CombatService._random_hit_zone(random.randint(1, 20), aimed_zone)
            if attack_details.get('target_distance') is not None and profile.get('effective_range', 0):
                distance_over = max(0, attack_details['target_distance'] - profile['effective_range'])
                if distance_over:
                    profile['damage'] *= max(0.1, 1 - 0.05 * distance_over)
                    profile['armor_piercing'] = max(0, profile['armor_piercing'] - 5 * distance_over)
        armor, armor_layers = CombatService._target_armor(target_data, zone)
        armor_damage = [
            result
            for result in (
                CombatService._damage_armor_item(
                    layer['item'],
                    layer['attributes'],
                    profile['damage'],
                )
                for layer in armor_layers
            )
            if result
        ]
        effective_armor = max(0.0, armor - profile['armor_piercing'])
        penetration_deficit = max(0.0, effective_armor)
        damage_reduction_steps = math.ceil(penetration_deficit / 5) if penetration_deficit else 0
        damage_multiplier = max(0.0, 1 - damage_reduction_steps * 0.25)
        final_damage = max(0, round(profile['damage'] * damage_multiplier))
        bleeding_result = (
            None
            if melee
            else CombatService._roll_firearm_bleeding(profile, armor)
        )
        health = CombatService._apply_attack_damage(
            target,
            final_damage,
            zone,
            profile,
            bleeding_result=bleeding_result,
            round_number=attack_details.get('round_number'),
        )
        result.update({
            'zone': zone,
            'base_damage': profile['damage'],
            'armor': armor,
            'armor_piercing': profile['armor_piercing'],
            'effective_armor': effective_armor,
            'penetration_deficit': penetration_deficit,
            'damage_multiplier': damage_multiplier,
            'damage': final_damage,
            'armor_damage': armor_damage,
            'bleeding_check': bleeding_result,
            'health': health.get('current'),
            'zone_health': (
                health.get('zones') or {}
            ).get({'left_arm': 'leftArm', 'right_arm': 'rightArm', 'left_leg': 'leftLeg', 'right_leg': 'rightLeg'}.get(zone, zone), {}).get('current'),
        })
        return result

    @staticmethod
    def _coerce_float(value, default=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _skill_modifier(character_data, skill_path, include_pain=True):
        current = character_data if isinstance(character_data, dict) else {}
        for part in skill_path.split('.'):
            if not isinstance(current, dict):
                return 0
            current = current.get(part)
        if not isinstance(current, dict):
            base_mod = 0
            bonus = 0
        else:
            base = current.get('base')
            bonus = current.get('bonus', 0)
            base_mod = math.floor((CombatService._coerce_int(base, 10) - 10) / 2)
        temp_bonus = CombatService._consumable_stat_bonus(character_data, skill_path.split('.')[-1])
        return (
            base_mod
            + CombatService._coerce_int(bonus, 0)
            + temp_bonus
            + CombatService._health_roll_modifier(character_data, skill_path, include_pain)
        )

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
        severity = CombatService._coerce_int(bleeding.get('totalSeverity', health.get('bleedingSeverity', 0)), 0)
        if severity <= 0:
            return None

        stage = str(health.get('blood') or health.get('bloodStage') or 'normal').lower()
        stage_penalty = CombatService._coerce_int(bleeding.get('stagePenalty', 0), 0)
        modifier_total = CombatService._bleeding_modifier_total(health)
        will_bonus = CombatService._skill_modifier(character_data, 'skills.physical.will', include_pain=False)
        roll = random.randint(1, 20)
        # Проверка кровопотери не является обычной проверкой Воли и не получает
        # Помеху от пси-состояния.
        disadvantage = False
        total = roll + will_bonus
        difficulty = max(0, 5 + severity - stage_penalty + modifier_total - will_bonus)
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
    def _build_movement_map(location, moving_character_id=None):
        blocked_tiles = set()
        climb_cost_tiles = {}

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
            if moving_character_id is not None and character.character_id == moving_character_id:
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
    def _find_movement_path(location, start_x, start_y, end_x, end_y, moving_character_id=None):
        if start_x == end_x and start_y == end_y:
            return {'cost': 0, 'path': [(start_x, start_y)], 'climb_cost': 0}

        blocked_tiles, climb_cost_tiles = CombatService._build_movement_map(location, moving_character_id)
        width = location.grid_width
        height = location.grid_height

        def in_bounds(x, y):
            return 0 <= x < width and 0 <= y < height

        def step_cost(x, y):
            if (x, y) in blocked_tiles:
                return None
            return 1 + max(0, climb_cost_tiles.get((x, y), 0))

        def heuristic(x, y):
            return max(abs(end_x - x), abs(end_y - y))

        if climb_cost_tiles.get((end_x, end_y), 0) > 0:
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

                if dx and dy:
                    side_a = step_cost(x + dx, y)
                    side_b = step_cost(x, y + dy)
                    if side_a is None or side_b is None:
                        continue

                move_cost = step_cost(nx, ny)
                if move_cost is None:
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
        loc_char.initiative_bonus = profile['initiative_bonus']
        loc_char.action_points_max = profile['action_points']
        loc_char.action_points_current = profile['action_points']
        loc_char.free_actions_max = profile['free_actions']
        loc_char.free_actions_current = profile['free_actions']
        loc_char.movement_points_max = 0
        loc_char.movement_points_current = 0
        loc_char.movement_mode_this_turn = None
        loc_char.movement_distance_this_turn = 0
        loc_char.correction_distance_this_turn = 0
        if getattr(loc_char, 'character', None) and isinstance(loc_char.character.data, dict):
            data = loc_char.character.data
            health = data.get('health') if isinstance(data.get('health'), dict) else {}
            meta = health.setdefault('combatMeta', {})
            meta['consumableUsage'] = {}
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
            'movement_gain': profile['movement_gain'],
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
            'hp_zones': loc_char.hp_zones,
            'effects': loc_char.effects,
            'pain_level': CombatService._coerce_int(health.get('painLevel', 0), 0),
            'exhaustion': CombatService._coerce_int(health.get('exhaustion', 0), 0),
            'stress': CombatService._coerce_int(health.get('stress', 0), 0),
            'radiation': CombatService._coerce_int(health.get('radiation', 0), 0),
            'blood': health.get('blood') or health.get('bloodStage') or 'normal',
            'blood_stage': health.get('bloodStage') or health.get('blood') or 'normal',
            'bleeding_severity': CombatService._coerce_int(health.get('bleedingSeverity', 0), 0),
            'bleeding_difficulty': CombatService._coerce_int(health.get('bleedingDifficulty', 0), 0),
            'bleeding_modifier_total': CombatService._coerce_int(health.get('bleedingModifierTotal', 0), 0),
            'will_bonus': CombatService._skill_modifier(data, 'skills.physical.will'),
            'bleeding': health.get('bleeding', {}),
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
    def end_turn(location_id, user_id, location_character_id=None):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
        state = LocationCombatState.query.filter_by(location_id=location_id).first()
        if not state:
            raise ValidationError("Combat is not active")
        if state.status != 'active':
            raise ValidationError("Combat is not active")
        if not state.turn_order:
            raise ValidationError("Turn order is empty")

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
        if not CombatService._can_end_turn_for_character(current_character, user_id, is_gm=is_gm):
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
        CombatService._tick_character_effects(current_character, phase='turn_end')
        CombatService._apply_periodic_health_effects(current_character, phase='turn_end')
        CombatService._resolve_bleeding_check(current_character)
        CombatService._sync_location_effects_from_character(current_character)
        CombatService._prepare_character_for_turn(next_character)
        CombatService._sync_location_effects_from_character(next_character)
        db.session.commit()

        return CombatService._serialize_state(location, state)

    @staticmethod
    def spend_resources(location_id, user_id, location_character_id, action_points=0, free_actions=0, movement_points=0):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
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

        action_points = max(0, CombatService._coerce_int(action_points, 0))
        free_actions = max(0, CombatService._coerce_int(free_actions, 0))
        movement_points = max(0, CombatService._coerce_int(movement_points, 0))

        if action_points > character.action_points_current:
            raise ValidationError("Not enough action points")
        if free_actions > character.free_actions_current:
            raise ValidationError("Not enough free actions")
        if movement_points > character.movement_points_current:
            raise ValidationError("Not enough movement points")

        character.action_points_current -= action_points
        character.free_actions_current -= free_actions
        character.movement_points_current -= movement_points
        CombatService._clear_aim(character)
        character.last_action = db.func.now()
        db.session.commit()
        return CombatService._serialize_character(
            character,
            current_turn_id=state.current_location_character_id,
        )

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
        action_points = max(-10, min(10, CombatService._coerce_int(action_points, 0)))
        movement_points = max(-50, min(50, CombatService._coerce_int(movement_points, 0)))
        character.action_points_current = max(0, character.action_points_current + action_points)
        character.movement_points_current = max(0, character.movement_points_current + movement_points)
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
    ):
        location = CombatService._get_location(location_id)
        is_gm = CombatService._ensure_access(location, user_id)
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

        action = next((item for item in ACTION_CATALOG if item['key'] == action_key), None)
        if not action:
            raise ValidationError("Unknown action")

        attack_details = None
        aim_details = None
        posture_details = None
        draw_details = None
        reload_details = None
        cover_details = None
        brace_details = None
        resolved_hits = []
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
            if character.action_points_current < reload_cost:
                raise ValidationError("Not enough action points")
            character.action_points_current -= reload_cost
            CombatService._clear_aim(character)
            reload_details = {
                'weapon_index': weapon_index,
                'magazine_template_id': magazine_template.id,
                'base_action_points': base_reload_cost,
                'ergonomics_modifier': ergonomics_profile['reload_action_points_modifier'],
                'inventory_retrieval_action_points': retrieval_cost,
                'inventory_use_action_discount': use_discount,
                'action_points': reload_cost,
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
            if not target_character_id:
                raise ValidationError("Target character is required")
            target = LocationCharacter.query.filter_by(
                location_id=location_id,
                character_id=target_character_id,
            ).first()
            if not target or target.id == character.id:
                raise ValidationError("Target character not found")
            weapon_index = CombatService._coerce_int(weapon_index, -1)
            weapons = (character.character.data or {}).get('weapons') or []
            if weapon_index < 0 or weapon_index >= len(weapons):
                raise ValidationError("Weapon not found")
            weapon = weapons[weapon_index] or {}
            if weapon_index != character.drawn_weapon_index:
                raise ValidationError("Draw this weapon first")
            distance = max(abs(character.pos_x - target.pos_x), abs(character.pos_y - target.pos_y))
            if distance > 2:
                raise ValidationError("Melee target is out of range")
            profile = CombatService._weapon_damage_profile(weapon, attack_type)
            melee_bonus = CombatService._skill_modifier(
                character.character.data or {}, 'skills.physical.melee'
            )
            accuracy = CombatService._coerce_int(profile.get('accuracy'), 0)
            attack_details = {
                'weapon_index': weapon_index,
                'attack_type': attack_type,
                'action_points': 3,
                'round_number': state.round_number,
                'target_character_id': target_character_id,
                'target_distance': distance,
                'melee': True,
                'hit_difficulty': 12 - melee_bonus - accuracy,
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
                raise ValidationError("Target character is required")

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
                else None
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
                'area_center_x': area_center_x,
                'area_center_y': area_center_y,
                'posture': CombatService._posture_key(character),
                'posture_shooting_bonus': POSTURES[CombatService._posture_key(character)]['shooting_bonus'],
                'posture_ergonomics_bonus': POSTURES[CombatService._posture_key(character)]['ergonomics_bonus'],
                'shooter_movement_mode': character.movement_mode_this_turn,
                'ergonomics': ergonomics_profile,
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
                    raise ValidationError("Target is fully behind cover")
                attack_details['cover'] = cover_analysis
                hit_difficulty += cover_analysis.get('accuracy_penalty', 0)
            if fire_mode == 'aimed':
                hit_difficulty += CombatService._aimed_zone_difficulty_penalty(target_zone)
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
        elif action_key == 'reload_weapon':
            pass
        else:
            action_point_cost = (
                attack_details['action_points']
                if action_key == 'attack' and attack_details
                else action['action_points']
            )
            if character.action_points_current < action_point_cost:
                raise ValidationError("Not enough action points")
            character.action_points_current -= action_point_cost
            if action_key == 'attack' and attack_details and fire_mode == 'rapid':
                character.rapid_fire_round = state.round_number
            if action_key == 'aim' and aim_details:
                character.aimed_target_character_id = aim_details['target_character_id']
                character.aimed_weapon_index = aim_details['weapon_index']
                character.aim_accuracy_bonus = aim_details['accuracy_bonus']
            elif action_key == 'attack' and attack_details:
                selected_target = attack_details.get('target_character_id')
                if (
                    selected_target != character.aimed_target_character_id
                    or weapon_index != character.aimed_weapon_index
                ):
                    CombatService._clear_aim(character)
            else:
                CombatService._clear_aim(character)

        if action_key == 'attack' and attack_details:
            if attack_details.get('melee'):
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
            elif fire_mode not in {'suppression'}:
                targets = []
                if fire_mode == 'area':
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
                if fire_mode == 'area':
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
                    for index in range(attack_details['shot_count']):
                        if not targets:
                            break
                        target = targets[index % len(targets)]
                        resolved_hits.append(CombatService._resolve_attack(
                            target, character, attack_details, aimed_zone=target_zone
                        ))
            attack_details['results'] = resolved_hits
            attack_details['hits'] = sum(1 for item in resolved_hits if item.get('hit'))
            attack_details['damage_total'] = sum(item.get('damage', 0) for item in resolved_hits)

        character.last_action = db.func.now()
        db.session.commit()
        return {
            'character': CombatService._serialize_character(character, current_turn_id=state.current_location_character_id),
            'state': CombatService._serialize_state(location, state),
            'action': action_key,
            'attack': attack_details,
            'aim': aim_details,
            'posture_change': posture_details,
            'draw_weapon': draw_details,
            'reload_weapon': reload_details,
            'cover': cover_details,
            'brace_weapon': brace_details,
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

        if state and state.status == 'active' and not is_gm and state.current_location_character_id != character.id:
            raise PermissionDenied("It is not this character's turn")

        if special_action == 'climb':
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

        path = CombatService._find_movement_path(
            location,
            character.pos_x,
            character.pos_y,
            new_x,
            new_y,
            character.character_id,
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
            if (
                movement_mode in {'run', 'sprint'}
                and (character.strenuous_movement_blocked_until_round or 0) >= current_round
            ):
                raise ValidationError("Running and sprinting are blocked by exhaustion")
            character_data = (
                character.character.data
                if character.character and isinstance(character.character.data, dict)
                else {}
            )
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
            if character.action_points_current < mode['action_points']:
                raise ValidationError("Not enough action points")
            if character.free_actions_current < mode['free_actions']:
                raise ValidationError("Not enough free actions")

            if movement_cost <= character.movement_points_current:
                character.movement_points_current -= movement_cost
            elif (
                route_cost['climb_cost'] > 0
                and character.movement_points_current >= movement_cost - route_cost['climb_cost']
            ):
                ap_cost = 3 if route_cost['climb_cost'] >= 10 else 1
                if character.action_points_current < mode['action_points'] + ap_cost:
                    raise ValidationError("Not enough movement points")
                character.movement_points_current -= movement_cost - route_cost['climb_cost']
                character.action_points_current -= ap_cost
            else:
                raise ValidationError("Not enough movement points")

            character.action_points_current -= mode['action_points']
            character.free_actions_current -= mode['free_actions']
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

        character.pos_x = new_x
        character.pos_y = new_y
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
            CombatService._set_active_weapon(loc_char, loc_char.drawn_weapon_index)
            CombatService._clear_aim(loc_char)
            character = getattr(loc_char, 'character', None)
            if character and isinstance(character.data, dict):
                data = character.data
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
                health['effects'] = [effect for effect in effects if effect.get('scope') != 'combat']
                sync_health_derived_statuses(health)
                data['health'] = health
                character.data = data
                flag_modified(character, 'data')
            CombatService._sync_location_effects_from_character(loc_char)

        db.session.commit()
        return CombatService._serialize_state(location, state)
