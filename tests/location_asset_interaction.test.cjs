const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');

test('camera drag suppresses one menu, but a stationary right click still opens it', async () => {
    const source = read('locationEditorPointer.js');
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const { createSecondaryDragGuard } = await import(url);
    let time = 100;
    const guard = createSecondaryDragGuard({ now: () => time });
    guard.begin(10, 10, 1);
    guard.move(12, 10, 1);
    guard.end();
    assert.equal(guard.shouldSuppressMenu(), false);
    guard.begin(10, 10, 1);
    guard.move(100, 100, 2);
    assert.equal(guard.shouldSuppressMenu(), false);
    guard.move(20, 10, 1);
    guard.end();
    assert.equal(guard.shouldSuppressMenu(), true);
    assert.equal(guard.shouldSuppressMenu(), false);
    guard.begin(10, 10, 1);
    assert.equal(guard.shouldSuppressMenu(), false);
    guard.end();
    time += 400;
    assert.equal(guard.shouldSuppressMenu(), false);
});

test('asset dimensions preserve legacy uniform scale and validate independent axes', () => {
    const source = read('locationAssetDimensions.js')
        .replace(/^import .*;\r?\n/, '')
        .replaceAll('export ', '');
    const context = vm.createContext({
        findLocationAsset: type => ({ tree: { dimensions: [0.92, 0.92, 1.72] } }[type]),
    });
    vm.runInContext(source, context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.assetDimensions({ scale: 2 }, 'decor', 'tree'))), {
        width: 1.84, depth: 1.84, height: 3.44,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(context.assetDimensions({ dimensions: [2, 0.1, 3] }, 'decor', 'tree'))), {
        width: 2, depth: 0.1, height: 3,
    });
    assert.equal(context.validAssetDimensions({ width: 2, depth: 0.02, height: 3 }), true);
    assert.equal(context.validAssetDimensions({ width: 2, depth: 0, height: 3 }), false);
    assert.equal(context.resizedAxis(100), 30);
    assert.deepEqual(JSON.parse(JSON.stringify(context.resizedUniformDimensions(
        { width: 2, depth: 1, height: 3 }, 1.5,
    ))), { width: 3, depth: 1.5, height: 4.5 });
    assert.equal(context.validAssetDimensions(context.resizedUniformDimensions(
        { width: 1, depth: 0.02, height: 1 }, 0.1,
    )), true);
});

test('location editor routes R to resize selected assets and keeps eraser fallback', () => {
    const quickMenu = read('mapEditorQuickMenu.js');
    const main = read('main.js');
    const scene = read('locationScene.js');
    assert.match(quickMenu, /event\.code === 'KeyR'[\s\S]*?locationAction\('resize'\)/);
    assert.match(main, /action === 'resize'[\s\S]*?getSelectedLocationEditorAsset\(\)/);
    assert.match(main, /data-asset-action="resize"/);
    assert.doesNotMatch(main, /data-location-action="resize"/);
    assert.match(scene, /commitEditorAssetResize\(\)/);
    assert.match(scene, /cameraDragMenuGuard\.shouldSuppressMenu\(\)/);
});

test('resize preview changes one axis and saves only after the click', async () => {
    const scene = read('locationScene.js');
    const start = scene.indexOf('function updateEditorResizePreview(');
    const end = scene.indexOf('async function commitEditorAssetRotation()', start);
    let saves = 0;
    const context = vm.createContext({
        editorResizeMode: true, editorResizeAxis: 'width',
        editorResizeDimensions: { width: 2, depth: 1, height: 1 },
        editorResizeBaseDimensions: { width: 2, depth: 1, height: 1 },
        editorResizeAnchor: null,
        getSelectedLocationEditorAsset: () => ({ kind: 'structure', x: 2, z: 3, rotation: 0, elevation: 0 }),
        getPointerWorldPoint: x => ({ x, z: 3.5 }),
        getTileHeight: () => 1,
        bearingToObjectRotation: () => 0,
        resizedAxis: value => Math.round(value * 100) / 100,
        notifyEditorResize() {}, updateBuildPreview() {},
        updateSelectedLocationAssetDetails: async details => { saves++; return details.dimensions.width === 4; },
        cancelLocationAssetResize() { this.cancelled = true; },
    });
    vm.runInContext(scene.slice(start, end), context);
    context.updateEditorResizePreview(3.5, 100);
    context.updateEditorResizePreview(4.5, 100);
    assert.equal(context.editorResizeDimensions.width, 4);
    assert.equal(context.editorResizeDimensions.depth, 1);
    assert.equal(saves, 0);
    await context.commitEditorAssetResize();
    assert.equal(saves, 1);
});

test('R starts with uniform preview across all three axes', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /editorResizeAxis = 'all';[\s\S]*?editorResizeDimensions = \{ \.\.\.selection\.dimensions \}/);
    const start = scene.indexOf('function updateEditorResizePreview(');
    const end = scene.indexOf('async function commitEditorAssetResize()', start);
    const dimensions = { width: 2, depth: 1, height: 3 };
    const context = vm.createContext({
        editorResizeMode: true, editorResizeAxis: 'all',
        editorResizeDimensions: { ...dimensions }, editorResizeBaseDimensions: { ...dimensions },
        editorResizeAnchor: null,
        getSelectedLocationEditorAsset: () => ({ x: 2, z: 3 }),
        resizedUniformDimensions: (base, factor) => Object.fromEntries(
            Object.entries(base).map(([axis, value]) => [axis, value * factor]),
        ),
        notifyEditorResize() {}, updateBuildPreview() {},
    });
    vm.runInContext(scene.slice(start, end), context);
    context.updateEditorResizePreview(100, 200);
    context.updateEditorResizePreview(150, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(context.editorResizeDimensions)), {
        width: 3, depth: 1.5, height: 4.5,
    });
    assert.match(read('main.js'), /data-resize-axis="all"/);
});

test('asset color is editable beyond lamps and is persisted on structures and decor', () => {
    const main = read('main.js');
    const scene = read('locationScene.js');
    assert.match(main, /<label>Цвет <input[^>]+data-asset-field="color"/);
    assert.match(scene, /color: source\.properties\?\.color/);
    assert.match(scene, /color: source\.color/);
    assert.match(scene, /\.\.\.\(color !== undefined \? \{ color \} : \{\}\)/);
    assert.match(scene, /if \(color !== undefined\) source\.color = color/);
});

test('local water has a solid backing and surface grid fits both map dimensions', async () => {
    const local = read('locationScene.js');
    const world = read('lobby3d.js');
    assert.match(local, /const waterMaterial = new THREE\.MeshStandardMaterial\(\{ color: 0xffffff \}\)/);
    assert.match(local, /WATER_SIDE_COLORS = \{ grass: 0x183c4a/);
    assert.match(local, /new THREE\.InstancedMesh\(geometry\.clone\(\), \[/);
    assert.match(local, /waterMaterial, waterMaterial, waterTopMaterial/);
    assert.match(world, /const waterMat = createWaterMaterial\(\)/);
    assert.match(local, /buildTerrainGridData\(currentLocationData\.tiles_data, uncovered\)/);
    const terrain = read('locationTerrain.js');
    const url = `data:text/javascript;base64,${Buffer.from(terrain).toString('base64')}`;
    const { buildTerrainGridData } = await import(url);
    const tiles = Array.from({ length: 3 }, () => Array.from({ length: 2 }, () => ({ terrain: 'water', height: 1 })));
    const grid = buildTerrainGridData(tiles);
    const xs = grid.positions.filter((_, index) => index % 3 === 0);
    const zs = grid.positions.filter((_, index) => index % 3 === 2);
    assert.equal(Math.min(...xs), 0);
    assert.equal(Math.max(...xs), 2);
    assert.equal(Math.min(...zs), 0);
    assert.equal(Math.max(...zs), 3);
});

test('anomaly label stays outside the pulsing visual group', () => {
    const source = read('anomalies.js');
    assert.match(source, /group\.userData\.anomalyVisual = visual/);
    assert.match(source, /if \(label\) group\.add\(label\)/);
    assert.match(source, /visual\.scale\.setScalar\(pulse\)/);
    assert.doesNotMatch(source, /node\.scale\.setScalar\(pulse\)/);
});

test('rebuilding anomaly tile retains its effect model instead of replacing it with an empty mesh', () => {
    const source = read('locationScene.js');
    const start = source.indexOf('function rebuildTileObjects(tileX, tileZ)');
    const end = source.indexOf('// ========== Обновления из сокета ==========', start);
    assert.ok(start >= 0 && end > start);
    const anomaly = { type: 'anomaly', anomalyType: 'electric', anomalyKey: 'tesla', scale: 1.5 };
    const effect = {
        userData: { anomalyEffect: {} },
        position: { set(x, y, z) { Object.assign(this, { x, y, z }); } },
        rotation: { y: 0 },
        scale: { y: 1 },
    };
    const added = [];
    const context = vm.createContext({
        currentLocationData: { tiles_data: [[{ height: 1, objects: [anomaly] }]] },
        objectMeshes: [], anomalyEffectMeshes: [],
        scene: { add(mesh) { added.push(mesh); }, remove() {} },
        THREE: {
            Mesh: class { constructor() { throw new Error('anomaly effect was replaced'); } },
            MathUtils: { degToRad: value => value * Math.PI / 180 },
        },
        createAnomalyEffect: () => effect,
        applyDecorSize(mesh, obj, type) { assert.equal(mesh, effect); assert.equal(type, 'anomaly'); },
        clampAssetElevation: value => Number(value) || 0,
        window: { isGM: true },
    });
    vm.runInContext(source.slice(start, end), context);
    context.rebuildTileObjects(0, 0);
    assert.equal(added[0], effect);
    assert.equal(context.objectMeshes[0], effect);
    assert.equal(context.anomalyEffectMeshes[0], effect);
});
