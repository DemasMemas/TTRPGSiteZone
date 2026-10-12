const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const load = async name => import(`data:text/javascript;base64,${Buffer.from(read(name)).toString('base64')}`);

test('neighboring tiles differing by one meter share their edge without a manual surface flag', async () => {
    const { buildSmoothTerrainData, isSmoothTerrainTile } = await load('locationTerrain.js');
    const tiles = [[
        { terrain: 'grass', height: 1 },
        { terrain: 'grass', height: 2 },
    ]];
    assert.equal(isSmoothTerrainTile(tiles, 0, 0), true);
    assert.equal(isSmoothTerrainTile(tiles, 1, 0), true);
    const data = buildSmoothTerrainData(tiles);
    assert.equal(data.tileByFace.length, data.positions.length / 9);
    assert.equal(data.tileByVertex.length, data.positions.length / 3);
    const top = [];
    for (let i = 0; i < data.positions.length; i += 3) {
        const [x, y, z] = data.positions.slice(i, i + 3);
        if (x === 1 && y > 0) top.push(y);
        if (x === 0.5 && z === 0.5) assert.equal(y, 1);
        if (x === 1.5 && z === 0.5) assert.equal(y, 2);
    }
    assert.ok(top.length > 0);
    assert.ok(top.every(y => y === 1.5));
});

test('hard terrain stays outside the smooth mesh and the client picks smoothed faces', async () => {
    const { buildSmoothTerrainData, isSmoothTerrainTile } = await load('locationTerrain.js');
    const data = buildSmoothTerrainData([[{ terrain: 'rock', height: 2.6 }]]);
    assert.equal(data.positions.length, 0);
    const cliff = [[{ terrain: 'rock', height: 1 }, { terrain: 'rock', height: 2.01 }]];
    assert.equal(isSmoothTerrainTile(cliff, 0, 0), false);
    assert.equal(isSmoothTerrainTile(cliff, 1, 0), false);
    assert.equal(buildSmoothTerrainData(cliff).positions.length, 0);
    const scene = read('locationScene.js');
    assert.match(scene, /isSmoothTerrainTile\(currentLocationData\.tiles_data, x, z\)/);
    assert.match(scene, /hit\?\.object\?\.userData\?\.tileByFace\?\.\[hit\.faceIndex\]/);
    assert.match(scene, /rebuildSmoothTerrainMesh\(\)/);
});

test('a changed height also refreshes neighboring tile geometry', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /const neighbors = \[\[x, z\], \[x - 1, z\], \[x \+ 1, z\], \[x, z - 1\], \[x, z \+ 1\]\]/);
    assert.match(scene, /for \(const \[nx, nz\] of neighbors\)[\s\S]*?updateTileInstance/);
    assert.match(scene, /terrainNeedsRebuild = updateTileCube\(x, z, tile, false\) \|\| terrainNeedsRebuild/);
    assert.match(scene, /if \(terrainNeedsRebuild\) rebuildSmoothTerrainMesh\(\)/);
});

test('terrain grid follows flat tiles, smooth slopes, and cliff tops', async () => {
    const { buildTerrainGridData } = await load('locationTerrain.js');
    const flat = buildTerrainGridData([[{ terrain: 'grass', height: 1 }]]);
    assert.equal(flat.positions.length / 6, 8);
    assert.ok(flat.positions.filter((_, index) => index % 3 === 1).every(height => height === 1.025));
    assert.equal(flat.tileByVertex.length, flat.positions.length / 3);

    const slope = buildTerrainGridData([[
        { terrain: 'grass', height: 1 }, { terrain: 'grass', height: 2 },
    ]]);
    const sharedEdgeHeights = [];
    for (let index = 0; index < slope.positions.length; index += 3) {
        if (slope.positions[index] === 1) sharedEdgeHeights.push(slope.positions[index + 1]);
    }
    assert.ok(sharedEdgeHeights.length > 0);
    assert.ok(sharedEdgeHeights.every(height => height === 1.525));

    const cliff = buildTerrainGridData([[
        { terrain: 'grass', height: 1 }, { terrain: 'grass', height: 2.1 },
    ]]);
    const cliffHeights = cliff.positions.filter((_, index) => index % 3 === 1);
    assert.ok(cliffHeights.includes(1.025));
    assert.ok(cliffHeights.includes(2.125));
});

test('terrain grid omits covered floor tiles and rebuilds when surfaces change', async () => {
    const { buildTerrainGridData } = await load('locationTerrain.js');
    const tiles = [[{ terrain: 'grass', height: 1 }, { terrain: 'sand', height: 1 }]];
    const grid = buildTerrainGridData(tiles, x => x !== 0);
    assert.ok(grid.positions.length > 0);
    assert.ok(grid.tileByVertex.every(tile => tile.x === 1));
    const scene = read('locationScene.js');
    assert.match(scene, /const uncovered = \(x, z\) => !floors\.some/);
    assert.match(scene, /if \(gridNeedsRebuild\) rebuildLocationGrid\(\)/);
    assert.match(scene, /if \(updates\.terrain !== undefined \|\| updates\.height !== undefined\) rebuildLocationGrid\(\)/);
    assert.match(scene, /updateLocationGridColors\(\)/);
    assert.match(scene, /locationGridMesh\.raycast = \(\) => \{\}/);
    assert.doesNotMatch(scene, /gridLines\.push\(x, -0\.1/);
});

test('floor grid lies above the slab and is clipped to its footprint', async () => {
    const { buildFloorGridData } = await load('locationTerrain.js');
    const floor = {
        x: 2.5, z: 2.5, width: 2.4, depth: 2.4, top: 1.005,
        axis: { x: 1, z: 0 }, normal: { x: 0, z: 1 },
    };
    const grid = buildFloorGridData([floor]);
    assert.equal(grid.positions.length / 6, 4);
    assert.ok(grid.positions.filter((_, index) => index % 3 === 1)
        .every(y => Math.abs(y - 1.03) < 1e-8));
    assert.ok(grid.positions.filter((_, index) => index % 3 === 0).every(x => x >= 1.3 && x <= 3.7));
    assert.ok(grid.positions.filter((_, index) => index % 3 === 2).every(z => z >= 1.3 && z <= 3.7));
    assert.ok(grid.tileByVertex.every(vertex => vertex.floor));
    const rotated = buildFloorGridData([{
        ...floor, axis: { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
        normal: { x: Math.SQRT1_2, z: Math.SQRT1_2 },
    }]);
    assert.ok(rotated.positions.length > 0);
    assert.equal(rotated.tileByVertex.length, rotated.positions.length / 3);
    const scene = read('locationScene.js');
    assert.match(scene, /const floorData = buildFloorGridData\(floors\)/);
    assert.match(scene, /const color = floor \? floorGridColor/);
    assert.match(scene, /\['wall', 'door', 'window', 'floor'\]\.includes\(source\.type\)/);
    assert.match(scene, /if \(preset === 'floor'\) return \{ width: structureWidth, depth: structureDepth, height: 0\.12 \}/);
});

test('fog surface follows smoothed tile heights without gaps on shared edges', async () => {
    const { buildFogSurfaceData } = await load('locationTerrain.js');
    const tiles = [[
        { terrain: 'grass', height: 1 }, { terrain: 'grass', height: 2 },
    ]];
    const fog = buildFogSurfaceData(tiles);
    assert.equal(fog.tileIndices.length, 2);
    assert.equal(fog.tileIndices[0].length, 24);
    assert.equal(fog.tileIndices[1].length, 24);
    const shared = [];
    for (let index = 0; index < fog.positions.length; index += 3) {
        if (fog.positions[index] === 1) shared.push(fog.positions[index + 1]);
    }
    assert.ok(shared.length > 0);
    assert.ok(shared.every(y => Math.abs(y - 1.545) < 1e-8));
    const scene = read('locationScene.js');
    assert.match(scene, /fogSurfaceData \?\?= buildFogSurfaceData\(currentLocationData\.tiles_data\)/);
    assert.match(scene, /if \(gridNeedsRebuild\) clearFogOverlay\(\)/);
});

test('GM can toggle the terrain grid without changing location data', () => {
    const scene = read('locationScene.js');
    const main = read('main.js');
    assert.match(scene, /let locationGridVisible = false/);
    assert.match(scene, /if \(!scene \|\| !currentLocationData \|\| !locationGridVisible\) return/);
    assert.match(scene, /export function addLocationGridButton\(\)/);
    assert.match(scene, /locationGridVisible = !locationGridVisible;\s*rebuildLocationGrid\(\);\s*sync\(\)/);
    assert.match(scene, /btn\.setAttribute\('aria-pressed', String\(locationGridVisible\)\)/);
    assert.match(main, /if \(window\.isGM\) \{[\s\S]*?addLocationGridButton\(\)/);
    assert.match(main, /document\.getElementById\('location-grid-btn'\)\?\.remove\(\)/);
});

test('flat terrain and water tiles fill their cells without permanent grid gaps', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /const geometry = new THREE\.BoxGeometry\(1, 1, 1\)/);
    assert.match(scene, /const waterMaterial = createWaterMaterial\(\)/);
    assert.match(scene, /new THREE\.InstancedMesh\(geometry\.clone\(\), waterMaterial, tileCount\)/);
    assert.doesNotMatch(scene, /new THREE\.BoxGeometry\(0\.98, 1, 0\.98\)/);
});

test('floor is passable and does not charge climb movement in the client', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /PASSABLE_OBJECT_TYPES = new Set\(\[[^\]]*'floor'/);
    assert.match(scene, /properties\.passable === true \|\| PASSABLE_OBJECT_TYPES\.has\(type\)[\s\S]*?climbCost: 0/);
});
