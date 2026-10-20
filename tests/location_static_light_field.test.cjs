const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname,
    '../app/static/js/locationStaticLightFieldPrototype.js'), 'utf8');
const prototype = import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function roomScene() {
    return {
        fieldOptions: { width: 12, height: 6, levels: [{ id: 0, y: 0 }, { id: 1, y: 3 }] },
        walls: [{ level: 0, x1: 6, z1: 0, x2: 6, z2: 6 }],
        lamps: [
            ...[1.5, 2.5, 3.5, 4.5].map((x, index) => ({
                id: `left-${index}`, level: 0, x, y: 2, z: 3,
                color: '#ffcc88', intensity: 2, distance: 7,
            })),
            ...[7.5, 8.5, 9.5, 10.5].map((x, index) => ({
                id: `right-${index}`, level: 0, x, y: 2, z: 3,
                color: '#88bbff', intensity: 2, distance: 7,
            })),
        ],
    };
}

test('eight lamps light their own rooms simultaneously without crossing the opaque wall', async () => {
    const { createStaticLightField } = await prototype;
    const { fieldOptions, walls, lamps } = roomScene();
    const field = createStaticLightField(fieldOptions);
    const stats = field.rebuild({ lamps, walls });
    assert.equal(stats.activeLights, 8);
    assert.ok(stats.sampleVisits > 0);
    const left = field.sample(3, 3, 0);
    const right = field.sample(9, 3, 0);
    assert.ok(left[0] > left[2], `left room: ${left}`);
    assert.ok(right[2] > right[0], `right room: ${right}`);
    for (const lamp of lamps) {
        const before = field.sample(lamp.x, lamp.z, 0);
        field.rebuild({ lamps: lamps.filter(item => item.id !== lamp.id), walls });
        const after = field.sample(lamp.x, lamp.z, 0);
        assert.ok(before.some((value, channel) => value > after[channel] + 0.01), lamp.id);
        field.rebuild({ lamps, walls });
    }
    field.rebuild({ lamps: lamps.slice(0, 4), walls });
    assert.deepEqual(field.sample(9, 3, 0), [0, 0, 0]);
    field.rebuild({ lamps: lamps.slice(4), walls });
    assert.deepEqual(field.sample(3, 3, 0), [0, 0, 0]);
});

test('wall edge, falloff, floor separation and dynamic-source exclusion', async () => {
    const { createStaticLightField } = await prototype;
    const { fieldOptions, walls, lamps } = roomScene();
    const field = createStaticLightField(fieldOptions);
    field.rebuild({ lamps: lamps.slice(0, 1), walls });
    assert.ok(field.sample(5.875, 3, 0)[0] > 0);
    assert.deepEqual(field.sample(6.125, 3, 0), [0, 0, 0]);
    assert.ok(field.sample(1.5, 3, 0)[0] > field.sample(5.5, 3, 0)[0]);
    assert.deepEqual(field.sample(1.5, 3, 1), [0, 0, 0]);
    const excluded = field.rebuild({ lamps, walls,
        dynamicLightIds: new Set(['left-0', 'right-0']) });
    assert.equal(excluded.activeLights, 6);
    assert.equal(excluded.excludedLights, 2);
    const noDuplicate = field.sample(2, 3, 0);
    field.rebuild({ lamps, walls });
    assert.ok(field.sample(2, 3, 0)[0] > noDuplicate[0]);
    const upper = { ...lamps[0], id: 'upstairs', level: 1, y: 5 };
    field.rebuild({ lamps: [upper], walls });
    assert.ok(field.sample(upper.x, upper.z, 1)[0] > 0);
    assert.deepEqual(field.sample(upper.x, upper.z, 0), [0, 0, 0]);
});

test('static floor irradiance follows the r128 PointLight decay at matching lamp settings', async () => {
    const { createStaticLightField } = await prototype;
    const field = createStaticLightField({ width: 4, height: 4,
        levels: [{ id: 0, y: 0 }] });
    field.rebuild({ lamps: [{ id: 'saved', level: 0, x: 1.125, z: 1.125,
        y: 2, color: '#ffffff', intensity: 0.5, distance: 8 }] });
    const directIrradiance = 0.5 * (1 - 2 / 8) ** 2;
    assert.ok(Math.abs(field.sample(1.125, 1.125, 0)[0] - directIrradiance) < 0.03);
});

test('a wall face uses its own height and normal while the opposite side stays dark', async () => {
    const { createStaticLightField, STATIC_LIGHT_FIELD_RANGE } = await prototype;
    const field = createStaticLightField({ width: 8, height: 6,
        levels: [{ id: 0, y: 0 }] });
    const wall = { level: 0, x1: 6, z1: 1, x2: 6, z2: 5,
        bottomY: 0, topY: 2.8 };
    const lamp = { id: 'room', level: 0, x: 3, y: 2, z: 3,
        color: '#ffffff', intensity: 2.5, distance: 8 };
    field.rebuild({ lamps: [lamp], walls: [wall] });
    const sampleX = 5.875;
    const distance = Math.hypot(lamp.x - sampleX, lamp.y - 1.4);
    const expected = lamp.intensity * (1 - distance / lamp.distance) ** 2
        * (sampleX - lamp.x) / distance;
    assert.ok(Math.abs(field.sampleWall(sampleX, 3, 0)[0] - expected) < 0.04);
    assert.deepEqual(field.sampleWall(6.125, 3, 0), [0, 0, 0]);
    assert.equal(field.pixels.length, field.columns * field.rows * 2 * 4);
    assert.equal(STATIC_LIGHT_FIELD_RANGE, 8);
});

test('field encoding is linear for overlapping lamps instead of dimming their sum', async () => {
    const { createStaticLightField } = await prototype;
    const field = createStaticLightField({ width: 4, height: 4,
        levels: [{ id: 0, y: 0 }] });
    const lamp = { id: 'a', level: 0, x: 1.125, z: 1.125, y: 2,
        color: '#ffffff', intensity: 2.5, distance: 8 };
    field.rebuild({ lamps: [lamp] });
    const one = field.sample(1.125, 1.125, 0)[0];
    field.rebuild({ lamps: [lamp, { ...lamp, id: 'b' }] });
    const two = field.sample(1.125, 1.125, 0)[0];
    assert.ok(Math.abs(two - 2 * one) < 0.05, `${one} + ${one} became ${two}`);
});

test('rotated wall faces receive light only from their exposed side', async () => {
    const { createStaticLightField } = await prototype;
    const field = createStaticLightField({ width: 8, height: 8,
        levels: [{ id: 0, y: 0 }] });
    for (const turn of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        const axis = { x: Math.cos(turn), z: Math.sin(turn) };
        const normal = { x: -axis.z, z: axis.x };
        const wall = { level: 0, x1: 4 - axis.x, z1: 4 - axis.z,
            x2: 4 + axis.x, z2: 4 + axis.z, bottomY: 0, topY: 2.8 };
        field.rebuild({ lamps: [{ id: 'room', level: 0,
            x: 4 + normal.x * 1.5, z: 4 + normal.z * 1.5, y: 2,
            color: '#ffcc88', intensity: 2.5, distance: 6 }], walls: [wall] });
        const lit = field.sampleWall(4 + normal.x * 0.125,
            4 + normal.z * 0.125, 0)[0];
        const blocked = field.sampleWall(4 - normal.x * 0.125,
            4 - normal.z * 0.125, 0)[0];
        assert.ok(lit > 0, `front face unlit at ${turn}`);
        assert.equal(blocked, 0, `light leaked through wall at ${turn}`);
    }
});

test('outside lamps do not illuminate either room through closed exterior walls', async () => {
    const { createStaticLightField } = await prototype;
    const { lamps, walls } = roomScene();
    const field = createStaticLightField({ width: 16, height: 10,
        levels: [{ id: 0, y: 0 }] });
    const exterior = [
        { level: 0, x1: 0, z1: 0, x2: 12, z2: 0 },
        { level: 0, x1: 12, z1: 0, x2: 12, z2: 6 },
        { level: 0, x1: 12, z1: 6, x2: 0, z2: 6 },
        { level: 0, x1: 0, z1: 6, x2: 0, z2: 0 },
    ];
    const outdoor = { id: 'outside', level: 0, x: 3, y: 2, z: 8,
        intensity: 3, distance: 8, color: '#ffffff' };
    field.rebuild({ lamps: [outdoor], walls: [...walls, ...exterior] });
    assert.deepEqual(field.sample(3, 4, 0), [0, 0, 0]);
    assert.ok(field.sample(3, 8, 0)[0] > 0);
    field.rebuild({ lamps: [...lamps, outdoor], walls: [...walls, ...exterior] });
    assert.ok(field.sample(3, 4, 0)[0] > 0);
    assert.ok(field.sample(9, 4, 0)[2] > 0);
});

test('twelve to twenty outdoor lamps reuse one field buffer and rebuild only on request', async () => {
    const { createStaticLightField } = await prototype;
    const field = createStaticLightField({ width: 24, height: 12,
        levels: [{ id: 0, y: 0 }] });
    const pixels = field.pixels;
    for (const count of [12, 20]) {
        const lamps = Array.from({ length: count }, (_, index) => ({
            id: `outdoor-${index}`, level: 0,
            x: 1 + index % 10 * 2, z: 2 + Math.floor(index / 10) * 5,
            y: 2, distance: 5, intensity: 1.5, color: '#ddddbb',
        }));
        const first = field.rebuild({ lamps });
        const snapshot = Buffer.from(field.pixels);
        const second = field.rebuild({ lamps });
        assert.equal(first.activeLights, count);
        assert.equal(second.activeLights, count);
        assert.ok(first.buildMs >= 0);
        assert.equal(field.pixels, pixels);
        assert.deepEqual(Buffer.from(field.pixels), snapshot);
    }
});

test('material hook preserves PBR maps, shader hooks and program sharing', async () => {
    const { createStaticLightField, createStaticLightFieldTexture,
        applyStaticLightFieldMaterial } = await prototype;
    const field = createStaticLightField({ width: 4, height: 4,
        levels: [{ id: 0, y: 0 }] });
    const texture = createStaticLightFieldTexture({ DataTexture: class {
        constructor(data, width, height, format) {
            Object.assign(this, { data, width, height, format });
        }
    }, RGBAFormat: 1, ClampToEdgeWrapping: 2, NearestFilter: 3 }, field);
    assert.equal(texture.width, field.columns);
    assert.equal(texture.height, field.rows * 2);
    assert.equal(texture.generateMipmaps, false);
    const map = {}, normalMap = {}, roughnessMap = {};
    const previous = () => {};
    const materials = Array.from({ length: 2 }, () => ({
        isMeshStandardMaterial: true, userData: {}, map, normalMap, roughnessMap,
        onBeforeCompile: previous, customProgramCacheKey: () => 'existing-pbr-hook',
    }));
    const controls = materials.map(material =>
        applyStaticLightFieldMaterial(material, texture, field, 0));
    assert.equal(materials[0].customProgramCacheKey(), materials[1].customProgramCacheKey());
    const shader = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <lights_fragment_end>',
    };
    materials[0].onBeforeCompile(shader);
    assert.match(shader.vertexShader, /vStaticLightWorldPosition/);
    assert.match(shader.fragmentShader, /reflectedLight\.indirectDiffuse/);
    assert.match(shader.fragmentShader, /BRDF_Diffuse_Lambert\(material\.diffuseColor\)/);
    assert.match(shader.fragmentShader, /fieldIrradiance \*= PI/);
    assert.match(shader.fragmentShader, /surfaceLayer = staticLightFieldLevel/);
    assert.equal(shader.uniforms.staticLightFieldMap.value, texture);
    assert.equal(materials[0].map, map);
    assert.equal(materials[0].normalMap, normalMap);
    assert.equal(materials[0].roughnessMap, roughnessMap);
    controls[0].enabled.value = 0;
    assert.equal(shader.uniforms.staticLightFieldEnabled.value, 0);
});

test('game scene enables directional lighting on load and freezes selected point slots', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    assert.match(scene, /let locationStaticLightField = null/);
    assert.match(scene, /createLocationDirectionalLightField\(THREE, currentLocationData,/);
    assert.match(scene, /updateLampRenderLights\(performance\.now\(\), 1, true\);\s*setLocationStaticLightFieldEnabled\(true\);/);
    assert.match(scene, /setLocationStaticLightFieldEnabled\(!locationStaticLightField\)/);
    assert.match(scene, /staticFieldPointSlots = activeStaticLightFieldPointSlots/);
    assert.match(scene, /selected\.pointShadow = staticFieldPointSlots\.pointShadow/);
    assert.match(scene, /remapStaticLightFieldSlots\(previousSlots,/);
    assert.match(scene, /locationStaticLightField\.detach\(material\)/);
    assert.match(scene, /locationStaticLightField\.dispose\(\)/);
});
