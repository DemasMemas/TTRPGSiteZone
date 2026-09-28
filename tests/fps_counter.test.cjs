const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/fpsCounter.js'), 'utf8');

function setup() {
    const listeners = new Map();
    const makeElement = () => ({
        children: [], dataset: {}, textContent: '', attributes: {}, removed: false,
        append(...children) { this.children.push(...children); },
        setAttribute(name, value) { this.attributes[name] = value; },
        removeAttribute(name) {
            delete this.attributes[name];
            if (name === 'data-fps-level') delete this.dataset.fpsLevel;
        },
        remove() { this.removed = true; },
    });
    const document = {
        hidden: false,
        createElement: makeElement,
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name, listener) {
            if (listeners.get(name) === listener) listeners.delete(name);
        },
    };
    const context = vm.createContext({ document });
    vm.runInContext(source.replace('export function createFpsCounter', 'function createFpsCounter'), context);
    const container = { appendChild(element) { this.badge = element; } };
    const counter = context.createFpsCounter(container, 'Карта');
    return { counter, badge: container.badge, document, listeners };
}

test('FPS counts actual rendered frame intervals and updates once per second', () => {
    const { counter, badge } = setup();
    for (let i = 0; i <= 60; i += 1) counter.frame(i * 1000 / 60);
    assert.equal(badge.children[1].textContent, '60');
    assert.equal(badge.dataset.fpsLevel, 'high');
    counter.pause();
    assert.equal(badge.children[1].textContent, '—');
    assert.equal(badge.dataset.fpsLevel, undefined);
});

test('hidden tab and long gaps reset the sample instead of reporting a false drop', () => {
    const { counter, badge, document, listeners } = setup();
    for (let i = 0; i <= 60; i += 1) counter.frame(i * 1000 / 60);
    document.hidden = true;
    listeners.get('visibilitychange')();
    assert.equal(badge.children[1].textContent, '—');
    document.hidden = false;
    counter.frame(3000);
    assert.equal(badge.children[1].textContent, '—');
    counter.frame(4000);
    assert.equal(badge.children[1].textContent, '1');
    assert.equal(badge.dataset.fpsLevel, 'low');
    counter.frame(7000);
    assert.equal(badge.children[1].textContent, '—');
    counter.destroy();
    assert.equal(badge.removed, true);
    assert.equal(listeners.has('visibilitychange'), false);
});

test('render details can be shown on the world counter without changing the FPS value', () => {
    const { counter, badge } = setup();
    counter.setDetails('calls 100 | tris 200k');
    assert.equal(badge.children[2].textContent, 'calls 100 | tris 200k');
    assert.equal(badge.children[2].hidden, false);
    counter.setDetails('');
    assert.equal(badge.children[2].hidden, true);
});
