const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/lobby3d.js'), 'utf8');
const fillStart = source.indexOf('function fillChunkTerrainInstances(');
const fillEnd = source.indexOf('\n// --- Функции для чанков ---', fillStart);
const updateStart = source.indexOf('export function updateTileInChunk(');
const updateEnd = source.indexOf('\nexport function setBrushRadius(', updateStart);
assert.ok(fillStart >= 0 && fillEnd > fillStart && updateStart >= 0 && updateEnd > updateStart);

function harness({ deferTimers = false } = {}) {
    class Object3D {
        constructor() {
            this.matrix = {};
            this.position = { set: (x, y, z) => { this.matrix.position = [x, y, z]; } };
            this.scale = { set: (x, y, z) => { this.matrix.scale = [x, y, z]; } };
        }
        updateMatrix() {}
    }
    class Color {
        constructor(hex) { this.hex = hex; }
        setHex(hex) { this.hex = hex; }
    }
    const mesh = () => ({
        visible: true, count: 4, matrices: [], colors: [],
        instanceMatrix: { needsUpdate: false }, instanceColor: { needsUpdate: false },
        setMatrixAt(index, matrix) { this.matrices[index] = { position: [...matrix.position], scale: [...matrix.scale] }; },
        setColorAt(index, color) { this.colors[index] = color.hex; },
    });
    const ground = mesh();
    const water = mesh();
    const tilesData = [
        [{ terrain: 'grass', height: 1 }, { terrain: 'water', height: 2 }],
        [{ terrain: 'rock', height: 3 }, { terrain: 'grass', height: 4 }],
    ];
    const entry = { chunkX: 0, chunkY: 0, ground, water, tilesData, terrainVisible: true, bounds: { max: { y: 4.5 } } };
    const timers = [];
    let terrainBuilds = 0;
    let waterBuilds = 0;
    const context = vm.createContext({
        THREE: { Object3D, Color }, terrainColors: { grass: 1, rock: 2 },
        CHUNK_SIZE: 2, chunksMap: new Map([['0,0', entry]]),
        markWorldShadowsDirty() {}, updateTileObjectsPositions() {},
        rebuildRoadMeshes() {}, refreshRoadNeighborhood() {},
        requestAnimationFrame() {}, cancelAnimationFrame() {}, rebuildChunkObjects() {},
        refreshWorldTerrainSurface() {},
        buildSmoothTerrainData: () => {
            terrainBuilds++;
            return { positions: [], tileByFace: [] };
        },
        buildRoundedWaterData: () => {
            waterBuilds++;
            return { water: [], bank: [], sandBank: [], regions: new Map() };
        },
        waterLevelForTile: tile => tile.height,
        chunkBounds: [], scene: { remove() {} },
        clearTimeout(id) { if (deferTimers) timers[id - 1] = null; },
        setTimeout(callback) {
            if (!deferTimers) callback();
            timers.push(callback);
            return timers.length;
        },
        brushActive: false,
        lastHoverRaycastAt: 0,
    });
    vm.runInContext(source.slice(fillStart, fillEnd)
        + source.slice(updateStart, updateEnd).replace('export ', ''), context);
    Object.assign(entry, context.fillChunkTerrainInstances(ground, water, tilesData, 0, 0));
    return {
        context, entry, ground, water,
        get terrainBuilds() { return terrainBuilds; },
        get waterBuilds() { return waterBuilds; },
        flushTimers() {
            const pending = timers.splice(0);
            for (const callback of pending) callback?.();
        },
    };
}

test('world terrain instances contain only real land and water tiles', () => {
    const { entry, ground, water } = harness();
    assert.equal(ground.count, 3);
    assert.equal(water.count, 1);
    assert.equal(entry.groundIndices[1], -1);
    assert.equal(entry.waterIndices[1], 0);
    assert.deepEqual(ground.matrices[0].scale, [1, 1, 1]);
    assert.deepEqual(water.matrices[0].position, [1.5, 1, 0.5]);
    assert.deepEqual(water.matrices[0].scale, [1, 2, 1]);
    assert.deepEqual(ground.matrices[1].position, [0.5, 1.5, 1.5]);
    assert.deepEqual(ground.matrices[1].scale, [1, 3, 1]);
    assert.match(source, /new THREE\.InstancedMesh\(groundGeo, waterInstanceMaterials, totalTiles\)/);
    assert.match(source, /groundInstances\.frustumCulled = false/);
});

test('baked world surface covers land tops, skips water, and reuses its texture on edits', () => {
    const start = source.indexOf('function refreshWorldTerrainSurface(');
    const end = source.indexOf('\nfunction fillChunkTerrainInstances(', start);
    assert.ok(start >= 0 && end > start);
    let generated = 0;
    let updated = 0;
    let disposedGeometry = 0;
    let disposedMaterial = 0;
    const entry = {
        chunkX: 0, chunkY: 0, terrainVisible: true,
        tilesData: [[{ terrain: 'grass', height: 1 }, { terrain: 'water', height: 1 }],
            [{ terrain: 'sand', height: 2 }, { terrain: 'rock', height: 1 }]],
        smoothTileIndices: new Set([2]),
    };
    const smoothData = { topByVertex: [1, 1, 1],
        positions: [1, 2, 2, 2, 1.5, 2, 1, 2, 3],
        normals: [0, 1, 0, 0, 1, 0, 0, 1, 0] };
    class Geometry {
        constructor() { this.attributes = {}; }
        setAttribute(name, value) { this.attributes[name] = value; }
        dispose() { disposedGeometry++; }
    }
    class Texture {
        constructor(data, width, height) { this.image = { data, width, height }; }
        dispose() { this.disposed = true; }
    }
    class Material {
        constructor(options) { Object.assign(this, options); }
        dispose() { disposedMaterial++; }
    }
    const context = vm.createContext({
        CHUNK_SIZE: 2, chunksMap: new Map([['0,0', entry]]),
        scene: { add() {}, remove() {} },
        createTerrainPixelsRegion: () => {
            generated++;
            return { data: new Uint8Array(512 * 512 * 4), width: 512, height: 512 };
        },
        updateTerrainPixelsRegion: () => { updated++; return true; },
        THREE: { DataTexture: Texture, BufferGeometry: Geometry, MeshStandardMaterial: Material,
            Mesh: class { constructor(geometry, material) {
                this.geometry = geometry; this.material = material;
            } },
            Float32BufferAttribute: class { constructor(array) { this.array = array; } },
            RGBAFormat: 1, UnsignedByteType: 2, LinearFilter: 3,
            LinearMipmapLinearFilter: 4, sRGBEncoding: 5, DoubleSide: 6 },
    });
    vm.runInContext(source.slice(start, end), context);
    context.refreshWorldTerrainSurface(entry, smoothData);
    const positions = entry.terrainSurface.geometry.attributes.position.array;
    const uvs = entry.terrainSurface.geometry.attributes.uv.array;
    assert.equal(positions.length / 3, 15);
    assert.deepEqual(Array.from(positions.slice(-9)), [0, 2.002, 1, 1, 1.502, 1, 0, 2.002, 2]);
    assert.equal(uvs[0], 24 / 512);
    assert.equal(uvs[1], 24 / 512);
    assert.equal(entry.terrainSurface.material.map, entry.terrainTexture);
    assert.equal(entry.terrainSurface.raycast(), undefined);
    const originalTexture = entry.terrainTexture;
    entry.terrainTextureRegion = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    context.refreshWorldTerrainSurface(entry, smoothData);
    assert.equal(generated, 1);
    assert.equal(updated, 1);
    assert.equal(entry.terrainTexture, originalTexture);
    assert.equal(entry.terrainTextureRegion, null);
    assert.equal(disposedGeometry, 1);
    assert.equal(disposedMaterial, 1);
});

test('same-kind edit updates one instance; land-water edit rebuilds compact indices', () => {
    const { context, entry, ground, water } = harness();
    const originalIndices = entry.groundIndices;
    context.updateTileInChunk(0, 0, 0, 0, { terrain: 'rock', height: 5 });
    assert.equal(entry.groundIndices, originalIndices);
    assert.deepEqual(ground.matrices[0].scale, [1, 5, 1]);
    assert.equal(ground.colors[0], 2);
    assert.equal(entry.bounds.max.y, 5.5);

    context.updateTileInChunk(0, 0, 0, 0, { terrain: 'water' });
    assert.notEqual(entry.groundIndices, originalIndices);
    assert.equal(ground.count, 2);
    assert.equal(water.count, 2);
    assert.equal(entry.groundIndices[0], -1);
    assert.equal(entry.waterIndices[0], 0);
    assert.deepEqual(water.matrices[0].scale, [1, 4.99, 1]);
});

test('world slopes rebuild near edits and chunk changes without replacing flat terrain instances', () => {
    assert.match(source, /refreshWorldTerrainNeighborhood\(cx, cy, null, null, false, false, true, true\)/);
    assert.match(source, /refreshWorldTerrainNeighborhood\(chunkX, chunkY, tileX, tileY,\s*!changedTerrain/);
    assert.match(source, /setTimeout\(flushWorldTerrainRefresh, 100\)/);
    assert.match(source, /window\.addEventListener\('pointerup'/);
    assert.match(source, /worldTerrainRefreshTimer = setTimeout\(flushWorldTerrainRefresh, 0\)/);
    assert.match(source, /buildRoundedWaterData\(padded, 0\.24/);
    assert.match(source, /entry\.ground\.setMatrixAt\(index, dummy\.matrix\)/);
    assert.match(source, /data\.foundationByTile\.get\(`\$\{x \+ 1\},\$\{z \+ 1\}`\)/);
    assert.match(source, /Math\.max\(0\.05, foundation - 0\.085\)/);
    assert.match(source, /chunk\.smoothTerrain\.visible = groundVisible/);
    assert.match(source, /chunkBounds\.push\(entry\.smoothTerrainBounds\)/);
    assert.match(source, /uvs\.set\(\[data\.positions\[index \* 3\] - x,/);
    assert.doesNotMatch(source, /applyTerrainBlend\(/);
});

test('height brush coalesces chunk rebuilds and ignores the echoed batch', () => {
    const world = harness({ deferTimers: true });
    world.context.brushActive = true;
    world.context.updateTileInChunk(0, 0, 0, 0, { height: 5 });
    world.context.updateTileInChunk(0, 0, 0, 0, { height: 6 });
    world.context.updateTileInChunk(0, 0, 1, 1, { height: 7 });
    assert.equal(world.terrainBuilds, 0);
    assert.equal(world.waterBuilds, 0);
    world.flushTimers();
    assert.equal(world.terrainBuilds, 0);
    world.context.brushActive = false;
    world.flushTimers();
    assert.equal(world.terrainBuilds, 1);
    assert.equal(world.waterBuilds, 1);
    world.context.updateTileInChunk(0, 0, 0, 0, { height: 6 });
    world.context.updateTileInChunk(0, 0, 1, 1, { height: 7 });
    world.flushTimers();
    assert.equal(world.terrainBuilds, 1);
    assert.equal(world.waterBuilds, 1);
});

test('releasing the world brush schedules its pending terrain refresh without camera movement', () => {
    const start = source.indexOf('function finishWorldBrushStroke()');
    const end = source.indexOf('\nfunction canvasMouseDownHandler(', start);
    assert.ok(start >= 0 && end > start);
    let scheduled = 0;
    let removed = 0;
    const context = vm.createContext({
        brushActive: true, isMouseDown: true, lastProcessedTileKey: '0,0,1,1',
        controlsDisabled: true, controls: { enabled: false },
        globalMouseUpHandler() {},
        document: { removeEventListener() { removed++; } },
        pendingWorldTerrainChunks: new Set(['0,0']),
        clearTimeout() {}, setTimeout(callback, delay) { scheduled++; assert.equal(delay, 0); return 7; },
        flushWorldTerrainRefresh() {}, worldTerrainRefreshTimer: 3,
    });
    vm.runInContext(source.slice(start, end), context);
    context.finishWorldBrushStroke();
    assert.equal(context.brushActive, false);
    assert.equal(context.controls.enabled, true);
    assert.equal(context.globalMouseUpHandler, null);
    assert.equal(context.worldTerrainRefreshTimer, 7);
    assert.equal(scheduled, 1);
    assert.equal(removed, 1);
});

test('slope overlay hides only its cube and restores it when the slope disappears', () => {
    const start = source.indexOf('function refreshWorldTerrainChunk(');
    const end = source.indexOf('\n// --- Функции для чанков ---', start);
    let sloped = true;
    let disposed = false;
    const matrices = [];
    const entry = {
        chunkX: 0, chunkY: 0, terrainVisible: true,
        tilesData: Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => (
            { terrain: 'grass', height: 1 }
        ))),
        groundIndices: [0, 1, 2, 3], bounds: { max: { y: 1.5 } },
        ground: { instanceMatrix: {}, setMatrixAt(index, matrix) {
            matrices[index] = { scale: [...matrix.scale], position: [...matrix.position] };
        } },
    };
    class Geometry {
        setAttribute() {}
        computeVertexNormals() {}
        dispose() { disposed = true; }
    }
    class Object3D {
        constructor() {
            this.matrix = {};
            this.position = { set: (...values) => { this.matrix.position = values; } };
            this.scale = { set: (...values) => { this.matrix.scale = values; } };
        }
        updateMatrix() {}
    }
    const context = vm.createContext({
        CHUNK_SIZE: 2, chunksMap: new Map([['0,0', entry]]), chunkBounds: [],
        scene: { add() {}, remove() {} }, terrainColors: { grass: 0x123456 }, smoothGroundMat: {},
        refreshWorldTerrainSurface() {},
        buildSmoothTerrainData: () => sloped ? {
            positions: [1, 1, 1, 2, 1.5, 1, 1, 1, 2], topByVertex: [1, 1, 1],
            tileByFace: [{ x: 1, z: 1 }],
            tileByVertex: Array.from({ length: 3 }, () => ({ x: 1, z: 1 })),
            foundationByTile: new Map([['1,1', 0.8]]),
        } : { positions: [], tileByFace: [], foundationByTile: new Map() },
        THREE: {
            Object3D, BufferGeometry: Geometry,
            Float32BufferAttribute: class { constructor(data) { this.data = data; } },
            Color: class { setHex() { this.r = this.g = this.b = 0.5; } },
            Mesh: class { constructor(geometry) {
                this.geometry = geometry;
                this.position = { set() {} };
            } },
        },
    });
    vm.runInContext(source.slice(start, end), context);
    context.refreshWorldTerrainChunk(entry);
    assert.ok(Math.abs(matrices[0].scale[1] - 0.715) < 1e-9);
    assert.ok(Math.abs(matrices[0].position[1] - matrices[0].scale[1] / 2) < 1e-9);
    assert.deepEqual(matrices[1].scale, [1, 1, 1]);
    assert.equal(matrices[1].position[1], 0.5);
    assert.equal(context.chunkBounds.length, 1);
    sloped = false;
    context.refreshWorldTerrainChunk(entry);
    assert.equal(disposed, true);
    assert.deepEqual(matrices[0].scale, [1, 1, 1]);
    assert.equal(matrices[0].position[1], 0.5);
    assert.equal(context.chunkBounds.length, 0);
});

test('world landmarks use their actual lowest vertex as the ground offset', () => {
    const start = source.indexOf('function getBaseHalfHeight(');
    const end = source.indexOf('\nfunction getDefaultColorForType(', start);
    assert.ok(start >= 0 && end > start);
    const landmark = { geometry: { boundingBox: null, computeBoundingBox() { this.boundingBox = { min: { y: -0.31 } }; } } };
    const context = vm.createContext({
        WORLD_LANDMARKS: { forest: landmark },
        getBaseDimensions: type => ({ height: type === 'tree' ? 1 : 1.5 }),
    });
    vm.runInContext(source.slice(start, end).replaceAll('export function ', 'function '), context);
    assert.equal(context.getObjectHeightOffset('forest'), 0.31);
    assert.equal(context.getObjectHeightOffset('tree'), 0.5);
});

test('removing a chunk releases instance buffers but keeps shared terrain resources', () => {
    const start = source.indexOf('export function removeChunk(');
    const end = source.indexOf('\n// --- Функция для обновления позиций', start);
    assert.ok(start >= 0 && end > start);
    const removed = [];
    const cancelled = [];
    const mesh = () => ({
        geometry: { dispose() { throw new Error('shared geometry disposed'); } },
        material: { dispose() { throw new Error('shared material disposed'); } },
        dispose() { this.disposed = true; },
    });
    const entry = { ground: mesh(), water: mesh(), trees: mesh(), farAnomalies: mesh(), pendingRebuild: 7, anomalyLODs: [] };
    const chunksMap = new Map([['0,0', entry]]);
    const context = vm.createContext({
        chunksMap, chunkBounds: [{ key: '0,0' }],
        scene: { remove(object) { removed.push(object); } },
        cancelAnimationFrame(id) { cancelled.push(id); },
        disposeChunkAnomalyLODs() {},
        disposeRoadMeshes() {}, refreshRoadNeighborhood() {},
        markWorldShadowsDirty() {}, lastChunkVisibilityAt: 0, lastHoverRaycastAt: 0,
        CHUNK_SIZE: 2, THREE: {},
        refreshWorldTerrainNeighborhood() {},
    });
    vm.runInContext(source.slice(start, end).replace('export ', ''), context);
    context.removeChunk(0, 0);
    assert.equal(chunksMap.has('0,0'), false);
    assert.deepEqual(cancelled, [7]);
    assert.equal(entry.ground.disposed, true);
    assert.equal(entry.water.disposed, true);
    assert.equal(entry.trees.disposed, true);
    assert.equal(entry.farAnomalies.disposed, true);
    assert.equal(removed.length, 4);
});
