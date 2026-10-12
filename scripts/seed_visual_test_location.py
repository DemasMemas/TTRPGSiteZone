"""Build the visual sandbox in the existing Trava3 lobby.

Run: python -m scripts.seed_visual_test_location --lobby-id 19 --rebuild
"""

import argparse
import math

from app import create_app
from app.constants import CHUNK_SIZE
from app.extensions import db
from app.models.character import LobbyCharacter
from app.models.lobby import Lobby
from app.models.location import Location
from app.models.location_character import LocationCharacter
from app.models.location_combat import LocationCombatState
from app.models.location_object import LocationObject
from app.models.map_chunk import MapChunk
from app.services.anomaly_profiles import anomaly_catalog
from app.services.health import apply_health_maximums, health_zones_to_location
from app.services.location_lighting import normalize_location_lighting
from app.services.world_rules import mutant_character_data, mutant_profile


SCENE_NAME = 'Визуальный полигон'
SCENE_WIDTH = 38
SCENE_HEIGHT = 34
SCENE_DESCRIPTION = (
    'Полигон визуала: бар с окнами и дверями, склад, тёмный туннель, '
    'пять поверхностей, плавный холм и резкий уступ, четыре вида ламп и галерея всех аномалий.'
)


def _tiles():
    tiles = []
    for z in range(SCENE_HEIGHT):
        row = []
        for x in range(SCENE_WIDTH):
            height = round(1 + 0.08 * math.sin(x / 3) * math.cos(z / 4), 2)
            terrain = 'grass'
            if 3 <= x <= 16 and 3 <= z <= 15:
                terrain, height = 'rock', 1
            elif 20 <= x <= 35 and 2 <= z <= 18:
                terrain, height = 'rock', 1
            elif abs(z - (20 + math.sin(x / 4))) < 1.4:
                terrain, height = 'sand', 1
            elif x >= 25 and z >= 25:
                terrain = 'swamp'
            if 27 <= x <= 33 and 26 <= z <= 30 and math.hypot(x - 30, z - 28) < 3.4:
                terrain, height = 'water', 0.65
            if 10 <= x <= 18 and 24 <= z <= 31:
                terrain, height = 'rock', 1
            if 30 <= x <= 36 and 19 <= z <= 24:
                terrain, height = 'rock', 1
            hill_distance = math.hypot(x - 5, z - 20)
            if 2 <= x <= 9 and 17 <= z <= 23 and hill_distance < 4.5:
                height = round(1 + 1.4 * max(0, 1 - (hill_distance / 4.5) ** 2) ** 2, 2)
            if 22 <= x <= 26 and 21 <= z <= 24:
                height = 2.6
            row.append({'terrain': terrain, 'height': height, 'objects': [], 'radiation': 0})
        tiles.append(row)

    decor = (
        ('tree', 1, 2), ('tree', 1, 12), ('tree', 2, 25), ('tree', 7, 31),
        ('tree', 19, 22), ('tree', 22, 30), ('tree', 36, 23), ('tree', 36, 30),
        ('rock', 20, 25), ('rock', 23, 27), ('rock', 25, 22),
        ('tent', 4, 24), ('tent', 6, 25),
    )
    for kind, x, z in decor:
        tiles[z][x]['objects'].append({'type': kind})
    tiles[6][4]['objects'].append({
        'type': 'poster', 'x': 0.13, 'z': -0.36, 'elevation': 1.2,
        'rotation': 90, 'color': '#d9b97b',
        'dimensions': {'width': 0.8, 'depth': 0.035, 'height': 1.1},
    })

    colors = {
        'void': '#9a88c7', 'electric': '#7bc5ee', 'fire': '#f6a258',
        'radiation': '#a5c961', 'acid': '#a8d26e', 'psi': '#ba9bd2',
    }
    for index, anomaly in enumerate(anomaly_catalog()):
        x = 20 + (index % 8) * 2
        z = 2 + (index // 8) * 3
        visual = anomaly.get('visual') or 'void'
        tiles[z][x]['objects'].append({
            'type': 'anomaly', 'anomalyKey': anomaly['key'],
            'anomalyName': anomaly['name'], 'anomalyRank': anomaly.get('rank'),
            'anomalyCategory': anomaly.get('category'), 'anomalyType': visual,
            'color': colors.get(visual, '#9a88c7'), 'x': 0, 'z': 0,
        })
    tiles[11][34]['radiation'] = 2
    tiles[14][34]['radiation'] = 4
    return tiles


def _structures(location):
    structures = []

    def add(name, kind, x, z, width, depth, height, color, **extra):
        structures.append(LocationObject(
            location=location, name=name, type=kind, tile_x=x, tile_y=z,
            properties={
                'dimensions': {'width': width, 'depth': depth, 'height': height},
                'color': color, **extra,
            },
        ))

    add('Пол дома', 'floor', 9, 8, 13, 11, 0.12, '#827a70', offset_x=0.5, offset_z=0.5)
    add('Северная стена', 'wall', 9, 3, 13, 0.2, 2.5, '#746e63', offset_x=0.5)
    add('Южная стена', 'wall', 9, 14, 13, 0.2, 2.5, '#746e63', offset_x=0.5)
    add('Западная стена', 'wall', 3, 8, 11, 0.2, 2.5, '#746e63',
        rotation=math.pi / 2, offset_z=0.5)
    add('Восточная стена', 'wall', 16, 8, 11, 0.2, 2.5, '#746e63',
        rotation=math.pi / 2, offset_z=0.5)
    add('Главная дверь', 'door', 9, 14, 0.9, 0.18, 2.1, '#75583e', is_open=False)
    add('Дверь склада', 'door', 16, 9, 0.9, 0.18, 2.1, '#75583e',
        rotation=math.pi / 2, is_open=False)
    add('Окно бара', 'window', 6, 3, 1.2, 0.14, 1.1, '#a9c4cf', elevation=1, is_open=True)
    add('Окно склада', 'window', 12, 3, 1.2, 0.14, 1.1, '#a9c4cf', elevation=1, is_open=False)
    add('Боковое окно', 'window', 16, 6, 1.2, 0.14, 1.1, '#a9c4cf',
        rotation=math.pi / 2, elevation=1, is_open=True)
    add('Барная стойка', 'table', 7, 6, 3, 0.8, 1, '#775139')
    for x, z in ((6, 10), (11, 10)):
        add('Стол', 'table', x, z, 1.2, 0.85, 0.8, '#806044')
        add('Стул', 'chair', x + 1, z, 0.55, 0.55, 1, '#74563d')
    add('Стеллаж', 'shelf', 14, 6, 1.2, 0.4, 2, '#78634c')
    add('Военный ящик', 'military_crate', 12, 11, 1.1, 0.8, 0.65, '#45543a', contents=[])
    for x, z in ((5, 5), (13, 5), (17, 20)):
        add('Бочка', 'barrel', x, z, 0.65, 0.65, 1, '#8a6444', weight_kg=40)
    for x, z in ((17, 8), (18, 8), (23, 24)):
        add('Ящик', 'box', x, z, 0.8, 0.8, 0.7, '#8b6b4f', weight_kg=25, contents=[])
    for z in range(5, 18, 3):
        add('Ограждение аномалий', 'fence', 18, z, 2.2, 0.15, 1.2, '#8b7458', rotation=math.pi / 2)
    add('Северная стена туннеля', 'wall', 14, 24, 8, 0.2, 2.5, '#575c5b')
    add('Южная стена туннеля', 'wall', 14, 30, 8, 0.2, 2.5, '#575c5b')
    add('Западная стена туннеля', 'wall', 10, 27, 6, 0.2, 2.5, '#575c5b', rotation=math.pi / 2)
    add('Восточная стена туннеля', 'wall', 18, 27, 6, 0.2, 2.5, '#575c5b', rotation=math.pi / 2)
    add('Дверь туннеля', 'door', 14, 24, 0.9, 0.18, 2.1, '#646861', is_open=True)
    add('Пол туннеля', 'floor', 14, 27, 8, 6, 0.12, '#555958')
    add('Пол малого дома', 'floor', 33, 21, 4, 4, 0.12, '#756b5d')
    add('Северная стена малого дома', 'wall', 33, 19, 4, 0.2, 2.3, '#867e70')
    add('Южная стена малого дома', 'wall', 33, 23, 4, 0.2, 2.3, '#867e70')
    add('Западная стена малого дома', 'wall', 31, 21, 4, 0.2, 2.3, '#867e70', rotation=math.pi / 2)
    add('Восточная стена малого дома', 'wall', 35, 21, 4, 0.2, 2.3, '#867e70', rotation=math.pi / 2)
    add('Дверь малого дома', 'door', 33, 23, 0.9, 0.18, 2.1, '#75583e', is_open=True)
    add('Окно малого дома', 'window', 33, 19, 1.2, 0.14, 1.1, '#a9c4cf', elevation=1)
    add('Костёр', 'campfire', 6, 27, 0.9, 0.9, 0.7, '#74604b', is_lit=True)
    add('Факел', 'torch', 32, 21, 0.25, 0.25, 1.7, '#6b4a30', is_lit=True)
    add('Бочка с огнём', 'fire_barrel', 23, 19, 0.72, 0.72, 0.78, '#5f625c', is_lit=True)
    return structures


def _lighting():
    dark_tiles = [
        {'x': x, 'z': z}
        for x in range(4, 16) for z in range(4, 14)
    ] + [
        {'x': x, 'z': z}
        for x in range(11, 18) for z in range(25, 30)
    ]
    return normalize_location_lighting({
        'mode': 'manual',
        'ambient_color': '#aab6bd', 'ambient_intensity': 0.55,
        'directional_color': '#fff0d5', 'directional_intensity': 0.75,
        'directional_azimuth': 50, 'directional_elevation': 58,
        'background_color': '#445467',
        'dark_tiles': dark_tiles,
        'local_lights': [
            {'x': 7.5, 'z': 7.5, 'height': 2.2, 'color': '#ffd090', 'intensity': 2.5, 'distance': 6},
            {'x': 12.5, 'z': 11.5, 'height': 2.2, 'color': '#ffd090', 'intensity': 2.2, 'distance': 5},
            {'x': 18.5, 'z': 22.5, 'height': 2.2, 'color': '#a9d9ff', 'intensity': 2.5, 'distance': 7},
            {'x': 12.5, 'z': 26.5, 'height': 1.8, 'color': '#ff674f', 'intensity': 1.6, 'distance': 4},
            {'x': 18.5, 'z': 19.5, 'height': 2.6, 'color': '#fff0c8', 'intensity': 4,
             'distance': 12, 'kind': 'spot', 'azimuth': 0},
        ],
    }, SCENE_WIDTH, SCENE_HEIGHT)


def _test_participants(location, gm_id):
    roster = (
        ('scout', 'Полигон: разведчик', None, 8, 19, 'Испытатели', '#68b8bd'),
        ('keeper', 'Полигон: смотритель', None, 8, 9, 'Испытатели', '#68b8bd'),
        ('dog', 'Полигон: собака', 'Собака', 18, 22, 'Мутанты', '#c46f54'),
        ('blind', 'Полигон: слепыш', 'Слепыш', 25, 25, 'Мутанты', '#c46f54'),
        ('bloodsucker', 'Полигон: кровопийца', 'Кровопийца', 16, 28, 'Мутанты', '#c46f54'),
    )
    existing = {
        character.data.get('_visual_test_role'): character
        for character in LobbyCharacter.query.filter_by(lobby_id=location.lobby_id).all()
        if (character.data or {}).get('_visual_test_scene') == location.name
    }
    for role, name, mutant_type, x, z, team, color in roster:
        character = existing.get(role)
        if character is None:
            if mutant_type:
                data = mutant_character_data(mutant_profile(mutant_type))
            else:
                data = {'basic': {'species': 'Человек', 'is_npc': True},
                        'is_npc': True, 'inventory': {'pockets': [], 'backpack': []}}
                apply_health_maximums(data)
            data['_visual_test_scene'] = location.name
            data['_visual_test_role'] = role
            character = LobbyCharacter(
                lobby_id=location.lobby_id, owner_id=gm_id, name=name,
                data=data, visible_to=[], editable_to=[], time_active=False,
            )
            db.session.add(character)
            db.session.flush()
        db.session.add(LocationCharacter(
            location_id=location.id, character_id=character.id,
            pos_x=x, pos_y=z, team_name=team, team_color=color,
            hp_zones=health_zones_to_location((character.data or {}).get('health') or {}),
        ))


def _populate(location, lobby, *, commit=True):
    combat = LocationCombatState.query.filter_by(location_id=location.id).first()
    if combat and combat.status != 'idle':
        raise ValueError('Stop combat in the visual sandbox before rebuilding it')
    participants = LocationCharacter.query.filter_by(location_id=location.id).all()
    if any((entry.character.data or {}).get('_visual_test_scene') != location.name for entry in participants):
        raise ValueError('The visual sandbox contains non-test characters; move them out first')
    for entry in participants:
        db.session.delete(entry)
    db.session.flush()
    for obj in LocationObject.query.filter_by(location_id=location.id).all():
        db.session.delete(obj)
    db.session.flush()
    db.session.expire(location, ['objects'])
    location.grid_width = SCENE_WIDTH
    location.grid_height = SCENE_HEIGHT
    location.tiles_data = _tiles()
    location.lighting = _lighting()
    location.description = SCENE_DESCRIPTION
    location.spawn_points = [{'x': 8, 'y': 19}]
    db.session.add_all(_structures(location))
    db.session.flush()
    _test_participants(location, lobby.gm_id)
    if commit:
        db.session.commit()


def create_visual_test_location(lobby_id):
    lobby = db.session.get(Lobby, lobby_id)
    if lobby is None or lobby.name != 'Трава3':
        raise ValueError('Expected the selected existing Trava3 lobby')
    existing = Location.query.filter_by(lobby_id=lobby.id, name=SCENE_NAME).first()
    if existing:
        return existing, False

    center_x = lobby.chunks_width * CHUNK_SIZE // 2
    center_z = lobby.chunks_height * CHUNK_SIZE // 2
    center_chunk = MapChunk.query.filter_by(
        lobby_id=lobby.id, chunk_x=center_x // CHUNK_SIZE,
        chunk_y=center_z // CHUNK_SIZE,
    ).first()
    if center_chunk is None:
        raise ValueError('The center chunk does not exist; the world map was not changed')
    if Location.query.filter_by(lobby_id=lobby.id, world_tile_x=center_x, world_tile_z=center_z).first():
        raise ValueError('The center tile already has a location marker')
    location = Location(
        lobby_id=lobby.id, name=SCENE_NAME, description=SCENE_DESCRIPTION,
        type='exploration', grid_width=SCENE_WIDTH, grid_height=SCENE_HEIGHT,
        tiles_data=_tiles(), lighting=_lighting(),
        world_tile_x=center_x, world_tile_z=center_z, world_radius=0,
        spawn_points=[{'x': 8, 'y': 19}],
    )
    db.session.add(location)
    db.session.flush()
    _populate(location, lobby)
    return location, True


def rebuild_visual_test_location(lobby_id):
    lobby = db.session.get(Lobby, lobby_id)
    if lobby is None or lobby.name != 'Трава3':
        raise ValueError('Expected the selected existing Trava3 lobby')
    location = Location.query.filter_by(lobby_id=lobby.id, name=SCENE_NAME).first()
    if location is None:
        return create_visual_test_location(lobby_id)
    _populate(location, lobby)
    return location, False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lobby-id', type=int, required=True)
    parser.add_argument('--rebuild', action='store_true')
    args = parser.parse_args()
    app = create_app()
    with app.app_context():
        try:
            location, created = (
                rebuild_visual_test_location(args.lobby_id) if args.rebuild
                else create_visual_test_location(args.lobby_id)
            )
        except Exception:
            db.session.rollback()
            raise
        state = 'Created' if created else 'Rebuilt' if args.rebuild else 'Already exists'
        print(f'{state}: location {location.id}, lobby {location.lobby_id}, '
              f'world tile ({location.world_tile_x}, {location.world_tile_z})')


if __name__ == '__main__':
    main()
