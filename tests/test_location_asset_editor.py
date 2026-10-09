from app.services.combat import CombatService
from types import SimpleNamespace
from unittest.mock import patch

from app.models import LocationCharacter, LocationObject


def test_wall_poster_is_decor_not_cover_or_collision():
    poster = {'type': 'poster', 'elevation': 1.6, 'z': 0.13}

    assert CombatService._object_movement_profile(poster) == {
        'blocked': False,
        'climb_cost': 0,
    }


def test_free_structure_offsets_and_open_door_match_wall():
    wall = SimpleNamespace(type='wall', tile_x=1, tile_y=1, properties={
        'dimensions': {'width': 3, 'depth': 0.2, 'height': 2.4},
        'rotation': 0,
    })
    door = SimpleNamespace(type='door', tile_x=1, tile_y=1, properties={
        'dimensions': {'width': 0.9, 'depth': 0.18, 'height': 2},
        'rotation': 0, 'is_open': True,
    })
    assert CombatService._door_is_in_wall(door, wall)
    assert CombatService._object_footprint_tiles(door) == {(1, 1)}
    assert CombatService._object_footprint_tiles(wall) == {(0, 1), (1, 1), (2, 1)}
    shooter = SimpleNamespace(pos_x=1, pos_y=0)
    target = SimpleNamespace(pos_x=1, pos_y=2)
    assert CombatService._line_through_door(shooter, target, door, wall, 1.3)
    assert not CombatService._line_through_door(shooter, target, door, wall, 2.2)
    off_axis = SimpleNamespace(pos_x=0, pos_y=2)
    assert not CombatService._line_through_door(shooter, off_axis, door, wall, 1.3)
    door.properties['offset_x'] = 0.4
    assert CombatService._object_footprint_tiles(door) == {(1, 1), (2, 1)}
    door.properties['offset_z'] = 1
    assert not CombatService._door_is_in_wall(door, wall)
    door.properties['offset_z'] = 0
    door.properties['elevation'] = 2
    assert not CombatService._door_is_in_wall(door, wall)


def test_open_door_clears_wall_tile_from_movement_map(app):
    wall = SimpleNamespace(type='wall', tile_x=1, tile_y=1, properties={
        'dimensions': {'width': 3, 'depth': 0.2, 'height': 2.4}, 'rotation': 0,
    })
    door = SimpleNamespace(type='door', tile_x=1, tile_y=1, properties={
        'dimensions': {'width': 0.9, 'depth': 0.18, 'height': 2}, 'rotation': 0, 'is_open': True,
    })
    location = SimpleNamespace(id=10, tiles_data=[])
    with patch.object(LocationObject, 'query') as objects_query, patch.object(LocationCharacter, 'query') as characters_query:
        objects_query.filter_by.return_value.all.return_value = [wall, door]
        characters_query.filter_by.return_value.all.return_value = []
        blocked, _ = CombatService._build_movement_map(location)
        assert blocked == {(0, 1), (2, 1)}
        door.properties['is_open'] = False
        blocked, _ = CombatService._build_movement_map(location)
        assert blocked == {(0, 1), (1, 1), (2, 1)}
