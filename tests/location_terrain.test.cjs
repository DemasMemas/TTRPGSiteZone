const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const load = async name => import(`data:text/javascript;base64,${Buffer.from(read(name)).toString('base64')}`);

test('neighboring smooth tiles share their edge and keep cell-center height', async () => {
    const { buildSmoothTerrainData } = await load('locationTerrain.js');
    const tiles = [[
        { terrain: 'grass', height: 1, surface: 'smooth' },
        { terrain: 'grass', height: 2, surface: 'smooth' },
    ]];
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
    const { buildSmoothTerrainData } = await load('locationTerrain.js');
    const data = buildSmoothTerrainData([[{ terrain: 'rock', height: 2.6 }]]);
    assert.equal(data.positions.length, 0);
    const scene = read('locationScene.js');
    assert.match(scene, /tile\.surface === 'smooth' && !isWater/);
    assert.match(scene, /hit\?\.object\?\.userData\?\.tileByFace\?\.\[hit\.faceIndex\]/);
    assert.match(scene, /rebuildSmoothTerrainMesh\(\)/);
});

test('floor is passable and does not charge climb movement in the client', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /PASSABLE_OBJECT_TYPES = new Set\(\[[^\]]*'floor'/);
    assert.match(scene, /properties\.passable === true \|\| PASSABLE_OBJECT_TYPES\.has\(type\)[\s\S]*?climbCost: 0/);
});
