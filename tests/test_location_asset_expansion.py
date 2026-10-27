"""New purposes use the real server navigation and the existing saved objects."""
from types import SimpleNamespace as N
from unittest.mock import patch

import pytest

from app.models import LocationObject, LocationCharacter
from app.services.combat import CombatService
from app.services.location_navigation import find_path
from test_location_furniture import furniture


@pytest.mark.parametrize('purpose', ['workshop', 'cafe', 'clinic', 'office', 'school', 'garage', 'bathhouse'])
@pytest.mark.parametrize('condition', ['intact', 'damaged'])
def test_new_purposes_keep_room_routes_and_floor_connections(app, purpose, condition):
    data = furniture(shellOptions=dict(width=16, depth=16, storeys=2, basements=1,
                                      buildingType=purpose, condition=condition, wealth='rich'))
    source = [N(**o) for o in data['source']]
    for o in source:
        if o.type == 'hatch':
            o.properties['is_open'] = True
    bare = [o for o in source if not o.properties.get('layout_generation')]
    complete = source + [N(id=10000+i, **o) for i, o in enumerate(data['plan']['objects'])]
    loc = N(id=1, grid_width=22, grid_height=22,
            tiles_data=[[{'height': 1} for _ in range(22)] for _ in range(22)])
    entry = next(o for o in source if o.type == 'door' and o.properties.get('building_generation'))
    anchor = (entry.tile_x, entry.tile_y+1)
    with patch.object(LocationObject, 'query') as oq, patch.object(LocationCharacter, 'query') as cq:
        cq.filter_by.return_value.all.return_value = []
        oq.filter_by.return_value.all.return_value = bare
        before = {l: CombatService._build_movement_map(loc, floor_level=l) for l in [-1, 0, 1]}
        oq.filter_by.return_value.all.return_value = complete
        after = {l: CombatService._build_movement_map(loc, floor_level=l) for l in [-1, 0, 1]}
        for room in data['rooms']:
            level = room['level']
            candidates = [(c['x'], c['z'], level) for c in room['cells']]
            if any(find_path(loc, bare, (*anchor, level), p, lambda l: before[l]) for p in candidates):
                assert any(find_path(loc, complete, (*anchor, level), p, lambda l: after[l]) for p in candidates), (purpose, condition, room['name'])
        for a, b in [((*anchor, -1), (*anchor, 0)), ((*anchor, 0), (*anchor, 1))]:
            if find_path(loc, bare, a, b, lambda l: before[l]):
                assert find_path(loc, complete, a, b, lambda l: after[l]), (purpose, condition, a, b)
