const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const numeric = import('data:text/javascript;base64,' + Buffer.from(source('worldNumericInputs.js')).toString('base64'));

function input(value, min = '', max = '', step = 'any') {
    return {
        _value: String(value), min, max, step, dataset: {}, validity: { badInput: false }, handlers: {}, attributes: {},
        get value() { return this._value; },
        set value(value) { this._value = String(value); },
        setCustomValidity(message) { this.error = message; },
        setAttribute(key, value) { this.attributes[key] = value; },
        removeAttribute(key) { delete this.attributes[key]; },
        reportValidity() { this.reported = true; },
        addEventListener(key, fn) { this.handlers[key] = fn; },
    };
}

test('empty, incomplete, nonfinite and out-of-range drafts never become zero', async () => {
    const { readNumericInput } = await numeric;
    const field = input('', '0', '3');
    for (const draft of ['', '-', '1e', 'Infinity', 'NaN', '-1', '4']) {
        field.value = draft;
        assert.ok(Number.isNaN(readNumericInput(field, { report: true })));
        assert.equal(field.attributes['aria-invalid'], 'true');
    }
    field.value = '0';
    assert.equal(readNumericInput(field), 0);
    assert.equal(field.error, '');
});

test('decimal separators, fractional values, integer radii and lamp precision have separate rules', async () => {
    const { readNumericInput } = await numeric;
    const field = input('0,375', '0', '3');
    assert.equal(readNumericInput(field), 0.375);
    field.value = '1.234567';
    assert.equal(readNumericInput(field), 1.234567);
    assert.equal(readNumericInput(field, { precision: 3 }), 1.235);
    field.step = '1';
    assert.ok(Number.isNaN(readNumericInput(field)));
    field.value = '3';
    assert.equal(readNumericInput(field), 3);
    field.dataset.exclusiveMax = 'true';
    assert.ok(Number.isNaN(readNumericInput(field)));
});

test('Enter/change/blur commit once, invalid drafts do not save, and failed saves can retry', async () => {
    const { bindNumericInput } = await numeric;
    const field = input('1', '0', '10');
    const saved = [];
    let accept = false;
    const commit = bindNumericInput(field, { onCommit: value => { saved.push(value); return accept; } });
    field.value = '';
    assert.equal(await commit(), false);
    assert.deepEqual(saved, []);
    field.value = '0.375';
    assert.equal(await commit(), false);
    accept = true;
    assert.equal(await commit(), true);
    field.handlers.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
    field.handlers.blur();
    field.handlers.change();
    await Promise.resolve();
    assert.deepEqual(saved, [0.375, 0.375]);
});

test('lamp resize limits match the server without restricting small decor', () => {
    const context = vm.createContext({ findLocationAsset: () => null });
    vm.runInContext(source('locationAssetDimensions.js').replace(/^import .*;\r?\n/, '').replaceAll('export ', ''), context);
    const small = { width: 0.005, depth: 0.012, height: 0.005 };
    assert.equal(context.validAssetDimensions(small), true);
    assert.equal(context.validAssetDimensions(small, 'lamp'), false);
    const lamp = { width: 0.05, depth: 0.02, height: 0.05 };
    assert.equal(context.validAssetDimensions(lamp, 'lamp'), true);
    const resized = context.resizedUniformDimensions(lamp, 0.001, 'lamp');
    assert.equal(context.validAssetDimensions(resized, 'lamp'), true);
});

test('a newer edit is captured during a pending save, even if its input is then replaced', async () => {
    const { bindNumericInput } = await numeric;
    const field = input('1');
    field.isConnected = true;
    const saved = [];
    let finish;
    const commit = bindNumericInput(field, { onCommit: value => {
        saved.push(value);
        return value === 2 ? new Promise(resolve => { finish = resolve; }) : true;
    } });
    field.value = '2';
    const first = commit();
    field.value = '3';
    field.handlers.input();
    await commit();
    field.isConnected = false;
    assert.deepEqual(saved, [2, 3]);
    finish(true);
    await first;
    await Promise.resolve();
    assert.deepEqual(saved, [2, 3]);
});

test('reusing a placement field for another asset resets its accepted value', async () => {
    const { bindNumericInput, syncNumericInput } = await numeric;
    const field = input('1', '0', '10');
    const saved = [];
    const commit = bindNumericInput(field, { onCommit: value => saved.push(value) });
    field.value = '4.321';
    await commit();
    syncNumericInput(field, 3);
    field.value = '4.321';
    await commit();
    assert.deepEqual(saved, [4.321, 4.321]);
});

test('12.345 degree bearing survives conversion and repeated inspection', async () => {
    const mod = await import('data:text/javascript;base64,' + Buffer.from(source('locationAssetTransforms.js')).toString('base64'));
    let angle = 12.345;
    for (let i = 0; i < 20; i++) angle = mod.normalizedBearing(mod.objectRotationToBearing(mod.bearingToObjectRotation(angle)));
    assert.equal(angle, 12.345);
    assert.equal(mod.normalizedBearing(-12.345), 347.655);
});

test('an older object echo cannot roll back a newer exact edit', () => {
    const scene = source('locationScene.js');
    const start = scene.indexOf('export function updateLocationObject(object)');
    const end = scene.indexOf('\nwindow.updateLocationObject', start);
    const context = vm.createContext({
        currentLocationData: { objects: [{ id: 1, revision: 3, properties: { rotation: -12.345 * Math.PI / 180 } }] },
        replaceLocationObjectMesh() { throw new Error('stale echo must not rebuild the object'); },
    });
    vm.runInContext(scene.slice(start, end).replace('export ', ''), context);
    context.updateLocationObject({ id: 1, revision: 2, properties: { rotation: 0 } });
    assert.equal(context.currentLocationData.objects[0].revision, 3);
    assert.equal(context.currentLocationData.objects[0].properties.rotation, -12.345 * Math.PI / 180);
});
