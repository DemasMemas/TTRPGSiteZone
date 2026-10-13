import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
        Object.assign(this, { x, y, z });
    }
}

class Group {
    constructor() {
        this.children = [];
        this.position = { x: 0, y: 0, z: 0,
            set(x, y, z) { Object.assign(this, { x, y, z }); } };
        this.rotation = { y: 0 };
        this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { Object.assign(this, { x, y, z }); } };
    }

    add(child) { this.children.push(child); }
    updateMatrixWorld() {}
    traverse(callback) {
        callback(this);
        this.children.forEach(child => child.traverse(callback));
    }
    clone() {
        const copy = new Group();
        this.children.forEach(child => copy.add(child.clone()));
        return copy;
    }
}

class Box3 {
    constructor() {
        this.min = { x: -0.4, y: 0, z: -0.4 };
    }

    setFromObject() { return this; }
    getSize(target) { return Object.assign(target, { x: 0.8, y: 0.7, z: 0.8 }); }
    getCenter(target) { return Object.assign(target, { x: 0, y: 0.35, z: 0 }); }
}

function fixture() {
    const counts = { geometry: 0, material: 0, texture: 0 };
    const texture = { isTexture: true, dispose() { counts.texture += 1; } };
    const geometry = { dispose() { counts.geometry += 1; } };
    const material = {
        map: texture,
        color: { value: 'brown' },
        clone() {
            return { map: texture, color: { value: this.color.value }, dispose() {} };
        },
        dispose() { counts.material += 1; },
    };
    const mesh = {
        isMesh: true, geometry, material, rotation: { y: 0 },
        traverse(callback) { callback(this); },
        clone() { return { ...this }; },
    };
    const scene = new Group();
    scene.add(mesh);
    return { scene, counts };
}

const requests = [];
class GLTFLoader {
    load(path, resolve, _progress, reject) { requests.push({ path, resolve, reject }); }
}

const context = vm.createContext({ console });
const threeModule = new vm.SyntheticModule(['Group', 'Vector3', 'Box3'], function () {
    this.setExport('Group', Group);
    this.setExport('Vector3', Vector3);
    this.setExport('Box3', Box3);
}, { context });
const loaderModule = new vm.SyntheticModule(['GLTFLoader'], function () {
    this.setExport('GLTFLoader', GLTFLoader);
}, { context });
const source = await readFile(new URL('../app/static/js/locationModelAssets.js', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(source, {
    context,
    importModuleDynamically: async () => loaderModule,
});
await module.link(specifier => {
    assert.equal(specifier, 'three');
    return threeModule;
});
await loaderModule.link(() => {});
await loaderModule.evaluate();
await module.evaluate();
const { mountLocationModel, releaseLocationModel, clearUnusedLocationModels } = module.namespace;
const dimensions = { width: 0.8, depth: 0.8, height: 0.7 };
const asset = path => ({ dimensions: [0.8, 0.8, 0.7], visual: {
    renderMode: 'glb', modelPath: path, pivot: 'bottom-center', orientation: 0,
} });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('two instances share cached geometry but not mutable materials', async () => {
    const first = new Group();
    const second = new Group();
    const models = [];
    mountLocationModel(first, asset('/shared.glb'), dimensions, model => models.push(model));
    mountLocationModel(second, asset('/shared.glb'), dimensions, model => models.push(model));
    await flush();
    assert.equal(requests.length, 1);
    const source = fixture();
    requests.shift().resolve({ scene: source.scene });
    await flush();
    assert.equal(models.length, 2);
    const a = models[0].children[0].children[0].children[0];
    const b = models[1].children[0].children[0].children[0];
    assert.equal(a.geometry, b.geometry);
    assert.notEqual(a.material, b.material);
    a.material.color.value = 'ghost';
    assert.equal(b.material.color.value, 'brown');
    const preview = new Group();
    let previewReady = false;
    const raisedAsset = asset('/shared.glb');
    raisedAsset.visual.groundClearance = 0.008;
    mountLocationModel(preview, raisedAsset, dimensions, model => {
        previewReady = true;
        assert.equal(model.children[0].position.y, 0.008);
    });
    assert.equal(previewReady, true);
    assert.equal(requests.length, 0);
    releaseLocationModel(preview);
    releaseLocationModel(first);
    clearUnusedLocationModels();
    assert.equal(source.counts.geometry, 0);
    releaseLocationModel(second);
    clearUnusedLocationModels();
    assert.deepEqual(source.counts, { geometry: 1, material: 1, texture: 1 });
});

test('late result does not mount on a removed object', async () => {
    const group = new Group();
    let mounted = false;
    mountLocationModel(group, asset('/late.glb'), dimensions, () => { mounted = true; });
    await flush();
    releaseLocationModel(group);
    clearUnusedLocationModels();
    const source = fixture();
    requests.shift().resolve({ scene: source.scene });
    await flush();
    assert.equal(mounted, false);
    assert.equal(source.counts.geometry, 1);
});

test('failed load keeps fallback and allows a retry', async () => {
    const group = new Group();
    let failures = 0;
    mountLocationModel(group, asset('/missing.glb'), dimensions, () => {}, () => { failures += 1; });
    await flush();
    requests.shift().reject(new Error('404'));
    await flush();
    assert.equal(failures, 1);
    releaseLocationModel(group);
    const quietRetry = new Group();
    mountLocationModel(quietRetry, asset('/missing.glb'), dimensions, () => {}, () => { failures += 1; });
    await flush();
    assert.equal(failures, 2);
    assert.equal(requests.length, 0);
    releaseLocationModel(quietRetry);
    clearUnusedLocationModels();
    const retry = new Group();
    let mounted = false;
    mountLocationModel(retry, asset('/missing.glb'), dimensions, () => { mounted = true; });
    await flush();
    const source = fixture();
    requests.shift().resolve({ scene: source.scene });
    await flush();
    assert.equal(mounted, true);
    releaseLocationModel(retry);
    clearUnusedLocationModels();
});
