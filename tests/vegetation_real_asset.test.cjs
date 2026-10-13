const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const asset = path.join(root, 'app/static/models/vegetation/bermuda_d4_tuft.glb');
const textures = path.join(root, 'app/static/textures/vegetation');

test('D.4 sample is one lightweight, UV-mapped real-source mesh', () => {
    const data = fs.readFileSync(asset);
    assert.equal(data.toString('ascii', 0, 4), 'glTF');
    assert.equal(data.readUInt32LE(8), data.length);
    const jsonLength = data.readUInt32LE(12);
    const gltf = JSON.parse(data.toString('utf8', 20, 20 + jsonLength));
    assert.equal(gltf.meshes.length, 1);
    const primitive = gltf.meshes[0].primitives[0];
    assert.ok(primitive.attributes.TEXCOORD_0 !== undefined);
    assert.equal(gltf.accessors[primitive.indices].count / 3, 167);
    assert.equal(gltf.materials?.length || 0, 0);
    const position = gltf.accessors[primitive.attributes.POSITION];
    assert.ok(position.max[1] > 0.15 && position.max[1] < 0.25);
    assert.ok(position.min[1] < 0.02);
});

test('D.4 sample keeps authentic diffuse, alpha, and normal maps', () => {
    const alpha = fs.readFileSync(path.join(textures, 'grass_bermuda_01_alpha_2k.png'));
    assert.equal(alpha.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(alpha.readUInt32BE(16), 2048);
    assert.equal(alpha.readUInt32BE(20), 2048);
    for (const suffix of ['diff_2k.jpg', 'nor_gl_2k.jpg']) {
        const image = fs.readFileSync(path.join(textures, `grass_bermuda_01_${suffix}`));
        assert.equal(image.toString('hex', 0, 2), 'ffd8');
    }
});

test('D.4.2 broadleaf is one centered, UV-mapped real-source mesh', () => {
    const data = fs.readFileSync(path.join(root, 'app/static/models/vegetation/weed_d42_tuft.glb'));
    assert.equal(data.toString('ascii', 0, 4), 'glTF');
    const gltf = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)));
    assert.equal(gltf.meshes.length, 1);
    const primitive = gltf.meshes[0].primitives[0];
    assert.ok(primitive.attributes.TEXCOORD_0 !== undefined);
    assert.equal(gltf.accessors[primitive.indices].count / 3, 442);
    const position = gltf.accessors[primitive.attributes.POSITION];
    assert.ok(position.min[0] > -0.15 && position.max[0] < 0.15);
    assert.ok(position.min[1] >= -0.001 && position.max[1] < 0.08);
});

test('D.4.2 broadleaf keeps original diffuse, alpha and normal maps', () => {
    const alpha = fs.readFileSync(path.join(textures, 'weed_plant_02_alpha_1k.png'));
    assert.equal(alpha.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(alpha.readUInt32BE(16), 1024);
    for (const suffix of ['diff_1k.jpg', 'nor_gl_1k.jpg']) {
        const image = fs.readFileSync(path.join(textures, `weed_plant_02_${suffix}`));
        assert.equal(image.toString('hex', 0, 2), 'ffd8');
    }
});

test('D.4.3 forest floor maps match the Poly Haven 1K source files', () => {
    const maps = {
        'forrest_ground_01_diff_1k.jpg': '236e7d928f5e357a194fd92de189cbe4',
        'forrest_ground_01_nor_gl_1k.jpg': 'ba4265df25aea293913d004b69ef9ab0',
        'forrest_ground_01_arm_1k.jpg': '0bca8bef07d3c48faea4aae3fac9a757',
    };
    for (const [name, md5] of Object.entries(maps)) {
        const image = fs.readFileSync(path.join(textures, name));
        assert.equal(image.toString('hex', 0, 2), 'ffd8');
        assert.equal(crypto.createHash('md5').update(image).digest('hex'), md5);
    }
});
