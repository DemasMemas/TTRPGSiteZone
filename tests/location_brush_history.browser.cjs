// Run through the existing isolated Flask/Chrome harness:
// VTT_LOC_BRUSH=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async ({ page, request, token, lobby, base, connect, debugPort }) => {
    const api = `/lobbies/${lobby.id}/locations`;
    const loc = await request(api, {
        name: 'Brush history', world_tile_x: 10, world_tile_z: 10,
        grid_width: 16, grid_height: 16,
        tiles_data: Array.from({ length: 16 }, () => Array.from({ length: 16 },
            (v,x) => ({ terrain: 'concrete', height: 1, objects: [] }))),
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
            if (predicate(data)) return data;
            await pause(100);
        }
        console.log('NUMERIC_SAVE_FAILURE', JSON.stringify({stored:await detail(),ui:await page.evaluate("({history:L.getLocationEditorHistoryState(),selection:L.getSelectedLocationEditorAsset(),text:document.body.innerText.slice(-1600)})")}));
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

    const idle = async () => page.until('!L.getLocationEditorHistoryState().busy', 'brush settled');
    const count = () => page.evaluate('L.getLocationEditorHistoryState().undo');
    const shortcut = async forward => {
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{
            type,code:forward?'KeyY':'KeyZ',key:forward?'y':'z',modifiers:2});
        await idle();
    };
    const configure = async (tool, radius, value) => {
        await page.evaluate(`selectLocationEditorTool('${tool}');L.setLocationBrushRadius(${radius});
            ${tool==='height'?`L.setLocationBrushHeight(${value});`:tool==='radiation'?`L.setLocationBrushRadiation(${value});`:''}
            document.activeElement.blur();UI.collapseMapToolsPanel()`);
    };
    const press = async (x,z,y=1) => {
        const p=await point(x,z,y);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});
    };
    const move = async (x,z,y=1) => page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(x,z,y),button:'left',buttons:1});
    const release = async (x,z,y=1) => {
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...await point(x,z,y),button:'left',buttons:0});
        await idle();
    };
    const stroke = async path => {
        await press(...path[0]);for(const p of path.slice(1))await move(...p);await release(...path.at(-1));
    };
    const values = tiles => tiles.flat().filter(t=>t.height===1.234567).length;
    await mount(page);
    await page.evaluate('locationControls.object.position.set(8,22,22);locationControls.target.set(8,1,8);locationControls.update()');
    const peerTarget=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===peerTarget.targetId).webSocketDebuggerUrl);
    try {
        await peer.call('Runtime.enable');await peer.until('Boolean(window.enterLocation&&window.isGM)','peer startup');
        await mount(peer);await page.call('Page.bringToFront');
        const initial=await detail();
        await page.evaluate(`window.brushEvents=[];for(const type of ['pointerdown','pointermove','pointerup','lostpointercapture','blur'])
            window.addEventListener(type,e=>window.brushEvents.push({type,buttons:e.buttons,target:e.target.tagName,hover:L.getHoveredTileCoords()}))`);
        const farMesh=await page.evaluate(`localRender.scene.children.find(m=>m.userData.locationObjectId===${object.id}).uuid`);
        await configure('height',1,1.234567);
        await press(4.5,6.5);await move(6.5,6.5);await move(4.5,6.5,1.234567);
        assert.equal(await count(),0);
        assert.equal(values((await detail()).tiles_data),0,'no partial server saves while holding mouse');
        await release(4.5,6.5,1.234567);
        assert.equal(await page.evaluate(`performance.getEntriesByType('resource').filter(e=>e.name.endsWith('/object-edits')).length`),1,'one server request for the complete stroke');
        const first=await detail();
        assert.ok(values(first.tiles_data)>=15,JSON.stringify({painted:values(first.tiles_data),events:await page.evaluate('window.brushEvents')}));
        assert.equal(await count(),1);
        await shortcut();assert.deepEqual((await detail()).tiles_data,initial.tiles_data);
        await shortcut(true);assert.deepEqual((await detail()).tiles_data,first.tiles_data);
        await stroke([[4.5,6.5,1.234567]]);
        assert.equal(await count(),1,'empty stroke does not enter history');
        assert.equal(await page.evaluate(`localRender.scene.children.find(m=>m.userData.locationObjectId===${object.id}).uuid`),farMesh,'unrelated object mesh preserved');
        await peer.call('Page.bringToFront');
        await peer.until(`L.getLocationEditorHistoryState().undo===0`,'peer history stays local');
        await peer.until(`(()=>{const r=new T.Raycaster(new T.Vector3(4.5,10,6.5),new T.Vector3(0,-1,0));
            return r.intersectObjects(localRender.scene.children,true).some(h=>Math.abs(h.point.y-1.234567)<.03)})()`,'peer terrain geometry updated');
        await page.call('Page.bringToFront');
        console.log('LOC brush: one continuous stroke, exact height, repeated cells, no-op, undo/redo, stable unrelated mesh');

        await configure('radiation',5,2.5);
        await stroke([[.5,.5],[7.5,3.5],[14.5,.5],[.5,.5]]);
        const edge=await detail();
        assert.ok(edge.tiles_data.flat().filter(t=>t.radiation===2.5).length>=120);
        assert.equal(await count(),2);
        await shortcut();assert.deepEqual((await detail()).tiles_data,first.tiles_data);
        await shortcut(true);assert.deepEqual((await detail()).tiles_data,edge.tiles_data);
        await configure('terrain',0);
        await page.evaluate("L.setLocationBrushTerrain('grass');L.setLocationGrassSubtype('forest')");
        await stroke([[4.5,6.5,1.234567],[5.5,6.5,1.234567]]);
        const grass=await detail();
        assert.equal(grass.tiles_data[6][4].grass_subtype,'forest');
        await shortcut();assert.deepEqual((await detail()).tiles_data,edge.tiles_data);
        await shortcut(true);assert.deepEqual((await detail()).tiles_data,grass.tiles_data);
        if(process.env.VTT_LOC_BRUSH_SHOTS==='1') {
            const shot=await page.call('Page.captureScreenshot',{format:'jpeg',quality:65});
            console.log('SCREEN '+JSON.stringify({label:'Terrain after undo and redo',data:shot.data}));
        }
        console.log('LOC brush: large brush at boundary, radiation, forest terrain and exact missing-key restoration');

        // A water conversion changes terrain, water metadata and sometimes height.
        await page.evaluate("L.setLocationBrushTerrain('water')");
        await stroke([[4.5,6.5,1.234567]]);
        const water=await detail();
        assert.equal(water.tiles_data[6][4].terrain,'water');
        assert.equal(water.tiles_data[6][4].water_level_offset,0);
        await shortcut();assert.deepEqual((await detail()).tiles_data,grass.tiles_data);
        await shortcut(true);assert.deepEqual((await detail()).tiles_data,water.tiles_data);
        await page.evaluate("document.querySelector('#loc-water-profile').value='clean';document.querySelector('#loc-water-basin').checked=true");
        await stroke([[4.5,6.5,water.tiles_data[6][4].height]]);
        assert.equal((await detail()).tiles_data[6][4].water_profile,'clean');
        await shortcut();assert.deepEqual((await detail()).tiles_data,water.tiles_data);

        await selectBox();
        assert.equal(await page.evaluate('L.updateSelectedLocationAssetDetails({...L.getSelectedLocationEditorAsset(),rotation:12.345})'),true);
        const edited=await stored();
        await configure('radiation',0,.375);
        await stroke([[10.5,8.5]]);
        const mixed=await detail();
        await shortcut();assert.notEqual((await detail()).tiles_data[8][10].radiation,.375);
        assert.equal((await stored()).properties.rotation,edited.properties.rotation);
        await shortcut();assert.equal((await stored()).properties.rotation,0);
        await shortcut(true);await shortcut(true);
        assert.deepEqual((await detail()).tiles_data,mixed.tiles_data);
        assert.equal((await stored()).properties.rotation,edited.properties.rotation);
        console.log('LOC brush: water profiles, mixed object/brush undo order and fractional state');

        // Erase both cell decor and a persistent object in one pointer transaction.
        await page.evaluate(`selectLocationEditorTool('assets');L.setLocationAssetPreset('rock');UI.collapseMapToolsPanel()`);
        await click(await point(8.5,8.5));await idle();
        const beforeErase=await detail(), eraseCount=await count();
        await configure('erase',0);
        await page.evaluate("document.querySelector('#loc-erase-structures').checked=true");
        await stroke([[8.5,8.5,1.2]]);
        assert.equal(await count(),eraseCount+1);
        assert.equal((await detail()).objects.length,0);
        assert.deepEqual((await detail()).tiles_data[8][8].objects,[]);
        await shortcut();
        assert.deepEqual((await detail()).tiles_data,beforeErase.tiles_data);
        assert.deepEqual((await stored()).properties,beforeErase.objects[0].properties);
        await shortcut(true);assert.equal((await detail()).objects.length,0);
        await shortcut();
        console.log('LOC brush: eraser restores decor and structure atomically');

        // Darkness is a stroke; unsaved sliders stay outside the stack until Save.
        await configure('light',1);
        await page.evaluate("document.querySelector('[data-darkness-brush=paint]').click();UI.collapseMapToolsPanel()");
        const darkCount=await count();
        await stroke([[10.5,4.5],[11.5,4.5]]);
        const dark=await detail();
        assert.ok(dark.lighting.dark_tiles.length>=9);assert.equal(await count(),darkCount+1);
        await shortcut();assert.deepEqual((await detail()).lighting.dark_tiles,[]);
        await shortcut(true);assert.deepEqual((await detail()).lighting.dark_tiles,dark.lighting.dark_tiles);
        await page.evaluate('UI.expandMapToolsPanel()');
        const envCount=await count();
        await set('[data-lighting=ambient_intensity]',.375);
        assert.equal(await count(),envCount);
        assert.equal((await detail()).lighting.ambient_intensity,.55);
        await page.evaluate("document.querySelector('[data-save-environment]').click()");await idle();
        assert.equal((await detail()).lighting.ambient_intensity,.375);assert.equal(await count(),envCount+1);
        await shortcut();assert.equal((await detail()).lighting.ambient_intensity,.55);
        await shortcut(true);assert.equal((await detail()).lighting.ambient_intensity,.375);
        await peer.call('Page.bringToFront');
        await peer.until('localRender.scene.children.some(m=>m.isAmbientLight&&m.intensity===.375)','peer lighting replay');
        await page.call('Page.bringToFront');

        // A foreign intersecting stroke during the preview rejects the entire edit.
        await configure('radiation',1,4.5);
        const conflictBase=await detail(), conflictCount=await count();
        await press(12.5,10.5);
        const before=conflictBase.tiles_data[10][12], after={...before,radiation:1.5};
        await peer.evaluate(`(async()=>{const {Server}=await import('/static/js/api.js');await Server.editLocationObjects(${lobby.id},${loc.id},{cells:[{x:12,z:10,before:${JSON.stringify(before)},after:${JSON.stringify(after)}}]})})()`);
        await release(12.5,10.5);
        const conflicted=await detail();
        assert.equal(await count(),conflictCount);
        assert.deepEqual(conflicted.tiles_data[10][12],after);
        assert.deepEqual(conflicted.tiles_data[9][11],conflictBase.tiles_data[9][11]);
        assert.equal(await page.evaluate("document.body.innerText.includes('Отмена или повтор не применены')"),true);
        console.log('LOC brush: darkness, lighting preview/save, peer sync and whole-stroke conflict rejection');

        // Pointer cancellation restores the preview without truncating redo/history.
        await page.evaluate("document.querySelector('#location-canvas canvas').addEventListener('pointerdown',e=>window.testBrushPointer=e.pointerId,{once:true})");
        const cancelBase=await detail(), cancelCount=await count();
        await press(14.5,12.5);await move(13.5,12.5);
        await page.evaluate("document.querySelector('#location-canvas canvas').dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.testBrushPointer,button:0}))");
        await idle();
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...await point(13.5,12.5),button:'left',buttons:0});
        assert.equal(await count(),cancelCount);
        assert.deepEqual((await detail()).tiles_data,cancelBase.tiles_data);

        await configure('radiation',0,.875);
        await stroke([[12.5,10.5]]);
        const savedBeforeForeign=await detail(), protectedCount=await count();
        const own=savedBeforeForeign.tiles_data[10][12], newer={...own,radiation:.5};
        await peer.evaluate(`(async()=>{const {Server}=await import('/static/js/api.js');await Server.editLocationObjects(${lobby.id},${loc.id},{cells:[{x:12,z:10,before:${JSON.stringify(own)},after:${JSON.stringify(newer)}}]})})()`);
        await shortcut();
        assert.equal(await count(),protectedCount);
        assert.deepEqual((await detail()).tiles_data[10][12],newer);
        const final=await detail();

        await page.call('Page.navigate',{url:'about:blank'});await page.until("location.href==='about:blank'",'blank');
        await page.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});
        await page.until('Boolean(window.enterLocation&&window.isGM)','reload');await mount(page);
        assert.equal(await count(),0);
        assert.deepEqual((await detail()).tiles_data,final.tiles_data);
        assert.equal((await detail()).lighting.ambient_intensity,.375);
        console.log('PASS LOC-04: continuous brushes, sparse exact cells, large/edge strokes, eraser objects, water, shared history, lighting, two clients, conflicts, reload');
    } finally { peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId}); }
};

