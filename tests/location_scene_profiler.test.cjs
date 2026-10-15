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

test('textureless surface probe swaps only targeted materials and restores exact originals', () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const control = source.slice(source.indexOf('function createLocationProfileControl('),
        source.indexOf('export function initLocationScene('));
    const elements = [];
    const material = (extras = {}) => ({ side: 2, depthTest: true, depthWrite: true,
        polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -1, ...extras });
    const mesh = (original, object = null) => ({ isMesh: true, material: original,
        userData: { locationObject: object }, traverse(callback) { callback(this); } });
    const ground = mesh(material({ map: { id: 'ground' }, onBeforeCompile() {} }));
    const water = mesh(material({ map: { id: 'water' } }));
    const bank = mesh(material({ map: { id: 'bank' } }));
    const earth = mesh(material({ map: { id: 'earth' } }), { type: 'floor', properties: { asset_id: 'earth' } });
    const house = mesh(material({ map: { id: 'wood' } }), { type: 'floor', properties: { asset_id: 'wood' } });
    const unrelated = mesh(earth.material, { type: 'wall' });
    const originals = [ground, water, bank, earth, house, unrelated].map(item => item.material);
    const context = {
        document: { createElement() {
            const element = { hidden: false, listeners: {}, setAttribute(name, value) { this[name] = value; },
                addEventListener(name, callback) { this.listeners[name] = callback; }, remove() {} };
            elements.push(element);
            return element;
        } },
        container: { append() {} },
        THREE: { MeshStandardMaterial: class {
            constructor(options) { Object.assign(this, options); this.dispose = () => { this.disposed = true; }; }
        } },
        renderer: { isUnavailableRenderer: false },
        terrainSurfaceMesh: ground, waterSurfaceMesh: water, waterBankMesh: bank,
        locationObjectMeshes: [earth, house, unrelated],
        structureLevel: () => 0,
        visualAssetForLocationObject: (_type, properties) => ({
            id: properties.asset_id === 'earth' ? 'art_dirty_earth' : 'art_aged_wood',
            visual: { renderMode: 'pbr' },
        }),
        restoreFloorDepthProbe() {},
        createSceneProfiler: () => ({ running: false, stop() {}, frame() {} }),
    };
    const profile = vm.runInNewContext(`${control}\ncreateLocationProfileControl(container)`, context);
    elements[1].listeners.click();
    for (const item of [ground, water, bank, earth]) {
        assert.notEqual(item.material, originals[[ground, water, bank, earth].indexOf(item)]);
        assert.equal(item.material.map, undefined);
        assert.equal(item.material.depthTest, true);
        assert.equal(item.material.polygonOffsetUnits, -1);
    }
    assert.equal(house.material, originals[4]);
    assert.equal(unrelated.material, originals[5]);
    assert.equal(originals[3].map.id, 'earth');
    assert.equal(elements[1]['aria-pressed'], 'true');
    const temporary = ground.material;
    elements[1].listeners.click();
    assert.deepEqual([ground, water, bank, earth, house, unrelated].map(item => item.material), originals);
    assert.equal(temporary.disposed, true);
    assert.equal(elements[1]['aria-pressed'], 'false');
    elements[1].listeners.click();
    profile.resetSurfaceProbe();
    assert.equal(ground.material, originals[0]);
    profile.destroy();
});

test('surface layer probe reveals real groups in order and restores prior visibility', () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const control = source.slice(source.indexOf('function createLocationProfileControl('),
        source.indexOf('export function initLocationScene('));
    const elements = [];
    const mesh = (visible = true, object = null) => ({ visible,
        userData: { locationObject: object } });
    const cap = mesh();
    const cube = mesh();
    const smooth = mesh();
    const water = mesh();
    const waterSides = mesh();
    const bank = mesh();
    const sandBank = mesh(false);
    const film = mesh();
    film.userData.waterDetailKind = 'film';
    const reeds = mesh();
    const waterDetails = { visible: true, children: [film, reeds] };
    const pbr = mesh(true, { type: 'floor', properties: { asset_id: 'earth' } });
    const house = mesh(true, { type: 'floor', properties: { asset_id: 'wood' } });
    const grass = mesh();
    const decor = mesh();
    const fog = mesh(false);
    const grid = mesh();
    const context = {
        document: { createElement() {
            const element = { hidden: false, listeners: {}, setAttribute(name, value) { this[name] = value; },
                addEventListener(name, callback) { this.listeners[name] = callback; }, remove() {} };
            elements.push(element);
            return element;
        } },
        container: { append() {} }, renderer: { isUnavailableRenderer: false },
        terrainSurfaceMesh: cap, locationTileMesh: cube, smoothTerrainMesh: smooth,
        groundPlaneMesh: null, waterTileMesh: waterSides, waterSurfaceMesh: water,
        waterBankMesh: bank, sandBankMesh: sandBank, waterDetailGroup: waterDetails,
        locationObjectMeshes: [pbr, house], grassDetailGroup: grass, objectMeshes: [decor],
        fogOverlayMeshes: new Map([['fog', fog]]), fogMemoryGhosts: new Map(),
        darknessEditorOverlay: null, locationGridMesh: grid,
        structureLevel: () => 0,
        visualAssetForLocationObject: (_type, properties) => ({
            id: properties.asset_id === 'earth' ? 'art_dirty_earth' : 'art_aged_wood',
            visual: { renderMode: 'pbr' },
        }),
        restoreFloorDepthProbe() {},
        createSceneProfiler: () => ({ running: false, stop() {}, frame() {} }),
    };
    const profile = vm.runInNewContext(`${control}\ncreateLocationProfileControl(container)`, context);
    const next = () => elements[2].listeners.click();
    next();
    assert.deepEqual([cap.visible, cube.visible, smooth.visible, water.visible, waterSides.visible,
        bank.visible, film.visible, reeds.visible, pbr.visible, grass.visible,
        decor.visible, fog.visible, grid.visible],
    [true, false, false, false, false, false, false, false, false, false,
        false, false, false]);
    assert.equal(house.visible, true);
    next();
    assert.equal(cube.visible, true);
    assert.equal(smooth.visible, true);
    assert.equal(water.visible, false);
    next();
    assert.equal(water.visible, true);
    assert.equal(waterSides.visible, false);
    next();
    assert.equal(waterSides.visible, true);
    assert.equal(bank.visible, false);
    next();
    assert.equal(bank.visible, true);
    assert.equal(sandBank.visible, false);
    assert.equal(film.visible, false);
    next();
    assert.equal(film.visible, true);
    assert.equal(reeds.visible, false);
    next();
    assert.equal(reeds.visible, true);
    assert.equal(pbr.visible, false);
    next();
    assert.equal(pbr.visible, true);
    assert.equal(grass.visible, false);
    next();
    assert.equal(grass.visible, true);
    next();
    assert.equal(decor.visible, true);
    next();
    assert.equal(grid.visible, true);
    assert.equal(fog.visible, false);
    next();
    assert.equal(elements[2].textContent, 'Слои: все');
    assert.equal(fog.visible, false);
    assert.equal(sandBank.visible, false);
    assert.equal(elements[2]['aria-pressed'], 'false');
    next();
    profile.resetLayerProbe();
    assert.equal(water.visible, true);
    assert.equal(waterSides.visible, true);
    assert.equal(bank.visible, true);
    assert.equal(film.visible, true);
    assert.equal(reeds.visible, true);
    assert.equal(sandBank.visible, false);
    assert.equal(pbr.visible, true);
    assert.equal(grid.visible, true);
    profile.destroy();
});
