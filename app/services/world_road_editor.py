"""Preview and guarded construction using the existing world-road search/storage."""
import copy
import hashlib
import json
import math
import re

from app.constants import CHUNK_SIZE
from app.extensions import db
from app.models import Lobby, MapChunk
from app.services.exceptions import ConflictError, NotFoundError, PermissionDenied, ValidationError
from app.services.world_generation import _road_path, generated_world_tile

DIRECTIONS = {(1, 0): ('E', 'W'), (-1, 0): ('W', 'E'), (0, 1): ('S', 'N'), (0, -1): ('N', 'S'),
              (1, 1): ('SE', 'NW'), (-1, -1): ('NW', 'SE'), (1, -1): ('NE', 'SW'), (-1, 1): ('SW', 'NE')}
MAX_ROAD_NODES = 1000  # Existing atomic object-group edit limit.


def _inputs(lobby_id, gm_id, payload):
    lobby = db.session.get(Lobby, lobby_id)
    if not lobby:
        raise NotFoundError('Lobby not found')
    if lobby.gm_id != gm_id:
        raise PermissionDenied('Only GM can build roads')
    if not isinstance(payload, dict):
        raise ValidationError('Expected road route data')
    points = payload.get('waypoints')
    if not isinstance(points, list) or not 2 <= len(points) <= MAX_ROAD_NODES:
        raise ValidationError('Укажите начало и конец маршрута')
    for point in points:
        if (not isinstance(point, list) or len(point) != 2 or any(type(v) is not int for v in point)
                or not 0 <= point[0] < lobby.chunks_width*CHUNK_SIZE or not 0 <= point[1] < lobby.chunks_height*CHUNK_SIZE):
            raise ValidationError('Точка маршрута вне карты')
    bridges = payload.get('allow_bridges', False)
    if type(bridges) is not bool:
        raise ValidationError('Invalid bridge option')
    settings = payload.get('settings', {})
    if not isinstance(settings, dict):
        raise ValidationError('Invalid road settings')
    scale, color = settings.get('scale', 1), settings.get('color', '#756f61')
    if isinstance(scale, bool) or not isinstance(scale, (int, float)) or not math.isfinite(scale) or not .2 <= scale <= 2:
        raise ValidationError('Invalid road scale')
    if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
        raise ValidationError('Invalid road color')
    return lobby, [tuple(p) for p in points], bridges, {'scale': scale, 'color': color}


def _plan(lobby, points, bridges, settings):
    chunks = {(c.chunk_x, c.chunk_y): c for c in MapChunk.query.filter_by(lobby_id=lobby.id).all()}
    cache = {}

    def tile_at(x, y):
        key = (x, y)
        if key not in cache:
            chunk = chunks.get((x//CHUNK_SIZE, y//CHUNK_SIZE))
            if chunk:
                cache[key] = chunk.data[y % CHUNK_SIZE][x % CHUNK_SIZE]
            elif lobby.map_type in {'random', 'predefined'}:
                cache[key] = generated_world_tile(lobby.id, x, y, lobby.chunks_width, lobby.chunks_height, lobby.map_type)
            else:
                # Match MapService._generate_chunk_data's empty-map fallback.
                cache[key] = {'terrain': 'grass', 'height': 1.0, 'objects': []}
        return cache[key]

    def road_at(x, y):
        return next((o for o in tile_at(x, y).get('objects', []) if o.get('type') == 'road'), None)

    if any(tile_at(*point)['terrain'] == 'water' for point in points):
        raise ValidationError('Начало, конец и промежуточные точки выбираются на суше')
    path = []
    # An admissible cheaper heuristic is necessary only when reusable roads exist.
    has_roads = lobby.map_type != 'empty' or any(any(o.get('type') == 'road' for o in tile.get('objects', []))
                    for chunk in chunks.values() for row in chunk.data for tile in row)
    for start, goal in zip(points, points[1:]):
        section = _road_path(start, goal, lobby.id, lobby.chunks_width*CHUNK_SIZE, lobby.chunks_height*CHUNK_SIZE,
                             lobby.map_type, set(), terrain_at=lambda x,y: tile_at(x,y)['terrain'],
                             road_at=road_at if has_roads else None, allow_bridges=bridges, shore_penalty=0,
                             diagonal=True, road_discount=.95)
        if not section:
            raise ValidationError('Сухопутного маршрута нет. Измените точки или разрешите мосты.' if not bridges
                                  else 'Маршрут не найден: для моста нужны два сухих берега по прямой')
        path.extend(section if not path else section[1:])
        if len(path) > MAX_ROAD_NODES:
            raise ValidationError('Не более 1000 клеток дороги за операцию: разбейте маршрут на участки')
    if len(path) < 2:
        raise ValidationError('Начало и конец должны различаться')
    unique = list(dict.fromkeys(path))
    preview = {point: {'x': point[0], 'y': point[1], 'height': float(tile_at(*point).get('height', 1)),
                       'bridge': tile_at(*point)['terrain'] == 'water', 'existing': bool(road_at(*point))} for point in unique}
    for point, node in preview.items():
        road = road_at(*point) or settings
        node.update(offset_x=road.get('x', 0), offset_z=road.get('z', 0),
                    scale=road.get('scale', 1), color=road.get('color', '#756f61'))
    index = 0
    while index < len(path):
        if not preview[path[index]]['bridge']:
            index += 1
            continue
        first = index
        while index < len(path) and preview[path[index]]['bridge']:
            index += 1
        banks = path[max(0, first-1):min(len(path), index+1)]
        deck = max(max(float(tile_at(*p).get('height', 1))+.06,
                       float((road_at(*p) or {}).get('bridge_height', -1e6))) for p in banks)
        for p in path[first:index]:
            preview[p]['bridge_height'] = max(deck, preview[p].get('bridge_height', deck))
    # Include endpoint neighbours because construction may connect to their roads.
    touched = set(unique)
    for x,y in (path[0], path[-1]):
        for dx,dy in DIRECTIONS:
            nx,ny=x+dx,y+dy
            if not (0 <= nx < lobby.chunks_width*CHUNK_SIZE and 0 <= ny < lobby.chunks_height*CHUNK_SIZE):
                continue
            if dx and dy and (tile_at(x+dx,y)['terrain']=='water' or tile_at(x,y+dy)['terrain']=='water'):
                continue
            if 0 <= nx < lobby.chunks_width*CHUNK_SIZE and 0 <= ny < lobby.chunks_height*CHUNK_SIZE and road_at(nx,ny):
                if dx and dy and tile_at(nx,ny)['terrain']=='water':
                    continue
                touched.add((nx,ny))
    guarded = set(touched)
    # Diagonal legality depends on both side cells, including the other two
    # chunks at a four-chunk corner. Lock/check these cells without painting roads on them.
    for a,b in zip(path,path[1:]):
        if a[0]!=b[0] and a[1]!=b[1]:
            guarded.update(((a[0],b[1]),(b[0],a[1])))
    for x,y in (path[0],path[-1]):
        for dx,dy in DIRECTIONS:
            if dx and dy and (x+dx,y+dy) in touched:
                guarded.update(((x+dx,y),(x,y+dy)))
    snapshot = [(p, tile_at(*p)) for p in sorted(guarded)]
    signature = hashlib.sha256(json.dumps([points, bridges, settings, path, snapshot], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'path': [preview[p] for p in path], 'signature': signature, 'reused': sum(preview[p]['existing'] for p in unique),
            'bridges': sum(preview[p]['bridge'] for p in unique)}, touched, tile_at, chunks, guarded


def preview_world_road(lobby_id, gm_id, payload):
    lobby, points, bridges, settings = _inputs(lobby_id, gm_id, payload)
    return _plan(lobby, points, bridges, settings)[0]


def build_world_road(lobby_id, gm_id, payload):
    from app.services.map import MapService
    lobby, points, bridges, settings = _inputs(lobby_id, gm_id, payload)
    _, _, _, _, guarded = _plan(lobby, points, bridges, settings)
    for cx,cy in sorted({(x//CHUNK_SIZE,y//CHUNK_SIZE) for x,y in guarded}):
        MapChunk.query.filter_by(lobby_id=lobby_id, chunk_x=cx, chunk_y=cy).populate_existing().with_for_update().first()
    plan, touched, tile_at, chunks, _ = _plan(lobby, points, bridges, settings)
    if not isinstance(payload.get('signature'), str) or plan['signature'] != payload['signature']:
        raise ConflictError('Карта изменилась. Проверьте обновлённый предпросмотр и подтвердите маршрут снова.')
    data = {}
    for key in sorted({(x//CHUNK_SIZE,y//CHUNK_SIZE) for x,y in touched}):
        chunk = chunks.get(key)
        if not chunk:
            chunk = MapChunk(lobby_id=lobby_id, chunk_x=key[0], chunk_y=key[1],
                             data=MapService._generate_chunk_data(lobby_id, *key, lobby.map_type))
            db.session.add(chunk)
            chunks[key] = chunk
        data[key] = copy.deepcopy(chunk.data)
    nodes = {}
    for point in touched:
        x,y=point
        tile=data[(x//CHUNK_SIZE,y//CHUNK_SIZE)][y%CHUNK_SIZE][x%CHUNK_SIZE]
        road=next((o for o in tile.get('objects', []) if o.get('type')=='road'),None)
        if not road:
            road={'type':'road','x':0,'z':0,**settings,'rotation':0,'connections':[], 'authored_route':True}
            tile.setdefault('objects',[]).append(road)
        nodes[point]=road
    for p in plan['path']:
        road=nodes[(p['x'],p['y'])]
        if p['bridge']:
            road.update(bridge=True,bridge_height=p['bridge_height'])
        else:
            road.pop('bridge',None);road.pop('bridge_height',None)
    path=[(p['x'],p['y']) for p in plan['path']]
    pairs=list(zip(path,path[1:]))
    for p in (path[0],path[-1]):
        pairs.extend((p,(p[0]+dx,p[1]+dy)) for dx,dy in DIRECTIONS if (p[0]+dx,p[1]+dy) in touched and (p[0]+dx,p[1]+dy) not in path)
    for a,b in pairs:
        names=DIRECTIONS.get((b[0]-a[0],b[1]-a[1]))
        if not names:
            continue
        for p,name in zip((a,b),names):
            road=nodes[p]
            road['manual_connections']=sorted(set(road.get('manual_connections',[]))|{name})
            if road.get('authored_route'):
                road['connections']=sorted(set(road.get('connections',[]))|{name})
                road['rotation']=90 if len(set(road['connections'])&{'N','S'})>len(set(road['connections'])&{'E','W'}) else 0
    updates=[]
    for x,y in sorted(touched):
        key=(x//CHUNK_SIZE,y//CHUNK_SIZE)
        updates.append({'chunk_x':key[0],'chunk_y':key[1],'tile_x':x%CHUNK_SIZE,'tile_y':y%CHUNK_SIZE,
                        'updates':{'objects':data[key][y%CHUNK_SIZE][x%CHUNK_SIZE]['objects']}})
    for key, chunk_data in data.items():
        chunks[key].data=chunk_data
    db.session.commit()
    return {'updates':updates,'path':plan['path']}
