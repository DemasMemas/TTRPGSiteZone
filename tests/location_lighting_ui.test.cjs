const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lightingSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationLighting.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(lightingSource).toString('base64')}`;

test('world lighting follows time while manual lighting ignores it', async () => {
    const { resolveLocationLighting } = await import(moduleUrl);
    const morning = resolveLocationLighting({ mode: 'world' }, 480);
    const night = resolveLocationLighting({ mode: 'world' }, 60);
    assert.ok(morning.directional_intensity > night.directional_intensity);
    const manual = { mode: 'manual', ambient_intensity: 0.15, directional_intensity: 0,
        local_lights: [{ x: 3, z: 4, height: 2, color: '#ffc477', intensity: 3, distance: 6 }] };
    assert.deepEqual(resolveLocationLighting(manual, 60), resolveLocationLighting(manual, 840));
});

test('lamp REST and socket echoes apply once up to twenty lights in either order', async () => {
    const { createLocationLightingEchoTracker, sameLocationLightingSettings } = await import(moduleUrl);
    const lights = Array.from({ length: 20 }, (_, index) => ({
        x: index + 0.5, z: 2.5, height: 2, color: '#FFCC77', intensity: 2,
        distance: 7, kind: 'point', dimensions: { width: 0.4, depth: 0.4, height: 0.4 },
    }));
    const normalized = requested => ({ ...requested, local_lights: requested.local_lights.map(light => ({
        ...light, color: light.color.toLowerCase(), azimuth: 0, gm_hidden: false,
    })) });
    assert.equal(sameLocationLightingSettings({ local_lights: lights.slice(0, 1) }, {
        local_lights: [{ ...lights[0], intensity: lights[0].intensity + 0.001 }],
    }), false);
    for (const socketFirst of [true, false]) {
        const tracker = createLocationLightingEchoTracker();
        for (const count of [1, 3, 4, 6, 10, 20]) {
            const requested = { mode: 'manual', local_lights: lights.slice(0, count) };
            const saved = normalized(requested);
            assert.equal(sameLocationLightingSettings(requested, saved), true);
            const entry = tracker.begin(7, requested);
            const actions = socketFirst
                ? [tracker.socket(7, saved), tracker.rest(entry)]
                : [tracker.rest(entry), tracker.socket(7, saved)];
            assert.deepEqual(actions, [true, false]);
        }
        const remote = { mode: 'manual', ambient_intensity: 0.3, local_lights: lights };
        assert.equal(tracker.socket(7, remote), true);
        const failed = tracker.begin(7, { local_lights: [] });
        tracker.fail(failed);
        assert.equal(tracker.socket(7, { local_lights: [] }), true);
        tracker.reset();
        assert.equal(tracker.socket(7, normalized({ local_lights: lights.slice(0, 1) })), true);
    }
});

test('unchanged lamps keep their editable fixtures across lighting updates', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('function takeReusableLampFixtures(');
    const end = scene.indexOf('export function applyLocationLighting(', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({});
    vm.runInContext(scene.slice(start, end), context);
    const sources = Array.from({ length: 20 }, (_, index) => ({ kind: 'point', x: index, intensity: 2 }));
    const fixtures = sources.map((source, index) => ({
        userData: { locationLampIndex: index, lampSourceKey: JSON.stringify(source) },
        fixtureId: index,
    }));
    const group = { children: [...fixtures, { userData: { firePoolLight: true } }],
        remove(fixture) { this.children.splice(this.children.indexOf(fixture), 1); } };
    const nextSources = sources.map(source => ({ ...source }));
    nextSources[3].intensity = 4;
    const reusable = context.takeReusableLampFixtures(group, nextSources);
    assert.equal(reusable.size, 19);
    assert.equal(reusable.get(4), fixtures[4]);
    assert.equal(reusable.get(4).fixtureId, fixtures[4].fixtureId);
    assert.equal(reusable.has(3), false);
    assert.deepEqual(group.children, [fixtures[3], { userData: { firePoolLight: true } }]);
    assert.match(scene, /const reusableLampFixtures = takeReusableLampFixtures\(locationLightGroup, profile\.local_lights \|\| \[\]\);[\s\S]*?disposeObject\(locationLightGroup\);[\s\S]*?reusableLampFixtures\.get\(index\)/);
});

test('lamp profile includes fixed preview slots even at zero intensity', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('function localLightRenderCounts(');
    const end = scene.indexOf('function beginLampEditTrace(', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({
        locationLightGroup: { traverseVisible(callback) {
            callback({ isLight: true, isPointLight: true, intensity: 0, castShadow: false });
            callback({ isLight: true, isPointLight: true, intensity: 2, castShadow: true });
            callback({ isLight: true, isSpotLight: true, intensity: 1, castShadow: true });
            callback({ isLight: true, isPointLight: true, intensity: 1, castShadow: false,
                userData: { lampPreviewSlot: true } });
            callback({ isLight: true, isSpotLight: true, intensity: 0, castShadow: false,
                userData: { lampPreviewSlot: true } });
        } },
        buildPreviewMesh: null,
    });
    vm.runInContext(scene.slice(start, end), context);
    assert.deepEqual({ ...context.localLightRenderCounts() }, {
        active: 3, pointSlots: 3, spotSlots: 2, shadowCasters: 2,
        shadowViews: 7, preview: 1, previewPointSlots: 1, previewSpotSlots: 1,
    });
});

test('lamp rendering ranks visible influence without changing the logical lamp list', async () => {
    const { selectLocationLampRenderSources, LOCATION_LAMP_RENDER_BUDGET } = await import(moduleUrl);
    const sources = Array.from({ length: 20 }, (_, index) => ({
        kind: index === 19 ? 'spot' : 'point', x: index * 2, z: 0,
        y: 2, distance: 6, intensity: 2,
    }));
    const original = JSON.stringify(sources);
    const affectsView = source => source.x < 18 || source.kind === 'spot';
    const selected = selectLocationLampRenderSources(sources, { x: 0, z: 0 }, affectsView);
    assert.deepEqual(selected.pointShadow, [0, 1]);
    assert.deepEqual(selected.pointSimple, [2, 3, 4, 5]);
    assert.deepEqual(selected.spotShadow, [19]);
    assert.deepEqual(selected.spotSimple, []);
    assert.deepEqual(LOCATION_LAMP_RENDER_BUDGET, {
        pointShadow: 2, pointSimple: 4, spotShadow: 1, spotSimple: 1,
    });
    assert.equal(JSON.stringify(sources), original);
    assert.deepEqual(selectLocationLampRenderSources(sources, { x: 2.7, z: 0 }, affectsView,
        new Set([0, 1])).pointShadow, [1, 0]);
    assert.deepEqual(selectLocationLampRenderSources([], { x: 0, z: 0 }, () => true).pointShadow, []);
});

test('twenty fixed lamps keep the same selected set and shadow roles across small camera shifts', async () => {
    const { selectLocationLampRenderSources } = await import(moduleUrl);
    const sources = Array.from({ length: 20 }, (_, index) => ({
        kind: 'point', x: index % 5, z: Math.floor(index / 5),
        intensity: 2, distance: 8,
    }));
    let previous = new Set();
    let previousShadow = new Set();
    let baseline;
    for (let frame = 0; frame < 60; frame++) {
        const target = { x: 2 + Math.sin(frame / 8) * 0.03, z: 1.5 };
        const selected = selectLocationLampRenderSources(sources, target, () => true, previous,
            previousShadow);
        const ids = [...selected.pointShadow, ...selected.pointSimple].sort((a, b) => a - b);
        if (baseline) {
            assert.deepEqual(ids, baseline.ids);
            assert.deepEqual(selected.pointShadow, baseline.shadow);
        } else baseline = { ids, shadow: selected.pointShadow };
        previous = new Set(ids);
        previousShadow = new Set(selected.pointShadow);
    }
    assert.equal(baseline.ids.length, 6);
    sources.push({ kind: 'point', x: 30, z: 1.5, intensity: 2, distance: 8 });
    const moved = selectLocationLampRenderSources(sources, { x: 30, z: 1.5 }, () => true,
        previous, previousShadow);
    assert.equal(moved.pointShadow[0], 20);
});

test('lamp render group is reused and preview no longer adds a transient Light', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /if \(lampRenderGroup\?\.parent\) lampRenderGroup\.parent\.remove\(lampRenderGroup\)/);
    assert.match(scene, /locationLightGroup\.add\(lampRenderGroup\)/);
    const preview = scene.slice(scene.indexOf('function createEditorLampPreview('),
        scene.indexOf('function fadeEditorPreview('));
    assert.doesNotMatch(preview, /new THREE\.(PointLight|SpotLight)/);
    assert.match(preview, /group\.userData\.lampPreviewSource = source/);
    const fixtures = scene.slice(scene.indexOf('for (const [index, source] of (profile.local_lights || []).entries())'),
        scene.indexOf('let fireLightCount =', scene.indexOf('export function applyLocationLighting(')));
    assert.doesNotMatch(fixtures, /new THREE\.(PointLight|SpotLight)/);
    assert.match(scene, /light\.shadow\.autoUpdate = false/);
});

test('lamp slots stay fixed through 1, 3, 4, 6, 10 and 20 sources and deletion', async () => {
    const { selectLocationLampRenderSources } = await import(moduleUrl);
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('function setLampRenderLight(');
    const end = scene.indexOf('function updateAnomalyRenderLights(', start);
    const makeLight = (spot = false, shadow = false) => ({
        isSpotLight: spot, isPointLight: !spot, castShadow: shadow, intensity: 0,
        userData: { lampRenderSourceIndex: null, lampDesiredSourceIndex: null },
        shadow: { autoUpdate: false, needsUpdate: false },
        color: { set(value) { this.value = value; } },
        position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
        target: { position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } } },
    });
    const slots = {
        pointShadow: [makeLight(false, true), makeLight(false, true)],
        pointSimple: Array.from({ length: 4 }, () => makeLight()),
        spotShadow: [makeLight(true, true)],
        spotSimple: [makeLight(true)],
        previewPoint: makeLight(), previewSpot: makeLight(true),
    };
    const shadowResources = [...slots.pointShadow, ...slots.spotShadow].map(light => light.shadow);
    const sphere = { center: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, radius: 0 };
    const context = vm.createContext({
        performance: { now: () => 0 }, camera: { updateMatrixWorld() {}, projectionMatrix: {}, matrixWorldInverse: {} },
        controls: { target: { x: 0, z: 0 } },
        lampLightViewMatrix: { multiplyMatrices() { return this; } },
        lampLightFrustum: { setFromProjectionMatrix() { return this; },
            intersectsSphere() { return sphere.center.x < 12; } },
        lampLightSphere: sphere, lampRenderSlots: slots, lampRenderSources: [],
        lampRenderLights: [...slots.pointShadow, ...slots.pointSimple,
            ...slots.spotShadow, ...slots.spotSimple],
        lampRenderSelected: new Set(), lastLampRenderUpdateAt: -Infinity,
        locationStaticLightField: null, staticFieldPointSlots: null,
        selectLocationLampRenderSources, buildPreviewMesh: null,
    });
    vm.runInContext(scene.slice(start, end), context);
    for (const count of [1, 3, 4, 6, 10, 20]) {
        context.lampRenderSources = Array.from({ length: count }, (_, index) => ({
            kind: 'point', x: index * 2, y: 2, z: 0, height: 2,
            intensity: 2, distance: 7, color: '#ffcc77',
        }));
        context.updateLampRenderLights(count * 1000, 0.2, true);
        context.updateLampRenderLights(count * 1000 + 200, 0.2);
        assert.equal([...slots.pointShadow, ...slots.pointSimple]
            .filter(light => light.intensity > 0.01).length, Math.min(count, 6));
        assert.deepEqual([...slots.pointShadow, ...slots.spotShadow].map(light => light.shadow), shadowResources);
    }
    context.lampRenderSources = [];
    context.updateLampRenderLights(30000, 0.2, true);
    context.updateLampRenderLights(30200, 0.2);
    assert.equal([...slots.pointShadow, ...slots.pointSimple].filter(light => light.intensity > 0.01).length, 0);
    assert.equal(slots.pointShadow[0].shadow.autoUpdate, false);
    context.buildPreviewMesh = { userData: { lampPreviewSource: {
        kind: 'point', color: '#ffcc77', intensity: 2, distance: 7,
    } }, position: { x: 3, y: 2, z: 4 } };
    context.updateLampRenderLights(30400, 0.016);
    assert.equal(slots.previewPoint.intensity, 2);
    assert.equal(slots.previewPoint.position.x, 3);
    context.buildPreviewMesh = null;
    context.updateLampRenderLights(30600, 0.016);
    assert.equal(slots.previewPoint.intensity, 0);
    context.lampRenderSources = [{ kind: 'spot', x: 1, y: 2, z: 3, height: 2,
        azimuth: 0, intensity: 2, distance: 7, color: '#ffffff' }];
    context.updateLampRenderLights(30800, 0.2, true);
    assert.ok(slots.spotShadow[0].intensity > 1.8);
    assert.equal(slots.spotShadow[0].target.position.x, 6);
    assert.equal(slots.spotShadow[0].target.position.y, 0);
    assert.equal(slots.spotShadow[0].shadow.autoUpdate, true);
    context.staticFieldPointSlots = { pointShadow: [0, null],
        pointSimple: [null, null, null, null] };
    context.lampRenderSources = [
        { kind: 'point', x: 1, y: 2, z: 0, height: 2,
            intensity: 2, distance: 7, color: '#ffcc77' },
        { kind: 'spot', x: 2, y: 2, z: 0, height: 2,
            azimuth: 0, intensity: 2, distance: 7, color: '#ffffff' },
    ];
    context.updateLampRenderLights(31000, 1, true);
    context.updateLampRenderLights(31001, 1);
    assert.ok(slots.pointShadow[0].intensity > 1.8);
    assert.equal(slots.pointShadow[0].castShadow, true);
    assert.equal(slots.pointShadow[1].intensity, 0);
    assert.ok(slots.spotShadow[0].intensity > 0);
    context.controls.target.x = 100;
    context.updateLampRenderLights(31200, 0.2, true);
    assert.equal(slots.pointShadow[0].userData.lampDesiredSourceIndex, 0);
});

test('late echo from an older lamp save cannot replace a newer applied save', async () => {
    const { createLocationLightingEchoTracker } = await import(moduleUrl);
    const tracker = createLocationLightingEchoTracker();
    const first = { local_lights: [{ x: 1, z: 2, height: 2, color: '#ffffff', intensity: 2, distance: 7 }] };
    const second = { local_lights: [...first.local_lights,
        { x: 3, z: 2, height: 2, color: '#ffffff', intensity: 2, distance: 7 }] };
    const old = tracker.begin(7, first);
    const next = tracker.begin(7, second);
    assert.equal(tracker.rest(next), true);
    assert.equal(tracker.socket(7, first), false);
    assert.equal(tracker.rest(old), false);
    assert.equal(tracker.socket(7, second), false);
    tracker.reset();
    assert.equal(tracker.rest(next), false);
});

test('delayed lamp echo compares the submitted snapshot, not later edits', async () => {
    const { createLocationLightingEchoTracker } = await import(moduleUrl);
    const tracker = createLocationLightingEchoTracker();
    const settings = { local_lights: [{ x: 1, z: 2, height: 2,
        color: '#ffffff', intensity: 2, distance: 7 }] };
    const entry = tracker.begin(7, settings);
    settings.local_lights[0].intensity = 3;
    assert.equal(tracker.socket(7, { local_lights: [{ ...settings.local_lights[0], intensity: 2 }] }), true);
    assert.equal(tracker.rest(entry), false);
    assert.equal(tracker.socket(7, settings), true);
});

test('natural daylight is a reversible visual-only adjustment to world lighting', async () => {
    const { resolveLocationLighting, resolveLocationVisualPreset } = await import(moduleUrl);
    const original = resolveLocationLighting({ mode: 'world' }, 600);
    const daylight = resolveLocationVisualPreset(original, 'natural_daylight', 600);
    assert.ok(daylight.ambient_intensity > original.ambient_intensity);
    assert.ok(daylight.directional_intensity < original.directional_intensity);
    assert.equal(daylight.background_color, original.background_color);
    assert.equal(resolveLocationVisualPreset(original, 'current', 600), original);
    assert.equal(original.ambient_intensity, resolveLocationLighting({ mode: 'world' }, 600).ambient_intensity);
    const night = resolveLocationLighting({ mode: 'world' }, 120);
    assert.equal(resolveLocationVisualPreset(night, 'natural_daylight', 120), night);
    const manual = resolveLocationLighting({ mode: 'manual', ambient_intensity: 0.2 }, 600);
    assert.equal(resolveLocationVisualPreset(manual, 'natural_daylight', 600), manual);
});

test('lighting tool exposes the visual preset without saving it as location settings', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../app/static/js/locationLightingEditor.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    assert.match(editor, /<select class="form-control" data-lighting-preset>/);
    assert.match(editor, /if \(event\.target === visualPreset\) return;/);
    assert.match(editor, /visualPreset\.disabled = mode\.value === 'manual'/);
    assert.match(main, /createLocationLightingEditor\([\s\S]*?getLocationLightingPreset,\s*setLocationLightingPreset,/);
    assert.doesNotMatch(editor, /data-lighting="natural_daylight"/);
});

test('lamp diagnostics separate preview, server wait, scene rebuild, darkness and first render', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const sockets = fs.readFileSync(path.join(__dirname, '../app/static/js/socketHandlers.js'), 'utf8');
    assert.match(scene, /beginLampEditTrace\('select'\)/);
    assert.match(scene, /beginLampEditTrace\(action\)/);
    assert.match(scene, /serverAwaitMs/);
    assert.match(scene, /networkMs/);
    assert.match(scene, /afterNetworkMs/);
    assert.match(scene, /timerAfterReadyMs/);
    assert.match(scene, /hiddenAtReady/);
    assert.match(scene, /hiddenAtFrame/);
    assert.match(scene, /rebuildLightGroupMs/);
    assert.match(scene, /darknessRefreshMs/);
    assert.match(scene, /lightingApplyCount/);
    assert.match(scene, /socketApplyMs/);
    assert.match(sockets, /applyLocationLighting\(data\.updates\.lighting, true, 'socket'\)/);
    assert.match(scene, /finishLampEditTrace\(lampTrace,/);
    assert.match(scene, /previewLightCreated/);
    assert.match(scene, /persistLocationLights\(lights, 'place'\)/);
    assert.match(scene, /persistLocationLights\(lights, 'delete'\)/);
    assert.match(scene, /export function destroyLocationScene\(\) \{\s*lampLightingEchoes\.reset\(\);\s*lampEditTrace = null;/);
});

test('lamp profile captures the first lit frame before REST settles in either event order', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('function beginLampEditTrace(');
    const end = scene.indexOf('let tileCubes =', start);
    assert.ok(start >= 0 && end > start);
    for (const socketFirst of [true, false]) {
        let now = 1;
        const logs = [];
        const timers = [];
        const context = vm.createContext({
            performance: { now: () => now },
            document: { hidden: false },
            setTimeout: callback => timers.push(callback),
            console: { info: (...args) => logs.push(args) },
            currentLocationData: { lighting: { local_lights: Array(4).fill({}) } },
            locationLightGroup: null,
            renderer: null,
            localLightRenderCounts: () => ({ active: 4, shadowCasters: 4 }),
        });
        vm.runInContext(`let lampEditTrace = null;\n${scene.slice(start, end)}`, context);
        const trace = context.beginLampEditTrace('place');
        if (!socketFirst) trace.restSettled = true;
        now = 10;
        context.markLampEditReady(trace);
        now = 20;
        timers.forEach(callback => callback());
        now = 40;
        trace.frameStartedAt = now;
        context.finishLampEditTrace(trace, 15, 17);
        assert.equal(logs.length, socketFirst ? 0 : 1);
        if (socketFirst) {
            now = 50;
            trace.restSettled = true;
            context.reportLampEditTrace(trace);
        }
        assert.equal(logs.length, 1);
        assert.equal(logs[0][1].renderCallMs, 15);
        assert.equal(logs[0][1].waitForFrameMs, 30);
        assert.equal(logs[0][1].totalUntilFrameMs, 39);
        assert.equal(logs[0][1].totalOperationMs, socketFirst ? 49 : 39);
        assert.equal(logs[0][1].timerAfterReadyMs, 10);
        assert.equal(logs[0][1].hiddenAtReady, false);
        context.reportLampEditTrace(trace);
        assert.equal(logs.length, 1);
    }
    assert.match(scene, /markLampEditReady\(lampTrace\);/);
    assert.match(scene, /trace\.restSettled = true;\s*reportLampEditTrace\(trace\);/);
});

test('asset card selects a lamp through the tool once, without rebuilding its preview twice', () => {
    const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    assert.match(main, /else if \(activeAsset\) setLocationAssetPreset\(activeAsset\)/);
    assert.match(main, /activeAsset = \{ \.\.\.asset \};\s*selectLocationTool\('assets'\)/);
    assert.equal((main.match(/setLocationAssetPreset\(activeAsset\)/g) || []).length, 1);
});

test('side inspector saves live lighting while location edits avoid resending unchanged tiles', () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    assert.match(source, /const settings = environmentEditor\.get\(\)/);
    assert.match(source, /Server\.updateLocation\(currentLobbyId, currentLocationData\.id, \{ lighting: settings \}\)/);
    assert.match(source, /applyLocationLighting\(settings, false\)/);
    assert.match(source, /if \(tempTiles \|\| newWidth !== locationData\.grid_width \|\| newHeight !== locationData\.grid_height\) \{\s*updates\.tiles_data = finalTiles;/);
});

test('location tools keep light, asset library and selection inspector in separate views', () => {
    const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    const quickMenu = fs.readFileSync(path.join(__dirname, '../app/static/js/mapEditorQuickMenu.js'), 'utf8');
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const toolbar = main.match(/toolbar\.innerHTML = `([\s\S]*?)`;/)?.[1] || '';
    assert.deepEqual([...toolbar.matchAll(/data-location-tool="([^"]+)"/g)].map(match => match[1]),
        ['select', 'terrain', 'height', 'radiation', 'erase', 'assets', 'light']);
    assert.doesNotMatch(toolbar, /data-location-action="resize"/);
    assert.match(main, /assetSection\.hidden = tool !== 'assets'/);
    assert.match(main, /environmentSection\.hidden = tool !== 'light'/);
    assert.match(main, /sections\.select\.appendChild\(assetInspector\)/);
    assert.match(main, /window\.selectLocationEditorTool\?\.\('erase'\)/);
    assert.match(scene, /locationEditorTool === 'light'/);
    assert.match(quickMenu, /\['light', 'Свет'\]/);
    assert.doesNotMatch(quickMenu.match(/const LOCATION_TOOLS = \[([\s\S]*?)\];/)?.[1] || '',
        /'decor'|'structure'|'darkness'/);
});

test('asset tool selects existing objects only when placement is inactive', () => {
    const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /if \(window\.locationEditorTool === 'assets' && !e\.altKey && \(!e\.shiftKey \|\| !selectedLocationAsset\)\) \{\s*if \(!selectedLocationAsset\) \{\s*if \(selectEditorAsset\(e\.clientX, e\.clientY, e\.shiftKey\)\)/);
    assert.match(scene, /window\.selectLocationEditorTool\?\.\('select'\);\s*\}\s*return;\s*\}\s*e\.preventDefault\(\);\s*e\.stopImmediatePropagation\(\);\s*placeSelectedLocationAsset/);
    assert.match(main, /if \(activeAsset\?\.id === asset\.id\) \{\s*activeAsset = null;\s*clearLocationAssetPreset\(\)/);
    assert.match(main, /if \(previousTool === 'assets' && tool !== 'assets'\) \{\s*activeAsset = null;\s*clearLocationAssetPreset\(\)/);
});

test('lighting editor fields share the location editor control styling', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../app/static/js/locationLightingEditor.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../app/static/style.css'), 'utf8');
    assert.match(editor, /class="location-lighting-field location-lighting-mode"/);
    assert.match(editor, /class="location-lighting-manual"/);
    assert.doesNotMatch(editor, /style="/);
    assert.match(css, /\.map-editor-section \.form-control \{[^}]*background: var\(--input-bg\);[^}]*border: 1px solid var\(--input-border\);/);
    assert.match(css, /\.location-environment-editor \.form-control \{\s*width: 100%;/);
    assert.match(css, /\.location-lighting-manual \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test('asset library offers structures, decor and preset lamps without a lamp list modal', async () => {
    const catalogSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetCatalog.js'), 'utf8');
    const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalogSource).toString('base64')}`;
    const { LOCATION_ASSETS, findLocationAsset } = await import(catalogUrl);
    assert.ok(LOCATION_ASSETS.some(asset => asset.kind === 'structure'));
    assert.ok(LOCATION_ASSETS.some(asset => asset.kind === 'decor'));
    assert.equal(findLocationAsset('spot_lamp').lightKind, 'spot');
    assert.equal(findLocationAsset('warm_lamp').kind, 'lamp');
    assert.equal(findLocationAsset('poster').elevation, 1.6);

    const editor = fs.readFileSync(path.join(__dirname, '../app/static/js/locationLightingEditor.js'), 'utf8');
    assert.doesNotMatch(editor, /data-add-light|location-lighting-sources/);
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /placeSelectedLocationAsset\(hoveredTileCoords\.x, hoveredTileCoords\.z\)/);
    assert.match(scene, /if \(point\) commitEditorAssetMove\(point\.x, point\.z\)/);
    assert.match(scene, /beginRotateSelectedLocationAsset/);
});

test('cursor bearing matches object rotation without mirroring', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetTransforms.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const { bearingFromDelta, bearingToObjectRotation, objectRotationToBearing, clampAssetElevation } = await import(url);
    assert.equal(bearingFromDelta(1, 0), 0);
    assert.equal(bearingFromDelta(0, 1), 90);
    assert.equal(bearingFromDelta(-1, 0), 180);
    assert.equal(bearingFromDelta(1, 1, true), 45);
    assert.equal(bearingToObjectRotation(90), -Math.PI / 2);
    assert.equal(objectRotationToBearing(-Math.PI / 2), 90);
    assert.equal(clampAssetElevation(12), 10);
    assert.equal(clampAssetElevation(-2), 0);
});

test('legacy decor angle control displays a wall poster direction without clamping it to zero', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('export function setLocationBrushObjectRotation(rot)');
    const end = scene.indexOf('// ========== Остальные экспорты', start);
    const input = { value: '' };
    const span = { textContent: '' };
    const context = vm.createContext({
        brushObjectRotation: 0,
        document: { getElementById: id => id === 'loc-obj-rotation' ? input : span },
        syncLocationPlacementAngle() {},
        updateBuildPreview() {},
    });
    vm.runInContext(scene.slice(start, end).replace('export ', ''), context);
    context.setLocationBrushObjectRotation(-90);
    assert.equal(context.brushObjectRotation, 270);
    assert.equal(input.value, '270');
    assert.equal(span.textContent, '270°');
});

test('map rotation previews the cursor angle and commits only on click', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    assert.match(main, /beginRotateSelectedLocationAsset\(\)/);
    assert.match(scene, /updateEditorRotatePreview\(e\.clientX, e\.clientY, e\.shiftKey, e\.ctrlKey\)/);
    assert.match(scene, /commitEditorAssetRotation\(\)/);
    const start = scene.indexOf('function updateEditorRotatePreview(clientX, clientY, snap = false, aroundGroup = false)');
    const end = scene.indexOf('async function commitEditorAssetMove(x, z)', start);
    assert.ok(start >= 0 && end > start);
    const previews = [];
    const saved = [];
    const selected = {
        kind: 'lamp', lightKind: 'spot', x: 3.5, z: 4.5,
        height: 2, intensity: 3, distance: 8, color: '#ffe0aa', rotation: 0,
    };
    const context = vm.createContext({
        editorRotateMode: true,
        editorSelection: { kind: 'lamp', index: 0 },
        editorRotateAngle: 0,
        editorGroupRotatePivot: null,
        getSelectedLocationEditorAsset: () => selected,
        getPointerWorldPoint: () => ({ x: 4.5, z: 5.5 }),
        getTileHeight: () => 0,
        bearingFromDelta: (x, z, snap) => snap ? Math.round(Math.atan2(z, x) * 180 / Math.PI / 15) * 15 : Math.round(Math.atan2(z, x) * 180 / Math.PI),
        previewSelectedLocationLamp: details => previews.push(details),
        updateSelectedLocationAssetDetails: async details => { saved.push(details); return true; },
        updateBuildPreview() {},
    });
    vm.runInContext(scene.slice(start, end), context);
    context.updateEditorRotatePreview(0, 0, true);
    assert.equal(context.editorRotateAngle, 45);
    assert.equal(previews[0].rotation, 45);
    assert.equal(saved.length, 0);
    await context.commitEditorAssetRotation();
    assert.equal(saved[0].rotation, 45);
    assert.equal(context.editorRotateMode, false);
});

test('poster offset and elevation survive moving it to another tile', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('export async function updateSelectedLocationAssetDetails(');
    const end = scene.indexOf('export function previewSelectedLocationLamp(', start);
    assert.ok(start >= 0 && end > start);
    const source = { type: 'poster', x: 0, z: 0.13, rotation: -90, elevation: 1.6 };
    const tiles = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ objects: [] })));
    tiles[1][1].objects.push(source);
    const sent = [];
    const context = vm.createContext({
        editorSelection: { kind: 'decor', x: 1, z: 1, index: 0 },
        editorSelections: [{ kind: 'decor', x: 1, z: 1, index: 0 }],
        currentLocationData: { grid_width: 5, grid_height: 5, tiles_data: tiles },
        getSelectedEditorSource: () => source,
        clampAssetElevation: value => Math.max(0, Math.min(10, Number(value) || 0)),
        sendDecorTileUpdates: positions => sent.push(positions),
        showNotification() {},
    });
    vm.runInContext(scene.slice(start, end).replace('export ', ''), context);
    assert.equal(await context.updateSelectedLocationAssetDetails({ x: 2.5, z: 3.63, rotation: 90, elevation: 2 }), true);
    assert.equal(tiles[1][1].objects.length, 0);
    assert.equal(tiles[3][2].objects[0], source);
    assert.equal(source.rotation, -90);
    assert.equal(source.elevation, 2);
    assert.ok(Math.abs(source.z - 0.13) < 0.00001);
    assert.equal(sent.length, 1);
});

test('structure rotation and elevation save in Three.js coordinates', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('export async function updateSelectedLocationAssetDetails(');
    const end = scene.indexOf('export function previewSelectedLocationLamp(', start);
    const source = { id: 7, properties: { rotation: 0, elevation: 0 } };
    let saved;
    const context = vm.createContext({
        editorSelection: { kind: 'structure', id: 7 },
        currentLocationData: { grid_width: 5, grid_height: 5 },
        getSelectedEditorSource: () => source,
        window: { currentLobbyId: 19 },
        Server: { updateLocationObject: async (_lobby, _id, payload) => { saved = payload; return source; } },
        bearingToObjectRotation: bearing => -bearing * Math.PI / 180,
        structureLevel: () => 0,
        clampAssetElevation: value => Math.max(0, Math.min(10, Number(value) || 0)),
        updateLocationObject() {},
        notifyEditorSelection() {},
        showNotification() {},
    });
    vm.runInContext(scene.slice(start, end).replace('export ', ''), context);
    assert.equal(await context.updateSelectedLocationAssetDetails({ x: 2.25, z: 3.75, rotation: 90, elevation: 2.1 }), true);
    assert.equal(saved.tile_x, 2);
    assert.equal(saved.tile_y, 3);
    assert.equal(saved.properties.offset_x, -0.25);
    assert.equal(saved.properties.offset_z, 0.25);
    assert.equal(saved.properties.rotation, -Math.PI / 2);
    assert.equal(saved.properties.elevation, 2.1);
});

test('clicking a tile places the chosen lamp at its center', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('async function placeSelectedLocationAsset(x, z)');
    const end = scene.indexOf('export function loadLocation(data)', start);
    assert.ok(start >= 0 && end > start);
    const saved = [];
    const context = vm.createContext({
        selectedLocationAsset: {
            id: 'warm_lamp', kind: 'lamp', height: 2.2,
            color: '#ffd090', intensity: 2.5, distance: 8,
        },
        currentLocationData: { lighting: { local_lights: [] } },
        assetDimensions: () => ({ width: 0.36, depth: 0.36, height: 0.36 }),
        persistLocationLights: async lights => { saved.push(lights); return true; },
        editorSelection: null,
        updateEditorSelectionVisual() {},
        notifyEditorSelection() {},
    });
    vm.runInContext(scene.slice(start, end), context);
    await context.placeSelectedLocationAsset(3, 4);
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0].x, 3.5);
    assert.equal(saved[0][0].z, 4.5);
    assert.equal(saved[0][0].kind, 'point');
    assert.deepEqual(JSON.parse(JSON.stringify(saved[0][0].dimensions)), {
        width: 0.36, depth: 0.36, height: 0.36,
    });
    assert.equal(context.editorSelection.index, 0);
});
