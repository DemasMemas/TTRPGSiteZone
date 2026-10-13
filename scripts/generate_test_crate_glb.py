"""Build the small original GLB fixture used to exercise the location asset loader."""

import json
import struct
from pathlib import Path


OUTPUT = Path(__file__).resolve().parents[1] / 'app/static/models/test-crate.glb'


def box(vertices, normals, indices, center, size):
    x, y, z = center
    sx, sy, sz = (axis / 2 for axis in size)
    faces = (
        ((1, 0, 0), ((sx, -sy, -sz), (sx, sy, -sz), (sx, sy, sz), (sx, -sy, sz))),
        ((-1, 0, 0), ((-sx, -sy, sz), (-sx, sy, sz), (-sx, sy, -sz), (-sx, -sy, -sz))),
        ((0, 1, 0), ((-sx, sy, -sz), (-sx, sy, sz), (sx, sy, sz), (sx, sy, -sz))),
        ((0, -1, 0), ((-sx, -sy, sz), (-sx, -sy, -sz), (sx, -sy, -sz), (sx, -sy, sz))),
        ((0, 0, 1), ((sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz), (-sx, -sy, sz))),
        ((0, 0, -1), ((-sx, -sy, -sz), (-sx, sy, -sz), (sx, sy, -sz), (sx, -sy, -sz))),
    )
    for normal, corners in faces:
        first = len(vertices) // 3
        for vx, vy, vz in corners:
            vertices.extend((x + vx, y + vy, z + vz))
            normals.extend(normal)
        indices.extend((first, first + 1, first + 2, first, first + 2, first + 3))


def build_glb():
    wood = ([], [], [])
    metal = ([], [], [])
    box(*wood, (0, 0.335, 0), (0.72, 0.61, 0.72))
    box(*wood, (0, 0.65, 0), (0.78, 0.08, 0.78))
    for z in (-0.37, 0.37):
        for y in (0.09, 0.55):
            box(*wood, (0, y, z), (0.76, 0.055, 0.055))
    for x in (-0.37, 0.37):
        for y in (0.09, 0.55):
            box(*wood, (x, y, 0), (0.055, 0.055, 0.76))
    for x in (-0.36, 0.36):
        for z in (-0.36, 0.36):
            box(*metal, (x, 0.35, z), (0.045, 0.7, 0.045))
    for x in (-0.28, 0.28):
        box(*metal, (x, 0.705, 0), (0.055, 0.025, 0.8))

    binary = bytearray()
    buffer_views = []
    accessors = []
    primitives = []
    for material, (positions, normals, indices) in enumerate((wood, metal)):
        attributes = {}
        for semantic, values in (('POSITION', positions), ('NORMAL', normals)):
            offset = len(binary)
            binary.extend(struct.pack(f'<{len(values)}f', *values))
            view = len(buffer_views)
            buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(values) * 4,
                                 'target': 34962})
            accessor = {'bufferView': view, 'componentType': 5126, 'count': len(values) // 3,
                        'type': 'VEC3'}
            if semantic == 'POSITION':
                accessor['min'] = [min(values[axis::3]) for axis in range(3)]
                accessor['max'] = [max(values[axis::3]) for axis in range(3)]
            attributes[semantic] = len(accessors)
            accessors.append(accessor)
        offset = len(binary)
        binary.extend(struct.pack(f'<{len(indices)}H', *indices))
        view = len(buffer_views)
        buffer_views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(indices) * 2,
                             'target': 34963})
        index_accessor = len(accessors)
        accessors.append({'bufferView': view, 'componentType': 5123,
                          'count': len(indices), 'type': 'SCALAR'})
        primitives.append({'attributes': attributes, 'indices': index_accessor, 'material': material})
    while len(binary) % 4:
        binary.append(0)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'TTRPGSiteZone local test fixture'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': primitives}],
        'materials': [
            {'name': 'Aged wood', 'pbrMetallicRoughness': {
                'baseColorFactor': [0.34, 0.25, 0.17, 1], 'metallicFactor': 0,
                'roughnessFactor': 0.94}},
            {'name': 'Dark iron', 'pbrMetallicRoughness': {
                'baseColorFactor': [0.2, 0.22, 0.19, 1], 'metallicFactor': 0.68,
                'roughnessFactor': 0.78}},
        ],
        'buffers': [{'byteLength': len(binary)}],
        'bufferViews': buffer_views, 'accessors': accessors,
    }
    json_chunk = json.dumps(gltf, separators=(',', ':'), ensure_ascii=True).encode('utf-8')
    json_chunk += b' ' * (-len(json_chunk) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    return (struct.pack('<4sII', b'glTF', 2, total)
            + struct.pack('<I4s', len(json_chunk), b'JSON') + json_chunk
            + struct.pack('<I4s', len(binary), b'BIN\x00') + binary)


if __name__ == '__main__':
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(build_glb())
    print(f'{OUTPUT}: {OUTPUT.stat().st_size} bytes')
