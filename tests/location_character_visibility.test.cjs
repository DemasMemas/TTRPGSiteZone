const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const style = fs.readFileSync(path.join(__dirname, '../app/static/style.css'), 'utf8');

function section(start, end) {
    const first = scene.indexOf(start);
    const last = scene.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return scene.slice(first, last).replaceAll('export ', '');
}

test('GM-hidden and camouflaged models restore their original appearance independently', () => {
    const material = { opacity: 1, clone() { return { ...this }; }, dispose() {} };
    const child = { isMesh: true, material, castShadow: true, receiveShadow: true };
    const entry = {
        model: { userData: {}, traverse(callback) { callback(child); } },
        label: { element: { style: {} } },
        gmHidden: false, camouflaged: false,
    };
    let refreshes = 0;
    const context = vm.createContext({
        window: { isGM: true },
        getCharacterModelEntry: () => entry,
        makeGmHiddenGhost(model) { model.userData.gmHiddenGhost = true; child.material.opacity = 0.38; },
        tintLocationMesh() {}, darknessFactorAt: () => 1,
        applyFogOfWar() { refreshes++; },
        renderCombatHud() {},
        combatState: null,
    });
    vm.runInContext(section('function applyCharacterVisibilityVisual(', 'export function updateCharacterPosition('), context);
    context.applyCharacterVisibilityVisual(1, { gmHidden: true });
    assert.notEqual(child.material, material);
    assert.equal(child.material.opacity, 0.38);
    context.applyCharacterVisibilityVisual(1, { camouflaged: true, gmHidden: false });
    assert.notEqual(child.material, material);
    context.applyCharacterVisibilityVisual(1, { camouflaged: false });
    assert.equal(child.material, material);
    assert.equal(child.castShadow, true);
    assert.equal(entry.label.element.style.opacity, '1');
    assert.equal(refreshes, 3);
});

test('hidden or camouflaged characters are not visible through fog memory', () => {
    const context = vm.createContext({
        isPointVisibleToPlayer: () => true,
        getTileHeight: () => 1,
    });
    vm.runInContext(section('function isCharacterVisibleToPlayer(', 'function isFogHiddenObject('), context);
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 1, posY: 1, gmHidden: true }, []), false);
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 1, posY: 1, camouflaged: true }, []), false);
    assert.equal(context.isCharacterVisibleToPlayer({ posX: 1, posY: 1 }, []), true);
    assert.match(scene, /if \(current\?\.gmHidden \|\| current\?\.camouflaged\) return false/);
    assert.match(scene, /if \(current\?\.gmHidden \|\| current\?\.camouflaged\) return;/);
});

test('location labels keep a dark surface while owner and team colors stay narrow accents', () => {
    const entry = { teamBadge: { style: {}, textContent: '' }, ownerId: 7,
        model: { traverse() {} }, label: { element: { style: { backgroundColor: 'rgba(17, 23, 20, 0.84)' } } } };
    const context = vm.createContext({
        getCharacterModelEntry: () => entry,
        characterModels: new Map([[1, entry]]),
        getUserColorHex: () => '#ff0000',
    });
    vm.runInContext(section('function normalizeTeamColor(', 'export function addCharacterToLocation('), context);
    context.updateCharacterTeamVisual(1, 'Долг', '#00ff00');
    assert.equal(entry.teamBadge.style.borderLeftColor, '#00ff00');
    assert.equal(entry.teamBadge.style.backgroundColor, undefined);
    assert.equal(entry.teamBadge.style.display, 'block');
    vm.runInContext(section('export function refreshUserColor(', 'export function applyCharacterPostureVisual('), context);
    context.refreshUserColor(7);
    assert.equal(entry.label.element.style.borderLeftColor, '#ff0000');
    assert.equal(entry.label.element.style.backgroundColor, 'rgba(17, 23, 20, 0.84)');
    assert.match(style, /\.location-character-label\s*\{[^}]*background: rgba\(17, 23, 20, 0\.84\)/);
    assert.match(scene, /div\.className = 'location-character-label'/);
});
