const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationDarknessSurface.js'), 'utf8');
const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('darkness texture stores the mechanical cell factors without changing them', async () => {
    const { writeDarknessPixels } = await import(moduleUrl);
    const factors = new Float32Array([0.07, 0.5, 1]);
    const pixels = new Uint8Array(12);
    writeDarknessPixels(factors, pixels);
    assert.deepEqual([...pixels], [18, 18, 18, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    assert.ok(Math.abs(factors[0] - 0.07) < 0.000001);
});

test('ground shader samples interpolated darkness at world positions', async () => {
    const { applySurfaceDarkness } = await import(moduleUrl);
    const material = {};
    const texture = { id: 'darkness' };
    const size = { x: 10, y: 8 };
    applySurfaceDarkness(material, texture, size);
    const shader = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.locationDarknessMap.value, texture);
    assert.equal(shader.uniforms.locationDarknessSize.value, size);
    assert.match(shader.vertexShader, /instanceMatrix \* locationDarkWorld/);
    assert.match(shader.vertexShader, /modelMatrix \* locationDarkWorld/);
    assert.match(shader.fragmentShader, /vLocationDarkXZ \/ locationDarknessSize/);
    assert.match(shader.fragmentShader, /diffuseColor\.rgb \*= texture2D/);
    assert.match(scene, /locationDarknessTexture\.magFilter = THREE\.LinearFilter/);
    assert.match(scene, /locationDarknessTexture\.minFilter = THREE\.LinearFilter/);
    assert.match(scene, /applySurfaceDarkness\(waterMaterial, locationDarknessTexture,/);
    assert.match(scene, /applySurfaceDarkness\(material, locationDarknessTexture,\s*new THREE\.Vector2\(width, height\), null, ensureTerrainGrassDetail\(\)\)/);
    assert.match(scene, /new THREE\.Color\(terrainColors\[tile\.terrain\] \|\| 0x3a5f0b\)\s*\.multiplyScalar\(darknessFactorAt\(x, z\)\)/);
    assert.match(scene, /new THREE\.Color\(terrainColors\[terrain\] \|\| 0x3a5f0b\)\s*\.multiplyScalar\(darknessFactorAt\(x, z\)\)/);
});

test('grass photo detail uses the editable blend mask without changing darkness', async () => {
    const { applySurfaceDarkness } = await import(moduleUrl);
    const photos = { earth: {}, forest: {}, blend: {}, ready: { value: 0 } };
    const material = {};
    applySurfaceDarkness(material, {}, { x: 8, y: 8 }, null, photos);
    const shader = { uniforms: {},
        vertexShader: '#include <common>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <color_fragment>' };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.locationGrassEarth.value, photos.earth);
    assert.equal(shader.uniforms.locationGrassForest.value, photos.forest);
    assert.equal(shader.uniforms.locationGrassBlend.value, photos.blend);
    assert.equal(shader.uniforms.locationGrassReady, photos.ready);
    assert.match(shader.fragmentShader, /grassWeights\.r \+ grassWeights\.g/);
    assert.match(shader.fragmentShader, /diffuseColor\.rgb \*= texture2D\(locationDarknessMap/);
    assert.match(material.customProgramCacheKey(), /photo-grass/);
});
