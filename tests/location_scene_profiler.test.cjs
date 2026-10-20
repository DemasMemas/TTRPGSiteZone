const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
        profiler.frame(time, { cpuMs: 5, calls: 20, triangles: 300,
            sceneUpdateMs: 1, roofVisibilityMs: 0.2, renderSubmitMs: 3, labelsMs: 0.5 });
    }
    assert.equal(profiler.running, false);
    assert.equal(visibility.grass, true);
    assert.equal(visibility.lights, true);
    assert.deepEqual(completed[0].map(result => result.name), ['base', 'no grass', 'no lights']);
    assert.equal(completed[0][0].fps, 40);
    assert.equal(completed[0][0].frameP99Ms, 25);
    assert.equal(completed[0][0].calls, 20);
    assert.equal(completed[0][0].triangles, 300);
    assert.equal(completed[0][0].sceneUpdateMs, 1);
    assert.equal(completed[0][0].roofVisibilityMs, 0.2);
    assert.equal(completed[0][0].renderSubmitMs, 3);
    assert.equal(completed[0][0].labelsMs, 0.5);
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

test('profile distinguishes camera movement from a stationary capture', async () => {
    const { createSceneProfiler } = await loadModule('sceneProfiler.js');
    let result;
    const profiler = createSceneProfiler({ phases: [{ name: 'full', apply() {}, restore() {} }],
        warmupMs: 0, sampleMs: 40, minFrames: 2, onComplete: rows => { [result] = rows; } });
    profiler.start(0);
    for (const time of [0, 10, 20, 30, 40, 50]) {
        profiler.frame(time, { cpuMs: 3, calls: 10, triangles: 100, cameraMoved: time >= 30 });
    }
    assert.equal(result.movingFrameShare, 0.75);
});

test('pointer profile keeps every event and preserves ordered raycast hits as candidates change', async () => {
    const { createPointerProfile } = await loadModule('sceneProfiler.js');
    let clock = 0;
    const profile = createPointerProfile(() => clock);
    const near = { id: 'near' };
    const far = { id: 'far' };
    const candidates = [near, far];
    for (let index = 0; index < 3; index++) profile.count('pointerEvents');
    const hit = profile.raycast('structure', candidates, () => {
        clock += 2;
        return [near, far];
    });
    assert.strictEqual(hit[0], near);
    candidates.splice(0, 1);
    assert.deepEqual(profile.raycast('structure', candidates, () => {
        clock += 3;
        return [far];
    }), [far]);
    profile.count('domWrites');
    profile.addDuration('domMs', 1.5);
    const metrics = profile.drain();
    assert.equal(metrics.pointerEvents, 3);
    assert.equal(metrics.structureRaycasts, 2);
    assert.equal(metrics.structureCandidates, 3);
    assert.equal(metrics.raycastMs, 5);
    assert.equal(metrics.domMs, 1.5);
    assert.equal(profile.drain().pointerEvents, 0);
});

test('profiler accumulates pointer measurements only for sampled frames', async () => {
    const { createSceneProfiler } = await loadModule('sceneProfiler.js');
    let result;
    const profiler = createSceneProfiler({ phases: [{ name: 'full', apply() {}, restore() {} }],
        warmupMs: 0, sampleMs: 20, minFrames: 2, onComplete: rows => { [result] = rows; } });
    profiler.start(0);
    profiler.frame(0, { cpuMs: 1, pointer: { pointerEvents: 99 } });
    profiler.frame(10, { cpuMs: 1, pointer: { pointerEvents: 99 } });
    profiler.frame(20, { cpuMs: 1, pointer: { pointerEvents: 2, raycastMs: 1 } });
    profiler.frame(30, { cpuMs: 1, pointer: { pointerEvents: 3, raycastMs: 2 } });
    profiler.frame(40, { cpuMs: 1, pointer: { pointerEvents: 4, raycastMs: 3 } });
    assert.equal(result.pointer.pointerEvents, 5);
    assert.equal(result.pointer.raycastMs, 3);
});

test('copying a complete report keeps its text and restores fallback DOM', async () => {
    const { copySceneProfileReport } = await loadModule('sceneProfiler.js');
    const report = 'FPS 80; draw calls 400; triangles 6000; textures 12; pointer 25';
    let copied = '';
    assert.equal(await copySceneProfileReport(report, {
        async writeText(value) { copied = value; },
    }), true);
    assert.equal(copied, report);
    const input = { style: {}, remove() { this.removed = true; }, select() { this.selected = true; } };
    const documentRef = {
        body: { appendChild(node) { assert.strictEqual(node, input); } },
        createElement(tag) { assert.equal(tag, 'textarea'); return input; },
        execCommand(command) { assert.equal(command, 'copy'); copied = input.value; return true; },
    };
    assert.equal(await copySceneProfileReport(report, { async writeText() { throw Error('denied'); } }, documentRef), true);
    assert.equal(copied, report);
    assert.equal(input.removed, true);
    assert.equal(await copySceneProfileReport('', null, documentRef), false);
});

test('location scene uses a bounded anomaly light pool and profiles actual render frames', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /Math\.min\(MAX_ANOMALY_RENDER_LIGHTS, anomalyRenderSources\.length\)/);
    assert.match(scene, /updateAnomalyRenderLights\(frameTime\)/);
    assert.match(scene, /locationProfiler\?\.frame\(finishedAt/);
    assert.match(scene, /locationProfiler\?\.destroy\(\)/);
    assert.match(scene, /function locationBuildingProfileStats\(\)/);
    assert.match(scene, /renderer\.info\?\.memory\?\.geometries/);
    assert.match(scene, /renderer\.info\?\.memory\?\.textures/);
    assert.match(scene, /sceneUpdateMs: profiling \? renderStartedAt - frameWorkStartedAt : 0/);
});

test('scene profile report keeps pointer diagnostics selectable and offers a copy action', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /copyButton\.textContent = 'Скопировать отчёт'/);
    assert.match(scene, /copySceneProfileReport\(reportText, navigator\.clipboard, document\)/);
    assert.match(scene, /reportText = panel\.textContent/);
    assert.doesNotMatch(scene, /panel\.addEventListener\('click'/);
    assert.match(scene, /pointer: locationPointerProfile\?\.drain\(\)/);
    assert.match(scene, /profile\.count\('pointerEvents'\)/);
    assert.match(scene, /profiledLocationRaycast\(tileCubes, false, 'surface'\)/);
});

test('profile snapshot counts generated-house meshes and resources without mutating the scene', () => {
    const sceneSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const source = sceneSource.slice(sceneSource.indexOf('function locationBuildingProfileStats()'),
        sceneSource.indexOf('function createLocationProfileControl(', sceneSource.indexOf('function locationBuildingProfileStats()')));
    const floor = { id: 1, type: 'floor', properties: { building_id: 'house-a', generation_seed: '0' } };
    const wall = { id: 2, type: 'wall', properties: { building_id: 'house-a' } };
    const table = { id: 3, type: 'table', properties: { building_id: 'house-a' } };
    const other = { id: 4, type: 'floor', properties: { building_id: 'manual' } };
    const root = (object, leaves) => ({ userData: { locationObject: object },
        traverse(visitor) { leaves.forEach(visitor); } });
    const houseLeaves = [{ isMesh: true, castShadow: true, visible: true },
        { isMesh: true, castShadow: false, visible: true }];
    const roof = { userData: { roofPlan: { floorId: 1 } },
        traverse(visitor) { visitor({ isMesh: true, castShadow: true, visible: true }); } };
    const context = vm.createContext({
        currentLocationData: { objects: [floor, wall, table, other] },
        structureBuildingId: object => object?.properties?.building_id,
        locationObjectMeshes: [root(floor, houseLeaves), root(wall, houseLeaves),
            root(table, houseLeaves), root(other, houseLeaves)],
        roofMeshes: [roof], objectMeshes: [{}, {}], locationLightGroup: { children: [{}] },
        scene: { traverseVisible(visitor) { houseLeaves.forEach(visitor); } },
        renderer: { info: { memory: { geometries: 19, textures: 6 } } },
    });
    vm.runInContext(source, context);
    const stats = context.locationBuildingProfileStats();
    assert.deepEqual(JSON.parse(JSON.stringify(stats)), {
        houses: 1, houseObjects: 3, architectureObjects: 3, houseMeshes: 7,
        houseShadowCasters: 4, visibleShadowCasters: 1, roofRoots: 1,
        pickRoots: 7, geometries: 19, textures: 6,
    });
});

test('temporary surface and F8 diagnostics are gone while the scene profiler remains', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const style = fs.readFileSync(path.join(__dirname, '../app/static/style.css'), 'utf8');
    assert.match(scene, /button\.textContent = 'Профиль сцены'/);
    assert.doesNotMatch(scene, /surfaceButton|layerButton|resetLayerProbe|resetSurfaceProbe/);
    assert.doesNotMatch(scene, /floorDepthProbe|toggleFloorDepthProbe|e\.code === 'F8'/);
    assert.doesNotMatch(style, /scene-surface-button|scene-layer-button/);
});
