const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationGrassDetail.js'), 'utf8');
const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const water = fs.readFileSync(path.join(__dirname, '../app/static/js/waterSurface.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('grass placements are patchy, batched, stable, and exclude floors and non-grass', async () => {
    const { grassPlacements } = await import(moduleUrl);
    const tiles = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({ terrain: 'grass' })));
    tiles[0][0].terrain = 'water';
    const a = grassPlacements(tiles, x => x < 3);
    const b = grassPlacements(tiles, x => x < 3);
    assert.deepEqual(a, b);
    assert.ok(a.tufts.length > 3000 && a.tufts.length < 5500);
    assert.ok(a.flowers.length > 30 && a.flowers.length < 130);
    assert.ok([...a.tufts, ...a.flowers].every(item => item.x >= 3));
    assert.deepEqual(a, grassPlacements(structuredClone(tiles), x => x < 3));
    const perTile = new Map();
    for (const tuft of a.tufts) {
        const key = `${Math.floor(tuft.x)},${Math.floor(tuft.z)}`;
        perTile.set(key, (perTile.get(key) || 0) + 1);
    }
    assert.ok([...perTile.values()].filter(count => count < 5).length > 30);
    assert.ok([...perTile.values()].filter(count => count > 18).length > 30);
    assert.ok(new Set(a.tufts.map(tuft => `${tuft.width.toFixed(2)},${tuft.height.toFixed(2)}`)).size > 100);
    assert.match(source, /new THREE\.InstancedMesh\(makeGrassGeometry/);
    assert.match(source, /mesh\.castShadow = false/);
    assert.match(source, /mesh\.raycast = \(\) => \{\}/);
});

test('sand pebbles are sparse, irregular, deterministic, and absent from floors', async () => {
    const { grassPlacements, groundPlacements } = await import(moduleUrl);
    const tiles = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (_, x) => (
        { terrain: ['sand', 'swamp', 'rock', 'grass'][x % 4] }
    )));
    const a = groundPlacements(tiles, x => x < 2);
    assert.deepEqual(a, groundPlacements(tiles, x => x < 2));
    assert.ok(a.pebbles.length > 0);
    assert.ok(a.pebbles.length < 15);
    assert.ok(Object.values(a).flat().every(item => item.x >= 2));
    assert.ok(new Set(a.pebbles.map(item => Math.round((item.x % 1) * 100))).size > 2);
    assert.ok(grassPlacements(tiles).tufts.some(item => item.rock));
    assert.match(source, /new THREE\.InstancedMesh\(new THREE\.IcosahedronGeometry/);
    assert.doesNotMatch(source, /new THREE\.CircleGeometry|new THREE\.LineSegments/);
});

test('sand pebbles settle on gentle ground and skip steep faces', async () => {
    const { settlePebbles } = await import(moduleUrl);
    const pebbles = [{ x: 2.5, z: 3.5, size: 0.5 }];
    assert.equal(settlePebbles(pebbles, () => 2)[0].groundHeight, 2);
    assert.equal(settlePebbles(pebbles, x => x).length, 0);
    assert.equal(pebbles[0].groundHeight, undefined);
});

test('swamp pools and reeds are batched, repeatable, and excluded beneath floors', async () => {
    const { swampPlacements } = await import(moduleUrl);
    const tiles = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ terrain: 'swamp' })));
    tiles[0][0].terrain = 'water';
    const first = swampPlacements(tiles, x => x < 2);
    assert.deepEqual(first, swampPlacements(tiles, x => x < 2));
    assert.ok(first.pools.length > 10 && first.pools.length < 40);
    assert.ok(first.reeds.length > 400 && first.reeds.length < 600);
    assert.ok([...first.pools, ...first.reeds].every(item => item.x >= 2));
    assert.equal(new Set(first.pools.map(item => `${Math.floor(item.x)},${Math.floor(item.z)}`)).size,
        first.pools.length);
    assert.ok(first.pools.every(item => first.reeds.every(reed =>
        Math.floor(reed.x) !== Math.floor(item.x)
            || Math.floor(reed.z) !== Math.floor(item.z)
            || Math.hypot(reed.x - item.x, reed.z - item.z) > item.radius)));
    assert.match(source, /new THREE\.InstancedMesh\(makeReedGeometry\(THREE\)/);
    assert.match(source, /polygonOffset: true, polygonOffsetFactor: -1/);
    assert.doesNotMatch(source, /transparent: true, opacity: 0\.88, depthWrite: false/);
});

test('swamp water is upward-facing and skips steep ground', async () => {
    const { createGrassDetailGroup } = await import(moduleUrl);
    const tiles = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ terrain: 'swamp' })));
    class Geometry {
        constructor() { this.attributes = {}; }
        setAttribute(name, attribute) { this.attributes[name] = attribute; }
        computeVertexNormals() {}
    }
    class Color {
        constructor(hex = 0xffffff) {
            this.r = ((hex >> 16) & 255) / 255;
            this.g = ((hex >> 8) & 255) / 255;
            this.b = (hex & 255) / 255;
        }
        setHSL(h, s, l) { this.r = h; this.g = s; this.b = l; return this; }
    }
    class Object3D {
        constructor() {
            this.position = { set() {} };
            this.rotation = { set() {} };
            this.scale = { setScalar() {} };
        }
        updateMatrix() { this.matrix = {}; }
    }
    class Material { constructor(options) { Object.assign(this, options); } }
    class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
    class InstancedMesh extends Mesh {
        constructor(geometry, material) {
            super(geometry, material);
            this.instanceMatrix = {};
            this.instanceColor = {};
        }
        setMatrixAt() {}
        setColorAt() {}
    }
    const THREE = {
        Group: class { constructor() { this.children = []; this.userData = {}; } add(mesh) { this.children.push(mesh); } },
        BufferGeometry: Geometry,
        Float32BufferAttribute: class { constructor(array) { this.array = array; } },
        Color, Object3D, Mesh, InstancedMesh, MeshStandardMaterial: Material,
        MeshLambertMaterial: Material, DoubleSide: 2,
    };
    const flat = createGrassDetailGroup(THREE, tiles, () => 1, () => false);
    const pool = flat.children.find(mesh => mesh.constructor === Mesh);
    assert.ok(pool);
    assert.equal(pool.material.transparent, undefined);
    assert.equal(pool.material.polygonOffset, true);
    const vertices = pool.geometry.attributes.position.array;
    assert.ok(vertices[1] > 1);
    const [ax, az, bx, bz, cx, cz] = [vertices[0], vertices[2], vertices[3],
        vertices[5], vertices[6], vertices[8]];
    assert.ok((bx - ax) * (cz - az) - (bz - az) * (cx - ax) < 0);
    assert.ok(flat.userData.detailCounts.pools > 0);

    const steep = createGrassDetailGroup(THREE, tiles, (x) => x, () => false);
    assert.equal(steep.userData.detailCounts.pools, 0);
    assert.equal(steep.children.some(mesh => mesh.constructor === Mesh), false);
});

test('grass and reeds feather across land borders but never enter water', async () => {
    const { grassPlacements, swampPlacements } = await import(moduleUrl);
    const tiles = Array.from({ length: 12 }, (_, z) => Array.from({ length: 12 }, (_, x) => ({
        terrain: z < 2 ? 'water' : x < 6 ? 'grass' : 'swamp',
    })));
    const grass = grassPlacements(tiles).tufts;
    const reeds = swampPlacements(tiles).reeds;
    assert.ok(grass.some(item => item.x > 6 && item.z >= 2));
    assert.ok(reeds.some(item => item.x < 6 && item.z >= 2));
    assert.ok([...grass, ...reeds].every(item => tiles[Math.floor(item.z)]?.[Math.floor(item.x)]?.terrain !== 'water'));
    const grassFringe = grass.filter(item => item.x > 6).map(item => item.x - 6);
    assert.ok(Math.max(...grassFringe) - Math.min(...grassFringe) > 0.06);
    assert.ok(new Set(grassFringe.map(value => Math.round(value * 100))).size > 4);
});

test('local terrain rebuilds instanced plants and water uses continuous world coordinates', () => {
    assert.match(scene, /createGrassDetailGroup\(THREE, currentLocationData\.tiles_data/);
    assert.match(scene, /createTerrainSurfaceHeightSampler\(currentLocationData\.tiles_data\)/);
    assert.match(scene, /rebuildGrassDetailMesh\(\)/);
    assert.match(water, /vWaterWorldXZ \* 0\.16 \+ waterPatternOffset/);
    assert.match(water, /waterWorld = instanceMatrix \* waterWorld/);
});
