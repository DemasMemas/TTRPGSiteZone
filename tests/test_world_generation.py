from collections import Counter

import pytest

from app.services.world_generation import HABITATIONS, _inside_patch, generated_world_tile, world_plan


def test_generated_world_is_grass_based_and_has_connected_landmarks():
    lobby_id, chunks_width, chunks_height = 42, 4, 3
    plan = world_plan(lobby_id, chunks_width, chunks_height, 'random')
    assert {'forest', 'hamlet', 'village', 'factory', 'base', 'camp'} <= set(plan['sites'].values())
    assert plan['fields']
    terrain = Counter()
    for y in range(chunks_height * 32):
        for x in range(chunks_width * 32):
            tile = generated_world_tile(lobby_id, x, y, chunks_width, chunks_height, 'random')
            terrain[tile['terrain']] += 1
            if tile['terrain'] == 'water':
                assert tile['objects'] == []
                assert 'anomaly_field' not in tile
            if (x, y) in plan['roads'] and (x, y) not in plan['sites']:
                assert any(obj['type'] == 'road' for obj in tile['objects'])
    assert terrain['grass'] > sum(count for kind, count in terrain.items() if kind != 'grass')
    assert all(terrain[kind] > 0 for kind in ('sand', 'rock', 'swamp', 'water'))

    for (x, y), kind in plan['sites'].items():
        if kind not in HABITATIONS:
            continue
        entrances = sum(
            (x + dx, y + dy) in plan['roads']
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
        )
        assert entrances >= 2


def test_world_plan_is_stable_across_chunk_loading_order():
    first = generated_world_tile(88, 31, 20, 2, 2, 'random')
    second = generated_world_tile(88, 32, 20, 2, 2, 'random')
    assert first == generated_world_tile(88, 31, 20, 2, 2, 'random')
    assert second == generated_world_tile(88, 32, 20, 2, 2, 'random')
    assert world_plan(88, 2, 2, 'random') is world_plan(88, 2, 2, 'random')


def test_single_chunk_world_keeps_grass_as_the_main_terrain():
    terrain = Counter(
        generated_world_tile(1, x, y, 1, 1, 'random')['terrain']
        for y in range(32) for x in range(32)
    )
    assert terrain['grass'] > sum(count for kind, count in terrain.items() if kind != 'grass')


def test_generated_terrain_has_irregular_patches_and_grouped_forest_without_excessive_density():
    patch = (10, 10, 6, 6, 'rock', 1234)
    assert _inside_patch(10, 10, patch)
    assert not _inside_patch(16, 16, patch)

    lobby_id, chunks_width, chunks_height = 42, 4, 3
    plan = world_plan(lobby_id, chunks_width, chunks_height, 'random')
    forest = {cell for cell, kind in plan['sites'].items() if kind == 'forest'}
    grouped = sum(
        any((x + dx, y + dy) in forest for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        for x, y in forest
    )
    assert 60 < len(forest) < 350
    assert grouped > len(forest) // 2
    tiles = [
        [generated_world_tile(lobby_id, x, y, chunks_width, chunks_height, 'random')
         for x in range(chunks_width * 32)]
        for y in range(chunks_height * 32)
    ]
    heights = {tile['height'] for row in tiles for tile in row}
    assert len(heights) >= 3
    for row in tiles:
        for left, right in zip(row, row[1:]):
            if left['terrain'] != 'water' and right['terrain'] != 'water':
                assert abs(left['height'] - right['height']) <= 0.1
    for upper, lower in zip(tiles, tiles[1:]):
        for top, bottom in zip(upper, lower):
            if top['terrain'] != 'water' and bottom['terrain'] != 'water':
                assert abs(top['height'] - bottom['height']) <= 0.1

    for terrain in ('sand', 'rock', 'swamp', 'water'):
        cells = {(x, y) for y, row in enumerate(tiles) for x, tile in enumerate(row)
                 if tile['terrain'] == terrain}
        remaining = set(cells)
        largest = 0
        while remaining:
            frontier = [remaining.pop()]
            size = 0
            while frontier:
                x, y = frontier.pop()
                size += 1
                for neighbor in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if neighbor in remaining:
                        remaining.remove(neighbor)
                        frontier.append(neighbor)
            largest = max(largest, size)
        assert largest >= len(cells) * 0.65


@pytest.mark.parametrize('map_type', ('random', 'predefined'))
@pytest.mark.parametrize('seed', (1, 2, 3, 4, 5))
def test_every_settlement_has_two_dry_road_entrances(map_type, seed):
    plan = world_plan(seed, 2, 2, map_type)
    for (x, y), kind in plan['sites'].items():
        if kind not in HABITATIONS:
            continue
        entrances = [
            (x + dx, y + dy)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))
            if (x + dx, y + dy) in plan['roads']
        ]
        assert len(entrances) >= 2
        for ex, ey in entrances:
            assert generated_world_tile(seed, ex, ey, 2, 2, map_type)['terrain'] != 'water'
