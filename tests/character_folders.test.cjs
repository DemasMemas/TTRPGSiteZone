const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/characterFolders.js'), 'utf8');
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const storage = () => {
    const items = new Map();
    return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};

test('character categories match legacy NPC and mutant roles with mutant priority', async () => {
    const { characterCategory } = await modulePromise;
    assert.equal(characterCategory({ data: {} }), 'players');
    for (const data of [{ is_npc: true }, { basic: { is_npc: true } }, { character_type: 'npc' }, { basic: { character_type: 'npc' } }]) {
        assert.equal(characterCategory({ data }), 'npcs');
    }
    for (const data of [{ is_mutant: true }, { basic: { isMutant: true } }, { species: 'Мутант' }, { basic: { characterType: 'МУТАНТ' } }, { is_npc: true, is_mutant: true }]) {
        assert.equal(characterCategory({ data }), 'mutants');
    }
});

test('folders move real IDs, persist personally and leave every gameplay field unchanged', async () => {
    const { createCharacterFolderStore } = await modulePromise;
    const local = storage();
    const character = { id: 7, owner_id: 3, name: 'Scout', time_active: false,
        data: { health: { current: 12 }, basic: {} }, location: { x: 10, y: 20 }, revision: 8 };
    const original = structuredClone(character);
    const store = createCharacterFolderStore(19, 3, local);
    store.mutate('', 'POST', { category: 'players', name: '  Отряд  ' }, [character]);
    const folder = store.read().folders[0];
    store.mutate('/members/7', 'PUT', { folder_id: folder.id }, [character]);
    store.mutate('/members/7', 'PUT', { folder_id: folder.id }, [character]);
    assert.deepEqual(store.read().memberships, { 7: folder.id });
    assert.deepEqual(createCharacterFolderStore(19, 3, local).read(), store.read());
    assert.deepEqual(createCharacterFolderStore(19, 4, local).read().folders, []);
    assert.deepEqual(createCharacterFolderStore(20, 3, local).read().folders, []);
    store.mutate(`/${folder.id}`, 'PATCH', { name: 'Разведчики' }, [character]);
    assert.equal(store.read().folders[0].name, 'Разведчики');
    store.mutate('/members/7', 'PUT', { folder_id: null }, [character]);
    assert.deepEqual(store.read().memberships, {});
    store.mutate('/members/7', 'PUT', { folder_id: folder.id }, [character]);
    store.mutate(`/${folder.id}`, 'DELETE', undefined, [character]);
    assert.deepEqual(store.read().memberships, {});
    assert.equal(store.read().folders.length, 0);
    assert.deepEqual(character, original);
});

test('folders reject invalid names, other categories and unavailable characters', async () => {
    const { createCharacterFolderStore } = await modulePromise;
    const store = createCharacterFolderStore(1, 1, storage());
    const npc = { id: 1, data: { is_npc: true } };
    for (const name of ['', '  ', 'x'.repeat(81)]) {
        assert.throws(() => store.mutate('', 'POST', { name, category: 'players' }, [npc]));
    }
    store.mutate('', 'POST', { name: 'Игроки', category: 'players' }, [npc]);
    assert.throws(() => store.mutate('/members/1', 'PUT', { folder_id: 1 }, [npc]));
    assert.throws(() => store.mutate('/members/999', 'PUT', { folder_id: 1 }, [npc]));
    assert.deepEqual(store.read().memberships, {});
});

test('corrupt browser preferences fall back without losing access to root characters', async () => {
    const { createCharacterFolderStore } = await modulePromise;
    const local = storage();
    const store = createCharacterFolderStore(1, 1, local);
    local.setItem(store.key, '{');
    assert.deepEqual(store.read().folders, []);
    local.setItem(store.key, JSON.stringify({ folders: [null, {}, { id: 1, category: 'npcs', name: 'NPC' }], memberships: { 7: 999 } }));
    assert.deepEqual(store.read().memberships, {});
    assert.equal(store.read().folders.length, 1);
});

test('moving a dragged group validates all members before writing and never duplicates records', async () => {
    const { createCharacterFolderStore } = await modulePromise;
    const store = createCharacterFolderStore(1, 1, storage());
    const characters = [{ id: 1, data: { is_mutant: true } }, { id: 2, data: { is_mutant: true } }, { id: 3, data: {} }];
    const before = structuredClone(characters);
    store.mutate('', 'POST', { name: 'Стая', category: 'mutants' }, characters);
    store.mutate('/members', 'PUT', { character_ids: [1, 2, 1], folder_id: 1 }, characters);
    assert.deepEqual(store.read().memberships, { 1: 1, 2: 1 });
    const saved = store.read();
    for (const ids of [[1, 3], [1, 999], []]) {
        assert.throws(() => store.mutate('/members', 'PUT', { character_ids: ids, folder_id: 1 }, characters));
        assert.deepEqual(store.read(), saved);
    }
    store.mutate('/members', 'PUT', { character_ids: [1, 2], folder_id: null }, characters);
    assert.deepEqual(store.read().memberships, {});
    assert.deepEqual(characters, before);
});
