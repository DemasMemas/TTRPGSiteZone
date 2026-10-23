const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/static/js/commonMapTools.js'), 'utf8');

test('ruler measures a straight horizontal distance in cells across chunk borders', () => {
    const context = vm.createContext({});
    vm.runInContext(source.replace(/^import .*\n/gm, '').replaceAll('export ', ''), context);
    assert.equal(context.mapDistance({ x: 31, z: 10 }, { x: 34, z: 14 }), 5);
    assert.equal(context.mapDistance({ x: 0, y: 99, z: 0 }, { x: 0, y: -99, z: 0 }), 0);
    assert.ok(Math.abs(context.mapDistance({ x: 0, z: 0 }, { x: 1, z: 1 }) - Math.SQRT2) < 1e-12);
});

test('dice count defaults to one, stays integral and respects bounds', () => {
    const context = vm.createContext({});
    vm.runInContext(source.replace(/^import .*\n/gm, '').replaceAll('export ', ''), context);
    for (const value of ['', 'bad', 0, -1]) assert.equal(context.diceCount(value), 1);
    assert.equal(context.diceCount(2.8), 2);
    assert.equal(context.diceCount('5'), 5);
    assert.equal(context.diceCount(999), 100);
});
