const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAnomalyLight.js'), 'utf8');
const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('visible elemental anomalies add weak light; hidden and other types do not', async () => {
    const { getAnomalyLightSources } = await import(moduleUrl);
    const tiles = [[{ objects: [
        { type: 'anomaly', anomalyType: 'fire' },
        { type: 'anomaly', anomalyType: 'electric', x: 0.2 },
        { type: 'anomaly', anomalyType: 'acid', elevation: 1 },
        { type: 'anomaly', anomalyType: 'fire', gm_hidden: true },
        { type: 'anomaly', anomalyType: 'void' },
    ] }]];
    const sources = getAnomalyLightSources(tiles);
    assert.equal(sources.length, 3);
    assert.ok(sources.every(source => source.intensity < 1 && source.castsShadow === false));
    assert.equal(sources[1].x, 0.7);
    assert.equal(sources[2].height, 1.55);
});

test('anomaly light feeds both three-dimensional lighting and darkness rules', () => {
    assert.match(scene, /getLocationEmissiveSources\(\)/);
    assert.match(scene, /getAnomalyLightSources\(currentLocationData\?\.tiles_data\)/);
    assert.match(scene, /for \(const source of \[\.\.\.getLocationDecorFireSources\(\),\s*\.\.\.getAnomalyLightSources\(currentLocationData\?\.tiles_data\)\]\)/);
    assert.match(scene, /\.\.\.getLocationEmissiveSources\(\)\], daylight/);
});
