const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/characterSheet.js'), 'utf8');
const begin = source.indexOf('async function submitAmmunitionLoading(');
const end = source.indexOf('async function inventoryItemPreparationPayments(', begin);
const clone = value => JSON.parse(JSON.stringify(value));

function harness({ combat = true, deferred = false, fail = false, cancel = false } = {}) {
    const data = { _revision: 1, inventory: { pockets: [{ id: 'ammo', quantity: 12 }] } };
    const saved = clone(data);
    saved._revision = 2;
    if (!deferred) saved.inventory.pockets[0].quantity = 9;
    const modal = { inert: false };
    const sent = [], notices = [];
    const context = vm.createContext({
        medicalOperationInProgress: false, medicalRemoteUpdate: null, sheetSaveBlocked: false,
        autoSaveTimer: null, currentCharacterId: 1, currentCharacterData: data,
        document: { getElementById: () => modal },
        window: { currentLobbyId: 2, currentLocationId: 3,
            locationCombatState: combat ? { status: 'active', current_character: { character_id: 1, location_character_id: 4 } } : { status: 'idle' } },
        chooseAmmunitionPayment: async () => cancel ? null : { actionPoints: 6, freeActions: 1 },
        showNotification: message => notices.push(message), refreshSavedSheet: async () => {},
        Server: {
            waitForCharacterSave: async () => {},
            async performLocationCombatAction(lobby, location, payload) {
                assert.equal(modal.inert, true);
                sent.push(clone(payload));
                if (fail) throw new Error('conflict');
                return { pending_action: deferred };
            },
            async loadAmmunition(id, payload) {
                sent.push(clone(payload));
                if (fail) throw new Error('conflict');
                return { data: saved };
            },
            async getCharacter() { return { data: saved }; },
            async spendLocationCombatResources() { throw new Error('No separate payment'); },
            async updateCharacter() { throw new Error('No follow-up sheet mutation'); },
        },
    });
    vm.runInContext(source.slice(begin, end), context);
    return { context, data, saved, modal, sent, notices,
        run: () => context.submitAmmunitionLoading({ target_path: ['inventory', 'backpack', 0],
            source_path: ['inventory', 'pockets', 0], quantity: 3, selection: { source_path: data.inventory.pockets[0] } }) };
}

test('loading sends selection, quantity and payment in one request; no local ammo mutation', async () => {
    const h = harness();
    await h.run();
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].action_key, 'load_ammunition');
    assert.equal(h.sent[0].loading.quantity, 3);
    assert.equal(h.sent[0].loading.selection.source_path.id, 'ammo');
    assert.equal(h.sent[0].loading.action_points, 6);
    assert.equal(h.sent[0].loading.free_actions, 1);
    assert.equal(h.data.inventory.pockets[0].quantity, 12);
    assert.equal(h.context.currentCharacterData, h.saved);
    assert.equal(h.modal.inert, false);
});

test('deferred loading keeps ammunition until the server completes it', async () => {
    const h = harness({ deferred: true });
    await h.run();
    assert.equal(h.context.currentCharacterData.inventory.pockets[0].quantity, 12);
    assert.ok(h.sent[0].pending_action_id);
    assert.equal(h.context.medicalOperationInProgress, false);
});

test('failed loading leaves inventory intact and releases lock', async () => {
    const h = harness({ fail: true });
    assert.equal(await h.run(), null);
    assert.equal(h.context.currentCharacterData, h.data);
    assert.equal(h.modal.inert, false);
    assert.equal(h.context.medicalOperationInProgress, false);
    assert.ok(h.notices.includes('conflict'));
});

test('outside combat loading sends the current revision', async () => {
    const h = harness({ combat: false });
    await h.run();
    assert.equal(h.sent[0].character_revision, 1);
    assert.equal(h.sent[0].action_key, undefined);
    assert.equal(h.context.currentCharacterData, h.saved);
});

test('payment cancellation and duplicate clicks cannot consume ammo', async () => {
    const cancelled = harness({ cancel: true });
    await cancelled.run();
    assert.equal(cancelled.sent.length, 0);
    assert.equal(cancelled.context.currentCharacterData, cancelled.data);
    assert.equal(cancelled.modal.inert, false);
    const h = harness();
    await Promise.all([h.run(), h.run()]);
    assert.equal(h.sent.length, 1);
});

test('legacy loading closures are removed and both full-load buttons use server mutation', () => {
    assert.ok(!source.includes('pendingMagazineLoadingActions'));
    assert.ok(!source.includes('transferAmmoFromSource'));
    assert.ok(!source.includes('chooseAndSpendDeferredCombatPayment'));
    assert.equal((source.match(/source_path: selected.path, full: true/g) || []).length, 2);
});
