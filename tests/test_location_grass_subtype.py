from types import SimpleNamespace
from unittest.mock import patch

from app.sockets.location import handle_update_location_tiles


def test_grass_subtype_persists_and_clears_when_terrain_changes(app):
    tile = {'terrain': 'grass', 'height': 1.0, 'objects': []}
    location = SimpleNamespace(tiles_data=[[tile]], lobby=SimpleNamespace(gm_id=7))
    user = SimpleNamespace(id=7)

    with patch('app.sockets.location.get_user_from_token', return_value=user), \
         patch('app.sockets.location.Location.query') as query, \
         patch('app.sockets.location.flag_modified'), \
         patch('app.sockets.location.db.session.commit') as commit, \
         patch('app.sockets.location.socketio.emit') as emit:
        query.get.return_value = location
        handle_update_location_tiles({
            'token': 'token', 'location_id': 1,
            'updates': [{'x': 0, 'z': 0, 'terrain': 'grass', 'grass_subtype': 'forest'}],
        })
        assert location.tiles_data[0][0]['grass_subtype'] == 'forest'
        assert emit.call_args.args[1]['updates'][0]['grass_subtype'] == 'forest'

        handle_update_location_tiles({
            'token': 'token', 'location_id': 1,
            'updates': [{'x': 0, 'z': 0, 'terrain': 'sand', 'grass_subtype': None}],
        })
        assert 'grass_subtype' not in location.tiles_data[0][0]
        assert emit.call_args.args[1]['updates'][0]['grass_subtype'] is None
        assert commit.call_count == 2


def test_negative_location_height_is_saved_and_broadcast(app):
    tile = {'terrain': 'sand', 'height': 1.0, 'objects': []}
    location = SimpleNamespace(tiles_data=[[tile]], lobby=SimpleNamespace(gm_id=7))
    user = SimpleNamespace(id=7)

    with patch('app.sockets.location.get_user_from_token', return_value=user), \
         patch('app.sockets.location.Location.query') as query, \
         patch('app.sockets.location.flag_modified') as flag_modified, \
         patch('app.sockets.location.db.session.commit') as commit, \
         patch('app.sockets.location.has_request_context', return_value=True), \
         patch('app.sockets.location.request', SimpleNamespace(sid='editing-client')), \
         patch('app.sockets.location.socketio.emit') as emit:
        query.get.return_value = location
        handle_update_location_tiles({
            'token': 'token', 'location_id': 1,
            'updates': [{'x': 0, 'z': 0, 'height': -3.0}],
        })
        assert location.tiles_data[0][0]['height'] == -3.0
        assert emit.call_args.args[1]['updates'][0]['height'] == -3.0
        assert emit.call_args.kwargs['skip_sid'] == 'editing-client'
        flag_modified.assert_called_once_with(location, 'tiles_data')
        commit.assert_called_once()
