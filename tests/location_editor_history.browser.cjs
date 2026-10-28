// Run through the existing isolated Flask/Chrome harness:
// VTT_LOC_HISTORY=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
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

    const idle = async () => page.until('!L.getLocationEditorHistoryState().busy', 'history settled');
    const history = () => page.evaluate('L.getLocationEditorHistoryState()');
    const shortcut = async (forward = false, shift = false) => {
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        const code = forward && !shift ? 'KeyY' : 'KeyZ';
        for (const type of ['keyDown', 'keyUp']) await page.call('Input.dispatchKeyEvent', {
            type, code, key: code === 'KeyY' ? 'y' : 'z', modifiers: shift ? 10 : 2,
        });
        await idle();
    };
    const edit = async details => {
        assert.equal(await page.evaluate(`L.updateSelectedLocationAssetDetails({...L.getSelectedLocationEditorAsset(),...${JSON.stringify(details)}})`), true);
        await idle();
    };
    const exact = async () => {
        assert.ok(Math.abs((await stored()).properties.rotation + 12.345 * Math.PI / 180) < 1e-12);
        assert.equal((await stored()).properties.dimensions.width, .375);
    };
    await mount(page);
    const peerTarget = await page.call('Target.createTarget', { url: `${base}/lobbies/${lobby.id}/page`, background: true });
    const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer = await connect(tabs.find(t => t.id === peerTarget.targetId).webSocketDebuggerUrl);
    try {
        await peer.call('Runtime.enable');
        await peer.until('Boolean(window.enterLocation&&window.isGM)', 'peer startup');
        await mount(peer);
        await page.call('Page.bringToFront');
        await selectBox();
        assert.equal((await history()).undo, 0);
        assert.equal(await page.evaluate("document.querySelector('[data-location-undo]').disabled"), true);
        await edit({ rotation: 12.345 });
        await edit({ dimensions: { width: .375, depth: 1, height: 1 } });
        await exact();
        assert.equal((await history()).undo, 2);
        await shortcut();
        assert.equal((await stored()).properties.dimensions.width, 1);
        await shortcut();
        assert.equal((await stored()).properties.rotation, 0);
        await shortcut(true);
        await shortcut(true, true);
        await exact();
        assert.equal((await history()).redo, 0);
        console.log('LOC history: sequential undo/redo, Ctrl+Shift+Z, 12.345 degrees and .375 width');

        // Text controls keep native undo and never touch the scene history.
        await selectBox();
        const count = (await history()).undo;
        await page.evaluate("document.querySelector('[data-asset-field=x]').focus()");
        for (const type of ['keyDown', 'keyUp']) await page.call('Input.dispatchKeyEvent', {type, code:'KeyZ',key:'z',modifiers:2});
        assert.equal((await history()).undo, count);
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        for (const code of ['KeyG','KeyT','KeyR']) {
            await key(page, code);
            await page.call('Input.dispatchMouseEvent', { type:'mouseMoved', ...await point(9.2,9.4) });
            await key(page,'Escape','Escape');
            assert.equal((await history()).undo, count);
        }
        await key(page,'KeyG');
        for (const [x,z] of [[8.7,8.9],[9.1,9.3],[9.25,9.75]]) await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(x,z)});
        await click(await point(9.25,9.75));
        await idle();
        assert.equal((await history()).undo, count + 1);
        assert.equal((await stored()).tile_x, 9);
        await shortcut();
        assert.equal((await stored()).tile_x, 8);
        await shortcut(true);
        assert.equal((await stored()).tile_x, 9);
        await exact();
        // selectBox locates the mesh by ID even after moving it.
        await selectBox();
        const rotationCount = (await history()).undo;
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        await key(page,'KeyT');
        for(const [x,z]of [[10,9.5],[10.2,9.6],[10.25,9.75]]) await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(x,z)});
        await click(await point(10.25,9.75));
        await idle();
        assert.equal((await history()).undo, rotationCount + 1);
        await shortcut();
        await exact();
        assert.equal((await history()).redo, 1);
        await selectBox();
        await edit({ color:'#776655' });
        assert.equal((await history()).redo, 0);
        console.log('LOC history: native input undo, Esc, continuous G/T, redo branch reset');

        await selectBox();
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        const resizeCount = (await history()).undo;
        await key(page,'KeyR');
        const handle = await page.evaluate(`(()=>{let h;localRender.scene.traverse(m=>{if(m.userData.editorResizeHandleAxis==='width'&&m.userData.editorResizeHandleSign===1)h=m});
            const v=h.getWorldPosition(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();
            return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...handle,button:'left',buttons:1,clickCount:1});
        for(const delta of [10,20,30])await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:handle.x+delta,y:handle.y,button:'left',buttons:1});
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:handle.x+30,y:handle.y,button:'left',buttons:0});
        await idle();
        await key(page,'Escape','Escape');
        assert.equal((await history()).undo,resizeCount+1);
        const resized = (await stored()).properties.dimensions.width;
        assert.notEqual(resized,.375);
        await shortcut(); await exact();
        await shortcut(true);
        assert.equal((await stored()).properties.dimensions.width,resized);
        await shortcut();

        await selectBox();
        await page.evaluate('L.deleteSelectedLocationAsset()'); await idle();
        assert.equal(await stored(), undefined);
        await shortcut(); await exact();
        await peer.call('Page.bringToFront');
        await peer.until(`localRender.scene.children.some(m=>m.userData.locationObjectId===${object.id}&&m.userData.locationObject.properties.dimensions.width===.375)`, 'peer restored exact object');
        await page.call('Page.bringToFront');
        await shortcut(true);
        assert.equal(await stored(),undefined);
        await shortcut(); await exact();
        console.log('LOC history: R is one action, delete/restore exact object, second client restoration');

        // A different GM tab changes this object; undo must fail atomically.
        await peer.evaluate(`(async()=>{const {Server}=await import('/static/js/api.js');await Server.updateLocationObject(${lobby.id},${object.id},{properties:{color:'#334455'}})})()`);
        await page.until(`localRender.scene.children.find(m=>m.userData.locationObjectId===${object.id})?.userData.locationObject.properties.color==='#334455'`, 'foreign update received');
        const beforeConflict = await stored(), historyBeforeConflict = await history();
        await shortcut();
        assert.deepEqual(await stored(),beforeConflict);
        assert.equal((await history()).undo,historyBeforeConflict.undo);
        assert.equal(await page.evaluate("document.body.innerText.includes('Отмена или повтор не применены')"),true);

        await page.call('Page.navigate',{url:'about:blank'});
        await page.until("location.href==='about:blank'",'blank before reload');
        await page.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});
        await page.until('Boolean(window.enterLocation&&window.isGM)','reload startup');
        await mount(page);
        assert.deepEqual(await history(),{undo:0,redo:0,busy:false});
        await exact();
        assert.equal((await stored()).properties.color,'#334455');
        // Placement goes through the normal asset tool and actual scene clicks.
        const place = async (asset,x,z) => {
            await page.evaluate(`selectLocationEditorTool('assets');L.setLocationAssetPreset('${asset}');UI.collapseMapToolsPanel();document.activeElement.blur()`);
            await click(await point(x,z)); await idle();
        };
        await place('box',5.5,8.5);
        let data = await detail();
        assert.equal(data.objects.length,2);
        const second = data.objects.find(o=>o.id!==object.id);
        assert.equal((await history()).undo,1);
        await shortcut(); assert.equal((await detail()).objects.length,1);
        await shortcut(true); assert.equal((await detail()).objects.length,2);
        const selectPair=async()=>{
            await selectBox();
            await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
            const secondPoint = await page.evaluate(`(()=>{
            const root=localRender.scene.children.find(m=>m.userData.locationObjectId===${second.id});
            const v=new T.Box3().setFromObject(root).getCenter(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();
            return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
            for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,...secondPoint,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,modifiers:8});
            await page.until('L.getSelectedLocationEditorAsset()?.selectedCount===2','two selected objects');
        };
        await selectPair();
        const groupBefore=(await detail()).objects;
        const groupCount=(await history()).undo;
        await page.evaluate('L.scaleSelectedLocationAssets(true)');await idle();
        assert.equal((await history()).undo,groupCount+1);
        const groupAfter=(await detail()).objects;
        assert.ok(groupAfter.every((o,i)=>o.properties.dimensions.width>groupBefore[i].properties.dimensions.width));
        await shortcut();
        assert.deepEqual((await detail()).objects.map(o=>o.properties),groupBefore.map(o=>o.properties));
        await shortcut(true);
        assert.deepEqual((await detail()).objects.map(o=>o.properties),groupAfter.map(o=>o.properties));
        await selectPair();
        const moveCount=(await history()).undo;
        await key(page,'KeyG');
        await click(await point(7.75,10.25));await idle();
        assert.equal((await history()).undo,moveCount+1);
        const groupMoved=(await detail()).objects;
        const poses=objects=>objects.map(({revision,...rest})=>rest);
        assert.notDeepEqual(poses(groupMoved),poses(groupAfter));
        await shortcut();assert.deepEqual(poses((await detail()).objects),poses(groupAfter));
        await shortcut(true);assert.deepEqual(poses((await detail()).objects),poses(groupMoved));
        await selectPair();
        const deleteCount=(await history()).undo;
        await page.evaluate('L.deleteSelectedLocationAsset()');await idle();
        assert.equal((await history()).undo,deleteCount+1);
        assert.equal((await detail()).objects.length,0);
        await shortcut();assert.deepEqual(poses((await detail()).objects),poses(groupMoved));

        await place('rock',3.5,8.5);
        data=await detail();
        const decor=data.tiles_data[8][3].objects;
        assert.equal(decor.length,1);
        await shortcut();assert.deepEqual((await detail()).tiles_data[8][3].objects,[]);
        await shortcut(true);assert.deepEqual((await detail()).tiles_data[8][3].objects,decor);
        await page.evaluate(`selectLocationEditorTool('select');UI.collapseMapToolsPanel()`);
        await click(await point(3.5,8.5,1.3));
        await page.until("L.getSelectedLocationEditorAsset()?.kind==='decor'",'selected decor');
        await edit({rotation:12.345,dimensions:{width:.375,depth:.5,height:.5}});
        const exactDecor=(await detail()).tiles_data[8][3].objects;
        await page.evaluate('L.deleteSelectedLocationAsset()');await idle();
        await shortcut();assert.deepEqual((await detail()).tiles_data[8][3].objects,exactDecor);
        await shortcut(true);assert.deepEqual((await detail()).tiles_data[8][3].objects,[]);
        await shortcut();assert.deepEqual((await detail()).tiles_data[8][3].objects,exactDecor);

        await place('warm_lamp',12.5,5.5);
        data=await detail();
        assert.equal(data.lighting.local_lights.length,2);
        await shortcut();assert.equal((await detail()).lighting.local_lights.length,1);
        await shortcut(true);assert.deepEqual((await detail()).lighting.local_lights,data.lighting.local_lights);
        await peer.call('Page.bringToFront');
        await peer.until('L.getLocationStaticLightFieldDiagnostics().lampRoutes.length===2','peer lamp placement redo');
        await page.call('Page.bringToFront');
        // An edit elsewhere must preserve picking references of untouched decor.
        await page.evaluate("selectLocationEditorTool('select');UI.collapseMapToolsPanel()");
        await click(await point(3.5,8.5,1.25));
        await page.until("L.getSelectedLocationEditorAsset()?.kind==='decor'",'untouched decor still selectable');
        const noOpCount=(await history()).undo;
        await edit({});
        assert.equal((await history()).undo,noOpCount);
        await page.evaluate("selectLocationEditorTool('select');UI.collapseMapToolsPanel()");
        await click(await point(3.5,8.5,1.25));
        await page.until("L.getSelectedLocationEditorAsset()?.kind==='decor'",'decor selectable after no-op');
        console.log('LOC history: creation, group scale as one command, decor restore and lamp redo synced');
        console.log('PASS LOC-03: real scene keyboard history, precise values, G/T/R, delete/restore, peer conflict, reload');
    } finally {
        peer.close();
        await page.call('Target.closeTarget',{targetId:peerTarget.targetId});
    }
};

