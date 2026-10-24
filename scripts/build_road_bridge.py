"""Prepare VectorMan's supplied Sketchfab GLB for shared section/pier instances."""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/sources/sketchfab/modular_road_bridge'
TARGET = ROOT / 'app/static/models/art/modular_road_bridge.glb'
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def multiply(a, b):
    return [sum(a[k*4+r]*b[c*4+k] for k in range(4)) for c in range(4) for r in range(4)]


def transform(m, p):
    return [sum(m[k*4+r]*(*p, 1)[k] for k in range(4)) for r in range(3)]


def normal(m, n):
    a, b, c = [m[0:3], m[4:7], m[8:11]]
    cross = lambda u, v: [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
    co = [cross(b, c), cross(c, a), cross(a, b)]
    det = sum(a[i]*co[0][i] for i in range(3))
    v = [sum(co[k][r]*n[k] for k in range(3))/det for r in range(3)]
    length = math.sqrt(sum(x*x for x in v))
    return [x/length for x in v]


def build(source):
    SOURCE.mkdir(parents=True, exist_ok=True)
    original = SOURCE / 'original.glb'
    if source.resolve() != original.resolve():
        shutil.copyfile(source, original)
    raw = original.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    assert magic == 0x46546c67 and version == 2 and length == len(raw)
    size = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+size])
    binary = raw[28+size:]
    assert doc['asset']['extras']['title'] == 'Modular Road Bridge'
    assert 'CC-BY-4.0' in doc['asset']['extras']['license']

    def accessor(index):
        a = doc['accessors'][index]
        v = doc['bufferViews'][a['bufferView']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        fmt = '<' + {5126: 'f', 5125: 'I'}[a['componentType']]*width
        return [struct.unpack_from(fmt, binary, v.get('byteOffset', 0)+a.get('byteOffset', 0)
                                   + i*v.get('byteStride', width*4)) for i in range(a['count'])]

    meshes = []

    def visit(index, matrix):
        node = doc['nodes'][index]
        matrix = multiply(matrix, node.get('matrix', IDENTITY))
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                attr = primitive['attributes']
                meshes.append(dict(name=node['name'], material=primitive['material'],
                                   positions=[transform(matrix, p) for p in accessor(attr['POSITION'])],
                                   normals=[normal(matrix, n) for n in accessor(attr['NORMAL'])],
                                   uvs=accessor(attr['TEXCOORD_0']), indices=[i[0] for i in accessor(primitive['indices'])]))
        for child in node.get('children', []):
            visit(child, matrix)

    # The FBX authoring root is Y-up. Remove the viewer's placement/rotation.
    root = next(i for i, node in enumerate(doc['nodes']) if node['name'] == 'RootNode')
    visit(root, IDENTITY)
    asphalt = next(m for m in meshes if m['name'].endswith('_Asphalt_0'))
    bounds = [[min(p[k] for p in asphalt['positions']), max(p[k] for p in asphalt['positions'])] for k in range(3)]
    span = bounds[2][1]-bounds[2][0]
    cx, cy, cz = (sum(b)/2 for b in bounds)
    rotate = lambda v: [v[2], v[1], -v[0]]
    normalize = lambda p: [(p[2]-cz)/span, (p[1]-cy)/span, -(p[0]-cx)/span]
    groups = collections.defaultdict(lambda: dict(positions=[], normals=[], uvs=[]))
    pier_anchors = []
    for mesh in meshes:
        positions = mesh['positions']
        if mesh['name'].startswith('Cylinder.'):
            # Connected components: two round columns and one transverse cap.
            keys = [tuple(round(v, 3) for v in p) for p in positions]
            adjacency = collections.defaultdict(set)
            for start in range(0, len(mesh['indices']), 3):
                face = [keys[i] for i in mesh['indices'][start:start+3]]
                for key in face:
                    adjacency[key].update(face)
            component, seen = {}, set()
            for key in adjacency:
                if key in seen:
                    continue
                stack, found = [key], set([key])
                seen.add(key)
                while stack:
                    v = stack.pop()
                    for other in adjacency[v]-seen:
                        seen.add(other); found.add(other); stack.append(other)
                top, bottom = max(p[1] for p in found), min(p[1] for p in found)
                is_pier = top-bottom > span*.4
                anchor = [(min(p[k] for p in found)+max(p[k] for p in found))/2 for k in range(3)]
                anchor[1] = top
                group = 'pier' if is_pier else 'deck_1'
                keep = not is_pier or not pier_anchors
                for v in found:
                    component[v] = (group, anchor, bottom, keep)
                if is_pier:
                    pier_anchors.append(normalize(anchor))
            for i in mesh['indices']:
                group, anchor, bottom, keep = component[keys[i]]
                if not keep:
                    continue
                p = normalize(positions[i])
                if group == 'pier':
                    a = normalize(anchor)
                    p = [p[0]-a[0], (positions[i][1]-anchor[1])/(anchor[1]-bottom), p[2]-a[2]]
                groups[group]['positions'].append(p)
                groups[group]['normals'].append(rotate(mesh['normals'][i]))
                groups[group]['uvs'].append(mesh['uvs'][i])
        else:
            # Footpath and BlueWall have identical PBR settings and texture.
            group = groups['deck_'+str(0 if mesh['material'] == 2 else mesh['material'])]
            for i in mesh['indices']:
                group['positions'].append(normalize(positions[i]))
                group['normals'].append(rotate(mesh['normals'][i]))
                group['uvs'].append(mesh['uvs'][i])
    assert len(pier_anchors) == 2 and len(groups) == 5
    result = dict(asset=doc['asset'], scenes=[{'nodes': []}], scene=0, nodes=[], meshes=[],
                  materials=doc['materials'], images=[], textures=doc['textures'], samplers=doc['samplers'],
                  buffers=[], bufferViews=[], accessors=[])
    result['asset'] = {**doc['asset'], 'generator': 'TTRPGSiteZone build_road_bridge.py',
                       'extras': {**doc['asset']['extras'], 'pierAnchors': pier_anchors}}
    out = bytearray()

    def view(data):
        while len(out) % 4:
            out.append(0)
        index = len(result['bufferViews'])
        result['bufferViews'].append({'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)})
        out.extend(data)
        return index

    for image in doc['images']:
        v = doc['bufferViews'][image['bufferView']]
        offset = v.get('byteOffset', 0)
        result['images'].append({'bufferView': view(binary[offset:offset+v['byteLength']]), 'mimeType': image['mimeType']})
    for name, group in groups.items():
        attributes = {}
        for key, semantic, width in [('positions', 'POSITION', 3), ('normals', 'NORMAL', 3), ('uvs', 'TEXCOORD_0', 2)]:
            values = group[key]
            index = len(result['accessors'])
            a = dict(bufferView=view(struct.pack('<'+'f'*(len(values)*width), *(v for p in values for v in p))),
                     componentType=5126, count=len(values), type='VEC'+str(width))
            if key == 'positions':
                a.update(min=[min(p[k] for p in values) for k in range(3)], max=[max(p[k] for p in values) for k in range(3)])
            result['accessors'].append(a)
            attributes[semantic] = index
        result['scenes'][0]['nodes'].append(len(result['nodes']))
        result['nodes'].append({'name': name, 'mesh': len(result['meshes'])})
        result['meshes'].append({'name': name, 'primitives': [{'attributes': attributes, 'material': 1 if name == 'pier' else int(name[-1])}]})
    result['buffers'] = [{'byteLength': len(out)}]
    encoded = json.dumps(result, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    out += b'\0' * (-len(out) % 4)
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(struct.pack('<III', 0x46546c67, 2, 28+len(encoded)+len(out))
                       + struct.pack('<II', len(encoded), 0x4e4f534a)+encoded
                       + struct.pack('<II', len(out), 0x004e4942)+out)
    inspection = dict(source_sha256=hashlib.sha256(raw).hexdigest(), source_bytes=len(raw),
                      source_triangles=sum(len(m['indices'])//3 for m in meshes),
                      groups={name: len(g['positions'])//3 for name, g in groups.items()},
                      pier_anchors=pier_anchors, source_road_bounds=bounds, source_section_length=span,
                      license=doc['asset']['extras'], runtime_bytes=TARGET.stat().st_size)
    (SOURCE / 'inspection.json').write_text(json.dumps(inspection, indent=2), encoding='utf-8')
    print(json.dumps(inspection, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=SOURCE / 'original.glb')
    build(parser.parse_args().source)
