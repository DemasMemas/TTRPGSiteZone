const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const textureSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationTerrainDetail.js'), 'utf8');
const surfaceSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationDarknessSurface.js'), 'utf8');
const sceneSource = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const worldSource = fs.readFileSync(path.join(__dirname, '../app/static/js/lobby3d.js'), 'utf8');
const waterSource = fs.readFileSync(path.join(__dirname, '../app/static/js/waterSurface.js'), 'utf8');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('terrain detail is repeatable, varied, and mipmapped', async () => {
    const { createTerrainDetailTexture } = await import(moduleUrl(textureSource));
    const samples = [];
    const canvas = {
        getContext: () => ({
            createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: image => samples.push(image.data.slice()),
        }),
    };
    class CanvasTexture {
        constructor(source) { this.image = source; }
    }
    const THREE = {
        CanvasTexture, RepeatWrapping: 'repeat', LinearMipmapLinearFilter: 'mipmap', LinearFilter: 'linear',
    };
    const texture = createTerrainDetailTexture(THREE, canvas);
    createTerrainDetailTexture(THREE, canvas);
    assert.equal(canvas.width, 256);
    assert.equal(texture.wrapS, 'repeat');
    assert.equal(texture.wrapT, 'repeat');
    assert.equal(texture.minFilter, 'mipmap');
    assert.deepEqual(samples[0], samples[1]);
    const shades = new Set();
    for (let index = 0; index < samples[0].length; index += 4) shades.add(samples[0][index]);
    assert.ok(shades.size > 30);
});

test('land uses world-space detail while water keeps its own material', async () => {
    const { applySurfaceDarkness } = await import(moduleUrl(surfaceSource));
    const land = {};
    const water = {};
    const detail = { id: 'terrain-detail' };
    const darkness = { id: 'darkness' };
    applySurfaceDarkness(land, darkness, { x: 8, y: 8 }, detail);
    applySurfaceDarkness(water, darkness, { x: 8, y: 8 });
    const makeShader = () => ({
        uniforms: {},
        vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>',
    });
    const landShader = makeShader();
    const waterShader = makeShader();
    land.onBeforeCompile(landShader);
    water.onBeforeCompile(waterShader);
    assert.equal(landShader.uniforms.locationTerrainDetail.value, detail);
    assert.match(landShader.fragmentShader, /texture2D\(locationTerrainDetail, vLocationDarkXZ \* 0\.14\)/);
    assert.doesNotMatch(waterShader.fragmentShader, /locationTerrainDetail/);
    assert.notEqual(land.customProgramCacheKey(), water.customProgramCacheKey());
    assert.doesNotMatch(sceneSource, /applySurfaceDarkness\(material, locationDarknessTexture, darknessSize, locationTerrainDetailTexture\)/);
    assert.match(sceneSource, /applySurfaceDarkness\(waterMaterial, locationDarknessTexture,/);
});

test('surface families have distinct base patterns and sparse defects', async () => {
    const { createSurfaceTexture } = await import(moduleUrl(textureSource));
    const patterns = new Map();
    const THREE = {
        CanvasTexture: class { constructor(canvas) { this.image = canvas; } },
        RepeatWrapping: 'repeat', LinearMipmapLinearFilter: 'mipmap', LinearFilter: 'linear',
        sRGBEncoding: 'srgb',
    };
    for (const kind of ['terrain', 'local_terrain', 'wall', 'road', 'floor', 'fence', 'water']) {
        let pixels;
        const canvas = { getContext: () => ({
            createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData: image => { pixels = image.data.slice(); },
        }) };
        const texture = createSurfaceTexture(THREE, kind, canvas);
        assert.equal(texture.wrapS, 'repeat');
        assert.equal(texture.minFilter, 'mipmap');
        const sample = [];
        for (let index = 0; index < pixels.length; index += 4) sample.push(pixels[index]);
        const contrast = Math.max(...sample) - Math.min(...sample);
        if (kind === 'wall') assert.ok(contrast > 4 && contrast < 35, kind);
        else if (kind === 'floor') {
            assert.ok(contrast > 20 && contrast < 90, kind);
            const boardFaces = sample.filter((_, index) => Math.floor(index / 128) % 32 !== 0);
            assert.ok(Math.min(...boardFaces) >= 210, 'floor boards stay free of dark blotches');
        }
        else assert.ok(contrast > (kind === 'local_terrain' || kind === 'water' ? 8 : 35), kind);
        patterns.set(kind, sample.join(','));
    }
    assert.equal(new Set(patterns.values()).size, patterns.size);
    assert.match(waterSource, /createSurfaceTexture\(THREE,\s*'water'\)/);
    assert.match(sceneSource, /asset\.id === 'art_worn_plaster' \|\| asset\.id === 'art_aged_wood'/);
    assert.match(sceneSource, /const usePbrMaterial = asset\?\.visual\?\.renderMode === 'pbr' && !quietHouseFinish/);
    assert.match(sceneSource, /quietGable \? quietHouseColor\(plan\.gableColor, 'wall'\)/);
});

test('world and local surfaces reuse world-space textures without replacing custom colors', async () => {
    const { applySurfacePattern } = await import(moduleUrl(textureSource));
    const material = { userData: {}, onBeforeCompile: shader => { shader.uniforms.existing = { value: true }; } };
    const texture = { id: 'wall' };
    applySurfacePattern(material, texture, 0.25);
    const shader = {
        uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.existing.value, true);
    assert.equal(shader.uniforms.surfacePatternMap.value, texture);
    assert.match(shader.vertexShader, /instanceMatrix \* surfaceWorld/);
    assert.match(shader.fragmentShader, /diffuseColor\.rgb \*= 0\.55 \+ 0\.55 \* surfaceShade/);
    assert.match(sceneSource, /\['wall', 'floor'\]\.includes\(obj\.type\)/);
    assert.match(sceneSource, /createFenceModel\(THREE, width, height, depth, fenceColor\)/);
    assert.match(worldSource, /applySurfacePattern\(roadMaterial/);
    assert.match(worldSource, /const fenceMat = po2Fence\.material/);
    assert.doesNotMatch(worldSource, /applySurfacePattern\(groundMat/);
    assert.match(sceneSource, /createLocationTerrainPixels\(tiles, 32, true\)/);

    const top = { userData: {} };
    applySurfacePattern(top, texture, 0.14, 'top');
    const topShader = {
        uniforms: {}, vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    top.onBeforeCompile(topShader);
    assert.match(topShader.fragmentShader, /surfaceUv = vSurfaceWorldPos\.xz/);
    assert.doesNotMatch(topShader.fragmentShader, /vSurfaceWorldNormal/);
});
