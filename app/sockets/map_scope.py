"""Coordinate validation shared by room tools and persistent local markers."""
import math
from app.extensions import db
from app.models import Location


def map_bounds(lobby, location_id=None):
    if location_id is None:
        return lobby.chunks_width * 32, lobby.chunks_height * 32
    if type(location_id) is not int:
        raise ValueError('Некорректная подлокация')
    location = db.session.get(Location, location_id)
    if not location or location.lobby_id != lobby.id:
        raise ValueError('Подлокация не принадлежит комнате')
    return location.grid_width, location.grid_height


def map_point(value, width, height):
    if not isinstance(value, dict):
        raise ValueError('Некорректная точка')
    values = [value.get(key) for key in ('x', 'y', 'z')]
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
        raise ValueError('Координаты должны быть конечными числами')
    x, y, z = values
    if not (0 <= x < width and 0 <= z < height and -1000 <= y <= 1000):
        raise ValueError('Точка находится за пределами карты')
    return dict(zip(('x', 'y', 'z'), values))


def map_floor(value=0):
    if type(value) is not int or not -100 <= value <= 100:
        raise ValueError('Некорректный этаж')
    return value


def local_marker_scope(lobby, marker):
    location_id = marker.get('location_id')
    if location_id is None:
        return {}
    width, height = map_bounds(lobby, location_id)
    map_point(marker.get('position'), width, height)
    offset = marker.get('surface_offset', 0)
    if type(offset) not in (int, float) or not math.isfinite(offset) or abs(offset) > 1000:
        raise ValueError('Некорректная высота маркера')
    return {'location_id': location_id, 'floor_level': map_floor(marker.get('floor_level', 0)),
            'surface_offset': offset}
