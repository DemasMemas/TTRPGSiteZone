// Run through the existing isolated Flask/Chrome harness:
// VTT_LOC_NUMERIC=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async ({ page, request, token, lobby, base, connect, debugPort }) => {
    const api = `/lobbies/${lobby.id}/locations`;
    const loc = await request(api, {
        name: 'Exact location inputs', world_tile_x: 10, world_tile_z: 10,
        grid_width: 16, grid_height: 16,
        tiles_data: Array.from({ length: 16 }, () => Array.from({ length: 16 },
            () => ({ terrain: 'concrete', height: 1, objects: [] }))),
        lighting: { mode: 'manual', ambient_intensity: 0.55, local_lights: [{
            x: 11.5, z: 8.5, height: 2, intensity: 2, distance: 6,
            color: '#ffffff', kind: 'spot', azimuth: 0,
            dimensions: { width: 0.4, depth: 0.4, height: 0.35 },
        }] },
    }, token);
    const object = await request(`${api}/${loc.id}/objects`, {
        name: 'Exact box', type: 'box', tile_x: 8, tile_y: 8,
        properties: { dimensions: { width: 1, depth: 1, height: 1 }, elevation: 0, rotation: 0 },
    }, token);
    const detail = () => request(`${api}/${loc.id}`, null, token, 'GET');
    const stored = async () => (await detail()).objects.find(o => o.id === object.id);
    const waitSaved = async predicate => {
        for (let i = 0; i < 100; i++) {
            const data = await detail();
            if (predicate(data)) {
                // The DB may commit before the scene receives its response.
                // Start the next gesture only after the editor acknowledges it.
                await page.until('!L.getLocationEditorHistoryState().busy', 'saved edit acknowledged');
                return data;
            }
            await pause(100);
        }
        throw new Error('Timed out waiting for saved location');
    };
    const key = async (client, code, key = code.replace('Key', '')) => {
        await client.call('Input.dispatchKeyEvent', { type: 'keyDown', code, key });
        await client.call('Input.dispatchKeyEvent', { type: 'keyUp', code, key });
    };
    const set = async (selector, value, commit = 'enter') => {
        await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
            e.focus();e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        if (commit === 'enter') await key(page, 'Enter', 'Enter');
        else if (commit === 'blur') await page.evaluate('document.activeElement.blur()');
    };
    const mount = async client => {
        await client.call('Page.bringToFront');
        await client.evaluate(`(async()=>{
            window.T=await import('three');window.W=await import('/static/js/lobby3d.js');
            window.L=await import('/static/js/locationScene.js');window.UI=await import('/static/js/ui_interactions.js');
            window.N=await import('/static/js/worldNumericInputs.js');
            if(!window.numericRenderHook){window.numericRenderHook=true;const add=T.Scene.prototype.add;
                T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;
                    const old=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){old.call(this,r,s,c,...args);
                        if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return add.apply(this,roots)}}
            void enterLocation(${loc.id});
        })()`);
        await client.until(`window.localRender&&window.selectLocationEditorTool
            &&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'loaded local game');
        await client.evaluate(`L.setLocationEditMode(true);locationControls.target.set(8.5,1,8.5);
            locationControls.object.position.set(8.5,12,16);locationControls.update();UI.collapseMapToolsPanel()`);
        await pause(400);
    };
    const point = async (x, z, y = 1) => page.evaluate(`(()=>{
        const c=locationControls.object;c.updateMatrixWorld(true);const v=new T.Vector3(${x},${y},${z}).project(c);
        const r=document.querySelector('#location-canvas canvas').getBoundingClientRect();
        return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
    const click = async p => {
        for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
            await page.call('Input.dispatchMouseEvent', { type, ...p,
                button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
        }
    };
    const selectBox = async () => {
        await page.evaluate(`selectLocationEditorTool('select');UI.collapseMapToolsPanel()`);
        const p = await page.evaluate(`(()=>{
            const root=localRender.scene.children.find(m=>m.userData.locationObjectId===${object.id});
            const v=new T.Box3().setFromObject(root).getCenter(new T.Vector3()).project(localRender.camera);
            const r=localRender.renderer.domElement.getBoundingClientRect();
            return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        await click(p);
        await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='box'`, 'selected test box');
        await page.evaluate(`UI.expandMapToolsPanel();document.querySelector('.location-asset-precise').open=true`);
    };

    await mount(page);
    const peerTarget = await page.call('Target.createTarget', { url: `${base}/lobbies/${lobby.id}/page`, background: true });
    const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer = await connect(tabs.find(t => t.id === peerTarget.targetId).webSocketDebuggerUrl);
    try {
        await peer.call('Runtime.enable');
        await peer.until('Boolean(window.enterLocation&&window.isGM)', 'peer game startup');
        await mount(peer);
        await page.call('Page.bringToFront');
        console.log('LOC numeric: both game clients loaded');

        await selectBox();
        await page.evaluate(`for(const [name,value]of Object.entries({x:8.375,z:8.625,rotation:12.345}))
            document.querySelector('[data-asset-field='+name+']').value=value;
            document.querySelector('[data-asset-save]').click()`);
        await waitSaved(d => Math.abs(d.objects[0].properties.rotation + 12.345 * Math.PI / 180) < 1e-12);
        await page.until(`document.querySelector('[data-asset-field=rotation]').value==='12.345'`, 'exact inspector angle');
        await set('[data-selected-dimension=width]', 0.375);
        await waitSaved(d => d.objects[0].properties.dimensions.width === 0.375);
        await page.evaluate(`document.querySelector('[data-asset-save]').click()`);
        await pause(300);
        assert.ok(Math.abs((await stored()).properties.rotation + 12.345 * Math.PI / 180) < 1e-12);
        await peer.call('Page.bringToFront');
        try { await peer.until(`Math.abs(localRender.scene.children.find(m=>m.userData.locationObjectId===${object.id})
            .userData.locationObject.properties.rotation+12.345*Math.PI/180)<1e-12
            &&localRender.scene.children.find(m=>m.userData.locationObjectId===${object.id})
                .userData.locationObject.properties.dimensions.width===0.375`, 'peer precise angle and dimensions');
        } catch (error) {
            console.log('PEER_FAILURE', JSON.stringify({ stored: await stored(),
                peer: await peer.evaluate(`localRender.scene.children.filter(m=>m.userData.locationObjectId===${object.id}).map(m=>m.userData.locationObject)`),
                main: await page.evaluate('L.getSelectedLocationEditorAsset()') }));
            throw error;
        }
        assert.equal(await peer.evaluate(`localRender.scene.children.find(m=>m.userData.locationObjectId===${object.id})
            .userData.locationObject.properties.dimensions.width`), 0.375);
        await page.call('Page.bringToFront');

        const revision = (await stored()).revision;
        await set('[data-asset-field=x]', '', 'blur');
        await page.evaluate(`document.querySelector('[data-asset-save]').click()`);
        await pause(250);
        assert.equal((await stored()).revision, revision);
        assert.equal(await page.evaluate(`document.querySelector('[data-asset-field=x]').getAttribute('aria-invalid')`), 'true');
        await page.evaluate(`document.querySelector('[data-asset-field=x]').focus()`);
        await peer.evaluate(`(async()=>{const {Server}=await import('/static/js/api.js');
            await Server.updateLocationObject(${lobby.id},${object.id},{properties:{color:'#aa8866'}})})()`);
        await pause(250);
        assert.equal(await page.evaluate(`document.querySelector('[data-asset-field=x]').value`), '');
        await set('[data-asset-field=x]', 8.425, 'enter');
        await waitSaved(d => Math.abs(d.objects[0].properties.offset_x + 0.075) < 1e-12);
        await set('[data-asset-field=z]', 8.675, 'blur');
        await waitSaved(d => Math.abs(d.objects[0].properties.offset_z - 0.175) < 1e-12);
        assert.ok(Math.abs((await stored()).properties.rotation + 12.345 * Math.PI / 180) < 1e-12);
        console.log('LOC numeric: 12.345°, repeated save, size edit, Enter/blur, empty coordinate, peer sync');

        await page.evaluate(`selectLocationEditorTool('height');UI.expandMapToolsPanel()`);
        await set('#loc-edit-radius-number', 2);
        assert.equal(await page.evaluate(`document.querySelector('#loc-darkness-radius-number').value`), '2');
        await set('#loc-edit-radius-number', '', 'blur');
        assert.equal(await page.evaluate(`document.querySelector('#loc-edit-radius-number').value`), '2');
        await set('#loc-edit-radius-number', 99, 'blur');
        assert.equal(await page.evaluate(`document.querySelector('#loc-edit-radius-number').value`), '5');
        await set('#loc-edit-radius-number', 0);
        await set('#loc-edit-height-number', 1.234567);
        assert.equal(await page.evaluate(`N.getWorldNumericValue('loc-edit-height')`), 1.234567);
        assert.equal(await page.evaluate(`document.querySelector('#loc-edit-height').step`), '0.1');
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        await click(await point(4.5, 6.5));
        await waitSaved(d => d.tiles_data[6][4].height === 1.234567);
        await page.evaluate(`selectLocationEditorTool('radiation');UI.expandMapToolsPanel()`);
        await set('#loc-edit-radiation-number', 0.375);
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        await click(await point(4.5, 6.5, 1.234567));
        await waitSaved(d => d.tiles_data[6][4].radiation === 0.375);
        await page.evaluate(`UI.expandMapToolsPanel();const r=document.querySelector('#loc-edit-radiation');
            r.value='2.3';r.dispatchEvent(new Event('input',{bubbles:true}))`);
        assert.equal(await page.evaluate(`document.querySelector('#loc-edit-radiation').step`), '0.5');
        assert.equal(await page.evaluate(`document.querySelector('#loc-edit-radiation-number').value`), '2.5');

        await page.evaluate(`selectLocationEditorTool('light');UI.expandMapToolsPanel()`);
        await set('[data-lighting=ambient_intensity]', '', 'blur');
        await page.evaluate(`document.querySelector('[data-save-environment]').click()`);
        await pause(200);
        assert.equal((await detail()).lighting.ambient_intensity, 0.55);
        await set('[data-lighting=ambient_intensity]', 4);
        await page.evaluate(`document.querySelector('[data-save-environment]').click()`);
        assert.equal((await detail()).lighting.ambient_intensity, 0.55);
        await page.evaluate(`const e=document.querySelector('[data-lighting=ambient_intensity]');e.focus();e.select()`);
        await page.call('Input.insertText', { text: '0,375' });
        await key(page, 'Enter', 'Enter');
        await set('[data-lighting=directional_azimuth]', 12.345);
        await set('[data-lighting=directional_elevation]', 45.678);
        await set('#loc-darkness-radius-number', 1);
        assert.equal(await page.evaluate(`document.querySelector('#loc-edit-radius-number').value`), '1');
        await page.evaluate(`document.querySelector('[data-darkness-brush=paint]').click();UI.collapseMapToolsPanel()`);
        await click(await point(4.5, 6.5, 1.234567));
        await page.evaluate(`document.querySelector('[data-save-environment]').click()`);
        await waitSaved(d => d.lighting.ambient_intensity === 0.375 && d.lighting.dark_tiles.length === 9);
        assert.equal((await detail()).lighting.directional_azimuth, 12.345);
        assert.equal((await detail()).lighting.directional_elevation, 45.678);
        await peer.call('Page.bringToFront');
        await peer.until(`localRender.scene.children.some(light=>light.isAmbientLight&&light.intensity===0.375)`, 'peer applied light');
        await page.call('Page.bringToFront');
        console.log('LOC numeric: brush painting, exact terrain/radiation, synchronized darkness, invalid/decimal light');

        await page.evaluate(`selectLocationEditorTool('select');UI.collapseMapToolsPanel()`);
        await click(await point(11.5, 8.5, 3));
        await page.until(`L.getSelectedLocationEditorAsset()?.kind==='lamp'`, 'selected lamp');
        await page.evaluate(`UI.expandMapToolsPanel();document.querySelector('.location-asset-precise').open=true`);
        assert.equal(await page.evaluate(`document.querySelector('[data-selected-dimension=width]').min`), '0.05');
        await set('[data-selected-dimension=width]', 0.005);
        await set('[data-asset-field=intensity]', '', 'blur');
        await page.evaluate(`document.querySelector('[data-asset-save]').click()`);
        await pause(200);
        assert.equal((await detail()).lighting.local_lights[0].intensity, 2);
        assert.equal((await detail()).lighting.local_lights[0].dimensions.width, 0.4);
        await set('[data-selected-dimension=width]', 0.125);
        await set('[data-asset-field=intensity]', 0.8754);
        await waitSaved(d => d.lighting.local_lights[0].intensity === 0.875);
        await set('[data-selected-dimension=depth]', 0.025);
        await waitSaved(d => d.lighting.local_lights[0].dimensions.depth === 0.025);
        await peer.call('Page.bringToFront');
        await peer.until(`L.getLocationStaticLightFieldDiagnostics().lampRoutes[0]?.intensity===0.875`, 'peer lamp intensity');
        await page.call('Page.bringToFront');
        console.log('LOC numeric: lamp validation, precision and dimensions');

        // A blank navigation ensures the previous JS context cannot satisfy reload waits.
        await page.call('Page.navigate', { url: 'about:blank' });
        await page.until(`location.href==='about:blank'`, 'blank context');
        await page.call('Page.navigate', { url: `${base}/lobbies/${lobby.id}/page` });
        await page.until('Boolean(window.enterLocation&&window.isGM)', 'reloaded game');
        await mount(page);
        await selectBox();
        assert.equal(await page.evaluate(`document.querySelector('[data-asset-field=rotation]').value`), '12.345');
        assert.equal(await page.evaluate(`L.getSelectedLocationEditorAsset().dimensions.width`), 0.375);
        assert.equal(await page.evaluate(`document.querySelector('[data-lighting=ambient_intensity]').value`), '0.375');

        await page.evaluate(`document.querySelector('.location-asset-precise').open=false;UI.collapseMapToolsPanel();document.activeElement.blur()`);
        for (const code of ['KeyG', 'KeyT', 'KeyR']) {
            await key(page, code);
            assert.equal(await page.evaluate('window.isLocationEditorTransformActive()'), true);
            assert.equal(await page.evaluate(`document.querySelector('.location-asset-precise').open`), false);
            assert.notEqual(await page.evaluate('document.activeElement.tagName'), 'INPUT');
            await key(page, 'Escape', 'Escape');
        }
        await key(page, 'KeyG');
        await click(await point(9.25, 9.75));
        await waitSaved(d => d.objects[0].tile_x === 9 && d.objects[0].tile_y === 9);
        assert.ok(Math.abs((await stored()).properties.rotation + 12.345 * Math.PI / 180) < 1e-12);
        await key(page, 'KeyT');
        await click(await point(10.25, 9.75));
        await page.until('!window.isLocationEditorTransformActive()', 'mouse rotation saved');
        await key(page, 'KeyR');
        const handle = await page.evaluate(`(()=>{let handle;localRender.scene.traverse(m=>{
            if(m.userData.editorResizeHandleAxis==='width'&&m.userData.editorResizeHandleSign===1)handle=m});
            const v=handle.getWorldPosition(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();
            return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...handle });
        await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...handle, button: 'left', buttons: 1, clickCount: 1 });
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 30, y: handle.y, button: 'left', buttons: 1 });
        await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 30, y: handle.y, button: 'left', buttons: 0 });
        await waitSaved(d => d.objects[0].properties.dimensions.width !== 0.375);
        await key(page, 'Escape', 'Escape');
        await page.evaluate(`selectLocationEditorTool('assets');UI.expandMapToolsPanel()`);
        const lamps = await page.evaluate(`(async()=>{const {LOCATION_ASSETS}=await import('/static/js/locationAssetCatalog.js');
            return LOCATION_ASSETS.filter(a=>a.kind==='lamp').slice(0,2).map(a=>a.label)})()`);
        assert.equal(lamps.length, 2);
        for (const label of lamps) {
            await page.evaluate(`(()=>{const e=document.querySelector('.location-asset-search');e.value=${JSON.stringify(label)};
                e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.location-asset-card').click()})()`);
            await set('[data-placement-height]', 4.321);
        }
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        await click(await point(12.5, 4.5));
        await waitSaved(d => d.lighting.local_lights.length === 2 && d.lighting.local_lights[1].height === 4.321);
        console.log('PASS LOC-01: exact angle roundtrip, empty/invalid drafts, four numeric sliders, lights/lamps, reload, peer scene, G/T/R mouse transforms');
    } finally {
        peer.close();
        await page.call('Target.closeTarget', { targetId: peerTarget.targetId });
    }
};
