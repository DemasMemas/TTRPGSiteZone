// Approval-only landscape composition in the harness's temporary game/database.
// No production textures, shaders, rendering settings or user maps are edited.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

module.exports = async ({ page, request, token, lobby }) => {
    const output = path.resolve(__dirname, '../docs/material-previews/bog-composition');
    fs.mkdirSync(output, { recursive: true });
    const productionFiles = ['lobby3d.js', 'terrainMaterialCatalog.js', 'terrainMaterialLayer.js',
        'locationScene.js', 'locationTerrainTexture.js'];
    const hashes = () => Object.fromEntries(productionFiles.map(file => [file,
        crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../app/static/js', file))).digest('hex')]));
    const before = hashes();
    // Hand-authored cells: S = current swamp, g = grass, d = bare dirt.
    // One character = 100 x 100 metres. No noise, repeated stamp or subcell mask.
    const rows = [
        'gggggggggggggggggggggggggggggggg',
        'gggggggggggggggggggggggggggggggg',
        'ggggggggggggSSSSgggggggggggggggg',
        'gggggggggSSSSSSSSSgggggggggggggg',
        'gggggggSSSSSSSSSSSSSSggggggggggg',
        'ggggggSSSSSSSSSSSSSSSSSggggggggg',
        'gggggSSSSSSSSSSSSSSSSSSSSggggggg',
        'gggggSSSSSSSSSSggSSSSSSSSSgggggg',
        'ggggSSSSSSSSSSSgdgSSSSSSSSSggggg',
        'ggggSSSSSSSSSSSSggSSSSSSSSSSgggg',
        'gggSSSSSSSSSSSSSSSSSSSSSSSSggggg',
        'gggSSSSSSSSSSSSSSSSSSSSSSSSggggg',
        'ggggSSSSSSSSSSSSSSSSSSSSSSSggggg',
        'ggggSSSSSSSSSSSSSSSSSSSSSSgggggg',
        'gggggSSSSSSggSSSSSSSSSSSSSgggggg',
        'ggggggSSSSgddgSSSSSSSSSSSggggggg',
        'gggggggSSSSggSSSSSSSSSSSSggggggg',
        'ggggggggSSSSSSSSSSSSSSSSgggggggg',
        'ggggggggggSSSSSSSSSSSSgggggggggg',
        'ggggggggggggSSSSSSSSgggggggggggg',
        'gggggggggggggggggggggggggggggggg',
        'gggggggggggggggggggggggggggggggg',
    ];
    assert.ok(rows.every(row => row.length === 32), '32 manually authored cells per row');
    const origin = { x: 16, z: 5 };
    // Sparse groups restricted to margins and the two authored dry islands.
    const groves = [
        [9, 3, 'forest', 0.55, 25], [7, 4, 'tree', 0.55, 80],
        [5, 7, 'forest', 0.65, 120], [4, 9, 'tree', 0.45, 10],
        [6, 15, 'forest', 0.6, 65], [8, 17, 'tree', 0.6, 20],
        [13, 19, 'forest', 0.55, 145], [23, 17, 'tree', 0.5, 30],
        [25, 12, 'forest', 0.6, 45], [24, 7, 'tree', 0.55, 90],
        [20, 4, 'forest', 0.5, 110],
        [16, 8, 'tree', 0.5, 40], [11, 15, 'forest', 0.5, 15],
    ].map(([x, z, type, scale, rotation]) => ({ x: origin.x + x, z: origin.z + z,
        object: { type, scale, rotation, color: '#59634a', x: 0.08, z: -0.08 } }));
    const earthMargin = { 18: [44, 47], 19: [43, 49], 20: [42, 50], 21: [43, 50],
        22: [44, 51], 23: [45, 51], 24: [45, 50], 25: [46, 49] };
    const updates = [];
    for (let z = 0; z < 32; z++) for (let x = 0; x < 64; x++) {
        const symbol = rows[z - origin.z]?.[x - origin.x] || 'g';
        // An adjoining exposed-earth margin gives a second transition reference.
        const earth = earthMargin[z];
        const terrain = symbol === 'S' ? 'swamp' : symbol === 'd' || (earth && x >= earth[0] && x <= earth[1]) ? 'bare_dirt' : 'grass';
        updates.push({ chunk_x: x >> 5, chunk_y: 0, tile_x: x % 32, tile_y: z,
            updates: { terrain, height: 1, objects: [] } });
    }
    const upload = () => request(`/lobbies/${lobby.id}/chunks/batch`, updates, token);
    await upload();
    await page.until("sceneModule.chunksMap.get('1,0').tilesData[15][0].terrain==='swamp' && sceneModule.getWorldTerrainMaterialDiagnostics().ready", 'composition terrain');
    // Hide only obstructing collapsible panels, preserving the normal game scene.
    await page.evaluate(`document.querySelectorAll('.draggable-panel:not(.collapsed) .panel-header .toggle-btn').forEach(button=>button.click())`);
    await page.evaluate(`window.drawBogComposition=sceneModule.renderer.render.bind(sceneModule.renderer);sceneModule.renderer.render=()=>{}`);
    const cameras = {
        overview: { target: [32, 1, 16], position: [39, 27, 45] },
        distant: { target: [32, 1, 16], position: [43, 43, 65] },
        edge: { target: [24, 1, 18], position: [28, 9, 29] },
        islands: { target: [31, 1, 17], position: [36, 13, 31] },
    };
    const capture = async (name, view) => {
        await page.evaluate(`sceneModule.controls.target.set(${view.target});sceneModule.camera.position.set(${view.position});sceneModule.controls.update();sceneModule.setCelestialTime(720)`);
        await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        await page.evaluate('sceneModule.setCelestialTime(720);sceneModule.renderer.shadowMap.needsUpdate=true;drawBogComposition(sceneModule.scene,sceneModule.camera)');
        fs.writeFileSync(path.join(output, name + '.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
        console.log('Composition screenshot:', name);
    };
    await capture('01-without-trees', cameras.overview);
    for (const grove of groves) {
        updates.find(t => t.chunk_x * 32 + t.tile_x === grove.x && t.tile_y === grove.z).updates.objects.push(grove.object);
    }
    await upload();
    await page.until("sceneModule.chunksMap.get('0,0').tilesData[8][25].objects.length===1", 'composition objects');
    for (const [name, camera] of Object.entries(cameras)) await capture('02-' + name, camera);
    const saved = await request(`/lobbies/${lobby.id}/chunks?min_chunk_x=0&max_chunk_x=1&min_chunk_y=0&max_chunk_y=0`, null, token, 'GET');
    for (const tile of updates) {
        const stored = saved.find(c => c.chunk_x === tile.chunk_x).data[tile.tile_y][tile.tile_x];
        assert.deepEqual(stored.objects, tile.updates.objects);
        assert.equal(stored.terrain, tile.updates.terrain);
        assert.equal(stored.height, 1);
    }
    const diagnostics = await page.evaluate(`(()=>{const r=sceneModule.renderer;return {shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length,calls:r.info.render.calls,triangles:r.info.render.triangles,forestInstanced:[...sceneModule.chunksMap.values()].filter(c=>c.landmarks.forest?.isInstancedMesh).length}})()`);
    assert.equal(diagnostics.shaderErrors, 0);
    assert.ok(diagnostics.forestInstanced > 0);
    assert.ok(updates.every(t => t.updates.terrain !== 'water'));
    assert.deepEqual(hashes(), before, 'production source unchanged');
    fs.writeFileSync(path.join(output, 'layout.json'), JSON.stringify({ metresPerCell: 100, origin, legend: { S: 'swamp', g: 'grass', d: 'bare_dirt' }, rows, earthMargin, groves, cameras, updates, diagnostics, productionHashes: before }, null, 2) + '\n');
    console.log('PASS: hand-authored composition, 13 sparse tree/group objects, real game captures, no water or production changes', diagnostics);
};
