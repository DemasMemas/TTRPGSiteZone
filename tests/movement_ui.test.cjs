const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
function functionSource(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0);
    return source.slice(start, source.indexOf('\n}', start) + 2);
}

function movementContext(current = {}) {
    const context = vm.createContext({
        armedMovementEvasion: false,
        combatState: { round_number: 1, current_character: {
            action_points_current: 20, free_actions_current: 1,
            movement_points_current: 50, posture: 'standing', ...current,
        } },
    });
    for (const name of ['COMBAT_MOVEMENT_TYPES', 'COMBAT_POSTURES']) {
        const start = source.indexOf(`const ${name} =`);
        vm.runInContext(source.slice(start, source.indexOf('\n};', start) + 3), context);
    }
    vm.runInContext(functionSource('getMovementModeRouteCost'), context);
    vm.runInContext(functionSource('getMovementModeAvailability'), context);
    return context;
}

test('evasion shows reduced movement distances and disallows correction', () => {
    const context = movementContext();
    for (const [mode, distance] of [['walk', 7], ['run', 15], ['sprint', 23]]) {
        const result = context.getMovementModeAvailability(mode, null, true);
        assert.equal(result.allowed, true);
        assert.equal(result.remainingDistance, distance);
    }
    assert.equal(context.getMovementModeAvailability('correction', null, true).allowed, false);
});

test('continuing movement uses authoritative evasion and does not repay run AP', () => {
    const context = movementContext({
        movement_mode_this_turn: 'run', movement_evasion: true,
        movement_distance_this_turn: 14, strenuous_movement_blocked_until_round: 2,
    });
    const allowed = context.getMovementModeAvailability('run', { cost: 1, distance: 1 }, false);
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.remainingDistance, 1);
    assert.equal(allowed.modeActionPoints, 0);
    assert.equal(context.getMovementModeAvailability('run', { cost: 2, distance: 2 }).allowed, false);
});

test('remembered models stay at the observed position and cannot be picked', () => {
    const disabledRaycast = () => {};
    const child = { isMesh: true };
    const root = {
        userData: {}, rotation: {}, position: { set(...values) { this.values = values; } },
        traverse(callback) { callback(child); },
    };
    const context = vm.createContext({
        createCharacterModel: () => root,
        setFogGhostAppearance: (model) => { child.raycast = disabledRaycast; return model; },
        applyFogGhostPosture() {},
    });
    vm.runInContext(functionSource('createCharacterFogGhost'), context);
    const ghost = context.createCharacterFogGhost({ posX: 5, posY: 3, height: 1, posture: 'standing' });
    assert.equal(child.raycast, disabledRaycast);
    assert.deepEqual(root.position.values, [5.5, 1, 3.5]);
    assert.equal(ghost.userData.rememberedCharacter, undefined);
});

test('a crouching target hidden by a low cover keeps its last visible snapshot', () => {
    const entry = { posX: 2, posY: 0, posture: 'standing', facingY: 0 };
    const memory = new Map([['2:0', { height: 1 }], ['3:0', { height: 1 }]]);
    const context = vm.createContext({
        fogMemory: memory, characterModels: new Map([[42, entry]]),
        getTileHeight: () => 1,
        isPointVisibleToPlayer: (x, y, height) => x === 2 && height > 2.5,
    });
    vm.runInContext(functionSource('isCharacterVisibleToPlayer'), context);
    vm.runInContext(functionSource('rememberVisibleCharacters'), context);
    context.rememberVisibleCharacters([]);
    const snapshot = JSON.stringify(memory.get('2:0').characters);
    entry.posture = 'sitting';
    assert.equal(context.isCharacterVisibleToPlayer(entry, []), false);
    assert.equal(context.rememberVisibleCharacters([]), false);
    entry.posX = 3;
    context.rememberVisibleCharacters([]);
    assert.equal(JSON.stringify(memory.get('2:0').characters), snapshot);
    assert.equal(memory.get('3:0').characters, undefined);
    context.isPointVisibleToPlayer = () => true;
    context.rememberVisibleCharacters([]);
    assert.equal(memory.get('2:0').characters.length, 0);
    assert.equal(memory.get('3:0').characters[0].posX, 3);
});

test('actual sight ray sees a standing head but not a crouching head behind low cover', () => {
    const context = vm.createContext({
        FOG_VIEW_RADIUS: 25, FOG_VIEW_HALF_ANGLE: Math.PI / 3,
        getTileHeight: () => 1,
        getVisionBlockerHeight: (x, y) => x === 1 && y === 0 ? 2.5 : -Infinity,
    });
    for (const name of ['visionEyeHeight', 'hasLineOfSight', 'isPointVisibleToPlayer', 'isCharacterVisibleToPlayer']) {
        vm.runInContext(functionSource(name), context);
    }
    const sources = [{ posX: 0, posY: 0, posture: 'standing', facingX: 1, facingY: 0 }];
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 2, posY: 0, posture: 'standing' }, sources), true);
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 2, posY: 0, posture: 'sitting' }, sources), false);
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 2, posY: 0, posture: 'prone' }, sources), false);
    const sideObserver = { posX: 2, posY: 2, posture: 'standing', facingX: 0, facingY: -1 };
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 2, posY: 0, posture: 'sitting' }, [sideObserver]), true);
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 2, posY: 0, posture: 'sitting' }, [...sources, sideObserver]), true);
    const rearObserver = { posX: 4, posY: 0, posture: 'standing', facingX: -1, facingY: 0 };
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 2, posY: 0, posture: 'sitting' }, [rearObserver]), true);
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 2, posY: 3, posture: 'standing' }, sources), true);
});

test('evasion is an unchecked independent checkbox next to automatic MP conversion', () => {
    const context = movementContext();
    const buttons = [];
    const options = { appendChild(button) { buttons.push(button); } };
    const checkbox = {};
    const menu = {
        style: {}, innerHTML: '',
        querySelector(selector) { return selector === '.movement-type-options' ? options : checkbox; },
    };
    Object.assign(context, {
        ensureMovementTypeMenu: () => menu,
        movementModeSummary: () => '',
        closeMovementTypeMenu() {},
        document: { createElement: () => ({ style: {} }) },
    });
    vm.runInContext(functionSource('showMovementTypeMenu'), context);
    context.showMovementTypeMenu(1);
    const input = menu.innerHTML.match(/<input[^>]*id="movement-evasion"[^>]*>/)[0];
    assert.ok(!input.includes('checked'));
    assert.ok(menu.innerHTML.includes('id="movement-gain-op-if-needed"'));
    assert.equal(buttons.length, 5);
    buttons.length = 0;
    context.showMovementTypeMenu(1, true);
    assert.match(menu.innerHTML, /id="movement-evasion" checked/);
    assert.equal(buttons.length, 5);
});
