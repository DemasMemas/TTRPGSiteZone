"""Sparse, field-conditional commands for the existing global map storage."""
from copy import deepcopy
from functools import wraps
import inspect as signatures
import math

from flask import make_response, jsonify
from sqlalchemy import event, select, update
from sqlalchemy import inspect

from app.extensions import db
from app.models import MapChunk
from app.services.exceptions import ValidationError, ConflictError
from app.services.location_editor_history import _json_snapshot_matches


def slot(tile, field):
    return {'present': field in tile, **({'value': deepcopy(tile[field])} if field in tile else {})}


def record_world_editor_command(func):
    """Capture authoritative before/after values only on chunks this request writes.

    Existing services replace JSON arrays before flushing. The listener observes
    those writes, including neighboring road cells and nested group operations.
    It never subscribes globally or scans unloaded/unmodified map chunks.
    """
    @wraps(func)
    def wrapped(*args, **kwargs):
        arguments = signatures.signature(func).bind(*args, **kwargs).arguments
        lobby = arguments['lobby']
        session = db.session()
        cells = {}

        def collect(session, flush_context, instances):
            for chunk in set(session.dirty) | set(session.new):
                if not isinstance(chunk, MapChunk) or chunk.lobby_id != lobby.id:
                    continue
                if chunk not in session.new and not inspect(chunk).attrs.data.history.has_changes():
                    continue
                old = session.connection().execute(select(MapChunk.data).where(
                    MapChunk.lobby_id == lobby.id, MapChunk.chunk_x == chunk.chunk_x,
                    MapChunk.chunk_y == chunk.chunk_y)).scalar_one_or_none()
                if old is None:
                    from app.services.map import MapService
                    old = MapService._generate_chunk_data(lobby.id, chunk.chunk_x, chunk.chunk_y, lobby.map_type)
                for z, row in enumerate(chunk.data):
                    for x, tile in enumerate(row):
                        previous = old[z][x]
                        fields = [key for key in set(previous) | set(tile) if slot(previous, key) != slot(tile, key)]
                        if not fields:
                            continue
                        key = (chunk.chunk_x, chunk.chunk_y, x, z)
                        cell = cells.setdefault(key, dict(chunk_x=key[0], chunk_y=key[1], tile_x=x, tile_y=z, before={}, after={}))
                        for field in fields:
                            cell['before'].setdefault(field, slot(previous, field))
                            cell['after'][field] = slot(tile, field)

        event.listen(session, 'before_flush', collect)
        try:
            response = make_response(func(*args, **kwargs))
        finally:
            event.remove(session, 'before_flush', collect)
        if 200 <= response.status_code < 300 and response.is_json:
            payload = response.get_json()
            if isinstance(payload, dict):
                result = []
                for cell in cells.values():
                    fields = [key for key in cell['before'] if cell['before'][key] != cell['after'][key]]
                    if fields:
                        result.append({**cell, 'before': {key: cell['before'][key] for key in fields},
                                       'after': {key: cell['after'][key] for key in fields}})
                payload['command'] = {'objects': [], 'tiles': [], 'cells': result}
                response = make_response(jsonify(payload), response.status_code)
        return response
    return wrapped


def _finite(value):
    if isinstance(value, float) and not math.isfinite(value):
        raise ValidationError('Expected finite map values')
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {'__proto__', 'prototype', 'constructor'}:
                raise ValidationError('Unsafe map key')
            _finite(item)
    elif isinstance(value, list):
        for item in value:
            _finite(item)


def apply_world_editor_command(lobby, payload):
    if not isinstance(payload, dict) or not isinstance(payload.get('cells'), list) or not 0 < len(payload['cells']) <= 10000:
        raise ValidationError('Expected 1–10000 map cells')
    _finite(payload)
    cells = payload['cells']
    keys, coordinates = set(), set()
    for cell in cells:
        if not isinstance(cell, dict):
            raise ValidationError('Invalid map cell')
        values = [cell.get(key) for key in ('chunk_x', 'chunk_y', 'tile_x', 'tile_y')]
        if any(type(v) is not int for v in values):
            raise ValidationError('Expected integer map coordinates')
        cx, cy, x, z = values
        if not (0 <= cx < lobby.chunks_width and 0 <= cy < lobby.chunks_height and 0 <= x < 32 and 0 <= z < 32) or tuple(values) in coordinates:
            raise ValidationError('Invalid or duplicate map cell')
        coordinates.add(tuple(values)); keys.add((cx, cy))
        before, after = cell.get('before'), cell.get('after')
        if not isinstance(before, dict) or not isinstance(after, dict) or not before or before.keys() != after.keys():
            raise ValidationError('Expected matching field snapshots')
        for states in (before, after):
            for state in states.values():
                if (not isinstance(state, dict) or type(state.get('present')) is not bool
                        or set(state) != ({'present', 'value'} if state['present'] else {'present'})):
                    raise ValidationError('Invalid field snapshot')
        for field, state in after.items():
            if field in {'terrain', 'height'} and not state['present']:
                raise ValidationError('Terrain and height are required')
            value = state.get('value')
            if state['present'] and ((field == 'terrain' and not isinstance(value, str))
                    or (field in {'height', 'radiation'} and type(value) not in (int, float))
                    or (field == 'objects' and value is not None and (not isinstance(value, list) or any(not isinstance(o, dict) for o in value)))):
                raise ValidationError('Invalid map field')
            if field == 'water_profile' and state['present']:
                from app.services.water_profiles import validate_water_profile
                validate_water_profile(value)
    chunks, originals, next_data = {}, {}, {}
    for cx, cy in sorted(keys):
        chunk = MapChunk.query.filter_by(lobby_id=lobby.id, chunk_x=cx, chunk_y=cy).populate_existing().with_for_update().first()
        if chunk is None:
            raise ConflictError('Участок карты не загружен. Обновите карту.')
        chunks[cx, cy] = chunk
        originals[cx, cy] = deepcopy(chunk.data)
        next_data[cx, cy] = deepcopy(chunk.data)
    updates = []
    for cell in cells:
        key = cell['chunk_x'], cell['chunk_y']
        tile = next_data[key][cell['tile_y']][cell['tile_x']]
        if any(slot(tile, field) != state for field, state in cell['before'].items()):
            raise ConflictError('Затронутые данные карты изменены другим клиентом. Действие не применено.')
        for field, state in cell['after'].items():
            if state['present']:
                tile[field] = deepcopy(state['value'])
            else:
                tile.pop(field, None)
        updates.append({key: cell[key] for key in ('chunk_x', 'chunk_y', 'tile_x', 'tile_y')} | {'state': deepcopy(tile)})
    dialect = db.session.get_bind().dialect.name
    for key, chunk in chunks.items():
        result = db.session.execute(update(MapChunk).where(MapChunk.lobby_id == lobby.id,
            MapChunk.chunk_x == key[0], MapChunk.chunk_y == key[1],
            _json_snapshot_matches(MapChunk.data, originals[key], dialect)).values(data=next_data[key])
            .execution_options(synchronize_session=False))
        if result.rowcount != 1:
            db.session.rollback()
            raise ConflictError('Карта изменилась во время сохранения. Действие не применено.')
        db.session.expire(chunk, ['data'])
    db.session.commit()
    return {'command': {'objects': [], 'tiles': [], 'cells': deepcopy(cells)}, 'updates': updates}
