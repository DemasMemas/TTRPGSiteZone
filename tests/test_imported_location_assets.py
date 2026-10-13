"""Static compatibility checks for the small CC0 art pilot."""

import hashlib
import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "app/static/models/art"
PBR = ROOT / "app/static/materials/art"
ALLOWED_EXTENSIONS = {"KHR_texture_transform", "KHR_materials_unlit"}


def glb_json(path):
    data = path.read_bytes()
    assert data[:4] == b"glTF"
    assert struct.unpack_from("<I", data, 4)[0] == 2
    assert struct.unpack_from("<I", data, 8)[0] == len(data)
    length, chunk_type = struct.unpack_from("<I4s", data, 12)
    assert chunk_type == b"JSON"
    return json.loads(data[20:20 + length])


def test_art_models_are_embedded_and_compatible():
    for asset_id in ("art_rusty_barrel", "art_wooden_crate", "art_chainlink_fence"):
        path = ART / f"{asset_id}.glb"
        meta = json.loads((ART / f"{asset_id}.json").read_text(encoding="utf8"))
        doc = glb_json(path)
        assert set(doc.get("extensionsRequired", [])) <= ALLOWED_EXTENSIONS
        assert doc["meshes"] and doc["materials"] and doc["textures"]
        assert all("uri" not in image for image in doc["images"])
        assert all("uri" not in buffer for buffer in doc["buffers"])
        assert meta["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
        assert meta["license"] == "CC0"
        assert meta["triangles"] > 0
        assert meta["sourceUrl"].startswith("https://polyhaven.com/a/")


def test_pbr_sets_have_all_three_maps_and_provenance():
    for asset_id in ("rusty_metal", "aged_wood", "worn_plaster", "dirty_earth"):
        meta = json.loads((PBR / asset_id / "material.json").read_text(encoding="utf8"))
        assert meta["license"] == "CC0"
        assert set(meta["maps"]) == {"color", "normal", "arm"}
        for url in meta["maps"].values():
            file = ROOT / "app/static" / Path(url.removeprefix("/static/"))
            assert file.is_file(), url
            assert file.read_bytes()[:3] == b"\xff\xd8\xff"


def test_fence_has_real_wire_cutout_and_correct_source_section():
    doc = glb_json(ART / "art_chainlink_fence.glb")
    meta = json.loads((ART / "art_chainlink_fence.json").read_text(encoding="utf8"))
    material_names = {material["name"] for material in doc["materials"]}
    assert material_names == {"modular_chainlink_fence_posts", "modular_chainlink_fence_wire"}
    wire = next(material for material in doc["materials"] if material["name"].endswith("_wire"))
    assert wire["alphaMode"] == "BLEND"
    assert wire["doubleSided"] is True
    texture_index = wire["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    image_index = doc["textures"][texture_index]["source"]
    assert doc["images"][image_index]["mimeType"] == "image/png"
    assert any(node.get("name") == "modular_chainlink_fence_double" for node in doc["nodes"])
    assert not any(node.get("name") == "modular_chainlink_fence_end_01" for node in doc["nodes"])
    assert meta["orientation"] == 0
    assert meta["dimensions"] == [2, 0.15, 1.2]
    positions = [doc["accessors"][primitive["attributes"]["POSITION"]]
                 for primitive in doc["meshes"][0]["primitives"]]
    x_span = max(item["max"][0] for item in positions) - min(item["min"][0] for item in positions)
    z_span = max(item["max"][2] for item in positions) - min(item["min"][2] for item in positions)
    assert x_span > 10 * z_span


def test_replacement_material_provenance_and_preview_diagnostics():
    for asset_id, source in (("rusty_metal", "rusty_metal_sheet"),
                             ("worn_plaster", "concrete_wall_003")):
        meta = json.loads((PBR / asset_id / "material.json").read_text(encoding="utf8"))
        assert meta["sourceUrl"] == f"https://polyhaven.com/a/{source}"
    preview = (ROOT / "app/static/asset-preview.html").read_text(encoding="utf8")
    assert 'id="diagnostic"' in preview
    assert "uv.getX(point) * 3" in preview
    assert "new THREE.Box3Helper" in preview


def test_art_preview_and_files_are_served_by_existing_static_route(client):
    assert client.get('/static/asset-preview.html').status_code == 200
    assert client.get('/static/models/art/art_rusty_barrel.glb').data[:4] == b'glTF'
    assert client.get('/static/materials/art/rusty_metal/color.jpg').data[:3] == b'\xff\xd8\xff'
