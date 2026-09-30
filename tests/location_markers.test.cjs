const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/markers.js'), 'utf8');

test('location marker updates in place when its name or world tile changes', () => {
    const start = source.indexOf('function upsertLocationMarker(');
    const end = source.indexOf('\nfunction updateRouteLines(', start);
    assert.ok(start >= 0 && end > start);
    const markers = new Map();
    let added = 0;
    let tooltipHidden = 0;
    const context = vm.createContext({
        markers, hoveredMarkerId: null,
        addMarkerToScene(marker) {
            added += 1;
            markers.set(marker.id, {
                data: marker,
                sprite: { position: { set(x, y, z) { this.x = x; this.y = y; this.z = z; } } },
            });
        },
        hideTooltip() { tooltipHidden += 1; },
    });
    vm.runInContext(source.slice(start, end), context);
    context.upsertLocationMarker({ id: 7, name: 'Old', world_tile_x: 1, world_tile_z: 2 });
    assert.equal(added, 1);
    const entry = markers.get('loc_7');
    assert.equal(entry.data.position.x, 1.5);
    context.hoveredMarkerId = 'loc_7';
    context.upsertLocationMarker({ id: 7, name: 'New', world_tile_x: 30, world_tile_z: 31 });
    assert.equal(added, 1);
    assert.equal(markers.get('loc_7'), entry);
    assert.equal(entry.data.name, 'New');
    assert.equal(entry.sprite.position.x, 30.5);
    assert.equal(entry.sprite.position.z, 31.5);
    assert.equal(tooltipHidden, 1);
    context.upsertLocationMarker({ id: 7, name: 'Bad', world_tile_x: undefined, world_tile_z: 31 });
    assert.equal(entry.data.name, 'New');
});

test('removing a marker releases its own texture but not the shared Sprite geometry', () => {
    const start = source.indexOf('function removeMarkerFromScene(');
    const end = source.indexOf('\nfunction updateTooltipPosition(', start);
    assert.ok(start >= 0 && end > start);
    const removed = [];
    const sprite = {
        material: {
            map: { dispose() { removed.push('texture'); } },
            dispose() { removed.push('material'); },
        },
        geometry: { dispose() { throw new Error('shared geometry disposed'); } },
    };
    const markers = new Map([['loc_7', { sprite }]]);
    const context = vm.createContext({
        markers, hoveredMarkerId: 'loc_7', hideTooltip() { removed.push('tooltip'); },
        scene: { remove() { removed.push('sprite'); } },
        routeLines: new Map(),
    });
    vm.runInContext(source.slice(start, end), context);
    context.removeMarkerFromScene('loc_7');
    assert.equal(markers.has('loc_7'), false);
    assert.deepEqual(removed, ['sprite', 'texture', 'material', 'tooltip']);
    assert.equal(context.hoveredMarkerId, null);
});

test('GM can pick a world tile, rename, and deliberately delete a sublocation from its marker', async () => {
    const start = source.indexOf('function openLocationMarkerEditModal(');
    const end = source.indexOf('\n// ---------- Модальное окно редактирования', start);
    assert.ok(start >= 0 && end > start);
    const modals = [];
    const updates = [];
    const deletions = [];
    const removedMarkers = [];
    let confirmed = false;
    const makeButton = () => ({ disabled: false, handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; } });
    const makeInput = () => ({ value: '', get valueAsNumber() { return Number(this.value); }, focus() {} });
    const document = {
        body: { appendChild(modal) { modals.push(modal); } },
        querySelector() { return null; },
        createElement() {
            const elements = new Map([
                ['[data-location-name]', makeInput()],
                ['[data-location-x]', makeInput()],
                ['[data-location-z]', makeInput()],
                ['[data-location-save]', makeButton()],
                ['[data-location-close]', makeButton()],
                ['[data-location-pick]', makeButton()],
                ['[data-location-delete]', makeButton()],
            ]);
            return {
                style: {}, elements, handlers: {},
                querySelector(selector) { return elements.get(selector); },
                addEventListener(name, handler) { this.handlers[name] = handler; },
                remove() { this.removed = true; },
            };
        },
        addEventListener() {}, removeEventListener() {},
    };
    const context = vm.createContext({
        document, AppState: { isGM: true }, mapWidthTiles: 64, mapHeightTiles: 64,
        window: { confirm() { return confirmed; } },
        Server: {
            async updateLocation(...args) {
                updates.push(args);
                return { location: { id: 9, name: args[2].name, world_tile_x: args[2].world_tile_x, world_tile_z: args[2].world_tile_z } };
            },
            async deleteLocation(...args) { deletions.push(args); },
        },
        currentLobbyId: 4,
        awaitingTilePick: false, tilePickCallback: null,
        upsertLocationMarker() {}, removeMarkerFromScene(id) { removedMarkers.push(id); },
        showNotification() {},
    });
    vm.runInContext(source.slice(start, end), context);
    const marker = {
        id: 'loc_9', type: 'location', name: 'Old', locationId: 9,
        worldTileX: 1, worldTileZ: 2, position: { x: 1.5, z: 2.5 },
    };

    context.openLocationMarkerEditModal(marker);
    const first = modals[0];
    first.elements.get('[data-location-pick]').handlers.click();
    assert.equal(context.awaitingTilePick, true);
    context.tilePickCallback(10.5, 1, 20.5);
    assert.equal(first.elements.get('[data-location-x]').value, 10);
    assert.equal(first.elements.get('[data-location-z]').value, 20);
    first.elements.get('[data-location-name]').value = 'New';
    await first.elements.get('[data-location-save]').handlers.click();
    assert.equal(updates.length, 1);
    assert.equal(updates[0][0], 4);
    assert.equal(updates[0][1], 9);
    assert.equal(updates[0][2].name, 'New');
    assert.equal(updates[0][2].world_tile_x, 10);
    assert.equal(updates[0][2].world_tile_z, 20);
    assert.equal(first.removed, true);

    context.openLocationMarkerEditModal(marker);
    const second = modals[1];
    await second.elements.get('[data-location-delete]').handlers.click();
    assert.equal(deletions.length, 0);
    confirmed = true;
    await second.elements.get('[data-location-delete]').handlers.click();
    assert.equal(deletions.length, 1);
    assert.equal(deletions[0][1], 9);
    assert.deepEqual(removedMarkers, ['loc_9']);
    assert.equal(second.removed, true);
});

test('GM right-click edits ordinary markers while double-click behavior stays unchanged', () => {
    const start = source.indexOf('export function setupMarkerInteraction()');
    const end = source.indexOf('\n// ---------- Функции для выбора тайла', start);
    assert.ok(start >= 0 && end > start);
    const handlers = new Map();
    const canvas = {
        addEventListener(name, handler) { handlers.set(name, handler); },
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
    };
    const markers = new Map([
        ['cache_1', { sprite: { userData: { markerId: 'cache_1' } }, data: { id: 'cache_1', type: 'cache' } }],
        ['loc_2', { sprite: { userData: { markerId: 'loc_2' } }, data: { id: 'loc_2', type: 'location', locationId: 2 } }],
    ]);
    let hitId = null;
    const calls = [];
    const context = vm.createContext({
        renderer: { domElement: canvas }, AppState: { isGM: true, editMode: false },
        window: { isLocationActive: false, enterLocation(id) { calls.push(`enter:${id}`); } },
        markers, mouse: { x: 0, y: 0 }, camera: {},
        raycaster: {
            setFromCamera() {},
            intersectObjects() {
                return hitId ? [{ object: markers.get(hitId).sprite }] : [];
            },
        },
        openMarkerEditModal(marker) { calls.push(`edit:${marker.id}`); },
        openLocationMarkerEditModal(marker) { calls.push(`location-edit:${marker.id}`); },
    });
    vm.runInContext(source.slice(start, end).replace('export function setupMarkerInteraction()', 'function setupMarkerInteraction()'), context);
    context.setupMarkerInteraction();
    const event = () => ({
        clientX: 50, clientY: 50,
        preventDefault() { calls.push('prevent'); },
        stopImmediatePropagation() { calls.push('stop-immediate'); },
        stopPropagation() { calls.push('stop'); },
    });

    hitId = 'cache_1';
    handlers.get('contextmenu')(event());
    assert.deepEqual(calls, ['prevent', 'stop-immediate', 'edit:cache_1']);
    calls.length = 0;
    handlers.get('dblclick')(event());
    assert.deepEqual(calls, ['edit:cache_1', 'prevent', 'stop']);

    calls.length = 0;
    hitId = 'loc_2';
    handlers.get('contextmenu')(event());
    assert.deepEqual(calls, ['prevent', 'stop-immediate', 'location-edit:loc_2']);
    calls.length = 0;
    handlers.get('dblclick')(event());
    assert.deepEqual(calls, ['enter:2', 'prevent', 'stop']);

    calls.length = 0;
    hitId = null;
    handlers.get('contextmenu')(event());
    assert.deepEqual(calls, []);
    hitId = 'cache_1';
    context.AppState.isGM = false;
    handlers.get('contextmenu')(event());
    assert.deepEqual(calls, []);
});
