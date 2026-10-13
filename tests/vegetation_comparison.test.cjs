const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/static/js/vegetationComparisonVariants.js'), 'utf8');
const scene = fs.readFileSync(path.join(root, 'app/static/js/vegetationComparison.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'app/static/vegetation-comparison.html'), 'utf8');
const grassSource = fs.readFileSync(path.join(root, 'app/static/js/locationGrassDetail.js'), 'utf8');
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;

function geometryThree() {
    return {
        Float32BufferAttribute: class {
            constructor(array, itemSize) {
                Object.assign(this, { array, itemSize, count: array.length / itemSize });
            }
        },
        BufferGeometry: class {
            constructor() { this.attributes = {}; }
            setAttribute(name, attribute) { this.attributes[name] = attribute; }
            getAttribute(name) { return this.attributes[name]; }
            computeVertexNormals() {}
            dispose() {}
        },
    };
}

function placementThree() {
    class Object3D {
        constructor() {
            this.position = { set: (...value) => { this.positionValue = value; } };
            this.rotation = { set: (...value) => { this.rotationValue = value; } };
            this.scale = { set: (...value) => { this.scaleValue = value; } };
        }
        updateMatrix() {
            this.matrix = { position: this.positionValue,
                rotation: this.rotationValue, scale: this.scaleValue };
        }
    }
    class InstancedMesh {
        constructor(geometry, material, count) {
            Object.assign(this, { geometry, material, count,
                matrices: [], colors: [], instanceMatrix: {}, instanceColor: {} });
        }
        setMatrixAt(index, matrix) { this.matrices[index] = matrix; }
        setColorAt(index, color) { this.colors[index] = color.hsl; }
    }
    return {
        Group: class {
            constructor() { this.children = []; this.userData = {}; }
            add(mesh) { this.children.push(mesh); }
        },
        Object3D, InstancedMesh,
        Color: class { setHSL(...hsl) { this.hsl = hsl; return this; } },
    };
}

async function plotTufts() {
    const grass = await import(moduleUrl(grassSource));
    const variants = await import(moduleUrl(source));
    const tiles = Array.from({ length: 14 }, () =>
        Array.from({ length: 8 }, () => ({ terrain: 'grass' })));
    return { variants, tufts: grass.grassPlacements(tiles, variants.comparisonCovered).tufts };
}

test('D.2.1 reference geometry, texture recipe and material are pinned independently', async () => {
    const { fanCardGeometry, grassCardsD21Reference, createComparisonResources } = await import(moduleUrl(source));
    assert.deepEqual(grassCardsD21Reference, {
        blades: 7, textureStrands: 12, margin: 0.56,
        scaleX: 0.9, scaleY: 0.62, scaleZ: 0.9,
        hue: 0.14, hueRange: 0.13, saturation: 0.15, saturationRange: 0.16,
        lightness: 0.58, lightnessRange: 0.13,
    });
    const geometry = fanCardGeometry(geometryThree());
    const digest = attribute => {
        const floats = new Float32Array(geometry.getAttribute(attribute).array);
        return crypto.createHash('sha256').update(Buffer.from(floats.buffer)).digest('hex');
    };
    assert.equal(digest('position'), 'e23bc6a4de3f1e45e725c4489e1714438730fb0abcfe71fc3d92bb4971e84164');
    assert.equal(digest('uv'), 'cdde497ba53022c44b560f55e7af8cf4c28182de3aa22f2fe67f09a2498c8b57');

    const previousDocument = global.document;
    global.document = { createElement() {
        const context = {
            strokes: [], fills: [], beginPath() {}, moveTo() {}, quadraticCurveTo() {},
            ellipse() {}, stroke() { this.strokes.push([this.strokeStyle, this.lineWidth]); },
            fill() { this.fills.push(this.fillStyle); },
            getImageData() { return { data: new Uint8ClampedArray(256 * 256 * 4) }; },
            putImageData() {},
        };
        return { width: 0, height: 0, getContext() { return context; }, context };
    } };
    try {
        const THREE = {
            ...geometryThree(),
            CanvasTexture: class { constructor(canvas) { this.canvas = canvas; } },
            MeshLambertMaterial: class { constructor(options) { Object.assign(this, options); } },
            sRGBEncoding: 1, LinearMipmapLinearFilter: 2, LinearFilter: 3, DoubleSide: 4,
        };
        const resources = createComparisonResources(THREE);
        const reference = resources.textures.reference.canvas;
        assert.equal(reference.width, 256);
        assert.equal(reference.height, 256);
        assert.equal(reference.context.strokes.length, 12);
        assert.deepEqual(reference.context.strokes.slice(0, 4).map(stroke => stroke[0]),
            ['#d2c6a9', '#b1af91', '#9da488', '#e1d5b4']);
        assert.equal(reference.context.fills.length, 12);
        assert.equal(resources.materials.reference.map, resources.textures.reference);
        assert.equal(resources.materials.reference.alphaTest, 0.36);
        assert.equal(resources.materials.reference.transparent, false);
        assert.equal(resources.materials.reference.depthWrite, true);
        assert.equal(resources.materials.reference.side, THREE.DoubleSide);
        assert.equal(resources.textures.low.canvas.context.strokes.length, 9);
        assert.equal(resources.textures.tall.canvas.context.strokes.length, 6);
    } finally {
        global.document = previousDocument;
    }
});

test('D.2.1 reference keeps its placement count, transform and palette', async () => {
    const { variants, tufts } = await plotTufts();
    const positions = variants.prepareComparisonTufts(tufts, 1);
    assert.equal(positions.length, 494);
    const chosen = variants.selectGrassCardTypes(positions, 'reference');
    assert.equal(chosen.reference.length, positions.length);
    assert.equal(chosen.low.length, 0);
    assert.equal(chosen.tall.length, 0);
    const resources = { geometries: { reference: {} }, materials: { reference: {} } };
    const group = variants.createComparisonVegetation(placementThree(), 'reference',
        [{ x: 1, z: 4, size: 0.7, turn: 0.4 }], resources);
    assert.equal(group.children.length, 1);
    assert.deepEqual(group.children[0].matrices[0].position, [1, 0.004, 4]);
    assert.deepEqual(group.children[0].matrices[0].rotation, [0, 0.4, 0]);
    assert.deepEqual(group.children[0].matrices[0].scale,
        [0.7137992906088706, 0.4917284001972219, 0.7137992906088706]);
    assert.deepEqual(group.children[0].colors[0],
        [0.24219976974935267, 0.27578433199920327, 0.6821997697493526]);
});

test('low and tall cards have distinct grounded silhouettes, not resized reference geometry', async () => {
    const { fanCardGeometry } = await import(moduleUrl(source));
    const profiles = {};
    for (const kind of ['legacy', 'low', 'tall']) {
        const values = fanCardGeometry(geometryThree(), kind).getAttribute('position').array;
        const heights = values.filter((_, index) => index % 3 === 1);
        profiles[kind] = { triangles: values.length / 9, height: Math.max(...heights) };
        assert.equal(Math.min(...heights), 0);
    }
    assert.equal(profiles.legacy.triangles, 28);
    assert.equal(profiles.low.triangles, 24);
    assert.equal(profiles.tall.triangles, 16);
    assert.ok(profiles.low.height < profiles.legacy.height);
    assert.ok(profiles.legacy.height < profiles.tall.height);
});

test('four plots are deterministic; mixed cover has reference volume, low infill and rare tall grass', async () => {
    const { variants, tufts } = await plotTufts();
    const expected = {
        reference: { reference: 494, low: 0, tall: 0 },
        low: { reference: 0, low: 534, tall: 0 },
        tall: { reference: 0, low: 0, tall: 213 },
        mixed: { reference: 201, low: 162, tall: 21 },
    };
    for (const variant of Object.keys(expected)) {
        const margin = variant === 'reference' ? variants.grassCardsD21Reference.margin : 0.74;
        const positions = variants.prepareComparisonTufts(tufts, 1, margin);
        const original = structuredClone(positions);
        const selected = variants.selectGrassCardTypes(positions, variant);
        const counts = Object.fromEntries(Object.entries(selected)
            .map(([kind, items]) => [kind, items.length]));
        assert.deepEqual(counts, expected[variant]);
        assert.deepEqual(selected, variants.selectGrassCardTypes(structuredClone(positions), variant));
        assert.deepEqual(positions, original);
        const group = variants.createComparisonVegetation(placementThree(), variant,
            positions, { geometries: { reference: {}, low: {}, tall: {} },
                materials: { reference: {}, low: {}, tall: {} } });
        assert.equal(group.children.length, variant === 'mixed' ? 3 : 1);
        assert.deepEqual(group.userData.counts, expected[variant]);
        assert.ok(group.children.every(mesh => mesh.frustumCulled === false
            && mesh.castShadow === false && mesh.instanceMatrix.needsUpdate
            && mesh.instanceColor.needsUpdate));
    }
    assert.equal((html.match(/<button data-focus="(reference|low|tall|mixed)"/g) || []).length, 4);
    assert.match(scene, /\['reference', 'low', 'tall', 'mixed'\]/);
    assert.match(html, /data-angle="top"/);
    assert.match(html, /data-angle="game"/);
    assert.match(html, /data-angle="low"/);
    assert.match(scene, /top: \[0, Math\.PI \/ 2\]/);
    assert.match(scene, /camera\.up\.set\(0, state\.pitch === Math\.PI \/ 2 \? 0 : 1/);
});

test('stress placements and whole silhouettes stay within each plot at all densities', async () => {
    const { variants, tufts } = await plotTufts();
    const maxGeometryRadius = { reference: 0.5, low: 0.6, tall: 0.34 };
    const maxFootprint = { reference: 0.9, low: 0.99 * 1.1, tall: 0.83 * 1.1 };
    for (const density of [1, 5, 10]) {
        for (const variant of ['reference', 'low', 'tall', 'mixed']) {
            const margin = variant === 'reference' ? 0.56 : 0.74;
            const positions = variants.prepareComparisonTufts(tufts, density, margin);
            assert.deepEqual(positions, variants.prepareComparisonTufts(tufts, density, margin));
            const selected = variants.selectGrassCardTypes(positions, variant);
            for (const [kind, items] of Object.entries(selected)) {
                for (const { x, z, size } of items) {
                    const radius = maxGeometryRadius[kind] * maxFootprint[kind] * size * 1.21;
                    assert.ok(variants.withinComparisonPlot(x, z, radius));
                }
            }
        }
    }
    assert.match(scene, /vegetation\.position\.x = -4/);
    assert.match(scene, /vegetationByDensity\.get\(density\)/);
    assert.match(scene, /vegetationByDensity\.set\(density, vegetation\)/);
    assert.match(scene, /renderer\.info\.reset\(\)/);
    assert.match(html, /value="10"/);
});

test('height callback anchors every variant and shared resources have one teardown path', async () => {
    const { createComparisonVegetation } = await import(moduleUrl(source));
    const resources = { geometries: { reference: {}, low: {}, tall: {} },
        materials: { reference: {}, low: {}, tall: {} } };
    const tufts = Array.from({ length: 100 }, (_, i) => ({
        x: 1 + (i % 10) * 0.3, z: 4 + Math.floor(i / 10) * 0.2,
        size: 0.7, turn: i / 13,
    }));
    const options = { getHeight: (x, z) => x * 0.1 + z * 0.2,
        habitatAt: () => 'fence', acceptsSatellite: () => false };
    for (const variant of ['reference', 'low', 'tall', 'mixed']) {
        const group = createComparisonVegetation(placementThree(), variant, tufts, resources, options);
        const matrices = group.children.flatMap(mesh => mesh.matrices);
        assert.ok(matrices.length > 0);
        assert.ok(matrices.every(({ position: [x, y, z] }) =>
            Math.abs(y - options.getHeight(x, z) - 0.004) < 1e-9));
    }
    assert.match(scene, /if \(event\.persisted\) return/);
    assert.match(scene, /Object\.values\(vegetationResources\.geometries\)/);
    assert.match(scene, /Object\.values\(vegetationResources\.materials\)/);
    assert.match(scene, /Object\.values\(vegetationResources\.textures\)/);
    assert.match(html, /three@0\.128\.0/);
    assert.match(html, /location\.protocol === 'file:'/);
});
