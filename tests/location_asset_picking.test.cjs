const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sceneContext = require('./helpers/locationSceneContext.cjs');
const createSceneContext = values => vm.createContext(sceneContext(values));

const sceneSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');

function section(start, end) {
    const first = sceneSource.indexOf(start);
    const last = sceneSource.indexOf(end, first);
    assert.ok(first >= 0 && last > first, `${start} should exist`);
    return sceneSource.slice(first, last).replaceAll('export ', '');
}

function pickerContext() {
    const scene = {};
    const floor = { visible: true, userData: { locationObjectId: 17 }, parent: scene };
    const floorFace = { visible: true, isMesh: true, material: { visible: true }, parent: floor };
    const wall = { visible: true, userData: { locationObjectId: 18 }, parent: scene };
    const wallFace = { visible: true, isMesh: true, material: { visible: true }, parent: wall };
    const fixture = { visible: true, userData: { locationLampIndex: 0 }, parent: scene,
        getWorldPosition: vector => { vector.z = 4; return vector; } };
    const bulb = { visible: true, userData: { locationLampBulb: true }, parent: fixture };
    fixture.children = [bulb];
    const roof = { visible: true, parent: scene };
    const roofFace = { visible: true, isMesh: true, material: { visible: true }, parent: roof };
    const hits = { main: [{ object: floorFace, distance: 10 }], roof: [] };
    class Vector3 {
        constructor() { this.x = 0; this.y = 0; this.z = 0; }
        project() { this.x = 0; this.y = 0; this.z = 0; return this; }
    }
    const context = createSceneContext({ scene, THREE: { Vector3 },
        locationObjectMeshes: [floor], objectMeshes: [],
        locationLightGroup: { visible: true, children: [fixture] }, roofMeshes: [roof],
        currentLocationData: { lighting: { local_lights: [{}] } },
        renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } },
        mouse: {}, camera: {},
        raycaster: { ray: { origin: { distanceTo: vector => vector.z } }, setFromCamera() {} },
        profiledLocationRaycast: roots => roots === context.roofMeshes ? hits.roof : hits.main,
    });
    vm.runInContext(section('function visibleEditorHit(', 'function sameEditorSelection('), context);
    return { context, hits, floor, floorFace, wallFace, bulb, fixture, roofFace };
}

test('a visible lamp above a floor is selected even when its small picker misses the pointer', () => {
    const { context } = pickerContext();
    assert.deepEqual({ ...context.pickEditorAsset(50, 50) }, { kind: 'lamp', index: 0 });
    assert.deepEqual({ ...context.pickEditorAsset(85, 50) }, { kind: 'structure', id: 17 });
});

test('a closer wall or visible roof prevents picking the lamp through architecture', () => {
    const { context, hits, wallFace, roofFace } = pickerContext();
    hits.main = [{ object: wallFace, distance: 2 }, ...hits.main];
    assert.deepEqual({ ...context.pickEditorAsset(50, 50) }, { kind: 'structure', id: 18 });
    hits.main.shift();
    hits.roof = [{ object: roofFace, distance: 3 }];
    assert.deepEqual({ ...context.pickEditorAsset(50, 50) }, { kind: 'structure', id: 17 });
    roofFace.parent.visible = false;
    assert.deepEqual({ ...context.pickEditorAsset(50, 50) }, { kind: 'lamp', index: 0 });
});

test('hidden lamps and hidden architecture are not picked', () => {
    const { context, hits, floor, bulb, fixture } = pickerContext();
    bulb.visible = false;
    assert.deepEqual({ ...context.pickEditorAsset(50, 50) }, { kind: 'structure', id: 17 });
    bulb.visible = true;
    fixture.visible = false;
    assert.deepEqual({ ...context.pickEditorAsset(50, 50) }, { kind: 'structure', id: 17 });
    fixture.visible = true;
    floor.visible = false;
    hits.main = [{ object: hits.main[0].object, distance: 10 }];
    assert.deepEqual({ ...context.pickEditorAsset(50, 50) }, { kind: 'lamp', index: 0 });
});
