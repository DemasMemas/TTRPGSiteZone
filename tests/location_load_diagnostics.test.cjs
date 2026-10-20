const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');

test('location entry records network, initialization, build stages and first rendered frames', () => {
    const start = scene.indexOf('export function startLocationLoadDiagnostics(');
    const end = scene.indexOf('export function initLocationScene(', start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({ window: {}, locationLoadTrace: null });
    vm.runInContext(scene.slice(start, end).replaceAll('export ', ''), context);
    context.startLocationLoadDiagnostics(120.123, 34.567);
    const report = context.window.getLocationLoadDiagnostics();
    assert.equal(report.networkMs, 120.1);
    assert.equal(report.initMs, 34.6);
    assert.deepEqual({ ...report.stages }, {});
    assert.deepEqual(Array.from(report.frames), []);
    assert.match(scene, /markLoadStage\('terrainAndTexturesMs'\)/);
    assert.match(scene, /markLoadStage\('objectsAndRoofsMs'\)/);
    assert.match(scene, /markLoadStage\('lightingMs'\)/);
    assert.match(scene, /loadFrame\.frames\.push\(\{ waitMs:/);
    const entry = main.slice(main.indexOf('window.enterLocation = async function('),
        main.indexOf('window.exitLocation =', main.indexOf('window.enterLocation = async function(')));
    assert.match(entry, /startLocationLoadDiagnostics\(networkMs, performance\.now\(\) - initStartedAt\)/);
    assert.doesNotMatch(entry.slice(entry.indexOf('const initStartedAt'), entry.indexOf('loadLocation(data)')),
        /destroyLocationScene\(\)/);
});
