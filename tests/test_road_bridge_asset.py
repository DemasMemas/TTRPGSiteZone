import json
import struct
from pathlib import Path

from scripts import build_road_bridge


def read_glb(path):
    raw = path.read_bytes()
    assert struct.unpack_from('<III', raw) == (0x46546C67, 2, len(raw))
    size = struct.unpack_from('<I', raw, 12)[0]
    return json.loads(raw[20:20+size]), raw[28+size:]


def test_bridge_conversion_preserves_author_textures_and_repeated_geometry(tmp_path, monkeypatch):
    source = Path(__file__).resolve().parents[1] / 'assets/sources/sketchfab/modular_road_bridge/original.glb'
    monkeypatch.setattr(build_road_bridge, 'SOURCE', tmp_path / 'source')
    monkeypatch.setattr(build_road_bridge, 'TARGET', tmp_path / 'bridge.glb')
    build_road_bridge.build(source)
    original, original_binary = read_glb(source)
    result, binary = read_glb(tmp_path / 'bridge.glb')
    for key in ('author', 'license', 'source', 'title'):
        assert result['asset']['extras'][key] == original['asset']['extras'][key]
    assert len(result['asset']['extras']['pierAnchors']) == 2
    assert len(result['meshes']) == 5
    assert len(result['images']) == len(original['images']) == 4
    for a, b in zip(original['images'], result['images']):
        old_view, new_view = original['bufferViews'][a['bufferView']], result['bufferViews'][b['bufferView']]
        old_offset, new_offset = old_view.get('byteOffset', 0), new_view.get('byteOffset', 0)
        assert original_binary[old_offset:old_offset+old_view['byteLength']] == binary[new_offset:new_offset+new_view['byteLength']]
    triangles = {}
    for mesh in result['meshes']:
        position = result['accessors'][mesh['primitives'][0]['attributes']['POSITION']]
        triangles[mesh['name']] = position['count'] // 3
        if mesh['name'] == 'deck_3':
            assert abs(position['min'][0]+.5) < 1e-6
            assert abs(position['max'][0]-.5) < 1e-6
            assert max(abs(position['min'][1]), abs(position['max'][1])) < 1e-6
        if mesh['name'] == 'pier':
            assert abs(position['min'][1]+1) < 1e-6
            assert abs(position['max'][1]) < 1e-6
    assert sum(triangles.values()) + triangles['pier'] == 666
    assert result['materials'][1]['normalTexture']['scale'] == .75
    assert (tmp_path / 'bridge.glb').stat().st_size < 4_000_000
