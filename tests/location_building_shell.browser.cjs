// VTT_BUILDING_SHELL=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
module.exports = async ({page,request,token,lobby,base,connect,debugPort}) => {
    const api = `/lobbies/${lobby.id}`;
    const loc = await request(`${api}/locations`, { name:'Shell acceptance', world_tile_x:12,world_tile_z:12,
        grid_width:24,grid_height:24,tiles_data:Array.from({length:24},()=>Array.from({length:24},()=>({terrain:'bare_dirt',height:1,objects:[]}))) },token);
    const detail = ()=>request(`${api}/locations/${loc.id}`,null,token,'GET');
    await page.evaluate(`(async()=>{
        window.T=await import('three');const old=T.Scene.prototype.add;
        T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;
            const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);if(window.isLocationActive)window.shellRender={r,s,c}}});return old.apply(this,roots)};
        window.L=await import('/static/js/locationScene.js');await enterLocation(${loc.id});
        L.setLocationEditMode(true);selectLocationEditorTool('assets');
        locationControls.target.set(8,1,8);locationControls.object.position.set(17,18,22);locationControls.update();
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();
        document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();
    })()`);
    await page.until('window.shellRender&&document.querySelector("[data-house-draw]")','local renderer');
    if(process.env.VTT_BUILDING_FIX2==='1')return runFloorFix2({page,request,token,lobby,loc});
    if(process.env.VTT_BUILDING_APERTURE==='1')return runApertureRegression({page,request,token,lobby,loc});
    const stats=()=>page.evaluate(`(async()=>{const frames=[],cpu=[],gpu=[],queries=[];const r=shellRender.r,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),render=r.render;
        r.render=function(...args){const q=ext?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);const start=performance.now();const result=render.apply(this,args);cpu.push(performance.now()-start);if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push(q)}return result};
        let last=performance.now();try{for(let i=0;i<90;i++)await new Promise(resolve=>requestAnimationFrame(t=>{frames.push(t-last);last=t;resolve()}));
        if(ext&&!gl.getParameter(ext.GPU_DISJOINT_EXT))for(const q of queries)if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);
        let meshes=0;shellRender.s.traverse(o=>{if(o.isMesh)meshes++});const mean=a=>a.length?a.reduce((a,b)=>a+b,0)/a.length:null;
        return {meshes,calls:r.info.render.calls,triangles:r.info.render.triangles,frameMs:mean(frames),cpuRenderMs:mean(cpu),gpuMs:mean(gpu)};
        }finally{r.render=render;for(const q of queries)gl.deleteQuery(q)}})()`);
    await page.evaluate(`window.shellBatches=[];const nativeFetch=window.fetch;window.fetch=async(...args)=>{const start=performance.now(),response=await nativeFetch(...args);if(String(args[0]).includes('/objects/batch')){const body=await response.clone().json();shellBatches.push({method:args[1]?.method,ms:performance.now()-start,timings:body.timings})}return response};true`);
    const emptyStats=await stats();
    const aim=(x,z)=>page.evaluate(`(()=>{const p=new T.Vector3(${x},1.05,${z}).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const draw=async(min=2.5,max=11.5)=>{
        await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('assets');L.setLocationHouseDrawMode(true);document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();true`);
        const a=await aim(min,min),b=await aim(max,max);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...a});await pause(100);
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...a});
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...b});
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...b});
        await page.until('!!document.querySelector("dialog[open] [data-shell-preview]")','shell options after drag');
    };
    await draw();
    await page.evaluate(`(()=>{const f=document.querySelector('dialog form');f.elements.shape.value='L';f.elements.width.value=10;f.elements.depth.value=10;
        f.elements.storeys.value=2;f.elements.basements.value=2;f.elements.wealth.value='rich';f.elements.condition.value='damaged';
        f.elements.shape.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('[data-shell-preview]').click()})()`);
    assert.equal((await detail()).objects.length,0,'preview must not persist objects');
    assert.equal(await page.evaluate('document.querySelector("[data-shell-create]").disabled'),false);
    assert.ok(await page.evaluate('document.querySelector("dialog[open]").getBoundingClientRect().bottom <= innerHeight'));
    // Read preview in the ordinary game camera; retain only a temporary inspection frame.
    if(process.env.VTT_SHELL_INSPECT==='1'){
        const file=path.join(os.tmpdir(),'vtt-shell-preview.png');
        fs.writeFileSync(file,Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        console.log('INSPECTION FRAME',file);
    }
    const generationStart=Date.now();
    await page.evaluate(`document.querySelector('dialog form').requestSubmit(document.querySelector('[data-shell-create]'));true`);
    await page.until(`document.body.innerText.includes('Все элементы доступны для ручной правки')`,'shell persisted');
    const generationMs=Date.now()-generationStart;
    const built=await detail();
    console.log('SHELL PERFORMANCE',JSON.stringify({generationMs,objects:built.objects.length,empty:emptyStats,built:await stats(),batches:await page.evaluate('shellBatches'),phases:await page.evaluate("performance.getEntriesByType('measure').filter(e=>e.name.startsWith('location-building:')).map(e=>({name:e.name,ms:e.duration}))")}));
    if(process.env.VTT_SHELL_PERF_ONLY==='1')return;
    assert.ok(built.objects.length>20);
    const buildingId=built.objects[0].properties.building_id;
    assert.ok(built.objects.every(o=>o.properties.building_id===buildingId));
    assert.deepEqual([...new Set(built.objects.map(o=>o.properties.level))].sort((a,b)=>a-b),[-2,-1,0,1]);
    await page.until(`socket.connected&&socket.io.engine.transport.name==='websocket'`,'actual WebSocket');
    const target=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    try {
        await peer.call('Page.bringToFront');
        await peer.until('window.enterLocation&&window.socket?.connected&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','second game client');
        await peer.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');
            window.shellUpdates=[];socket.on('location_object_updated',d=>shellUpdates.push(d));
            socket.on('joined_location',d=>window.shellJoined=d);await enterLocation(${loc.id})})()`);
        await peer.until(`isLocationActive&&shellJoined?.location_id===${loc.id}`,'peer joined location room');
        await peer.until(`socket.io.engine.transport.name==='websocket'`,'peer WebSocket');
        await page.call('Page.bringToFront');
        await peer.evaluate(`window.shellBatchesReceived=[];socket.on('location_objects_changed',d=>shellBatchesReceived.push(d));true`);
        const pointAt=(x,y,z)=>page.evaluate(`(()=>{const p=new T.Vector3(${x},${y},${z}).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
        const click=async p=>{await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await pause(200);
            for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...p});};
        await page.evaluate(`L.setLocationHouseDrawMode(false);selectLocationEditorTool('select');
            locationControls.target.set(5,1,5);locationControls.object.position.set(12,12,14);locationControls.update();true`);
        const extra=await request(`${api}/locations/${loc.id}/objects`,{type:'floor',name:'Temporary level 2',tile_x:3,tile_y:3,
            properties:{level:2,building_id:buildingId,roof_enabled:false,dimensions:{width:2,depth:2,height:.12}}},token);
        for(const level of [-2,-1,0,1,2]){
            await page.evaluate(`L.setLocationViewLevel(${level});locationControls.target.set(3.2,${1+level*2.4},3.2);locationControls.object.position.set(12.2,${12+level*2.4},14.2);locationControls.update();
                document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();true`);await pause(200);
            const point=await pointAt(3.2,1+level*2.4,3.2);
            await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(200);
            assert.deepEqual(await page.evaluate('L.getHoveredTileCoords()'),{x:3,z:3},`cursor on level ${level}`);
            await click(point);
            if(await page.evaluate('L.getSelectedLocationEditorAsset()?.level')!==level)console.log('PICK DIAGNOSTIC',await page.evaluate(`(()=>{const x=${point.x},y=${point.y},r=document.querySelector('#location-canvas canvas').getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1),locationControls.object);return {element:document.elementFromPoint(x,y)?.outerHTML.slice(0,500),tool:locationEditorTool,selected:L.getSelectedLocationEditorAsset(),hits:ray.intersectObjects(shellRender.s.children,true).slice(0,20).map(h=>{let root=h.object;while(root.parent&&root.parent!==shellRender.s)root=root.parent;return {type:root.userData.locationObject?.type,level:root.userData.locationObject?.properties.level,visible:root.visible,childVisible:h.object.visible,opacity:h.object.material?.opacity,distance:h.distance}})}})()`));
            assert.equal(await page.evaluate('L.getSelectedLocationEditorAsset()?.level'),level,`selection isolated on level ${level}`);
        }
        await request(`${api}/locations/${loc.id}/objects/batch`,{object_ids:[extra.id],level:2},token,'DELETE');
        await page.evaluate('L.setLocationViewLevel(-2);true');await pause(200);
        assert.ok(await page.evaluate(`shellRender.s.children.some(m=>m.visible&&m.userData.locationObject?.type==='wall'&&m.userData.locationObject.properties.level===-1)`),'upper basement boundary retained');
        assert.ok(await page.evaluate(`shellRender.s.children.filter(m=>m.userData.locationObject?.type==='floor'&&m.userData.locationObject.properties.level===-1).every(m=>!m.visible)`),'upper slabs hidden');
        await page.evaluate('L.setLocationViewLevel(0);locationControls.target.set(3.2,1,3.2);locationControls.object.position.set(9,8,11);locationControls.update();true');await pause(200);
        assert.ok(await page.evaluate(`shellRender.s.children.some(m=>m.visible&&m.userData.locationObject?.type==='floor'&&m.userData.locationObject.properties.level===-1)`),'basement geometry remains behind the surface opening');
        await click(await pointAt(3.2,1,3.2));
        const colorBefore=await page.evaluate(`(()=>{const a=L.getSelectedLocationEditorAsset();window.colorAsset=a;const root=shellRender.s.children.find(m=>m.userData.locationObject?.type==='floor'&&m.userData.locationObject.properties.level===0&&Math.abs(m.position.x-a.x)<.01&&Math.abs(m.position.z-a.z)<.01);window.colorObjectId=root.userData.locationObjectId;window.materialBefore=root.children.find(c=>c.isMesh).material.userData.darkBaseColor.toArray();return a.color})()`);
        assert.equal(await page.evaluate(`L.updateSelectedLocationAssetDetails({...colorAsset,x:colorAsset.x+.25})`),true);
        assert.equal(await page.evaluate(`L.updateSelectedLocationAssetDetails(colorAsset)`),true);
        for(const offset of [.25,0]){
            const target=await page.evaluate(`L.beginMoveSelectedLocationAsset();document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();({x:colorAsset.x+${offset},z:colorAsset.z})`);
            await click(await pointAt(target.x,1,target.z));
            await page.until(`Math.abs(L.getSelectedLocationEditorAsset().x-${target.x})<.01`,'mouse transform persisted');
        }
        for(const [code,key] of [['KeyQ','q'],['KeyE','e']]){
            await page.call('Input.dispatchKeyEvent',{type:'keyDown',code,key});await page.call('Input.dispatchKeyEvent',{type:'keyUp',code,key});await pause(500);
        }
        assert.equal(await page.evaluate('L.getSelectedLocationEditorAsset().color'),colorBefore,'precise transforms and Q/E retain material color');
        assert.equal(await page.evaluate(`(()=>{const root=shellRender.s.children.find(m=>m.userData.locationObjectId===colorObjectId);return JSON.stringify(root.children.find(c=>c.isMesh).material.userData.darkBaseColor.toArray())===JSON.stringify(materialBefore)})()`),true,'actual material tint survives movement');
        assert.ok(await page.evaluate(`shellRender.s.children.filter(m=>m.userData.locationObject?.type==='roof').every(m=>m.children.every(c=>!c.isMesh||!c.visible))`),'shell roofs follow ordinary camera cutaway');
        // Restore the original camera before the existing draw and movement checks.
        await page.evaluate(`locationControls.target.set(8,1,8);locationControls.object.position.set(17,18,22);locationControls.update();true`);
        const floor=built.objects.find(o=>o.type==='floor'&&o.properties.level===0);
        await request(`${api}/locations/objects/${floor.id}`,{properties:{color:'#ac9872'}},token,'PATCH');
        await peer.until(`shellUpdates.some(d=>JSON.stringify(d).includes('#ac9872'))`,'manual edit delivered to second client');
        await page.evaluate(`L.setLocationViewLevel(-1);true`);await pause(500);
        await page.evaluate(`L.setLocationViewLevel(1);true`);await pause(500);
        await page.evaluate(`L.setLocationViewLevel(0);true`);
        // Repeating at the same site must preserve every object and the manual edit.
        await draw();
        await page.evaluate(`document.querySelector('[data-shell-preview]').click();document.querySelector('dialog form').requestSubmit(document.querySelector('[data-shell-create]'));true`);
        await page.until(`document.body.innerText.includes('На этом месте уже есть')`,'overlap refused');
        const after=await detail();assert.equal(after.objects.length,built.objects.length);
        assert.equal(after.objects.find(o=>o.id===floor.id).properties.color,'#ac9872');
        const actor=await request(`${api}/characters`,{name:'Shell climber',data:{}},token);
        const g=built.objects[0].properties.building_generation;
        await request(`${api}/locations/${loc.id}/spawn_character`,{character_id:actor.id,tile_x:g.minX+1,tile_y:g.minZ+1},token);
        await page.evaluate(`window.shellMoves=[];window.shellRejects=[];socket.on('character_moved',d=>shellMoves.push(d));socket.on('movement_rejected',d=>shellRejects.push(d));L.setLocationEditMode(false);true`);
        const move=async(x,y,level)=>{
            await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:${x},y:${y},floor_level:${level}});true`);
            await page.until(`shellMoves.at(-1)?.x===${x}&&shellMoves.at(-1)?.y===${y}&&shellMoves.at(-1)?.floor_level===${level}`,'generated ladder movement');
            await pause(600);
        };
        await move(g.minX+2,g.minZ+2,-1);
        await move(g.minX+1,g.minZ+1,0);
        await move(g.minX+1,g.minZ+1,1);
        assert.equal(await page.evaluate('shellRejects.length'),0);
        const retained=await detail();
        if(process.env.VTT_SHELL_INSPECT==='1'){
            await page.evaluate(`L.setLocationViewLevel(-1);true`);await pause(800);
            fs.writeFileSync(path.join(os.tmpdir(),'vtt-shell-basement.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
            await page.evaluate(`L.setLocationViewLevel(1);locationControls.object.position.set(${g.minX+8},12,${g.minZ+10});locationControls.target.set(${g.minX+4},3.4,${g.minZ+4});locationControls.update();true`);await pause(800);
            fs.writeFileSync(path.join(os.tmpdir(),'vtt-shell-created.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        }
        await page.evaluate('window.shellReloadMarker=true;true');
        await page.call('Page.reload');
        await page.until('!window.shellReloadMarker&&window.enterLocation&&window.socket?.connected&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','reload');
        await page.evaluate(`(async()=>{window.T=await import('three');const old=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);if(window.isLocationActive)window.shellRender={r,s,c}}});return old.apply(this,roots)};await enterLocation(${loc.id})})()`);await page.until('!!(window.isLocationActive&&window.shellRender)','room re-entry');
        assert.deepEqual((await detail()).objects.map(o=>o.id).sort(),retained.objects.map(o=>o.id).sort());
        // A second, free area previews a different shape, wealth and ruin geometry.
        await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');L.setLocationEditMode(true);selectLocationEditorTool('assets');
            const T=await import('three');
            locationControls.target.set(17,1,17);locationControls.object.position.set(26,18,31);locationControls.update();
            document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();
            document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();window.T=T})()`);
        await pause(700);
        await draw(13.5,22.5);
        await page.evaluate(`(()=>{const f=document.querySelector('dialog form');f.elements.shape.value='C';f.elements.width.value=10;f.elements.depth.value=10;f.elements.wealth.value='poor';f.elements.condition.value='ruins';f.elements.shape.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-shell-preview]').click()})()`);
        if(process.env.VTT_SHELL_INSPECT==='1'){
            await pause(700);
            fs.writeFileSync(path.join(os.tmpdir(),'vtt-shell-ruins.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        }
        await page.evaluate(`document.querySelector('dialog').close();true`);
        assert.equal((await detail()).objects.length,after.objects.length,'cancelled ruin preview persists nothing');
        await page.evaluate(`window.fixChanges=[];socket.on('location_objects_changed',d=>fixChanges.push(d));L.setLocationViewLevel(-2);selectLocationEditorTool('erase');document.getElementById('loc-erase-structures').checked=true;L.setLocationBrushRadius(0);L.setLocationEraserMode(true);
            locationControls.target.set(3.2,-3.8,3.2);locationControls.object.position.set(12.2,7.2,14.2);locationControls.update();document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();true`);
        const beforeErase=await detail();
        await click(await pointAt(3.2,-3.8,3.2));
        await page.until('fixChanges.some(d=>d.deleted_ids.length)','eraser batch');
        await pause(500);
        const erased=await detail();
        assert.ok(erased.objects.length<beforeErase.objects.length);
        const erasedIds=new Set(erased.objects.map(o=>o.id));
        assert.ok(beforeErase.objects.filter(o=>!erasedIds.has(o.id)).every(o=>o.properties.level===-2),'eraser preserves every other floor');
        await peer.until('shellBatchesReceived.length>=2','peer receives atomic eraser change');
        await page.evaluate(`window.confirm=()=>true;L.setLocationEraserMode(false);window.dispatchEvent(new CustomEvent('location-editor-active-building',{detail:{buildingId:${JSON.stringify(buildingId)},level:-2}}));document.querySelector('[data-floor-delete]').click();true`);
        await pause(500);
        assert.ok((await detail()).objects.every(o=>o.properties.level!==-2),'floor delete removes one basement');
        assert.equal(await page.evaluate('L.deleteSelectedLocationBuilding(true)'),false,'occupied building deletion is rejected');
        await request(`${api}/locations/${loc.id}/characters/${actor.id}`,null,token,'DELETE');
        await page.evaluate(`document.querySelector('[data-building-delete]').click();true`);
        await pause(500);
        assert.equal((await detail()).objects.length,0,'whole building deleted in one operation');
        await peer.until(`L.getLocationBuildingIds().length===0`,'whole deletion synchronized to peer');
        const emptyAgain=await detail();
        assert.deepEqual(emptyAgain.tiles_data,built.tiles_data,'deletion preserves saved terrain');
        for(const kind of ['flat','shed','gable']){
            const id=`acceptance-${kind}`;
            const count=await page.evaluate(`(async()=>{const G=await import('/static/js/locationHouseGenerator.js'),A=await import('/static/js/api.js');
                const plan=G.planBuildingShell({minX:2,minZ:2,width:10,depth:10,shape:'L',storeys:2,basements:0,roofType:'${kind}',condition:'damaged',buildingId:'${id}',seed:'shell',groundHeight:()=>1});
                if(plan.error)throw Error(plan.error);const change=await A.Server.changeLocationObjects(${lobby.id},${loc.id},{objects:plan.objects});L.applyLocationObjectsChange(change);
                L.setLocationViewLevel(0);L.setLocationEditMode(true);locationControls.target.set(5,1,5);locationControls.object.position.set(9,8,11);locationControls.update();return plan.objects.filter(o=>o.type==='roof').length})()`);
            assert.ok(count>0);
            await pause(300);
            assert.ok(await page.evaluate(`shellRender.s.children.filter(m=>m.userData.locationObject?.type==='roof').every(m=>m.children.every(c=>!c.isMesh||!c.visible))`),`${kind} roof cutaway in game`);
            await page.evaluate(`window.dispatchEvent(new CustomEvent('location-editor-active-building',{detail:{buildingId:'${id}',level:0}}));true`);
            assert.equal(await page.evaluate('L.deleteSelectedLocationBuilding(true)'),true);
        }
        console.log('BUILDING FIX PASS',JSON.stringify({pointerLevels:[-2,-1,0,1,2],floorIsolation:true,color:true,roofCutaway:true,atomicDelete:true,occupiedDeleteBlocked:true}));
        console.log('BUILDING SHELL PASS',JSON.stringify({objects:built.objects.length,levels:[-2,-1,0,1],transport:'websocket',preview:true,manualEdit:true,reload:true,overlapPreserved:true,characterMovement:true}));
    } finally {peer.close();await page.call('Target.closeTarget',{targetId:target.targetId});}
};

async function runFloorFix2({page,request,token,lobby,loc}) {
    const url=`/lobbies/${lobby.id}/locations/${loc.id}`;
    const specs=[];
    for(const level of [-2,-1,0,1,2])specs.push({name:`Floor ${level}`,type:'floor',tile_x:8,tile_y:8,
        properties:{building_id:'fix2',level,roof_enabled:false,dimensions:{width:10,depth:10,height:.12}}});
    specs.push({name:'Neighbor floor',type:'floor',tile_x:19,tile_y:19,properties:{building_id:'neighbor',level:3,roof_enabled:false,dimensions:{width:2,depth:2,height:.12}}});
    const saved=(await request(url+'/objects/batch',{objects:specs},token)).objects;
    await page.evaluate(`L.setLocationEditMode(false);locationControls.target.set(8,1,8);locationControls.object.position.set(18,15,22);locationControls.update();true`);
    const aim=(x,y,z)=>page.evaluate(`(()=>{const p=new T.Vector3(${x},${y},${z}).project(locationControls.object),r=shellRender.r.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const click=async point=>{await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(120);for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...point});};
    for(const level of [-2,-1,0,1,2]) {
        await page.evaluate(`L.setLocationViewLevel(${level});true`);await pause(200);
        const point=await aim(7.98,1.035+level*2.4,8.02);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(150);
        const actual=await page.evaluate('L.getHoveredTileCoords()');
        console.log('FIX2 POINTER',JSON.stringify({level,actual,expected:{x:7,z:8}}));
        assert.deepEqual(actual,{x:7,z:8},`normal game cursor at level ${level}`);
        const inside=await page.evaluate(`(()=>{const h=shellRender.s.children.find(m=>m.isMesh&&m.material?.color?.getHex()===0xffaa00&&m.geometry?.parameters?.width===1),r=shellRender.r.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((${point.x}-r.left)/r.width*2-1,-(${point.y}-r.top)/r.height*2+1),locationControls.object);const p=ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),-h.position.y),new T.Vector3());return {inside:Math.abs(p.x-h.position.x)<=.5&&Math.abs(p.z-h.position.z)<=.5,x:h.position.x,z:h.position.z,y:h.position.y}})()`);
        assert.equal(inside.inside,true,`cursor lies inside visible yellow cell on level ${level}: ${JSON.stringify(inside)}`);
        assert.equal(inside.x,7.5);assert.equal(inside.z,8.5);
        assert.ok(await page.evaluate(`document.getElementById('location-tile-info').innerText.includes('(7, 8)')`));
        await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('assets');L.setLocationAssetPreset('wall');window.dispatchEvent(new CustomEvent('location-editor-active-building',{detail:{buildingId:'fix2',level:${level}}}));document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();true`);
        await click(point);await pause(200);
        const wall=(await request(url,null,token,'GET')).objects.find(o=>o.type==='wall');
        assert.ok(wall,`actual placement on level ${level}`);
        assert.deepEqual([wall.tile_x,wall.tile_y,wall.properties.level],[7,8,level]);
        assert.deepEqual(await page.evaluate('L.getHoveredTileCoords()'),{x:7,z:8});
        await request(url+'/objects/batch',{object_ids:[wall.id],level},token,'DELETE');
        await page.evaluate(`selectLocationEditorTool('select');document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();true`);
        await click(point);
        assert.equal(await page.evaluate('L.getSelectedLocationEditorAsset()?.level'),level,'selection uses the same floor surface');
        await page.evaluate('L.setLocationEditMode(false);true');
    }
    // Repeat with a lower, rotated ordinary game camera and an off-center cell.
    await page.evaluate('locationControls.target.set(8,1,8);locationControls.object.position.set(19,10,18);locationControls.update();true');
    for(const level of [-2,-1,0,1,2]){
        await page.evaluate(`L.setLocationViewLevel(${level});true`);await pause(150);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...await aim(8.8,1.035+level*2.4,7.2)});await pause(150);
        assert.deepEqual(await page.evaluate('L.getHoveredTileCoords()'),{x:8,z:7},`rotated camera on level ${level}`);
    }
    await page.evaluate(`window.fix2Changes=[];socket.on('location_objects_changed',d=>fix2Changes.push(d));window.confirmCount=0;window.confirm=()=>{confirmCount++;return true};L.setLocationEditMode(true);selectLocationEditorTool('assets');L.clearLocationAssetPreset();true`);
    for(const level of [-2,-1,0,1,2]){
        await page.evaluate(`L.setLocationViewLevel(${level});window.dispatchEvent(new CustomEvent('location-editor-active-building',{detail:{buildingId:'fix2',level:${level}}}));true`);
        const blocked=[-1,0,1].includes(level);
        assert.equal(await page.evaluate('document.querySelector("[data-floor-delete]").disabled'),blocked,`delete button for level ${level}`);
        if(blocked){
            assert.ok(await page.evaluate('document.querySelector("[data-floor-delete-reason]").innerText.length>0'));
            await page.evaluate('document.querySelector("[data-floor-delete]").click();true');
            assert.equal(await page.evaluate('L.deleteSelectedLocationBuilding(false)'),false);
            const status=await page.evaluate(`(async()=>{const r=await fetch('${url}/objects/batch',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('access_token')},body:JSON.stringify({building_id:'fix2',level:${level}})});const body=await r.json();return {status:r.status,error:body.error}})()`);
            assert.equal(status.status,409);assert.ok(status.error);
        }
    }
    assert.equal(await page.evaluate('confirmCount'),0,'blocked actions never ask for confirmation');
    assert.deepEqual((await request(url,null,token,'GET')).objects.map(o=>o.id),saved.map(o=>o.id),'blocked deletion keeps all data');
    for(const level of [2,-2]){
        await page.evaluate(`L.setLocationViewLevel(${level});window.dispatchEvent(new CustomEvent('location-editor-active-building',{detail:{buildingId:'fix2',level:${level}}}));document.querySelector('[data-floor-delete]').click();true`);
        const id=saved.find(o=>o.properties.building_id==='fix2'&&o.properties.level===level).id;
        await page.until(`fix2Changes.some(c=>c.deleted_ids.includes(${id}))`,'allowed outer storey deleted');
        const remaining=(await request(url,null,token,'GET')).objects;
        assert.ok(remaining.every(o=>o.id!==id));
        assert.ok(remaining.some(o=>o.properties.level===0&&o.properties.building_id==='fix2'));
    }
    for(const level of [1,-1]){
        await page.evaluate(`L.setLocationViewLevel(${level});window.dispatchEvent(new CustomEvent('location-editor-active-building',{detail:{buildingId:'fix2',level:${level}}}));true`);
        assert.equal(await page.evaluate('document.querySelector("[data-floor-delete]").disabled'),false,'new outermost floor becomes available');
    }
    assert.equal(await page.evaluate('confirmCount'),2);
    assert.equal(await page.evaluate('L.deleteSelectedLocationBuilding(true)'),true,'base level may be removed with its whole building');
    const final=(await request(url,null,token,'GET')).objects;
    assert.ok(final.every(o=>o.properties.building_id==='neighbor'));
    console.log('BUILDING FIX2 PASS',JSON.stringify({levels:[-2,-1,0,1,2],cameras:2,hover:true,highlight:true,coordinates:true,placement:true,floorDeletePolicy:true}));
}

async function runApertureRegression({page,request,token,lobby,loc}) {
    const url=`/lobbies/${lobby.id}/locations/${loc.id}`;
    const objects=await page.evaluate(`(async()=>{const G=await import('/static/js/locationHouseGenerator.js');return G.planBuildingShell({minX:2,minZ:2,width:10,depth:10,shape:'L',storeys:2,basements:2,wealth:'ordinary',condition:'intact',roofType:'gable',buildingId:'aperture',seed:'joint',groundHeight:()=>1}).objects})()`);
    const saved=(await request(url+'/objects/batch',{objects},token)).objects;
    await page.evaluate(`L.setLocationEditMode(false);L.setLocationViewLevel(0);locationControls.target.set(4.5,1,4.5);locationControls.object.position.set(10,8,12);locationControls.update();true`);
    await pause(700);
    const below=await page.evaluate(`shellRender.s.children.filter(m=>m.userData.locationObject?.properties.level<0).map(m=>({id:m.userData.locationObjectId,visible:m.visible}))`);
    assert.ok(below.length&&below.every(m=>m.visible),'basement meshes are available behind the opening');
    for(const [x,y,z] of [[6.5,7,7.5],[2,7,7]]) {
        await page.evaluate(`locationControls.object.position.set(${x},${y},${z});locationControls.update();true`);await pause(300);
        const colors=await page.evaluate(`(()=>{const {r,s,c}=shellRender,gl=r.getContext(),size=r.getDrawingBufferSize(new T.Vector2());
            const opening=s.children.find(m=>m.userData.locationObject?.type==='floor_opening'&&m.userData.locationObject.properties.level===0);
            const q=new T.Vector3(opening.position.x,1.035,opening.position.z).project(c);
            const px=Math.floor((q.x+1)*size.x/2),py=Math.floor((q.y+1)*size.y/2),pixel=()=>{r.render(s,c);const a=new Uint8Array(4);gl.readPixels(px,py,1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);return Array.from(a)};
            const visible=pixel(),basement=s.children.filter(m=>m.userData.locationObject?.properties.level<0),states=basement.map(m=>m.visible);
            basement.forEach(m=>m.visible=false);const hidden=pixel();basement.forEach((m,i)=>m.visible=states[i]);r.render(s,c);return {visible,hidden}})()`);
        console.log('APERTURE PIXEL',JSON.stringify({camera:[x,y,z],...colors}));
        if(JSON.stringify(colors.visible)===JSON.stringify(colors.hidden))console.log('APERTURE RAYS',await page.evaluate(`(()=>{const {r,s,c}=shellRender,opening=s.children.find(m=>m.userData.locationObject?.type==='floor_opening'&&m.userData.locationObject.properties.level===0),q=new T.Vector3(opening.position.x,1.035,opening.position.z).project(c),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(q.x,q.y),c);return ray.intersectObjects(s.children,true).slice(0,20).map(h=>{let root=h.object;while(root.parent&&root.parent!==s)root=root.parent;return {rootType:root.userData.locationObject?.type,level:root.userData.locationObject?.properties.level,rootVisible:root.visible,visible:h.object.visible,opacity:h.object.material?.opacity,distance:h.distance,point:h.point.toArray(),material:h.object.material?.type}})})()`));
        assert.notDeepEqual(colors.visible,colors.hidden,'rendered opening contains basement geometry rather than an empty background');
    }
    const seam=await page.evaluate(`(()=>{const floors=shellRender.s.children.filter(m=>m.userData.locationObject?.type==='floor'&&m.userData.locationObject.properties.level===0);
        return [3.2,3.5,4,4.5,5].flatMap(x=>[5.99,6,6.01].map(z=>{const ray=new T.Raycaster(new T.Vector3(x,2,z),new T.Vector3(0,-1,0));return {x,z,hits:ray.intersectObjects(floors,true).length}}))})()`);
    assert.ok(seam.every(p=>p.hits>0),'rendered floor meshes close the entire L-wing seam');
    await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('select');document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();locationControls.target.set(3.2,1,3.2);locationControls.object.position.set(9,8,11);locationControls.update();true`);
    await pause(300);
    const aim=async(x,y,z)=>page.evaluate(`(()=>{const p=new T.Vector3(${x},${y},${z}).project(locationControls.object),r=shellRender.r.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const point=await aim(3.2,1.035,3.2);
    await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(200);
    const highlightY=await page.evaluate(`shellRender.s.children.find(m=>m.isMesh&&m.material?.color?.getHex()===0xffaa00&&m.geometry?.parameters?.width===1).position.y`);
    assert.ok(Math.abs(highlightY-1.031)<1e-6,`floor zero highlight returned to its previous height, actual=${highlightY}, tile=${JSON.stringify(await page.evaluate('L.getHoveredTileCoords()'))}`);
    for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...point});
    assert.equal(await page.evaluate('L.getSelectedLocationEditorAsset()?.level'),0,'basement geometry cannot steal the surface selection');
    const reloaded=await request(url,null,token,'GET');
    assert.deepEqual(reloaded.objects.map(o=>o.id),saved.map(o=>o.id),'view fixes never change saved objects');
    console.log('APERTURE AND L-FLOOR PASS',JSON.stringify({cameras:2,basementPixels:true,seamSamples:seam.length,highlightZeroRestored:true,activeFloorSelection:true}));
}
