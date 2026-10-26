const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');

function functionSource(name, nextName) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`function ${nextName}(`, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end).replaceAll('export function ', 'function ')
        .replace(/\bexport\s*$/, '');
}

test('saved building IDs produce separate storey ranges and rotated footprints', () => {
    const objects = [
        { id: 1, type: 'floor', tile_x: 0, tile_y: 0,
            properties: { building_id: 'multi', level: 0, dimensions: { width: 4, depth: 4 } } },
        { id: 2, type: 'floor', tile_x: 0, tile_y: 0,
            properties: { building_id: 'multi', level: 1, dimensions: { width: 4, depth: 4 } } },
        { id: 3, type: 'floor', tile_x: 9, tile_y: 0,
            properties: { building_id: 'single', level: 0, dimensions: { width: 4, depth: 4 } } },
    ];
    const roofPlan = { floorId: 2, x: 0.5, z: 0.5, angle: Math.PI / 4,
        width: 4, depth: 4, eaveY: 5, rise: 1 };
    const context = vm.createContext({
        STOREY_HEIGHT: 2.4, locationViewLevel: 0, locationBuildingViews: new Map(),
        locationBuildingViewsDirty: true, currentLocationData: { objects },
        roofMeshes: [{ userData: { roofPlan } }], camera: null, controls: null,
        structureBuildingId: object => object?.properties?.building_id || null,
        structureLevel: object => Number(object?.properties?.level || 0),
        structureLevelOffset: object => Number(object?.properties?.level || 0) * 2.4,
        structurePose: object => ({ x: object.tile_x + 0.5, z: object.tile_y + 0.5,
            angle: 0, width: object.properties.dimensions.width,
            depth: object.properties.dimensions.depth, height: 0.12 }),
        getTileHeight: () => 0,
    });
    vm.runInContext(functionSource('getLocationBuildingViews', 'lampDisplayLevel'), context);
    const views = context.getLocationBuildingViews();
    assert.equal(views.get('multi').maxLevel, 1);
    assert.equal(views.get('single').maxLevel, 0);
    assert.equal(views.get('multi').plan, roofPlan);
    views.get('multi').distant = false;
    assert.equal(context.locationLevelVisible(1, 'multi', 0.5, 0.5), false);
    assert.equal(context.locationLevelVisible(1, null, 3.1, 0.5), false);
    assert.equal(context.locationLevelVisible(0, 'single', 9.5, 0.5), true);
    assert.equal(context.locationLevelVisible(1, null, 0.5, 0.5), false);
    assert.equal(context.locationLevelVisible(1, null, 9.5, 0.5), true);
    views.get('multi').distant = true;
    assert.equal(context.locationLevelVisible(1, null, 0.5, 0.5), true);
});

test('near multi-storey houses retain lower floors while single-storey houses stay intact', () => {
    const multi = { minLevel: 0, maxLevel: 2, distant: false,
        plan: { x: 1, z: 1, angle: 0, width: 4, depth: 4 } };
    const single = { minLevel: 0, maxLevel: 0, distant: false,
        plan: { x: 10, z: 1, angle: 0, width: 4, depth: 4 } };
    const structures = [0, 1, 2].map(level => ({ visible: true, position: { x: 1, z: 1 },
        userData: { locationObject: { properties: { level, building_id: 'multi' } } } }));
    structures.push({ visible: true, position: { x: 10, z: 1 },
        userData: { locationObject: { properties: { level: 0, building_id: 'single' } } } });
    const decor = [0, 2.4, 4.8].map(elevation => ({ visible: true, position: { x: 1, z: 1 },
        userData: { sourceObject: { elevation, type: 'chair' } } }));
    decor.push({ visible: true, position: { x: 10, z: 1 },
        userData: { sourceObject: { elevation: 2.4, type: 'chair' } } });
    decor.push({ visible: true, position: { x: 20, z: 1 },
        userData: { sourceObject: { elevation: 2.4, type: 'chair' } } });
    const character = { gmHidden: false, camouflaged: false,
        model: { visible: true, position: { x: 1, z: 1 } }, label: { visible: true } };
    const context = vm.createContext({
        STOREY_HEIGHT: 2.4, locationViewLevel: 0, scene: {}, currentLocationData: {},
        locationBuildingViews: new Map([['multi', multi], ['single', single]]),
        locationBuildingViewsDirty: false,
        characterModels: new Map([[1, character]]), locationObjectMeshes: structures,
        objectMeshes: decor, window: { isGM: true }, fogIsActive: () => false,
        loadFogMemory() {}, updateFogOverlay() {}, syncFogMemoryGhosts() {},
        isFogHiddenObject: () => false,
        structureBuildingId: object => object?.properties?.building_id || null,
        structureLevel: object => Number(object?.properties?.level || 0),
    });
    vm.runInContext(functionSource('decorDisplayLevel', 'locationFloorCount')
        + functionSource('applyFogOfWar', 'closeTeamManagementModal'), context);
    for (const level of [0, 1, 2]) {
        context.locationViewLevel = level;
        context.applyFogOfWar();
        assert.deepEqual(structures.map(mesh => mesh.visible), [true, level >= 1, level >= 2, true]);
        assert.deepEqual(decor.map(mesh => mesh.visible), [true, level >= 1, level >= 2, true, true]);
        assert.equal(character.model.visible, true);
        assert.equal(character.label.visible, true);
    }
    context.locationViewLevel = 0;
    multi.distant = true;
    context.applyFogOfWar();
    assert.deepEqual(structures.map(mesh => mesh.visible), [true, true, true, true]);
    assert.deepEqual(decor.map(mesh => mesh.visible), [true, true, true, true, true]);
});

test('floor list includes saved upper floors and lamp fixtures follow the viewed level', () => {
    const sources = [2.2, 2.6, 4.6, 7.0].map(height => ({ height, x: 1, z: 1 }));
    sources.push({ height: 2.2, x: 10, z: 1 });
    const fixtures = sources.map((source, index) => ({ visible: true,
        userData: { locationLampIndex: index }, height: source.height }));
    const dynamicLight = { visible: true, userData: {} };
    const multi = { minLevel: 0, maxLevel: 2, distant: false,
        plan: { x: 1, z: 1, angle: 0, width: 4, depth: 4 } };
    const single = { minLevel: 0, maxLevel: 0, distant: false,
        plan: { x: 10, z: 1, angle: 0, width: 4, depth: 4 } };
    const context = vm.createContext({
        STOREY_HEIGHT: 2.4, locationViewLevel: 0,
        locationBuildingViews: new Map([['multi', multi], ['single', single]]),
        locationBuildingViewsDirty: false,
        currentLocationData: {
            objects: [{ properties: { level: 2 } }],
            tiles_data: [[{ objects: [] }]],
            lighting: { local_lights: sources },
        },
        locationLightGroup: { children: [...fixtures, dynamicLight] },
        window: { isGM: true },
        structureLevel: object => Number(object?.properties?.level || 0),
    });
    vm.runInContext(functionSource('decorDisplayLevel', 'setLocationViewLevel'), context);
    assert.equal(context.locationFloorCount(), 3);
    context.currentLocationData.objects = [];
    context.currentLocationData.lighting.local_lights = [];
    assert.equal(context.locationFloorCount(), 2);
    context.window.isGM = false;
    assert.equal(context.locationFloorCount(), 1);
    context.currentLocationData.lighting.local_lights = sources;
    for (const level of [0, 1, 2]) {
        context.locationViewLevel = level;
        context.updateLocationLampFixtureFloors();
        assert.deepEqual(fixtures.map(fixture => fixture.visible),
            [true, true, level >= 1, level >= 2, true]);
        assert.equal(dynamicLight.visible, true);
    }
    context.locationViewLevel = 0;
    multi.distant = true;
    context.updateLocationLampFixtureFloors();
    assert.deepEqual(fixtures.map(fixture => fixture.visible), [true, true, true, true, true]);
});

test('changing viewed floor updates fog, fixtures and roofs without changing placement data', () => {
    const calls = [];
    const context = vm.createContext({
        locationViewLevel: 0, editorSelection: { kind: 'structure', id: 7 },
        lampRenderSources: [],
        locationFloorCount: () => 3, locationMinimumLevel: () => 0, hideHighlight() {},
        document: { getElementById: () => null },
        clearEditorSelection() { calls.push('selection'); this.editorSelection = null; },
        applyFogOfWar: () => calls.push('fog'),
        updateLocationLampFixtureFloors: () => calls.push('fixtures'),
        updateRoofVisibility: () => calls.push('roofs'),
        refreshLocationFloorMenu: () => calls.push('menu'),
    });
    vm.runInContext(functionSource('setLocationViewLevel', 'updateRoofVisibility'), context);
    context.setLocationViewLevel(2);
    assert.equal(context.locationViewLevel, 2);
    assert.deepEqual(calls, ['selection', 'roofs', 'fog', 'fixtures', 'menu']);
    context.setLocationViewLevel(2);
    assert.equal(calls.length, 5);
    context.setLocationViewLevel(99);
    assert.equal(context.locationViewLevel, 2);
    context.setLocationViewLevel(-1);
    assert.equal(context.locationViewLevel, 0);
});

test('GM floor menu synchronizes the existing placement level without editing saved objects', () => {
    let changes = 0;
    const placementLevel = { value: '0', options: [{ value: '0' }, { value: '1' }],
        dispatchEvent() { changes++; } };
    const context = vm.createContext({
        locationViewLevel: 0, editorSelection: null, lampRenderSources: [],
        locationFloorCount: () => 3, locationMinimumLevel: () => 0, hideHighlight() {},
        document: { getElementById: () => placementLevel }, Event: class {},
        applyFogOfWar() {}, updateLocationLampFixtureFloors() {},
        updateRoofVisibility() {}, refreshLocationFloorMenu() {},
    });
    vm.runInContext(functionSource('setLocationViewLevel', 'updateRoofVisibility'), context);
    context.setLocationViewLevel(1);
    assert.equal(placementLevel.value, '1');
    assert.equal(changes, 1);
    context.setLocationViewLevel(2);
    assert.equal(placementLevel.value, '1');
    assert.equal(changes, 1);
});

test('floor menu releases keyboard focus after choosing a level or using its buttons', () => {
    let menu;
    const makeElement = tag => ({ tag, style: {}, dataset: {}, children: [], blurred: false,
        setAttribute() {}, remove() {}, blur() { this.blurred = true; },
        append(...children) { this.children.push(...children); },
        appendChild(child) { this.children.push(child); },
    });
    const chosen = [];
    const context = vm.createContext({
        window: { isGM: true }, addFloorAboveSelectedLocationAsset() {},
        locationViewLevel: 0,
        document: { createElement: makeElement, getElementById(id) {
            return id === 'location-container' ? { appendChild(element) { menu = element; } } : null;
        } },
        setLocationViewLevel: level => chosen.push(level),
        refreshLocationFloorMenu() {}, applyFogOfWar() {},
        updateLocationLampFixtureFloors() {}, updateRoofVisibility() {}, lampRenderSources: [],
    });
    const start = source.indexOf('export function addLocationFloorMenu()');
    const end = source.indexOf('export function destroyLocationScene()', start);
    assert.ok(start >= 0 && end > start);
    vm.runInContext(source.slice(start, end).replace('export function', 'function').replace(/\bexport\s*$/, ''), context);
    context.addLocationFloorMenu();
    const [down, label, up] = menu.children;
    const select = label.children[0];
    select.value = '1';
    select.onchange();
    down.onclick();
    up.onclick();
    assert.deepEqual(chosen, ['1', -1, 1]);
    assert.equal(select.blurred, true);
    assert.equal(down.blurred, true);
    assert.equal(up.blurred, true);
});
