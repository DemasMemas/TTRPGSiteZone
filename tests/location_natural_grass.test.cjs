const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../app/static/js');
const source = fs.readFileSync(path.join(root, 'locationNaturalGrass.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('optimized game grass keeps a small UV-mapped Poly Haven mesh', () => {
    const binary = fs.readFileSync(path.join(__dirname,
        '../app/static/models/vegetation/grass_medium_01_game_d7.glb'));
    assert.equal(binary.toString('utf8', 0, 4), 'glTF');
    const jsonLength = binary.readUInt32LE(12);
    const gltf = JSON.parse(binary.toString('utf8', 20, 20 + jsonLength));
    assert.equal(gltf.nodes[0].name, 'grass_medium_01_small_b_LOD0');
    assert.equal(gltf.meshes.length, 1);
    const primitive = gltf.meshes[0].primitives[0];
    assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_0));
    assert.equal(gltf.accessors[primitive.indices].count / 3, 261);
    assert.equal(gltf.materials?.length || 0, 0);
});

test('natural grass uses deterministic placements with forest more open than plain', async () => {
    const { naturalGrassPlacements } = await import(moduleUrl);
    const tiles = Array.from({ length: 20 }, () => Array.from({ length: 20 },
        () => ({ terrain: 'grass' })));
    const plain = naturalGrassPlacements(tiles);
    assert.deepEqual(naturalGrassPlacements(tiles), plain);
    assert.equal(plain.stats.grassTiles, 400);
    assert.equal(plain.stats.plainTiles, 400);
    assert.equal(plain.stats.forestTiles, 0);
    tiles.forEach(row => row.forEach(tile => { tile.grass_subtype = 'forest'; }));
    const forest = naturalGrassPlacements(tiles);
    assert.equal(forest.stats.forestTiles, 400);
    assert.ok(forest.medium01.length < plain.medium01.length);
    assert.ok(plain.medium01.length <= 1500);
    assert.ok(plain.medium01.length > 50);
});

test('natural grass respects non-grass cells and floor coverage', async () => {
    const { naturalGrassPlacements } = await import(moduleUrl);
    const tiles = Array.from({ length: 8 }, () => Array.from({ length: 8 },
        () => ({ terrain: 'grass' })));
    tiles[0][0] = { terrain: 'sand' };
    const covered = naturalGrassPlacements(tiles, () => true);
    assert.equal(covered.medium01.length, 0);
    assert.equal(covered.stats.grassTiles, 63);
    assert.ok(covered.stats.floorRejected > 0);
});

test('full grass location stays visible within a laptop-sized triangle budget', async () => {
    const { naturalGrassPlacements } = await import(moduleUrl);
    const detailSource = fs.readFileSync(path.join(root, 'locationGrassDetail.js'), 'utf8');
    const { grassPlacements } = await import(`data:text/javascript;base64,${Buffer.from(detailSource).toString('base64')}`);
    const tiles = Array.from({ length: 48 }, () => Array.from({ length: 48 },
        () => ({ terrain: 'grass' })));
    const model = naturalGrassPlacements(tiles).medium01.length;
    const understory = grassPlacements(tiles, () => false, 'understory').tufts.length;
    const triangles = model * 261 + understory * 15;
    assert.ok(model > 300 && understory > 10000);
    assert.ok(triangles > 200000 && triangles < 600000);
});

test('optimized grass adds one shared instanced model at ground height', async () => {
    const { addNaturalGrassInstances } = await import(moduleUrl);
    class Object3D {
        constructor() {
            this.position = { set: (x, y, z) => { this.xyz = [x, y, z]; } };
            this.rotation = { set() {} };
            this.scale = { set(x, y, z) { this.value = [x, y, z]; } };
        }
        updateMatrix() { this.matrix = { position: this.xyz, scale: this.scale.value }; }
    }
    class InstancedMesh {
        constructor(geometry, material, count) {
            this.geometry = geometry;
            this.material = material;
            this.count = count;
            this.position = { set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
            this.userData = {};
            this.instanceMatrix = {};
            this.instanceColor = {};
            this.transforms = [];
        }
        setMatrixAt(index, matrix) { this.transforms[index] = matrix; }
        setColorAt(index, color) { this.color = color.rgb; }
    }
    class Color { setRGB(...rgb) { this.rgb = rgb; } }
    const THREE = { Object3D, InstancedMesh, Color, Sphere: class {}, Vector3: class {} };
    const geometry = triangles => ({ clone() { return this; },
        index: { count: triangles * 3 } });
    const material = () => ({ clone() { return { ...this }; } });
    const assets = {
        medium01: { geometry: geometry(261), material: material(), bottom: 0, scale: 1 },
    };
    const group = { children: [], userData: { detailCounts: { tufts: 0 } },
        add(mesh) { this.children.push(mesh); } };
    const placements = { medium01: [{ x: 2.5, z: 3.5, size: 1,
        width: 1, depth: 1, lean: 0, tone: 0.5, turn: 0 }] };
    const result = addNaturalGrassInstances(THREE, group, placements, assets, () => 1);
    assert.deepEqual(result.added, { medium01: 1 });
    assert.deepEqual(result.triangles, { medium01: 261 });
    assert.equal(group.children.length, 1);
    assert.equal(group.children[0].transforms[0].position[1], 1.012);
    assert.deepEqual(group.children[0].color, [0.92, 1.16, 1]);
    assert.equal(group.children[0].instanceColor.needsUpdate, true);
});
