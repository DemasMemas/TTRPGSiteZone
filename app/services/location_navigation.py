"""Discrete storeys and stair surfaces. Rendering/viewed floor is never an input."""
import heapq
import math

STOREY_HEIGHT = 2.4


def level_of(item):
    props = item.get('properties', {}) if isinstance(item, dict) else (getattr(item, 'properties', None) or {})
    value = props.get('level', item.get('level', 0) if isinstance(item, dict) else 0)
    try:
        number = float(value)
        return int(number) if math.isfinite(number) and number.is_integer() else 0
    except (ValueError, TypeError):
        return 0


def value(item, key, default=None):
    return item.get(key, default) if isinstance(item, dict) else getattr(item, key, default)


def number(raw, fallback):
    try:
        result = float(raw)
        return result if math.isfinite(result) else fallback
    except (ValueError, TypeError):
        return fallback


def pose(item):
    p = value(item, 'properties', {}) or {}
    d = p.get('dimensions') or {}
    angle = number(p.get('rotation'), 0)
    defaults = {'stairs':(1.2,3.6),'ladder':(.9,.9),'hatch':(1,1),'floor_opening':(1,1)}.get(value(item,'type'),(2,2))
    return (number(value(item, 'tile_x'), 0) + .5 + number(p.get('offset_x'), 0),
            number(value(item, 'tile_y'), 0) + .5 + number(p.get('offset_z'), 0),
            max(.01, number(d.get('width'), defaults[0])), max(.01, number(d.get('depth'), defaults[1])), angle)


def local_point(item, x, y):
    cx, cy, w, d, angle = pose(item)
    dx, dy = x - cx, y - cy
    return dx * math.cos(angle) - dy * math.sin(angle), dx * math.sin(angle) + dy * math.cos(angle), w, d


def contains(item, x, y):
    a, b, w, d = local_point(item, x, y)
    return abs(a) < w / 2 - .00001 and abs(b) < d / 2 - .00001


def ground(location, x, y):
    tiles = location.tiles_data or []
    tile = tiles[y][x] if 0 <= y < len(tiles) and 0 <= x < len(tiles[y]) else {}
    return number((tile or {}).get('height'), 1)


def opening_at(objects, level, x, y, building_id=None):
    """Horizontal passage; a closed hatch seals even an existing stairwell."""
    peers = [o for o in objects if building_id is None or (value(o, 'properties', {}) or {}).get('building_id') == building_id]
    hatches = [o for o in peers if value(o, 'type') == 'hatch' and level_of(o) == level and contains(o, x, y)]
    if any(not (value(o, 'properties', {}) or {}).get('is_open') for o in hatches):
        return False
    return bool(hatches) or any(value(o,'type') == 'floor_opening' and level_of(o) == level and contains(o,x,y) for o in peers) or any(value(o, 'type') in {'stairs', 'ladder'} and level_of(o)+1 == level
                               and contains(o, x, y) for o in peers)


def drop_route(location, objects, start, portal, maps):
    """An explicit downward action, deliberately absent from ordinary pathfinding."""
    kind = value(portal,'type')
    if kind not in {'hatch','floor_opening','stairs','ladder'}:
        return None
    upper = level_of(portal) + int(kind in {'stairs','ladder'})
    px, py, *_ = pose(portal)
    x,y = math.floor(px),math.floor(py)
    if start[2] != upper or max(abs(start[0]-x),abs(start[1]-y)) > 1:
        return None
    if not (0 <= x < location.grid_width and 0 <= y < location.grid_height) or not contains(portal,x+.5,y+.5):
        return None
    if not opening_at(objects,upper,x+.5,y+.5):
        return None
    origin = surface(location,objects,*start)
    if not origin:
        return None
    blocked,costs = maps(upper)
    if (x,y) in blocked or costs.get((x,y),0):
        return None
    levels = sorted({0} | {level_of(o) for o in objects},reverse=True)
    for level in levels:
        if level >= upper:
            continue
        blocked,costs = maps(level)
        if (x,y) in blocked or costs.get((x,y),0):
            return None
        if opening_at(objects,level,x+.5,y+.5):
            continue
        landing = surface(location,objects,x,y,level)
        if not landing:
            if any(value(o,'type') == 'hatch' and level_of(o) == level and contains(o,x+.5,y+.5)
                   and not (value(o,'properties',{}) or {}).get('is_open') for o in objects):
                return None
            continue
        height = origin['height']-landing['height']
        if height <= .01:
            return None
        points = [{k:origin[k] for k in ('x','y','level','height')}]
        if (start[0],start[1]) != (x,y):
            points.append({'x':x,'y':y,'level':upper,'height':origin['height']})
        steps = max(2,math.ceil(math.sqrt(2*height/9.81)/.18))
        for i in range(1,steps):
            fallen = height*(i/steps)**2
            points.append({'x':x,'y':y,'level':max(level,upper-max(1,math.ceil(fallen/STOREY_HEIGHT))),
                           'height':origin['height']-fallen})
        points.append({k:landing[k] for k in ('x','y','level','height')})
        return {'surfaces':points,'height':height,'landing':landing}
    return None


def ladder_connection(location, objects, a, b):
    if a['x'] != b['x'] or a['y'] != b['y'] or abs(a['level']-b['level']) != 1:
        return False
    low, high = sorted([a, b], key=lambda n: n['level'])
    x, y = a['x']+.5, a['y']+.5
    for ladder in objects:
        if value(ladder, 'type') != 'ladder' or level_of(ladder) != low['level'] or not contains(ladder, x, y):
            continue
        p = value(ladder, 'properties', {}) or {}
        base = ground(location, value(ladder, 'tile_x'), value(ladder, 'tile_y')) + low['level']*STOREY_HEIGHT + number(p.get('elevation'), 0)
        rise = number((p.get('dimensions') or {}).get('height'), STOREY_HEIGHT)
        if abs(low['height']-base) > .21 or abs(high['height']-(base+rise)) > .21:
            continue
        building_id = p.get('building_id')
        if all(n['level'] == 0 or any(value(f, 'type') == 'floor' and level_of(f) == n['level']
               and (value(f, 'properties', {}) or {}).get('building_id') == building_id and contains(f, x, y)
               for f in objects) for n in (low, high)) and opening_at(objects, high['level'], x, y, building_id):
            return True
    return False


def surface(location, objects, x, y, level):
    """One walkable surface per cell/storey. Stairs belong to their lower storey."""
    floors = [o for o in objects if value(o, 'type') == 'floor' and level_of(o) == level and contains(o, x + .5, y + .5)]
    height = ground(location, x, y) + level * STOREY_HEIGHT
    if floors:
        f = floors[0]
        height = ground(location, value(f, 'tile_x'), value(f, 'tile_y')) + level * STOREY_HEIGHT + number((value(f, 'properties', {}) or {}).get('elevation'), 0) + .035
    # Closed hatches remain walkable lids, but seal the vertical route.
    if any(value(o, 'type') == 'hatch' and level_of(o) == level and contains(o,x+.5,y+.5)
           and not (value(o,'properties',{}) or {}).get('is_open') for o in objects) and (floors or level == 0):
        return {'x':x,'y':y,'level':level,'height':height,'stair':None}
    # Match the conservative rectangular cut used by floorSlabParts for rotated flights.
    for stair in objects:
        if value(stair, 'type') != 'stairs' or level_of(stair)+1 != level:
            continue
        p = value(stair, 'properties', {}) or {}
        if floors and not any((value(f, 'properties', {}) or {}).get('building_id') == p.get('building_id') for f in floors):
            continue
        cx, cy, w, d, angle = pose(stair)
        # Floors and stairwells normally share the orthogonal building axes.
        for floor in [f for f in floors if (value(f, 'properties', {}) or {}).get('building_id') == p.get('building_id')] or [None]:
            floor_angle = pose(floor)[4] if floor else 0
            delta = angle - floor_angle
            width = abs(math.cos(delta))*w + abs(math.sin(delta))*d
            depth = abs(math.sin(delta))*w + abs(math.cos(delta))*d
            dx, dy = x+.5-cx, y+.5-cy
            a = dx*math.cos(floor_angle)-dy*math.sin(floor_angle)
            b = dx*math.sin(floor_angle)+dy*math.cos(floor_angle)
            if abs(a)<width/2-.00001 and abs(b)<depth/2-.00001:
                # A flight starting here can occupy the opening in a stacked stairwell.
                if not any(value(o,'type')=='stairs' and level_of(o)==level and contains(o,x+.5,y+.5) for o in objects):
                    return None
    stairs = [o for o in objects if value(o, 'type') == 'stairs' and contains(o, x + .5, y + .5)]
    stairs.sort(key=lambda o: level_of(o) != level)
    for stair in stairs:
        p = value(stair, 'properties', {}) or {}
        base = level_of(stair)
        if level != base:
            continue
        _, along, _, depth = local_point(stair, x + .5, y + .5)
        rise = max(.01, number((p.get('dimensions') or {}).get('height'), STOREY_HEIGHT))
        count = max(1, math.ceil(rise / .2))
        step = min(count, max(1, math.floor((along / depth + .5) * count) + 1))
        base_height = ground(location, value(stair, 'tile_x'), value(stair, 'tile_y')) + base * STOREY_HEIGHT + number(p.get('elevation'), 0)
        height = base_height + rise * step / count
        return {'x': x, 'y': y, 'level': level, 'height': height, 'stair': stair, 'base_height':base_height, 'rise':rise}
    if level != 0 and not floors:
        return None
    return {'x': x, 'y': y, 'level': level, 'height': height, 'stair': None}


def connects(a, b):
    if not a['stair'] and not b['stair']:
        return a['level'] == b['level']
    if abs(a['level'] - b['level']) > 1:
        return False
    for on, other in [(a, b), (b, a)]:
        stair = on['stair']
        if not stair:
            continue
        _, along, _, depth = local_point(stair, other['x'] + .5, other['y'] + .5)
        across, _, width, _ = local_point(stair, other['x'] + .5, other['y'] + .5)
        if other['stair'] is not stair:
            # Enter and leave through the ends, never through a side of a tall step.
            if abs(across) >= width / 2 or abs(along) < depth / 2 - .00001:
                return False
            expected = level_of(stair) + (1 if along > 0 else 0)
            if other['level'] != expected:
                return False
            landing_height = on['base_height'] + (on['rise'] if along > 0 else 0)
            if abs(other['height'] - landing_height) > .21:
                return False
    rise = max(number((value(n['stair'], 'properties', {}) or {}).get('dimensions', {}).get('height'), 2.4) /
               pose(n['stair'])[3] for n in (a, b) if n['stair'])
    distance = math.hypot(a['x'] - b['x'], a['y'] - b['y'])
    return abs(a['height'] - b['height']) <= rise * distance + .21


def find_path(location, objects, start, end, maps):
    """maps(level) returns the established blocked cells and climb costs."""
    levels = {0, start[2], end[2]} | {level_of(o) for o in objects}
    # Surface geometry only uses these structures. Collision maps still include
    # every object. Snapshot ORM fields once rather than reading them per node.
    surface_objects = [dict(type=value(o, 'type'), level=level_of(o), tile_x=value(o, 'tile_x'),
                     tile_y=value(o, 'tile_y'), properties=value(o, 'properties', {}) or {})
                for o in objects if value(o, 'type') in {'floor', 'stairs', 'ladder', 'hatch', 'floor_opening'}]
    surface_geometry = [o for o in surface_objects if o['type'] in {'floor', 'stairs', 'hatch'}]
    cache = {}

    def node(key):
        if key not in cache:
            x, y, level = key
            cache[key] = surface(location, surface_geometry, x, y, level)
        return cache[key]

    source, target = node(start), node(end)
    if not source or not target:
        return None
    blocked, costs = maps(end[2])
    if (end[0], end[1]) in blocked and end != start or costs.get(end[:2], 0) > 0:
        return None
    def estimate(key):
        return max(abs(end[i] - key[i]) for i in range(3))

    def distance(key):
        return sum((end[i] - key[i]) ** 2 for i in range(3))

    # Each edge costs at least one and changes each coordinate by at most one.
    # Chebyshev distance is admissible, including stairs and vertical ladders.
    queue = [(estimate(start), distance(start), 0, start)]
    best, previous = {start: 0}, {}
    while queue:
        _, _, cost, key = heapq.heappop(queue)
        if cost != best[key]:
            continue
        if key == end:
            keys = [key]
            while key in previous:
                key = previous[key]
                keys.append(key)
            nodes = [node(k) for k in reversed(keys)]
            surfaces = []
            for n in nodes:
                if surfaces and surfaces[-1]['x'] == n['x'] and surfaces[-1]['y'] == n['y'] and surfaces[-1]['level'] != n['level']:
                    a = surfaces[-1]
                    steps = max(1, math.ceil(abs(n['height']-a['height'])/.3))
                    surfaces.extend({'x':n['x'],'y':n['y'],'level':min(a['level'],n['level']),
                                     'height':a['height']+(n['height']-a['height'])*i/steps} for i in range(1,steps))
                surfaces.append({k:n[k] for k in ('x','y','level','height')})
            return {'path': [(n['x'], n['y']) for n in nodes], 'cost': cost,
                    'climb_cost': sum(maps(n['level'])[1].get((n['x'], n['y']), 0) for n in nodes[1:]),
                    'surfaces': surfaces}
        a = node(key)
        for dx, dy in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]:
            x, y = key[0] + dx, key[1] + dy
            if not (0 <= x < location.grid_width and 0 <= y < location.grid_height):
                continue
            for level in sorted(levels):
                candidate = (x, y, level)
                b = node(candidate)
                vertical = dx == dy == 0
                if not b or not (ladder_connection(location, surface_objects, a, b) if vertical else connects(a, b)):
                    continue
                blocked, costs = maps(level)
                if (x, y) in blocked:
                    continue
                new_cost = cost + (max(1, math.ceil(abs(a['height']-b['height']))) if vertical else 1) + costs.get((x, y), 0)
                if new_cost < best.get(candidate, math.inf):
                    best[candidate], previous[candidate] = new_cost, key
                    heapq.heappush(queue, (new_cost + estimate(candidate), distance(candidate), new_cost, candidate))
    return None
