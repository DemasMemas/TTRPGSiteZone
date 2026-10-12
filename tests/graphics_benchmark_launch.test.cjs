const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '../app/static/performance-benchmark.html'), 'utf8');
const docs = fs.readFileSync(path.join(__dirname, '../docs/GRAPHICS_BENCHMARK.md'), 'utf8');
const benchmark = fs.readFileSync(path.join(__dirname, '../app/static/js/performanceBenchmark.js'), 'utf8');

test('benchmark explains HTTP launch and does not load modules from file URLs', () => {
    assert.match(page, /location\.protocol === 'file:'/);
    assert.match(page, /script\.src = '\/static\/js\/performanceBenchmark\.js'/);
    assert.doesNotMatch(page, /<script type="module" src=/);
    assert.match(page, /http:\/\/127\.0\.0\.1:5000\/static\/performance-benchmark\.html/);
    assert.match(docs, /file:\/\//);
    assert.match(benchmark, /index < MAX_ANOMALY_RENDER_LIGHTS/);
    assert.match(benchmark, /localAnomalies\.add\(light\)/);
});
