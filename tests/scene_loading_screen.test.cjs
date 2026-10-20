const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
const helpers = main.slice(main.indexOf('let sceneLoadingGeneration = 0;'),
    main.indexOf('function escapeHtml('));
const worldLoad = main.slice(main.indexOf('function resumeWorldMapLoad()'),
    main.indexOf('function setLocationViewActive('));

function harness() {
    const classes = new Set();
    const screen = { classList: {
        add(name) { classes.add(name); },
        remove(...names) { names.forEach(name => classes.delete(name)); },
    } };
    const title = { textContent: '' };
    const detail = { textContent: '' };
    const retry = { hidden: true };
    const elements = new Map([
        ['scene-loading-screen', screen],
        ['scene-loading-title', title],
        ['scene-loading-detail', detail],
        ['scene-loading-retry', retry],
    ]);
    const frames = [];
    const context = vm.createContext({
        document: { getElementById: id => elements.get(id) },
        requestAnimationFrame: callback => frames.push(callback),
        window: { isLocationActive: false, worldLoadMetrics: { complete: false } },
        console: { error() {} },
    });
    vm.runInContext(`${helpers}\n${worldLoad}`, context);
    const flushFrames = () => {
        while (frames.length) frames.shift()();
    };
    return { context, classes, title, detail, retry, flushFrames };
}

test('an old loading completion cannot hide the next scene or its error', () => {
    const { context, classes, title, retry, flushFrames } = harness();
    const world = context.showSceneLoading('world');
    context.finishSceneLoading(world);
    const location = context.showSceneLoading('location');
    flushFrames();
    assert.equal(title.textContent, 'Подлокация');
    assert.equal(classes.has('is-hidden'), false);
    context.failSceneLoading(world, 'old error');
    assert.equal(retry.hidden, true);
    context.finishSceneLoading(location);
    flushFrames();
    assert.equal(classes.has('is-hidden'), true);
    const retryWorld = context.showSceneLoading('world');
    context.failSceneLoading(retryWorld, 'Загрузка не удалась');
    assert.equal(classes.has('is-hidden'), false);
    assert.equal(classes.has('is-error'), true);
    assert.equal(retry.hidden, false);
});

test('world screen waits for all chunks and retries after a paused location load', async () => {
    const { context, classes, retry, flushFrames } = harness();
    let loads = 0;
    let travelRefreshes = 0;
    context.loadAllChunks = async () => {
        loads++;
        context.window.worldLoadMetrics = loads === 1
            ? { pausedForLocation: true, complete: false }
            : { pausedForLocation: false, complete: true };
    };
    context.refreshWorldTravel = () => { travelRefreshes++; };
    context.resumeWorldMapLoad();
    await new Promise(resolve => setImmediate(resolve));
    flushFrames();
    assert.equal(loads, 2);
    assert.equal(travelRefreshes, 1);
    assert.equal(classes.has('is-hidden'), true);
    context.loadAllChunks = async () => {
        context.window.worldLoadMetrics = { complete: false };
    };
    context.resumeWorldMapLoad();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(classes.has('is-error'), true);
    assert.equal(retry.hidden, false);
});
