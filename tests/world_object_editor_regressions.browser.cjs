const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ page, request, token, lobby, base, connect, debugPort, profile }) => {
    const originals = [1, .8, 1.2].map((scale, index) => ({ type: 'house', name: `Group-${index}`, scale,
        rotation: index * 30, color: '#8b4513', custom: { retained: index }, x: .1, z: -.1 }));
    for (let index = 0; index < 3; index++) await request(`/lobbies/${lobby.id}/chunks/0/0/tile/${20 + index * 2}/8`, { objects: [originals[index]] }, token, 'PATCH');
    await page.evaluate(`(async()=>{window.mapEditor=await import('/static/js/mapEdit.js');sceneModule.controls.target.set(24,1,10);sceneModule.camera.position.set(29,16,25);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld();window.toggleEditMode();mapEditor.selectWorldEditorTool('select')})()`);
    const read = client => client.evaluate(`(()=>{const result=[];for(const entry of sceneModule.chunksMap.values())entry.tilesData.forEach((row,y)=>row.forEach((tile,x)=>(tile.objects||[]).forEach(object=>{if(object.name?.startsWith('Group-'))result.push({...object,worldX:entry.chunkX*32+x+.5+(object.x||0),worldZ:entry.chunkY*32+y+.5+(object.z||0)})})));return result.sort((a,b)=>a.name.localeCompare(b.name))})()`);
    await page.until(`sceneModule.chunksMap.get('0,0').tilesData[8][24].objects[0]?.name==='Group-2'`, 'group fixture');
    const project = async (x, y, z) => page.evaluate(`(()=>{sceneModule.camera.updateMatrixWorld();const p=new threeModule.Vector3(${x},${y},${z}).project(sceneModule.camera);const r=sceneModule.renderer.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const click = async (point, modifiers = 0, button = 'left') => {
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, modifiers });
        await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, modifiers, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 });
        await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, modifiers, button, buttons: 0, clickCount: 1 });
    };
    const key = async (code, value) => {
        await page.call('Input.dispatchKeyEvent', { type: 'keyDown', code, key: value });
        await page.call('Input.dispatchKeyEvent', { type: 'keyUp', code, key: value });
    };
    const selected = () => page.evaluate('getDirectWorldObjectSelection().length');
    const settled = () => page.until(`!document.getElementById('world-selection-editor').disabled`, 'selection save');
    const centers = [];
    for (let index = 0; index < 3; index++) {
        const y = await page.evaluate(`1+sceneModule.getObjectHeightOffset('house')*${originals[index].scale}`);
        centers.push(await project(20.6 + index * 2, y, 8.4));
    }
    await page.until(`sceneModule.pickWorldObject(${centers[0].x},${centers[0].y})?.tileX===20`, 'fixture object instances ready for picking');
    await click(centers[0]); assert.equal(await selected(), 1);
    await click(centers[1], 8); assert.equal(await selected(), 2);
    await click(centers[2], 8); assert.equal(await selected(), 3);
    assert.match(await page.evaluate(`document.getElementById('world-selection-title').textContent`), /3/);
    const image = name => page.call('Page.captureScreenshot', { format: 'png' }).then(result => fs.writeFileSync(path.join(profile, name), Buffer.from(result.data, 'base64')));
    await image('world-multiple-selection.png');
    await click(centers[1], 8); assert.equal(await selected(), 2);
    assert.deepEqual(await read(page), originals.map((object, index) => ({ ...object, worldX: 20.6 + index * 2, worldZ: 8.4 })));
    await click(centers[0]); assert.equal(await selected(), 1);
    await click(centers[1], 8); await click(centers[2], 8);

    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const protocol = await connect(version.webSocketDebuggerUrl);
    let observer, target;
    try {
        target = await protocol.call('Target.createTarget', { url: `${base}/lobbies/${lobby.id}/page` });
        const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        observer = await connect(pages.find(item => item.id === target.targetId).webSocketDebuggerUrl);
        await observer.call('Page.enable'); await observer.call('Runtime.enable');
        await observer.until(`window.beginDirectWorldObjectEdit && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'second real client');
        await observer.evaluate(`(async()=>{window.sceneModule=await import('/static/js/lobby3d.js')})()`);
        await page.call('Page.bringToFront');
        const before = await read(page);
        await key('KeyG', 'g');
        const destination = await project(30.25, 1, 12.25);
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...destination });
        assert.deepEqual(await read(page), before, 'group preview does not save');
        await click(destination); await settled();
        const moved = await read(page);
        const deltaX = moved[0].worldX - before[0].worldX, deltaZ = moved[0].worldZ - before[0].worldZ;
        moved.forEach((object, index) => {
            assert.ok(Math.abs(object.worldX - before[index].worldX - deltaX) < 1e-8);
            assert.ok(Math.abs(object.worldZ - before[index].worldZ - deltaZ) < 1e-8);
            assert.deepEqual(object.custom, before[index].custom);
        });
        await key('KeyE', 'e'); await settled();
        const turned = await read(page);
        turned.forEach((object, index) => assert.equal(object.rotation, (before[index].rotation + 345) % 360));
        const distance = (a, b) => Math.hypot(a.worldX - b.worldX, a.worldZ - b.worldZ);
        assert.ok(Math.abs(distance(turned[0], turned[2]) - distance(moved[0], moved[2])) < 1e-8);
        await key('Equal', '+'); await settled();
        const scaled = await read(page);
        scaled.forEach((object, index) => assert.ok(Math.abs(object.scale - before[index].scale * 1.1) < 1e-8));
        assert.ok(Math.abs(distance(scaled[0], scaled[2]) - distance(turned[0], turned[2]) * 1.1) < 1e-8);
        await key('KeyR', 'r');
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: destination.x + 30, y: destination.y });
        await click({ x: destination.x + 30, y: destination.y }, 0, 'right');
        assert.deepEqual(await read(page), scaled, 'RMB cancels group transform');
        await observer.until(`JSON.stringify((()=>{const rows=[];for(const entry of sceneModule.chunksMap.values())entry.tilesData.forEach(row=>row.forEach(tile=>(tile.objects||[]).forEach(o=>{if(o.name?.startsWith('Group-'))rows.push([o.name,o.scale,o.rotation])})));return rows.sort()})())===${JSON.stringify(JSON.stringify(scaled.map(o => [o.name, o.scale, o.rotation]).sort()))}`, 'group transforms synchronized');
        assert.deepEqual(await read(observer), scaled);
        console.log('PASS: native Shift toggle, single selection, group G/E/+ transforms, relative arrangement, custom properties and second-client synchronization');

        await page.evaluate(`document.getElementById('panel-characters').classList.add('collapsed');sceneModule.controls.target.set(38,1,14);sceneModule.camera.position.set(43,16,29);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld();document.querySelector('[data-world-tool="objects"]').click();document.querySelector('[data-world-object="factory"]').click()`);
        const placement = await project(39.25, 1, 14.25);
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...placement });
        const preview = `sceneModule.scene.children.find(mesh=>mesh.userData.previewType==='factory')`;
        await page.until(`Boolean(${preview})`, 'placement preview');
        await key('KeyQ', 'q');
        assert.equal(await page.evaluate(`document.getElementById('world-object-rotation').value`), '15');
        assert.ok(Math.abs(await page.evaluate(`${preview}.rotation.y`) - Math.PI / 12) < 1e-8);
        await key('KeyE', 'e');
        assert.equal(await page.evaluate(`document.getElementById('world-object-rotation').value`), '0');
        await key('KeyE', 'e');
        assert.equal(await page.evaluate(`document.getElementById('world-object-rotation').value`), '345');
        assert.equal(await page.evaluate(`worldEditorTool==='objects' && !document.querySelector('.map-editor-wheel')`), true);
        await page.evaluate(`document.getElementById('world-object-rotation-number').focus()`);
        await key('KeyQ', 'q'); await key('KeyE', 'e');
        assert.equal(await page.evaluate(`document.getElementById('world-object-rotation').value`), '345');
        await page.evaluate('document.activeElement.blur()');
        for (const x of [39.25, 40.25]) {
            const point = await project(x, 1, 14.25);
            assert.equal(await page.evaluate(`document.elementFromPoint(${point.x},${point.y})===sceneModule.renderer.domElement`), true, 'placement click reaches world canvas');
            await click(point);
            await page.until(`sceneModule.chunksMap.get('1,0').tilesData[14][${Math.floor(x) - 32}].objects.some(o=>o.type==='factory'&&o.rotation===345)`, 'placement retains preview yaw');
            assert.ok(Math.abs(await page.evaluate(`${preview}.rotation.y`) - 345 * Math.PI / 180) < 1e-8);
        }
        await image('world-placement-rotation.png');
        await page.evaluate(`document.querySelector('[data-world-object="house"]').click()`);
        assert.equal(await page.evaluate(`document.getElementById('world-object-rotation').value`), '0');
        await click(placement, 0, 'right');
        assert.equal(await page.evaluate(`!sceneModule.scene.children.some(mesh=>mesh.userData.previewType) && !document.querySelector('[data-world-object][aria-pressed="true"]') && sceneModule.controls.enabled`), true);
        const count = await page.evaluate(`sceneModule.chunksMap.get('1,0').tilesData[14][7].objects.length`);
        await click(placement);
        assert.equal(await page.evaluate(`sceneModule.chunksMap.get('1,0').tilesData[14][7].objects.length`), count);
        await page.evaluate(`document.querySelector('[data-world-object="tree"]').click();mapEditor.setBrushRadius(0);const density=document.getElementById('world-vegetation-density');density.value='100';density.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('panel-tools').classList.add('collapsed')`);
        const treePoint = await project(42.25, 1, 14.25);
        assert.equal(await page.evaluate(`document.elementFromPoint(${treePoint.x},${treePoint.y})===sceneModule.renderer.domElement`), true);
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...treePoint });
        await key('KeyE', 'e');
        await click(treePoint);
        await page.until(`sceneModule.chunksMap.get('1,0').tilesData[14][10].objects.some(o=>o.type==='tree'&&o.rotation===345&&o.scale===1)`, 'single tree agrees with preview instead of brush randomization');
        await observer.until(`sceneModule.chunksMap.get('1,0').tilesData[14][10].objects.some(o=>o.type==='tree'&&o.rotation===345&&o.scale===1)`, 'tree orientation synchronized');
        await page.evaluate(`document.querySelector('[data-world-object="factory"]').click()`);
        await key('KeyQ', 'q');
        await page.evaluate(`document.querySelector('[data-world-tool="terrain"]').click()`);
        assert.equal(await page.evaluate(`!sceneModule.scene.children.some(mesh=>mesh.userData.previewType)`), true);
        await page.evaluate(`document.querySelector('[data-world-tool="objects"]').click()`);
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...placement });
        assert.equal(await page.evaluate(`!sceneModule.scene.children.some(mesh=>mesh.userData.previewType)`), true, 'tool change clears placement');
        const camera = await page.evaluate('sceneModule.camera.position.toArray()');
        await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...placement, button: 'right', buttons: 2 });
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: placement.x + 50, y: placement.y + 20, button: 'right', buttons: 2 });
        await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: placement.x + 50, y: placement.y + 20, button: 'right', buttons: 0 });
        assert.notDeepEqual(await page.evaluate('sceneModule.camera.position.toArray()'), camera, 'ordinary RMB camera control retained');
        await observer.until(`sceneModule.chunksMap.get('1,0').tilesData[14][8].objects.some(o=>o.type==='factory'&&o.rotation===345)`, 'placement yaw received by second client');
        await page.call('Page.reload');
        await page.until(`window.beginDirectWorldObjectEdit && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'reload persisted map');
        await page.evaluate(`(async()=>{window.sceneModule=await import('/static/js/lobby3d.js')})()`);
        assert.deepEqual(await read(page), scaled);
        assert.equal(await page.evaluate(`sceneModule.chunksMap.get('1,0').tilesData[14][8].objects.some(o=>o.type==='factory'&&o.rotation===345)`), true);
        assert.equal(await page.evaluate(`sceneModule.chunksMap.get('1,0').tilesData[14][10].objects.some(o=>o.type==='tree'&&o.rotation===345&&o.scale===1)`), true);
        await observer.call('Page.bringToFront');
        await observer.call('Page.reload');
        await observer.until(`window.beginDirectWorldObjectEdit && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'second client reconnect');
        await observer.evaluate(`(async()=>{window.sceneModule=await import('/static/js/lobby3d.js')})()`);
        assert.deepEqual(await read(observer), scaled);
        console.log('PASS: Q/E preview priority and exact yaw, repeated placement, typing guard, RMB cancellation, tool/asset changes, camera controls, reload and second-client reconnect');
        console.log('Regression screenshots:', profile);
    } finally {
        observer?.close();
        if (target) await protocol.call('Target.closeTarget', { targetId: target.targetId });
        protocol.close();
    }
};
