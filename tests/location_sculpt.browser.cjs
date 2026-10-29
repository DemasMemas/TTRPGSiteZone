// Isolated DB and real Chrome: VTT_LOC_SCULPT=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const api=`/lobbies/${lobby.id}`,size=Number(process.env.VTT_SCULPT_SIZE)||40;
    const tiles=Array.from({length:size},(_,z)=>Array.from({length:size},(_,x)=>({terrain:x>=size-5&&z<8?'water':process.env.VTT_SCULPT_GRASS==='1'?'grass':'bare_dirt',height:1,objects:[]})));
    const loc=await request(api+'/locations',{name:'Sculpt acceptance',world_tile_x:10,world_tile_z:10,grid_width:size,grid_height:size,tiles_data:tiles},token);
    const url=`${api}/locations/${loc.id}`,detail=()=>request(url,null,token,'GET');
    const objects=await request(url+'/objects/batch',{objects:[
        {name:'Anchor box',type:'box',tile_x:10,tile_y:10,properties:{dimensions:{width:1,depth:1,height:1}}},
        {name:'Distant floor',type:'floor',tile_x:26,tile_y:26,properties:{building_id:'sculpt-house',level:0,dimensions:{width:5,depth:5,height:.12},roof_enabled:true}},
        ...[
            [26,24,{offset_z:-.5}],[26,29,{offset_z:-.5}],
            [24,26,{offset_x:-.5,rotation:Math.PI/2}],[29,26,{offset_x:-.5,rotation:Math.PI/2}],
        ].map(([x,z,extra])=>({name:'House wall',type:'wall',tile_x:x,tile_y:z,properties:{building_id:'sculpt-house',level:0,dimensions:{width:5,depth:.18,height:2.4},...extra}})),
    ]},token);
    const actor=await request(api+'/characters',{name:'Sculpt walker',data:{}},token);
    await request(url+'/spawn_character',{character_id:actor.id,tile_x:12,tile_y:10},token);
    const mount=async(client)=>{
        await client.call('Page.bringToFront');
        await client.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.T=await import('three');window.UI=await import('/static/js/ui_interactions.js');
            const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){if(roots.some(r=>r.userData.locationObjectId))window.sculptScene=this;return add.apply(this,roots)};
            await enterLocation(${loc.id});})()`);
        await client.until('window.sculptScene&&window.selectLocationEditorTool&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','real location');
        await client.evaluate(`L.setLocationEditMode(true);locationControls.target.set(${size/2},1,${size/2});locationControls.object.position.set(${size/2},${size*.85},${size*1.1});locationControls.update();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();UI.collapseMapToolsPanel()`);
    };
    await mount(page);
    if(process.env.VTT_SCULPT_GRASS==='1')await page.until('getLocationGrassDiagnostics().assets==="loaded"','natural grass ready');
    const point=async(x,z,y=1)=>page.evaluate(`(()=>{locationControls.object.updateMatrixWorld(true);const v=new T.Vector3(${x},${y},${z}).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
    let pointer;
    const move=async(x,z,y=1,buttons=1)=>{pointer=await point(x,z,y);await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...pointer,button:buttons?'left':'none',buttons});};
    const press=async(x,z,y=1)=>{await move(x,z,y,0);await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...pointer,button:'left',buttons:1,clickCount:1});};
    const idle=()=>page.until('!L.getLocationEditorHistoryState().busy','stroke saved');
    const release=async()=>{await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...pointer,button:'left',buttons:0,clickCount:1});await idle();assert.equal(await page.evaluate('sculptScene.children.filter(r=>r.userData.sculptRegion).length'),0,'temporary regions released');};
    const configure=async(mode,radius=3,strength=1)=>{
        await page.evaluate(`(()=>{selectLocationEditorTool('height');L.setLocationBrushRadius(${radius});UI.expandMapToolsPanel();const m=document.getElementById('loc-height-mode');m.value='${mode}';m.dispatchEvent(new Event('change',{bubbles:true}));L.setLocationSculptSettings({strength:${strength}});document.activeElement.blur();UI.collapseMapToolsPanel()})()`);
    };
    const key=async(code,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key:code==='Escape'?'Escape':code.slice(3).toLowerCase(),modifiers});await idle();};
    const objectY=()=>page.evaluate(`sculptScene.children.find(m=>m.userData.locationObjectId===${objects.objects[0].id}).position.y`);
    const frames=async()=>page.evaluate(`(async()=>{const samples=[];let previous=performance.now();const until=previous+800;await new Promise(resolve=>{const step=now=>{samples.push(now-previous);previous=now;if(now<until)requestAnimationFrame(step);else resolve()};requestAnimationFrame(step)});samples.sort((a,b)=>a-b);return {fps:1000/(samples.reduce((s,v)=>s+v,0)/samples.length),p95:samples[Math.floor(samples.length*.95)]}})()`);
    const baseline=await frames();
    const initial=await detail(),initialY=await objectY();
    const distant=await page.evaluate(`sculptScene.children.find(m=>m.userData.locationObjectId===${objects.objects[1].id}).uuid`);
    await configure('raise');await press(10.5,10.5);
    const hold=await frames();
    assert.ok(await objectY()>initialY+.3,'object follows visible terrain before release');
    assert.ok(await page.evaluate('Number(document.querySelector("[data-sculpt-height]").textContent)')>1.3,'height readout changes while holding');
    assert.deepEqual((await detail()).tiles_data,initial.tiles_data,'no partial server save');
    assert.equal(await page.evaluate('L.getLocationEditorHistoryState().undo'),0);
    const diagnostics=await page.evaluate('L.getLocationSculptDiagnostics()');
    assert.ok(diagnostics?.regions>0&&diagnostics.cellsBuilt/diagnostics.builds<=100,'only local regions rebuilt');
    if(process.env.VTT_SCULPT_VIEW==='1')console.log('SCULPT_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:65})).data);
    await release();let hill=await detail();
    assert.ok(hill.tiles_data[10][10].height>1.5);
    assert.ok(hill.tiles_data[10][10].height>hill.tiles_data[10][12].height);
    assert.equal(await page.evaluate('L.getLocationEditorHistoryState().undo'),1);
    await key('KeyZ',2);assert.deepEqual((await detail()).tiles_data,initial.tiles_data);
    assert.ok(Math.abs(await objectY()-initialY)<1e-6);
    await key('KeyY',2);assert.deepEqual((await detail()).tiles_data,hill.tiles_data);
    await page.until(`Math.abs(sculptScene.children.find(r=>r.userData.characterId===${actor.id}).position.y-${hill.tiles_data[10][12].height})<1e-5`,'character follows terrain');
    await page.evaluate(`window.sculptMoves=[];window.sculptRejects=[];socket.on('character_moved',d=>sculptMoves.push(d));socket.on('movement_rejected',d=>sculptRejects.push(d));socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:12,y:11,floor_level:0});true`);
    await page.until('sculptMoves.length>0||sculptRejects.length>0','server slope movement');
    assert.equal(await page.evaluate('sculptMoves.at(-1)?.x'),12);
    const moved=await page.evaluate('sculptMoves.at(-1)');
    assert.ok(Math.abs(moved.height-hill.tiles_data[11][12].height)<1e-5,JSON.stringify(moved));
    await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:10,y:10,floor_level:0});true`);
    await page.until('sculptRejects.length>0','box still blocks movement');
    console.log('SCULPT hill/history',JSON.stringify({baseline,hold,diagnostics}));
    assert.equal(await page.evaluate(`sculptScene.children.find(m=>m.userData.locationObjectId===${objects.objects[1].id}).uuid`),distant);
    await configure('lower',3,2);await press(20.5,10.5);await pause(1100);await release();
    let crater=await detail();assert.ok(crater.tiles_data[10][20].height<0,'depression crosses zero without a base-plane lid');
    await configure('raise',3,3);await press(5.5,20.5);
    const movingStart=performance.now();
    await page.evaluate(`window.sculptFrames=[];window.sculptMeasuring=true;window.sculptLast=performance.now();requestAnimationFrame(function sample(now){sculptFrames.push(now-sculptLast);sculptLast=now;if(sculptMeasuring)requestAnimationFrame(sample)})`);
    for(let x=6.5;x<=22.5;x+=.5){await move(x,20.5);await pause(50);}
    const movingMs=performance.now()-movingStart;const moving=await page.evaluate(`(()=>{sculptMeasuring=false;const a=sculptFrames.toSorted((a,b)=>a-b);return{fps:1000/(a.reduce((s,v)=>s+v,0)/a.length),p95:a[Math.floor(a.length*.95)]}})()`);await release();
    let bank=await detail();assert.ok(bank.tiles_data[20].slice(6,23).every(t=>t.height>1.05),'continuous embankment has no gaps');
    await configure('smooth',3,3);const peakBefore=bank.tiles_data[10][10].height;
    await press(10.5,10.5,peakBefore);await pause(1100);await release();
    assert.ok((await detail()).tiles_data[10][10].height<peakBefore-.1,'smoothing lowers peak');
    // Crossing the local preview's 8m boundary and the outer map boundary.
    await configure('raise',3);await press(.5,.5);await pause(350);await move(8.5,.5);await pause(350);await release();
    const edge=await detail();assert.ok(edge.tiles_data[0][0].height>1&&edge.tiles_data[0][8].height>1);
    await configure('lower',3);await press(size-5.5,4.5);await pause(300);await release();
    const shore=await detail();for(let z=0;z<8;z++)for(let x=size-5;x<size;x++)assert.deepEqual(shore.tiles_data[z][x],initial.tiles_data[z][x]);
    // Floor, wall and roof continue to follow their existing terrain anchors.
    const buildingPose=()=>page.evaluate(`(()=>{const floor=sculptScene.children.find(r=>r.userData.locationObjectId===${objects.objects[1].id}),roof=sculptScene.children.find(r=>r.userData.roofPlan?.floorId===${objects.objects[1].id});return{floor:floor.position.y,roof:roof?new T.Box3().setFromObject(roof).max.y:null}})()`);
    const buildingBefore=await buildingPose();
    assert.ok(buildingBefore.roof!==null,'test building has a real roof');
    await page.evaluate("document.getElementById('location-grid-btn').click()");
    await configure('raise',4,1.5);await press(26.5,26.5);await pause(350);
    const floorGrid=await page.evaluate(`(()=>{const grid=sculptScene.children.find(r=>r.userData.tileByVertex?.some(v=>v.floorId===${objects.objects[1].id}));return grid?grid.userData.tileByVertex.flatMap((v,i)=>v.floorId===${objects.objects[1].id}?[grid.geometry.attributes.position.getY(i)]:[]):[]})()`);
    assert.ok(floorGrid.length&&floorGrid.every(y=>y>1.1),'floor grid follows during the stroke');
    await release();
    await page.evaluate("document.getElementById('location-grid-btn').click()");
    const buildingAfter=await buildingPose();assert.ok(buildingAfter.floor>buildingBefore.floor+.1);assert.ok(buildingAfter.roof>buildingBefore.roof+.1);
    await key('KeyZ',2);assert.deepEqual(await buildingPose(),buildingBefore);await key('KeyY',2);
    // Esc rolls back all local edits and creates no history entry.
    const beforeCancel=await detail(),count=await page.evaluate('L.getLocationEditorHistoryState().undo');
    await configure('raise');await press(16.5,16.5);await pause(250);await key('Escape');await release();
    assert.deepEqual((await detail()).tiles_data,beforeCancel.tiles_data);assert.equal(await page.evaluate('L.getLocationEditorHistoryState().undo'),count);
    // Keep the original precise tool available.
    await configure('exact',0);await page.evaluate('L.setLocationBrushHeight(1.234567)');await press(3.5,14.5);await release();
    assert.equal((await detail()).tiles_data[14][3].height,1.234567);
    const saved=await detail();
    console.log('SCULPT shapes/boundaries/cancel/exact passed',JSON.stringify({moving}));
    const target=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();const peer=await connect(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    try{
        await peer.until('window.enterLocation&&window.socket?.connected','peer connected');await mount(peer);
        await page.call('Page.bringToFront');
        await peer.evaluate('window.sculptEvents=[];socket.on("location_editor_objects_changed",d=>sculptEvents.push(d));true');
        await configure('raise',2);await press(10.5,10.5,saved.tiles_data[10][10].height);await pause(350);await release();
        await peer.until(`Math.abs(sculptScene.children.find(m=>m.userData.locationObjectId===${objects.objects[0].id}).position.y-${await objectY()})<1e-5`,'peer sees sculpt');
        await key('KeyZ',2);await peer.until(`Math.abs(sculptScene.children.find(m=>m.userData.locationObjectId===${objects.objects[0].id}).position.y-${saved.tiles_data[10][10].height})<1e-5`,'peer sees undo');
        assert.deepEqual((await detail()).tiles_data,saved.tiles_data);
        await key('KeyY',2);
        assert.equal(await peer.evaluate('socket.io.engine.transport.name'),'websocket');
    }finally{peer.close();await page.call('Target.closeTarget',{targetId:target.targetId});await page.call('Page.bringToFront');}
    const final=await detail();
    await page.evaluate(`exitLocation();void enterLocation(${loc.id})`);
    await page.until('window.isLocationActive&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','reloaded terrain');
    assert.deepEqual((await detail()).tiles_data,final.tiles_data);
    await page.until(`Math.abs(sculptScene.children.find(m=>m.userData.locationObjectId===${objects.objects[0].id}).position.y-${final.tiles_data[10][10].height})<1e-5`,'object anchored after reload');
    await configure('raise');
    await page.evaluate('UI.expandMapToolsPanel()');
    for(const [width,height] of [[1366,768],[640,720]]){
        await page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        const layout=await page.evaluate(`(()=>{const p=document.querySelector('#panel-tools .panel-content');return{width:p.clientWidth,scroll:p.scrollWidth,mode:document.getElementById('loc-height-mode').value,exact:document.getElementById('loc-edit-height').parentElement.hidden}})()`);
        assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout));assert.equal(layout.exact,true);
        if(process.env.VTT_SCULPT_VIEW==='1'&&width===1366)console.log('SCULPT_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:65})).data);
    }
    await page.call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
    if(process.env.VTT_SCULPT_VIEW==='1'){
        await page.evaluate(`L.setLocationEditMode(false);UI.collapseMapToolsPanel();locationControls.target.set(15,1,14);locationControls.object.position.set(28,22,35);locationControls.update()`);
        for(const angle of [0,1]){
            if(angle)await page.evaluate('locationControls.object.position.set(4,18,31);locationControls.update()');
            await pause(400);console.log('SCULPT_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:65})).data);
        }
    }
    console.log('SCULPT PASS',JSON.stringify({size,baseline,hold,moving,movingMs,diagnostics,hill:hill.tiles_data[10][10].height,crater:crater.tiles_data[10][20].height,history:true,peer:true,reload:true}));
};
