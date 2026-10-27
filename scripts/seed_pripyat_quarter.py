"""Add a new editable quarter, without rebuilding any existing scene or world tile.

Preview: python -m scripts.seed_pripyat_quarter
Create:  python -m scripts.seed_pripyat_quarter --create
"""
import argparse
import json
from pathlib import Path
import subprocess

from app import create_app
from app.constants import CHUNK_SIZE
from app.extensions import db
from app.models import Lobby, Location, LocationObject, MapChunk
from app.services.location_lighting import normalize_location_lighting


def prepare():
    result = subprocess.run(['node', str(Path(__file__).with_name('pripyat_quarter.cjs'))],
                            check=True, capture_output=True, encoding='utf-8')
    scene = json.loads(result.stdout)
    assert {b['purpose'] for b in scene['buildings']} == {
        'residential', 'school', 'cafe', 'office', 'clinic', 'workshop', 'garage', 'bathhouse'}
    assert len({b['buildingId'] for b in scene['buildings']}) == 9
    for obj in scene['objects']:
        assert 0 <= obj['tile_x'] < scene['width'] and 0 <= obj['tile_y'] < scene['height']
        assert len(obj['name']) <= 100 and len(obj['type']) <= 50
    return scene


def save(scene, create=False):
    lobby = db.session.get(Lobby, 19)
    if not lobby or lobby.name != 'Трава3':
        raise ValueError('Expected existing Trava3 lobby 19')
    if Location.query.filter_by(lobby_id=19, name=scene['name']).first():
        raise ValueError('Quarter already exists; refusing to overwrite')
    locations = Location.query.filter_by(lobby_id=19).all()
    chunks = {(c.chunk_x, c.chunk_y): c for c in MapChunk.query.filter_by(lobby_id=19).all()}
    cx, cz = lobby.chunks_width * CHUNK_SIZE // 2, lobby.chunks_height * CHUNK_SIZE // 2
    marker = None
    candidates = sorted(((x, z) for x in range(cx+8, cx+25) for z in range(cz+8, cz+25)),
                        key=lambda p: (abs(p[0]-cx-12)+abs(p[1]-cz-12), p))
    for x, z in candidates:
        chunk = chunks.get((x//CHUNK_SIZE, z//CHUNK_SIZE))
        if not chunk or any(abs(x-l.world_tile_x) <= (l.world_radius or 0)
                            and abs(z-l.world_tile_z) <= (l.world_radius or 0) for l in locations):
            continue
        tile = chunk.data[z % CHUNK_SIZE][x % CHUNK_SIZE]
        if tile.get('terrain') == 'grass' and not tile.get('objects'):
            marker = x, z
            break
    if marker is None:
        raise ValueError('No free grass marker near map center')
    report = {'name': scene['name'], 'marker': marker, 'buildings': len(scene['buildings']),
              'objects': len(scene['objects']), 'created': create}
    if not create:
        return report
    location = Location(lobby_id=19, name=scene['name'], description=scene['description'],
                        type='exploration', grid_width=scene['width'], grid_height=scene['height'],
                        tiles_data=scene['tiles'], spawn_points=scene['spawn_points'],
                        world_tile_x=marker[0], world_tile_z=marker[1], world_radius=0,
                        lighting=normalize_location_lighting({'mode':'manual',
                            'ambient_color':'#b5b7ad','ambient_intensity':.7,
                            'directional_color':'#fff1d9','directional_intensity':.85,
                            'directional_azimuth':135,'directional_elevation':48,
                            'background_color':'#a8b4b8','dark_tiles':[], 'local_lights':[]},
                            scene['width'],scene['height']))
    db.session.add(location)
    db.session.flush()
    db.session.add_all(LocationObject(location_id=location.id, name=o['name'], type=o['type'],
                      tile_x=o['tile_x'], tile_y=o['tile_y'], properties=o['properties'])
                      for o in scene['objects'])
    db.session.flush()
    report['location_id'] = location.id
    db.session.commit()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--create', action='store_true')
    args = parser.parse_args()
    scene = prepare()
    with create_app('development').app_context():
        try:
            print(json.dumps(save(scene, args.create), ensure_ascii=True))
        except Exception:
            db.session.rollback()
            raise
