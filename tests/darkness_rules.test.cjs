const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/darknessRules.js'), 'utf8');
const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('world darkness runs from 22:00 through 05:59', async () => {
    const { isWorldDarkTime } = await import(url);
    assert.equal(isWorldDarkTime(21 * 60 + 59), false);
    assert.equal(isWorldDarkTime(22 * 60), true);
    assert.equal(isWorldDarkTime(5 * 60 + 59), true);
    assert.equal(isWorldDarkTime(6 * 60), false);
});

test('sheet and combat use conditional modifiers rather than item names', () => {
    const sheet = fs.readFileSync(path.join(__dirname, '../app/static/js/characterSheet.js'), 'utf8');
    const combat = fs.readFileSync(path.join(__dirname, '../app/services/combat.py'), 'utf8');
    assert.match(sheet, /darkness \? 'darkness_awareness' : 'light_awareness'/);
    assert.match(sheet, /darkness_visual_immunity/);
    assert.match(combat, /'darkness_awareness' if darkness else 'light_awareness'/);
    assert.match(combat, /'darkness_shooting_immunity'/);
});
