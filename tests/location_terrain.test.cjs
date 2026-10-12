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
    assert.ok(data.foundationByTile.get('0,0') < 1);
    assert.ok(data.foundationByTile.get('0,0') > 0.9);
    assert.ok(data.foundationByTile.get('1,0') < 1.5);
});

test('a chunk slope uses a loaded neighbor without generating its tiles twice', async () => {
    const { buildSmoothTerrainData } = await load('locationTerrain.js');
    const tiles = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => (
        { terrain: 'grass', height: 1 }
    )));
    tiles[1][3].height = 3;
    const data = buildSmoothTerrainData(tiles, (x, z) => x > 0 && x <= 2 && z > 0 && z <= 2);
    assert.ok(data.tileByFace.length > 0);
    assert.ok(data.tileByFace.every(({ x, z }) => x <= 2 && z <= 2));
    const sharedEdgeHeights = [];
    for (let index = 0; index < data.positions.length; index += 3) {
        if (data.topByVertex[index / 3] && data.positions[index] === 3
            && data.positions[index + 2] === 1.5) sharedEdgeHeights.push(data.positions[index + 1]);
    }
    assert.ok(sharedEdgeHeights.length > 0);
    assert.ok(sharedEdgeHeights.every(value => value === 2));
});

test('grass height sampler follows the rendered slope and caches its ring', async () => {
    const { createTerrainSurfaceHeightSampler } = await load('locationTerrain.js');
    const sample = createTerrainSurfaceHeightSampler([[
        { terrain: 'grass', height: 1 }, { terrain: 'grass', height: 3 },
    ]]);
    assert.equal(sample(0.5, 0.5), 1);
    assert.equal(sample(1, 0.5), 2);
    assert.equal(sample(1.5, 0.5), 3);
    assert.ok(sample(0.75, 0.5) > 1 && sample(0.75, 0.5) < 2);
});

test('steep hill rounds its crest without opening a gap at the shared edge', async () => {
    const { buildSmoothTerrainData, createTerrainSurfaceHeightSampler, buildFogSurfaceData } = await load('locationTerrain.js');
    const tiles = [[{ terrain: 'grass', height: 1 }, { terrain: 'grass', height: 3 }]];
    const sample = createTerrainSurfaceHeightSampler(tiles);
    assert.equal(sample(1, 0.5), 2);
    assert.ok(sample(1.25, 0.5) > 2.5);
    assert.ok(sample(0.75, 0.5) < 1.5);
    const mesh = buildSmoothTerrainData(tiles);
    assert.ok(mesh.tileByFace.filter(({ x }) => x === 1).length > 8);
    assert.equal(mesh.normals.length, mesh.positions.length);
    for (let index = 0; index < mesh.topByVertex.length; index++) {
        if (mesh.topByVertex[index]) assert.ok(mesh.normals[index * 3 + 1] > 0);
    }
    const crest = new Map();
    for (let index = 0; index < mesh.topByVertex.length; index++) {
        if (!mesh.topByVertex[index]) continue;
        const point = mesh.positions.slice(index * 3, index * 3 + 3);
        const normal = Array.from(mesh.normals.slice(index * 3, index * 3 + 3));
        const key = point.join(':');
        if (crest.has(key)) assert.deepEqual(normal, crest.get(key));
        else crest.set(key, normal);
    }
    const fog = buildFogSurfaceData(tiles);
    assert.ok(fog.tileIndices[1].length > 24);
    const diagonal = [[{ terrain: 'grass', height: 3 }, { terrain: 'grass', height: 1 }],
        [{ terrain: 'grass', height: 1 }, { terrain: 'grass', height: 1 }]];
    const diagonalMesh = buildSmoothTerrainData(diagonal);
    assert.ok(diagonalMesh.tileByFace.filter(({ x, z }) => x === 1 && z === 1).length > 8);
});

test('sand cliffs have finer top bands without changing their shared edge height', async () => {
    const { buildSmoothTerrainData, createTerrainSurfaceHeightSampler } = await load('locationTerrain.js');
    const sand = [[{ terrain: 'sand', height: 1 }, { terrain: 'sand', height: 3 }]];
    const grass = [[{ terrain: 'grass', height: 1 }, { terrain: 'grass', height: 3 }]];
    const sandMesh = buildSmoothTerrainData(sand);
    const grassMesh = buildSmoothTerrainData(grass);
    assert.ok(sandMesh.tileByFace.length > grassMesh.tileByFace.length);
    assert.equal(createTerrainSurfaceHeightSampler(sand)(1, 0.5), 2);
});

test('diagonal height changes include flat corner neighbors in the smooth mesh', async () => {
    const { buildSmoothTerrainData, isSmoothTerrainTile } = await load('locationTerrain.js');
    const tiles = [
        [{ terrain: 'sand', height: 1 }, { terrain: 'sand', height: 1 }],
        [{ terrain: 'sand', height: 1 }, { terrain: 'rock', height: 3 }],
    ];
    assert.equal(isSmoothTerrainTile(tiles, 0, 0), true);
    const data = buildSmoothTerrainData(tiles);
    assert.ok(data.tileByFace.some(({ x, z }) => x === 0 && z === 0));
});

test('isolated flat terrain stays outside the smooth mesh; taller steps still blend', async () => {
    const { buildSmoothTerrainData, isSmoothTerrainTile } = await load('locationTerrain.js');
    const data = buildSmoothTerrainData([[{ terrain: 'rock', height: 2.6 }]]);
    assert.equal(data.positions.length, 0);
    const cliff = [[{ terrain: 'rock', height: 1 }, { terrain: 'rock', height: 2.01 }]];
    assert.equal(isSmoothTerrainTile(cliff, 0, 0), true);
    assert.equal(isSmoothTerrainTile(cliff, 1, 0), true);
    const slope = buildSmoothTerrainData(cliff);
    assert.ok(slope.positions.length > 0);
    assert.ok(slope.positions.some((height, index) => index % 3 === 1 && height === 1.505));
    const scene = read('locationScene.js');
    assert.match(scene, /isSmoothTerrainTile\(currentLocationData\.tiles_data, x, z\)/);
    assert.match(scene, /hit\?\.object\?\.userData\?\.tileByFace\?\.\[hit\.faceIndex\]/);
    assert.match(scene, /rebuildSmoothTerrainMesh\(\)/);
});

test('a changed height also refreshes neighboring tile geometry', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /for \(let dz = -1; dz <= 1; dz\+\+\)/);
    assert.match(scene, /for \(let dx = -1; dx <= 1; dx\+\+\) neighbors\.push\(\[x \+ dx, z \+ dz\]\)/);
    assert.match(scene, /for \(const \[nx, nz\] of neighbors\)[\s\S]*?updateTileInstance/);
    assert.match(scene, /terrainNeedsRebuild = updateTileCube\(x, z, tile, false\) \|\| terrainNeedsRebuild/);
    assert.match(scene, /if \(terrainNeedsRebuild\) rebuildSmoothTerrainMesh\(\)/);
});

test('steep top faces retain terrain blending while exposed vertical sides do not', async () => {
    const { buildSmoothTerrainData } = await load('locationTerrain.js');
    const mesh = buildSmoothTerrainData([[{ terrain: 'grass', height: 1 },
        { terrain: 'sand', height: 3 }]]);
    assert.equal(mesh.topByVertex.length, mesh.positions.length / 3);
    assert.ok(mesh.topByVertex.includes(1));
    assert.ok(mesh.topByVertex.includes(0));
    const scene = read('locationScene.js');
    assert.match(scene, /setAttribute\('terrainTop'/);
    assert.doesNotMatch(scene, /applyTerrainBlend\(material, locationBlendMapUniform, locationBlendSizeUniform, true, true\)/);
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
    assert.match(scene, /if \(gridNeedsRebuild\) \{[\s\S]*?rebuildLocationTerrainSurface\(true\);\s*rebuildWaterSurfaceMesh\(\);\s*rebuildLocationGrid\(\);/);
    assert.match(scene, /if \(updates\.terrain !== undefined \|\| updates\.height !== undefined\) \{[\s\S]*?rebuildLocationTerrainSurface\(true\);\s*rebuildWaterSurfaceMesh\(\);\s*rebuildLocationGrid\(\);/);
    assert.match(scene, /updateLocationGridColors\(\)/);
    assert.match(scene, /locationGridMesh\.raycast = \(\) => \{\}/);
    assert.doesNotMatch(scene, /gridLines\.push\(x, -0\.1/);
});

test('one connected water surface follows the median shoreline and manual height remains available', async () => {
    const { waterSurfaceAdjustments } = await load('locationTerrain.js');
    const tiles = [
        [{ terrain: 'grass', height: 1 }, { terrain: 'grass', height: 1.1 }, { terrain: 'grass', height: 3 }],
        [{ terrain: 'grass', height: 1 }, { terrain: 'water', height: 0.65 }, { terrain: 'water', height: 0.65 }],
        [{ terrain: 'grass', height: 1 }, { terrain: 'grass', height: 1.05 }, { terrain: 'grass', height: 3 }],
    ];
    const changes = waterSurfaceAdjustments(tiles);
    assert.equal(changes.length, 2);
    assert.equal(changes[0].height, changes[1].height);
    assert.ok(changes[0].height >= 1 && changes[0].height <= 1.1);
    assert.equal(tiles[1][1].height, 0.65);
    const allWater = waterSurfaceAdjustments([[
        { terrain: 'water', height: 0.7 }, { terrain: 'water', height: 1.3 },
    ]]);
    assert.equal(allWater.length, 2);
    assert.ok(allWater.every(item => item.height === 1));
    const separate = waterSurfaceAdjustments([[
        { terrain: 'grass', height: 1 }, { terrain: 'water', height: 0.5 },
        { terrain: 'grass', height: 1 }, { terrain: 'water', height: 0.3 },
        { terrain: 'grass', height: 1 },
    ]], new Set(['1,0']));
    assert.deepEqual(separate.map(item => item.x), [1]);
    const scene = read('locationScene.js');
    assert.match(scene, /if \(updates\.terrain !== undefined\) \{\s*const changedByTile/);
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

test('roof and grid toggles share a fixed gap instead of separate offsets', () => {
    const scene = read('locationScene.js');
    const main = read('main.js');
    assert.match(scene, /group\.id = 'location-view-toggle-group'/);
    assert.match(scene, /group\.style\.right = '271px'/);
    assert.match(scene, /group\.style\.gap = '8px'/);
    assert.match(scene, /getLocationViewToggleGroup\(\)\.prepend\(btn\)/);
    assert.match(scene, /getLocationViewToggleGroup\(\)\.appendChild\(btn\)/);
    assert.match(main, /document\.getElementById\('location-view-toggle-group'\)\?\.remove\(\)/);
});

test('flat terrain and water tiles fill their cells without permanent grid gaps', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /const geometry = new THREE\.BoxGeometry\(1, 1, 1\)/);
    assert.match(scene, /const waterMaterial = new THREE\.MeshStandardMaterial\(\{ color: 0xffffff \}\)/);
    assert.match(scene, /WATER_SIDE_COLORS = \{ grass: 0x183c4a/);
    assert.match(scene, /new THREE\.InstancedMesh\(geometry\.clone\(\), \[/);
    assert.match(scene, /Math\.max\(0\.05, waterLevelForTile\(tile, waterKind\) - 0\.01\) : height/);
    assert.doesNotMatch(scene, /new THREE\.BoxGeometry\(0\.98, 1, 0\.98\)/);
});

test('floor is passable and does not charge climb movement in the client', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /PASSABLE_OBJECT_TYPES = new Set\(\[[^\]]*'floor'/);
    assert.match(scene, /properties\.passable === true \|\| PASSABLE_OBJECT_TYPES\.has\(type\)[\s\S]*?climbCost: 0/);
});
