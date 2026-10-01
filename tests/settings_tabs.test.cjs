const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('reopening settings shows the highlighted tab rather than banned users', () => {
    const source = fs.readFileSync(path.join(__dirname, '../app/static/js/ui.js'), 'utf8');
    const start = source.indexOf('export function openSettings(');
    const end = source.indexOf('\nasync function loadBannedList(', start);
    assert.ok(start >= 0 && end > start);
    const button = { dataset: { settingsTab: 'export' }, classList: { add() {}, remove() {} } };
    const banned = { style: { display: 'none' } };
    const exported = { style: { display: 'none' } };
    const weather = { style: { display: 'none' } };
    const panel = {
        style: { display: 'none' },
        querySelector(selector) {
            if (selector.startsWith('.settings-tabs')) return button;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.settings-tabs .tab-btn') return [button];
            if (selector === '.settings-tab-content') return [banned, exported, weather];
            return [];
        },
    };
    const context = vm.createContext({
        document: { getElementById(id) {
            return { 'settings-panel': panel, 'settings-content': banned,
                'export-settings': exported, 'weather-settings': weather }[id];
        } },
        window: {},
    });
    vm.runInContext('let settingsVisible = false;\n' + source.slice(start, end).replaceAll('export function', 'function'), context);
    context.openSettings();
    assert.equal(panel.style.display, 'block');
    assert.equal(exported.style.display, 'block');
    assert.equal(banned.style.display, 'none');
});
