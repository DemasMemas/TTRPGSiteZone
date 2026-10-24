import copy

import pytest

from app.extensions import db
from app.models import MapChunk


@pytest.fixture
def fence_case(client, create_user, auth_headers):
    gm = create_user()
    headers = auth_headers(gm)
    lobby = client.post('/lobbies/', headers=headers, json={
        'name': 'Fence test', 'map_type': 'empty', 'chunks_width': 2, 'chunks_height': 1,
    }).get_json()
    lobby_id = lobby['id']
    response = client.get(f'/lobbies/{lobby_id}/chunks?min_chunk_x=0&max_chunk_x=1&min_chunk_y=0&max_chunk_y=0', headers=headers)
    assert response.status_code == 200
    return lobby_id, headers, gm


def packet():
    return [dict(chunk_x=x, chunk_y=0, tile_x=31 if x == 0 else 0, tile_y=12,
                 expected_objects=[], updates={'objects': [{'type': 'fence', 'scale': 1, 'rotation': 90, 'x': 0, 'z': 0}]} )
            for x in (0, 1)]


def test_guarded_line_saves_both_chunks_and_preserves_legacy_batch_format(client, fence_case):
    lobby, headers, _ = fence_case
    assert client.post(f'/lobbies/{lobby}/chunks/batch', headers=headers, json=packet()).status_code == 200
    for x in (0, 1):
        row = MapChunk.query.filter_by(lobby_id=lobby, chunk_x=x, chunk_y=0).first()
        assert row.data[12][31 if x == 0 else 0]['objects'][0]['type'] == 'fence'
    # Ordinary brushes still use their original packet without a guard.
    response = client.post(f'/lobbies/{lobby}/chunks/batch', headers=headers,
        json=[dict(chunk_x=0, chunk_y=0, tile_x=2, tile_y=2, updates={'height': 1.4})])
    assert response.status_code == 200


def test_stale_line_rejects_every_chunk_and_keeps_other_clients_object(client, fence_case):
    lobby, headers, _ = fence_case
    response = client.patch(f'/lobbies/{lobby}/chunks/1/0/tile/0/12', headers=headers,
        json={'objects': [{'type': 'tree', 'name': 'Keep me'}]})
    assert response.status_code == 200
    assert client.post(f'/lobbies/{lobby}/chunks/batch', headers=headers, json=packet()).status_code == 409
    db.session.expire_all()
    assert not MapChunk.query.filter_by(lobby_id=lobby, chunk_x=0, chunk_y=0).first().data[12][31]['objects']
    assert MapChunk.query.filter_by(lobby_id=lobby, chunk_x=1, chunk_y=0).first().data[12][0]['objects'][0]['name'] == 'Keep me'


def test_changed_water_or_invalid_guard_never_partially_builds(client, fence_case):
    lobby, headers, _ = fence_case
    client.patch(f'/lobbies/{lobby}/chunks/1/0/tile/0/12', headers=headers, json={'terrain': 'water'})
    assert client.post(f'/lobbies/{lobby}/chunks/batch', headers=headers, json=packet()).status_code == 409
    client.patch(f'/lobbies/{lobby}/chunks/1/0/tile/0/12', headers=headers, json={'terrain': 'grass'})
    broken = copy.deepcopy(packet())
    broken[-1]['tile_x'] = 32
    assert client.post(f'/lobbies/{lobby}/chunks/batch', headers=headers, json=broken).status_code == 400
    assert not MapChunk.query.filter_by(lobby_id=lobby, chunk_x=0, chunk_y=0).first().data[12][31]['objects']


def test_non_gm_cannot_place_guarded_fence(client, fence_case, create_user, auth_headers):
    lobby, _, _ = fence_case
    player = create_user()
    response = client.post(f'/lobbies/{lobby}/chunks/batch', headers=auth_headers(player), json=packet())
    assert response.status_code in (403, 404)
