// VTT_LOCAL_MAP_TOOLS=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const api=`/lobbies/${lobby.id}`;
    await request('/auth/register',{username:'local-tools-player',email:'tools@example.test',password:'tools-password'});
    const player=await request('/auth/login',{username:'local-tools-player',password:'tools-password'});
    await request(api+'/join',{},player.access_token);
    const actor=await request(api+'/characters',{name:'Tools actor',data:{}},player.access_token);
    const tiles=Array.from({length:16},()=>Array.from({length:16},()=>({terrain:'concrete',height:1,objects:[]})));
    for(let z=3;z<=5;z++)for(let x=5;x<=7;x++)tiles[z][x].height=2;
    const loc=await request(api+'/locations',{name:'Local map tools',world_tile_x:8,world_tile_z:8,grid_width:16,grid_height:16,tiles_data:tiles},token);
    const other=await request(api+'/locations',{name:'Other local map',world_tile_x:9,world_tile_z:8,grid_width:16,grid_height:16,tiles_data:tiles},token);
    const url=api+'/locations/'+loc.id;
    await request(url+'/spawn_character',{character_id:actor.id,tile_x:4,tile_y:4},token);
    await request(url+'/objects/batch',{objects:[{type:'floor',name:'Upper floor',tile_x:10,tile_y:10,
        properties:{building_id:'tools-building',level:1,dimensions:{width:6,depth:6,height:.12},roof_enabled:false}}]},token);
    const browserInfo=await(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const protocol=await connect(browserInfo.webSocketDebuggerUrl);
    const isolation=await protocol.call('Target.createBrowserContext');
    const target=await protocol.call('Target.createTarget',{url:base,browserContextId:isolation.browserContextId});
    const targets=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(targets.find(p=>p.id===target.targetId).webSocketDebuggerUrl);
    const mount=async(client,id=loc.id)=>{
        await client.call('Page.bringToFront');
        await client.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.C=await import('/static/js/mapSceneContext.js');window.M=await import('/static/js/markers.js');window.T=await import('three');await enterLocation(${id})})()`);
        await client.until(`C.getMapSceneContext()?.locationId===${id}&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'local scene ready');
        await client.evaluate(`L.setLocationEditMode(false);document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();if(document.getElementById('panel-common-tools').hidden)document.getElementById('common-tools-toggle').click()`);
        await pause(300);
    };
    const aim=async(client,x,z)=>client.evaluate(`(()=>{const c=C.getMapSceneContext();c.camera.updateMatrixWorld(true);const y=c.surface(${x},${z}),v=new T.Vector3(${x},y,${z}).project(c.camera),r=c.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
    const click=async(client,x,z)=>{
        const p=await aim(client,x,z);
        await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p,buttons:0});
        for(const [type,buttons] of [['mousePressed',1],['mouseReleased',0]])await client.call('Input.dispatchMouseEvent',{type,...p,button:'left',buttons,clickCount:1});
    };
    const tool=async(client,name)=>client.evaluate(`(()=>{const b=document.querySelector('[data-common-map-tool="${name}"]');if(b.getAttribute('aria-pressed')!=='true')b.click()})()`);
    const esc=async client=>{for(const type of ['keyDown','keyUp'])await client.call('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});};
    const marks=name=>`C.getMapSceneContext().scene.children.filter(r=>r.userData.markerData?.name===${JSON.stringify(name)})`;
    const screenshot=async(client,label)=>fs.writeFileSync(path.join(os.tmpdir(),'vtt-local-tools-'+label+'.png'),Buffer.from((await client.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    try{
        await peer.call('Runtime.enable');await peer.call('Page.enable');
        await peer.until(`location.origin===${JSON.stringify(base)}`,'player origin');
        await peer.evaluate(`localStorage.setItem('access_token',${JSON.stringify(player.access_token)});localStorage.setItem('user_id',${JSON.stringify(String(player.user_id))})`);
        await peer.call('Page.navigate',{url:base+api+'/page'});
        await peer.until(`window.isGM===false&&typeof enterLocation==='function'`,'player room');
        for(const client of [page,peer]){
            await client.call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
            await mount(client);
        }
        for(const client of [page,peer])assert.equal(await client.evaluate(`document.querySelector('[data-common-map-tool="measure"]').disabled`),false);
        for(const combat of [false,true]){
            if(combat){
                const state=await request(url+'/combat',null,token,'GET');
                await request(url+'/combat/start',{location_character_ids:state.characters.map(c=>c.location_character_id)},token);
                await peer.until(`L.getCombatState()?.status==='active'`,'combat on both clients');
            }
            for(const [sender,receiver] of [[page,peer],[peer,page]]){
                await sender.call('Page.bringToFront');
                const before=combat?await request(url+'/combat',null,token,'GET'):null;
                await tool(sender,'measure');await click(sender,5.5,6.5);await click(sender,8.5,10.5);
                await receiver.until(`C.getMapSceneContext().scene.children.some(r=>r.userData.sharedMapMeasure?.final)`,'shared local ruler');
                const distance=await receiver.evaluate(`C.getMapSceneContext().scene.children.find(r=>r.userData.sharedMapMeasure?.final).userData.distance`);
                assert.ok(Math.abs(Number(distance)-5)<.04,distance);
                assert.match(await sender.evaluate(`document.getElementById('common-map-result').textContent`),/5\.00.*м/);
                await screenshot(sender,combat?'combat-ruler':'ruler');
                await esc(sender);
                await receiver.until(`!C.getMapSceneContext().scene.children.some(r=>r.userData.sharedMapMeasure)`,'shared ruler cleared');
                await tool(sender,'ping');await click(sender,8.5,9.5);
                await receiver.until(`C.getMapSceneContext().scene.children.some(r=>r.userData.commonMapPing?.location_id===${loc.id})`,'local ping');
                await esc(sender);
                if(combat){
                    await tool(sender,'marker');await click(sender,7.5,8.5);
                    const name=sender===page?'GM combat mark':'Player combat mark';
                    await sender.until(`document.getElementById('marker-create-modal').style.display==='flex'`,'combat marker form');
                    await sender.evaluate(`document.getElementById('marker-create-name').value=${JSON.stringify(name)};M.submitCreateMarker()`);
                    await receiver.until(`${marks(name)}.length===1`,'combat marker shared');
                    await esc(sender);
                }
                if(combat){const after=await request(url+'/combat',null,token,'GET');assert.deepEqual(after.current_character,before.current_character,'tools spend no combat resources');}
                await pause(600);
            }
        }
        await request(url+'/combat/end',{},token);
        // Elevation contributes to the distance (2 horizontal, 1 vertical => sqrt(5)).
        await page.call('Page.bringToFront');await tool(page,'measure');await click(page,4.5,4.5);await click(page,6.5,4.5);
        await peer.until(`C.getMapSceneContext().scene.children.some(r=>r.userData.sharedMapMeasure?.final)`,'height ruler');
        const vertical=await peer.evaluate(`(()=>{const c=C.getMapSceneContext(),m=c.scene.children.find(r=>r.userData.sharedMapMeasure?.final);return {actual:Number(m.userData.distance),expected:Math.hypot(2,c.surface(6.5,4.5)-c.surface(4.5,4.5)),ends:m.userData.ends}})()`);
        assert.ok(vertical.expected>2&&Math.abs(vertical.actual-vertical.expected)<.04,JSON.stringify(vertical));
        await esc(page);
        // Persistent marks use the existing create/edit forms and ownership rules.
        await peer.call('Page.bringToFront');await tool(peer,'marker');await click(peer,8.5,9.5);
        await peer.until(`document.getElementById('marker-create-modal').style.display==='flex'`,'create form');
        await peer.evaluate(`document.getElementById('marker-create-name').value='Player local mark';M.pickTileForMarker()`);
        await click(peer,8.5,9.5);
        await peer.until(`document.getElementById('marker-create-modal').style.display==='flex'`,'picked marker point');
        assert.equal(await peer.evaluate(`document.getElementById('marker-create-name').value`),'Player local mark');
        await peer.evaluate('M.submitCreateMarker()');
        await page.until(`${marks('Player local mark')}.length===1`,'marker shared to GM');
        await peer.until(`${marks('Player local mark')}.length===1`,'marker rendered for owner');
        await esc(peer);
        const oldHeight=await peer.evaluate(`${marks('Player local mark')}[0].position.y`);
        await page.evaluate(`L.applyLocationBrush(8,9,{height:2},0)`);
        await peer.until(`${marks('Player local mark')}[0].position.y>${oldHeight+.8}`,'mark follows terrain update');
        await page.evaluate('L.setLocationViewLevel(1)');await peer.evaluate('L.setLocationViewLevel(1)');
        assert.equal(await page.evaluate(`${marks('Player local mark')}[0].visible`),false,'lower mark hidden on upper floor');
        await tool(page,'marker');await click(page,10.5,10.5);
        await page.until(`document.getElementById('marker-create-modal').style.display==='flex'`,'upper floor form');
        await page.evaluate(`document.getElementById('marker-create-name').value='Upper mark';M.submitCreateMarker()`);
        await peer.until(`${marks('Upper mark')}.some(m=>m.visible&&m.userData.markerData.floor_level===1)`,'upper floor marker');
        await esc(page);await screenshot(page,'upper-floor');
        await tool(page,'ping');await click(page,10.5,10.5);
        await peer.until(`C.getMapSceneContext().scene.children.some(r=>r.userData.commonMapPing?.floor_level===1&&r.visible)`,'upper floor ping');
        await peer.evaluate('L.setLocationViewLevel(0)');
        assert.equal(await peer.evaluate(`C.getMapSceneContext().scene.children.find(r=>r.userData.commonMapPing?.floor_level===1).visible`),false);
        await peer.evaluate('L.setLocationViewLevel(1)');await esc(page);
        await peer.evaluate(`(()=>{const c=C.getMapSceneContext(),m=${marks('Upper mark')}[0],v=m.position.clone().project(c.camera),r=c.canvas.getBoundingClientRect();c.canvas.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+(v.x+1)*r.width/2,clientY:r.top+(1-v.y)*r.height/2}))})()`);
        await peer.until(`document.getElementById('marker-edit-modal').style.display==='flex'`,'read-only marker form');
        assert.equal(await peer.evaluate(`document.querySelector('#marker-edit-modal [onclick="saveMarkerEdit()"]').disabled`),true);
        await peer.evaluate('M.closeMarkerEditModal()');
        // Drag on the selected upper floor, then cancel a second drag using Escape.
        await page.call('Page.bringToFront');
        const screen=await page.evaluate(`(()=>{const c=C.getMapSceneContext(),m=${marks('Upper mark')}[0],v=m.position.clone().project(c.camera),r=c.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        const destination=await aim(page,11.5,10.5);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...screen,buttons:0});
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...screen,button:'left',buttons:1,clickCount:1});
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...destination,button:'left',buttons:1});
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...destination,button:'left',buttons:0,clickCount:1});
        await peer.until(`${marks('Upper mark')}[0].userData.markerData.position.x>11`,'marker moved on peer');
        const movedX=await page.evaluate(`${marks('Upper mark')}[0].position.x`);
        const movedScreen=await page.evaluate(`(()=>{const c=C.getMapSceneContext(),v=${marks('Upper mark')}[0].position.clone().project(c.camera),r=c.canvas.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...movedScreen,buttons:0});
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...movedScreen,button:'left',buttons:1,clickCount:1});
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...screen,button:'left',buttons:1});await esc(page);
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...screen,button:'left',buttons:0,clickCount:1});
        assert.ok(Math.abs(await page.evaluate(`${marks('Upper mark')}[0].position.x`)-movedX)<.01,'Escape restores drag');
        assert.equal(await page.evaluate('C.getMapSceneContext().controls.enabled'),true);
        await page.evaluate('L.setLocationViewLevel(0)');await tool(page,'measure');await click(page,5.5,6.5);
        await page.evaluate('L.setLocationViewLevel(1)');await click(page,10.5,10.5);
        await peer.until(`C.getMapSceneContext().scene.children.some(r=>r.userData.sharedMapMeasure?.final&&r.userData.sharedMapMeasure.to.floor_level===1)`,'cross-storey ruler');
        const crossStorey=await peer.evaluate(`(()=>{const c=C.getMapSceneContext(),m=c.scene.children.find(r=>r.userData.sharedMapMeasure?.final);return{distance:Number(m.userData.distance),ends:m.userData.ends,expected:Math.hypot(5,4,c.surface(10.5,10.5,1)-c.surface(5.5,6.5,0))}})()`);
        assert.ok(Math.abs(crossStorey.distance-crossStorey.expected)<.04,JSON.stringify(crossStorey));
        await esc(page);
        await page.evaluate('L.setLocationViewLevel(0)');await peer.evaluate('L.setLocationViewLevel(0)');
        // Rotate the normal camera with RMB; new picks must still measure 5 m.
        const orbit=await aim(page,8,8),oldCamera=await page.evaluate('C.getMapSceneContext().camera.position.toArray()');
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...orbit,button:'right',buttons:2,clickCount:1});
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:orbit.x+35,y:orbit.y+10,button:'right',buttons:2});
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:orbit.x+35,y:orbit.y+10,button:'right',buttons:0,clickCount:1});await pause(350);
        assert.notDeepEqual(await page.evaluate('C.getMapSceneContext().camera.position.toArray()'),oldCamera);
        await tool(page,'measure');await click(page,5.5,6.5);await click(page,8.5,10.5);
        await peer.until(`C.getMapSceneContext().scene.children.some(r=>r.userData.sharedMapMeasure?.final)`,'ruler after orbit');
        assert.ok(Math.abs(Number(await peer.evaluate(`C.getMapSceneContext().scene.children.find(r=>r.userData.sharedMapMeasure?.final).userData.distance`))-5)<.04);
        // World and another sublocation must not display local marks or pings.
        await peer.evaluate('exitLocation()');
        await peer.until(`!window.isLocationActive`,'world restored');
        assert.equal(await peer.evaluate(`${marks('Player local mark')}.length`),0);
        await mount(peer,other.id);assert.equal(await peer.evaluate(`${marks('Player local mark')}.length`),0);
        assert.equal(await peer.evaluate(`C.getMapSceneContext().scene.children.filter(r=>r.userData.sharedMapMeasure).length`),0);
        await page.evaluate(`socket.emit('map_ping',{location_id:${loc.id},position:{x:8.5,y:2,z:9.5},floor_level:0});true`);await pause(300);
        assert.equal(await peer.evaluate(`C.getMapSceneContext().scene.children.filter(r=>r.userData.commonMapPing).length`),0);
        await mount(peer);
        await peer.until(`${marks('Player local mark')}.some(m=>m.visible)`,'marker after re-entry');
        await peer.call('Page.navigate',{url:'about:blank'});await peer.until(`location.href==='about:blank'`,'reload blank');
        await peer.call('Page.navigate',{url:base+api+'/page'});await peer.until(`typeof enterLocation==='function'`,'reload room');
        await mount(peer);await peer.until(`${marks('Player local mark')}.some(m=>m.visible)`,'marker after reload');
        await peer.until(`C.getMapSceneContext().scene.children.some(r=>r.userData.sharedMapMeasure?.final)`,'ruler snapshot after reload');
        await esc(page);
        await screenshot(peer,'reloaded');
        await peer.evaluate('L.setLocationViewLevel(1)');
        await peer.until(`${marks('Upper mark')}.some(m=>m.visible&&m.position.x>11)`,'upper marker restored after reload');
        await peer.evaluate('L.setLocationViewLevel(0)');
        // Editor hotkeys and controls take ownership back from a common tool.
        await page.call('Page.bringToFront');
        const objectsBefore=(await request(url,null,token,'GET')).objects.length;
        await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('building')`);
        for(const [key,code] of [['g','KeyG'],['t','KeyT'],['r','KeyR']]){
            await tool(page,'measure');await click(page,5.5,6.5);await click(page,8.5,10.5);
            for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,key,code});
            assert.equal(await page.evaluate('window.commonMapToolMode'),null);
        }
        await tool(page,'measure');await page.evaluate(`selectLocationEditorTool('terrain')`);
        assert.equal(await page.evaluate('window.commonMapToolMode'),null);
        await page.evaluate('L.setLocationEditMode(false)');
        assert.equal((await request(url,null,token,'GET')).objects.length,objectsBefore);
        await page.evaluate('exitLocation()');await page.until(`!window.isLocationActive&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'world again');
        await page.evaluate(`document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);await pause(350);
        await page.evaluate(`(()=>{const c=C.getMapSceneContext();c.controls.target.set(32,0,16);c.camera.position.set(32,40,50);c.controls.update()})()`);await pause(350);
        const wp=await aim(page,30.5,16.5);
        await page.until(`Boolean(C.getMapSceneContext().point(${wp.x},${wp.y}))`,'world surface ready');
        await tool(page,'measure');await click(page,30.5,16.5);await click(page,34.5,16.5);
        assert.match(await page.evaluate(`document.getElementById('common-map-result').textContent`),/4\.00.*кл/);
        await esc(page);
        console.log('PASS LOCAL MAP TOOLS: two real clients, meter/height ruler, pings, local/floor scope, persistent markers, drag, combat and reload');
    }finally{peer.close();await protocol.call('Target.disposeBrowserContext',{browserContextId:isolation.browserContextId});protocol.close();}
};
