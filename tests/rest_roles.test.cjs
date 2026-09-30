const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('rest list excludes mutants and NPCs even when an NPC can join a world group', () => {
    const source = fs.readFileSync(
        path.join(__dirname, '../app/static/js/rest.js'), 'utf8',
    );
    const start = source.indexOf('function isRestEligible(');
    const end = source.indexOf('\nexport async function openLobbyRestModal()', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({});
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.isRestEligible({ data: {} }), true);
    assert.equal(context.isRestEligible({ data: { is_mutant: true } }), false);
    assert.equal(context.isRestEligible({ data: { basic: { is_mutant: true } } }), false);
    assert.equal(context.isRestEligible({ data: { basic: { species: 'Мутант' } } }), false);
    assert.equal(context.isRestEligible({ data: { basic: { is_npc: true } } }), false);
    assert.equal(context.isRestEligible({ data: { basic: { is_npc: true, can_join_group: true } } }), false);
    assert.equal(context.isRestEligible({ data: { character_type: 'npc' } }), false);
});
