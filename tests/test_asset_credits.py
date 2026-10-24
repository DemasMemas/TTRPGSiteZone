import json
from pathlib import Path
from urllib.parse import urlparse


def test_registry_has_unique_ids_and_known_statuses(app):
    assets = json.loads((Path(app.root_path) / 'data/asset_credits.json').read_text(encoding='utf-8'))
    assert len({asset['id'] for asset in assets}) == len(assets)
    fields = {'id', 'name', 'author', 'category', 'source_url', 'license',
              'license_url', 'modifications', 'status'}
    for asset in assets:
        assert fields <= asset.keys()
        assert asset['status'] in {'planned', 'in_use'}
        for field in ('source_url', 'license_url'):
            if asset[field]:
                url = urlparse(asset[field])
                assert url.scheme in {'https', 'http'} and url.netloc


def test_public_page_lists_integrated_bridge_only_as_used(client):
    response = client.get('/licenses')
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    used, planned = html.split('id="planned-assets"')
    assert 'Modular Road Bridge' in used and 'VectorMan' in used
    assert 'Modular Road Bridge' not in planned
    assert 'CC BY 4.0' in used
    assert 'https://creativecommons.org/licenses/by/4.0/' in used
    assert 'Используется' in used
    assert 'нормализованы оси и масштаб' in used
    assert 'Изменения' in used


def test_registry_changes_appear_on_next_request_and_unknown_fields_are_honest(app, client, tmp_path):
    registry = tmp_path / 'credits.json'
    app.config['ASSET_CREDITS_PATH'] = registry
    assets = [{'id': 'sample', 'name': 'Test texture', 'author': None,
               'category': 'Текстура', 'source_url': None, 'license': 'CC0',
               'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/',
               'modifications': None, 'status': 'planned'}]
    registry.write_text(json.dumps(assets), encoding='utf-8')
    first = client.get('/licenses').get_data(as_text=True)
    assert 'Test texture' in first.split('id="planned-assets"')[1]
    assets[0].update(status='in_use', modifications='Обрезана текстура')
    assets.append({**assets[0], 'id': 'other', 'name': '<script>alert(1)</script>',
                   'license': 'Custom License', 'license_url': None, 'status': 'planned'})
    registry.write_text(json.dumps(assets), encoding='utf-8')
    second = client.get('/licenses').get_data(as_text=True)
    used, planned = second.split('id="planned-assets"')
    assert 'Test texture' in used and 'Test texture' not in planned
    assert 'Обрезана текстура' in used and 'Не указан' in used
    assert 'Custom License' in planned
    assert '&lt;script&gt;alert(1)&lt;/script&gt;' in planned
    assert '<script>alert(1)</script>' not in planned


def test_navigation_is_available_on_home_and_player_lobby(client, create_user, auth_headers):
    assert 'href="/licenses"' in client.get('/').get_data(as_text=True)
    player = create_user()
    response = client.get('/lobbies/1/page', headers=auth_headers(player))
    assert response.status_code == 200
    assert 'href="/licenses"' in response.get_data(as_text=True)
    assert client.get('/licenses', headers=auth_headers(player)).status_code == 200
