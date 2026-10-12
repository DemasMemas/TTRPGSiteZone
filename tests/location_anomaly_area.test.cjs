const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../app/static/js/locationAnomalyArea.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('route preview uses the same 75 percent anomaly footprint as the server', async () => {
    const { anomalyCoversTile } = await import(moduleUrl);
    const anomaly = { type: 'anomaly', dimensions: { width: 2.5, depth: 1 } };
    assert.equal(anomalyCoversTile(anomaly, 2, 2, 3, 2), true);
    anomaly.dimensions.width = 2.48;
    assert.equal(anomalyCoversTile(anomaly, 2, 2, 3, 2), false);
    anomaly.dimensions.width = 2.5;
    anomaly.rotation = 90;
    assert.equal(anomalyCoversTile(anomaly, 2, 2, 2, 3), true);
    assert.equal(anomalyCoversTile(anomaly, 2, 2, 3, 2), false);
    assert.equal(anomalyCoversTile({ type: 'anomaly', scale: 2.5 }, 2, 2, 3, 2), true);
    assert.equal(anomalyCoversTile({ tile_x: 1, tile_y: 3, properties: {
        dimensions: { width: 2.5, depth: 1 }, offset_x: 0.25,
    } }, 1, 3, 2, 3), true);
});

test('route preview checks the expanded anomaly zone rather than just its source tile', () => {
    const scene = fs.readFileSync(path.join(__dirname, '../app/static/js/locationScene.js'), 'utf8');
    const route = scene.slice(scene.indexOf('function buildRoutePoints('), scene.indexOf('function ', scene.indexOf('function buildRoutePoints(') + 1));
    assert.match(route, /anomalyCoversTile\(object, originX, originY, x, y\)/);
    assert.match(route, /window\.isGM \|\| !object\.gm_hidden/);
    assert.match(route, /window\.isGM \|\| !object\.properties\?\.gm_hidden/);
});
