import math
import random
import heapq

from app.extensions import db
from app.models import Location, LocationCharacter, LocationCombatState, LobbyParticipant, LobbyCharacter, LocationObject
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError
from app.services.effects import apply_expired_effects_to_health, apply_periodic_effects_to_health, normalize_character_effects, normalize_effect_list, sync_health_derived_statuses, tick_effects
from sqlalchemy.orm.attributes import flag_modified


DEFAULT_ACTION_POINTS = 5
DEFAULT_FREE_ACTIONS = 1
DEFAULT_MOVEMENT_POINTS = 6
DEFAULT_CONVERSION_BASE = 10


ACTION_CATALOG = [
    {'key': 'attack', 'label': 'Атака', 'action_points': 3, 'free_actions': 0, 'movement_points': 0},
    {'key': 'defend', 'label': 'Защита', 'action_points': 2, 'free_actions': 0, 'movement_points': 0},
    {'key': 'use_item', 'label': 'Использовать предмет', 'action_points': 1, 'free_actions': 0, 'movement_points': 0},
    {'key': 'convert_free_action_to_movement', 'label': 'Получить ОП', 'action_points': 2, 'free_actions': 1, 'movement_points': 0},
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

        raw_penalty = (
            armor.get('movementPenalty')
            if isinstance(armor, dict) else None
        )
        if raw_penalty is None and isinstance(armor, dict):
            raw_penalty = armor.get('movement_penalty')
        if raw_penalty is None:
            raw_penalty = data.get('movementPenalty', data.get('movement_penalty', 0))
        return max(0, CombatService._coerce_int(raw_penalty, 0))

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
        data = character.data if character and isinstance(character.data, dict) else {}
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
    def perform_action(location_id, user_id, location_character_id, action_key):
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
        else:
            if character.action_points_current < action['action_points']:
                raise ValidationError("Not enough action points")
            character.action_points_current -= action['action_points']

        character.last_action = db.func.now()
        db.session.commit()
        return {
            'character': CombatService._serialize_character(character, current_turn_id=state.current_location_character_id),
            'state': CombatService._serialize_state(location, state),
            'action': action_key,
        }

    @staticmethod
    def move_character(location_id, user_id, character_id, new_x, new_y, special_action=None, object_id=None, climb_mode=None):
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
            if cost <= character.movement_points_current:
                character.movement_points_current -= cost
            elif climb_cost > 0:
                ap_cost = 3 if climb_cost >= 10 else 1
                if character.action_points_current < ap_cost:
                    raise ValidationError("Not enough movement points")
                character.action_points_current -= ap_cost
            else:
                raise ValidationError("Not enough movement points")

        character.pos_x = new_x
        character.pos_y = new_y
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
