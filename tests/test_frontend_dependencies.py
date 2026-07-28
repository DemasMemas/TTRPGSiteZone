from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_lobby_has_single_import_map():
    lobby_html = (
        PROJECT_ROOT / "app" / "templates" / "lobby.html"
    ).read_text(encoding="utf-8")

    assert lobby_html.count('type="importmap"') == 1


def test_weather_does_not_use_bare_howler_import():
    weather_js = (
        PROJECT_ROOT / "app" / "static" / "js" / "weather.js"
    ).read_text(encoding="utf-8")

    assert "from 'howler'" not in weather_js
    assert 'from "howler"' not in weather_js
