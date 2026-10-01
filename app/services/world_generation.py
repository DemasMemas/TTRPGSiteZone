"""Deterministic world features shared by independently generated chunks."""

from functools import lru_cache
from heapq import heappop, heappush
import random

from app.constants import CHUNK_SIZE
from app.services.world_rules import anomaly_field_catalog


LANDMARK_COLORS = {
    'forest': '#244832', 'hamlet': '#aa8665', 'village': '#b39474',
    'road': '#756f61', 'factory': '#66747b', 'base': '#6c765d',
    'camp': '#9c8362',
}
HABITATIONS = ('hamlet', 'village', 'factory', 'base')


def _inside_patch(x, y, patch):
    center_x, center_y, radius_x, radius_y, _, seed = patch
    distance = ((x - center_x) / radius_x) ** 2 + ((y - center_y) / radius_y) ** 2
    cell_x, cell_y = x // 2, y // 2
    edge_hash = (seed ^ (cell_x * 73856093) ^ (cell_y * 19349663)) & 0xffffffff
    edge_hash = (edge_hash ^ (edge_hash >> 13)) * 1274126177 & 0xffffffff
    return distance <= 0.86 + (edge_hash % 1000) / 2500


def _lattice_noise(seed, x, y):
    value = (seed ^ (x * 73856093) ^ (y * 19349663)) & 0xffffffff
    value = (value ^ (value >> 16)) * 2246822519 & 0xffffffff
    value = (value ^ (value >> 13)) * 3266489917 & 0xffffffff
    return ((value ^ (value >> 16)) & 0xffffffff) / 0xffffffff


def _smooth_noise(seed, x, y, scale):
    grid_x, grid_y = x // scale, y // scale
    blend_x, blend_y = (x % scale) / scale, (y % scale) / scale
    blend_x = blend_x * blend_x * (3 - 2 * blend_x)
    blend_y = blend_y * blend_y * (3 - 2 * blend_y)
    top = _lattice_noise(seed, grid_x, grid_y) * (1 - blend_x) + _lattice_noise(seed, grid_x + 1, grid_y) * blend_x
    bottom = _lattice_noise(seed, grid_x, grid_y + 1) * (1 - blend_x) + _lattice_noise(seed, grid_x + 1, grid_y + 1) * blend_x
    return top * (1 - blend_y) + bottom * blend_y


@lru_cache(maxsize=65536)
def _biome_fields(lobby_id, x, y, width, height):
    seed = int(lobby_id) * 7919 + width * 101 + height * 37
    warp_x = round((_smooth_noise(seed + 4, x, y, 14) - 0.5) * 12)
    warp_y = round((_smooth_noise(seed + 5, x, y, 14) - 0.5) * 12)
    warped_x, warped_y = x + warp_x, y + warp_y
    moisture = (0.7 * _smooth_noise(seed, warped_x, warped_y, 34)
                + 0.3 * _smooth_noise(seed + 1, warped_x, warped_y, 15))
    geology = (0.7 * _smooth_noise(seed + 2, warped_x, warped_y, 36)
               + 0.3 * _smooth_noise(seed + 3, warped_x, warped_y, 14))
    return moisture, geology


@lru_cache(maxsize=128)
def _terrain_thresholds(lobby_id, width, height):
    moisture = []
    geology = []
    for y in range(0, height, 2):
        for x in range(0, width, 2):
            wetness, mineral = _biome_fields(lobby_id, x, y, width, height)
            moisture.append(wetness)
            geology.append(mineral)
    moisture.sort()
    geology.sort()
    def percentile(values, fraction):
        return values[int((len(values) - 1) * fraction)]
    return (
        percentile(moisture, 0.94), percentile(moisture, 0.84),
        percentile(geology, 0.93), percentile(geology, 0.07),
    )


@lru_cache(maxsize=65536)
def _terrain_at(lobby_id, x, y, width, height, map_type):
    if map_type == 'predefined' and (x < 2 or y < 2 or x >= width - 2 or y >= height - 2):
        return 'water'
    moisture, geology = _biome_fields(lobby_id, x, y, width, height)
    water_limit, swamp_limit, rock_limit, sand_limit = _terrain_thresholds(lobby_id, width, height)
    if moisture >= water_limit:
        return 'water'
    if moisture >= swamp_limit:
        return 'swamp'
    if geology >= rock_limit:
        return 'rock'
    if geology <= sand_limit:
        return 'sand'
    return 'grass'


@lru_cache(maxsize=65536)
def _height_at(lobby_id, x, y, terrain):
    if terrain == 'water':
        return 1.0
    seed = int(lobby_id) * 7919 + 104729
    broad = _smooth_noise(seed, x, y, 30)
    detail = _smooth_noise(seed + 1, x, y, 13)
    height = 1.0 + max(0.0, broad * 0.75 + detail * 0.25 - 0.3) * 0.8
    return round(height * 20) / 20


def _add_forest_patch(rng, sites, roads, lobby_id, width, height, map_type, center, radius_x, radius_y):
    patch = (*center, radius_x, radius_y, 'forest', rng.randrange(1 << 30))
    for y in range(max(0, center[1] - radius_y), min(height, center[1] + radius_y + 1)):
        for x in range(max(0, center[0] - radius_x), min(width, center[0] + radius_x + 1)):
            cell = (x, y)
            if (cell in sites or cell in roads or not _inside_patch(x, y, patch)
                    or rng.random() >= 0.62):
                continue
            if _terrain_at(lobby_id, x, y, width, height, map_type) != 'water':
                sites[cell] = 'forest'


def _pick_free_tile(rng, lobby_id, chunk_x, chunk_y, width, height, map_type, occupied):
    for _ in range(80):
        x = chunk_x * CHUNK_SIZE + rng.randrange(2, CHUNK_SIZE - 2)
        y = chunk_y * CHUNK_SIZE + rng.randrange(2, CHUNK_SIZE - 2)
        if x >= width or y >= height or (x, y) in occupied:
            continue
        if _terrain_at(lobby_id, x, y, width, height, map_type) == 'water':
            continue
        if any(abs(x - ox) + abs(y - oy) < 6 for ox, oy in occupied):
            continue
        return x, y
    return None


def _road_path(start, goal, lobby_id, width, height, map_type, sites, blocked_start_neighbors=()):
    if start == goal:
        return [start]
    queue = [(0, 0, start)]
    parents = {start: None}
    costs = {start: 0}
    while queue:
        _, cost, cell = heappop(queue)
        if cost != costs[cell]:
            continue
        if cell == goal:
            path = []
            while cell is not None:
                path.append(cell)
                cell = parents[cell]
            return path[::-1]
        x, y = cell
        for neighbor in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            nx, ny = neighbor
            if cell == start and neighbor in blocked_start_neighbors:
                continue
            if not (0 <= nx < width and 0 <= ny < height):
                continue
            if _terrain_at(lobby_id, nx, ny, width, height, map_type) == 'water':
                continue
            if neighbor in sites and neighbor != goal:
                continue
            next_cost = cost + 1
            if next_cost >= costs.get(neighbor, float('inf')):
                continue
            costs[neighbor] = next_cost
            parents[neighbor] = cell
            priority = next_cost + abs(nx - goal[0]) + abs(ny - goal[1])
            heappush(queue, (priority, next_cost, neighbor))
    return []


@lru_cache(maxsize=32)
def world_plan(lobby_id, chunks_width, chunks_height, map_type):
    """Return shared landmarks, roads, and fields without touching stored chunks."""
    width, height = chunks_width * CHUNK_SIZE, chunks_height * CHUNK_SIZE
    rng = random.Random(f'{lobby_id}:{width}:{height}:{map_type}:world')
    sites = {}
    settlements = []
    fields = {}
    field_catalog = anomaly_field_catalog()

    for chunk_y in range(chunks_height):
        for chunk_x in range(chunks_width):
            count = 1 + (rng.random() < 0.35)
            for _ in range(count):
                cell = _pick_free_tile(rng, lobby_id, chunk_x, chunk_y, width, height, map_type, sites)
                if cell:
                    kind = rng.choices(HABITATIONS, weights=(5, 2, 2, 1))[0]
                    sites[cell] = kind
                    settlements.append(cell)
            if rng.random() < 0.35:
                cell = _pick_free_tile(rng, lobby_id, chunk_x, chunk_y, width, height, map_type, sites)
                if cell:
                    sites[cell] = 'camp'
            if field_catalog and rng.random() < 0.65:
                cell = _pick_free_tile(rng, lobby_id, chunk_x, chunk_y, width, height, map_type, sites)
                if cell:
                    profile = rng.choice(field_catalog)
                    fields[cell] = {
                        'name': profile['name'], 'field_type': profile['field_type'],
                        'hazard': profile['hazard'],
                        'rank': rng.randint(profile['rank_min'], profile['rank_max']),
                    }

    while len(settlements) < 3:
        cell = _pick_free_tile(rng, lobby_id, 0, 0, width, height, map_type, sites)
        if cell is None:
            break
        sites[cell] = HABITATIONS[len(settlements) % len(HABITATIONS)]
        settlements.append(cell)

    if len(settlements) >= len(HABITATIONS):
        for cell, kind in zip(settlements, rng.sample(HABITATIONS, len(HABITATIONS))):
            sites[cell] = kind

    roads = {}
    edges = set()
    def add_road(path):
        for first, second in zip(path, path[1:]):
            direction = 'horizontal' if first[1] == second[1] else 'vertical'
            roads.setdefault(first, set()).add(direction)
            roads.setdefault(second, set()).add(direction)

    for site in settlements:
        closest = sorted(
            (other for other in settlements if other != site),
            key=lambda other: (abs(other[0] - site[0]) + abs(other[1] - site[1]), other),
        )[:2]
        for other in closest:
            edge = tuple(sorted((site, other)))
            if edge in edges:
                continue
            edges.add(edge)
            path = _road_path(site, other, lobby_id, width, height, map_type, sites)
            add_road(path)

    for site in settlements:
        adjacent = {
            (site[0] + dx, site[1] + dy)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            if (site[0] + dx, site[1] + dy) in roads
        }
        if len(adjacent) >= 2:
            continue
        closest = sorted(
            (other for other in settlements if other != site),
            key=lambda other: (abs(other[0] - site[0]) + abs(other[1] - site[1]), other),
        )
        for other in closest:
            path = _road_path(
                site, other, lobby_id, width, height, map_type, sites,
                blocked_start_neighbors=adjacent,
            )
            if len(path) > 1:
                add_road(path)
                break

    for _ in range(max(3, width * height // 1500)):
        center = (rng.randrange(width), rng.randrange(height))
        _add_forest_patch(rng, sites, roads, lobby_id, width, height, map_type,
                          center, rng.randint(3, 5), rng.randint(3, 5))

    road_cells = list(roads)
    for x, y in road_cells[::max(40, len(road_cells) // 6)]:
        if rng.random() < 0.55:
            dx, dy = rng.choice(((1, 0), (-1, 0), (0, 1), (0, -1)))
            center = (x + dx * rng.randint(2, 4), y + dy * rng.randint(2, 4))
            _add_forest_patch(rng, sites, roads, lobby_id, width, height, map_type,
                              center, rng.randint(2, 4), rng.randint(2, 4))

    return {'sites': sites, 'roads': roads, 'fields': fields}


def generated_world_tile(lobby_id, x, y, chunks_width, chunks_height, map_type):
    width, height = chunks_width * CHUNK_SIZE, chunks_height * CHUNK_SIZE
    plan = world_plan(lobby_id, chunks_width, chunks_height, map_type)
    terrain = _terrain_at(lobby_id, x, y, width, height, map_type)
    objects = []
    if terrain != 'water':
        site = plan['sites'].get((x, y))
        if site in HABITATIONS or (site and (x, y) not in plan['roads']):
            objects.append({
                'type': site, 'x': 0, 'z': 0, 'scale': 1,
                'rotation': 0, 'color': LANDMARK_COLORS[site],
            })
        else:
            for direction in sorted(plan['roads'].get((x, y), ())):
                objects.append({
                    'type': 'road', 'x': 0, 'z': 0, 'scale': 1.1,
                    'rotation': 90 if direction == 'vertical' else 0,
                    'color': LANDMARK_COLORS['road'],
                })
    result = {'terrain': terrain, 'height': _height_at(lobby_id, x, y, terrain), 'objects': objects}
    if terrain != 'water' and (x, y) in plan['fields']:
        result['anomaly_field'] = dict(plan['fields'][(x, y)])
    return result
