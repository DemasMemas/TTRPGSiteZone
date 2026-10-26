// $env:VTT_STOREYS='1'; $env:VTT_BROWSER_GPU='1'; node tests/world_object_editor.browser.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const out=path.resolve('docs/asset-previews/storeys');fs.mkdirSync(out,{recursive:true});
    const api=`/lobbies/${lobby.id}`;
    const tiles=Array.from({length:24},()=>Array.from({length:24},()=>({terrain:'bare_dirt',height:1,objects:[]})));
    const loc=await request(`${api}/locations`,{name:'Storey navigation',world_tile_x:12,world_tile_z:12,grid_width:24,grid_height:24,tiles_data:tiles,
        lighting:{local_lights:[{x:12.5,z:5.5,height:1.8,color:'#ffd090',intensity:.6,distance:5}]}},token);
    const detail=()=>request(`${api}/locations/${loc.id}`,null,token,'GET');
    const add=async(type,x,z,w,d,h,extra={})=>request(`${api}/locations/${loc.id}/objects`,{name:type,type,
        tile_x:Math.floor(x),tile_y:Math.floor(z),properties:{building_id:'storeys',level:0,
            offset_x:x-Math.floor(x)-.5,offset_z:z-Math.floor(z)-.5,dimensions:{width:w,depth:d,height:h},...extra}},token);
    const floor=await add('floor',8.5,8.5,10,10,.12,{roof_enabled:false,color:'#776d5d'});
    for(const z of [3.5,13.5])await add('wall',8.5,z,10,.2,2.4,{color:'#80786c'});
    for(const x of [3.5,13.5])await add('wall',x,8.5,10,.2,2.4,{rotation:Math.PI/2,color:'#80786c'});
    await add('wall',8.5,8.5,10,.12,2.4,{visual_asset:'inner_wall',rotation:Math.PI/2});
    await add('door',8.5,8.5,.9,.18,2,{visual_asset:'opening',is_open:true,interactions:[],rotation:Math.PI/2});
    await add('window',13.5,10.5,1.2,.14,1,{rotation:Math.PI/2,elevation:1});
    await add('household_wood_chair',11.5,11.5,.45,.48,.88);
    // Capture the real renderer/scene, including dynamically added meshes.
    await page.evaluate(`window.T=threeModule;window.W=sceneModule;const old=T.Scene.prototype.add;
        T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;
            const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);
                if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return old.apply(this,roots)};
        window.enterLocation(${loc.id})`);
    await page.until('window.isLocationActive&&!!window.localRender&&window.selectLocationEditorTool','location startup');
    await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.look=(x,y,z,tx,ty,tz)=>{
        locationControls.target.set(tx,ty,tz);locationControls.object.position.set(x,y,z);locationControls.update();locationControls.object.updateMatrixWorld(true)};
        L.setLocationEditMode(true);window.selectLocationEditorTool('select');look(13,10,15,8.5,1,8.5);
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();
        document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click()})()`);
    const aim=(x,y,z)=>page.evaluate(`(()=>{const p=new T.Vector3(${x},${y},${z}).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const click=async p=>{await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await pause(500);
        for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...p});};
    const shot=async(name,delay=600)=>{await pause(delay);fs.writeFileSync(path.join(out,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    await pause(800);await click(await aim(10.5,1.035,10.5));
    await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='floor'`,'floor selected');
    // First option uses the actual creation dialog.
    await page.evaluate(`window.creation=L.addFloorAboveSelectedLocationAsset();true`);
    await page.until(`!!document.querySelector('dialog[open] [data-storey-mode]')`,'creation dialog');
    await shot('creation-options');
    await page.evaluate(`document.querySelector('dialog[open] form').requestSubmit(document.querySelector('dialog[open] button[value=create]'))`);
    assert.equal(await page.evaluate('creation'),true);
    const create=async options=>{
        // Selecting the source through the existing inspector is unnecessary for
        // an explicit option call: keep the original floor selected by a map click.
        await page.evaluate(`L.setLocationViewLevel(0);L.setLocationEditMode(true);window.selectLocationEditorTool('select');
            document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();look(13,10,15,8.5,1,8.5)`);
        await pause(600);await click(await aim(10.5,1.035,10.5));
        await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='floor'`,'source floor selected');
        assert.equal(await page.evaluate(`L.addFloorAboveSelectedLocationAsset(${JSON.stringify(options)})`),true);
    };
    // A near camera keeps the existing floor cutaway active during map selection.
    await create({mode:'copy',sourceLevel:0,targetLevel:2});
    await create({mode:'layout',sourceLevel:0,targetLevel:3});
    // Create the basement from the ordinary floor panel, without entering a Y coordinate.
    await page.evaluate(`L.setLocationViewLevel(0);L.setLocationEditMode(true);window.selectLocationEditorTool('select');
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();look(13,10,15,8.5,1,8.5)`);
    await pause(600);await click(await aim(10.5,1.035,10.5));
    await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='floor'`,'building selected for basement');
    await page.evaluate(`document.querySelector('[data-floor-create]').click()`);
    await page.until(`!!document.querySelector('dialog[open] [data-storey-basement]')`,'floor panel basement dialog');
    await page.evaluate(`document.querySelector('dialog[open] [data-storey-basement]').click();
        document.querySelector('dialog[open] form').requestSubmit(document.querySelector('dialog[open] button[value=create]'))`);
    await page.until(`L.getLocationViewLevel()===-1`,'basement created and selected');
    await create({mode:'empty',sourceLevel:-1,targetLevel:-2});
    const built=await detail();
    const on=level=>built.objects.filter(o=>o.properties.level===level);
    assert.equal(on(1).length,on(0).length);assert.equal(on(2).length,on(0).length);
    assert.equal(on(-1).filter(o=>o.type==='wall').length,4);
    assert.equal(on(-2).filter(o=>o.type==='floor').length,1);
    assert.equal(on(3).filter(o=>o.type==='wall').length,5);
    assert.ok(!on(-1).some(o=>o.type==='household_wood_chair'));
    assert.ok(built.lighting.local_lights.some(l=>l.level===1));
    assert.ok(built.lighting.local_lights.some(l=>l.level===2));
    // Remove the extra copy/layout examples, leaving the playable three-storey house.
    for(const o of built.objects.filter(o=>[2,3,-2].includes(o.properties.level))){
        const response=await fetch(`${base}${api}/locations/objects/${o.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,204);
    }
    await request(`${api}/locations/${loc.id}`,{lighting:{...built.lighting,local_lights:built.lighting.local_lights.filter(l=>l.level!==2)}},token,'PUT');
    // Resize the basement to the right-hand portion of the house using the normal inspector.
    await page.evaluate(`L.setLocationViewLevel(-1);L.setLocationEditMode(true);window.selectLocationEditorTool('select');
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();look(10.5,18,11,10.5,-1.4,8.5)`);
    await pause(700);await click(await aim(10.5,-1.365,10.5));
    await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='floor'&&L.getSelectedLocationEditorAsset().level===-1`,'basement floor selected');
    assert.equal(await page.evaluate(`(()=>{const s=L.getSelectedLocationEditorAsset();return L.updateSelectedLocationAssetDetails({
        ...s,x:10.5,z:8.5,dimensions:{...s.dimensions,width:6}})})()`),true);
    for(const [x,z,nextX] of [[8.5,3.5,10.5],[8.5,13.5,10.5],[3.5,8.5,7.5]]){
        await click(await aim(x,1,z));
        await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='wall'&&L.getSelectedLocationEditorAsset().level===-1`,'basement boundary selected');
        assert.equal(await page.evaluate(`(()=>{const s=L.getSelectedLocationEditorAsset();return L.updateSelectedLocationAssetDetails({
            ...s,x:${nextX},z:${z},dimensions:{...s.dimensions,width:${z===8.5?10:6}}})})()`),true);
    }
    const partial=(await detail()).objects.find(o=>o.type==='floor'&&o.properties.level===-1);
    assert.equal(partial.properties.dimensions.width,6);
    await page.evaluate(`L.setLocationViewLevel(0);look(20,13,22,8.5,1,8.5)`);await shot('surface');
    await add('stairs',6.5,7.5,1.2,3.6,2.4);
    await add('stairs',10.5,7.5,1.2,3.6,2.4,{level:-1});
    await page.evaluate(`L.setLocationEditMode(false);document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();
        L.setLocationViewLevel(0);look(13,10,15,8.5,1,8.5)`);
    const actor=await request(`${api}/characters`,{name:'Stair walker',data:{}},token);
    const other=await request(`${api}/characters`,{name:'Ground observer',data:{}},token);
    for(const ch of [actor,other])await request(`${api}/locations/${loc.id}/spawn_character`,{character_id:ch.id,tile_x:ch.id===actor.id?6:4,tile_y:5},token);
    await page.until(`localRender.scene.children.some(r=>r.userData.characterId===${actor.id})`,'character models');
    await page.evaluate(`window.moves=[];window.rejects=[];socket.on('character_moved',d=>moves.push(d));socket.on('movement_rejected',d=>rejects.push(d));true`);
    const peerTarget=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===peerTarget.targetId).webSocketDebuggerUrl);
    try{
        await peer.until('Boolean(window.enterLocation&&window.socket?.connected)','peer ready');
        await peer.call('Page.bringToFront');
        await peer.until("document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'peer world ready');
        await peer.evaluate(`(async()=>{window.peerMoves=[];window.peerModels=new Map();socket.on('character_moved',d=>peerMoves.push(d));
            const T=await import('three'),old=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){window.peerScene=this;
                for(const r of roots)if(r.userData.characterId)peerModels.set(r.userData.characterId,r);return old.apply(this,roots)};
            await window.enterLocation(${loc.id})})()`);
        await peer.until('window.isLocationActive','peer location');
        await peer.until(`peerModels.has(${actor.id})`,'peer initial character model');
        await peer.until(`peerScene.children.some(r=>{const o=r.userData.locationObject;return o?.type==='floor'
            &&o.properties.level===-1&&o.properties.dimensions.width===6})`,'peer loads partial basement contour');
        await page.call('Page.bringToFront');
        let transitionCaptured=false;
        const move=async(x,y,level,pointer=false)=>{
            const count=await page.evaluate('moves.length');
            if(pointer){
                await page.evaluate(`window.previewRoutes=[];const before=window.fetch;window.fetch=async function(...args){const response=await before.apply(this,args);
                    if(String(args[0]).includes('/movement-preview'))previewRoutes.push(await response.clone().json());return response};
                    L.startCharacterMoveMode(${actor.id})`);
                const p=await aim(x+.5,1+level*2.4+.035,y+.5);
                await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
                await page.until(`previewRoutes.some(p=>p.route?.surfaces?.at(-1).level===${level})`,'server stair route preview');
                await pause(300);await click(p);
            }else{
                await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:${x},y:${y},floor_level:${level}});true`);
            }
            await page.until(`moves.length>${count}&&moves.at(-1).floor_level===${level}`,'authoritative floor movement');
            await peer.until(`peerMoves.some(d=>d.character_id===${actor.id}&&d.x===${x}&&d.y===${y}&&d.floor_level===${level})`,'peer receives position and floor');
            const update=await page.evaluate('moves.at(-1)');
            if(level===-1&&!transitionCaptured){
                transitionCaptured=true;
                await page.evaluate('L.setLocationViewLevel(-1);look(17,8,18,10.5,-.7,7.5)');
                const step=update.path.findIndex(n=>n.level===-1&&n.height>-1.3);
                await pause(Math.max(180,step*180));
                await page.until(`(()=>{const m=localRender.scene.children.find(r=>r.userData.characterId===${actor.id});
                    return m?.visible&&m.position.y>-1.3&&m.position.y<.9})()`,'visible character on basement stairs');
                await shot('stair-transition',0);
            }
            await pause(Math.max(500,(update.path?.length||1)*180+300));
            const rendered=await page.evaluate(`(()=>{const r=localRender.scene.children.find(r=>r.userData.characterId===${actor.id});return {height:r?.position.y,visible:r?.visible,position:r?.position.toArray()}})()`);
            assert.ok(Math.abs(rendered.height-update.height)<.001,JSON.stringify({rendered,update}));
            await peer.until(`Math.abs(peerModels.get(${actor.id})?.position.y-(${update.height}))<.001`,'peer model reaches physical height');
        };
        await page.evaluate('L.setLocationViewLevel(1)');
        await move(6,10,1,true);
        const up=await page.evaluate('moves.at(-1)');assert.equal(up.floor_level,1);assert.ok(up.path.some(n=>n.level===0&&n.height>1));
        await page.evaluate('look(20,13,22,8.5,3.4,8.5)');await shot('upper-floor');
        await move(6,5,0);
        // A second character may occupy the same X/Y on the upper floor.
        await request(`${api}/locations/${loc.id}/spawn_character`,{character_id:other.id,tile_x:6,tile_y:10},token);
        await move(6,10,1);
        const coincident=await page.evaluate('moves.at(-1)');assert.equal(coincident.x,6);assert.equal(coincident.y,10);
        const beforeRejected=await page.evaluate('rejects.length');
        await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:6,y:10,floor_level:0});true`);
        await page.until(`rejects.length>${beforeRejected}`,'same floor occupied destination rejected');
        // Viewing a different floor must not change physical state.
        await page.evaluate('L.setLocationViewLevel(-1)');await pause(250);
        assert.equal(await page.evaluate('moves.at(-1).floor_level'),1);
        await pause(3500);
        await move(6,5,0);
        await move(10,10,0);
        await move(10,5,-1);
        assert.equal((await detail()).tiles_data[0][0].height,1);
        await page.evaluate(`L.setLocationViewLevel(-1);look(18,7,20,8.5,-1.4,8.5)`);
        assert.equal(await page.evaluate(`localRender.scene.children.find(r=>r.userData.characterId===${actor.id}).visible`),true,'basement character visible');
        await shot('basement');
        await page.evaluate(`look(1,5,17,8.5,-1.4,8.5)`);await shot('basement-reverse');
        // Edit furnishings in the underground room through the normal placement tool.
        await page.evaluate(`L.setLocationEditMode(true);window.selectLocationEditorTool('assets');
            L.setLocationAssetPreset('household_wood_chair');look(13,7,15,8.5,-1.4,8.5);
            document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
        await page.evaluate(`L.setLocationAssetPreset('inner_wall')`);
        await pause(700);await click(await aim(9.5,-1.365,11.5));
        await peer.until(`peerScene.children.filter(r=>r.userData.locationObject?.type==='wall'
            &&r.userData.locationObject.properties.level===-1).length===5`,'peer receives basement partition');
        await page.evaluate(`L.setLocationAssetPreset('opening')`);
        await click(await aim(9.5,-1.365,11.5));
        await peer.until(`peerScene.children.some(r=>r.userData.locationObject?.type==='door'
            &&r.userData.locationObject.properties.level===-1)`,'peer receives basement room opening');
        await page.evaluate(`L.setLocationAssetPreset('household_wood_chair')`);
        await pause(700);await click(await aim(11.5,-1.365,10.5));
        await page.until(`(async()=>{const r=await fetch('${api}/locations/${loc.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('access_token')}});
            return (await r.json()).objects.some(o=>o.type==='household_wood_chair'&&o.properties.level===-1)})()`,'basement furniture placement');
        await peer.until(`peerScene.children.some(r=>r.userData.locationObject?.type==='household_wood_chair'
            &&r.userData.locationObject.properties.level===-1)`,'peer receives basement furniture');
        await shot('basement-editor');
        await page.evaluate(`L.setLocationAssetPreset('warm_lamp')`);
        await click(await aim(11.5,-1.365,6.5));
        await page.until(`(async()=>{const r=await fetch('${api}/locations/${loc.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('access_token')}});
            return (await r.json()).lighting.local_lights.some(l=>l.level===-1&&l.height<0)})()`,'basement lamp placement');
        await pause(500);
        assert.ok(await page.evaluate(`(()=>{let count=0;localRender.scene.traverse(r=>{
            for(const m of [].concat(r.material||[])){const u=localRender.renderer.properties.get(m).uniforms;
                if(u?.basementRectCount?.value===1)count++;}});return count>=3})()`),'terrain cutaway survives lighting rebuild');
        await page.evaluate('L.clearLocationAssetPreset();L.setLocationEditMode(false)');
        assert.equal(await page.evaluate('Boolean(L.getLocationStaticLightFieldDiagnostics().enabled)'),true,'light field remains enabled');
        assert.deepEqual((await detail()).tiles_data,tiles);
        // Actual reload verifies persisted floor and physical height through location_state.
        await page.call('Page.reload');await page.until('!window.L&&Boolean(window.enterLocation)&&window.socket?.connected','reload');
        await page.until("document.getElementById('scene-loading-screen').classList.contains('is-hidden')&&!window.isLocationActive",'world ready after reload');
        await page.evaluate(`(async()=>{window.states=[];socket.on('location_state',s=>states.push(s));
            const T=await import('three'),W=await import('/static/js/lobby3d.js'),old=T.Scene.prototype.add;
            T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;const before=m.onBeforeRender;
                m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return old.apply(this,roots)};
            await window.enterLocation(${loc.id});window.L=await import('/static/js/locationScene.js');L.setLocationViewLevel(-1);
            locationControls.target.set(8.5,-1.4,8.5);locationControls.object.position.set(18,7,20);locationControls.update()})()`);
        await page.until(`states.some(s=>s.some(c=>c.character_id===${actor.id}&&c.floor_level===-1&&Math.abs(c.height+1.365)<.001))`,'saved basement state');
        await page.until(`!!window.localRender&&localRender.scene.children.some(r=>r.userData.characterId===${actor.id}&&r.visible&&Math.abs(r.position.y+1.365)<.001)`,'reloaded basement model');
        assert.equal(await page.evaluate('localRender.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length'),0);
        await shot('basement-reloaded');
    }finally{peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId});}
    fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({fourCreationModes:true,negativeLevels:[-2,-1],twoClients:true,
        sameXYDifferentFloors:true,sameFloorCollision:true,stairsUpDown:true,basement:true,reload:true,terrainUnchanged:true,
        partialBasement:true,basementFromFloorPanel:true,basementRoomEditing:true,peerReceivesBasementEdits:true,surroundingTerrainVisible:true,realModelHeightsOnBothClients:true,pointerRoutePreview:true,basementEditing:true,basementLamp:true,copiedLamps:true,shaderErrors:0},null,2));
    console.log('STOREYS PASS');
};
