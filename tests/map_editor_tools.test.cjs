const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '../app/static/js', file), 'utf8');

test('world editor tool selection keeps eraser and toolbar state in sync', () => {
    const source = read('mapEdit.js');
    const start = source.indexOf('export function selectWorldEditorTool(');
    const end = source.indexOf('\nexport function getEditMode()', start);
    assert.ok(start >= 0 && end > start);
    const buttons = ['select', 'terrain', 'height', 'erase'].map(tool => ({
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
        AppState: state, window: {},
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
    context.selectWorldEditorTool('unknown');
    assert.equal(context.window.worldEditorTool, 'select');
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

    const main = read('main.js');
    assert.match(main, /select: createToolSection\('Выбор', \[\]\)/);
    assert.match(main, /expandMapToolsPanelOnToolChange\(previousTool, tool\)/);
    assert.match(main, /selectWorldEditorTool\('select', \{ autoExpand: false \}\)/);
    assert.match(fs.readFileSync(path.join(__dirname, '../app/templates/lobby.html'), 'utf8'), /data-world-settings="select"[\s\S]*?data-map-editor-auto-expand/);
});

test('location brush uses one active tool, while Alt and Shift still override it', () => {
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
    context.window.locationEditorTool = 'height';
    assert.deepEqual(updates({}), { height: 2 });
    context.window.locationEditorTool = 'radiation';
    assert.deepEqual(updates({}), { radiation: 4 });
    context.window.locationEditorTool = 'decor';
    assert.deepEqual(updates({}), { addObject: true });
    context.window.locationEditorTool = 'erase';
    assert.deepEqual(updates({}), { objects: [] });
    context.window.locationEditorTool = 'select';
    assert.deepEqual(updates({ altKey: true }), { terrain: 'sand' });
    assert.deepEqual(updates({ shiftKey: true }), { height: 2 });
});

test('world brush paints on pointer press without waiting for the window click', () => {
    const source = read('lobby3d.js');
    const start = source.indexOf('function canvasMouseDownHandler(');
    const end = source.indexOf("\nrenderer.domElement.addEventListener('mousedown'", start);
    assert.ok(start >= 0 && end > start);
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
    assert.equal(painted.length, 2);
    context.window.isWorldTravelSelectionActive = () => true;
    context.canvasMouseDownHandler({ ...event, altKey: true });
    assert.equal(painted.length, 2);

    const clickStart = source.indexOf("window.addEventListener('click', (event) => {", end);
    const clickEnd = source.indexOf("\nwindow.addEventListener('dblclick'", clickStart);
    assert.doesNotMatch(source.slice(clickStart, clickEnd), /tileClickCallback/);
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
});

test('held Q selects the highlighted full-ring sector on release', () => {
    const source = read('mapEditorQuickMenu.js').replaceAll('export ', '');
    const listeners = {};
    const appended = [];
    const selected = [];
    let enabled = true;
    let location = false;
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
    });
    listeners.pointermove({ clientX: 400, clientY: 300 });
    const press = code => listeners.keydown({
        code, repeat: false, altKey: false, ctrlKey: false, metaKey: false,
        target: { closest() { return null; } },
        preventDefault() {}, stopImmediatePropagation() {},
    });
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
    assert.deepEqual(selected, ['terrain', 'terrain', 'erase']);
    assert.equal(appended.at(-1).removed, true);
});
