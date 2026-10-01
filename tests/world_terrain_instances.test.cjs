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

function harness() {
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
    const entry = { ground, water, tilesData, terrainVisible: true, bounds: { max: { y: 4.5 } } };
    const context = vm.createContext({
        THREE: { Object3D, Color }, terrainColors: { grass: 1, rock: 2 },
        CHUNK_SIZE: 2, chunksMap: new Map([['0,0', entry]]),
        markWorldShadowsDirty() {}, updateTileObjectsPositions() {},
        requestAnimationFrame() {}, cancelAnimationFrame() {}, rebuildChunkObjects() {},
        lastHoverRaycastAt: 0,
    });
    vm.runInContext(source.slice(fillStart, fillEnd)
        + source.slice(updateStart, updateEnd).replace('export ', ''), context);
    Object.assign(entry, context.fillChunkTerrainInstances(ground, water, tilesData, 0, 0));
    return { context, entry, ground, water };
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
    assert.match(source, /new THREE\.InstancedMesh\(groundGeo, waterMat, totalTiles\)/);
    assert.match(source, /groundInstances\.frustumCulled = false/);
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
    assert.deepEqual(water.matrices[0].scale, [1, 5, 1]);
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
        markWorldShadowsDirty() {}, lastChunkVisibilityAt: 0, lastHoverRaycastAt: 0,
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
