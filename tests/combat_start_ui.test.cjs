const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/characterSheet.js'), 'utf8');

test('attack shortcut expands equipped weapon and scrolls to its actions', async () => {
    const start = source.indexOf('export async function openCharacterAttackSheet(');
    const end = source.indexOf('\nexport function closeCharacterSheet(', start);
    assert.ok(start >= 0 && end > start);
    const weaponsPanel = { open: false };
    const equippedPanel = {
        open: false,
        scrollIntoView(options) { this.scrolled = options; },
    };
    const tab = {
        classList: { contains: value => value === 'active' },
        querySelector(selector) {
            if (selector.includes('weapon-1')) return equippedPanel;
            if (selector.includes('"weapons"')) return weaponsPanel;
            return null;
        },
    };
    const context = vm.createContext({
        currentCharacterId: null,
        currentCharacterData: { activeWeaponIndex: 1 },
        window: { locationCombatState: null },
        document: { getElementById: () => tab },
        async openCharacterSheet(characterId, tabId) {
            assert.equal(tabId, 'equipment');
            context.currentCharacterId = characterId;
        },
        requestAnimationFrame(callback) { callback(); },
    });
    vm.runInContext(source.slice(start, end).replace('export async function', 'async function'), context);
    await context.openCharacterAttackSheet(7);
    assert.equal(weaponsPanel.open, true);
    assert.equal(equippedPanel.open, true);
    assert.equal(equippedPanel.scrolled.block, 'start');
});

test('attack on a sublocation outside combat requests approval without spending ammunition', async () => {
    const start = source.indexOf('window.useWeaponFromEquipment = function(');
    const end = source.indexOf('\nwindow.useMeleeAttack = function(', start);
    assert.ok(start >= 0 && end > start);
    let requestedCharacterId = null;
    const weapon = { name: 'Rifle', templateId: 1, ammo: 5 };
    const context = vm.createContext({
        window: { isLocationActive: true, locationCombatState: null },
        currentCharacterData: { weapons: [weapon] },
        currentCharacterId: 7,
        allTemplatesCache: [],
        getWeaponFireProfile: () => ({ single_shot_options: [1] }),
        getWeaponAmmoCount: item => item.ammo,
        sceneModule: { requestCombatStartForAttack(id) { requestedCharacterId = id; } },
        showNotification() { throw new Error('Attack should request combat instead of firing'); },
    });
    const code = source.slice(start, end).replaceAll("import('./locationScene.js')", 'Promise.resolve(sceneModule)');
    vm.runInContext(code, context);
    context.window.useWeaponFromEquipment(0);
    await new Promise(setImmediate);
    assert.equal(requestedCharacterId, 7);
    assert.equal(weapon.ammo, 5);
});

test('GM can choose whether the attacker acts first when starting combat', () => {
    const sceneSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const apiSource = fs.readFileSync(path.join(__dirname, '../app/static/js/api.js'), 'utf8');
    assert.match(sceneSource, /class="combat-initiator-first" checked/);
    assert.match(sceneSource, /list\.querySelectorAll\('input\[type="checkbox"\]:checked'\)/);
    assert.match(sceneSource, /initiatorFirst \? initiatorLocationCharacterId : null/);
    assert.match(sceneSource, /'approve', selectedIds,\s+initiatorFirst/);
    assert.match(apiSource, /initiator_first: initiatorFirst/);
});
