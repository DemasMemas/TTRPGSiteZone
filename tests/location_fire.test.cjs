const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationFire.js'), 'utf8');
const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const catalog = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetCatalog.js'), 'utf8');
const editor = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('only lit fire objects emit light and resizing moves the source', async () => {
    const { fireLightSource, getFireLightSources } = await import(moduleUrl);
    const fire = { type: 'campfire', tile_x: 2, tile_y: 3, properties: {
        is_lit: true, offset_x: 0.25, elevation: 0.5, dimensions: { height: 1.4 },
    } };
    const light = fireLightSource(fire);
    assert.equal(light.x, 2.75);
    assert.equal(light.z, 3.5);
    assert.ok(light.height > 1);
    assert.equal(getFireLightSources([fire, { ...fire, properties: { is_lit: false } }]).length, 1);
    assert.equal(fireLightSource({ type: 'wall', properties: { is_lit: true } }), null);
});

test('all fire models keep a solid unlit body and animate only lit flames', async () => {
    const { createFireObjectModel, animateFireObjectModels } = await import(moduleUrl);
    const geometry = class {};
    class Group {
        constructor() { this.children = []; this.userData = {}; }
        add(child) { this.children.push(child); }
    }
    class Mesh {
        constructor(shape, material) {
            this.geometry = shape; this.material = material; this.userData = {};
            this.position = { set() {} }; this.rotation = { x: 0, y: 0, z: 0 };
            this.scale = { y: 1 };
        }
    }
    const THREE = {
        Group, Mesh, MeshStandardMaterial: class {},
        DodecahedronGeometry: geometry, CylinderGeometry: geometry, BoxGeometry: geometry,
        ConeGeometry: geometry, TorusGeometry: geometry, DoubleSide: 2,
    };
    for (const type of ['campfire', 'torch', 'wall_torch', 'fire_barrel']) {
        const dimensions = { width: 0.9, depth: 0.9, height: 1.1 };
        const off = createFireObjectModel(THREE, { type, properties: { is_lit: false } }, dimensions);
        const on = createFireObjectModel(THREE, { type, properties: { is_lit: true } }, dimensions);
        assert.ok(off.children.length > 0, type);
        assert.equal(off.userData.fireFlames, undefined);
        assert.equal(on.userData.fireFlames.length, 3);
        animateFireObjectModels([on], 500);
        assert.notEqual(on.userData.fireFlames[0].mesh.scale.y, 1);
    }
});

test('catalog, model, interactions and GM inspector expose all fire variants', () => {
    for (const type of ['campfire', 'torch', 'wall_torch', 'fire_barrel']) {
        assert.match(catalog, new RegExp(`id: '${type}'.*kind: 'structure'`));
        assert.match(scene, new RegExp(`${type}: \\['toggle_fire'\\]`));
    }
    assert.match(scene, /createFireObjectModel\(THREE, obj, \{ width, depth, height \}\)/);
    assert.match(scene, /animateFireObjectModels\(locationObjectMeshes, frameTime\)/);
    assert.match(scene, /getLocationFireSources\(\)/);
    assert.match(scene, /export async function toggleSelectedLocationFire/);
    assert.match(editor, /data-asset-action="fire"/);
    assert.match(editor, /toggleSelectedLocationFire\(\)/);
});

test('switching a placed fire updates its existing light instead of rebuilding all lights', async () => {
    const { fireLightSource } = await import(moduleUrl);
    const unlit = fireLightSource({ type: 'campfire', tile_x: 1, tile_y: 1,
        properties: { is_lit: false } }, true);
    assert.equal(unlit.intensity, 0);
    assert.match(scene, /light\.userData\.fireObjectId = objectId/);
    assert.match(scene, /const light = existing \|\| locationLightGroup\.children\.find/);
    assert.match(scene, /light\.intensity = source\.intensity/);
    assert.match(scene, /existing\.intensity = 0;\s*existing\.userData\.fireObjectId = null/);
    assert.match(scene, /fireLightCapacity = Math\.max\(MIN_FIRE_LIGHT_POOL/);
    assert.doesNotMatch(scene.slice(scene.indexOf('function syncFireObjectLight('),
        scene.indexOf('\nfunction getLocationDecorFireSources(', scene.indexOf('function syncFireObjectLight('))),
    /locationLightGroup\.remove\(existing\)/);
    assert.match(scene, /if \(fire\) \{\s*syncFireObjectLight\(object\)/);
    assert.match(scene, /if \(currentLocationData\.objects\.some\(item => String\(item\.id\) === String\(object\.id\)\)\) return/);
    assert.match(scene, /light\.castShadow = false/);
    assert.match(scene, /if \(fire\) syncFireObjectLight\(null, objectId\)/);
    assert.match(scene, /if \(isObjectLightSource\(object\)\) syncFireObjectLight\(null, objectId, false\)/);
    assert.match(catalog, /id: 'fire_barrel'.*dimensions: \[0\.72, 0\.72, 0\.78\]/);
});

test('fire placement preview follows the cursor without rebuilding its model', async () => {
    const { LOCATION_ASSETS } = await import(`data:text/javascript;base64,${Buffer.from(catalog).toString('base64')}`);
    const start = scene.indexOf('function updateBuildPreview()');
    const end = scene.indexOf('async function placeStructureAtTile(', start);
    assert.ok(start >= 0 && end > start);
    for (const type of ['campfire', 'torch', 'wall_torch', 'fire_barrel']) {
        const asset = LOCATION_ASSETS.find(item => item.id === type);
        assert.equal(asset?.kind, 'structure', type);
        const created = [];
        const context = vm.createContext({
            houseDrawMode: false, editorRotateMode: false, editorResizeMode: false,
            editorSelections: [], editorSelection: null,
            editorMoveMode: false, editorMovePreviewPoint: null, editorRotateAngle: 0,
            editorResizeAxis: null, editorResizeDimensions: null, editorResizeSymmetric: false,
            editorResizeElevation: null, editorResizeAnchor: null,
            brushObjectRotation: 0, selectedLocationAsset: asset,
            structureRotation: 0, structureWidth: 1, structureDepth: 1, structureHeight: 1,
            structureColor: '#fff', window: { locationEditMode: true, locationEditorTool: 'assets' },
            hoveredTileCoords: { x: 1, z: 2 }, scene: { add() {} },
            buildPreviewMesh: null, buildPreviewKey: null, lampEditTrace: null,
            getTileHeight: x => x / 10, clampAssetElevation: value => Number(value) || 0,
            getStructurePlacementProperties: () => ({ building_id: 'test-building', level: 0 }),
            structureLevelOffset: object => (object.properties?.level || 0) * 2.4,
            placementForLocationAsset: source => ({ type: source.id, visualAsset: null }),
            isFireObject: object => object.type === type, isElectricFixture: () => false,
            createLocationObjectMesh(object) {
                const mesh = { position: { set(x, y, z) { Object.assign(this, { x, y, z }); } } };
                created.push({ object, mesh });
                return mesh;
            },
            fadeEditorPreview: mesh => mesh,
        });
        context.clearBuildPreview = () => {
            context.buildPreviewMesh = null;
            context.buildPreviewKey = null;
        };
        vm.runInContext(scene.slice(start, end), context);
        context.updateBuildPreview();
        const first = context.buildPreviewMesh;
        context.hoveredTileCoords = { x: 3, z: 4 };
        context.updateBuildPreview();
        assert.equal(created.length, 1, type);
        assert.equal(created[0].object.properties.is_lit, true, type);
        assert.equal(context.buildPreviewMesh, first, type);
        assert.equal(first.position.x, 3.5, type);
        assert.ok(Math.abs(first.position.y - (0.3 + Number(asset.elevation || 0))) < 1e-8, type);
        assert.ok(Math.abs(first.position.z - (4.5 + Number(asset.offsetZ || 0))) < 1e-8, type);
    }
});

test('fire light stays in the scene after deletion and is reused on the next placement', () => {
    const start = scene.indexOf('const MIN_FIRE_LIGHT_POOL =');
    const end = scene.indexOf('\nfunction getLocationDecorFireSources(', start);
    assert.ok(start >= 0 && end > start);
    const group = { children: [], add(light) { this.children.push(light); light.parent = this; } };
    class PointLight {
        constructor(color, intensity, distance) {
            this.userData = {}; this.color = { set(value) { this.value = value; } };
            this.intensity = intensity; this.distance = distance;
            this.position = { set() {} }; this.shadow = { mapSize: { set() {} } };
        }
    }
    const context = vm.createContext({
        THREE: { PointLight }, locationLightGroup: group, locationStaticLightField: null,
        queueStaticLightFieldRefresh() {},
        fireLightSource: object => object ? { x: 1, z: 1, tileX: 0, tileZ: 0,
            height: 0.5, color: '#fff', intensity: 2, distance: 4 } : null,
        electricFixtureLightSource: () => null,
        getTileHeight: () => 1, activeLightingProfile: { dark_tiles: [] },
    });
    vm.runInContext(scene.slice(start, end), context);
    context.syncFireObjectLight({ id: 1 }, 1);
    const first = group.children[0];
    context.syncFireObjectLight(null, 1);
    assert.equal(group.children.length, 1);
    assert.equal(first.intensity, 0);
    context.syncFireObjectLight({ id: 2 }, 2);
    assert.equal(group.children.length, 1);
    assert.equal(group.children[0], first);
    assert.equal(first.userData.fireObjectId, 2);
    context.locationStaticLightField = {};
    context.syncFireObjectLight({ id: 2 }, 2);
    assert.equal(first.visible, false, 'the field replaces the stationary PointLight');
    context.locationStaticLightField = null;
    context.syncFireObjectLight({ id: 2 }, 2);
    assert.equal(first.visible, true, 'legacy light returns when the field is disabled');
});

test('socket echo and POST response add one fire only once', () => {
    const start = scene.indexOf('export function addLocationObject(object) {');
    const end = scene.indexOf('\nwindow.addLocationObject = addLocationObject;', start);
    assert.ok(start >= 0 && end > start);
    const calls = { mesh: 0, light: 0, fog: 0 };
    const context = vm.createContext({
        currentLocationData: { objects: [] }, activeLightingProfile: { dark_tiles: [] },
        isFireObject: object => object.type === 'campfire',
        isObjectLightSource: object => object.type === 'campfire',
        addLocationObjectMesh: () => { calls.mesh++; },
        syncFireObjectLight: () => { calls.light++; },
        applyFogOfWar: () => { calls.fog++; },
        fogIsActive: () => true,
        invalidateMovementMapCache() {},
    });
    vm.runInContext(scene.slice(start, end).replace('export function', 'function'), context);
    const object = { id: 42, type: 'campfire' };
    context.addLocationObject(object);
    context.addLocationObject({ ...object });
    assert.deepEqual(calls, { mesh: 1, light: 1, fog: 1 });
});

test('adding a fire recolors only dark tiles whose light changed', () => {
    const start = scene.indexOf('function refreshLocationDarkness(');
    const end = scene.indexOf('\nfunction addLocationObjectMesh(', start);
    assert.ok(start >= 0 && end > start);
    const recolored = [];
    let rebuiltOverlay = false;
    const profile = { mode: 'fixed', ambient_intensity: 1, directional_intensity: 1,
        dark_tiles: [{ x: 1, z: 0 }], local_lights: [] };
    const context = vm.createContext({
        currentLocationData: { grid_width: 2, grid_height: 2, objects: [],
            tiles_data: Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => ({ terrain: 'grass' }))) },
        activeLightingProfile: profile, locationDarknessFactors: Float32Array.from([1, 0.2, 1, 1]),
        locationDarknessTexture: null, locationTileMesh: { setColorAt(index) { recolored.push(index); },
            instanceColor: {} }, waterTileMesh: null,
        computeDarknessFactors: () => Float32Array.from([1, 0.6, 1, 1]),
        getLocationEmissiveSources: () => [], isWorldDarkTime: () => false,
        window: { lobbyGameTimeMinutes: 480 }, terrainColors: { grass: 0x3a5f0b },
        THREE: { Color: class { multiplyScalar() { return this; } } },
        darknessFactorAt: () => 0.6, updateSmoothTerrainColors() {}, updateLocationGridColors() {},
        locationObjectMeshes: [], objectMeshes: [], characterModels: new Map(),
        fogIsActive: () => false, applyFogOfWar() {},
        refreshDarknessEditorOverlay: () => { rebuiltOverlay = true; },
    });
    vm.runInContext(scene.slice(start, end), context);
    context.refreshLocationDarkness(profile, true);
    assert.deepEqual(recolored, [1]);
    assert.equal(rebuiltOverlay, false);
});
