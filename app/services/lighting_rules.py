"""Gameplay darkness checks for world travel and sublocations."""

import math


def world_is_dark(minutes):
    minute = int(minutes or 0) % 1440
    return minute >= 22 * 60 or minute < 6 * 60


def _number(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _field(obj, key, default=None):
    return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)


def _pose(obj):
    props = _field(obj, 'properties', {}) or {}
    dims = props.get('dimensions') or {}
    defaults = {
        'wall': {'width': 3, 'depth': 0.2, 'height': 2.4},
        'door': {'width': 0.9, 'depth': 0.18, 'height': 2},
        'window': {'width': 1.2, 'depth': 0.14, 'height': 1},
    }.get(_field(obj, 'type'), {'width': 3, 'depth': 0.2, 'height': 2.4})
    angle = _number(props.get('rotation'))
    return {
        'x': _number(_field(obj, 'tile_x')) + 0.5 + _number(props.get('offset_x')),
        'z': _number(_field(obj, 'tile_y')) + 0.5 + _number(props.get('offset_z')),
        'axis': (math.cos(angle), -math.sin(angle)),
        'normal': (math.sin(angle), math.cos(angle)),
        'width': _number(dims.get('width'), defaults['width']),
        'depth': _number(dims.get('depth'), defaults['depth']),
        'height': _number(dims.get('height'), defaults['height']),
        'elevation': _number(props.get('elevation')),
    }


def _opening(portal, wall):
    a, b = _pose(wall), _pose(portal)
    dx, dz = b['x'] - a['x'], b['z'] - a['z']
    parallel = abs(a['axis'][0] * b['axis'][0] + a['axis'][1] * b['axis'][1])
    along = dx * a['axis'][0] + dz * a['axis'][1]
    away = abs(dx * a['normal'][0] + dz * a['normal'][1])
    bottom = b['elevation'] - a['elevation']
    vertical = (
        0 <= bottom and bottom + b['height'] <= a['height'] + 0.15
        if _field(portal, 'type') == 'window' else abs(bottom) <= 0.15
    )
    if not vertical or parallel < 0.94 or away > (a['depth'] + b['depth']) / 2 + 0.12:
        return None
    if abs(along) > (a['width'] + b['width']) / 2:
        return None
    return along, b['width']


def _crossing(start, end, wall):
    pose = _pose(wall)
    dx, dz = end[0] - start[0], end[1] - start[1]
    ax, az = pose['axis']
    determinant = dx * az - dz * ax
    if abs(determinant) < 1e-6:
        return None
    wx, wz = pose['x'] - start[0], pose['z'] - start[1]
    along_ray = (wx * az - wz * ax) / determinant
    along_wall = (wx * dz - wz * dx) / determinant
    if along_ray <= 0.001 or along_ray >= 0.999 or abs(along_wall) > pose['width'] / 2:
        return None
    return along_wall


def _light_path_open(start, end, objects):
    for wall in objects:
        if _field(wall, 'type') != 'wall':
            continue
        along = _crossing(start, end, wall)
        if along is None:
            continue
        if not any(
            _field(portal, 'type') in {'door', 'window'}
            and (_field(portal, 'properties', {}) or {}).get('is_open')
            and (opening := _opening(portal, wall)) is not None
            and abs(along - opening[0]) < opening[1] / 2
            for portal in objects
        ):
            return False
    return True


def location_is_dark(lighting, x, z, minutes, objects=()):
    """Return whether a standing observer's cell lacks usable light."""
    settings = lighting or {}
    dark_tiles = settings.get('dark_tiles') or []
    marked = any(tile.get('x') == x and tile.get('z') == z for tile in dark_tiles)
    ambient = _number(settings.get('ambient_intensity'), 0.55)
    directional = _number(settings.get('directional_intensity'), 1)
    manual = settings.get('mode') == 'manual'
    night = world_is_dark(minutes)
    if not marked and not (night if not manual else ambient + directional < 0.12):
        return False

    daylight = min(1, ambient + directional) if manual else (0 if night else 1)
    sources = list(settings.get('local_lights') or [])
    dark_set = {(tile.get('x'), tile.get('z')) for tile in dark_tiles}
    objects = list(objects or [])
    if marked and daylight > 0.01:
        for portal in objects:
            if _field(portal, 'type') not in {'door', 'window'} or not (_field(portal, 'properties', {}) or {}).get('is_open'):
                continue
            if not any(_field(wall, 'type') == 'wall' and _opening(portal, wall) for wall in objects):
                continue
            pose = _pose(portal)
            for sign in (-1, 1):
                sx = pose['x'] + pose['normal'][0] * sign * 0.65
                sz = pose['z'] + pose['normal'][1] * sign * 0.65
                if (math.floor(sx), math.floor(sz)) not in dark_set:
                    sources.append({'x': sx, 'z': sz, 'distance': 6, 'intensity': daylight * 3})

    center = (x + 0.5, z + 0.5)
    illumination = 0
    for source in sources:
        origin = (_number(source.get('x')), _number(source.get('z')))
        radius = _number(source.get('distance'))
        distance = math.dist(origin, center)
        if radius <= 0 or distance >= radius or not _light_path_open(origin, center, objects):
            continue
        strength = min(1, max(0, _number(source.get('intensity')) / 3))
        illumination = max(illumination, strength * math.sqrt(1 - distance / radius))
    return 0.07 + 0.93 * illumination < 0.12
