const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const modulePath = pathToFileURL(join(__dirname, '..', 'app', 'static', 'js', 'consumableProfileEditor.js'));

test('official components can be combined without mutating their source', async () => {
    const { profileComponentOptions, copyProfileComponent } = await import(modulePath.href);
    const source = { attributes: { consumable: {
        direct: { stress_advantage: true, stress_attack_block_chance: 50 },
        effects: [
            { type: 'generic', source: 'direct', name: 'Описание' },
            { type: 'radiation_filter', capacity: 50, value: 50 },
        ],
        modifiers: [{ stat: 'darkness_awareness', value: 3, remaining: 4 }],
        addiction: { key: 'medicine', kind: 'medicine', chance: 10, multipliers: { 2: 2 } },
    } } };
    const options = profileComponentOptions(source);
    assert.ok(options.some(option => option.label.includes('Зависимость')));
    const copied = copyProfileComponent({}, source, options[0]);
    assert.equal(copied.editor_version, 2);
    assert.equal(copied.effects.length, 1);
    copied.effects[0].capacity = 100;
    assert.equal(source.attributes.consumable.effects[1].capacity, 50);
    const separate = copyProfileComponent({ direct: {}, effects: [], modifiers: [] }, source,
        options.find(option => option.section === 'direct' && option.index === 'stress_advantage'));
    assert.equal(separate.direct.stress_advantage, true);
});

test('nested profile controls update numbers without flattening the profile', async () => {
    const { renderConsumableProfileTree } = await import(modulePath.href);
    const originalDocument = global.document;
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.value = ''; }
        appendChild(child) { child.parent = this; this.children.push(child); }
        replaceChildren() { this.children = []; }
        remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    }
    global.document = { createElement: tag => new Element(tag) };
    try {
        const profile = { editor_version: 2, direct: { stress_delta: -2 },
            effects: [{ type: 'delayed_adjustment', adjustments: [{ field: 'stress', delta: -1 }] }] };
        const root = new Element('div');
        renderConsumableProfileTree(root, profile);
        const all = node => [node, ...node.children.flatMap(all)];
        const numberInput = all(root).find(node => node.tag === 'input' && node.value === -2);
        assert.ok(numberInput);
        numberInput.value = '-3';
        numberInput.onchange();
        assert.equal(profile.direct.stress_delta, -3);
        assert.equal(profile.effects[0].adjustments[0].field, 'stress');
    } finally {
        global.document = originalDocument;
    }
});

test('renamed water and blood packets are identified by profile, not display name', async () => {
    const source = readFileSync(join(__dirname, '..', 'app', 'static', 'js', 'characterSheet.js'), 'utf8');
    const water = source.slice(source.indexOf('function isWaterSupplyConsumable('), source.indexOf('\nfunction spendWaterRequirement(', source.indexOf('function isWaterSupplyConsumable(')));
    const packet = source.slice(source.indexOf('function isBloodPacketItem('), source.indexOf('\nasync function resolveMedicalApplication(', source.indexOf('function isBloodPacketItem(')));
    const context = vm.createContext({ allTemplatesCache: [
        { id: 11, attributes: { consumable: { direct: { water_source: true } } } },
        { id: 12, attributes: { consumable: { direct: { blood_packet: true } } } },
    ] });
    vm.runInContext(`${water}\n${packet}`, context);
    assert.equal(context.isWaterSupplyConsumable({ templateId: 11, name: 'Канистра №1' }), true);
    assert.equal(context.isBloodPacketItem({ templateId: 12, name: 'Совсем не пакет крови' }), true);
    assert.equal(context.isBloodPacketItem({ name: 'Пакет крови' }), true);
    const { isAlcoholConsumable } = await import(pathToFileURL(join(__dirname, '..', 'app', 'static', 'js', 'effects.js')).href);
    assert.equal(isAlcoholConsumable({ name: 'Непохожее имя', attributes: { consumable: { direct: { is_alcohol: true } } } }), true);
    assert.equal(isAlcoholConsumable({ name: 'Пиво', attributes: { consumable: { direct: { nutrition: 1 } } } }), false);
});
