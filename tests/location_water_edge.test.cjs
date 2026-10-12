const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const load = async name => import(`data:text/javascript;base64,${Buffer.from(read(name)).toString('base64')}`);

test('enclosed water has rounded corners and matching bank fill', async () => {
    const { buildRoundedWaterData } = await load('locationWaterEdge.js');
    const tiles = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => (
        { terrain: 'grass', height: 1 }
    )));
    tiles[1][1] = { terrain: 'water', height: 0.99 };
    const data = buildRoundedWaterData(tiles);
    assert.equal(data.water.length, 16 * 9);
    assert.equal(data.bank.length, 288 * 9);
    assert.equal(data.bankColors.length, data.bank.length);
    assert.equal(data.bankUvs.length, data.bank.length / 3 * 2);
    assert.ok(data.bankUvs.every(value => value >= 0 && value <= 1));
    const shoreTints = [];
    for (let index = 0; index < data.bank.length; index += 3) {
        const x = data.bank[index];
        const z = data.bank[index + 2];
        if (x === 1 || x === 2 || z === 1 || z === 2) shoreTints.push(data.bankColors[index]);
    }
    assert.ok(shoreTints.some(value => value === 1));
    assert.ok(data.bankColors.some(value => value < 0.8));
    assert.ok(data.water.every((number, index) => index % 3 !== 1 || number === 1.002));
    const bankHeights = data.bank.filter((_, index) => index % 3 === 1);
    assert.ok(bankHeights.some(height => height === 0.996));
    assert.ok(bankHeights.some(height => height === 1.006));
    assert.ok(data.water.some((number, index) => index % 3 === 0 && number > 1 && number < 1.1));
});

test('water adopts its dominant shore across a connected basin', async () => {
    const { buildRoundedWaterData, classifyWaterRegions, waterLevelForTile } = await load('locationWaterEdge.js');
    const basin = kind => {
        const tiles = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => (
            { terrain: kind, height: 1 }
        )));
        for (let z = 1; z < 4; z++) {
            for (let x = 1; x < 4; x++) tiles[z][x] = { terrain: 'water', height: 1 };
        }
        return tiles;
    };
    for (const kind of ['swamp', 'sand', 'rock', 'grass']) {
        const tiles = basin(kind);
        const regions = classifyWaterRegions(tiles);
        assert.equal(regions.size, 9);
        assert.equal(regions.get('2,2'), kind);
        const data = buildRoundedWaterData(tiles);
        assert.equal(data.waterColors.length, data.water.length);
        assert.equal(data.regions.get('2,2'), kind);
        const level = waterLevelForTile(tiles[2][2], kind);
        assert.equal(level, kind === 'sand' ? 0.8 : 1);
        assert.ok(data.water.every((value, index) => index % 3 !== 1
            || Math.abs(value - (level + 0.012)) < 0.000001));
    }
    const grassColors = buildRoundedWaterData(basin('grass')).waterColors;
    assert.ok(grassColors.every(value => value === 1));
    assert.notDeepEqual(buildRoundedWaterData(basin('swamp')).waterColors, grassColors);
    assert.notDeepEqual(buildRoundedWaterData(basin('rock')).waterColors, grassColors);
    assert.notDeepEqual(buildRoundedWaterData(basin('sand')).waterColors, grassColors);
    const sandData = buildRoundedWaterData(basin('sand'));
    assert.equal(sandData.bank.length, 0);
    assert.ok(sandData.sandBank.length > 0);
    assert.equal(sandData.sandBankColors.length, sandData.sandBank.length);
    assert.ok(sandData.sandBank.some((value, index) => index % 3 === 1 && value < 0.9));
    const scene = read('locationScene.js');
    assert.match(scene, /waterGeometry\.setAttribute\('color', new THREE\.Float32BufferAttribute\(data\.waterColors, 3\)\)/);
    assert.match(scene, /waterLevelForTile\(tile, waterKind\)/);
    assert.match(scene, /createWaterDetailGroup\(THREE, currentLocationData\.tiles_data, waterRegions\)/);
});

test('world chunks can reuse rounded shoreline geometry without drawing neighbor tiles', async () => {
    const { buildRoundedWaterData } = await load('locationWaterEdge.js');
    const tiles = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => (
        { terrain: 'sand', height: 1 }
    )));
    tiles[1][1] = { terrain: 'water', height: 1 };
    tiles[1][2] = { terrain: 'water', height: 1 };
    const data = buildRoundedWaterData(tiles, 0.24,
        (x, z) => x === 1 && z === 1, [0, 0.075, 0.23, 0.5, 0.77, 0.925, 1],
        tile => tile.height);
    assert.equal(data.water.length, 12 * 9);
    assert.ok(data.water.every((value, index) => index % 3 !== 1 || value === 1.012));
    assert.ok(data.sandBank.length > 0);
    assert.equal(data.bankBaseColors.length, data.bank.length);
    const world = read('lobby3d.js');
    assert.match(world, /new THREE\.InstancedMesh\(groundGeo, waterInstanceMaterials, totalTiles\)/);
    assert.match(world, /refreshWorldWaterChunk\(entry, padded\)/);
    assert.match(world, /mesh\.position\.set\(originX, 0, originZ\)/);
});

test('an unloaded neighboring chunk does not remove the water top or abort road setup', async () => {
    const { buildRoundedWaterData, classifyWaterRegions } = await load('locationWaterEdge.js');
    const water = { terrain: 'water', height: 1 };
    const tiles = [[null, null, null], [null, water, null], [null, null, null]];
    assert.equal(classifyWaterRegions(tiles).size, 1);
    const data = buildRoundedWaterData(tiles, 0.24, (x, z) => x === 1 && z === 1);
    assert.equal(data.water.length, 8 * 9);
    assert.equal(data.bank.length + data.sandBank.length, 0);
    const world = read('lobby3d.js');
    assert.match(world, /refreshWorldTerrainNeighborhood\(cx, cy, null, null, false, false, true, true\);\s*refreshRoadNeighborhood\(cx, cy\)/);
});

test('adjoining water cells keep their shared edge and rebuild without separate objects', async () => {
    const { buildRoundedWaterData } = await load('locationWaterEdge.js');
    const tiles = [
        [{ terrain: 'sand', height: 1 }, { terrain: 'sand', height: 1 }, { terrain: 'sand', height: 1 }, { terrain: 'sand', height: 1 }],
        [{ terrain: 'sand', height: 1 }, { terrain: 'water', height: 1 }, { terrain: 'water', height: 1 }, { terrain: 'sand', height: 1 }],
        [{ terrain: 'sand', height: 1 }, { terrain: 'sand', height: 1 }, { terrain: 'sand', height: 1 }, { terrain: 'sand', height: 1 }],
    ];
    const data = buildRoundedWaterData(tiles);
    assert.equal((data.bank.length + data.sandBank.length) / 9, 576);
    assert.ok(data.water.length > 0);
    const scene = read('locationScene.js');
    assert.match(scene, /rebuildWaterSurfaceMesh\(\)/);
    assert.match(scene, /waterSurfaceMesh\.raycast = \(\) => \{\}/);
    assert.match(scene, /waterBankMesh\.raycast = \(\) => \{\}/);
});

test('straight shoreline corners inset consistently across neighboring water cells', async () => {
    const { buildRoundedWaterData } = await load('locationWaterEdge.js');
    const land = { terrain: 'sand', height: 1 };
    const water = { terrain: 'water', height: 1 };
    const data = buildRoundedWaterData([[land, land], [water, water]]);
    const corners = [];
    for (let index = 0; index < data.water.length; index += 9) {
        const centerX = data.water[index];
        const centerZ = data.water[index + 2];
        for (const offset of [3, 6]) {
            if (Math.abs(data.water[index + offset] - 1) < 0.000001
                && Math.abs(data.water[index + offset + 2] - 1.075) < 0.000001) {
                corners.push(centerX, centerZ);
            }
        }
    }
    assert.ok(corners.includes(0.5) && corners.includes(1.5));
});

test('raised water has a sloping shore backed by a solid basin', async () => {
    const { buildRoundedWaterData } = await load('locationWaterEdge.js');
    const tiles = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => (
        { terrain: 'swamp', height: 0.6 }
    )));
    tiles[1][1] = { terrain: 'water', height: 1.4 };
    const data = buildRoundedWaterData(tiles);
    const heights = data.bank.filter((_, index) => index % 3 === 1);
    assert.ok(heights.some(height => Math.abs(height - 0.606) < 0.000001));
    assert.ok(heights.some(height => Math.abs(height - 1.406) < 0.000001));
    const scene = read('locationScene.js');
    assert.match(scene, /new THREE\.InstancedMesh\(geometry\.clone\(\), \[/);
    assert.doesNotMatch(scene, /waterMaterial\.colorWrite = false/);
    assert.doesNotMatch(scene, /waterTileMesh\?\.material\.map/);
});

test('three water cells do not leave detached water patches over the land corner', async () => {
    const { buildRoundedWaterData } = await load('locationWaterEdge.js');
    const water = { terrain: 'water', height: 1 };
    const land = { terrain: 'sand', height: 1 };
    const data = buildRoundedWaterData([[land, water], [water, water]]);
    for (let index = 0; index < data.water.length; index += 3) {
        assert.ok(!(data.water[index] < 1 && data.water[index + 2] < 1));
    }
    assert.ok(data.bank.length + data.sandBank.length > 0);
    assert.equal(data.water.length % 9, 0);
    const upperRightTriangles = [];
    for (let index = 0; index < data.water.length; index += 9) {
        if (data.water[index] === 1.5 && data.water[index + 2] === 0.5) {
            upperRightTriangles.push(data.water.slice(index, index + 9));
        }
    }
    assert.ok(upperRightTriangles.some(triangle => (
        (triangle[3] === 1 && triangle[5] === 1)
        || (triangle[6] === 1 && triangle[8] === 1)
    )));
});

test('darkness preserves the water material shader', async () => {
    const { applySurfaceDarkness } = await load('locationDarknessSurface.js');
    const material = {
        customProgramCacheKey: () => 'water',
        onBeforeCompile(shader) { shader.fragmentShader += '\nwater-pattern'; },
    };
    applySurfaceDarkness(material, {}, { x: 3, y: 3 });
    const shader = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    material.onBeforeCompile(shader);
    assert.match(material.customProgramCacheKey(), /water:location-surface-plain/);
    assert.match(shader.fragmentShader, /water-pattern/);
    assert.match(shader.fragmentShader, /locationDarknessMap/);
});
