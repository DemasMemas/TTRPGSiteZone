const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = file => fs.readFileSync('app/static/js/' + file, 'utf8');

test('field lifetime follows scene loading; legacy enable/disable API, UI and alternate pools are absent', () => {
    const scene = read('locationScene.js');
    assert.match(scene, /function initializeLocationLightField\(/);
    assert.match(scene, /controls\.update\(\);\s*updateLampPreviewLights\(\);\s*initializeLocationLightField\(\);/);
    assert.match(scene, /function\* buildLocationStages\(data\)\s*\{[\s\S]*?disposeLocationLightField\(\);/);
    assert.match(scene, /export function destroyLocationScene\(\)[\s\S]*?disposeLocationLightField\(\);/);
    for (const obsolete of ['setLocationStaticLightFieldEnabled', 'locationStaticLightFieldButton',
        'staticFieldLastToggle', 'setStaticObjectRenderLightsEnabled', 'createFirePointLight',
        'createLampRenderPool', 'setLampSlotTargets', 'selectLocationLampRenderSources']) {
        assert.ok(!scene.includes(obsolete), obsolete);
    }
    assert.ok(!fs.existsSync('app/static/js/locationStaticLightFieldPrototype.js'));
    assert.doesNotMatch(read('locationStaticLightField.js'), /createLocationStaticLightField|remapStaticLightFieldSlots/);
});

test('the production shader always adds the field and keeps sun, maps and material lifecycle', () => {
    const source = read('locationDirectionalLightFieldPrototype.js');
    assert.doesNotMatch(source, /directionalFieldEnabled|controls\.enabled/);
    assert.match(source, /reflectedLight\.indirectDiffuse \+= fieldIrradiance/);
    assert.match(source, /previousCompile\?\.\(shader\)/);
    assert.match(source, /previousKey/);
    assert.match(source, /removeDirectionalLightFieldMaterial/);
    const scene = read('locationScene.js');
    assert.match(scene, /createLocationShadowCache/);
    assert.match(scene, /refreshLocationDarkness\(profile\)/);
    assert.match(scene, /createLampPreviewLights/);
    assert.match(scene, /updateAnomalyRenderLights/);
});
