const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '../app/static/js', file), 'utf8');

test('marker snapshots recover after authentication and do not erase independently loaded locations', async () => {
    const source = read('markers.js');
    const start = source.indexOf('export function initMarkers(');
    const end = source.indexOf('\nfunction addMarkerToScene(', start);
    assert.ok(start >= 0 && end > start);
    const handlers = new Map();
    const emitted = [];
    const pendingLocations = [];
    const timers = new Map();
    const notifications = [];
    const markers = new Map([['loc_1', { data: { id: 'loc_1', type: 'location' } }]]);
    let nextTimer = 1;
    const socket = {
        connected: true,
        on(name, handler) { handlers.set(name, handler); },
        emit(name, payload) { emitted.push([name, payload]); },
    };
    const context = vm.createContext({
        socket: null, currentLobbyId: null, token: null, markers,
        markerRetryTimer: null, locationLoadVersion: 0, locationChangeVersion: 0,
        createTooltip() {},
        canSeeMarkerForCurrentUser() { return false; },
        addMarkerToScene(marker) { markers.set(marker.id, { data: marker }); },
        removeMarkerFromScene(id) { markers.delete(id); },
        clearSocketMarkers() {
            for (const id of markers.keys()) if (!String(id).startsWith('loc_')) markers.delete(id);
        },
        upsertLocationMarker(location) {
            markers.set(`loc_${location.id}`, { data: location });
        },
        updateRouteDatalists() {}, updateRouteLines() {},
        showNotification(message) { notifications.push(message); },
        Server: { getLocations() { return new Promise(resolve => pendingLocations.push(resolve)); } },
        console: { warn() {} },
        setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
        clearTimeout(id) { timers.delete(id); },
    });
    vm.runInContext(source.slice(start, end).replace('export function', 'function'), context);
    context.initMarkers(5, 'token', socket);
    assert.equal(emitted.length, 0);

    handlers.get('authenticated')();
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], 'get_markers');
    assert.equal(pendingLocations.length, 1);
    assert.equal(timers.size, 1);
    handlers.get('markers_list')([{ id: 'cache_1', type: 'cache' }]);
    assert.equal(timers.size, 0);
    assert.equal(markers.has('loc_1'), true);
    assert.equal(markers.has('cache_1'), true);
    pendingLocations.shift()([{ id: 1, name: 'Old' }, { id: 2, name: 'New' }]);
    await new Promise(setImmediate);
    assert.equal(markers.has('loc_2'), true);

    handlers.get('disconnect')();
    handlers.get('authenticated')();
    assert.equal(emitted.length, 2);
    assert.equal(pendingLocations.length, 1);
    handlers.get('location_created')({ lobby_id: 5, location: { id: 3, name: 'Live' } });
    pendingLocations.shift()([{ id: 1 }, { id: 2 }]);
    await new Promise(setImmediate);
    assert.equal(markers.has('loc_3'), true);
    assert.equal(pendingLocations.length, 1);
    pendingLocations.shift()([{ id: 1 }, { id: 2 }, { id: 3 }]);
    await new Promise(setImmediate);
    assert.equal(markers.has('loc_3'), true);
    for (let attempt = 0; attempt < 3; attempt++) {
        timers.values().next().value.callback();
    }
    assert.equal(emitted.length, 4);
    assert.equal(notifications.length, 1);
});

test('socket marker refresh preserves location markers and releases obsolete route lines', () => {
    const source = read('markers.js');
    const start = source.indexOf('function clearSocketMarkers(');
    const end = source.indexOf('\nfunction updateTooltipPosition(', start);
    assert.ok(start >= 0 && end > start);
    const removed = [];
    const markers = new Map([
        ['loc_1', {}], ['cache_1', {}], ['route_1', {}],
    ]);
    const routeLines = new Map([['route', {
        geometry: { dispose() { removed.push('geometry'); } },
        material: { dispose() { removed.push('material'); } },
    }]]);
    const context = vm.createContext({
        markers, routeLines,
        scene: { remove() { removed.push('line'); } },
        removeMarkerFromScene(id) { removed.push(id); markers.delete(id); },
    });
    vm.runInContext(source.slice(start, end), context);
    context.clearSocketMarkers();
    assert.deepEqual([...markers.keys()], ['loc_1']);
    assert.deepEqual(removed, ['cache_1', 'route_1', 'line', 'geometry', 'material']);
    assert.equal(routeLines.size, 0);
});

test('chunk loading shares an in-flight request and limits parallel HTTP work', async () => {
    const source = read('lobbyData.js');
    const start = source.indexOf('let loadingAllChunks = null;');
    const end = source.indexOf('\nasync function fetchChunk(', start);
    assert.ok(start >= 0 && end > start);
    let active = 0;
    let maximum = 0;
    let loaded = 0;
    const context = vm.createContext({
        window: { MAP_CHUNKS_WIDTH: 4, MAP_CHUNKS_HEIGHT: 3 },
        console: { log() {} },
        async fetchChunk() {
            active += 1;
            maximum = Math.max(maximum, active);
            await Promise.resolve();
            active -= 1;
            loaded += 1;
        },
    });
    vm.runInContext(source.slice(start, end).replace('export function', 'function'), context);
    const first = context.loadAllChunks();
    assert.equal(context.loadAllChunks(), first);
    await first;
    assert.equal(loaded, 12);
    assert.equal(maximum, 4);
});

test('re-authentication rejoins an open sublocation for character and fog state', () => {
    const source = read('socketHandlers.js');
    const start = source.indexOf("socket.on('authenticated', (data) => {");
    const end = source.indexOf("\n    socket.on('new_message'", start);
    assert.ok(start >= 0 && end > start);
    const handlers = new Map();
    const emitted = [];
    const context = vm.createContext({
        socket: {
            on(name, handler) { handlers.set(name, handler); },
            emit(name, payload) { emitted.push([name, payload]); },
        },
        token: 'token',
        window: { isLocationActive: true, currentLocationId: 8, currentLocationCharacterId: 17 },
        localStorage: { getItem() { return '42'; } },
        onlineUserIds: new Set(),
        AppState: { setIsGM(value) { this.isGM = value; } },
        locationScene: { loadCombatStartRequests() {} },
        showNotification() {}, loadLobbyInfo() {}, loadLobbyCharacters() {}, loadAllChunks() {},
    });
    vm.runInContext(source.slice(start, end).replace("import('./locationScene.js')", 'Promise.resolve(locationScene)'), context);
    handlers.get('authenticated')({ username: 'Player', is_gm: true });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][0], 'join_location');
    assert.equal(emitted[0][1].location_id, 8);
    assert.equal(emitted[0][1].character_id, 17);
    assert.equal(context.AppState.isGM, true);
    context.window.isLocationActive = false;
    handlers.get('authenticated')({ username: 'Player', is_gm: false });
    assert.equal(emitted.length, 1);
    assert.equal(context.AppState.isGM, false);
});

test('initial sublocation build applies fog once after assembling objects', () => {
    const source = read('locationScene.js');
    const start = source.indexOf('export function loadLocation(data)');
    const end = source.indexOf('\nfunction updateTileCube(', start);
    const load = source.slice(start, end);
    assert.match(load, /if \(data\.tiles_data\[y\]\[x\]\.objects\?\.length\) rebuildTileObjects\(x, y\)/);
    assert.match(load, /data\.objects\.forEach\(object => addLocationObjectMesh\(object, false\)\)/);
    assert.equal((load.match(/applyFogOfWar\(\)/g) || []).length, 1);
    assert.doesNotMatch(load, /buildFogMeshes\(\)/);
});
