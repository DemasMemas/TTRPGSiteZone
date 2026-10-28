const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const modulePromise = import('data:text/javascript;base64,' + fs.readFileSync('app/static/js/locationEditorHistory.js').toString('base64'));

test('multiple undo/redo steps preserve fractions and use own latest revision', async () => {
    const { createLocationEditorHistory, copy } = await modulePromise;
    const history = createLocationEditorHistory();
    const object = (rotation, revision) => ({ id: 7, revision, properties: { rotation, width: .375 } });
    history.push({ objects: [{ id: 7, before: object(0, 1), after: object(12.345, 2) }], tiles: [] });
    history.push({ objects: [{ id: 7, before: object(12.345, 2), after: object(24.69, 3) }], tiles: [] });
    let current = object(24.69, 3);
    const apply = async change => {
        assert.deepEqual(change.objects[0].before, current);
        const saved = copy(change);
        saved.objects[0].after.revision = current.revision + 1;
        current = copy(saved.objects[0].after);
        return saved;
    };
    assert.equal(await history.replay(false, apply), true);
    assert.equal(current.properties.rotation, 12.345);
    await history.replay(false, apply);
    assert.equal(current.properties.rotation, 0);
    await history.replay(true, apply);
    await history.replay(true, apply);
    assert.equal(current.properties.rotation, 24.69);
    assert.equal(current.properties.width, .375);
});

test('conflict retains stacks; a new command drops redo; reset clears session', async () => {
    const { createLocationEditorHistory } = await modulePromise;
    const h = createLocationEditorHistory();
    const c = { objects: [], tiles: [{ x: 0, z: 0, before: [], after: [{ rotation: 12.345 }] }] };
    h.push(c);
    await assert.rejects(h.replay(false, async () => { throw Error('conflict'); }));
    assert.deepEqual(h.state(), { undo: 1, redo: 0, busy: false });
    await h.replay(false, async change => change);
    assert.equal(h.state().redo, 1);
    h.push(c);
    assert.equal(h.state().redo, 0);
    h.reset();
    assert.deepEqual(h.state(), { undo: 0, redo: 0, busy: false });
});

test('reset while replay is in flight cannot populate another scene history', async () => {
    const { createLocationEditorHistory } = await modulePromise;
    const h = createLocationEditorHistory();
    h.push({ objects: [{ id: 1, before: null, after: { id: 1, revision: 1 } }], tiles: [] });
    let finish;
    const pending = h.replay(false, change => new Promise(resolve => { finish = () => resolve(change); }));
    h.reset(); finish();
    assert.equal(await pending, false);
    assert.deepEqual(h.state(), { undo: 0, redo: 0, busy: false });
});

test('cells, darkness and environment share the object command order', async () => {
    const { createLocationEditorHistory } = await modulePromise;
    const h = createLocationEditorHistory();
    const a = { objects: [], tiles: [], cells: [{ x: 1, z: 2, before: { terrain: 'grass', height: 1 }, after: { terrain: 'sand', height: 1.234567 } }] };
    const b = { objects: [], tiles: [], darkness: [{ x: 1, z: 2, before: false, after: true }] };
    const c = { objects: [], tiles: [], environment: { before: { ambient_intensity: .25 }, after: { ambient_intensity: .375 } } };
    for (const change of [a, b, c]) h.push(change);
    const seen = [];
    const apply = async change => { seen.push(change); return change; };
    for (let i = 0; i < 3; i++) await h.replay(false, apply);
    assert.equal(seen[0].environment.after.ambient_intensity, .25);
    assert.equal(seen[1].darkness[0].after, false);
    assert.deepEqual(seen[2].cells[0].after, a.cells[0].before);
    for (let i = 0; i < 3; i++) await h.replay(true, apply);
    assert.deepEqual(seen[3], a); assert.deepEqual(seen[4], b); assert.deepEqual(seen[5], c);
});
