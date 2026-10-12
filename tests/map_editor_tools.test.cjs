const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '../app/static/js', file), 'utf8');

test('world editor tool selection keeps eraser and toolbar state in sync', () => {
    const source = read('mapEdit.js');
    const start = source.indexOf('export function selectWorldEditorTool(');
    const end = source.indexOf('\nexport function selectWorldObject(', start);
    assert.ok(start >= 0 && end > start);
    const buttons = ['select', 'terrain', 'height', 'erase', 'objects'].map(tool => ({
        dataset: { worldTool: tool },
        setAttribute(name, value) { this[name] = value; },
    }));
    const root = { dataset: {}, querySelectorAll() { return buttons; } };
    const eraser = { checked: false };
    const hint = { textContent: '' };
    const state = { eraserMode: false, setEraserMode(value) { this.eraserMode = value; } };
    const expansions = [];
    const context = vm.createContext({
        document: { getElementById(id) { return { 'gm-only-controls': root, 'eraser-checkbox': eraser, 'world-editor-hint': hint }[id]; } },
        AppState: state, window: {}, roadLinkActive: false,
        getHoveredTile() { return null; }, updateWorldObjectPreview() {}, removePreviewObject() {},
        expandMapToolsPanelOnToolChange(previous, next) { expansions.push([previous, next]); },
    });
    vm.runInContext(source.slice(start, end).replace('export function', 'function'), context);
    context.selectWorldEditorTool('erase');
    assert.equal(context.window.worldEditorTool, 'erase');
    assert.equal(state.eraserMode, true);
    assert.equal(eraser.checked, true);
    assert.equal(buttons[3]['aria-pressed'], 'true');
    context.selectWorldEditorTool('terrain');
    assert.equal(context.window.worldEditorTool, 'terrain');
    assert.equal(state.eraserMode, false);
    assert.equal(buttons[1]['aria-pressed'], 'true');
    assert.deepEqual(expansions, [[undefined, 'erase'], ['erase', 'terrain']]);
    context.selectWorldEditorTool('select', { autoExpand: false });
    assert.equal(expansions.length, 2);
    context.selectWorldEditorTool('objects', { autoExpand: false });
    assert.equal(buttons[4]['aria-pressed'], 'true');
    context.selectWorldEditorTool('unknown');
    assert.equal(context.window.worldEditorTool, 'objects');
});

test('editor panel expands only for a new tool when the preference is enabled', () => {
    const source = read('ui_interactions.js');
    const start = source.indexOf('function savePanelState(');
    const end = source.indexOf('function makeDraggable(', start);
    assert.ok(start >= 0 && end > start);
    const values = new Map();
    const checkbox = { checked: false };
    const toggle = { textContent: '▶' };
    const panel = {
        classList: {
            collapsed: true,
            contains(name) { return name === 'collapsed' && this.collapsed; },
            add(name) { if (name === 'collapsed') this.collapsed = true; },
            remove(name) { if (name === 'collapsed') this.collapsed = false; },
        },
        querySelector() { return toggle; },
    };
    const context = vm.createContext({
        localStorage: {
            getItem(key) { return values.get(key) ?? null; },
            setItem(key, value) { values.set(key, value); },
        },
        document: {
            querySelectorAll() { return [checkbox]; },
            getElementById(id) { return id === 'panel-tools' ? panel : null; },
        },
    });
    vm.runInContext(source.slice(start, end).replaceAll('export function', 'function'), context);
    assert.equal(context.isMapEditorAutoExpandEnabled(), true);
    context.syncMapEditorAutoExpandCheckbox();
    assert.equal(checkbox.checked, true);

    context.expandMapToolsPanelOnToolChange(undefined, 'select');
    context.expandMapToolsPanelOnToolChange('select', 'select');
    assert.equal(panel.classList.collapsed, true);
    context.setMapEditorAutoExpandEnabled(false);
    assert.equal(checkbox.checked, false);
    context.expandMapToolsPanelOnToolChange('select', 'terrain');
    assert.equal(panel.classList.collapsed, true);
    context.setMapEditorAutoExpandEnabled(true);
    context.expandMapToolsPanelOnToolChange('select', 'terrain');
    assert.equal(panel.classList.collapsed, false);
    assert.equal(toggle.textContent, '▼');
    assert.equal(JSON.parse(values.get('panelStates'))['panel-tools'].collapsed, false);
    context.collapseMapToolsPanel();
    assert.equal(panel.classList.collapsed, true);
    assert.equal(JSON.parse(values.get('panelStates'))['panel-tools'].collapsed, true);

    const main = read('main.js');
    assert.match(main, /if \(!newMode\) collapseMapToolsPanel\(\)/);
    assert.match(main, /if \(!getEditMode\(\)\) collapseMapToolsPanel\(\)/);
    assert.match(source, /if \(AppState\.isGM\) window\.toggleEditMode\(\)/);
    assert.match(main, /select: createToolSection\('Выбор', \[\]\)/);
    assert.match(main, /expandMapToolsPanelOnToolChange\(previousTool, tool\)/);
    assert.match(main, /selectWorldEditorTool\('select', \{ autoExpand: false \}\)/);
    assert.match(fs.readFileSync(path.join(__dirname, '../app/templates/lobby.html'), 'utf8'), /data-world-settings="select"[\s\S]*?data-map-editor-auto-expand/);
});

test('location brush uses only the active tool, regardless of Alt and Shift', () => {
    const source = read('locationScene.js');
    const start = source.indexOf('function getEditBrushUpdates(');
    const end = source.indexOf('\nexport function setupLocationEditing()', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({
        window: { locationEditorTool: 'select' }, eraserMode: false,
        brushRadiation: 4, currentBrushTerrain: 'sand', currentBrushHeight: 2,
    });
    vm.runInContext(source.slice(start, end), context);
    const updates = event => JSON.parse(JSON.stringify(context.getEditBrushUpdates(event)));
    assert.deepEqual(updates({}), {});
    context.window.locationEditorTool = 'terrain';
    assert.deepEqual(updates({}), { terrain: 'sand' });
    assert.deepEqual(updates({ shiftKey: true }), { terrain: 'sand' });
    context.window.locationEditorTool = 'height';
    assert.deepEqual(updates({}), { height: 2 });
    assert.deepEqual(updates({ altKey: true }), { height: 2 });
    context.window.locationEditorTool = 'radiation';
    assert.deepEqual(updates({}), { radiation: 4 });
    context.window.locationEditorTool = 'decor';
    assert.deepEqual(updates({}), { addObject: true });
    context.window.locationEditorTool = 'erase';
    assert.deepEqual(updates({}), { objects: [] });
    context.window.locationEditorTool = 'select';
    assert.deepEqual(updates({ altKey: true }), {});
    assert.deepEqual(updates({ shiftKey: true }), {});
});

test('world brush paints on pointer press without waiting for the window click', () => {
    const source = read('lobby3d.js');
    const start = source.indexOf('function canvasMouseDownHandler(');
    const end = source.indexOf("\nrenderer.domElement.addEventListener('pointerdown'", start);
    assert.ok(start >= 0 && end > start);
    assert.match(source, /renderer\.domElement\.addEventListener\('pointerdown', canvasMouseDownHandler/);
    assert.match(source, /raycaster\.ray\.intersectPlane\(worldBrushPlane/);
    const painted = [];
    const tile = { chunk: { chunkX: 1, chunkY: 2 }, tileX: 3, tileY: 4, tileData: { terrain: 'grass' } };
    const context = vm.createContext({
        window: { isLocationActive: false, worldEditorTool: 'terrain', tileClickCallback({ tile: target }) { painted.push(target); } },
        document: { addEventListener() {} },
        controls: { enabled: true }, controlsDisabled: false,
        editMode: true, hoveredTile: tile, brushActive: false,
        lastProcessedTileKey: null, globalMouseUpHandler: null,
        performRaycast() {},
    });
    vm.runInContext(source.slice(start, end), context);
    const event = {
        button: 0, altKey: false, shiftKey: false, clientX: 20, clientY: 30,
        target: { closest() { return null; } },
        preventDefault() {}, stopImmediatePropagation() {},
    };
    context.canvasMouseDownHandler(event);
    assert.equal(painted.length, 1);
    assert.equal(context.brushActive, true);
    assert.equal(context.lastProcessedTileKey, '1,2,3,4');

    context.window.worldEditorTool = 'select';
    context.brushActive = false;
    context.canvasMouseDownHandler(event);
    assert.equal(painted.length, 1);
    context.canvasMouseDownHandler({ ...event, altKey: true });
    context.canvasMouseDownHandler({ ...event, shiftKey: true });
    assert.equal(painted.length, 1);
    context.window.isWorldTravelSelectionActive = () => true;
    context.canvasMouseDownHandler({ ...event, altKey: true });
    assert.equal(painted.length, 1);

    const dragStart = source.indexOf("window.addEventListener('pointermove', (event) => {", end);
    const dragEnd = source.indexOf("window.addEventListener('pointerup'", dragStart);
    assert.doesNotMatch(source.slice(dragStart, dragEnd), /if \(event\.(?:altKey|shiftKey)\)\s*\{\s*updates\./);
    const clickCallback = read('lobbyData.js');
    const callbackStart = clickCallback.indexOf('setTileClickCallback((options) => {');
    const callbackEnd = clickCallback.indexOf('\n            });', callbackStart);
    assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
    assert.doesNotMatch(clickCallback.slice(callbackStart, callbackEnd), /event\.(?:altKey|shiftKey)/);

    const clickStart = source.indexOf("window.addEventListener('click', (event) => {", end);
    const clickEnd = source.indexOf("\nwindow.addEventListener('dblclick'", clickStart);
    assert.doesNotMatch(source.slice(clickStart, clickEnd), /tileClickCallback/);
});

test('world radiation brush updates every tile in its radius', () => {
    const source = read('mapEdit.js');
    const start = source.indexOf('export function applyBrush(');
    const end = source.indexOf('\nexport async function handleTileUpdate(', start);
    assert.ok(start >= 0 && end > start);
    const painted = [];
    const context = vm.createContext({
        document: { getElementById() { return null; } },
        AppState: { isGM: true },
        window: { MAP_CHUNKS_WIDTH: 1, MAP_CHUNKS_HEIGHT: 1 },
        updateTileInChunk(...args) { painted.push(args); },
        scheduleBatchUpdate() {},
        showNotification(message) { throw new Error(message); },
    });
    vm.runInContext(
        'const CHUNK_SIZE = 32; let pendingTileUpdates = [];\n'
            + source.slice(start, end).replace('export function', 'function'),
        context,
    );
    context.applyBrush({ chunkX: 0, chunkY: 0, tileX: 8, tileY: 8 }, { radiation: 4.5 }, 1);
    assert.equal(painted.length, 9);
    assert.equal(painted.every(call => call[4].radiation === 4.5), true);
});

test('world brush batch sends each tile once with its latest fields', () => {
    const source = read('mapEdit.js');
    const start = source.indexOf('function scheduleBatchUpdate()');
    const end = source.indexOf('\nexport function applyBrush(', start);
    assert.ok(start >= 0 && end > start);
    const sent = [];
    const context = vm.createContext({
        pendingTileUpdates: [
            { chunk_x: 0, chunk_y: 0, tile_x: 2, tile_y: 3, updates: { terrain: 'sand', height: 2 } },
            { chunk_x: 0, chunk_y: 0, tile_x: 4, tile_y: 3, updates: { height: 3 } },
            { chunk_x: 0, chunk_y: 0, tile_x: 2, tile_y: 3, updates: { height: 5 } },
        ],
        batchUpdateTimeout: null,
        currentLobbyId: 7,
        setTimeout(callback) { callback(); return 1; },
        clearTimeout() {},
        Server: { batchUpdateTiles(lobbyId, updates) {
            sent.push({ lobbyId, updates });
            return Promise.resolve();
        } },
        showNotification(message) { throw new Error(message); },
    });
    vm.runInContext(source.slice(start, end), context);
    context.scheduleBatchUpdate();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].lobbyId, 7);
    assert.equal(sent[0].updates.length, 2);
    assert.equal(sent[0].updates[0].updates.terrain, 'sand');
    assert.equal(sent[0].updates[0].updates.height, 5);
    assert.equal(context.pendingTileUpdates.length, 0);
});

test('world object tool places once at the pointer without replacing other tile objects', async () => {
    const source = read('mapEdit.js');
    const start = source.indexOf('export async function placeWorldObjectAtTile(');
    const end = source.indexOf('\nwindow.updateWorldObjectPreview', start);
    assert.ok(start >= 0 && end > start);
    const updates = [];
    const notifications = [];
    const context = vm.createContext({
        AppState: { isGM: true, editMode: true },
        window: { worldEditorTool: 'objects' },
        placingObjectTiles: new Set(), lastPlacedObjectKey: null, lastPlacedObjectAt: 0,
        roadLinkActive: false,
        CHUNK_SIZE: 32,
        worldObjectSettings() { return { type: 'tree', color: '#2d5a27', scale: 1, rotation: 0 }; },
        async handleTileUpdate(...args) { updates.push(args); return true; },
        showNotification(message) { notifications.push(message); },
    });
    vm.runInContext(source.slice(start, end).replace('export async function', 'async function'), context);
    const original = { type: 'base', color: '#66747b' };
    const tile = { chunkX: 0, chunkY: 0, tileX: 2, tileY: 3,
        pointX: 2.7, pointZ: 3.4, tileData: { terrain: 'grass', objects: [original] } };
    assert.equal(await context.placeWorldObjectAtTile(tile), true);
    assert.equal(updates.length, 1);
    const objects = updates[0][4].objects;
    assert.equal(objects.length, 2);
    assert.equal(objects[0], original);
    assert.equal(objects[1].type, 'tree');
    assert.ok(Math.abs(objects[1].x - 0.2) < 1e-9);
    assert.ok(Math.abs(objects[1].z + 0.1) < 1e-9);
    assert.equal(await context.placeWorldObjectAtTile(tile), false);
    assert.equal(updates.length, 1);
    assert.equal(await context.placeWorldObjectAtTile({ ...tile, tileData: { terrain: 'water' } }), false);
    assert.equal(notifications.length, 1);
    assert.match(read('lobbyData.js'), /worldEditorTool === 'objects'[\s\S]*?placeWorldObjectAtTile/);
});

test('road connector links two existing adjacent roads without placing a third object', async () => {
    const source = read('mapEdit.js');
    const start = source.indexOf('function updateWorldRoadLinkStatus(');
    const end = source.indexOf('\nfunction worldObjectSettings(', start);
    assert.ok(start >= 0 && end > start);
    const updates = [];
    const calls = [];
    const labels = {
        'world-road-link-button': { setAttribute(name, value) { this[name] = value; } },
        'world-road-link-status': { textContent: '' },
    };
    const context = vm.createContext({
        roadLinkActive: false, roadLinkFirst: null, roadLinkSaving: false,
        CHUNK_SIZE: 32, currentLobbyId: 7,
        document: { getElementById(id) { return labels[id]; } },
        getHoveredTile() { return null; }, updateWorldObjectPreview() {},
        showNotification() {}, updateTileInChunk(...args) { updates.push(args); },
        Server: { async connectWorldRoads(...args) {
            calls.push(args);
            return { updates: [
                { chunk_x: 0, chunk_y: 0, tile_x: 31, tile_y: 5, updates: { objects: [{ type: 'road' }] } },
                { chunk_x: 1, chunk_y: 0, tile_x: 0, tile_y: 5, updates: { objects: [{ type: 'road' }] } },
            ] };
        } },
    });
    vm.runInContext(source.slice(start, end).replace('export function toggleWorldRoadLink', 'function toggleWorldRoadLink'), context);
    context.toggleWorldRoadLink(true);
    const tile = (chunkX, tileX, tileY, type = 'road') => ({ chunkX, chunkY: 0, tileX, tileY,
        tileData: { objects: [{ type }] } });
    assert.equal(await context.connectRoadAtTile(tile(0, 31, 5)), true);
    assert.equal(await context.connectRoadAtTile(tile(1, 0, 7)), false);
    assert.equal(await context.connectRoadAtTile(tile(1, 0, 5, 'tree')), false);
    assert.equal(calls.length, 0);
    assert.equal(await context.connectRoadAtTile(tile(1, 0, 5)), true);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[7, [31, 5], [32, 5]]]);
    assert.equal(updates.length, 2);
    assert.match(labels['world-road-link-status'].textContent, /соединены/);
    assert.equal(labels['world-road-link-button']['aria-pressed'], 'true');
});

test('road connector button is visible in the object tool and selects roads itself', () => {
    const template = fs.readFileSync(path.join(__dirname, '../app/templates/lobby.html'), 'utf8');
    const objectPanel = template.slice(template.indexOf('data-world-settings="objects"'),
        template.indexOf('data-world-settings="brush"'));
    assert.match(objectPanel, /data-world-object="road"[\s\S]*?id="world-road-link-button"/);
    assert.doesNotMatch(objectPanel, /id="world-road-link-controls"[^>]*hidden/);
    assert.match(read('mapEdit.js'), /closest\('#world-road-link-button'\)[\s\S]*?selectWorldObject\('road'\)/);
});

test('world object palette uses compact icon previews for every placeable object', () => {
    const template = fs.readFileSync(path.join(__dirname, '../app/templates/lobby.html'), 'utf8');
    const types = ['tree', 'forest', 'road', 'hamlet', 'village', 'factory', 'base', 'camp', 'house', 'fence'];
    for (const type of types) {
        assert.ok(template.includes(`<symbol id="world-icon-${type}"`));
        assert.match(template, new RegExp(`data-world-object="${type}"[^>]*><svg class="world-object-thumb" viewBox="0 0 48 40"[^>]*><use href="#world-icon-${type}"`));
    }
    const css = fs.readFileSync(path.join(__dirname, '../app/static/style.css'), 'utf8');
    assert.match(css, /\.world-object-palette \{[\s\S]*?grid-template-columns: repeat\(10, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.world-object-palette button \{[\s\S]*?height: 34px/);
});

test('world anomaly fields use a visual matching their field type', () => {
    const source = read('lobby3d.js');
    const start = source.indexOf('function createAnomalyFieldLOD(');
    const end = source.indexOf('\nconst FAR_ANOMALY_DISTANCE_SQ', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({
        createAnomalyLOD(...args) { return { args, userData: {} }; },
    });
    vm.runInContext(source.slice(start, end), context);
    const field = type => context.createAnomalyFieldLOD({
        height: 1,
        anomaly_field: { name: 'Тестовое поле', field_type: type, rank: 2 },
    }, 4, 5);
    assert.equal(field('Электрическое').args[3], 'electric');
    assert.equal(field('Термический').args[3], 'fire');
    assert.equal(field('Химическое').args[3], 'acid');
    assert.equal(field('Радиоактивное').args[3], 'radiation');
    assert.equal(field('Псионическое').args[3], 'psi');
    assert.equal(field('Гравитационное').args[3], 'void');
    assert.equal(field('Гравитационное').userData.anomalyField, 'Тестовое поле');
    assert.equal(context.createAnomalyFieldLOD({ height: 1 }, 4, 5), null);
});

test('new world landmarks are available without deleting legacy map objects', () => {
    const scene = read('lobby3d.js');
    const html = fs.readFileSync(path.join(__dirname, '../app/templates/lobby.html'), 'utf8');
    const mapService = fs.readFileSync(path.join(__dirname, '../app/services/map.py'), 'utf8');
    const options = html.slice(html.indexOf('<select id="object-type-select">'), html.indexOf('</select>', html.indexOf('<select id="object-type-select">')));
    for (const type of ['forest', 'hamlet', 'village', 'road', 'factory', 'base', 'camp']) {
        assert.match(options, new RegExp(`value="${type}"`));
        assert.match(scene, new RegExp(`\\b${type}: \\{ geometry:`));
    }
    for (const legacy of ['tree', 'house', 'fence']) {
        assert.match(options, new RegExp(`value="${legacy}"`));
        assert.match(scene, new RegExp(`case '${legacy}'`));
    }
    assert.match(scene, /fillLandmarkMeshes\(landmarkMeshes, tilesData, cx, cy\)/);
    assert.match(scene, /fillLandmarkMeshes\(\s*landmarkMeshes, tilesData, entry\.chunkX, entry\.chunkY/);
    assert.doesNotMatch(mapService, /'type': '(?:tree|house|fence)'/);
});

test('location eraser removes structures only when its option is enabled', () => {
    const source = read('locationScene.js');
    const start = source.indexOf('function shouldEraseLocationStructures()');
    const end = source.indexOf('\nexport function setupLocationEditing()', start);
    assert.ok(start >= 0 && end > start);
    const checkbox = { checked: false };
    const context = vm.createContext({
        window: { locationEditorTool: 'erase' },
        document: { getElementById() { return checkbox; } },
    });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.shouldEraseLocationStructures(), false);
    checkbox.checked = true;
    assert.equal(context.shouldEraseLocationStructures(), true);
    context.window.locationEditorTool = 'terrain';
    assert.equal(context.shouldEraseLocationStructures(), false);
    assert.equal((source.match(/removeStructuresAtTile\(x, z, brushRadius\)/g) || []).length, 4);
});

test('location eraser deletes each structure in its radius and refreshes once', async () => {
    const source = read('locationScene.js');
    const start = source.indexOf('async function removeStructuresAtTile(');
    const end = source.indexOf('\nexport function setLocationBuildMode(', start);
    assert.ok(start >= 0 && end > start);
    const objects = [
        { id: 1, type: 'campfire', tile_x: 3, tile_y: 3 },
        { id: 2, type: 'wall', tile_x: 4, tile_y: 4 },
        { id: 3, type: 'floor', tile_x: 2, tile_y: 3 },
        { id: 4, type: 'crate', tile_x: 5, tile_y: 3 },
    ];
    const calls = { deleted: [], removed: [], lights: [], fog: 0, architecture: 0, floor: 0 };
    const context = vm.createContext({
        window: { currentLobbyId: 1 }, currentLocationData: { objects },
        getObjectGridPosition: object => ({ x: object.tile_x, y: object.tile_y }),
        structureDeletionInFlight: new Set(),
        Server: { deleteLocationObject: async (_lobby, id) => { calls.deleted.push(id); } },
        removeLocationObjectMesh: (id, refreshFog) => calls.removed.push([id, refreshFog]),
        isFireObject: object => object?.type === 'campfire',
        isObjectLightSource: object => object?.type === 'campfire',
        syncFireObjectLight: (_object, id, refresh) => calls.lights.push([id, refresh]),
        activeLightingProfile: { dark_tiles: [] },
        rebuildGrassDetailMesh: () => { calls.floor++; },
        refreshArchitecturalMeshes: () => { calls.architecture++; calls.fog++; },
        applyFogOfWar: () => { calls.fog++; },
        fogIsActive: () => true,
        invalidateMovementMapCache() {}, showNotification() {},
    });
    vm.runInContext(source.slice(start, end), context);
    await context.removeStructuresAtTile(3, 3, 1);
    assert.deepEqual(calls.deleted.sort(), [1, 2, 3]);
    assert.deepEqual(calls.removed.map(([id]) => id).sort(), [1, 2, 3]);
    assert.ok(calls.removed.every(([, refresh]) => refresh === false));
    assert.deepEqual(calls.lights, [[1, false]]);
    assert.equal(calls.fog, 1);
    assert.equal(calls.architecture, 1);
    assert.equal(calls.floor, 1);
    assert.deepEqual(context.currentLocationData.objects.map(object => object.id), [4]);
});

test('erasing several fire objects batches the darkness refresh', async () => {
    const source = read('locationScene.js');
    const start = source.indexOf('async function removeStructuresAtTile(');
    const end = source.indexOf('\nexport function setLocationBuildMode(', start);
    const objects = [{ id: 1, type: 'campfire', tile_x: 1, tile_y: 1 },
        { id: 2, type: 'torch', tile_x: 2, tile_y: 1 }];
    const calls = { lights: 0, darkness: 0, fog: 0 };
    const context = vm.createContext({
        window: { currentLobbyId: 1 }, currentLocationData: { objects },
        getObjectGridPosition: object => ({ x: object.tile_x, y: object.tile_y }),
        structureDeletionInFlight: new Set(),
        Server: { deleteLocationObject: async () => {} },
        removeLocationObjectMesh() {}, isFireObject: () => true,
        isObjectLightSource: () => true,
        syncFireObjectLight: () => { calls.lights++; },
        activeLightingProfile: { dark_tiles: [{ x: 1, z: 1 }] },
        refreshLocationDarkness: () => { calls.darkness++; },
        applyFogOfWar: () => { calls.fog++; },
        invalidateMovementMapCache() {}, showNotification() {},
    });
    vm.runInContext(source.slice(start, end), context);
    await context.removeStructuresAtTile(1, 1, 1);
    assert.deepEqual(calls, { lights: 2, darkness: 1, fog: 0 });
    assert.equal(context.currentLocationData.objects.length, 0);
});

test('held Q selects the highlighted full-ring sector on release', async () => {
    const source = read('mapEditorQuickMenu.js')
        .replace(/^import \{ isTypingTarget \} from '\.\/cameraPan\.js';\r?\n/, '')
        .replaceAll('export ', '');
    const cameraPanUrl = `data:text/javascript;base64,${Buffer.from(read('cameraPan.js')).toString('base64')}`;
    const { isTypingTarget } = await import(cameraPanUrl);
    const listeners = {};
    const appended = [];
    const selected = [];
    const actions = [];
    let enabled = true;
    let location = false;
    let selectedObject = false;
    const createElement = tagName => ({
        tagName, style: {}, children: [], handlers: {}, attributes: {},
        classList: {
            values: new Set(),
            add(name) { this.values.add(name); },
            toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); },
            contains(name) { return this.values.has(name); },
        },
        setAttribute(name, value) { this[name] = value; },
        addEventListener(name, handler) { this.handlers[name] = handler; },
        appendChild(child) { this.children.push(child); },
        remove() { this.removed = true; },
        contains(target) { return this === target || this.children.includes(target); },
    });
    const context = vm.createContext({
        isTypingTarget,
        window: { innerWidth: 800, innerHeight: 600, worldEditorTool: 'select', locationEditorTool: 'select' },
        document: {
            createElement,
            createElementNS(namespace, tagName) { return createElement(tagName); },
            body: { appendChild(node) { appended.push(node); } },
            addEventListener(name, handler) { listeners[name] = handler; },
            querySelectorAll() { return []; },
        },
    });
    vm.runInContext(source, context);
    context.initMapEditorQuickMenu({
        isEnabled: () => enabled,
        isLocation: () => location,
        selectTool(tool) { selected.push(tool); },
        locationAction(action) { actions.push(action); return action === 'resize' && selectedObject; },
    });
    listeners.pointermove({ clientX: 400, clientY: 300 });
    const press = (code, inputType = null) => {
        let prevented = false;
        listeners.keydown({
        code, repeat: false, altKey: false, ctrlKey: false, metaKey: false,
        target: { closest(selector) { return selector === 'input' && inputType ? { type: inputType } : null; } },
        preventDefault() { prevented = true; }, stopImmediatePropagation() {},
        });
        return prevented;
    };
    const release = code => listeners.keyup({
        code, preventDefault() {}, stopImmediatePropagation() {},
    });

    press('KeyQ');
    const worldMenu = appended.at(-1);
    const worldSegments = worldMenu.children[0].children.slice(0, 4);
    assert.equal(worldSegments.length, 4);
    for (const segment of worldSegments) {
        assert.match(segment.children[0].d, / A 166 166 /);
        const label = segment.children[1];
        const radius = Math.hypot(Number(label.x) - 176, Number(label.y) + 5 - 176);
        assert.ok(Math.abs(radius - 111) < 0.001);
    }
    listeners.pointermove({ clientX: 510, clientY: 300 });
    assert.equal(worldSegments[1].classList.contains('is-highlighted'), true);
    release('KeyQ');
    assert.deepEqual(selected, ['terrain']);
    assert.equal(worldMenu.removed, true);

    listeners.pointermove({ clientX: 400, clientY: 300 });
    press('KeyQ');
    const emptyMenu = appended.at(-1);
    release('KeyQ');
    assert.equal(emptyMenu.removed, true);
    assert.deepEqual(selected, ['terrain']);

    press('KeyQ');
    const cancelledMenu = appended.at(-1);
    press('Escape');
    assert.equal(cancelledMenu.removed, true);
    assert.deepEqual(selected, ['terrain']);

    press('Digit2');
    assert.deepEqual(selected, ['terrain', 'terrain']);

    enabled = false;
    press('Digit3');
    assert.deepEqual(selected, ['terrain', 'terrain']);
    enabled = true;
    location = true;
    press('KeyQ');
    const locationMenu = appended.at(-1);
    assert.equal(locationMenu.children[0].children.length, 9);
    let outsideClickBlocked = false;
    listeners.pointerdown({
        target: {},
        preventDefault() { outsideClickBlocked = true; },
        stopImmediatePropagation() {},
    });
    assert.equal(outsideClickBlocked, true);
    assert.equal(locationMenu.removed, true);
    press('KeyQ');
    press('Digit7');
    assert.deepEqual(selected, ['terrain', 'terrain', 'light']);
    assert.equal(appended.at(-1).removed, true);
    press('Digit8');
    press('KeyV');
    press('KeyB');
    press('KeyG');
    press('KeyT');
    assert.deepEqual(selected, ['terrain', 'terrain', 'light', 'select', 'assets']);
    assert.deepEqual(actions, ['move', 'rotate']);
    assert.equal(press('KeyR'), false);
    assert.deepEqual(actions, ['move', 'rotate', 'resize']);
    selectedObject = true;
    assert.equal(press('KeyR'), true);
    assert.deepEqual(actions, ['move', 'rotate', 'resize', 'resize']);
    assert.equal(press('KeyV', 'range'), true);
    assert.equal(selected.at(-1), 'select');
    assert.equal(press('KeyB', 'text'), false);
    assert.equal(selected.at(-1), 'select');
});

test('right drag while painting remains available to world and location cameras', () => {
    const worldSource = read('lobby3d.js');
    const start = worldSource.indexOf('function canvasMouseDownHandler(event)');
    const end = worldSource.indexOf("renderer.domElement.addEventListener('pointerdown'", start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({
        window: { isLocationActive: false },
        editMode: true,
        controls: { enabled: false },
        controlsDisabled: true,
        brushActive: true,
    });
    vm.runInContext(worldSource.slice(start, end), context);
    let prevented = false;
    context.canvasMouseDownHandler({
        button: 2,
        preventDefault() { prevented = true; },
    });
    assert.equal(prevented, false);
    assert.equal(context.controls.enabled, true);
    assert.equal(context.brushActive, false);

    const localSource = read('locationScene.js');
    const contextStart = localSource.indexOf('const onContextMenu = (e) => {');
    const contextEnd = localSource.indexOf("canvas.addEventListener('contextmenu'", contextStart);
    assert.ok(contextStart >= 0 && contextEnd > contextStart);
    assert.doesNotMatch(localSource.slice(contextStart, contextEnd), /setLocationBrushObjectRotation/);
    assert.match(localSource, /canvas\.addEventListener\('pointerdown', onCameraRotatePointerDown, \{ capture: true \}\)/);
});
