const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function frameHarness(local) {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/',
        local ? 'locationScene.js' : 'lobby3d.js'), 'utf8');
    const start = source.indexOf(local ? '    function animate(frameTime' : 'function animate()');
    const end = source.indexOf(local ? '    animate();' : '\nanimate();', start);
    assert.ok(start >= 0 && end > start);
    const calls = [];
    const mark = name => (...args) => calls.push([name, ...args]);
    const fpsCounter = { frame: mark('fps'), pause: mark('fpsPause') };
    const context = vm.createContext({
        performance: { now: () => 100 }, document: { hidden: false }, window: { isLocationActive: false },
        requestAnimationFrame: mark('schedule'), lastTime: 0, previousFrameTime: 0,
        renderer: { render: mark('render') }, labelRenderer: { render: mark('labels') },
        controls: { update: mark('controls') }, scene: {}, camera: {},
        updateLocationCameraMovement: mark('camera'), updateGlobalCameraMovement: mark('camera'),
        updateChunkVisibility: mark('chunks'), updateRain: mark('rain'),
        animateChunkAnomalies: mark('anomalies'), animateAnomalyEffects: mark('anomalies'),
        anomalyEffectMeshes: [], lastMouseX: 10, lastMouseY: 10, performRaycast: mark('raycast'),
        postRenderCallbacks: [mark('postRender')], animationFrameId: null,
        worldFpsCounter: fpsCounter, locationFpsCounter: fpsCounter,
    });
    vm.runInContext(source.slice(start, end), context);
    return { context, calls };
}

test('hidden world does no rendering, picking, weather or camera work; resumes on return', () => {
    const { context, calls } = frameHarness(false);
    context.window.isLocationActive = true;
    context.animate();
    assert.deepEqual(calls.map(call => call[0]), ['schedule', 'fpsPause']);
    assert.equal(context.lastTime, 100);
    calls.length = 0;
    context.window.isLocationActive = false;
    context.animate();
    assert.ok(calls.some(call => call[0] === 'render'));
    assert.ok(calls.some(call => call[0] === 'fps'));
    assert.ok(calls.some(call => call[0] === 'rain'));
    assert.ok(calls.some(call => call[0] === 'raycast'));
});

for (const local of [false, true]) {
    test(`${local ? 'local' : 'world'} scene skips hidden tab and resumes without a time jump`, () => {
        const { context, calls } = frameHarness(local);
        context.document.hidden = true;
        context.animate(100);
        assert.deepEqual(calls.map(call => call[0]), ['schedule', 'fpsPause']);
        calls.length = 0;
        context.document.hidden = false;
        context.performance.now = () => 116;
        context.animate(116);
        assert.equal(calls.find(call => call[0] === 'camera')[1], 0.016);
        assert.ok(calls.some(call => call[0] === 'render'));
        assert.ok(calls.some(call => call[0] === 'fps'));
        if (local) assert.ok(calls.some(call => call[0] === 'labels'));
    });
}
