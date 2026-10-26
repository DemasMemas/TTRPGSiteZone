const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const importSource = source => import(`data:text/javascript,${encodeURIComponent(source)}`);

test('mounted lights have catalog presets and follow the object position', async () => {
    const { LOCATION_ASSETS } = await importSource(read('locationAssetCatalog.js'));
    const { electricFixtureLightSource } = await importSource(read('locationFixtures.js'));
    const { fireLightSource } = await importSource(read('locationFire.js'));
    for (const id of ['ceiling_bulb', 'wall_bulb', 'wall_torch']) {
        assert.ok(LOCATION_ASSETS.some(asset => asset.id === id && asset.kind === 'structure'));
    }
    for (const id of ['wall_bulb', 'wall_torch']) {
        assert.equal(LOCATION_ASSETS.find(asset => asset.id === id).offsetZ, 0.2);
    }
    const ceiling = { type: 'ceiling_bulb', tile_x: 2, tile_y: 3, properties: {
        elevation: 2.4, dimensions: { height: 0.7 }, is_on: true,
    } };
    assert.equal(electricFixtureLightSource(ceiling).height,
        2.4 - 0.7 * (0.64 + 0.19 / 2) - 0.32 * 0.43 + 0.006);
    assert.equal(electricFixtureLightSource({ ...ceiling, properties: { ...ceiling.properties, is_on: false } }), null);
    const wall = { type: 'wall_bulb', tile_x: 2, tile_y: 3, properties: {
        elevation: 1.8, offset_z: -0.43, rotation: Math.PI / 2,
        dimensions: { depth: 0.4 }, is_on: true,
    } };
    assert.ok(electricFixtureLightSource(wall).x > 2.5);
    assert.ok(Math.abs(electricFixtureLightSource(wall).z - 3.07) < 0.001);
    const torch = { type: 'wall_torch', tile_x: 2, tile_y: 3, properties: {
        elevation: 1.25, offset_z: -0.43, dimensions: { depth: 0.42, height: 0.75 }, is_lit: true,
    } };
    assert.ok(fireLightSource(torch).z > 3.07);
    assert.equal(fireLightSource({ ...torch, properties: { ...torch.properties, is_lit: false } }), null);
});

test('electric fixtures have visible solid models in both switch states', async () => {
    const { createElectricFixtureModel, electricFixtureLightSource } = await importSource(read('locationFixtures.js'));
    class Group {
        constructor() { this.children = []; }
        add(child) { this.children.push(child); }
    }
    class Mesh {
        constructor(geometry, material) {
            this.geometry = geometry; this.material = material;
            this.position = { set(x, y, z) { Object.assign(this, { x, y, z }); } }; this.rotation = {};
        }
    }
    const Geometry = class { constructor(...args) { this.args = args; } };
    const THREE = { Group, Mesh, MeshStandardMaterial: class { constructor(values) { Object.assign(this, values); } },
        CylinderGeometry: Geometry, BoxGeometry: Geometry, SphereGeometry: Geometry };
    for (const type of ['ceiling_bulb', 'wall_bulb']) {
        const dimensions = { width: 0.38, depth: 0.4, height: 0.7 };
        const on = createElectricFixtureModel(THREE, { type, properties: { is_on: true } }, dimensions);
        const off = createElectricFixtureModel(THREE, { type, properties: { is_on: false } }, dimensions);
        assert.ok(on.children.length >= 4);
        assert.equal(on.children.length, off.children.length);
        assert.ok(on.children.at(-1).material.emissiveIntensity > 0);
        assert.equal(off.children.at(-1).material.emissiveIntensity, 0);
        const globe = on.children.at(-1);
        if (type === 'wall_bulb') {
            const plate = on.children[0];
            const arm = on.children[1];
            const socket = on.children[2];
            assert.ok(arm.position.z - arm.geometry.args[2] / 2
                <= plate.position.z + plate.geometry.args[2] / 2);
            assert.ok(arm.position.z + arm.geometry.args[2] / 2
                >= socket.position.z - socket.geometry.args[1]);
            assert.equal(globe.position.z, socket.position.z);
            assert.ok(globe.position.y > arm.position.y + arm.geometry.args[1] / 2);
            assert.ok(Math.abs(globe.position.y - globe.geometry.args[0]
                - socket.position.y - socket.geometry.args[2] / 2) < 0.015);
            assert.ok(globe.material.emissiveIntensity < 1);
            assert.equal(electricFixtureLightSource({ type, tile_x: 1, tile_y: 1,
                properties: { elevation: 1.8, dimensions } }).height, 1.8 + globe.position.y);
        } else {
            const socket = on.children[2];
            const globeTop = globe.position.y + globe.geometry.args[0];
            assert.ok(Math.abs(globeTop - (socket.position.y - socket.geometry.args[2] / 2)) < 0.015);
        }
    }
    const scene = read('locationScene.js');
    assert.match(scene, /group\.add\(createElectricFixtureModel\(/);
    assert.match(scene, /fireLightSource\(object, true\) \|\| electricFixtureLightSource\(object, true\)/);
    assert.match(scene, /isObjectLightSource\(object\)/);
    assert.match(scene, /electric: isElectricFixture\(source\)/);
    assert.match(read('main.js'), /selection\.electric\s*\? \(selection\.isLit \? 'Выключить' : 'Включить'\)/);
});

test('wall bulb mounting plate meets solid wall faces on the selected storey', async () => {
    const scene = read('locationScene.js');
    const start = scene.indexOf('function wallBulbMountAt(');
    const end = scene.indexOf('function wallBulbPlacement(', start);
    assert.ok(start >= 0 && end > start);
    const { wallVisualPlan, structurePose, structureLevel, structureBuildingId } =
        await importSource(read('locationArchitecture.js'));
    const wall = { id: 1, type: 'wall', tile_x: 5, tile_y: 5, properties: {
        building_id: 'house', level: 0, rotation: 0,
        dimensions: { width: 4, depth: 0.2, height: 2.4 },
    } };
    const data = { grid_width: 12, grid_height: 12, objects: [wall] };
    const context = vm.createContext({ currentLocationData: data,
        wallVisualPlan, structurePose, structureLevel, structureBuildingId, getTileHeight: () => 0 });
    vm.runInContext(scene.slice(start, end), context);
    const dimensions = { width: 0.38, depth: 0.4, height: 0.36 };
    const front = context.wallBulbMountAt(5.5, 5.75, 0, 1.8, dimensions);
    assert.ok(front);
    assert.ok(Math.abs(front.z - (5.6 + 0.4 * 0.38 + 0.055 / 2)) < 1e-6);
    assert.equal(front.rotation, 0);
    assert.equal(front.buildingId, 'house');
    const back = context.wallBulbMountAt(5.5, 5.25, 0, 1.8, dimensions);
    assert.ok(back);
    assert.ok(Math.abs(back.z - (5.4 - 0.4 * 0.38 - 0.055 / 2)) < 1e-6);
    assert.equal(back.rotation, Math.PI);
    const shelf = { width: 1.15, depth: 0.26, height: 0.38 };
    const shelfFront = context.wallBulbMountAt(5.5, 5.75, 0, 1.34, shelf, 0.9, true);
    assert.ok(Math.abs(shelfFront.z - 5.738) < 1e-6);
    const shelfBack = context.wallBulbMountAt(5.5, 5.25, 0, 1.34, shelf, 0.9, true);
    assert.ok(Math.abs(shelfBack.z - 5.262) < 1e-6);
    assert.equal(shelfBack.rotation, Math.PI);
    assert.equal(context.wallBulbMountAt(5.5, 5.75, 0, 2.5, shelf, 0.9, true), null);
    assert.equal(context.wallBulbMountAt(5.5, 5.75, 1, 1.8, dimensions), null);
    assert.equal(context.wallBulbMountAt(8, 8, 0, 1.8, dimensions), null);
    wall.properties.rotation = Math.PI / 2;
    const rotated = context.wallBulbMountAt(5.75, 5.5, 0, 1.8, dimensions);
    assert.ok(rotated);
    assert.ok(Math.abs(rotated.x - (5.6 + 0.4 * 0.38 + 0.055 / 2)) < 1e-6);
    wall.properties.rotation = 0;
    data.objects.push({ id: 2, type: 'door', tile_x: 5, tile_y: 5, properties: {
        building_id: 'house', level: 0, rotation: 0,
        dimensions: { width: 1, depth: 0.18, height: 2 },
    } });
    assert.equal(context.wallBulbMountAt(5.5, 5.75, 0, 1.8, dimensions), null);
});

test('placing a wall bulb saves the snapped pose and rejects an unmatched wall', async () => {
    const scene = read('locationScene.js');
    const start = scene.indexOf('async function placeStructureAtTile(');
    const end = scene.indexOf('async function removeStructuresAtTile(', start);
    assert.ok(start >= 0 && end > start);
    const saved = [];
    const notices = [];
    const mount = { x: 5.5, z: 5.78, tileX: 5, tileZ: 5,
        rotation: Math.PI, buildingId: 'house' };
    const context = vm.createContext({
        window: { currentLobbyId: 19, locationEditorTool: 'assets' },
        currentLocationId: 23,
        structurePreset: 'wall_bulb', structureColor: '#ffe2aa', structureRotation: 0,
        selectedLocationAsset: { kind: 'structure', id: 'wall_bulb', elevation: 1.8 },
        getStructureDimensions: () => ({ width: 0.38, depth: 0.4, height: 0.36 }),
        placementForLocationAsset: () => ({ type: 'wall_bulb' }),
        wallBulbPlacement: () => mount,
        getStructurePlacementProperties: () => ({ level: 1, building_id: '' }),
        document: { querySelector: () => null, getElementById: () => ({ value: 'medium' }) },
        COVER_CLASS_DEFAULTS: { medium: { maxHp: 10, protection: 1 } },
        Server: { async createLocationObject(_lobbyId, _locationId, object) {
            saved.push(object); return { id: 42, ...object };
        } },
        addLocationObject() {}, clampAssetElevation: Number,
        THROWABLE_OBJECT_WEIGHTS: {}, objectInteractions: {}, interactionRequirements: {},
        isFireObject: () => false, isElectricFixture: () => true,
        isObjectLightSource: () => true,
        showNotification: message => notices.push(message),
    });
    vm.runInContext(scene.slice(start, end), context);
    await context.placeStructureAtTile(4, 5, { x: 100, y: 100 });
    assert.equal(saved.length, 1);
    assert.equal(saved[0].tile_x, 5);
    assert.equal(saved[0].tile_y, 5);
    assert.equal(saved[0].properties.building_id, 'house');
    assert.equal(saved[0].properties.level, 1);
    assert.equal(saved[0].properties.rotation, Math.PI);
    assert.ok(Math.abs(saved[0].properties.offset_z - 0.28) < 1e-6);
    context.wallBulbPlacement = () => null;
    await context.placeStructureAtTile(4, 5, { x: 100, y: 100 });
    assert.equal(saved.length, 1);
    assert.equal(notices.length, 1);
});
