"""Repair generated layout/furniture in the new quarter only. Preview by default; --apply saves."""
import argparse
import json
from pathlib import Path
import subprocess

from app import create_app
from app.extensions import db
from app.models import Location, LocationObject
from app.models.location_character import LocationCharacter


def repair(apply=False):
    location = db.session.get(Location, 24)
    if not location or location.lobby_id != 19 or location.name != 'Припять — заросший квартал':
        raise ValueError('Expected saved Pripyat quarter 24 in Trava3')
    if LocationCharacter.query.filter_by(location_id=24).first():
        raise ValueError('Quarter has characters; cannot safely rearrange partitions')
    objects = LocationObject.query.filter_by(location_id=24).with_for_update().all()
    data = {'tiles': location.tiles_data, 'objects': [dict(id=o.id, revision=o.revision,
            name=o.name, type=o.type, tile_x=o.tile_x, tile_y=o.tile_y, properties=o.properties) for o in objects]}
    result = subprocess.run(['node', str(Path(__file__).with_suffix('.cjs'))], input=json.dumps(data),
                            capture_output=True, text=True, encoding='utf-8', check=True)
    plan = json.loads(result.stdout)
    by_id = {o.id: o for o in objects}
    assert set(plan['deletedIds']) <= by_id.keys()
    for spec in plan['added']:
        assert 0 <= spec['tile_x'] < location.grid_width and 0 <= spec['tile_y'] < location.grid_height
    report = dict(deleted=len(plan['deletedIds']), added=len(plan['added']), updates=len(plan['updates']), applied=apply)
    if apply:
        for object_id in plan['deletedIds']:
            db.session.delete(by_id[object_id])
        for spec in plan['updates']:
            by_id[spec['id']].properties = spec['properties']
        for spec in plan['added']:
            db.session.add(LocationObject(location_id=24, **spec))
        db.session.commit()
    else:
        db.session.rollback()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with create_app('development').app_context():
        try:
            print(json.dumps(repair(args.apply)))
        except Exception:
            db.session.rollback()
            raise
