// Run through the existing isolated Flask/Chrome harness:
// VTT_LOC_CLIPBOARD=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async ({ page, request, token, lobby, base, connect, debugPort }) => {
    const api = `/lobbies/${lobby.id}/locations`;
    const loc = await request(api, {
        name: 'Location clipboard', world_tile_x: 10, world_tile_z: 10,
        grid_width: 16, grid_height: 16,
        tiles_data: Array.from({ length: 16 }, () => Array.from({ length: 16 },
            (_,x) => ({ terrain: 'concrete', height: 1, objects: [] }))),
        lighting: { mode: 'manual', ambient_intensity: 0.55, local_lights: [{
            x: 11.5, z: 8.5, height: 2, intensity: 2, distance: 6,
            color: '#ffffff', kind: 'spot', azimuth: 12.345,
            dimensions: { width: 0.4, depth: 0.4, height: 0.35 },
        }] },
    }, token);
    const object = await request(`${api}/${loc.id}/objects`, {
        name: 'Exact box', type: 'box', tile_x: 8, tile_y: 8,
        properties: { dimensions: { width: .375, depth: .625, height: .875 }, elevation: .125, rotation: -12.345*Math.PI/180, color:'#776655' },
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

    const idle=()=>page.until('!L.getLocationEditorHistoryState().busy','clipboard commit');
    const history=()=>page.evaluate('L.getLocationEditorHistoryState()');
    const ctrl=async code=>{
        await page.evaluate('document.activeElement.blur();UI.collapseMapToolsPanel()');
        for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key:code.slice(3).toLowerCase(),modifiers:2});
        await idle();
    };
    const at=async(x,z,y=1)=>{
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(x,z,y)});
        await page.until('L.getLocationClipboardState().preview&&L.getLocationClipboardState().valid','valid paste preview');
    };
    const selectId=async(id,shift=false)=>{
        await page.evaluate("UI.collapseMapToolsPanel();document.activeElement.blur()");
        const p=await page.evaluate(`(()=>{const root=localRender.scene.children.find(m=>m.userData.locationObjectId===${id});
            const v=new T.Box3().setFromObject(root).getCenter(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();
            return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        for(const type of ['mouseMoved','mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{
            type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:1,modifiers:shift?8:0});
    };
    const seed=async spec=>request(`${api}/${loc.id}/objects`,spec,token);
    const floor0=await seed({name:'Target ground',type:'floor',tile_x:4,tile_y:4,properties:{building_id:'target',level:0,roof_enabled:false,dimensions:{width:5,depth:5,height:.12}}});
    const floor1=await seed({name:'Target upper',type:'floor',tile_x:4,tile_y:4,properties:{building_id:'target',level:1,roof_enabled:false,dimensions:{width:5,depth:5,height:.12}}});
    const houseFloor=await seed({name:'Manual floor',type:'floor',tile_x:3,tile_y:12,properties:{building_id:'manual',level:0,roof_enabled:false,dimensions:{width:4,depth:4,height:.12}}});
    const wall=await seed({name:'Manual wall',type:'wall',tile_x:3,tile_y:12,properties:{building_id:'manual',level:0,dimensions:{width:3,depth:.2,height:2.4}}});
    const door=await seed({name:'Manual door',type:'door',tile_x:3,tile_y:12,properties:{building_id:'manual',level:0,dimensions:{width:.9,depth:.18,height:2},is_open:false}});
    const filled=await seed({name:'Filled box',type:'box',tile_x:14,tile_y:13,properties:{dimensions:{width:1,depth:1,height:1},contents:[{name:'test item'}]}});
    const data=await detail();
    const oldCell=data.tiles_data[8][6];
    const rock={type:'rock',x:0,z:0,level:0,elevation:.125,rotation:12.345,scale:.75,color:'#888888'};
    await request(`${api}/${loc.id}/object-edits`,{cells:[{x:6,z:8,before:oldCell,after:{...oldCell,objects:[rock]}}]},token);

    await mount(page);
    await page.evaluate('locationControls.object.position.set(8,20,22);locationControls.target.set(8,1,8);locationControls.update()');
    const peerTarget=await page.call('Target.createTarget',{url:'about:blank',background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===peerTarget.targetId).webSocketDebuggerUrl);
    try {
        await peer.call('Page.enable');await peer.call('Runtime.enable');
        await peer.evaluate('0'); // Install the shared dependency interception before navigation.
        await peer.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});
        await peer.until('Boolean(window.enterLocation&&window.isGM)','peer startup');await mount(peer);
        await page.call('Page.bringToFront');await selectBox();
        const initial=await detail();
        await ctrl('KeyC');
        assert.equal(await page.evaluate('L.getLocationClipboardState().count'),1);
        assert.equal((await history()).undo,0);
        await ctrl('KeyV');await at(10.5,10.5);
        assert.equal((await detail()).objects.length,initial.objects.length);
        assert.equal(await page.evaluate('localRender.scene.children.filter(m=>m.userData.editorPastePreview).length'),1);
        await key(page,'Escape','Escape');
        assert.equal(await page.evaluate('L.getLocationClipboardState().preview'),false);
        assert.equal((await history()).undo,0);

        // Text controls keep native clipboard handling.
        await page.evaluate("const e=document.createElement('textarea');e.id='clipboard-native-input';e.value='native text';document.body.append(e);e.focus();e.select();window.clipboardNativeEvents=[];document.addEventListener('keydown',e=>{if(e.target.id==='clipboard-native-input')clipboardNativeEvents.push(e.defaultPrevented)})");
        for(const code of ['KeyC','KeyV'])for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key:code.slice(3).toLowerCase(),modifiers:2});
        assert.deepEqual(await page.evaluate('clipboardNativeEvents'),[false,false]);
        assert.equal(await page.evaluate('L.getLocationClipboardState().preview'),false);
        await page.evaluate("document.querySelector('#clipboard-native-input').remove()");

        await ctrl('KeyV');await at(11.25,10.25);
        await click(await point(11.25,10.25));await idle();
        let current=await detail();
        const first=current.objects.find(o=>!initial.objects.some(i=>i.id===o.id));
        assert.ok(first);assert.notEqual(first.id,object.id);
        assert.equal(first.properties.rotation,object.properties.rotation);
        assert.deepEqual(first.properties.dimensions,object.properties.dimensions);
        assert.equal(first.properties.elevation,.125);
        assert.deepEqual(current.objects.find(o=>o.id===object.id),object);
        assert.equal((await history()).undo,1);
        for(const code of ['KeyG','KeyT','KeyR']) {
            await key(page,code);assert.equal(await page.evaluate('window.isLocationEditorTransformActive()'),true);
            await key(page,'Escape','Escape');
        }
        await ctrl('KeyZ');assert.equal((await detail()).objects.length,initial.objects.length);
        await ctrl('KeyY');assert.ok((await detail()).objects.some(o=>o.id===first.id));
        await ctrl('KeyV');await at(12.5,4.5);
        await click(await point(12.5,4.5));await idle();
        assert.equal((await detail()).objects.length,initial.objects.length+2);
        console.log('LOC clipboard: native text keys, preview, Esc, exact single copy, fresh IDs, repeated paste, G/T/R, undo/redo');

        await page.evaluate('L.setLocationViewLevel(1)');
        await ctrl('KeyV');await at(4.5,4.5,3.435);
        await click(await point(4.5,4.5,3.435));await idle();
        current=await detail();
        const upper=current.objects.find(o=>o.type==='box'&&o.properties.level===1);
        assert.ok(upper);assert.equal(upper.properties.building_id,'target');
        assert.ok(Math.abs(upper.properties.elevation-.16)<1e-12);
        assert.equal(upper.properties.rotation,object.properties.rotation);
        await ctrl('KeyZ');assert.ok(!(await detail()).objects.some(o=>o.id===upper.id));
        await ctrl('KeyY');assert.ok((await detail()).objects.some(o=>o.id===upper.id));
        await peer.call('Page.bringToFront');
        await peer.evaluate('L.setLocationViewLevel(1)');
        await peer.until(`localRender.scene.children.some(m=>m.userData.locationObjectId===${upper.id}&&m.visible)`,'peer upper copy');
        await page.call('Page.bringToFront');
        // Hold the outgoing request so the other GM can change its support
        // after the preview was captured but before the server validates it.
        const conflictBefore=await detail(), conflictHistory=(await history()).undo;
        await ctrl('KeyV');await at(4.75,4.5,3.435);
        await page.evaluate(`window.savedClipboardFetch=window.fetch;window.fetch=async(...args)=>{
            if(String(args[0]).endsWith('/object-edits'))await new Promise(resolve=>window.releaseClipboardRequest=resolve);
            return savedClipboardFetch(...args)};`);
        await click(await point(4.75,4.5,3.435));
        await page.until("typeof releaseClipboardRequest==='function'",'paste request held');
        await peer.evaluate(`(async()=>{const {Server}=await import('/static/js/api.js');await Server.updateLocationObject(${lobby.id},${floor1.id},{properties:{elevation:.125}})})()`);
        await page.evaluate('window.fetch=savedClipboardFetch;releaseClipboardRequest()');await idle();
        assert.equal((await detail()).objects.length,conflictBefore.objects.length);
        assert.equal((await history()).undo,conflictHistory);
        assert.equal(await page.evaluate('L.getLocationClipboardState().preview'),true);
        assert.equal(await page.evaluate("document.body.innerText.includes('Отмена или повтор не применены')"),true);
        await key(page,'Escape','Escape');
        await peer.evaluate(`(async()=>{const {Server}=await import('/static/js/api.js');await Server.updateLocationObject(${lobby.id},${floor1.id},{properties:{elevation:0}})})()`);
        await page.evaluate('L.setLocationViewLevel(0)');
        console.log('LOC clipboard: upper floor binding, exact elevation, peer restoration');

        await selectBox();await page.evaluate('UI.collapseMapToolsPanel();document.activeElement.blur()');
        const rockPoint=await page.evaluate(`(()=>{const root=localRender.scene.children.find(m=>m.userData.tileX===6&&m.userData.tileZ===8&&m.userData.objType==='rock');
            const v=new T.Box3().setFromObject(root).getCenter(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,...rockPoint,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,modifiers:8});
        const lampPoint=await point(11.5,8.5,3);
        for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,...lampPoint,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,modifiers:8});
        await page.until('L.getSelectedLocationEditorAsset()?.selectedCount===3','mixed group selected');
        await ctrl('KeyC');assert.equal(await page.evaluate('L.getLocationClipboardState().count'),3);
        const mixedBefore=await detail(), mixedCount=(await history()).undo;
        await ctrl('KeyV');await at(9.5,4.5);
        if(process.env.VTT_LOC_CLIPBOARD_SHOTS==='1'){
            const shot=await page.call('Page.captureScreenshot',{format:'jpeg',quality:65});
            console.log('SCREEN '+JSON.stringify({label:'Mixed clipboard preview',data:shot.data}));
        }
        assert.deepEqual((await detail()).objects,mixedBefore.objects);
        await click(await point(9.5,4.5));await idle();
        const mixedAfter=await detail();
        assert.equal((await history()).undo,mixedCount+1);
        assert.equal(mixedAfter.objects.length,mixedBefore.objects.length+1);
        assert.equal(mixedAfter.lighting.local_lights.length,2);
        assert.equal(mixedAfter.tiles_data.flat().flatMap(t=>t.objects||[]).length,2);
        const newBox=mixedAfter.objects.find(o=>!mixedBefore.objects.some(b=>b.id===o.id));
        const newRock=mixedAfter.tiles_data.flatMap((row,z)=>row.flatMap((t,x)=>(t.objects||[]).map(o=>({x:x+.5+o.x,z:z+.5+o.z,o})))).find(e=>Math.abs(e.x-6.5)>.1);
        const newLamp=mixedAfter.lighting.local_lights[1];
        const bx=newBox.tile_x+.5+newBox.properties.offset_x,bz=newBox.tile_y+.5+newBox.properties.offset_z;
        assert.ok(Math.abs(newRock.x-bx+2)<1e-12);assert.ok(Math.abs(newRock.z-bz)<1e-12);
        assert.ok(Math.abs(newLamp.x-bx-3)<1e-12);assert.equal(newLamp.azimuth,12.345);
        await ctrl('KeyZ');assert.deepEqual((await detail()).tiles_data,mixedBefore.tiles_data);
        assert.equal((await detail()).lighting.local_lights.length,1);
        await ctrl('KeyY');assert.deepEqual((await detail()).tiles_data,mixedAfter.tiles_data);
        await peer.call('Page.bringToFront');
        await peer.until('L.getLocationStaticLightFieldDiagnostics().lampRoutes.length===2','peer mixed paste');
        await page.call('Page.bringToFront');
        console.log('LOC clipboard: mixed structure/decor/lamp group, relative transforms, one history command, peer sync');

        // Copy a self-contained manual floor/wall/door group.
        await page.evaluate("selectLocationEditorTool('select');UI.collapseMapToolsPanel()");
        await click(await point(2.5,13.5,1.035));
        await page.until("L.getSelectedLocationEditorAsset()?.structureType==='floor'",'manual floor selected');
        const wp=await point(4.5,12.5,2.2);
        for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,...wp,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,modifiers:8});
        await selectId(door.id,true);
        await page.until('L.getSelectedLocationEditorAsset()?.selectedCount===3','manual building group selected');
        await ctrl('KeyC');const buildingBefore=await detail();
        await ctrl('KeyV');await at(11.5,12.5);
        await click(await point(11.5,12.5));await idle();
        const buildingAfter=await detail(),newParts=buildingAfter.objects.filter(o=>!buildingBefore.objects.some(b=>b.id===o.id));
        assert.equal(newParts.length,3);
        assert.ok(newParts.every(o=>o.properties.building_id===newParts[0].properties.building_id));
        assert.notEqual(newParts[0].properties.building_id,'manual');
        assert.deepEqual(buildingAfter.objects.filter(o=>[houseFloor.id,wall.id,door.id].includes(o.id)),buildingBefore.objects.filter(o=>[houseFloor.id,wall.id,door.id].includes(o.id)));
        await ctrl('KeyZ');assert.equal((await detail()).objects.length,buildingBefore.objects.length);
        await ctrl('KeyY');assert.equal((await detail()).objects.length,buildingAfter.objects.length);

        await selectId(door.id);await ctrl('KeyC');await ctrl('KeyV');
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(12.5,2.5)});
        assert.equal(await page.evaluate('L.getLocationClipboardState().valid'),false);
        const rejectedCount=(await history()).undo;
        await click(await point(12.5,2.5));await idle();
        assert.equal((await history()).undo,rejectedCount);
        await key(page,'Escape','Escape');
        await selectId(filled.id);await ctrl('KeyC');
        assert.equal(await page.evaluate('L.getLocationClipboardState().count'),0);
        assert.equal(await page.evaluate("document.body.innerText.includes('заполненных контейнеров')"),true);
        console.log('LOC clipboard: new building links, intact originals, atomic undo/redo, explicit unsafe-case rejection');

        const final=await detail();
        await page.call('Page.navigate',{url:'about:blank'});await page.until("location.href==='about:blank'",'blank reload');
        await page.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});
        await page.until('Boolean(window.enterLocation&&window.isGM)','reloaded startup');await mount(page);
        assert.deepEqual((await detail()).tiles_data,final.tiles_data);
        assert.equal((await detail()).objects.length,final.objects.length);
        assert.equal(await page.evaluate('L.getLocationClipboardState().count'),0);
        assert.equal((await history()).undo,0);
        console.log('PASS LOC-05: real Ctrl+C/V, interactive preview, Esc, exact transforms, repeated and grouped paste, floors, links, undo/redo, peer and reload');
    } finally {peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId});}
};

