const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/characters.js'), 'utf8');

test('healing a mutant updates its existing list row without rebuilding the group', () => {
    const start = source.indexOf('function updateMutantHealthInList(');
    const end = source.indexOf('\nexport async function openMutantCard(', start);
    assert.ok(start >= 0 && end > start);
    const label = { textContent: '0/50 ОЗ' };
    const row = {
        dataset: { characterId: '7' },
        querySelector: selector => selector === '.mutant-instance-health' ? label : null,
    };
    const group = { open: true, querySelectorAll: () => [row] };
    const context = vm.createContext({
        document: { getElementById: () => group },
    });
    vm.runInContext(source.slice(start, end), context);

    context.updateMutantHealthInList(7, { current: 50, max: 50 });

    assert.equal(label.textContent, '50/50 ОЗ');
    assert.equal(group.open, true);
    assert.match(source, /const result = await Server\.healCharacterFully\(currentLobbyId, characterId\);\s*updateMutantHealthInList\(characterId, result\.data\?\.health\);\s*close\(\);\s*await openMutantCard\(characterId, \{ \.\.\.character, data: result\.data \}\)/);
});

test('list refresh restores expanded mutant groups', () => {
    assert.match(source, /querySelectorAll\('details\.mutant-group\[open\]'\)/);
    assert.match(source, /details\.open = expandedMutantGroups\.has\(details\.dataset\.groupKey\)/);
});

test('mutant health socket event updates only the existing row', () => {
    const socketSource = fs.readFileSync(path.join(__dirname, '../app/static/js/socketHandlers.js'), 'utf8');
    assert.match(socketSource, /socket\.on\('mutant_health_updated', data => \{/);
    assert.match(socketSource, /updateMutantHealthInList\(data\.character_id, data\.health\)/);
    assert.doesNotMatch(socketSource, /socket\.on\('mutant_health_updated'[\s\S]*?loadLobbyCharacters\(\)/);
});
