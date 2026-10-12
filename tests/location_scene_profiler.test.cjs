const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadModule(name) {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('anomaly light selection keeps only visible sources nearest the camera target', async () => {
    const { selectAnomalyRenderLights, MAX_ANOMALY_RENDER_LIGHTS } = await loadModule('locationAnomalyRenderLights.js');
    assert.equal(MAX_ANOMALY_RENDER_LIGHTS, 6);
    const sources = [
        { x: 7, z: 0, id: 'far' },
        { x: 1, z: 0, id: 'near' },
        { x: 0, z: 1, id: 'hidden' },
        { x: 3, z: 0, id: 'middle' },
    ];
    assert.deepEqual(selectAnomalyRenderLights(sources, { x: 0, z: 0 },
        source => source.id !== 'hidden', 2).map(source => source.id), ['near', 'middle']);
    assert.deepEqual(selectAnomalyRenderLights(sources, { x: 0, z: 0 }, () => false), []);
});

test('real-scene profiler restores each layer after sampling or interruption', async () => {
    const { createSceneProfiler } = await loadModule('sceneProfiler.js');
    const visibility = { grass: true, lights: true };
    const completed = [];
    const phases = [
        { name: 'base', apply() {}, restore() {} },
        { name: 'no grass', apply() { visibility.grass = false; }, restore() { visibility.grass = true; } },
        { name: 'no lights', apply() { visibility.lights = false; }, restore() { visibility.lights = true; } },
    ];
    const profiler = createSceneProfiler({ phases, warmupMs: 50, sampleMs: 50, minFrames: 2,
        onComplete: results => completed.push(results) });
    profiler.start(0);
    for (const time of [0, 25, 50, 75, 100]) {
        profiler.frame(time, { cpuMs: 5, calls: 20, triangles: 300 });
    }
    assert.equal(visibility.grass, false);
    profiler.stop();
    assert.equal(visibility.grass, true);
    assert.equal(profiler.running, false);
    profiler.start(200);
    for (let time = 200; time <= 600; time += 25) {
        profiler.frame(time, { cpuMs: 5, calls: 20, triangles: 300 });
    }
    assert.equal(profiler.running, false);
    assert.equal(visibility.grass, true);
    assert.equal(visibility.lights, true);
    assert.deepEqual(completed[0].map(result => result.name), ['base', 'no grass', 'no lights']);
    assert.equal(completed[0][0].fps, 40);
    assert.equal(completed[0][0].calls, 20);
});

test('shader compilation delay is reported separately and cannot become steady-state FPS', async () => {
    const { createSceneProfiler } = await loadModule('sceneProfiler.js');
    let result;
    const profiler = createSceneProfiler({
        phases: [{ name: 'no shadows', apply() {}, restore() {} }],
        warmupMs: 50, sampleMs: 50, minFrames: 2,
        onComplete: rows => { [result] = rows; },
    });
    profiler.start(0);
    profiler.frame(5000, { cpuMs: 4900, calls: 20, triangles: 300 });
    assert.equal(profiler.running, true);
    for (const time of [5025, 5050, 5075, 5100, 5125]) {
        profiler.frame(time, { cpuMs: 5, calls: 20, triangles: 300 });
    }
    assert.equal(result.valid, true);
    assert.equal(result.fps, 40);
    assert.equal(result.longFrames, 1);
    assert.equal(result.longestFrameMs, 4900);
});

test('location scene uses a bounded anomaly light pool and profiles actual render frames', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /Math\.min\(MAX_ANOMALY_RENDER_LIGHTS, anomalyRenderSources\.length\)/);
    assert.match(scene, /updateAnomalyRenderLights\(frameTime\)/);
    assert.match(scene, /locationProfiler\?\.frame\(finishedAt/);
    assert.match(scene, /locationProfiler\?\.destroy\(\)/);
});
