const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const lightingSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationLighting.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(lightingSource).toString('base64')}`;

test('world lighting follows time while manual lighting ignores it', async () => {
    const { resolveLocationLighting } = await import(moduleUrl);
    const morning = resolveLocationLighting({ mode: 'world' }, 480);
    const night = resolveLocationLighting({ mode: 'world' }, 60);
    assert.ok(morning.directional_intensity > night.directional_intensity);
    const manual = { mode: 'manual', ambient_intensity: 0.15, directional_intensity: 0,
        local_lights: [{ x: 3, z: 4, height: 2, color: '#ffc477', intensity: 3, distance: 6 }] };
    assert.deepEqual(resolveLocationLighting(manual, 60), resolveLocationLighting(manual, 840));
});

test('side inspector saves live lighting while location edits avoid resending unchanged tiles', () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    assert.match(source, /const settings = environmentEditor\.get\(\)/);
    assert.match(source, /Server\.updateLocation\(currentLobbyId, currentLocationData\.id, \{ lighting: settings \}\)/);
    assert.match(source, /applyLocationLighting\(settings, false\)/);
    assert.match(source, /if \(tempTiles \|\| newWidth !== locationData\.grid_width \|\| newHeight !== locationData\.grid_height\) \{\s*updates\.tiles_data = finalTiles;/);
});

test('lighting editor fields share the location editor control styling', () => {
    const editor = fs.readFileSync(path.join(__dirname, '../app/static/js/locationLightingEditor.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../app/static/style.css'), 'utf8');
    assert.match(editor, /class="location-lighting-field location-lighting-mode"/);
    assert.match(editor, /class="location-lighting-manual"/);
    assert.doesNotMatch(editor, /style="/);
    assert.match(css, /\.map-editor-section \.form-control \{[^}]*background: var\(--input-bg\);[^}]*border: 1px solid var\(--input-border\);/);
    assert.match(css, /\.location-environment-editor \.form-control \{\s*width: 100%;/);
    assert.match(css, /\.location-lighting-manual \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test('asset library offers structures, decor and preset lamps without a lamp list modal', async () => {
    const catalogSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetCatalog.js'), 'utf8');
    const catalogUrl = `data:text/javascript;base64,${Buffer.from(catalogSource).toString('base64')}`;
    const { LOCATION_ASSETS, findLocationAsset } = await import(catalogUrl);
    assert.ok(LOCATION_ASSETS.some(asset => asset.kind === 'structure'));
    assert.ok(LOCATION_ASSETS.some(asset => asset.kind === 'decor'));
    assert.equal(findLocationAsset('spot_lamp').lightKind, 'spot');
    assert.equal(findLocationAsset('warm_lamp').kind, 'lamp');
    assert.equal(findLocationAsset('poster').elevation, 1.6);

    const editor = fs.readFileSync(path.join(__dirname, '../app/static/js/locationLightingEditor.js'), 'utf8');
    assert.doesNotMatch(editor, /data-add-light|location-lighting-sources/);
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /placeSelectedLocationAsset\(hoveredTileCoords\.x, hoveredTileCoords\.z\)/);
    assert.match(scene, /commitEditorAssetMove\(point\?\.x \?\? hoveredTileCoords\.x \+ 0\.5/);
    assert.match(scene, /beginRotateSelectedLocationAsset/);
});

test('cursor bearing matches object rotation without mirroring', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetTransforms.js'), 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    const { bearingFromDelta, bearingToObjectRotation, objectRotationToBearing, clampAssetElevation } = await import(url);
    assert.equal(bearingFromDelta(1, 0), 0);
    assert.equal(bearingFromDelta(0, 1), 90);
    assert.equal(bearingFromDelta(-1, 0), 180);
    assert.equal(bearingFromDelta(1, 1, true), 45);
    assert.equal(bearingToObjectRotation(90), -Math.PI / 2);
    assert.equal(objectRotationToBearing(-Math.PI / 2), 90);
    assert.equal(clampAssetElevation(12), 10);
    assert.equal(clampAssetElevation(-2), 0);
});

test('legacy decor angle control displays a wall poster direction without clamping it to zero', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('export function setLocationBrushObjectRotation(rot)');
    const end = scene.indexOf('// ========== Остальные экспорты', start);
    const input = { value: '' };
    const span = { textContent: '' };
    const context = vm.createContext({
        brushObjectRotation: 0,
        document: { getElementById: id => id === 'loc-obj-rotation' ? input : span },
    });
    vm.runInContext(scene.slice(start, end).replace('export ', ''), context);
    context.setLocationBrushObjectRotation(-90);
    assert.equal(context.brushObjectRotation, 270);
    assert.equal(input.value, '270');
    assert.equal(span.textContent, '270°');
});

test('map rotation previews the cursor angle and commits only on click', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    assert.match(main, /beginRotateSelectedLocationAsset\(\)/);
    assert.match(scene, /updateEditorRotatePreview\(e\.clientX, e\.clientY, e\.shiftKey\)/);
    assert.match(scene, /commitEditorAssetRotation\(\)/);
    const start = scene.indexOf('function updateEditorRotatePreview(clientX, clientY, snap = false)');
    const end = scene.indexOf('async function commitEditorAssetMove(x, z)', start);
    assert.ok(start >= 0 && end > start);
    const previews = [];
    const saved = [];
    const selected = {
        kind: 'lamp', lightKind: 'spot', x: 3.5, z: 4.5,
        height: 2, intensity: 3, distance: 8, color: '#ffe0aa', rotation: 0,
    };
    const context = vm.createContext({
        editorRotateMode: true,
        editorSelection: { kind: 'lamp', index: 0 },
        editorRotateAngle: 0,
        getSelectedLocationEditorAsset: () => selected,
        getPointerWorldPoint: () => ({ x: 4.5, z: 5.5 }),
        getTileHeight: () => 0,
        bearingFromDelta: (x, z, snap) => snap ? Math.round(Math.atan2(z, x) * 180 / Math.PI / 15) * 15 : Math.round(Math.atan2(z, x) * 180 / Math.PI),
        previewSelectedLocationLamp: details => previews.push(details),
        updateSelectedLocationAssetDetails: async details => { saved.push(details); return true; },
        updateBuildPreview() {},
    });
    vm.runInContext(scene.slice(start, end), context);
    context.updateEditorRotatePreview(0, 0, true);
    assert.equal(context.editorRotateAngle, 45);
    assert.equal(previews[0].rotation, 45);
    assert.equal(saved.length, 0);
    await context.commitEditorAssetRotation();
    assert.equal(saved[0].rotation, 45);
    assert.equal(context.editorRotateMode, false);
});

test('poster offset and elevation survive moving it to another tile', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('export async function updateSelectedLocationAssetDetails(');
    const end = scene.indexOf('export function previewSelectedLocationLamp(', start);
    assert.ok(start >= 0 && end > start);
    const source = { type: 'poster', x: 0, z: 0.13, rotation: -90, elevation: 1.6 };
    const tiles = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ objects: [] })));
    tiles[1][1].objects.push(source);
    const sent = [];
    const context = vm.createContext({
        editorSelection: { kind: 'decor', x: 1, z: 1, index: 0 },
        currentLocationData: { grid_width: 5, grid_height: 5, tiles_data: tiles },
        getSelectedEditorSource: () => source,
        clampAssetElevation: value => Math.max(0, Math.min(10, Number(value) || 0)),
        sendDecorTileUpdates: positions => sent.push(positions),
        showNotification() {},
    });
    vm.runInContext(scene.slice(start, end).replace('export ', ''), context);
    assert.equal(await context.updateSelectedLocationAssetDetails({ x: 2.5, z: 3.63, rotation: 90, elevation: 2 }), true);
    assert.equal(tiles[1][1].objects.length, 0);
    assert.equal(tiles[3][2].objects[0], source);
    assert.equal(source.rotation, -90);
    assert.equal(source.elevation, 2);
    assert.ok(Math.abs(source.z - 0.13) < 0.00001);
    assert.equal(sent.length, 1);
});

test('structure rotation and elevation save in Three.js coordinates', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('export async function updateSelectedLocationAssetDetails(');
    const end = scene.indexOf('export function previewSelectedLocationLamp(', start);
    const source = { id: 7, properties: { rotation: 0, elevation: 0 } };
    let saved;
    const context = vm.createContext({
        editorSelection: { kind: 'structure', id: 7 },
        currentLocationData: { grid_width: 5, grid_height: 5 },
        getSelectedEditorSource: () => source,
        window: { currentLobbyId: 19 },
        Server: { updateLocationObject: async (_lobby, _id, payload) => { saved = payload; return source; } },
        bearingToObjectRotation: bearing => -bearing * Math.PI / 180,
        clampAssetElevation: value => Math.max(0, Math.min(10, Number(value) || 0)),
        updateLocationObject() {},
        notifyEditorSelection() {},
        showNotification() {},
    });
    vm.runInContext(scene.slice(start, end).replace('export ', ''), context);
    assert.equal(await context.updateSelectedLocationAssetDetails({ x: 2.25, z: 3.75, rotation: 90, elevation: 2.1 }), true);
    assert.equal(saved.tile_x, 2);
    assert.equal(saved.tile_y, 3);
    assert.equal(saved.properties.offset_x, -0.25);
    assert.equal(saved.properties.offset_z, 0.25);
    assert.equal(saved.properties.rotation, -Math.PI / 2);
    assert.equal(saved.properties.elevation, 2.1);
});

test('clicking a tile places the chosen lamp at its center', async () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const start = scene.indexOf('async function placeSelectedLocationAsset(x, z)');
    const end = scene.indexOf('export function loadLocation(data)', start);
    assert.ok(start >= 0 && end > start);
    const saved = [];
    const context = vm.createContext({
        selectedLocationAsset: {
            id: 'warm_lamp', kind: 'lamp', height: 2.2,
            color: '#ffd090', intensity: 2.5, distance: 8,
        },
        currentLocationData: { lighting: { local_lights: [] } },
        assetDimensions: () => ({ width: 0.36, depth: 0.36, height: 0.36 }),
        persistLocationLights: async lights => { saved.push(lights); return true; },
        editorSelection: null,
        updateEditorSelectionVisual() {},
        notifyEditorSelection() {},
    });
    vm.runInContext(scene.slice(start, end), context);
    await context.placeSelectedLocationAsset(3, 4);
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0].x, 3.5);
    assert.equal(saved[0][0].z, 4.5);
    assert.equal(saved[0][0].kind, 'point');
    assert.deepEqual(JSON.parse(JSON.stringify(saved[0][0].dimensions)), {
        width: 0.36, depth: 0.36, height: 0.36,
    });
    assert.equal(context.editorSelection.index, 0);
});
