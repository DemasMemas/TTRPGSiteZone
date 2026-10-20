const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function sourceUrl(name) {
    return `data:text/javascript;base64,${fs.readFileSync(path.join(__dirname,
        '../app/static/js', name)).toString('base64')}`;
}

const architectureUrl = sourceUrl('locationArchitecture.js');
const prototypeUrl = sourceUrl('locationStaticLightFieldPrototype.js');
const directionalPrototypeSource = fs.readFileSync(path.join(__dirname,
    '../app/static/js/locationDirectionalLightFieldPrototype.js'), 'utf8')
    .replace("from './locationStaticLightFieldPrototype.js'", `from '${prototypeUrl}'`);
const directionalPrototypeUrl = `data:text/javascript;base64,${Buffer.from(directionalPrototypeSource).toString('base64')}`;
const integrationSource = fs.readFileSync(path.join(__dirname,
    '../app/static/js/locationStaticLightField.js'), 'utf8')
    .replace("from './locationArchitecture.js'", `from '${architectureUrl}'`)
    .replace("from './locationStaticLightFieldPrototype.js'", `from '${prototypeUrl}'`)
    .replace("from './locationDirectionalLightFieldPrototype.js'", `from '${directionalPrototypeUrl}'`);
const integration = import(`data:text/javascript;base64,${Buffer.from(integrationSource).toString('base64')}`);
const prototype = import(prototypeUrl);

test('game field covers scene materials at their level and restores them on disable', () => {
    const scene = fs.readFileSync(path.join(__dirname,
        '../app/static/js/locationScene.js'), 'utf8');
    const helpers = scene.slice(scene.indexOf('const FLOOR_SURFACE_OFFSET'),
        scene.indexOf('function quietHouseColor'));
    const visit = scene.slice(scene.indexOf('function forEachStaticLightFieldMaterial'),
        scene.indexOf('function setStaticLightFieldButtonState'));
    const material = () => ({ userData: {} });
    const sharedChairMaterial = material();
    const chair = { isMesh: true, userData: {}, material: sharedChairMaterial };
    const chairRoot = { userData: { locationObject: { type: 'chair', properties: { level: 1 } } },
        traverse(callback) { callback(chair); callback({ isMesh: true, userData: {}, material: sharedChairMaterial }); } };
    const crateMaterial = material();
    const crateRoot = { userData: { locationObject: { type: 'box', properties: { level: 0 } } },
        traverse(callback) { callback({ isMesh: true, userData: {}, material: [crateMaterial] }); } };
    const excludedMaterial = material();
    const lampRoot = { userData: { locationObject: { type: 'ceiling_bulb' } },
        traverse(callback) { callback({ isMesh: true, userData: {}, material: excludedMaterial }); } };
    const rootWith = value => ({ userData: {},
        traverse(callback) { callback({ isMesh: true, userData: {}, material: value }); } });
    const groundMaterial = material();
    const waterMaterial = material();
    const grassMaterial = material();
    const bankMaterial = material();
    const decorMaterial = material();
    const anomalyMaterial = material();
    const roofMaterial = material();
    const characterMaterial = material();
    const terrainSurfaceMesh = rootWith(groundMaterial);
    const waterSurfaceMesh = rootWith(waterMaterial);
    const waterBankMesh = rootWith(bankMaterial);
    const grassDetailGroup = rootWith(grassMaterial);
    const decorRoot = rootWith(decorMaterial);
    const anomalyRoot = rootWith(anomalyMaterial);
    const roofRoot = rootWith(roofMaterial);
    roofRoot.userData.roofPlan = { floorId: 1 };
    const attached = [];
    const controller = { field: { levels: [{ id: 0 }, { id: 1 }] },
        attach(value, level) { value.userData.fieldLevel = level; attached.push(value); },
        detach(value) { delete value.userData.fieldLevel; } };
    const context = { locationStaticLightField: controller,
        locationTileMesh: null, waterTileMesh: null, smoothTerrainMesh: null,
        terrainSurfaceMesh, waterSurfaceMesh, waterBankMesh, sandBankMesh: null,
        waterDetailGroup: null, grassDetailGroup,
        locationObjectMeshes: [chairRoot, crateRoot, lampRoot],
        objectMeshes: [decorRoot, anomalyRoot], anomalyEffectMeshes: [anomalyRoot],
        roofMeshes: [roofRoot], characterModels: new Map([[1, { model: rootWith(characterMaterial) }]]),
        structureLevel: object => object.properties?.level || 0 };
    const api = vm.runInNewContext(`${helpers}\n${visit}\n({ usesStaticLightField,
        attachStaticLightFieldToRoot, forEachStaticLightFieldMaterial })`, context);
    assert.equal(api.usesStaticLightField({ type: 'shelf' }), true);
    assert.equal(api.usesStaticLightField({ type: 'ceiling_bulb' }), true);
    api.attachStaticLightFieldToRoot(chairRoot, 1);
    api.attachStaticLightFieldToRoot(crateRoot, 0);
    api.attachStaticLightFieldToRoot(roofRoot, 1);
    assert.equal(attached.length, 2, 'shared furniture material is attached once');
    assert.equal(sharedChairMaterial.userData.fieldLevel, 1);
    assert.equal(crateMaterial.userData.fieldLevel, 0);
    const visited = new Map();
    api.forEachStaticLightFieldMaterial((value, level) => visited.set(value, level));
    for (const value of [groundMaterial, waterMaterial, bankMaterial, grassMaterial,
        decorMaterial, characterMaterial, crateMaterial, excludedMaterial]) {
        assert.equal(visited.get(value), 0);
    }
    assert.equal(visited.has(roofMaterial), false, 'interior field does not light roofs');
    assert.equal(visited.get(sharedChairMaterial), 1);
    assert.equal(visited.has(anomalyMaterial), false);
    api.forEachStaticLightFieldMaterial(value => controller.detach(value));
    assert.equal(sharedChairMaterial.userData.fieldLevel, undefined);
    assert.equal(crateMaterial.userData.fieldLevel, undefined);
    assert.equal(excludedMaterial.userData.fieldLevel, undefined);
    context.locationStaticLightField = null;
    api.attachStaticLightFieldToRoot(chairRoot, 1);
    assert.equal(attached.length, 2, 'disabled field does not attach to late furniture');
    const lateMaterial = material();
    const lateModel = rootWith(lateMaterial);
    context.locationStaticLightField = controller;
    api.attachStaticLightFieldToRoot(lateModel, 0);
    assert.equal(attached.at(-1), lateMaterial);
});

function wall(angle = -Math.PI / 2) {
    return { id: 1, type: 'wall', tile_x: 5, tile_y: 3,
        properties: { building_id: 'house', level: 0, rotation: angle,
            offset_x: 0, offset_z: -0.5,
            dimensions: { width: 6, depth: 0.2, height: 2.4 } } };
}

function door(open) {
    return { id: 2, type: 'door', tile_x: 5, tile_y: 3,
        properties: { building_id: 'house', level: 0, rotation: -Math.PI / 2,
            offset_z: -0.5, is_open: open,
            dimensions: { width: 1, depth: 0.18, height: 2 } } };
}

function inputs(objects, sources) {
    return integration.then(({ locationStaticLightFieldInputs }) =>
        locationStaticLightFieldInputs({ grid_width: 12, grid_height: 6, objects },
            sources, () => 0));
}

test('a closed door blocks light; an open aperture transmits it below the lintel', async () => {
    const { createStaticLightField } = await prototype;
    const lamp = { kind: 'point', x: 3, z: 3, y: 1.5,
        color: '#ffffff', intensity: 2, distance: 7 };
    const closed = await inputs([wall(), door(false)], [lamp]);
    const field = createStaticLightField(closed);
    field.rebuild({ lamps: closed.lamps, walls: closed.walls });
    assert.deepEqual(field.sample(7, 3, 0), [0, 0, 0]);
    const open = await inputs([wall(), door(true)], [lamp]);
    field.rebuild({ lamps: open.lamps, walls: open.walls });
    assert.ok(field.sample(7, 3, 0)[0] > 0);
    assert.deepEqual(field.sample(7, 1, 0), [0, 0, 0]);
    const standalone = await inputs([door(false)], [lamp]);
    field.rebuild({ lamps: standalone.lamps, walls: standalone.walls });
    assert.deepEqual(field.sample(7, 3, 0), [0, 0, 0]);
});

test('rotated solid walls block at their actual world-space pose', async () => {
    const { createStaticLightField } = await prototype;
    for (const turn of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        const object = wall(turn);
        const axis = { x: Math.cos(turn), z: -Math.sin(turn) };
        const normal = { x: Math.sin(turn), z: Math.cos(turn) };
        const source = { kind: 'point', x: 5.5 - normal.x * 1.5,
            z: 3 - normal.z * 1.5, y: 1.5,
            color: '#ffffff', intensity: 2, distance: 6 };
        const data = await inputs([object], [source]);
        const field = createStaticLightField(data);
        field.rebuild({ lamps: data.lamps, walls: data.walls });
        const blocked = field.sample(5.5 + normal.x * 1.5,
            3 + normal.z * 1.5, 0);
        assert.deepEqual(blocked, [0, 0, 0], `${turn}: ${axis.x},${axis.z}`);
    }
});

test('upper-floor lamps use their own layer and outdoor lamps stay on ground level', async () => {
    const { createStaticLightField } = await prototype;
    const floor = { id: 3, type: 'floor', tile_x: 2, tile_y: 2,
        properties: { building_id: 'house', level: 1, rotation: Math.PI / 4,
            dimensions: { width: 4, depth: 4, height: 0.12 } } };
    const data = await inputs([floor], [
        { kind: 'point', x: 4.9, z: 2.5, y: 3.5,
            color: '#ffffff', intensity: 2, distance: 4 },
        { kind: 'point', x: 9, z: 2.5, y: 3.5,
            color: '#ffffff', intensity: 2, distance: 4 },
        { kind: 'spot', x: 9, z: 3, y: 1.5,
            color: '#ffffff', intensity: 2, distance: 4 },
    ]);
    assert.deepEqual(data.lamps.map(lamp => lamp.level), [1, 0]);
    const field = createStaticLightField(data);
    field.rebuild({ lamps: data.lamps, walls: data.walls });
    assert.ok(field.sample(4.9, 2.5, 1)[0] > 0);
    assert.deepEqual(field.sample(4.9, 2.5, 0), [0, 0, 0]);
    assert.ok(field.sample(9, 2.5, 0)[0] > 0);
});

test('one texture and material hook survive updates and restore exactly on disable', async () => {
    const { createLocationStaticLightField } = await integration;
    const three = { DataTexture: class {
        constructor(data, width, height) { Object.assign(this, { data, width, height }); }
        dispose() { this.disposed = true; }
    }, RGBAFormat: 1, ClampToEdgeWrapping: 2, NearestFilter: 3 };
    const data = { grid_width: 12, grid_height: 6, objects: [wall()] };
    const sources = [{ kind: 'point', x: 3, z: 3, y: 1.5,
        color: '#ffffff', intensity: 2, distance: 7 }];
    const controller = createLocationStaticLightField(three, data, sources, () => 0,
        new Set([0]));
    assert.equal(controller.stats.activeLights, 0);
    const originalCompile = () => {};
    const originalKey = () => 'pbr';
    const material = { isMeshStandardMaterial: true, userData: {},
        onBeforeCompile: originalCompile, customProgramCacheKey: originalKey };
    controller.attach(material, 0);
    assert.notEqual(material.onBeforeCompile, originalCompile);
    const texture = controller.texture;
    assert.equal(controller.update(data, sources), true);
    assert.equal(controller.stats.activeLights, 1);
    assert.equal(controller.texture, texture);
    controller.detach(material);
    assert.equal(material.onBeforeCompile, originalCompile);
    assert.equal(material.customProgramCacheKey, originalKey);
    assert.equal(material.userData.staticLightFieldPrototype, undefined);
    controller.dispose();
    assert.equal(texture.disposed, true);
});

test('game directional field excludes active point slots and reuses its texture across door edits', async () => {
    const { createLocationDirectionalLightField } = await integration;
    const three = { DataTexture: class {
        constructor(data, width, height) { Object.assign(this, { data, width, height }); }
        dispose() { this.disposed = true; }
    }, RGBAFormat: 1, ClampToEdgeWrapping: 2, LinearFilter: 3 };
    const light = { kind: 'point', x: 3, z: 3, y: 1.5,
        color: '#ffffff', intensity: 2, distance: 7 };
    const data = { grid_width: 12, grid_height: 6, objects: [wall(), door(false)] };
    assert.throws(() => createLocationDirectionalLightField(three, data, [light],
        () => 0, new Set(), 10), /texture or memory limit/);
    const controller = createLocationDirectionalLightField(three, data, [light],
        () => 0, new Set([0]), 1024);
    assert.equal(controller.texture.minFilter, three.LinearFilter);
    const up = { x: 0, y: 1, z: 0 };
    assert.equal(controller.stats.activeLights, 0);
    assert.deepEqual(controller.field.sample(3, 0, 3, up), [0, 0, 0]);
    const originalCompile = () => {};
    const material = { isMeshStandardMaterial: true, userData: {},
        onBeforeCompile: originalCompile, customProgramCacheKey: () => 'pbr' };
    controller.attach(material, 0);
    assert.notEqual(material.onBeforeCompile, originalCompile);
    const texture = controller.texture;
    assert.equal(controller.update(data, [light]), true);
    assert.equal(controller.stats.activeLights, 1);
    assert.ok(controller.field.sample(3, 0, 3, up)[0] > 0);
    assert.deepEqual(controller.field.sample(7, 0, 3, up), [0, 0, 0]);
    assert.equal(controller.update({ ...data, objects: [wall(), door(true)] }, [light]), true);
    assert.equal(controller.texture, texture);
    assert.ok(controller.field.sample(7, 0, 3, up)[0] > 0);
    assert.equal(texture.needsUpdate, true);
    controller.detach(material);
    assert.equal(material.onBeforeCompile, originalCompile);
    assert.equal(material.userData.directionalLightFieldPrototype, undefined);
    controller.dispose();
    assert.equal(texture.disposed, true);
});

test('game directional field includes unslotted spotlights without double-counting active slots', async () => {
    const { activeStaticLightFieldSpotSlots, createLocationDirectionalLightField } = await integration;
    const three = { DataTexture: class {
        constructor(data, width, height) { Object.assign(this, { data, width, height }); }
        dispose() { this.disposed = true; }
    }, RGBAFormat: 1, ClampToEdgeWrapping: 2, LinearFilter: 3 };
    const sources = [
        { kind: 'spot', x: 2.25, z: 3.25, y: 1.4, height: 2,
            azimuth: 0, color: '#ffffff', intensity: 2, distance: 6 },
        { kind: 'spot', x: 2.25, z: 3.25, y: 1.4, height: 2,
            azimuth: 0, color: '#ffffff', intensity: 2, distance: 6 },
    ];
    const slots = { spotShadow: [{ intensity: 2,
        userData: { lampRenderSourceIndex: 0 } }], spotSimple: [{ intensity: 2,
        userData: { lampRenderSourceIndex: 1 } }] };
    const frozen = activeStaticLightFieldSpotSlots(slots, sources);
    assert.deepEqual(frozen, { spotShadow: [0], spotSimple: [null] });
    const controller = createLocationDirectionalLightField(three,
        { grid_width: 8, grid_height: 8, objects: [] }, sources, () => 0,
        new Set([0]));
    assert.deepEqual(controller.stats.lampStats.map(item => item.route), ['dynamic', 'field']);
    assert.ok(controller.field.sample(4.25, 0, 3.25, { x: 0, y: 1, z: 0 })[0] > 0);
    const texture = controller.texture;
    const rotated = [sources[0], { ...sources[1], azimuth: 90 }];
    assert.equal(controller.update({ grid_width: 8, grid_height: 8, objects: [] }, rotated,
        new Set([0])), true);
    assert.deepEqual(controller.field.sample(4.25, 0, 3.25,
        { x: 0, y: 1, z: 0 }), [0, 0, 0]);
    assert.ok(controller.field.sample(2.25, 0, 5.25,
        { x: 0, y: 1, z: 0 })[0] > 0);
    assert.equal(controller.update({ grid_width: 8, grid_height: 8, objects: [] }, sources,
        new Set([0, 1])), true);
    assert.equal(controller.stats.activeLights, 0);
    assert.equal(controller.texture, texture);
    controller.dispose();
    assert.equal(texture.disposed, true);
});

test('shadowless spotlight routes through wall-aware field instead of shining through a wall', async () => {
    const { activeStaticLightFieldSpotSlots, createLocationDirectionalLightField } = await integration;
    const three = { DataTexture: class {
        constructor(data, width, height) { Object.assign(this, { data, width, height }); }
        dispose() {}
    }, RGBAFormat: 1, ClampToEdgeWrapping: 2, LinearFilter: 3 };
    const source = { kind: 'spot', x: 3, z: 3, y: 1.5, height: 2,
        azimuth: 0, color: '#ffffff', intensity: 2, distance: 7 };
    const slots = { spotShadow: [], spotSimple: [{ intensity: 2,
        userData: { lampRenderSourceIndex: 0 } }] };
    assert.deepEqual(activeStaticLightFieldSpotSlots(slots, [source]),
        { spotShadow: [], spotSimple: [null] });
    const closed = { grid_width: 12, grid_height: 6, objects: [wall(), door(false)] };
    const controller = createLocationDirectionalLightField(three, closed, [source], () => 0);
    const up = { x: 0, y: 1, z: 0 };
    assert.equal(controller.stats.lampStats[0].route, 'field');
    assert.deepEqual(controller.field.sample(7, 0, 3, up), [0, 0, 0]);
    assert.equal(controller.update({ ...closed, objects: [wall(), door(true)] }, [source]), true);
    assert.ok(controller.field.sample(7, 0, 3, up)[0] > 0);
    controller.dispose();
});

test('opening a real door rebuilds the same field texture without adding a light or wall mesh', async () => {
    const { createLocationStaticLightField } = await integration;
    const three = { DataTexture: class {
        constructor(data, width, height) { Object.assign(this, { data, width, height }); }
        dispose() {}
    }, RGBAFormat: 1, ClampToEdgeWrapping: 2, NearestFilter: 3 };
    const light = { kind: 'point', x: 3, z: 3, y: 1.5,
        color: '#ffffff', intensity: 2, distance: 7 };
    const closed = { grid_width: 12, grid_height: 6, objects: [wall(), door(false)] };
    const controller = createLocationStaticLightField(three, closed, [light], () => 0);
    const texture = controller.texture;
    assert.deepEqual(controller.field.sample(7, 3, 0), [0, 0, 0]);
    assert.equal(controller.update({ ...closed, objects: [wall(), door(true)] }, [light]), true);
    assert.equal(controller.texture, texture);
    assert.equal(texture.needsUpdate, true);
    assert.ok(controller.field.sample(7, 3, 0)[0] > 0);
    controller.dispose();
});

test('frozen point slots follow the same lamp across deletion and do not reassign on addition', async () => {
    const { remapStaticLightFieldSlots } = await integration;
    const before = [
        { kind: 'point', x: 1, z: 2, intensity: 2 },
        { kind: 'point', x: 4, z: 2, intensity: 2 },
        { kind: 'point', x: 8, z: 2, intensity: 2 },
    ];
    const slots = { pointShadow: [0, 2], pointSimple: [null] };
    assert.deepEqual(remapStaticLightFieldSlots(slots, before, [...before,
        { kind: 'point', x: 10, z: 2, intensity: 2 }]), slots);
    assert.deepEqual(remapStaticLightFieldSlots(slots, before, before.slice(1)),
        { pointShadow: [null, 1], pointSimple: [null] });
    assert.deepEqual(remapStaticLightFieldSlots(slots, before,
        [before[0], { ...before[1], intensity: 3 }, before[2]]), slots);
});

test('frozen point and spotlight routes remap together after deleting a lamp', async () => {
    const { remapStaticLightFieldSlots } = await integration;
    const before = [
        { kind: 'point', x: 1, z: 2, intensity: 2 },
        { kind: 'spot', x: 4, z: 2, intensity: 2, azimuth: 0 },
        { kind: 'spot', x: 8, z: 2, intensity: 2, azimuth: 90 },
    ];
    const slots = { pointShadow: [0], pointSimple: [], spotShadow: [1], spotSimple: [null] };
    assert.deepEqual(remapStaticLightFieldSlots(slots, before, before.slice(1)),
        { pointShadow: [null], pointSimple: [], spotShadow: [0], spotSimple: [null] });
});

test('only actually shining point slots are excluded, not pending desired slots', async () => {
    const { activeStaticLightFieldPointSlots } = await integration;
    const sources = Array.from({ length: 3 }, () => ({ kind: 'point', intensity: 2 }));
    const slot = (actual, desired, intensity) => ({ intensity,
        userData: { lampRenderSourceIndex: actual, lampDesiredSourceIndex: desired } });
    const slots = { pointShadow: [slot(0, 2, 2), slot(null, 1, 0)],
        pointSimple: [slot(2, 0, 0.01)] };
    assert.deepEqual(activeStaticLightFieldPointSlots(slots, sources),
        { pointShadow: [0, null], pointSimple: [null] });
});

test('saved point lamps in two separate houses contribute across the whole scene', async () => {
    const { locationStaticLightFieldInputs } = await integration;
    const { createStaticLightField } = await prototype;
    const make = (type, x, z, width, depth, height, rotation = 0) => ({
        type, tile_x: Math.floor(x), tile_y: Math.floor(z), properties: {
            offset_x: x - Math.floor(x) - 0.5,
            offset_z: z - Math.floor(z) - 0.5,
            rotation, dimensions: { width, depth, height },
        },
    });
    const objects = [6, 20].flatMap(x => [
        make('floor', x, 6, 8, 8, 0.12),
        make('wall', x, 2, 8, 0.2, 2.4),
        make('wall', x, 10, 8, 0.2, 2.4),
        make('wall', x - 4, 6, 8, 0.2, 2.4, -Math.PI / 2),
        make('wall', x + 4, 6, 8, 0.2, 2.4, -Math.PI / 2),
    ]);
    const sources = [4, 5, 6, 7, 8, 18, 19, 20, 21, 22].map(x => ({
        x, z: 6, height: 2.2, y: 3.2, color: '#ffd090',
        intensity: 2.5, distance: 8,
    }));
    const inputs = locationStaticLightFieldInputs({ grid_width: 28, grid_height: 12, objects },
        sources, () => 1);
    assert.equal(inputs.lamps.length, 10);
    assert.deepEqual(inputs.lamps.map(lamp => lamp.id), [...sources.keys()]);
    const field = createStaticLightField(inputs);
    const stats = field.rebuild({ lamps: inputs.lamps, walls: inputs.walls,
        dynamicLightIds: new Set([0, 1, 2, 3, 4, 5]) });
    assert.equal(stats.activeLights, 4);
    assert.deepEqual(stats.lampStats.slice(0, 6).map(item => item.reason),
        Array(6).fill('dynamic'));
    assert.ok(stats.lampStats.slice(6).every(item => item.contributions > 0),
        `right-house lamps lost: ${JSON.stringify(stats.lampStats)}`);
    assert.ok(field.sample(20, 6, 0)[0] > 0.4,
        `right house was not lit: ${field.sample(20, 6, 0)}`);
    assert.ok(field.sampleWall(16.125, 6, 0)[0] > 0,
        'right-house interior wall lost its field contribution');
    assert.deepEqual(field.sampleWall(15.875, 6, 0), [0, 0, 0],
        'right-house light crossed an opaque exterior wall');
    assert.deepEqual(field.sample(6, 6, 0), [0, 0, 0]);
    const pixels = Buffer.from(field.pixels);
    field.rebuild({ lamps: inputs.lamps, walls: inputs.walls,
        dynamicLightIds: new Set([0, 1, 2, 3, 4, 5]) });
    assert.deepEqual(Buffer.from(field.pixels), pixels);
});

test('real-scene directional switch restores standard light and releases its resources', () => {
    const scene = fs.readFileSync(path.join(__dirname,
        '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('export function setLocationStaticLightFieldEnabled(');
    const end = scene.indexOf('export function getLocationStaticLightFieldDiagnostics(', start);
    assert.ok(start > 0 && end > start);
    const events = [];
    const material = { userData: {} };
    const controller = { stats: {}, attach() { events.push('attach'); },
        detach() { events.push('detach'); }, dispose() { events.push('dispose'); } };
    const context = vm.createContext({
        locationStaticLightField: null, staticFieldPointSlots: null,
        staticFieldSpotSlots: null,
        locationStaticLightFieldRefreshTimer: null, staticFieldFirstFrame: null,
        staticFieldLastToggleFrame: null,
        staticFieldLastToggleWork: null,
        locationProfiler: { stop() { events.push('stop-profile'); } },
        scene: {}, currentLocationData: { grid_width: 10, grid_height: 10, objects: [] },
        renderer: { capabilities: { maxTextureSize: 8192 }, info: { programs: [] } },
        lampRenderSources: [{ kind: 'point' }, { kind: 'point' }, { kind: 'point' }],
        lampRenderSlots: { pointShadow: [{ intensity: 2, shadow: { autoUpdate: true },
            userData: { lampRenderSourceIndex: 2, lampDesiredSourceIndex: 2 } }],
        pointSimple: [{ intensity: 0, shadow: { autoUpdate: false },
            userData: { lampRenderSourceIndex: null, lampDesiredSourceIndex: null } }],
        spotShadow: [], spotSimple: [] },
        LOCATION_DIRECTIONAL_FIELD_SAMPLES_PER_METER: 2,
        activeStaticLightFieldPointSlots() {
            return { pointShadow: [2], pointSimple: [null] };
        },
        activeStaticLightFieldSpotSlots() {
            return { spotShadow: [], spotSimple: [] };
        },
        structureLevel: () => 0, getTileHeight: () => 0, THREE: {},
        forEachStaticLightFieldMaterial(callback) { callback(material, 0); },
        staticFieldDynamicIds() { return new Set(Object.values(context.staticFieldPointSlots || {})
            .flat().filter(index => index != null)); },
        createLocationDirectionalLightField(_three, _data, _sources, _height, excluded) {
            assert.deepEqual([...excluded], [2]);
            events.push('create');
            return controller;
        },
        updateLampRenderLights() { events.push('slots'); },
        setStaticLightFieldButtonState() {},
        getLocationStaticLightFieldDiagnostics() { return {}; },
        performance: { now: () => 100 }, clearTimeout() {},
        showNotification() {}, console: { info() {}, error() {} },
    });
    vm.runInContext(scene.slice(start, end).replace('export function', 'function'), context);
    assert.equal(context.setLocationStaticLightFieldEnabled(false), false);
    assert.deepEqual(events, []);
    assert.equal(context.setLocationStaticLightFieldEnabled(true), true);
    assert.deepEqual(events, ['stop-profile', 'create', 'attach', 'slots']);
    assert.equal(context.setLocationStaticLightFieldEnabled(false), false);
    assert.deepEqual(events.slice(-4), ['stop-profile', 'detach', 'dispose', 'slots']);
    assert.equal(context.locationStaticLightField, null);
    assert.equal(context.staticFieldPointSlots, null);
    assert.equal(context.setLocationStaticLightFieldEnabled(true), true);
    assert.deepEqual(events.slice(-4), ['stop-profile', 'create', 'attach', 'slots']);
    assert.equal(context.setLocationStaticLightFieldEnabled(false), false);
    assert.deepEqual(events.slice(-4), ['stop-profile', 'detach', 'dispose', 'slots']);
    context.renderer.capabilities.maxTextureSize = 50;
    const beforeRejectedEnable = events.length;
    assert.equal(context.setLocationStaticLightFieldEnabled(true), false);
    assert.equal(events.length, beforeRejectedEnable + 1);
    assert.equal(events.at(-1), 'stop-profile');
    const loadStart = scene.indexOf('export function loadLocation(data)');
    const loadEnd = scene.indexOf('function rebuildSmoothTerrainMesh', loadStart);
    const loadBody = scene.slice(loadStart, loadEnd);
    assert.match(loadBody, /controls\.update\(\);\s*updateLampRenderLights\(performance\.now\(\), 1, true\);\s*setLocationStaticLightFieldEnabled\(true\);/);
});
