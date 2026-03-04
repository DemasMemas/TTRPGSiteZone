# app/services/map.py
import logging
import copy
import random
from app.extensions import db
from app.models import MapChunk, Lobby, LobbyParticipant
from app.constants import CHUNK_SIZE, MAX_CHUNKS_WIDTH, MAX_CHUNKS_HEIGHT, ANOMALY_TYPES
from app.services.exceptions import NotFoundError, PermissionDenied, ValidationError

logger = logging.getLogger(__name__)

class MapService:
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
        data = []
        for y in range(CHUNK_SIZE):
            row = []
            for x in range(CHUNK_SIZE):
                global_x = chunk_x * CHUNK_SIZE + x
                global_y = chunk_y * CHUNK_SIZE + y

                if map_type == 'empty':
                    terrain = 'grass'
                elif map_type == 'random':
                    r = random.random()
                    if r < 0.4: terrain = 'grass'
                    elif r < 0.6: terrain = 'sand'
                    elif r < 0.8: terrain = 'rock'
                    else: terrain = 'swamp'
                elif map_type == 'predefined':
                    if global_x < 2 or global_x > 511-2 or global_y < 2 or global_y > 511-2:
                        terrain = 'water'
                    else:
                        r = random.random()
                        if r < 0.4: terrain = 'grass'
                        elif r < 0.6: terrain = 'sand'
                        elif r < 0.8: terrain = 'rock'
                        else: terrain = 'swamp'
                else:
                    terrain = 'grass'

                height = 1.0 + random.uniform(-0.1, 0.1)

                objects = []
                if terrain != 'water' and random.random() < 0.2:
                    color = random.choice(['#2d5a27', '#3c6e47', '#1e4d2b'])
                    objects.append({
                        'type': 'tree',
                        'x': round(random.uniform(-0.4, 0.4), 2),
                        'z': round(random.uniform(-0.4, 0.4), 2),
                        'scale': round(random.uniform(0.8, 1.2), 2),
                        'rotation': random.randint(0, 360),
                        'color': color
                    })
                if terrain != 'water' and random.random() < 0.05:
                    color = random.choice(['#8B4513', '#A0522D', '#CD853F', '#D2691E'])
                    objects.append({
                        'type': 'house',
                        'x': round(random.uniform(-0.4, 0.4), 2),
                        'z': round(random.uniform(-0.4, 0.4), 2),
                        'scale': 1.0,
                        'rotation': random.choice([0, 90, 180, 270]),
                        'color': color
                    })
                if terrain != 'water' and random.random() < 0.02:
                    color = random.choice(['#8B5A2B', '#A67B5B', '#6B4F3C'])
                    objects.append({
                        'type': 'fence',
                        'x': round(random.uniform(-0.4, 0.4), 2),
                        'z': round(random.uniform(-0.4, 0.4), 2),
                        'scale': 1.0,
                        'rotation': random.choice([0, 90]),
                        'color': color
                    })
                if terrain != 'water' and random.random() < 0.01:
                    chosen_type = random.choice(ANOMALY_TYPES)
                    color = random.choice(['#00FFFF', '#FF69B4', '#FFD700'])
                    objects.append({
                        'type': 'anomaly',
                        'anomalyType': chosen_type,
                        'x': round(random.uniform(-0.4, 0.4), 2),
                        'z': round(random.uniform(-0.4, 0.4), 2),
                        'scale': round(random.uniform(0.5, 1.0), 2),
                        'rotation': 0,
                        'color': color
                    })

                row.append({
                    'terrain': terrain,
                    'height': round(height, 3),
                    'objects': objects
                })
            data.append(row)
        return data