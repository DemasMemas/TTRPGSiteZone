const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../app/static/js/worldObjectSelection.js'), 'utf8');
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('mouse transforms preserve fractional scale, clamp its bounds and turn clockwise to the right', async () => {
    const { worldObjectMouseTransform } = await modulePromise;
    assert.equal(worldObjectMouseTransform('scale', { scale: 1.234567 }, 10).scale, 1.334567);
    assert.equal(worldObjectMouseTransform('scale', { scale: 1.234567 }, -10).scale, 1.134567);
    assert.equal(worldObjectMouseTransform('scale', { scale: 1 }, 1000).scale, 2);
    assert.equal(worldObjectMouseTransform('scale', { scale: 1 }, -1000).scale, 0.2);
    assert.equal(worldObjectMouseTransform('rotate', { rotation: 0 }, 30).rotation, 345);
    assert.equal(worldObjectMouseTransform('rotate', { rotation: 0 }, -30).rotation, 15);
    assert.equal(worldObjectMouseTransform('rotate', { rotation: 37.5 }, 30).rotation, 22.5);
});

test('instance picking resolves the exact index among interleaved objects of the same type', async () => {
    const { objectFromWorldInstance } = await modulePromise;
    const tilesData = [[{ objects: [{ type: 'tree' }, { type: 'house' }, { type: 'tree' }] }, {}], [{}, {}]];
    const entry = { chunkX: 2, chunkY: 3, tilesData };
    assert.deepEqual(objectFromWorldInstance(entry, 'tree', 5, [[4, 5], [], [], []]), {
        chunkX: 2, chunkY: 3, tileX: 0, tileY: 0, index: 2,
    });
    assert.equal(objectFromWorldInstance(entry, 'tree', 9, [[4, 5], [], [], []]), null);
});

test('drag preserves the grab offset, crosses chunks and rejects map edges', async () => {
    const { worldObjectDragTarget } = await modulePromise;
    const target = worldObjectDragTarget({ x: 31.9, z: 10.2 }, { x: 0.4, z: 0.1 }, 64, 32);
    assert.equal(target.tile_x, 32);
    assert.equal(target.tile_y, 10);
    assert.ok(Math.abs(target.x + 0.2) < 1e-9);
    assert.ok(Math.abs(target.z + 0.2) < 1e-9);
    assert.equal(worldObjectDragTarget({ x: 64, z: 1 }, { x: 0, z: 0 }, 64, 32), null);
    assert.equal(worldObjectDragTarget({ x: -0.1, z: 1 }, { x: 0, z: 0 }, 64, 32), null);
});

async function harness() {
    const { createWorldObjectSelection } = await modulePromise;
    const source = { objects: [{ type: 'factory', scale: 1, rotation: 0, custom: { retained: true } }, { type: 'tree' }] };
    const destination = { objects: [{ type: 'house' }] };
    const calls = [], errors = [], notifications = [];
    let resolveRequest;
    const controller = createWorldObjectSelection({
        equal: require('node:util').isDeepStrictEqual,
        getTile: ref => ref.chunkX === 0 ? source : destination,
        editObject(payload) { calls.push(payload); return new Promise(resolve => { resolveRequest = resolve; }); },
        applyUpdate: item => Object.assign(item.chunk_x === 0 ? source : destination, item.updates),
        onChange: (selection, busy) => notifications.push({ selection, busy }),
        onError: message => errors.push(message),
    });
    controller.select({ chunkX: 0, chunkY: 0, tileX: 31, tileY: 10, index: 0 });
    return { controller, source, destination, calls, errors, notifications, resolve: result => resolveRequest(result) };
}

test('move uses one guarded transaction and retains destination objects and exact transforms', async () => {
    const h = await harness();
    const changes = { x: -0.12345, z: 0.23456, scale: 1.23456, rotation: 123.456 };
    const pending = h.controller.commit(changes, { tile_x: 32, tile_y: 10 });
    assert.equal(h.controller.busy, true);
    assert.equal(await h.controller.commit({ scale: 2 }), false);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].expected.custom.retained, true);
    const moved = { ...h.source.objects[0], ...changes };
    h.resolve({ index: 1, updates: [
        { chunk_x: 0, updates: { objects: [h.source.objects[1]] } },
        { chunk_x: 1, updates: { objects: [h.destination.objects[0], moved] } },
    ] });
    assert.equal(await pending, true);
    assert.equal(h.source.objects.length, 1);
    assert.equal(h.destination.objects[0].type, 'house');
    assert.equal(h.controller.selected.chunkX, 1);
    assert.deepEqual(h.controller.selected.object, moved);
});

test('remote conflicts invalidate a selection before writing and a no-op makes no request', async () => {
    const h = await harness();
    assert.equal(await h.controller.commit({ scale: 1 }), true);
    assert.equal(h.calls.length, 0);
    h.source.objects[0] = { type: 'tree' };
    assert.equal(await h.controller.commit({ scale: 2 }), false);
    assert.equal(h.controller.selected, null);
    assert.equal(h.calls.length, 0);
    assert.equal(h.errors.length, 1);
});

test('equivalent socket echoes with reordered keys preserve selection', async () => {
    const h = await harness();
    h.source.objects[0] = { custom: { retained: true }, rotation: 0, scale: 1, type: 'factory' };
    assert.equal(h.controller.validate(), true);
    assert.equal(h.errors.length, 0);
});

test('delete keeps the expected snapshot and clearing selection during a request does not resurrect it', async () => {
    const h = await harness();
    const expected = h.controller.selected.object;
    const pending = h.controller.commit({}, null, true);
    assert.equal(h.calls[0].delete, true);
    assert.deepEqual(h.calls[0].expected, expected);
    h.controller.clear();
    h.resolve({ index: null, updates: [{ chunk_x: 0, updates: { objects: [h.source.objects[1]] } }] });
    await pending;
    assert.equal(h.controller.selected, null);
    assert.equal(h.source.objects[0].type, 'tree');
});
