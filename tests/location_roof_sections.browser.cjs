const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const read=n=>fs.readFileSync(path.join(__dirname,'../app/static/js',n),'utf8');
    const core=url(read('locationRoofSections.js'));
    const {planBuildingShell,planResidentialHouse}=await import(url(read('locationHouseGenerator.js').replace("'./locationRoofSections.js'",`'${core}'`)));
    const api=`/lobbies/${lobby.id}`;
    const cases=[...['flat','shed','gable'].map(roofType=>({name:`rectangle-${roofType}`,shape:'rectangle',roofType})),
        ...['T','compound','L','U','C','cross'].map(shape=>({name:shape,shape,roofType:'gable'})),
        {name:'mixed',shape:'custom',roofType:'gable',bodies:[{x:0,z:0,width:8,depth:10,storeys:2,type:'gable'},{x:8,z:2,width:4,depth:6,storeys:1,type:'shed',direction:'east'}]},
        {name:'damaged',shape:'L',roofType:'gable',condition:'damaged'},
        {name:'ruins',shape:'C',roofType:'gable',condition:'ruins'}, {name:'legacy',legacy:true}];
    const filter=process.env.VTT_ROOF_CASES?.split(',');
    const saved=[];
    await page.evaluate(`(async()=>{window.T=await import('three');window.L=await import('/static/js/locationScene.js');
        const old=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...a){before.call(this,r,s,c,...a);if(isLocationActive)window.roofRender={r,s,c}}});return old.apply(this,roots)}})()`);
    for(const spec of cases.filter(c=>!filter||filter.includes(c.name))) {
        const tiles=Array.from({length:18},(_,z)=>Array.from({length:18},(_,x)=>({terrain:'bare_dirt',height:spec.name==='mixed'?1+(x%3)*.07:1,objects:[]})));
        const loc=await request(`${api}/locations`,{name:`Roof ${spec.name}`,world_tile_x:12,world_tile_z:12,grid_width:18,grid_height:18,tiles_data:tiles},token);
        const plan=spec.legacy?planResidentialHouse({minX:4,minZ:4,width:8,depth:8,buildingId:`roof-${loc.id}`}):planBuildingShell({minX:2,minZ:2,width:12,depth:12,storeys:1,basements:spec.name==='mixed'?1:0,
            condition:'intact',seed:'roof-audit',buildingId:`roof-${loc.id}`,roofPitch:25,...spec,groundHeight:(x,z)=>tiles[z]?.[x]?.height||1});
        assert.equal(plan.error,undefined,JSON.stringify(plan));
        const objects=[];
        for(const object of plan.objects)objects.push(await request(`${api}/locations/${loc.id}/objects`,object,token));
        saved.push({loc,objects,spec});
        await page.evaluate(`window.enterLocation(${loc.id});true`);
        await page.until(`window.isLocationActive&&window.locationControls&&window.selectLocationEditorTool&&window.roofRender?.s.children.some(o=>o.userData.locationObjectId===${objects.at(-1).id})`,'roof scene '+spec.name);
        await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('select');
            document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();
            locationControls.target.set(8,3,8);locationControls.object.position.set(23,19,25);locationControls.update();true`);
        await pause(500);
        if(process.env.VTT_ROOF_INSPECT==='1'){
            const file=path.join(os.tmpdir(),`vtt-roof-${spec.name}-top.png`);fs.writeFileSync(file,Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
            await page.evaluate(`locationControls.object.position.set(25,8,19);locationControls.update();true`);await pause(400);
            fs.writeFileSync(path.join(os.tmpdir(),`vtt-roof-${spec.name}-side.png`),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        }
        console.log('ROOF CASE',spec.name,objects.length);
    }
    const legacy=saved.find(c=>c.spec.legacy);
    if(legacy) {
        await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('select');document.getElementById('location-roof-btn').click();
            locationControls.target.set(8,1,8);locationControls.object.position.set(8,25,8.1);locationControls.update();true`);
        await pause(400);
        const aim=await page.evaluate(`(()=>{const p=new T.Vector3(8,1.035,8).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...aim});await pause(150);
        for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...aim});
        await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='floor'`,'legacy floor');
        await page.evaluate(`document.querySelector('[data-generate-roof]').click();true`);
        await page.until(`!!document.querySelector('dialog[open] [name=type]')`,'replacement confirmation');
        await page.evaluate(`const f=document.querySelector('dialog[open] form');f.elements.type.value='shed';f.elements.pitch.value=12;f.requestSubmit(f.querySelector('button[value=create]'));true`);
        await page.until(`document.body.innerText.includes('Крыша создана: секции доступны')`,'legacy roof converted');
        const after=(await request(`${api}/locations/${legacy.loc.id}`,null,token,'GET')).objects;
        assert.ok(legacy.objects.every(o=>after.some(a=>a.id===o.id)),'legacy objects retained');
        assert.ok(after.some(o=>o.type==='roof'&&o.properties.roof_section.bodies[0].type==='shed'));
        assert.ok(after.filter(o=>o.type==='floor').every(o=>o.properties.roof_enabled===false));
        assert.ok(after.filter(o=>o.properties.generated_floor_spec).every(o=>o.properties.generated_floor_spec.properties.roof_enabled===false),'floor restoration cannot restore a duplicate automatic roof');
        console.log('LEGACY ROOF REPLACEMENT PASS');
    }
    const target=saved.find(c=>c.spec.name==='rectangle-gable');
    if(!target){console.log('ROOF GEOMETRY PASS');return;}
    await page.evaluate(`window.enterLocation(${target.loc.id});true`);
    await page.until(`roofRender?.s.children.some(o=>o.userData.locationObjectId===${target.objects.at(-1).id})`,'edit scene');
    await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('select');document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();
        if(document.getElementById('location-roof-btn').getAttribute('aria-pressed')==='false')document.getElementById('location-roof-btn').click();
        locationControls.target.set(8,3,8);locationControls.object.position.set(20,18,23);locationControls.update();true`);
    const section=target.objects.find(o=>o.type==='roof'&&o.tile_x>=5&&o.tile_x<=9&&o.tile_y>=5&&o.tile_y<=9);
    await pause(500);
    const terrainSignature=await page.evaluate(`roofRender.s.children.filter(o=>o.isMesh&&!o.userData.locationObjectId&&o.geometry?.attributes?.position).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0]?.geometry.uuid`);
    const point=await page.evaluate(`(()=>{const root=roofRender.s.children.find(o=>o.userData.locationObjectId===${section.id});let child;root.traverse(o=>{if(o.isMesh&&!child)child=o});
        const p=child.geometry.attributes.position,a=new T.Vector3();for(let i=0;i<3;i++)a.add(new T.Vector3().fromBufferAttribute(p,i));a.multiplyScalar(1/3);child.localToWorld(a);a.project(locationControls.object);
        const r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(a.x+1)*r.width/2,y:r.top+(1-a.y)*r.height/2}})()`);
    await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    await pause(250);
    for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...point});
    await page.until(`L.getSelectedLocationEditorAsset()?.roofSection`,'roof picked through normal editor');
    await page.evaluate(`document.querySelector('[data-roof-section-fields]').open=true;document.querySelector('[data-roof-setting="pitch"]').value=35;document.querySelector('[data-roof-setting="type"]').value='shed';document.querySelector('[data-roof-setting="direction"]').value='north';document.querySelector('[data-roof-apply]').click();true`);
    await page.until(`L.getSelectedLocationEditorAsset()?.roofSection?.pitch===35`,'manual slope saved');
    const detail=()=>request(`${api}/locations/${target.loc.id}`,null,token,'GET');
    let after=await detail();
    await page.until(`!L.getSelectedLocationEditorAsset()?.roofEditing`,'roof edits completed');
    // The selected section is deleted by the ordinary inspector action.
    await page.evaluate(`document.querySelector('[data-asset-action="delete"]').click();true`);
    await page.until(`!L.getSelectedLocationEditorAsset()`,'section deleted');
    after=await detail();assert.equal(after.objects.length,target.objects.length-1);
    assert.ok(after.objects.filter(o=>o.type==='roof').every(o=>o.properties.roof_section.bodies[0].pitch===35));
    const deleted=new Set(target.objects.map(o=>o.id).filter(id=>!after.objects.some(o=>o.id===id)));assert.equal(deleted.size,1);
    const wallPoint=await page.evaluate(`(()=>{const v=new T.Vector3(9,1.35,14).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
    await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...wallPoint});await pause(200);
    for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...wallPoint});
    await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='wall'`,'manual wall selection');
    await page.evaluate(`const input=document.querySelector('[data-selected-dimension="height"]');input.value=2.7;input.dispatchEvent(new Event('change',{bubbles:true}));true`);
    await page.until(`L.getSelectedLocationEditorAsset()?.dimensions.height===2.7&&!L.getSelectedLocationEditorAsset()?.roofEditing`,'manual wall height saved');
    after=await detail();
    assert.equal(after.objects.length,target.objects.length-1,'body changes preserve deleted roof sections');
    assert.ok(after.objects.filter(o=>o.type==='roof').every(o=>o.properties.roof_section.bodies[0].basePlane?.some(v=>v!==0)));
    assert.equal(await page.evaluate(`roofRender.s.children.filter(o=>o.isMesh&&!o.userData.locationObjectId&&o.geometry?.attributes?.position).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0]?.geometry.uuid`),terrainSignature,'roof editing does not rebuild terrain');
    const tab=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();const peer=await connect(tabs.find(t=>t.id===tab.targetId).webSocketDebuggerUrl);
    try{
        await peer.call('Page.bringToFront');await peer.until('window.enterLocation&&socket?.connected&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','peer ready');
        await peer.evaluate(`window.roofUpdates=[];socket.on('location_object_updated',d=>roofUpdates.push(d));socket.on('joined_location',d=>window.roofJoined=d);window.enterLocation(${target.loc.id});true`);
        await peer.until(`window.roofJoined?.location_id===${target.loc.id}`,'peer room');await peer.until(`socket.io.engine.transport.name==='websocket'`,'peer WebSocket');
        await page.call('Page.bringToFront');await page.until(`socket.io.engine.transport.name==='websocket'`,'GM WebSocket');
        const remaining=after.objects.find(o=>o.type==='roof');
        await request(`${api}/locations/objects/${remaining.id}`,{properties:{color:'#74796a'}},token,'PATCH');
        await peer.until(`roofUpdates.some(d=>d.object?.id===${remaining.id}&&d.object.properties.color==='#74796a')`,'roof sync');
        await page.evaluate('window.roofReload=true;true');await page.call('Page.reload');
        await page.until('!window.roofReload&&window.enterLocation&&window.socket?.connected','reload');
        const reloaded=await detail();assert.deepEqual(reloaded.objects.map(o=>o.id),after.objects.map(o=>o.id));
        assert.ok(reloaded.objects.filter(o=>o.type==='roof').every(o=>o.properties.roof_section.bodies[0].pitch===35));
        console.log('ROOF EDIT/SAVE/WEBSOCKET PASS',JSON.stringify({cases:saved.length,deleted:1,slope:35,manualWallHeight:2.7,terrainPreserved:true}));
    }finally{peer.close();await page.call('Target.closeTarget',{targetId:tab.targetId});}
};
