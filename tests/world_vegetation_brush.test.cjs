const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/worldVegetationBrush.js'), 'utf8');
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

async function harness(overrides = {}) {
    const { planWorldVegetationBrush } = await modulePromise;
    const tiles = Array.from({ length: 32 }, () => Array.from({ length: 64 }, () => ({ terrain: 'grass', height: 1, objects: [] })));
    const options = { centers: [{ x: 31, y: 15 }], radius: 2, density: 100, ignoreGround: false,
        settings: { type: 'tree', scale: 1, rotation: 0, color: '#315f3b' }, seed: 19,
        width: 64, height: 32, getTile: (x, y) => tiles[y][x], ...overrides };
    const plan = changes => planWorldVegetationBrush({ ...options, ...changes });
    const apply = updates => updates.forEach(item => Object.assign(tiles[item.chunk_y * 32 + item.tile_y][item.chunk_x * 32 + item.tile_x], item.updates));
    return { tiles, options, plan, apply };
}

test('tree and forest brushes fill the selected square across chunks without modifying other objects', async () => {
    for (const type of ['tree', 'forest']) {
        const h = await harness({ settings: { type, scale: 1, rotation: 0, color: '#315f3b' } });
        const house = { type: 'house', name: 'Keep', custom: { original: true } };
        h.tiles[15][31].objects = [house];
        const updates = h.plan();
        assert.equal(updates.length, 25);
        assert.equal(new Set(updates.map(item => item.chunk_x)).size, 2);
        assert.equal(h.tiles[15][31].objects.length, 1, 'planning does not mutate live tiles');
        h.apply(updates);
        assert.equal(h.tiles[15][31].objects[0], house);
        assert.equal(h.tiles[15][31].objects[1].type, type);
        assert.equal(h.plan().length, 0, 'a new stroke adds no duplicates');
        const reloaded = JSON.parse(JSON.stringify(h.tiles));
        assert.equal(h.plan({ getTile: (x, y) => reloaded[y][x] }).length, 0);
        assert.deepEqual(reloaded, h.tiles, 'loading or painting again preserves saved transforms');
    }
});

test('ground restrictions exclude only water and rock and the override removes only this restriction', async () => {
    const h = await harness({ centers: [{ x: 5, y: 5 }], radius: 1 });
    h.tiles[4][4].terrain = 'water';
    h.tiles[4][5].terrain = 'rock';
    h.tiles[5][4].terrain = 'swamp';
    h.tiles[5][5].height = 30;
    h.apply(h.plan());
    assert.equal(h.tiles[4][4].objects.length, 0);
    assert.equal(h.tiles[4][5].objects.length, 0);
    assert.equal(h.tiles[5][4].objects.length, 1);
    assert.equal(h.tiles[5][5].objects.length, 1, 'slope and height do not impose extra restrictions');
    const overridden = h.plan({ ignoreGround: true });
    assert.equal(overridden.length, 2);
    h.apply(overridden);
    assert.equal(h.plan({ ignoreGround: true }).length, 0, 'override does not allow duplicate vegetation');
    const saved = JSON.stringify(h.tiles[5][5].objects);
    h.tiles[5][5].terrain = 'rock';
    h.plan();
    assert.equal(JSON.stringify(h.tiles[5][5].objects), saved, 'changing ground never deletes saved objects');
});

test('density creates deterministic gaps, higher density fills more cells, and transforms vary within limits', async () => {
    const h = await harness({ radius: 4 });
    assert.equal(h.plan({ density: 0 }).length, 0);
    const sparse = h.plan({ density: 25 });
    const dense = h.plan({ density: 75 });
    assert.ok(sparse.length > 0 && sparse.length < dense.length && dense.length < 81);
    assert.deepEqual(h.plan({ density: 25 }), sparse);
    const keys = new Set(dense.map(item => `${item.chunk_x},${item.tile_x},${item.tile_y}`));
    assert.ok(sparse.every(item => keys.has(`${item.chunk_x},${item.tile_x},${item.tile_y}`)));
    const objects = dense.map(item => item.updates.objects.at(-1));
    assert.ok(new Set(objects.map(object => object.rotation)).size > 1);
    assert.ok(new Set(objects.map(object => object.scale)).size > 1);
    assert.ok(objects.every(object => Math.abs(object.x) <= 0.34 && Math.abs(object.z) <= 0.34
        && object.scale >= 0.85 && object.scale <= 1.15 && object.rotation >= 0 && object.rotation <= 359));
});

test('smallest brush places at the cursor, bounds are clipped, and legacy trees and forests are both retained', async () => {
    const h = await harness({ centers: [{ x: 0, y: 0 }], radius: 0, density: 1, anchor: { x: 0.7, z: 0.3 } });
    const updates = h.plan();
    assert.equal(updates.length, 1);
    assert.ok(Math.abs(updates[0].updates.objects[0].x - 0.2) < 1e-9);
    assert.ok(Math.abs(updates[0].updates.objects[0].z + 0.2) < 1e-9);
    assert.equal(h.plan({ radius: 4, density: 100, anchor: null }).length, 25);
    h.tiles[0][0].objects = [{ type: 'forest', scale: 0.777, rotation: 37.5 }, { type: 'tree' }];
    assert.equal(h.plan().length, 0);
    assert.equal(h.tiles[0][0].objects.length, 2);
});

test('fast strokes fill skipped centers and visit overlapping cells only once', async () => {
    const { vegetationStrokeCenters } = await modulePromise;
    const h = await harness({ radius: 0 });
    const centers = [...vegetationStrokeCenters(null, { x: 2, y: 10 }),
        ...vegetationStrokeCenters({ x: 2, y: 10 }, { x: 12, y: 10 })];
    const visited = new Set();
    const updates = h.plan({ centers, visited });
    assert.equal(updates.length, 11);
    assert.equal(h.plan({ centers: centers.reverse(), visited }).length, 0);
    const first = await harness();
    const forward = first.plan({ centers: [{ x: 29, y: 15 }, { x: 31, y: 15 }], density: 60 });
    const backward = first.plan({ centers: [{ x: 31, y: 15 }, { x: 29, y: 15 }], density: 60 });
    const sorted = list => list.sort((a, b) => (a.chunk_x * 32 + a.tile_x) - (b.chunk_x * 32 + b.tile_x) || a.tile_y - b.tile_y);
    assert.deepEqual(sorted(forward), sorted(backward), 'stroke direction does not randomize saved placement');
});
