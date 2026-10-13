# app/services/map.py
import logging
import copy
import math
import re
from app.extensions import db
from app.models import MapChunk, Lobby, LobbyParticipant
from app.constants import CHUNK_SIZE
from app.services.world_generation import generated_world_tile
from app.services.world_travel_events import PROTECTED_BUILDING_TYPES
from app.services.exceptions import ConflictError, NotFoundError, PermissionDenied, ValidationError

logger = logging.getLogger(__name__)

class MapService:
    @staticmethod
    def edit_world_object(lobby_id, gm_id, payload):
        """Update one object, optionally moving it between tiles in one commit."""
        lobby = db.session.get(Lobby, lobby_id)
        if not lobby:
            raise NotFoundError('Lobby not found')
        if lobby.gm_id != gm_id:
            raise PermissionDenied('Only GM can edit world objects')
        if not isinstance(payload, dict):
            raise ValidationError('Expected world object edit data')
        source = payload.get('source')
        target = payload.get('target')
        changes = payload.get('changes')
        if not isinstance(source, dict) or not isinstance(target, dict) or not isinstance(changes, dict):
            raise ValidationError('Source, target and changes are required')

        def position(data):
            x, y = data.get('tile_x'), data.get('tile_y')
            if (type(x) is not int or type(y) is not int
                    or not 0 <= x < lobby.chunks_width * CHUNK_SIZE
                    or not 0 <= y < lobby.chunks_height * CHUNK_SIZE):
                raise ValidationError('World object tile is outside the map')
            return x, y

        source_x, source_y = position(source)
        target_x, target_y = position(target)
        index = source.get('index')
        if type(index) is not int or index < 0:
            raise ValidationError('Invalid world object index')
        allowed = {'name', 'type', 'color', 'x', 'z', 'scale', 'rotation', 'is_active'}
        if set(changes) - allowed:
            raise ValidationError('Unsupported world object property')

        def get_chunk(x, y, create=False):
            cx, cy = x // CHUNK_SIZE, y // CHUNK_SIZE
            chunk = MapChunk.query.filter_by(lobby_id=lobby_id, chunk_x=cx, chunk_y=cy).first()
            if not chunk and create:
                chunk = MapChunk(
                    lobby_id=lobby_id, chunk_x=cx, chunk_y=cy,
                    data=MapService._generate_chunk_data(lobby_id, cx, cy, lobby.map_type),
                )
                db.session.add(chunk)
            return chunk

        source_chunk = get_chunk(source_x, source_y)
        if not source_chunk:
            raise NotFoundError('Source world tile not found')
        source_data = copy.deepcopy(source_chunk.data)
        source_tile = source_data[source_y % CHUNK_SIZE][source_x % CHUNK_SIZE]
        objects = source_tile.get('objects') or []
        if index >= len(objects) or not isinstance(objects[index], dict):
            raise ConflictError('World object changed; reopen its tile')
        original = objects[index]
        if original != payload.get('expected'):
            raise ConflictError('World object changed; reopen its tile')
        edited = copy.deepcopy(original)
        if 'name' in changes:
            name = changes['name']
            if not isinstance(name, str) or len(name.strip()) > 100:
                raise ValidationError('Invalid world object name')
            if name.strip():
                edited['name'] = name.strip()
            else:
                edited.pop('name', None)
        if 'type' in changes:
            kind = changes['type']
            allowed_types = {'tree', 'forest', 'road', 'hamlet', 'village', 'factory',
                             'base', 'camp', 'house', 'fence'}
            if kind not in allowed_types or original.get('type') == 'anomaly':
                raise ValidationError('This world object type cannot be changed')
            edited['type'] = kind
        if 'color' in changes:
            color = changes['color']
            if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
                raise ValidationError('Invalid world object color')
            edited['color'] = color
        for key, lower, upper in (('x', -0.5, 0.5), ('z', -0.5, 0.5),
                                  ('scale', 0.2, 2.0), ('rotation', 0, 359)):
            if key in changes:
                value = changes[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lower <= value <= upper:
                    raise ValidationError(f'Invalid world object {key}')
                edited[key] = value
        if 'is_active' in changes:
            if type(changes['is_active']) is not bool:
                raise ValidationError('Invalid world object is_active')
            if edited.get('type') not in PROTECTED_BUILDING_TYPES and changes['is_active']:
                raise ValidationError('Only a building can have a protected zone')
            edited['is_active'] = changes['is_active']
        edited.pop('is_major', None)
        if edited.get('type') not in PROTECTED_BUILDING_TYPES:
            edited.pop('is_active', None)
        if edited.get('type') != 'road' or (source_x, source_y) != (target_x, target_y):
            edited.pop('connections', None)
            edited.pop('manual_connections', None)

        if (source_x, source_y) == (target_x, target_y):
            objects[index] = edited
            source_tile['objects'] = objects
            source_chunk.data = source_data
            updates = [{'chunk_x': source_x // CHUNK_SIZE, 'chunk_y': source_y // CHUNK_SIZE,
                        'tile_x': source_x % CHUNK_SIZE, 'tile_y': source_y % CHUNK_SIZE,
                        'updates': {'objects': objects}}]
            target_index = index
        else:
            objects.pop(index)
            source_tile['objects'] = objects
            target_chunk = get_chunk(target_x, target_y, create=True)
            target_data = source_data if target_chunk is source_chunk else copy.deepcopy(target_chunk.data)
            target_tile = target_data[target_y % CHUNK_SIZE][target_x % CHUNK_SIZE]
            target_objects = list(target_tile.get('objects') or [])
            target_index = len(target_objects)
            target_objects.append(edited)
            target_tile['objects'] = target_objects
            source_chunk.data = source_data
            target_chunk.data = target_data
            updates = [
                {'chunk_x': source_x // CHUNK_SIZE, 'chunk_y': source_y // CHUNK_SIZE,
                 'tile_x': source_x % CHUNK_SIZE, 'tile_y': source_y % CHUNK_SIZE,
                 'updates': {'objects': objects}},
                {'chunk_x': target_x // CHUNK_SIZE, 'chunk_y': target_y // CHUNK_SIZE,
                 'tile_x': target_x % CHUNK_SIZE, 'tile_y': target_y % CHUNK_SIZE,
                 'updates': {'objects': target_objects}},
            ]
        db.session.commit()
        return {'updates': updates, 'index': target_index}

    @staticmethod
    def get_tile_data(lobby_id, tile_x, tile_y):
        """Return a world tile without generating or modifying its chunk."""
        if tile_x < 0 or tile_y < 0:
            return {}
        chunk = MapChunk.query.filter_by(
            lobby_id=lobby_id,
            chunk_x=tile_x // CHUNK_SIZE,
            chunk_y=tile_y // CHUNK_SIZE,
        ).first()
        if not chunk or not isinstance(chunk.data, list):
            return {}
        local_x = tile_x % CHUNK_SIZE
        local_y = tile_y % CHUNK_SIZE
        try:
            tile = chunk.data[local_y][local_x]
        except (IndexError, TypeError):
            return {}
        return tile if isinstance(tile, dict) else {}

    @staticmethod
    def _validate_chunk_bounds(lobby, min_x, max_x, min_y, max_y):
        if min_x > max_x or min_y > max_y:
            raise ValidationError("Invalid chunk bounds")

        max_allowed_x = lobby.chunks_width - 1
        max_allowed_y = lobby.chunks_height - 1
        if min_x < 0 or min_y < 0 or max_x > max_allowed_x or max_y > max_allowed_y:
            raise ValidationError(
                f"Chunk bounds must be within 0-{max_allowed_x} for x and 0-{max_allowed_y} for y"
            )

    @staticmethod
    def _get_world_bounds(lobby):
        return (
            lobby.chunks_width * CHUNK_SIZE - 1,
            lobby.chunks_height * CHUNK_SIZE - 1,
        )

    @staticmethod
    def get_chunks(lobby_id, user_id, bounds):
        """
        Возвращает чанки в заданных границах.
        bounds: (min_x, max_x, min_y, max_y)
        """
        participant = LobbyParticipant.query.filter_by(
            lobby_id=lobby_id, user_id=user_id
        ).first()
        if not participant:
            raise PermissionDenied("Not in lobby")

        lobby = Lobby.query.get(lobby_id)
        if not lobby:
            raise NotFoundError("Lobby not found")

        min_x, max_x, min_y, max_y = bounds
        MapService._validate_chunk_bounds(lobby, min_x, max_x, min_y, max_y)
        result = []
        for cx in range(min_x, max_x + 1):
            for cy in range(min_y, max_y + 1):
                chunk = MapChunk.query.filter_by(
                    lobby_id=lobby_id, chunk_x=cx, chunk_y=cy
                ).first()
                if not chunk:
                    data = MapService._generate_chunk_data(lobby_id, cx, cy, lobby.map_type)
                    chunk = MapChunk(lobby_id=lobby_id, chunk_x=cx, chunk_y=cy, data=data)
                    db.session.add(chunk)
                    logger.debug(f"Generated new chunk ({cx},{cy}) for lobby {lobby_id}")
                result.append({
                    'chunk_x': chunk.chunk_x,
                    'chunk_y': chunk.chunk_y,
                    'data': chunk.data
                })
        db.session.commit()
        return result

    @staticmethod
    def update_tile(lobby_id, gm_id, chunk_x, chunk_y, tile_x, tile_y, updates):
        """Обновление одного тайла (только GM)."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby:
            raise NotFoundError("Lobby not found")
        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can edit tiles")
        if not (0 <= chunk_x < lobby.chunks_width and 0 <= chunk_y < lobby.chunks_height):
            raise ValidationError("Chunk coordinates are outside the lobby bounds")

        if not (0 <= tile_x < CHUNK_SIZE and 0 <= tile_y < CHUNK_SIZE):
            raise ValidationError(f"Tile coordinates must be 0-{CHUNK_SIZE-1}")

        chunk = MapChunk.query.filter_by(
            lobby_id=lobby_id, chunk_x=chunk_x, chunk_y=chunk_y
        ).first()
        if not chunk:
            chunk = MapChunk(
                lobby_id=lobby_id,
                chunk_x=chunk_x,
                chunk_y=chunk_y,
                data=MapService._generate_chunk_data(lobby_id, chunk_x, chunk_y, lobby.map_type)
            )
            db.session.add(chunk)
            logger.debug(f"Created new chunk ({chunk_x},{chunk_y}) for tile update")

        # Глубокая копия данных
        new_data = copy.deepcopy(chunk.data)
        for key, value in updates.items():
            new_data[tile_y][tile_x][key] = value
        chunk.data = new_data
        db.session.commit()
        logger.info(f"Tile ({tile_x},{tile_y}) in chunk ({chunk_x},{chunk_y}) updated by GM {gm_id}: {updates}")
        return chunk

    @staticmethod
    def batch_update_tiles(lobby_id, gm_id, updates_list):
        """Пакетное обновление тайлов."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby:
            raise NotFoundError("Lobby not found")
        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can edit tiles")

        # Группировка по чанкам
        updates_by_chunk = {}
        for item in updates_list:
            cx, cy = item['chunk_x'], item['chunk_y']
            if not (0 <= cx < lobby.chunks_width and 0 <= cy < lobby.chunks_height):
                raise ValidationError("Chunk coordinates are outside the lobby bounds")
            key = (cx, cy)
            if key not in updates_by_chunk:
                updates_by_chunk[key] = []
            updates_by_chunk[key].append(item)

        for (cx, cy), items in updates_by_chunk.items():
            chunk = MapChunk.query.filter_by(lobby_id=lobby_id, chunk_x=cx, chunk_y=cy).first()
            if not chunk:
                chunk = MapChunk(
                    lobby_id=lobby_id,
                    chunk_x=cx,
                    chunk_y=cy,
                    data=MapService._generate_chunk_data(lobby_id, cx, cy, lobby.map_type)
                )
                db.session.add(chunk)

            new_data = copy.deepcopy(chunk.data)
            for item in items:
                tx, ty = item['tile_x'], item['tile_y']
                updates = item['updates']
                if 0 <= tx < CHUNK_SIZE and 0 <= ty < CHUNK_SIZE:
                    for key, value in updates.items():
                        new_data[ty][tx][key] = value
            chunk.data = new_data

        db.session.commit()
        logger.info(f"Batch updated {len(updates_list)} tiles in lobby {lobby_id} by GM {gm_id}")

    @staticmethod
    def connect_roads(lobby_id, gm_id, first, second):
        """Add a GM-authored edge without replacing either road's automatic exits."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby:
            raise NotFoundError("Lobby not found")
        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can edit roads")
        if (not isinstance(first, (list, tuple)) or not isinstance(second, (list, tuple))
                or len(first) != 2 or len(second) != 2):
            raise ValidationError("Invalid road coordinates")
        if not all(isinstance(value, int) and not isinstance(value, bool)
                   for value in (*first, *second)):
            raise ValidationError("Invalid road coordinates")
        x1, y1 = first
        x2, y2 = second
        dx, dy = x2 - x1, y2 - y1
        directions = {
            (1, 0): ('E', 'W'), (-1, 0): ('W', 'E'),
            (0, 1): ('S', 'N'), (0, -1): ('N', 'S'),
            (1, 1): ('SE', 'NW'), (-1, -1): ('NW', 'SE'),
            (1, -1): ('NE', 'SW'), (-1, 1): ('SW', 'NE'),
        }
        if (dx, dy) not in directions:
            raise ValidationError("Roads must be on adjacent tiles")
        if not all(0 <= x < lobby.chunks_width * CHUNK_SIZE
                   and 0 <= y < lobby.chunks_height * CHUNK_SIZE
                   for x, y in (first, second)):
            raise ValidationError("Road coordinates are outside the map")

        chunks = {}
        updates = []
        for (x, y), direction in zip((first, second), directions[(dx, dy)]):
            chunk_x, chunk_y = x // CHUNK_SIZE, y // CHUNK_SIZE
            key = (chunk_x, chunk_y)
            if key not in chunks:
                chunk = MapChunk.query.filter_by(
                    lobby_id=lobby_id, chunk_x=chunk_x, chunk_y=chunk_y,
                ).first()
                if not chunk:
                    raise NotFoundError("Map chunk not loaded")
                chunks[key] = (chunk, copy.deepcopy(chunk.data))
            _, data = chunks[key]
            tile_x, tile_y = x % CHUNK_SIZE, y % CHUNK_SIZE
            tile = data[tile_y][tile_x]
            objects = tile.get('objects') or []
            road = next((obj for obj in objects if obj.get('type') == 'road'), None)
            if road is None:
                raise ValidationError("Both tiles must contain roads")
            road['manual_connections'] = sorted(set(road.get('manual_connections') or ()) | {direction})
            updates.append({
                'chunk_x': chunk_x, 'chunk_y': chunk_y,
                'tile_x': tile_x, 'tile_y': tile_y,
                'updates': {'objects': objects},
            })

        for chunk, data in chunks.values():
            chunk.data = data
        db.session.commit()
        return updates

    @staticmethod
    def export_map(lobby_id, gm_id):
        """Экспорт карты в JSON."""
        lobby = Lobby.query.get(lobby_id)
        if not lobby or not lobby.is_active:
            raise NotFoundError("Lobby not found")
        if lobby.gm_id != gm_id:
            raise PermissionDenied("Only GM can export map")

        chunks = MapChunk.query.filter_by(lobby_id=lobby_id).all()
        chunks_data = [{
            'chunk_x': c.chunk_x,
            'chunk_y': c.chunk_y,
            'data': c.data
        } for c in chunks]

        export_data = {
            'lobby_name': lobby.name,
            'map_type': lobby.map_type,
            'chunks_width': lobby.chunks_width,
            'chunks_height': lobby.chunks_height,
            'chunks': chunks_data
        }
        logger.info(f"Map exported for lobby {lobby_id} by GM {gm_id}")
        return export_data

    @staticmethod
    def _generate_chunk_data(lobby_id, chunk_x, chunk_y, map_type):
        """Генерирует данные для нового чанка в зависимости от типа карты."""
        lobby = Lobby.query.get(lobby_id)
        data = []
        for y in range(CHUNK_SIZE):
            row = []
            for x in range(CHUNK_SIZE):
                global_x = chunk_x * CHUNK_SIZE + x
                global_y = chunk_y * CHUNK_SIZE + y

                if map_type in {'random', 'predefined'}:
                    tile = generated_world_tile(
                        lobby_id, global_x, global_y,
                        lobby.chunks_width, lobby.chunks_height, map_type,
                    )
                    row.append(tile)
                    continue
                else:
                    row.append({'terrain': 'grass', 'height': 1.0, 'objects': []})
            data.append(row)
        return data
