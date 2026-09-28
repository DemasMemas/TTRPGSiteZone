const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const text = fs.readFileSync(path.join(__dirname, '../app/static/js/characterSheet.js'), 'utf8');
const begin = text.indexOf('async function confirmEquipMagazineDirect(');
const end = text.indexOf('\nwindow.reloadInstalledMagazine', begin);
const clone = value => JSON.parse(JSON.stringify(value));

function harness({ combat = true, deferred = false, fail = false } = {}) {
    const magazine = { id: 'new', name: 'Magazine', templateId: 5, ammo: [{ quantity: 4 }] };
    const data = { _revision: 1, weapons: [{ id: 'gun', name: 'Weapon', templateId: 3 }], inventory: { backpack: [magazine] } };
    const saved = clone(data);
    saved._revision = 2;
    if (!deferred && !fail) {
        saved.inventory.backpack = [];
        saved.weapons[0].installedMagazine = clone(magazine);
    }
    const modal = { inert: false };
    const sent = [], notices = [];
    const context = vm.createContext({
        medicalOperationInProgress: false, medicalRemoteUpdate: null, sheetSaveBlocked: false,
        autoSaveTimer: null, currentCharacterId: 1, currentCharacterData: data,
        document: { getElementById: () => modal },
        window: { currentLobbyId: 2, currentLocationId: 3,
            locationCombatState: combat ? { status: 'active', current_character: { character_id: 1, location_character_id: 4 } } : { status: 'idle' } },
        calculateInventoryAccess: async () => ({ retrievalActionPoints: 1, useActionDiscount: 0 }),
        showNotification: message => notices.push(message), refreshSavedSheet: async () => {},
        Server: {
            waitForCharacterSave: async () => {},
            async performLocationCombatAction(lobby, location, payload) {
                assert.equal(modal.inert, true);
                sent.push(clone(payload));
                if (fail) throw new Error('conflict');
                return { pending_action: deferred };
            },
            async installWeaponMagazine(id, payload) {
                sent.push(clone(payload));
                if (fail) throw new Error('conflict');
                return { data: saved };
            },
            async getCharacter() { return { data: saved }; },
            async updateCharacter() { throw new Error('No follow-up sheet mutation allowed'); },
        },
    });
    vm.runInContext(text.slice(begin, end), context);
    return { context, data, saved, modal, sent, notices,
        run: () => context.confirmEquipMagazineDirect(0, { item: magazine, path: ['inventory', 'backpack', 0] }) };
}

test('combat reload submits inventory selection and uses server result without local swapping', async () => {
    const h = harness();
    await h.run();
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].item_path, ['inventory', 'backpack', 0]);
    assert.equal(h.sent[0].magazine_selection.magazine.id, 'new');
    assert.equal(h.sent[0].magazine_selection.weapon.id, 'gun');
    assert.equal(h.sent[0].inventory_retrieval_action_points, 1);
    assert.equal(h.context.currentCharacterData, h.saved);
    assert.equal(h.data.inventory.backpack.length, 1);
    assert.equal(h.data.weapons[0].installedMagazine, undefined);
    assert.equal(h.modal.inert, false);
});

test('deferred reload does not install until the server completes it', async () => {
    const h = harness({ deferred: true });
    await h.run();
    assert.equal(h.context.currentCharacterData.weapons[0].installedMagazine, undefined);
    assert.equal(h.context.currentCharacterData.inventory.backpack[0].id, 'new');
    assert.equal(h.context.medicalOperationInProgress, false);
    assert.equal(h.modal.inert, false);
});

test('failed reload leaves local inventory intact and unlocks controls', async () => {
    const h = harness({ fail: true });
    await h.run();
    assert.equal(h.context.currentCharacterData, h.data);
    assert.equal(h.data.inventory.backpack[0].id, 'new');
    assert.ok(h.notices.includes('conflict'));
    assert.equal(h.context.medicalOperationInProgress, false);
    assert.equal(h.modal.inert, false);
});

test('out-of-combat reload uses a revision checked server request', async () => {
    const h = harness({ combat: false });
    await h.run();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].character_revision, 1);
    assert.equal(h.sent[0].action_key, undefined);
    assert.equal(h.context.currentCharacterData, h.saved);
});

test('two clicks do not pay for or apply two reloads', async () => {
    const h = harness();
    await Promise.all([h.run(), h.run()]);
    assert.equal(h.sent.length, 1);
});
