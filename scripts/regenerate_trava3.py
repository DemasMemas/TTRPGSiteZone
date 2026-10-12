"""Regenerate the saved Trava3 world and create a new visual sandbox.

Run: python -m scripts.regenerate_trava3
"""

from app import create_app
from app.constants import CHUNK_SIZE
from app.extensions import db
from app.models.lobby import Lobby
from app.models.location import Location
from app.models.map_chunk import MapChunk
from app.services.map import MapService
from scripts.seed_visual_test_location import (
    SCENE_DESCRIPTION, SCENE_HEIGHT, SCENE_NAME, SCENE_WIDTH,
    _lighting, _populate, _tiles,
)


LOBBY_ID = 19
NEW_SCENE_NAME = f'{SCENE_NAME} 2'


def _new_marker(lobby, chunks):
    center_x = lobby.chunks_width * CHUNK_SIZE // 2
    center_z = lobby.chunks_height * CHUNK_SIZE // 2
    occupied = {
        (location.world_tile_x, location.world_tile_z)
        for location in Location.query.filter_by(lobby_id=lobby.id).all()
    }
    candidates = (
        (x, z)
        for x in range(center_x + 8, center_x + 25)
        for z in range(center_z + 8, center_z + 25)
    )
    for x, z in sorted(candidates, key=lambda pos: (abs(pos[0] - center_x - 12)
                                                  + abs(pos[1] - center_z - 12), pos)):
        tile = chunks[(x // CHUNK_SIZE, z // CHUNK_SIZE)].data[z % CHUNK_SIZE][x % CHUNK_SIZE]
        if (x, z) not in occupied and tile.get('terrain') == 'grass' and not tile.get('objects'):
            return x, z
    raise ValueError('No empty grass tile near the map center for the new sandbox')


def regenerate_trava3():
    lobby = db.session.get(Lobby, LOBBY_ID)
    if lobby is None or lobby.name != 'Трава3' or lobby.map_type not in {'random', 'predefined'}:
        raise ValueError('Expected random or predefined Trava3 lobby ID 19')
    if Location.query.filter_by(lobby_id=LOBBY_ID, name=NEW_SCENE_NAME).first():
        raise ValueError('The new visual sandbox already exists; refusing to overwrite it')
    chunks = {
        (chunk.chunk_x, chunk.chunk_y): chunk
        for chunk in MapChunk.query.filter_by(lobby_id=LOBBY_ID).all()
    }
    expected = {
        (x, y)
        for x in range(lobby.chunks_width)
        for y in range(lobby.chunks_height)
    }
    if chunks.keys() != expected:
        raise ValueError('Trava3 chunk set is incomplete or contains unexpected coordinates')

    for chunk_x, chunk_y in sorted(expected):
        chunks[chunk_x, chunk_y].data = MapService._generate_chunk_data(
            LOBBY_ID, chunk_x, chunk_y, lobby.map_type)
    marker = _new_marker(lobby, chunks)
    location = Location(
        lobby_id=lobby.id, name=NEW_SCENE_NAME, description=SCENE_DESCRIPTION,
        type='exploration', grid_width=SCENE_WIDTH, grid_height=SCENE_HEIGHT,
        tiles_data=_tiles(), lighting=_lighting(),
        world_tile_x=marker[0], world_tile_z=marker[1], world_radius=0,
        spawn_points=[{'x': 8, 'y': 19}],
    )
    db.session.add(location)
    db.session.flush()
    _populate(location, lobby, commit=False)
    db.session.commit()
    return len(chunks), location.id, marker


def main():
    app = create_app()
    with app.app_context():
        try:
            count, location_id, marker = regenerate_trava3()
        except Exception:
            db.session.rollback()
            raise
        print(f'Regenerated Trava3 lobby {LOBBY_ID}: {count} chunks, '
              f'visual sandbox {location_id}, marker {marker}')


if __name__ == '__main__':
    main()
