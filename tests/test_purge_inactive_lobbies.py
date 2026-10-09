import pytest

from app.extensions import db
from app.models import Lobby, MapChunk
from scripts.purge_inactive_lobbies import purge_inactive_lobbies


def test_purge_requires_exact_ids_and_preserves_active_lobby(client, create_user, auth_headers):
    gm = create_user('purge-gm')
    ids = []
    for name in ('Keep', 'Discard'):
        response = client.post('/lobbies/', headers=auth_headers(gm), json={
            'name': name, 'map_type': 'empty', 'chunks_width': 1, 'chunks_height': 1,
        })
        assert response.status_code == 201
        ids.append(response.get_json()['id'])
    db.session.get(Lobby, ids[1]).is_active = False
    db.session.commit()

    dry_ids, counts = purge_inactive_lobbies()
    assert dry_ids == [ids[1]]
    assert counts['map_chunks'] == MapChunk.query.filter_by(lobby_id=ids[1]).count()
    with pytest.raises(ValueError):
        purge_inactive_lobbies(expected_ids=[ids[0]], apply=True)
    assert db.session.get(Lobby, ids[1]) is not None

    purged_ids, _ = purge_inactive_lobbies(expected_ids=[ids[1]], apply=True)
    assert purged_ids == [ids[1]]
    assert db.session.get(Lobby, ids[0]) is not None
    assert db.session.get(Lobby, ids[1]) is None
