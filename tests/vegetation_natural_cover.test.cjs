const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const helperPath = path.join(root, 'app/static/js/vegetationNaturalCover.js');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const modulePromise = import(`data:text/javascript;base64,${Buffer.from(helperSource).toString('base64')}`);

test('D.4 base snapshot stays deterministic and unchanged in count', async () => {
    const { createD4BasePlacements } = await modulePromise;
    const first = createD4BasePlacements();
    assert.equal(first.length, 66);
    assert.deepEqual(createD4BasePlacements(), first);
    assert.deepEqual(first.slice(0, 4).map(plant => Number(plant.x.toFixed(2))),
        [-1.42, -0.48, 0.46, 1.4]);
});

test('natural cover has grounded irregular clusters and a real clearing', async () => {
    const { createD4BasePlacements, createNaturalCoverPlacements, naturalDensityAt } = await modulePromise;
    const base = createD4BasePlacements();
    const natural = createNaturalCoverPlacements();
    assert.deepEqual(createNaturalCoverPlacements(), natural);
    assert.equal(natural.length, 309);
    assert.ok(natural.length > base.length * 4);
    assert.ok(natural.length < base.length * 5);
    assert.ok(natural.every(plant => Math.abs(plant.x) <= 1.78 && Math.abs(plant.z) <= 1.78));
    assert.ok(natural.every(plant => plant.scaleY < plant.scaleX && plant.scaleY < plant.scaleZ));
    assert.equal(new Set(natural.map(plant => `${plant.x},${plant.z}`)).size, natural.length);
    assert.ok(naturalDensityAt(0.27, 0.51) < 0.1);
    assert.ok(naturalDensityAt(-0.94, 0.33) > 0.7);
    assert.ok(naturalDensityAt(0, -1.6) < 0.2);
});

test('accent cover reuses the natural cover and stays a rare addition', async () => {
    const { createNaturalCoverPlacements, createAccentPlacements } = await modulePromise;
    const natural = createNaturalCoverPlacements();
    const accents = createAccentPlacements(natural);
    assert.deepEqual(createAccentPlacements(natural), accents);
    assert.equal(accents.length, 15);
    assert.ok(accents.length < natural.length * 0.08);
    assert.ok(accents.every(plant => plant.accent && Math.abs(plant.x) <= 1.72
        && Math.abs(plant.z) <= 1.72));
});

test('D.4.2 keeps every D.4.1 root while mixing species deterministically', async () => {
    const { createNaturalCoverPlacements, splitMixedCoverPlacements } = await modulePromise;
    const natural = createNaturalCoverPlacements();
    const mixed = splitMixedCoverPlacements(natural);
    assert.deepEqual(splitMixedCoverPlacements(natural), mixed);
    assert.equal(mixed.bermuda.length + mixed.broadleaf.length, natural.length);
    assert.equal(mixed.broadleaf.length, 108);
    assert.ok(mixed.bermuda.length > mixed.broadleaf.length);
    assert.deepEqual(new Set([...mixed.bermuda, ...mixed.broadleaf]), new Set(natural));
});

test('D.4.3 variants preserve roots and cluster the scarcer broadleaf plants', async () => {
    const { createNaturalCoverPlacements, createReducedWeedPlacements,
        createClusteredWeedPlacements, splitMixedCoverPlacements } = await modulePromise;
    const natural = createNaturalCoverPlacements();
    const control = splitMixedCoverPlacements(natural);
    const reduced = createReducedWeedPlacements(natural);
    const clustered = createClusteredWeedPlacements(natural);
    for (const [variant, weedCount] of [[reduced, 49], [clustered, 34]]) {
        assert.equal(variant.broadleaf.length, weedCount);
        assert.equal(variant.bermuda.length + weedCount, natural.length);
        assert.deepEqual(new Set([...variant.bermuda, ...variant.broadleaf]), new Set(natural));
    }
    assert.ok(reduced.broadleaf.every(plant => control.broadleaf.includes(plant)));
    assert.deepEqual(createClusteredWeedPlacements(natural), clustered);
    const nearestNeighbor = plants => plants.reduce((sum, plant) => sum + Math.min(
        ...plants.filter(other => other !== plant)
            .map(other => Math.hypot(plant.x - other.x, plant.z - other.z))), 0) / plants.length;
    assert.ok(nearestNeighbor(clustered.broadleaf) < nearestNeighbor(reduced.broadleaf) * 0.8);
});

test('tuned ground has deterministic broad tonal variation without a generated texture', async () => {
    const { groundTintAt } = await modulePromise;
    const positions = [[-1, 0], [0, 0], [1, 1], [0.3, 0.5]];
    const samples = positions.map(([x, z]) => groundTintAt(x, z));
    assert.deepEqual(positions.map(([x, z]) => groundTintAt(x, z)), samples);
    assert.ok(samples.every(tone => tone.r > tone.g && tone.g > tone.b));
    assert.ok(new Set(samples.map(tone => tone.r.toFixed(3))).size > 2);
});

test('D.5.2 comparison keeps the D.4.3 control and normalizes Poly Haven candidates', () => {
    const scene = fs.readFileSync(path.join(root, 'app/static/js/vegetationNaturalComparison.js'), 'utf8');
    assert.match(scene, /bermuda_d4_tuft\.glb/);
    assert.match(scene, /weed_d42_tuft\.glb/);
    assert.match(scene, /grass_medium_01_1k\.gltf/);
    assert.match(scene, /grass_medium_02_1k\.gltf/);
    assert.match(scene, /grass_medium_02_d/);
    assert.match(scene, /vertical: 0\.18 \/ bounds\.max\.y/);
    assert.match(scene, /const centers = \{ reduced: -4\.2, medium01: 0, medium02: 4\.2 \}/);
    assert.match(scene, /new THREE\.InstancedMesh\(geometry, material, plants\.length\)/);
    assert.match(scene, /candidatePlants = naturalPlants\.filter\(\(_, index\) => index % 3 === 0\)/);
    assert.match(scene, /ground\.geometry = tuned \? tunedGroundGeometry : groundGeometry/);
    assert.match(scene, /vertexColors: true/);
    assert.match(scene, /alphaMap: weedAlpha/);
    assert.match(scene, /material\.alphaMap = alphaMap/);
    assert.match(scene, /mesh\.setColorAt\(index, color\)/);
});
