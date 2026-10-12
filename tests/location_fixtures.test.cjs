const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const importSource = source => import(`data:text/javascript,${encodeURIComponent(source)}`);

test('mounted lights have catalog presets and follow the object position', async () => {
    const { LOCATION_ASSETS } = await importSource(read('locationAssetCatalog.js'));
    const { electricFixtureLightSource } = await importSource(read('locationFixtures.js'));
    const { fireLightSource } = await importSource(read('locationFire.js'));
    for (const id of ['ceiling_bulb', 'wall_bulb', 'wall_torch']) {
        assert.ok(LOCATION_ASSETS.some(asset => asset.id === id && asset.kind === 'structure'));
    }
    const ceiling = { type: 'ceiling_bulb', tile_x: 2, tile_y: 3, properties: {
        elevation: 2.4, dimensions: { height: 0.7 }, is_on: true,
    } };
    assert.equal(electricFixtureLightSource(ceiling).height, 2.4 - 0.7 * 0.82);
    assert.equal(electricFixtureLightSource({ ...ceiling, properties: { ...ceiling.properties, is_on: false } }), null);
    const wall = { type: 'wall_bulb', tile_x: 2, tile_y: 3, properties: {
        elevation: 1.8, offset_z: -0.43, rotation: Math.PI / 2,
        dimensions: { depth: 0.4 }, is_on: true,
    } };
    assert.ok(electricFixtureLightSource(wall).x > 2.5);
    assert.ok(Math.abs(electricFixtureLightSource(wall).z - 3.07) < 0.001);
    const torch = { type: 'wall_torch', tile_x: 2, tile_y: 3, properties: {
        elevation: 1.25, offset_z: -0.43, dimensions: { depth: 0.42, height: 0.75 }, is_lit: true,
    } };
    assert.ok(fireLightSource(torch).z > 3.07);
    assert.equal(fireLightSource({ ...torch, properties: { ...torch.properties, is_lit: false } }), null);
});

test('electric fixtures have visible solid models in both switch states', async () => {
    const { createElectricFixtureModel } = await importSource(read('locationFixtures.js'));
    class Group {
        constructor() { this.children = []; }
        add(child) { this.children.push(child); }
    }
    class Mesh {
        constructor(geometry, material) {
            this.geometry = geometry; this.material = material;
            this.position = { set() {} }; this.rotation = {};
        }
    }
    const Geometry = class {};
    const THREE = { Group, Mesh, MeshStandardMaterial: class { constructor(values) { Object.assign(this, values); } },
        CylinderGeometry: Geometry, BoxGeometry: Geometry, SphereGeometry: Geometry };
    for (const type of ['ceiling_bulb', 'wall_bulb']) {
        const dimensions = { width: 0.38, depth: 0.4, height: 0.7 };
        const on = createElectricFixtureModel(THREE, { type, properties: { is_on: true } }, dimensions);
        const off = createElectricFixtureModel(THREE, { type, properties: { is_on: false } }, dimensions);
        assert.ok(on.children.length >= 4);
        assert.equal(on.children.length, off.children.length);
        assert.ok(on.children.at(-1).material.emissiveIntensity > 0);
        assert.equal(off.children.at(-1).material.emissiveIntensity, 0);
    }
    const scene = read('locationScene.js');
    assert.match(scene, /group\.add\(createElectricFixtureModel\(/);
    assert.match(scene, /fireLightSource\(object, true\) \|\| electricFixtureLightSource\(object, true\)/);
    assert.match(scene, /isObjectLightSource\(object\)/);
    assert.match(scene, /electric: isElectricFixture\(source\)/);
    assert.match(read('main.js'), /selection\.electric\s*\? \(selection\.isLit \? 'Выключить' : 'Включить'\)/);
});
