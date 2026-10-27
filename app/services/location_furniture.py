"""Validation for scoped, atomic replacement of unchanged generated furniture."""
from app.models import LocationObject, LocationCharacter
from app.services.combat import CombatService
from app.services.exceptions import ConflictError, ValidationError
from app.services.location_navigation import level_of


FURNITURE_TYPES = {
    'table', 'chair', 'shelf', 'household_bed_single', 'household_bed_double',
    'household_nightstand', 'household_wardrobe', 'household_dresser',
    'household_stool', 'household_armchair', 'household_storage_rack',
    'household_refrigerator', 'household_cooker', 'household_kitchen_cabinet',
    'household_sink', 'household_washbasin', 'household_toilet',
    'household_bathtub', 'household_wood_stove', 'household_generator',
    'household_wood_crate', 'household_cardboard_box', 'household_jerrycan',
}


def original_furniture(obj):
    if isinstance(obj, dict):
        values = {k: obj.get(k) for k in ('name', 'type', 'tile_x', 'tile_y')}
        properties = obj.get('properties') or {}
    else:
        values = {k: getattr(obj, k) for k in ('name', 'type', 'tile_x', 'tile_y')}
        properties = obj.properties or {}
    return {**values, 'properties': {k: v for k, v in properties.items() if k != 'furniture_generation'}}


def validate_furniture_replacement(location, replacement, specs):
    if (not isinstance(replacement, dict) or not isinstance(replacement.get('building_id'), str)
            or not replacement['building_id'].strip() or replacement.get('scope') not in {'room', 'floor', 'building'}
            or type(replacement.get('level')) is not int):
        raise ValidationError('Furniture replacement requires building, scope and integer level')
    if replacement['scope'] == 'room' and (not isinstance(replacement.get('room_id'), str) or not replacement['room_id']):
        raise ValidationError('Room furniture replacement requires room_id')
    ids, versions = replacement.get('object_ids'), replacement.get('source_versions')
    if (not isinstance(ids, list) or len(ids) > 5000 or any(type(i) is not int for i in ids)
            or len(ids) != len(set(ids))):
        raise ValidationError('Furniture replacement requires unique object IDs')
    if (not isinstance(versions, list) or len(versions) > 50000
            or any(not isinstance(pair, list) or len(pair) != 2 or any(type(v) is not int for v in pair) for pair in versions)):
        raise ValidationError('Furniture replacement requires source revisions')
    current = LocationObject.query.filter_by(location_id=location.id).all()
    if sorted(versions) != sorted([[o.id, o.revision] for o in current]):
        raise ConflictError('Обстановка изменилась. Повторите предпросмотр меблировки.')

    def belongs(properties):
        tag = properties.get('furniture_generation')
        return (properties.get('building_id') == replacement['building_id'] and isinstance(tag, dict)
                and tag.get('version') == 1 and (replacement['scope'] == 'building'
                or properties.get('level', 0) == replacement['level'] and (replacement['scope'] == 'floor'
                or tag.get('room_id') == replacement['room_id'])))

    deleted = [o for o in current if o.type in FURNITURE_TYPES and belongs(o.properties or {})
               and o.properties['furniture_generation'].get('original') == original_furniture(o)]
    if {o.id for o in deleted} != set(ids):
        raise ConflictError('Заменять можно только неизменённую мебель генератора в выбранной области.')
    actors = LocationCharacter.query.filter_by(location_id=location.id).all()
    for spec in specs:
        props = spec.get('properties') or {}
        if (spec.get('type') not in FURNITURE_TYPES or not belongs(props)
                or type(props.get('level')) is not int
                or props['furniture_generation'].get('original') != original_furniture(spec)):
            raise ValidationError('Replacement must contain only generated furniture in the selected scope')
        footprint = CombatService._object_footprint_tiles(spec)
        if any(level_of(spec) == (a.floor_level or 0) and (a.pos_x, a.pos_y) in footprint for a in actors):
            raise ConflictError('Мебель пересекается с персонажем. Переместите его и повторите предпросмотр.')
    return deleted
