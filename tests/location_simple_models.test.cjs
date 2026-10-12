const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const url = `data:text/javascript;base64,${Buffer.from(read('locationSimpleModels.js')).toString('base64')}`;

test('tent has fabric panels, entrance, ridge and guy lines instead of a cylinder', async () => {
    const { createTentModel, createFenceModel, createCrateModel, createShelfModel } = await import(url);
    class Vector3 {
        constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
        clone() { return new Vector3(this.x, this.y, this.z); }
        sub(other) { this.x -= other.x; this.y -= other.y; this.z -= other.z; return this; }
        add(other) { this.x += other.x; this.y += other.y; this.z += other.z; return this; }
        multiplyScalar(value) { this.x *= value; this.y *= value; this.z *= value; return this; }
        length() { return Math.hypot(this.x, this.y, this.z); }
        normalize() { return this.multiplyScalar(1 / this.length()); }
    }
    class Mesh {
        constructor(geometry, material) {
            this.geometry = geometry;
            this.material = material;
            this.position = { set() {}, copy() {}, y: 0 };
            this.rotation = {};
            this.quaternion = { setFromUnitVectors() {} };
        }
    }
    const THREE = {
        Group: class { constructor() { this.children = []; } add(child) { this.children.push(child); } },
        Mesh, Vector3,
        BoxGeometry: class { constructor(...dimensions) { this.dimensions = dimensions; } },
        CylinderGeometry: class { constructor(...dimensions) { this.dimensions = dimensions; } },
        BufferGeometry: class { setAttribute(name, attribute) { this[name] = attribute; } computeVertexNormals() {} },
        Float32BufferAttribute: class { constructor(array) { this.array = array; } },
        MeshStandardMaterial: class { constructor(options) { Object.assign(this, options); } },
        DoubleSide: 2,
    };
    const tent = createTentModel(THREE);
    assert.ok(tent.children.length >= 12);
    assert.ok(tent.children.filter(child => child.geometry.position).length >= 5);
    const fence = createFenceModel(THREE, 2, 1.2, 0.15);
    assert.equal(fence.children.length, 5);
    assert.ok(fence.children.every(child => child.geometry instanceof THREE.BoxGeometry));
    assert.equal(fence.children.filter(child => child.geometry.dimensions[0] > 1.5).length, 3);
    const scene = read('locationScene.js');
    assert.match(scene, /case 'tent':\s*mesh = createTentModel/);
    assert.match(scene, /group\.add\(createFenceModel/);
    assert.doesNotMatch(scene, /type === 'tent' \? new THREE\.CylinderGeometry/);
    const woodenCrate = createCrateModel(THREE, 0.8, 0.7, 0.8);
    const militaryCrate = createCrateModel(THREE, 1.1, 0.65, 0.8, '#45543a', true);
    const shelf = createShelfModel(THREE, 1.2, 2, 0.4);
    assert.ok(woodenCrate.children.length >= 20);
    assert.ok(militaryCrate.children.length >= 20);
    assert.ok(shelf.children.length >= 10);
    assert.ok(shelf.children.some(child => child.material.color === '#78634c'
        && child.geometry.dimensions[0] === 1.2 && child.geometry.dimensions[1] === 2));
    assert.match(scene, /group\.add\(createCrateModel/);
    assert.match(scene, /group\.add\(createShelfModel/);
    assert.match(scene, /pivot\.add\(lever\)/);
    assert.match(read('locationAssetCatalog.js'), /id: 'military_crate'/);
});
