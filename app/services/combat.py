import math
import random
import heapq

from app.extensions import db
from app.models import Location, LocationCharacter, LocationCombatState, LobbyParticipant, LobbyCharacter, LocationObject
from app.models.templates import ItemTemplate
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError
from app.services.effects import advance_timed_effects, apply_expired_effects_to_health, apply_periodic_effects_to_health, normalize_character_effects, normalize_effect_list, sync_health_derived_statuses, tick_effects
from sqlalchemy.orm.attributes import flag_modified


DEFAULT_ACTION_POINTS = 5
DEFAULT_FREE_ACTIONS = 1
DEFAULT_MOVEMENT_POINTS = 6
DEFAULT_CONVERSION_BASE = 10

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

        posture = CombatService._posture_key(loc_char)
        posture_bonus = POSTURES[posture]['ergonomics_bonus']
        shooting_value = CombatService._skill_value(data, 'skills.physical.shooting')
        tactics_value = CombatService._skill_value(data, 'skills.other.tactics')
        effective_value = max(
            0,
            weapon_ergonomics
            + shooting_value
            + tactics_value
            + posture_bonus
            + magazine_modifier
            - helmet_penalty,
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

        initiative_bonus = combat_data.get(
            'initiative_bonus',
            data.get('initiative_bonus', loc_char.initiative_bonus or 0),
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
        equipment = data.get('equipment', {}) if isinstance(data, dict) else {}
        armor = equipment.get('armor', {}) if isinstance(equipment, dict) else {}

        armor_penalty = (
            armor.get('movementPenalty')
            if isinstance(armor, dict) else None
        )
        if armor_penalty is None and isinstance(armor, dict):
            armor_penalty = armor.get('movement_penalty')

        weight_penalty = CombatService._inventory_movement_penalty(data)
        temporary_penalty = CombatService._consumable_stat_bonus(data, 'movement_points')
        return max(
            0,
            CombatService._coerce_int(armor_penalty, 0)
            + weight_penalty
            + temporary_penalty,
        )

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
        if not isinstance(character_data, dict):
            return 0
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
        strength_bonus = CombatService._skill_modifier(
            character_data,
            'skills.physical.strength',
        )
        weight_per_penalty = max(0.5, 5 * (1 + strength_bonus * 0.1))
        backpack_reduction = 0
        backpack_template_id = CombatService._coerce_int(inventory.get('backpackModel'), 0)
        if backpack_template_id:
            template = db.session.get(ItemTemplate, backpack_template_id)
            attributes = template.attributes if template and isinstance(template.attributes, dict) else {}
            backpack_reduction = max(
                0,
                CombatService._coerce_int(attributes.get('weight_reduction'), 0),
            )
        return max(
            0,
            math.floor(total_weight / weight_per_penalty) - backpack_reduction,
        )

    @staticmethod
    def _skill_modifier(character_data, skill_path):
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
        return base_mod + CombatService._coerce_int(bonus, 0) + temp_bonus

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
        will_bonus = CombatService._skill_modifier(character_data, 'skills.physical.will')
        roll = random.randint(1, 20)
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
            for key in ('consumableModifiers', 'bleedingModifiers'):
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
                'can_sprint': posture_profile['can_sprint'],
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
    def start_combat(location_id, user_id):
        location = CombatService._get_location(location_id)
        CombatService._ensure_access(location, user_id)
        if location.lobby.gm_id != user_id:
            raise PermissionDenied("Only GM can start combat")

        loc_chars = CombatService._unique_location_characters(
            LocationCharacter.query.filter_by(location_id=location_id).all()
        )
        if not loc_chars:
            raise ValidationError("No characters are present in this location")

        state = CombatService._get_or_create_state(location_id)
        if state.status == 'active':
            raise ValidationError("Combat is already active")

        for loc_char in loc_chars:
            profile = CombatService._combat_profile(loc_char)
            loc_char.initiative_bonus = profile['initiative_bonus']
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
            brace_details = {
                'weapon_index': character.drawn_weapon_index,
                'payment': payment_key,
                'cost': cost,
                'accuracy_bonus': 1,
                'ergonomics_bonus': 10,
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
                'unaimed': 2,
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
                    10
                    if character.weapon_braced and character.braced_weapon_index == weapon_index
                    else 0
                ),
            }
            if range_target:
                cover_analysis = CombatService._cover_analysis(
                    location_id,
                    character,
                    range_target,
                )
                if not cover_analysis['targetable']:
                    raise ValidationError("Target is fully behind cover")
                attack_details['cover'] = cover_analysis

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
