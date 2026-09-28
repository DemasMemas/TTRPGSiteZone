const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/deferredCombatActions.js'), 'utf8');
const load = () => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const state = () => ({ status: 'active', current_character: { location_character_id: 7,
    deferred_action: { id: 'saved', action_key: 'attack', status: 'ready', server_executable: true } } });

test('fresh client resumes by saved ID without a local map, target or weapon parameters', async () => {
    const { createDeferredActionResumer } = await load();
    const sent = [];
    const resume = createDeferredActionResumer({ send: async payload => sent.push(payload), canResume: () => true, notify() {} });
    await resume(state());
    await resume(state());
    assert.deepEqual(sent, [{ location_character_id: 7, action_key: 'attack', resume_pending_action_id: 'saved' }]);
});

test('repeated socket events and manual clicks do not start simultaneous requests', async () => {
    const { createDeferredActionResumer } = await load();
    let release, calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const resume = createDeferredActionResumer({ send: async () => { calls++; await gate; }, canResume: () => true, notify() {} });
    const pending = resume(state());
    await resume(state(), { force: true });
    assert.equal(calls, 1);
    release();
    await pending;
});

test('errors do not cause an automatic retry loop; explicit retry remains possible', async () => {
    const { createDeferredActionResumer } = await load();
    let calls = 0, notices = 0;
    const resume = createDeferredActionResumer({ send: async () => { calls++; throw new Error('Target moved'); },
        canResume: () => true, notify: () => notices++ });
    await resume(state());
    await resume(state());
    assert.equal(calls, 1);
    await resume(state(), { force: true });
    assert.equal(calls, 2);
    assert.equal(notices, 2);
});

test('observers, unpaid actions, ended combat and client-side reloads do not auto-resume', async () => {
    const { createDeferredActionResumer } = await load();
    let calls = 0, allowed = false;
    const resume = createDeferredActionResumer({ send: async () => calls++, canResume: () => allowed, notify() {} });
    await resume(state());
    allowed = true;
    const unpaid = state(); unpaid.current_character.deferred_action.status = 'paying';
    await resume(unpaid);
    const ended = state(); ended.status = 'idle';
    await resume(ended);
    const reload = state(); reload.current_character.deferred_action.server_executable = false;
    await resume(reload);
    assert.equal(calls, 0);
    await resume(state());
    assert.equal(calls, 1);
});

test('medical recovery waits for the initiating item lock and then resumes once', async () => {
    const { createDeferredActionResumer } = await load();
    const medical = state();
    Object.assign(medical.current_character.deferred_action, {
        action_key: 'consumable_use', server_executable: false, client_executable: true,
    });
    let busy = true, calls = 0;
    const notices = [];
    const resume = createDeferredActionResumer({
        send() { throw new Error('Not a native combat action'); }, canResume: () => true,
        async resumeConsumable(id) { assert.equal(id, 'saved'); if (busy) return false; calls++; return true; },
        notify: message => notices.push(message),
    });
    await resume(medical);
    assert.equal(notices.length, 0);
    busy = false;
    await resume(medical);
    await resume(medical);
    assert.equal(calls, 1);
    assert.equal(notices.length, 1);
});

test('failed medical recovery stops auto retries but allows explicit retry', async () => {
    const { createDeferredActionResumer } = await load();
    const medical = state();
    Object.assign(medical.current_character.deferred_action, {
        action_key: 'consumable_use', server_executable: false, client_executable: true,
    });
    let calls = 0;
    const notices = [];
    const resume = createDeferredActionResumer({ canResume: () => true,
        async resumeConsumable() { calls++; throw new Error('Changed injury'); },
        notify: message => notices.push(message),
    });
    await resume(medical);
    await resume(medical);
    assert.equal(calls, 1);
    await resume(medical, { force: true });
    assert.equal(calls, 2);
    assert.deepEqual(notices, ['Changed injury', 'Changed injury']);
});
