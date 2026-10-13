const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const sceneSource = read('locationScene.js');
const dataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const load = async () => {
    const architectureUrl = dataUrl(read('locationArchitecture.js'));
    const roofSource = read('locationRoof.js').replace("'./locationArchitecture.js'", `'${architectureUrl}'`);
    return import(dataUrl(roofSource));
};

function room() {
    const floor = { id: 1, type: 'floor', tile_x: 9, tile_y: 8,
        properties: { offset_x: 0.5, offset_z: 0.5,
            dimensions: { width: 13, depth: 11, height: 0.12 } } };
    const wall = (id, x, z, width, rotation = 0, offsetX = 0, offsetZ = 0) => ({
        id, type: 'wall', tile_x: x, tile_y: z,
        properties: { rotation, offset_x: offsetX, offset_z: offsetZ,
            dimensions: { width, depth: 0.2, height: 2.5 } },
    });
    return [floor,
        wall(2, 9, 3, 13, 0, 0.5), wall(3, 9, 14, 13, 0, 0.5),
        wall(4, 3, 8, 11, Math.PI / 2, 0, 0.5),
        wall(5, 16, 8, 11, Math.PI / 2, 0, 0.5)];
}

test('only enclosed floors receive roofs above their walls', async () => {
    const { roofPlans } = await load();
    const objects = room();
    const [roof] = roofPlans(objects, () => 1);
    assert.ok(roof);
    assert.equal(roof.floorId, 1);
    assert.equal(roof.x, 10);
    assert.equal(roof.z, 9);
    assert.ok(roof.width > 13 && roof.depth > 11);
    assert.equal(roof.eaveY, 3.62);
    assert.equal(roof.gableColor, '#aa8866');
    assert.deepEqual(roofPlans(objects.slice(0, 4)), []);
    objects[0].properties.roof_enabled = false;
    assert.deepEqual(roofPlans(objects), []);
    objects[0].properties.roof_enabled = true;
    objects[2].properties.gm_hidden = true;
    assert.deepEqual(roofPlans(objects), []);
});

test('roof geometry has two sloping faces and camera cutaway preserves outside view', async () => {
    const { roofPlans, createRoofGeometry, createRoofGableGeometry, roofVisibleForCamera } = await load();
    const plan = roofPlans(room())[0];
    class BufferGeometry {
        setAttribute(name, value) { this[name] = value; }
        computeVertexNormals() {}
    }
    class Float32BufferAttribute {
        constructor(array) { this.array = array; }
    }
    const geometry = createRoofGeometry({ BufferGeometry, Float32BufferAttribute }, plan);
    assert.equal(geometry.position.array.length, 180);
    assert.ok(geometry.position.array.includes(plan.rise));
    const gable = createRoofGableGeometry({ BufferGeometry, Float32BufferAttribute }, plan);
    assert.equal(gable.position.array.length, 54);
    assert.ok(gable.position.array.includes(plan.rise - 0.12));
    assert.ok(gable.position.array.includes(-0.12));
    const halfDepth = (plan.depth - 0.48) / 2;
    const shoulderY = plan.rise * (1 - halfDepth / (plan.depth / 2)) - 0.12;
    assert.ok(gable.position.array.some(value => Math.abs(value - shoulderY) < 0.000001));
    assert.equal(plan.eaveY - 0.12, 3.5);
    assert.match(sceneSource, /applySurfacePattern\(gableMaterial, getSurfaceTexture\(THREE, 'wall'\), 0\.25, 'sides'\)/);
    for (const start of [0, 90]) {
        const vertices = geometry.position.array;
        const ax = vertices[start + 3] - vertices[start];
        const az = vertices[start + 5] - vertices[start + 2];
        const bx = vertices[start + 6] - vertices[start];
        const bz = vertices[start + 8] - vertices[start + 2];
        assert.ok(az * bx - ax * bz > 0);
    }
    assert.equal(roofVisibleForCamera(plan, { x: 50, z: 50 }, 10, true, false), true);
    assert.equal(roofVisibleForCamera(plan, { x: plan.x, z: plan.z }, 10, true, false), false);
    assert.equal(roofVisibleForCamera(plan, { x: plan.x, z: plan.z }, 30, true, false), true);
    assert.equal(roofVisibleForCamera(plan, { x: 50, z: 50 }, 30, false, false), false);
    assert.equal(roofVisibleForCamera(plan, { x: 50, z: 50 }, 30, true, true), false);
});

test('roof gables align with walls even when the floor is offset', async () => {
    const { roofPlans } = await load();
    const objects = room();
    objects[0].properties.offset_x = 0.29539168381616676;
    objects[0].properties.offset_z = 0.43729457403232885;
    objects[1].properties.offset_x = 0.29304344667146687;
    objects[1].properties.offset_z = 0.09003750743589567;
    const [plan] = roofPlans(objects, () => 1);
    assert.ok(plan);
    assert.ok(Math.abs(plan.x - 10) < 0.001);
    assert.ok(Math.abs(plan.x - (plan.width - 0.48) / 2 - 3.4) < 0.001);
    assert.ok(Math.abs(plan.x + (plan.width - 0.48) / 2 - 16.6) < 0.001);
    assert.equal(plan.eaveY - 0.12, 3.5);
});

test('small and large roofs cut away at comparable framing, and enclosed floors keep overhead shade', async () => {
    const { roofVisibleForCamera, applyInteriorFloorShade } = await load();
    const small = { x: 4, z: 4, angle: 0, width: 6, depth: 5 };
    const large = { ...small, width: 12, depth: 10 };
    small.eaveY = large.eaveY = 3;
    small.rise = large.rise = 1;
    assert.equal(roofVisibleForCamera(small, { x: 100, z: 100 }, 80, true, false,
        { x: 4, y: 8, z: 4 }), false);
    assert.equal(roofVisibleForCamera(small, { x: 4, z: 4 }, 4, true, false,
        { x: 40, y: 8, z: 40 }), true);
    assert.equal(roofVisibleForCamera(large, { x: 4, z: 4 }, 14, true, false,
        { x: 4, y: 12, z: 4 }), false);
    assert.equal(roofVisibleForCamera(large, { x: 4, z: 4 }, 18, true, false,
        { x: 4, y: 16, z: 4 }), true);

    const material = { userData: {}, onBeforeCompile: shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
            '// surface pattern\n#include <project_vertex>');
    } };
    applyInteriorFloorShade(material, 6, 5, [1.5, -2]);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>' };
    material.onBeforeCompile(shader);
    assert.deepEqual(shader.uniforms.interiorFloorHalfSize.value, [3, 2.5]);
    assert.equal(shader.uniforms.interiorShadeIntensity, material.userData.interiorShade);
    assert.deepEqual(shader.uniforms.interiorEntrance.value, [1.5, -2]);
    assert.equal(shader.uniforms.interiorEntranceEnabled.value, 1);
    assert.match(shader.vertexShader, /vInteriorFloorXZ = position\.xz/);
    assert.match(shader.fragmentShader, /interiorWallDistance/);
    assert.match(shader.fragmentShader, /smoothstep/);
    assert.match(shader.fragmentShader, /0\.035 \* interiorEdge\.x \* interiorEdge\.y/);
    assert.match(shader.fragmentShader, /interiorEntranceEnabled \* 0\.045/);
    assert.match(sceneSource, /enclosedFloors\.has\(object\.userData\.locationObjectId\)/);
    assert.match(sceneSource, /const FLOOR_SURFACE_OFFSET = 0\.035/);
    assert.match(sceneSource, /height - FLOOR_SURFACE_OFFSET/);
});
