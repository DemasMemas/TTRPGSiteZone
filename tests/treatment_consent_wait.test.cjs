const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const start = source.indexOf('async function requestTreatmentConsent(');
const end = source.indexOf('\nasync function applyQuickMedicalConsumable(', start);
assert.ok(start >= 0 && end > start);

function harness({ delegated = false } = {}) {
    const notices = [];
    const pending = new Map();
    const scheduled = [];
    let cancelled = 0;
    let gmPrompts = 0;
    const requestData = {
        id: 73,
        status: 'pending',
        target_user_id: delegated ? 1 : 2,
        payload: delegated ? { gm_decision_for_offline_target: true } : {},
    };
    const context = vm.createContext({
        Server: {
            async createCharacterInteraction() { return requestData; },
            cancelCharacterInteraction() {
                cancelled++;
                return new Promise(() => {});
            },
        },
        window: { currentLobbyId: 8 },
        document: {
            createElement() {
                return {
                    style: {}, children: [],
                    append(...children) { this.children.push(...children); },
                    remove() { this.removed = true; },
                };
            },
            body: { appendChild(element) { notices.push(element); } },
        },
        getCurrentLocationId: () => 4,
        getCurrentUserId: () => 1,
        showNotification() {},
        showIncomingCharacterInteraction: async () => { gmPrompts++; },
        pendingCharacterInteractionResolvers: pending,
        characterTradeModal: null,
        setTimeout(callback) { scheduled.push(callback); return 1; },
        clearTimeout() {},
    });
    vm.runInContext(source.slice(start, end), context);
    return {
        context, notices, pending, scheduled,
        get cancelled() { return cancelled; },
        get gmPrompts() { return gmPrompts; },
    };
}

test('doctor can cancel consent wait even if server cancellation never responds', async () => {
    const testContext = harness({ delegated: true });
    const result = testContext.context.requestTreatmentConsent(10, 20, { item_name: 'Бинт' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(testContext.notices.length, 1);
    assert.equal(testContext.gmPrompts, 1);
    testContext.notices[0].children[1].onclick();
    assert.equal((await result).status, 'cancelled');
    assert.equal(testContext.cancelled, 1);
    assert.equal(testContext.pending.size, 0);
    assert.equal(testContext.notices[0].removed, true);
});

test('consent wait times out and releases the pending medical action', async () => {
    const testContext = harness();
    const result = testContext.context.requestTreatmentConsent(10, 20, { item_name: 'Бинт' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(testContext.scheduled.length, 1);
    testContext.scheduled[0]();
    assert.equal((await result).allowed, false);
    assert.equal(testContext.pending.size, 0);
});

test('GM receives a delegated consent request outside the patient location', async () => {
    const handlerStart = source.indexOf('export function handleCharacterInteractionRequest(');
    const handlerEnd = source.indexOf('\nexport function handleCharacterInteractionResolved(', handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
    let opened = 0;
    const context = vm.createContext({
        getCurrentLocationId: () => null,
        showIncomingCharacterInteraction: async () => { opened++; },
        showNotification() {},
    });
    vm.runInContext(source.slice(handlerStart, handlerEnd).replace('export function ', 'function '), context);
    context.handleCharacterInteractionRequest({
        location_id: 4,
        payload: { gm_decision_for_offline_target: true },
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened, 1);
});
