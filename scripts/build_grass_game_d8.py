"""Build the comparison scene's Grass Medium 01 mid_a tuft for the game."""

from pathlib import Path
import bpy


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'app/static/models/vegetation/polyhaven-d51/grass_medium_01/grass_medium_01_1k.gltf'
OUTPUT = ROOT / 'app/static/models/vegetation/grass_medium_01_game_d8.glb'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

tuft = bpy.data.objects['grass_medium_01_mid_a_LOD0']
tuft.location = (0, 0, 0)
modifier = tuft.modifiers.new('game silhouette', 'DECIMATE')
modifier.ratio = 0.2
bpy.context.view_layer.objects.active = tuft
bpy.ops.object.modifier_apply(modifier=modifier.name)

bpy.ops.object.select_all(action='DESELECT')
tuft.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT), export_format='GLB', use_selection=True,
    export_materials='NONE', export_apply=False,
)
print(f'GAME_GRASS={OUTPUT} TRIANGLES={len(tuft.data.polygons)}')
