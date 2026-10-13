"""Build an instancing-friendly broadleaf tuft from Poly Haven weed_plant_02.

Run with Blender 4.3+:
  blender -b --python scripts/build_polyhaven_weed_d42.py -- SOURCE.gltf OUTPUT.glb

The source glTF and its adjacent textures are downloadable from the Poly Haven
API. The exported GLB deliberately contains geometry and UVs only; the scene
shares the original CC0 Diffuse, Alpha and Normal maps across all instances.
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
    selected = []
    for name, x, y, angle, ratio in (
        ("weed_plant_02_c_LOD0", -0.035, 0.02, -25, 0.12),
        ("weed_plant_02_d_LOD0", 0.045, -0.02, 118, 0.12),
    ):
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH" or not obj.data.uv_layers:
            raise RuntimeError(f"Missing source mesh or UVs: {name}")
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        modifier = obj.modifiers.new("Simplify photographed leaves", "DECIMATE")
        modifier.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.location.x = x
        obj.location.y = y
        obj.rotation_euler.z += math.radians(angle)
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
    tuft.name = "PolyHaven_Weed_D42_Tuft"
    tuft.data.materials.clear()

    # Poly Haven's five source plants are spread across a display scene.
    # Bring this selected pair back to a shared local root for instancing.
    bounds = [vertex.co for vertex in tuft.data.vertices]
    center_x = (min(v.x for v in bounds) + max(v.x for v in bounds)) * 0.5
    center_y = (min(v.y for v in bounds) + max(v.y for v in bounds)) * 0.5
    floor_z = min(v.z for v in bounds)
    for vertex in tuft.data.vertices:
        vertex.co.x -= center_x
        vertex.co.y -= center_y
        vertex.co.z -= floor_z

    triangles = sum(len(poly.vertices) - 2 for poly in tuft.data.polygons)
    if triangles > 650 or triangles < 200 or not tuft.data.uv_layers:
        raise RuntimeError(f"Unexpected result: {triangles} triangles or missing UVs")
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format="GLB", use_selection=True,
        export_materials="NONE", export_yup=True,
    )
    print(f"D4.2 broadleaf tuft: {triangles} triangles, {output}")


if __name__ == "__main__":
    main()
