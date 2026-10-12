const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');

function section(start, end) {
    const first = scene.indexOf(start);
    const last = scene.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `${start} should exist`);
    return scene.slice(first, last).replaceAll('export ', '');
}

test('shift-click adds and removes objects without discarding the rest', () => {
    const selections = [{ kind: 'structure', id: 1 }];
    const context = vm.createContext({
        editorSelection: selections[0], editorSelections: selections,
        pickEditorAsset: x => ({ kind: 'structure', id: x }),
        applyLocationLighting() {}, notifyEditorResize() {},
        updateEditorSelectionVisual() {}, notifyEditorSelection() {},
    });
    vm.runInContext(section('function sameEditorSelection(', 'async function persistLocationLights('), context);
    assert.equal(context.selectEditorAsset(2, 0, true), true);
    assert.deepEqual(context.editorSelections.map(item => item.id), [1, 2]);
    assert.equal(context.selectEditorAsset(2, 0, true), true);
    assert.deepEqual(context.editorSelections.map(item => item.id), [1]);
    assert.equal(context.selectEditorAsset(3, 0, false), true);
    assert.deepEqual(Array.from(context.editorSelections, item => item.id), [3]);
});

test('right click cancels a selected asset or placement before opening a context menu', () => {
    const calls = [];
    const window = {
        isGM: true, locationEditMode: true, locationEditorTool: 'assets',
        cancelLocationAssetPlacement() { calls.push('placement'); },
    };
    const context = vm.createContext({
        window, selectedLocationAsset: { id: 'tree' },
        editorSelections: [{ kind: 'structure', id: 1 }],
        clearLocationAssetPreset() { calls.push('preset fallback'); },
        clearEditorSelection() { calls.push('selection'); },
        updateBuildPreview() { calls.push('preview'); },
    });
    vm.runInContext(section('function cancelLocationEditorContextAction(',
        'function updateEditorSelectionVisual('), context);
    assert.equal(context.cancelLocationEditorContextAction(), true);
    assert.deepEqual(calls, ['placement']);
    window.locationEditorTool = 'select';
    assert.equal(context.cancelLocationEditorContextAction(), true);
    assert.deepEqual(calls, ['placement', 'selection', 'preview']);
    context.editorSelections = [];
    assert.equal(context.cancelLocationEditorContextAction(), false);
    window.locationEditMode = false;
    context.editorSelections = [{ kind: 'structure', id: 1 }];
    assert.equal(context.cancelLocationEditorContextAction(), false);
    assert.match(scene, /if \(cancelLocationEditorContextAction\(\)\) return;/);
    assert.match(main, /window\.cancelLocationAssetPlacement = \(\) => \{\s*activeAsset = null;\s*clearLocationAssetPreset\(\);\s*renderAssetCards\(\);\s*renderPlacementSettings\(\);/);
});

test('canceling placement clears the structure ghost and does not recreate a cube on hover', () => {
    let clears = 0;
    let adds = 0;
    const context = vm.createContext({
        window: { locationEditMode: true, locationEditorTool: 'assets' },
        selectedLocationAsset: { id: 'crate', kind: 'structure' },
        buildMode: 'structure', brushObjectMode: true,
        buildPreviewMesh: null, buildPreviewKey: null,
        scene: { add() { adds++; } }, hoveredTileCoords: { x: 2, z: 3 },
        editorRotateMode: false, editorMoveMode: false, editorResizeMode: false,
        editorSelections: [], editorMovePreviewPoint: null,
        editorRotateAngle: 0, editorResizeAxis: 'all', editorResizeDimensions: null,
        structureWidth: 1, structureDepth: 1, structureHeight: 1,
        structureColor: '#ffffff', structureRotation: 0,
        getSelectedEditorSource: () => null,
        clearBuildPreview() { clears++; },
    });
    vm.runInContext(section('export function clearLocationAssetPreset()',
        'export function beginMoveSelectedLocationAsset()'), context);
    context.clearLocationAssetPreset();
    assert.equal(context.selectedLocationAsset, null);
    assert.equal(context.buildMode, 'terrain');
    assert.equal(context.brushObjectMode, false);
    assert.equal(clears, 1);

    // Even a stale build mode must not resurrect the generic structure preview.
    context.buildMode = 'structure';
    vm.runInContext(section('function updateBuildPreview()', 'async function placeStructureAtTile('), context);
    context.updateBuildPreview();
    assert.equal(adds, 0);
    assert.equal(clears, 2);
});

test('group move preserves two decor objects originally sharing a tile', async () => {
    const tiles = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ objects: [] })));
    const first = { type: 'anomaly', x: 0, z: 0, scale: 1.5 };
    const second = { type: 'rock', x: 0.1, z: 0 };
    tiles[1][1].objects.push(first, second);
    const selections = [0, 1].map(index => ({ kind: 'decor', x: 1, z: 1, index }));
    const savedDetails = [];
    let context;
    context = vm.createContext({
        editorSelection: selections[1], editorSelections: selections,
        editorMoveMode: true, editorMovePreviewPoint: null,
        editorSelectionRing: { position: { set() {} } },
        currentLocationData: { tiles_data: tiles, grid_width: 5, grid_height: 5 },
        getEditorSource: selection => tiles[selection.z][selection.x].objects[selection.index],
        getSelectedEditorSource() { return tiles[context.editorSelection.z][context.editorSelection.x].objects[context.editorSelection.index]; },
        getSelectedLocationEditorAsset() {
            const selection = context.editorSelection;
            const source = tiles[selection.z][selection.x].objects[selection.index];
            return { kind: 'decor', x: selection.x + 0.5 + source.x, z: selection.z + 0.5 + source.z,
                rotation: 0, elevation: 0, dimensions: { width: 1, depth: 1, height: 1 }, resizable: true };
        },
        async updateSelectedLocationAssetDetails(details) {
            savedDetails.push(details);
            const selection = context.editorSelection;
            const source = tiles[selection.z][selection.x].objects.splice(selection.index, 1)[0];
            const nextX = Math.floor(details.x);
            const nextZ = Math.floor(details.z);
            source.x = details.x - nextX - 0.5;
            source.z = details.z - nextZ - 0.5;
            tiles[nextZ][nextX].objects.push(source);
            context.editorSelection = { kind: 'decor', x: nextX, z: nextZ, index: tiles[nextZ][nextX].objects.length - 1 };
            return true;
        },
        updateEditorSelectionVisual() {}, notifyEditorSelection() {}, updateBuildPreview() {},
        showNotification(message) { throw new Error(message); },
    });
    vm.runInContext(section('async function updateSelectedLocationAssetGroup(', 'export async function updateSelectedLocationAssetDetails('), context);
    vm.runInContext(section('async function commitEditorAssetMove(', 'async function placeSelectedLocationAsset('), context);
    await context.commitEditorAssetMove(3.6, 3.5);
    assert.equal(tiles[1][1].objects.length, 0);
    assert.deepEqual(tiles[3][3].objects, [first, second]);
    assert.equal(first.x, 0);
    assert.ok(Math.abs(second.x - 0.1) < 0.00001);
    assert.equal(first.scale, 1.5);
    assert.ok(savedDetails.every(details => !Object.hasOwn(details, 'dimensions')));
});

test('anomaly accepts dimensions and keeps them on its tile', async () => {
    const tiles = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ objects: [] })));
    const anomaly = { type: 'anomaly', anomalyKey: 'test', scale: 1.5, rotation: 0 };
    tiles[1][1].objects.push(anomaly);
    let selection = { kind: 'decor', x: 1, z: 1, index: 0 };
    let sent = 0;
    const context = vm.createContext({
        editorSelection: selection, editorSelections: [selection],
        currentLocationData: { grid_width: 3, grid_height: 3, tiles_data: tiles },
        getSelectedEditorSource: () => anomaly,
        validAssetDimensions: value => value.width > 0 && value.depth > 0 && value.height > 0,
        clampAssetElevation: value => Number(value) || 0,
        sendDecorTileUpdates() { sent++; },
        showNotification(message) { throw new Error(message); },
    });
    vm.runInContext(section('export async function updateSelectedLocationAssetDetails(',
        'export function previewSelectedLocationLamp('), context);
    const dimensions = { width: 2, depth: 3, height: 4 };
    assert.equal(await context.updateSelectedLocationAssetDetails({
        x: 1.5, z: 1.5, rotation: 0, dimensions,
    }), true);
    assert.deepEqual({ ...anomaly.dimensions }, dimensions);
    assert.equal(anomaly.scale, 1);
    assert.equal(sent, 1);
    assert.equal(tiles[1][1].objects[0], anomaly);

    const source = scene.slice(scene.indexOf('function createEditorGroupMovePreview()'),
        scene.indexOf('function updateBuildPreview()'));
    assert.match(source, /applyDecorSize\(mesh, source, type\)/);
    assert.match(scene, /applyDecorSize\(buildPreviewMesh, decorPreview, decorType\)/);
    assert.match(scene, /applyDecorSize\(mesh, obj, obj\.type\)/);
    assert.match(scene, /resizable: true,\s*\};\s*\}\s*export function getSelectedLocationEditorAsset/);
});

test('anomaly visual size supports legacy scale and independent dimensions', () => {
    const dimensionSource = fs.readFileSync(path.join(__dirname,
        '../app/static/js/locationAssetDimensions.js'), 'utf8');
    const context = vm.createContext({
        findLocationAsset: () => null,
        baseAssetDimensions: () => ({ width: 1, depth: 1, height: 1 }),
    });
    vm.runInContext(dimensionSource.replace(/^import[^\n]*\n/, '').replaceAll('export ', ''), context);
    vm.runInContext(section('function applyDecorSize(', 'function createEditorLampPreview('), context);
    const mesh = { scale: { set(width, height, depth) { this.width = width; this.height = height; this.depth = depth; } } };
    context.applyDecorSize(mesh, { type: 'anomaly', scale: 1.5 }, 'anomaly');
    assert.deepEqual([mesh.scale.width, mesh.scale.height, mesh.scale.depth], [1.5, 1.5, 1.5]);
    context.applyDecorSize(mesh, { type: 'anomaly', dimensions: { width: 2, depth: 3, height: 4 } }, 'anomaly');
    assert.deepEqual([mesh.scale.width, mesh.scale.height, mesh.scale.depth], [2, 4, 3]);
});

test('hide toggles mixed structure, decor and lamp selections together', async () => {
    const structure = { id: 7, properties: {} };
    const decor = { type: 'rock' };
    const lamp = { kind: 'point', x: 2.5, z: 2.5 };
    const selections = [
        { kind: 'structure', id: 7 },
        { kind: 'decor', x: 1, z: 1, index: 0 },
        { kind: 'lamp', index: 0 },
    ];
    const tiles = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ objects: [] })));
    tiles[1][1].objects.push(decor);
    const location = { lighting: { local_lights: [lamp] }, tiles_data: tiles };
    const context = vm.createContext({
        editorSelections: selections, currentLocationData: location,
        getEditorSource(selection) {
            if (selection.kind === 'structure') return structure;
            if (selection.kind === 'lamp') return location.lighting.local_lights[selection.index];
            return tiles[selection.z][selection.x].objects[selection.index];
        },
        window: { currentLobbyId: 1 },
        Server: { async updateLocationObject(_lobbyId, _id, changes) {
            return { ...structure, properties: { ...structure.properties, ...changes.properties } };
        } },
        updateLocationObject(updated) { structure.properties = updated.properties; },
        async persistLocationLights(lights) { location.lighting.local_lights = lights; return true; },
        sendDecorTileUpdates() {}, applyFogOfWar() {}, notifyEditorSelection() {},
        showNotification(message) { throw new Error(message); },
    });
    vm.runInContext(section('export async function toggleSelectedLocationAssetsHidden()', 'async function updateSelectedLocationAssetGroup('), context);
    await context.toggleSelectedLocationAssetsHidden();
    assert.equal(structure.properties.gm_hidden, true);
    assert.equal(decor.gm_hidden, true);
    assert.equal(location.lighting.local_lights[0].gm_hidden, true);
    await context.toggleSelectedLocationAssetsHidden();
    assert.equal(structure.properties.gm_hidden, false);
    assert.equal(decor.gm_hidden, false);
    assert.equal(location.lighting.local_lights[0].gm_hidden, false);
});

test('group move creates a separate ghost for every selected asset type', () => {
    const selections = [
        { kind: 'structure', id: 1 },
        { kind: 'decor', x: 2, z: 3, index: 0 },
        { kind: 'lamp', index: 0 },
    ];
    const sources = [
        { type: 'wall', tile_x: 1, tile_y: 1 },
        { type: 'rock', x: 0.1, z: 0.2, elevation: 0 },
        { kind: 'point', x: 4.5, z: 2.5, height: 2 },
    ];
    const makeMesh = () => ({
        position: { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } },
        rotation: { y: 0 }, userData: {},
    });
    const lamps = [];
    const context = vm.createContext({
        editorSelections: selections,
        getEditorSource: selection => sources[selections.indexOf(selection)],
        THREE: {
            Group: class { constructor() { this.children = []; } add(mesh) { this.children.push(mesh); } },
            MathUtils: { degToRad: angle => angle * Math.PI / 180 },
        },
        createLocationObjectMesh() {
            const mesh = makeMesh();
            mesh.position.set(1.5, 1, 1.5);
            return mesh;
        },
        createEditorDecorPreview: () => makeMesh(),
        createEditorLampPreview(source, includeLight) {
            lamps.push({ source, includeLight });
            return makeMesh();
        },
        applyDecorSize() {}, getTileHeight: () => 1,
        clampAssetElevation: value => Number(value) || 0,
        fadeEditorPreview: group => group,
    });
    vm.runInContext(section('function createEditorGroupMovePreview()', 'function updateBuildPreview()'), context);
    const group = context.createEditorGroupMovePreview();
    assert.equal(group.children.length, 3);
    assert.deepEqual(Array.from(group.children, mesh => mesh.position.x), [1.5, 2.6, 4.5]);
    assert.equal(lamps[0].includeLight, false);
});

test('group ghost geometry is reused while cursor moves', () => {
    let context;
    let builds = 0;
    let adds = 0;
    const ghost = {
        position: { x: 0, z: 0, set(x, _y, z) { this.x = x; this.z = z; } },
        children: [{
            position: { y: 1 },
            userData: { editorMoveOrigin: { x: 1.5, z: 1.5, groundOffset: 0.25 } },
        }],
    };
    context = vm.createContext({
        window: { locationEditMode: true, locationEditorTool: 'select' },
        scene: { add() { adds++; } }, hoveredTileCoords: { x: 2, z: 2 },
        editorRotateMode: false, editorMoveMode: true,
        editorSelections: [{ kind: 'decor', x: 1, z: 1, index: 0 }, { kind: 'lamp', index: 0 }],
        editorMovePreviewPoint: { x: 2.5, z: 2.5 },
        buildPreviewMesh: null, buildPreviewKey: null,
        currentLocationData: { grid_width: 10, grid_height: 10 },
        clearBuildPreview() { context.buildPreviewMesh = null; context.buildPreviewKey = null; },
        createEditorGroupMovePreview() { builds++; return ghost; },
        getSelectedLocationEditorAsset: () => ({ x: 1.5, z: 1.5 }),
        getTileHeight: (x, z) => x + z,
    });
    vm.runInContext(section('function updateBuildPreview()', 'async function placeStructureAtTile('), context);
    context.updateBuildPreview();
    context.editorMovePreviewPoint = { x: 3.5, z: 2.5 };
    context.updateBuildPreview();
    assert.equal(builds, 1);
    assert.equal(adds, 1);
    assert.equal(ghost.position.x, 2);
    assert.equal(ghost.children[0].position.y, 5.25);
});

test('group rotation uses a common pivot and keeps directional rotations', async () => {
    const transforms = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetTransforms.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(transforms).toString('base64')}`;
    const { rotatePointAround } = await import(url);
    const rotated = rotatePointAround(3, 2, 2, 2, 90);
    assert.ok(Math.abs(rotated.x - 2) < 0.00001);
    assert.ok(Math.abs(rotated.z - 3) < 0.00001);
    const assets = [
        { kind: 'structure', x: 3, z: 2, rotation: 10 },
        { kind: 'decor', x: 2, z: 3, rotation: 350 },
        { kind: 'lamp', lightKind: 'point', x: 1, z: 2, rotation: 0 },
        { kind: 'lamp', lightKind: 'spot', x: 2, z: 1, rotation: 45 },
    ];
    let saved;
    const context = vm.createContext({
        editorGroupRotatePivot: { x: 2, z: 2 }, editorRotateAngle: 90,
        editorRotateMode: true, editorGroupRotateStartBearing: 0, editorGroupRotateWithPivot: true,
        currentLocationData: { grid_width: 10, grid_height: 10 },
        rotatePointAround,
        async updateSelectedLocationAssetGroup(transform) {
            saved = assets.map(transform);
            return saved.every(Boolean);
        },
        updateBuildPreview() {},
    });
    vm.runInContext(section('async function commitEditorAssetRotation()', 'async function commitEditorAssetMove('), context);
    await context.commitEditorAssetRotation();
    assert.ok(Math.abs(saved[0].x - 2) < 0.00001);
    assert.ok(Math.abs(saved[0].z - 3) < 0.00001);
    assert.deepEqual(Array.from(saved, item => item.rotation), [100, 80, 0, 135]);
    assert.equal(context.editorRotateMode, false);
    assert.equal(context.editorGroupRotatePivot, null);
});

test('group rotation refuses to move any object outside the map', async () => {
    const transforms = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetTransforms.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(transforms).toString('base64')}`;
    const { rotatePointAround } = await import(url);
    const context = vm.createContext({
        editorGroupRotatePivot: { x: 0.5, z: 0.5 }, editorRotateAngle: 180,
        editorRotateMode: true, editorGroupRotateWithPivot: true,
        currentLocationData: { grid_width: 10, grid_height: 10 },
        rotatePointAround,
        async updateSelectedLocationAssetGroup(transform) {
            return Boolean(transform({ kind: 'decor', x: 1.5, z: 0.5, rotation: 0 }));
        },
        updateBuildPreview() {},
    });
    vm.runInContext(section('async function commitEditorAssetRotation()', 'async function commitEditorAssetMove('), context);
    await context.commitEditorAssetRotation();
    assert.equal(context.editorRotateMode, true);
});

test('group rotation without Ctrl turns every object in place', () => {
    const assets = [
        { kind: 'structure', x: 3, z: 2, rotation: 10 },
        { kind: 'decor', x: 2, z: 3, rotation: 350 },
        { kind: 'lamp', lightKind: 'point', x: 1, z: 2, rotation: 0 },
        { kind: 'lamp', lightKind: 'spot', x: 2, z: 1, rotation: 45 },
    ];
    let saved;
    const context = vm.createContext({
        editorGroupRotatePivot: { x: 2, z: 2 }, editorRotateAngle: 90,
        editorGroupRotateWithPivot: false, editorRotateMode: true,
        currentLocationData: { grid_width: 10, grid_height: 10 },
        rotatePointAround() { throw new Error('positions must not rotate without Ctrl'); },
        async updateSelectedLocationAssetGroup(transform) {
            saved = assets.map(transform);
            return saved.every(Boolean);
        },
        updateBuildPreview() {},
    });
    vm.runInContext(section('async function commitEditorAssetRotation()', 'async function commitEditorAssetMove('), context);
    return context.commitEditorAssetRotation().then(() => {
        assert.deepEqual(Array.from(saved, item => [item.x, item.z]), assets.map(item => [item.x, item.z]));
        assert.deepEqual(Array.from(saved, item => item.rotation), [100, 80, 0, 135]);
        assert.equal(context.editorRotateMode, false);
    });
});

test('group rotation preview includes every ghost even when the last selection is a lamp', async () => {
    const transforms = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetTransforms.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(transforms).toString('base64')}`;
    const { rotatePointAround, bearingToObjectRotation } = await import(url);
    const makePosition = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } });
    const first = { position: makePosition(), rotation: { y: 0 },
        userData: { editorMoveOrigin: { x: 3, z: 2, groundOffset: 0.25, rotation: 0 } } };
    const second = { position: makePosition(), rotation: { y: 0 },
        userData: { editorMoveOrigin: { x: 1, z: 2, groundOffset: 2, rotation: 0 } } };
    const ghost = { children: [first, second], add(child) { this.children.push(child); } };
    let context;
    let builds = 0;
    context = vm.createContext({
        editorRotateMode: true, editorSelection: { kind: 'lamp', index: 0 },
        editorSelections: [{ kind: 'structure', id: 1 }, { kind: 'lamp', index: 0 }],
        editorGroupRotatePivot: { x: 2, z: 2 }, editorRotateAngle: 90, editorGroupRotateWithPivot: true,
        editorMoveMode: false, hoveredTileCoords: { x: 2, z: 2 },
        window: { locationEditMode: true, locationEditorTool: 'select' },
        scene: { add() {} }, currentLocationData: { grid_width: 10, grid_height: 10 },
        buildPreviewMesh: null, buildPreviewKey: null,
        clearBuildPreview() { context.buildPreviewMesh = null; context.buildPreviewKey = null; },
        createEditorGroupMovePreview() { builds++; return ghost; },
        THREE: {
            DoubleSide: 2,
            RingGeometry: class {}, MeshBasicMaterial: class {},
            Mesh: class { constructor() { this.position = makePosition(); this.rotation = { x: 0 }; this.userData = {}; } },
        },
        getTileHeight: (x, z) => x + z,
        rotatePointAround, bearingToObjectRotation,
    });
    vm.runInContext(section('function updateBuildPreview()', 'async function placeStructureAtTile('), context);
    context.updateBuildPreview();
    assert.equal(builds, 1);
    assert.ok(Math.abs(first.position.x - 2) < 0.00001);
    assert.ok(Math.abs(first.position.z - 3) < 0.00001);
    assert.ok(Math.abs(second.position.x - 2) < 0.00001);
    assert.ok(Math.abs(second.position.z - 1) < 0.00001);
    assert.equal(first.position.y, 5.25);
    assert.equal(first.rotation.y, -Math.PI / 2);
    assert.equal(ghost.children.length, 3);
    context.editorRotateAngle = 180;
    context.updateBuildPreview();
    assert.equal(builds, 1);
    context.editorGroupRotateWithPivot = false;
    context.updateBuildPreview();
    assert.deepEqual([first.position.x, first.position.z], [3, 2]);
    assert.deepEqual([second.position.x, second.position.z], [1, 2]);
    assert.equal(first.rotation.y, -Math.PI);
    context.editorGroupRotateWithPivot = true;
    context.updateBuildPreview();
    assert.equal(builds, 1);
    assert.ok(Math.abs(first.position.x - 1) < 0.00001);
    assert.ok(Math.abs(first.position.z - 2) < 0.00001);
});

test('group rotation starts without a jump and snaps the delta with Shift', () => {
    let point = { x: 3, z: 2 };
    let previews = 0;
    const context = vm.createContext({
        editorRotateMode: true, editorSelection: { kind: 'structure', id: 1 },
        editorGroupRotatePivot: { x: 2, z: 2 },
        editorGroupRotateStartBearing: null, editorGroupRotateWithPivot: false, editorRotateAngle: 0,
        getPointerWorldPoint: () => point,
        getTileHeight: () => 1,
        bearingFromDelta: (x, z) => Math.round(Math.atan2(z, x) * 180 / Math.PI),
        updateBuildPreview() { previews++; },
    });
    vm.runInContext(section('function updateEditorRotatePreview(', 'function updateEditorResizePreview('), context);
    context.updateEditorRotatePreview(0, 0);
    assert.equal(context.editorRotateAngle, 0);
    assert.equal(previews, 0);
    point = { x: 1.8, z: 3 };
    context.updateEditorRotatePreview(0, 0, true);
    assert.equal(context.editorRotateAngle, 105);
    assert.equal(previews, 1);
    context.updateEditorRotatePreview(0, 0, true, true);
    assert.equal(context.editorRotateAngle, 105);
    assert.equal(context.editorGroupRotateWithPivot, true);
    assert.equal(previews, 2);
    context.updateEditorRotatePreview(0, 0, true, false);
    assert.equal(previews, 3);
    assert.equal(context.editorGroupRotateWithPivot, false);
    assert.match(scene, /updateEditorRotatePreview\(e\.clientX, e\.clientY, e\.shiftKey, e\.ctrlKey\)/);
});

test('GM controls and visual-only lamp fixtures remain wired', () => {
    assert.match(main, /data-asset-action="hide"/);
    assert.match(main, /toggleSelectedLocationAssetsHidden\(\)/);
    assert.match(scene, /bulb\.visible = Boolean\(window\.isGM && \(editMode \|\| source\.gm_hidden\)\)/);
    assert.match(scene, /picker\.visible = Boolean\(window\.isGM && editMode\)/);
    assert.match(scene, /if \(e\.code === 'KeyH'\) toggleSelectedLocationAssetsHidden\(\)/);
    assert.match(scene, /else if \(e\.code === 'Delete'\) deleteSelectedLocationAsset\(\)/);
    assert.match(scene, /const scaleUp = [^;]*e\.code === 'Equal'[^;]*e\.key === '=';/);
    assert.match(main, /\+ \/ = \/ −: масштаб всех осей/);
});
