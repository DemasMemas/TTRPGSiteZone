const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const start = source.indexOf('function createCharacterModel(userId) {');
const end = source.indexOf('function normalizeTeamColor(value) {', start);

class Transform {
    constructor() { this.x = 0; this.y = 0; this.z = 0; }
    set(x, y, z) { Object.assign(this, { x, y, z }); }
}

class Mesh {
    constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.position = new Transform();
        this.rotation = new Transform();
        this.userData = {};
        this.children = [];
    }
    add(child) { this.children.push(child); }
}

const THREE = {
    Group: class { constructor() { this.children = []; this.userData = {}; } add(child) { this.children.push(child); } },
    Mesh,
    CylinderGeometry: class {
        constructor(top, bottom, height) { Object.assign(this, { top, bottom, height, kind: 'cylinder' }); }
    },
    SphereGeometry: class {
        constructor(radius) { Object.assign(this, { radius, kind: 'sphere' }); }
    },
    BoxGeometry: class {
        constructor(width, height, depth) { Object.assign(this, { width, height, depth, kind: 'box' }); }
    },
    ConeGeometry: class {
        constructor(radius, height) { Object.assign(this, { radius, height, kind: 'cone' }); }
    },
    MeshStandardMaterial: class { constructor(properties) { Object.assign(this, properties); } },
};

const { createCharacterModel, poseStandardHumanModel, characterLabelOffset } = new Function(
    'THREE', 'getUserColor', `${source.slice(start, end)}
        return { createCharacterModel, poseStandardHumanModel, characterLabelOffset };`,
)(THREE, () => '#8899aa');

function verticalBounds(mesh) {
    const { geometry, rotation, position } = mesh;
    let halfHeight;
    if (geometry.kind === 'sphere') halfHeight = geometry.radius;
    else if (geometry.kind === 'box') halfHeight = geometry.height / 2;
    else if (Math.abs(rotation.x) > 1) halfHeight = Math.max(geometry.top || geometry.radius,
        geometry.bottom || geometry.radius);
    else halfHeight = geometry.height / 2;
    return [position.y - halfHeight, position.y + halfHeight];
}

test('standard human is 1.80 m tall and stays above ground in every posture', async () => {
    const model = createCharacterModel(1);
    assert.equal(model.userData.isStandardHuman, true);
    const catalogSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAssetCatalog.js'), 'utf8');
    const { LOCATION_ASSETS } = await import(`data:text/javascript;base64,${Buffer.from(catalogSource).toString('base64')}`);
    const heightOf = id => LOCATION_ASSETS.find(asset => asset.id === id).dimensions[2];
    assert.ok(Math.abs(heightOf('door') - 1.8 - 0.2) < 1e-9);
    assert.equal(heightOf('table'), 1);
    for (const [posture, expectedTop] of [['standing', 1.8], ['sitting', 1.33], ['prone', 0.58]]) {
        poseStandardHumanModel(model, posture);
        const bounds = model.children.filter(child => child.visible !== false).map(verticalBounds);
        const bottom = Math.min(...bounds.map(([low]) => low));
        const top = Math.max(...bounds.map(([, high]) => high));
        assert.ok(bottom >= -0.001, `${posture}: bottom ${bottom}`);
        assert.ok(Math.abs(top - expectedTop) < 0.001, `${posture}: top ${top}`);
        assert.ok(model.children.filter(child => child.userData.posturePart !== 'facingMarker')
            .every(child => child.castShadow && child.receiveShadow));
    }
    poseStandardHumanModel(model, 'standing');
    assert.equal(model.children.find(child => child.userData.posturePart === 'head').position.y, 1.62);
    assert.equal(model.children.find(child => child.userData.posturePart === 'facingMarker').position.y, 1.3);
    poseStandardHumanModel(model, 'sitting');
    const part = name => model.children.find(child => child.userData.posturePart === name);
    assert.equal(part('lowerLeg-1').rotation.x, Math.PI / 2);
    assert.equal(part('lowerLeg-1').position.y, 0.11);
    assert.equal(part('lowerLeg1').rotation.x, 0);
    assert.ok(part('foot-1').position.z < 0 && part('foot1').position.z > 0);
    assert.equal(part('head').rotation.x, 0);
    poseStandardHumanModel(model, 'prone', false);
    assert.equal(part('head').rotation.x, 0.25);
    assert.equal(part('neck').visible, false);
    assert.ok(part('head').position.z > 0);
    assert.ok(part('foot1').position.z < 0);
    assert.ok(part('head').position.y > part('body').position.y);
    poseStandardHumanModel(model, 'prone', true);
    assert.equal(part('head').rotation.x, -0.25);
    assert.equal(part('neck').visible, true);
    assert.ok(part('head').position.z < 0);
    assert.ok(part('foot1').position.z > 0);
    assert.ok(part('head').position.y > part('body').position.y);
    const bodyEnd = part('body').position.z - part('body').geometry.height / 2;
    const headEdge = part('head').position.z + part('head').geometry.radius;
    const neckEnd = part('neck').position.z + part('neck').geometry.height / 2;
    const neckStart = part('neck').position.z - part('neck').geometry.height / 2;
    assert.ok(headEdge < bodyEnd - 0.05, 'head should not sink into the torso');
    assert.ok(neckStart < headEdge && neckEnd > bodyEnd, 'neck should connect head to torso');
    assert.ok(part('facingMarker').position.z > part('foot1').position.z);
    assert.ok(Math.cos(part('head').rotation.x) > 0);
    assert.ok(Math.min(...model.children.filter(child => child.visible !== false)
        .map(child => verticalBounds(child)[0])) >= -0.001);
});

test('labels clear the human silhouette without changing other model offsets', () => {
    const human = createCharacterModel(1);
    for (const [posture, expected] of [['standing', 2.05], ['sitting', 1.55], ['prone', 0.78]]) {
        assert.equal(characterLabelOffset({ model: human, posture }), expected);
    }
    const other = { userData: { labelHeight: 1.9 } };
    assert.equal(characterLabelOffset({ model: other, posture: 'standing' }), 1.9);
    assert.equal(characterLabelOffset({ model: other, posture: 'sitting' }), 1.25);
    assert.equal(characterLabelOffset({ model: other, posture: 'prone' }), 0.95);
});

test('saved visual variant reaches initial model, live socket update and fog memory', () => {
    const main = fs.readFileSync(path.join(__dirname, '../app/static/js/main.js'), 'utf8');
    assert.match(main, /s\.posture,\s*s\.prone_on_back/);
    assert.match(main, /data\.character\.posture,\s*data\.character\.prone_on_back/);
    assert.match(main, /socket\.on\('location_character_visual_pose_updated'/);
    assert.match(source, /proneOnBack: Boolean\(entry\.proneOnBack\)/);
    assert.match(source, /applyFogGhostPosture\(ghost, snapshot\.posture, snapshot\.proneOnBack\)/);
    assert.match(source, /poseStandardHumanModel\(entry\.model, normalized, entry\.proneOnBack\)/);
});
