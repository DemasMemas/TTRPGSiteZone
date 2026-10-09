const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = readFileSync(join(__dirname, '..', 'app', 'static', 'js', 'characterSheet.js'), 'utf8');
const start = source.indexOf('function readCustomConsumableProfile()');
const end = source.indexOf('\nwindow.saveInventoryItemTemplate', start);
assert.ok(start >= 0 && end > start);
const reader = source.slice(start, end);

function makeRow(kind, field, value, duration = 1, unit = 'turn_end') {
    const elements = {
        '.profile-kind': { value: kind },
        '.profile-field': { value: field, selectedOptions: [{ textContent: field }] },
        '.profile-value': { value: String(value) },
        '.profile-duration': { value: String(duration) },
        '.profile-unit': { value: unit },
    };
    return { querySelector: selector => elements[selector] };
}

function read(rows, cost = 0) {
    const context = {
        document: {
            getElementById: () => ({ value: String(cost) }),
            querySelectorAll: () => rows,
        },
    };
    vm.runInNewContext(reader, context);
    return JSON.parse(JSON.stringify(context.readCustomConsumableProfile()));
}

test('custom profile serializes immediate, timed, delayed and event effects', () => {
    const profile = read([
        makeRow('immediate', 'stress_delta', -2),
        makeRow('temporary', 'strength', 3, 2),
        makeRow('delayed', 'exhaustion', 1, 5, 'time_elapsed'),
        makeRow('trigger', 'radiation', -1, 1, 'movement_end'),
    ], 2);
    assert.equal(profile.direct.stress_delta, -2);
    assert.equal(profile.direct.action_points_cost, 2);
    assert.deepEqual(profile.modifiers[0], { stat: 'strength', value: 3, remaining: 2, tick: 'turn_end' });
    assert.equal(profile.effects[0].time_unit, 'minute');
    assert.equal(profile.effects[0].adjustments[0].field, 'exhaustion');
    assert.equal(profile.effects[1].tick, 'movement_end');
    assert.notEqual(profile.effects[0].area, profile.effects[1].area);
});

test('custom profile refuses no-op effects', () => {
    assert.throws(() => read([]), /Добавьте хотя бы один эффект/);
    assert.throws(() => read([makeRow('immediate', 'stress_delta', 0)]), /отличаться от нуля/);
});
