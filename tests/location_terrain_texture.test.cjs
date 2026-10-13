const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationTerrainTexture.js'), 'utf8');
const subtypeSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationGrassSubtype.js'), 'utf8');
const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const subtypeUrl = `data:text/javascript;base64,${Buffer.from(subtypeSource).toString('base64')}`;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    source.replace("'./locationGrassSubtype.js'", `'${subtypeUrl}'`)).toString('base64')}`;

test('terrain texture varies by soil and blends adjacent cells continuously', async () => {
    const { createLocationTerrainPixels, updateLocationTerrainPixels } = await import(moduleUrl);
    const tiles = [[...['grass', 'sand', 'swamp', 'rock'].map(terrain => ({ terrain }))]];
    const image = createLocationTerrainPixels(tiles, 20);
    assert.equal(image.width, 80);
    assert.equal(image.height, 20);
    const color = (x, z = 10) => Array.from(image.data.slice((z * image.width + x) * 4,
        (z * image.width + x) * 4 + 3));
    const grass = color(10);
    const sand = color(30);
    const swamp = color(50);
    const rock = color(70);
    assert.ok(grass[0] > grass[1]);
    assert.ok(sand[0] > grass[0] + 80);
    assert.ok(swamp[0] < sand[0] - 60);
    assert.ok(Math.abs(rock[0] - rock[1]) < 20);
    assert.ok(Math.abs(color(19)[0] - color(20)[0]) < 25);
    assert.deepEqual(createLocationTerrainPixels(tiles, 20).data, image.data);
    tiles[0][1].terrain = 'grass';
    updateLocationTerrainPixels(tiles, image, [{ x: 1, z: 0 }]);
    assert.deepEqual(image.data, createLocationTerrainPixels(tiles, 20).data);
});

test('grass soil is muted and has deterministic dry patches', async () => {
    const { createLocationTerrainPixels } = await import(moduleUrl);
    const tiles = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => ({ terrain: 'grass' })));
    const image = createLocationTerrainPixels(tiles, 12);
    let minRed = 255;
    let maxRed = 0;
    let greenBias = 0;
    for (let index = 0; index < image.data.length; index += 4) {
        minRed = Math.min(minRed, image.data[index]);
        maxRed = Math.max(maxRed, image.data[index]);
        greenBias += image.data[index + 1] - image.data[index];
    }
    assert.ok(maxRed - minRed > 20);
    assert.ok(greenBias / (image.data.length / 4) < 20);
    assert.deepEqual(image.data, createLocationTerrainPixels(structuredClone(tiles), 12).data);
    assert.match(scene, /terrainSurfaceTexture\.encoding = THREE\.sRGBEncoding/);
});

test('legacy grass stays plain and forest subtype changes only grass surface', async () => {
    const { createLocationTerrainPixels } = await import(moduleUrl);
    const plain = [[{ terrain: 'grass' }, { terrain: 'sand' }]];
    const explicitPlain = [[{ terrain: 'grass', grass_subtype: 'plain' }, { terrain: 'sand' }]];
    const forest = [[{ terrain: 'grass', grass_subtype: 'forest' }, { terrain: 'sand' }]];
    assert.deepEqual(createLocationTerrainPixels(plain, 20).data,
        createLocationTerrainPixels(explicitPlain, 20).data);
    assert.deepEqual(createLocationTerrainPixels(forest, 20).data,
        createLocationTerrainPixels(plain, 20).data);
});

test('loaded plain and forest ground images reach their matching game tiles', async () => {
    const { loadGrassGroundPixels, createLocationTerrainPixels,
        updateLocationTerrainPixels } = await import(moduleUrl);
    const previousImage = global.Image;
    const previousDocument = global.document;
    const urls = [];
    global.Image = class {
        set src(url) {
            this.url = url;
            urls.push(url);
            queueMicrotask(() => this.onload());
        }
    };
    global.document = { createElement: () => ({ getContext: () => ({
        drawImage(image) { this.source = image.url; },
        getImageData() {
            const data = new Uint8ClampedArray(512 * 512 * 4);
            const color = this.source.includes('forrest_ground')
                ? [55, 80, 52] : [155, 125, 98];
            for (let index = 0; index < data.length; index += 4) data.set([...color, 255], index);
            return { data };
        },
    }) }) };
    try {
        await loadGrassGroundPixels();
        assert.equal(urls.length, 2);
        assert.ok(urls.some(url => url.includes('dirty_earth')));
        assert.ok(urls.some(url => url.includes('forrest_ground')));
        const tiles = [[...Array.from({ length: 2 }, () => ({ terrain: 'grass' })),
            ...Array.from({ length: 2 }, () => ({ terrain: 'grass', grass_subtype: 'forest' }))]];
        const image = createLocationTerrainPixels(tiles, 20, true);
        const red = x => image.data[(10 * image.width + x) * 4];
        const green = x => image.data[(10 * image.width + x) * 4 + 1];
        assert.ok(red(10) > red(70) + 10);
        assert.ok(green(10) > red(10));
        const mask = (x, channel) => image.grassBlendData[(10 * image.width + x) * 4 + channel];
        assert.ok(mask(10, 0) > 240 && mask(10, 1) < 15);
        assert.ok(mask(70, 1) > 240 && mask(70, 0) < 15);
        assert.ok(mask(40, 0) > 0 && mask(40, 1) > 0);
        tiles[0][0].grass_subtype = 'forest';
        updateLocationTerrainPixels(tiles, image, [{ x: 0, z: 0 }]);
        assert.ok(mask(10, 1) > 240 && mask(10, 0) < 15);
        assert.match(scene, /loadGrassGroundPixels\(\)\.then/);
        assert.match(scene, /createLocationTerrainPixels\(tiles, 32, true\)/);
        assert.match(scene, /terrainGrassBlendTexture\.needsUpdate = true/);
    } finally {
        global.Image = previousImage;
        global.document = previousDocument;
    }
});

test('swamp soil has distinct moss and dark wet pockets instead of uniform blur', async () => {
    const { createLocationTerrainPixels } = await import(moduleUrl);
    const tiles = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => ({ terrain: 'swamp' })));
    const { data } = createLocationTerrainPixels(tiles, 20);
    let wetPixels = 0;
    let mossPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
        if (data[index] < 58 && data[index + 2] > 50) wetPixels++;
        if (data[index + 1] > data[index] + 10) mossPixels++;
    }
    assert.ok(wetPixels > 100);
    assert.ok(mossPixels > 100);
    assert.ok(wetPixels < data.length / 4);
});

test('overlapping world texture regions use identical pixels at chunk seams', async () => {
    const { createTerrainPixelsRegion } = await import(moduleUrl);
    const terrain = (x, z) => (x < 4 ? 'grass' : z < 2 ? 'sand' : 'swamp');
    const left = createTerrainPixelsRegion(terrain, -1, -1, 128, 12);
    const right = createTerrainPixelsRegion(terrain, 3, -1, 128, 12);
    for (let z = 0; z < 64; z++) {
        for (let x = 0; x < 48; x++) {
            const a = (z * left.width + x + 48) * 4;
            const b = (z * right.width + x) * 4;
            assert.deepEqual(left.data.slice(a, a + 4), right.data.slice(b, b + 4));
        }
    }
});

test('world texture updates only the edited neighborhood without changing distant pixels', async () => {
    const { createTerrainPixelsRegion, updateTerrainPixelsRegion } = await import(moduleUrl);
    const kinds = new Map();
    const terrain = (x, z) => kinds.get(`${x},${z}`) || 'grass';
    const image = createTerrainPixelsRegion(terrain, -1, -1, 128, 12);
    const before = image.data.slice();
    kinds.set('3,3', 'sand');
    assert.equal(updateTerrainPixelsRegion(image, terrain, -1, -1,
        { minX: 3, maxX: 3, minZ: 3, maxZ: 3 }, 12), true);
    assert.deepEqual(image.data, createTerrainPixelsRegion(terrain, -1, -1, 128, 12).data);
    assert.deepEqual(image.data.slice(0, 4), before.slice(0, 4));
    assert.equal(updateTerrainPixelsRegion(image, terrain, -1, -1,
        { minX: 100, maxX: 100, minZ: 100, maxZ: 100 }, 12), false);
});

test('land overlay follows slope geometry and water has a solid backing', () => {
    assert.match(scene, /createLocationTerrainPixels\(tiles, 32, true\)/);
    assert.match(scene, /if \(topFlags\.getX\(face \* 3\) < 0\.5\) continue/);
    assert.match(scene, /new THREE\.InstancedMesh\(geometry\.clone\(\), \[/);
    assert.match(scene, /waterTopMaterial = new THREE\.MeshBasicMaterial\(\{ colorWrite: false, depthWrite: false \}\)/);
    assert.match(scene, /bankGeometry\.setAttribute\('uv', new THREE\.Float32BufferAttribute\(data\.bankUvs, 2\)\)/);
    assert.match(scene, /map: terrainSurfaceTexture, vertexColors: true, side: THREE\.DoubleSide/);
    assert.match(scene, /applySurfaceDarkness\(bankMaterial, locationDarknessTexture/);
    assert.doesNotMatch(scene, /function updateTerrainSurfaceDarkness\(/);
});
