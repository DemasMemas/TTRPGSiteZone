"""Bake the approved CC0 PO-2 source into one small, instancing-ready mesh.

Authorised adaptation: replace flat panel faces with real faceted relief.
No runtime subdivision, displacement, normal-map generation or new materials.
"""
import hashlib
import json
import math
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/sources/opengameart/po2'
TARGET = ROOT / 'app/static/models/art'


def build():
    archive_hash = hashlib.sha256((SOURCE / 'source.zip').read_bytes()).hexdigest()
    if archive_hash != 'f907fb23b982d1ba327507075ffe59577463e89701a5601d317b1b326457437d':
        raise ValueError('Unexpected PO-2 source archive')
    vertices = []
    for line in (SOURCE / 'original/model/zaborec.obj').read_text().splitlines():
        if line.startswith('v '):
            vertices.append(tuple(map(float, line.split()[1:4])))
    # An undamaged straight source panel, not the full school perimeter.
    lo = (-47.333168, 1.398045, 39.767887)
    hi = (-44.112518, 4.719609, 39.955498)
    panel = [v for v in vertices if all(lo[i] - 0.00001 <= v[i] <= hi[i] + 0.00001 for i in range(3))]
    if len(set(panel)) != 8:
        raise ValueError('Source panel no longer matches the inspected mesh')
    half_thickness = (hi[2] - lo[2]) / (hi[0] - lo[0]) * 0.8 / 2
    positions, normals, uvs = [], [], []

    def triangle(a, b, c, outward):
        ab = [b[i] - a[i] for i in range(3)]
        ac = [c[i] - a[i] for i in range(3)]
        n = [ab[1]*ac[2]-ab[2]*ac[1], ab[2]*ac[0]-ab[0]*ac[2], ab[0]*ac[1]-ab[1]*ac[0]]
        if sum(n[i] * outward[i] for i in range(3)) < 0:
            b, c = c, b
            n = [-x for x in n]
        length = math.sqrt(sum(x*x for x in n))
        for v in (a, b, c):
            positions.extend(round(x, 7) for x in v)
            normals.extend(round(x / length, 7) for x in n)
            # Source concrete only: exclude the unrelated lower brick strip.
            uvs.extend((round((v[2] + .4) / .8, 7), round(.31 + (v[1] + .25) * 1.3, 7)))

    def quad(a, b, c, d, outward):
        triangle(a, b, c, outward)
        triangle(a, c, d, outward)

    def box(x0, x1, y0, y1, z0, z1):
        quad((x0,y0,z0),(x0,y1,z0),(x0,y1,z1),(x0,y0,z1),(-1,0,0))
        quad((x1,y0,z0),(x1,y1,z0),(x1,y1,z1),(x1,y0,z1),(1,0,0))
        quad((x0,y0,z0),(x1,y0,z0),(x1,y0,z1),(x0,y0,z1),(0,-1,0))
        quad((x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1),(0,1,0))
        quad((x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),(0,0,-1))
        quad((x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1),(0,0,1))

    # Retain the source panel's thickness-to-length ratio. The world editor uses
    # strategic landmark dimensions, not physical metres (a cell spans 100 m).
    x = half_thickness
    quad((-x,-.20,-.4),(x,-.20,-.4),(x,.25,-.4),(-x,.25,-.4),(0,0,-1))
    quad((-x,-.20,.4),(x,-.20,.4),(x,.25,.4),(-x,.25,.4),(0,0,1))
    quad((-x,-.20,-.4),(x,-.20,-.4),(x,-.20,.4),(-x,-.20,.4),(0,-1,0))
    quad((-x,.25,-.4),(x,.25,-.4),(x,.25,.4),(-x,.25,.4),(0,1,0))
    for sign in (-1, 1):
        face_x = sign*x
        def face(z0, z1, y0, y1):
            quad((face_x,y0,z0),(face_x,y1,z0),(face_x,y1,z1),(face_x,y0,z1),(sign,0,0))
        face(-.4, -.37, -.20, .25)
        face(.37, .4, -.20, .25)
        face(-.37, .37, -.20, -.16)
        face(-.37, .37, .21, .25)
        for column in range(6):
            for row in range(4):
                z0, z1 = -.37 + column*.74/6, -.37 + (column+1)*.74/6
                y0, y1 = -.16 + row*.37/4, -.16 + (row+1)*.37/4
                corners = [(face_x,y0,z0),(face_x,y1,z0),(face_x,y1,z1),(face_x,y0,z1)]
                peak = (face_x + sign*.014, (y0+y1)/2, (z0+z1)/2)
                for i in range(4):
                    triangle(corners[i], corners[(i+1)%4], peak, (sign,0,0))
    for z in (-.27, .27):
        box(-.07, .07, -.25, -.18, z-.055, z+.055)
    metadata = {
        'source': 'https://opengameart.org/content/post-soviet-fence-po-2-and-grate',
        'author': 'Mixazzz', 'license': 'CC0', 'archiveSha256': archive_hash,
        'adaptation': 'Straight source panel proportions; new two-sided geometric relief, frame and feet; original concrete Color crop.',
        'dimensions': {'width': .14, 'height': .5, 'depth': .8},
        'axis': 'Z', 'pivot': 'center', 'sectionPitch': .8,
        'triangles': len(positions)//9, 'reliefDepth': .014,
        'parts': {'end': 'closed section end faces', 'turn': 'rotate an existing section; no extra mesh'},
    }
    data = {'metadata': {'version': 4.5, 'type': 'BufferGeometry', 'generator': 'scripts/build_po2_fence.py'},
            'userData': metadata, 'data': {'attributes': {
                'position': {'itemSize': 3, 'type': 'Float32Array', 'array': positions},
                'normal': {'itemSize': 3, 'type': 'Float32Array', 'array': normals},
                'uv': {'itemSize': 2, 'type': 'Float32Array', 'array': uvs}}}}
    TARGET.mkdir(parents=True, exist_ok=True)
    (TARGET/'po2_section.json').write_text(json.dumps(data, separators=(',', ':'))+'\n', encoding='utf-8')
    shutil.copyfile(SOURCE/'original/model/medicsubsta_zaborclear.png', TARGET/'po2_concrete.png')
    (TARGET/'po2_section.source.json').write_text(json.dumps(metadata, indent=2)+'\n', encoding='utf-8')
    print(f'PO-2: {metadata["triangles"]} triangles, one geometry/material, two-sided relief.')


if __name__ == '__main__':
    build()
