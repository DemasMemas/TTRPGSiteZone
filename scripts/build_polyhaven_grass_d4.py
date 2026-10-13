"""Extract one instancing-ready clump from Poly Haven grass_bermuda_01.

Run with Blender 4.3+:
  blender -b --python scripts/build_polyhaven_grass_d4.py -- SOURCE.gltf OUTPUT.glb

The exported GLB contains geometry and UVs only. The comparison scene applies
the original Poly Haven Diffuse, Alpha, and Normal maps as a shared material.
"""

import math
import sys
from pathlib import Path

import bpy


def main():
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 2:
        raise SystemExit("Expected SOURCE.gltf and OUTPUT.glb after --")
    source, output = map(Path, args)
    if not source.is_file():
        raise SystemExit(f"Source glTF not found: {source}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))

    # Every entry is a different mesh from the source atlas, not repeated quads.
    # Positions and turns assemble a small three-dimensional tuft around zero.
    parts = [
        ("medium_a", -0.032, -0.018, 12, 1.7),
        ("medium_b", 0.021, -0.026, 57, 1.9),
        ("medium_c", 0.002, 0.025, 131, 1.6),
        ("medium_d", -0.019, 0.014, 204, 1.8),
        ("medium_e", 0.033, 0.009, 286, 1.6),
        ("medium_f", -0.006, -0.004, 344, 1.7),
        ("small_a", -0.048, 0.038, 81, 1.7),
        ("small_b", 0.048, -0.008, 172, 1.6),
        ("small_c", 0.022, 0.045, 254, 1.7),
        ("dead_a", -0.029, -0.045, 309, 1.4),
    ]
    selected = []
    for suffix, x, y, turn, scale in parts:
        name = f"grass_bermuda_01_{suffix}"
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH" or not obj.data.uv_layers:
            raise RuntimeError(f"Missing source grass mesh or UVs: {name}")
        obj.location = (x, y, 0)
        obj.rotation_euler = (0, 0, math.radians(turn))
        obj.scale = (scale, scale, scale)
        selected.append(obj)

    for obj in list(bpy.data.objects):
        if obj not in selected:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = selected[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    tuft = bpy.context.view_layer.objects.active
    tuft.name = "PolyHaven_Bermuda_D4_Tuft"
    tuft.data.materials.clear()

    triangles = sum(len(poly.vertices) - 2 for poly in tuft.data.polygons)
    if triangles > 200 or not tuft.data.uv_layers:
        raise RuntimeError(f"Unexpected source complexity or missing UVs: {triangles} triangles")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", use_selection=True,
        export_materials="NONE", export_yup=True,
    )
    print(f"D4 tuft: {len(parts)} source meshes, {triangles} triangles, {output}")


if __name__ == "__main__":
    main()
