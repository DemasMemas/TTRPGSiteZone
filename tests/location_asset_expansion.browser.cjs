const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {modules,fixture}=require('./location_furniture_fixture.cjs');
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const {C}=await modules(),assets=C.LOCATION_ASSETS.filter(a=>a.visual?.modelId&&['household_','nature_'].some(prefix=>a.id===prefix+a.visual.modelId));
    const api=`/lobbies/${lobby.id}`,pause=ms=>new Promise(r=>setTimeout(r,ms));
    const loc=await request(api+'/locations',{name:'Asset expansion acceptance',world_tile_x:9,world_tile_z:9,grid_width:64,grid_height:80,
        tiles_data:Array.from({length:80},()=>Array.from({length:64},()=>({terrain:'bare_dirt',height:1,objects:[]})))},token);
    const url=`${api}/locations/${loc.id}`;
    const specs=assets.map((a,i)=>({type:a.id,name:a.label,tile_x:4+(i%8)*6,tile_y:4+Math.floor(i/8)*5,
        properties:{dimensions:{width:a.dimensions[0],depth:a.dimensions[1],height:a.dimensions[2]},passable:a.passable,
            elevation:.01,level:0,is_on:false}}));
    await request(url+'/objects/batch',{objects:specs},token);
    await page.evaluate(`(async()=>{window.T=await import('three');window.L=await import('/static/js/locationScene.js');
        const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;
            const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);if(window.isLocationActive)window.expandedRender={r,s,c}}});return add.apply(this,roots)};
        socket.on('joined_location',d=>window.expandedJoined=d);await enterLocation(${loc.id});true})()`);
    await page.until('!!window.expandedRender','real scene rendered');
    const modelReport=await page.evaluate(`(()=>{const roots=expandedRender.s.children.filter(m=>m.userData.locationObjectId),errors=[],vertices=[];
        for(const root of roots){const model=root.children.find(c=>c.userData.householdAssetId);if(!model){errors.push(root.userData.locationObject.type);continue;}
            const p=model.geometry.attributes.position,n=model.geometry.attributes.normal;
            if([...p.array,...n.array].some(v=>!Number.isFinite(v)))errors.push(model.userData.householdAssetId+':nonfinite');
            vertices.push([model.userData.householdAssetId,p.count]);}
        return {errors,count:roots.length,vertices}})()`);
    assert.deepEqual(modelReport.errors,[]);assert.equal(modelReport.count,assets.length);
    assert.ok(modelReport.vertices.every(([,n])=>n>60&&n<30000));
    assert.deepEqual(await page.evaluate(`(()=>{const errors=[];for(const id of ['household_monument_ruined','household_broken_boards','household_rubble']){
        const root=expandedRender.s.children.find(m=>m.userData.locationObject?.type===id),model=root.children.find(m=>m.userData.householdAssetId),p=model.geometry.attributes.position;
        const bottom=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getY(i))<1e-5)bottom.push([p.getX(i),p.getZ(i)]);
        if(bottom.length<3||Math.max(...bottom.map(v=>v[0]))-Math.min(...bottom.map(v=>v[0]))<.35||Math.max(...bottom.map(v=>v[1]))-Math.min(...bottom.map(v=>v[1]))<.35)errors.push(id);
    }return errors})()`),[],'models have distributed ground contacts');
    const frame=async(name,x,z,y=12)=>{
        await page.evaluate(`L.setLocationEditMode(false);document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();locationControls.target.set(${x},1,${z});locationControls.object.position.set(${x+(y-1)*.6},${y},${z+(y-1)*.9});locationControls.update();true`);
        await pause(200);const file=path.join(os.tmpdir(),`vtt-expanded-${name}.png`);
        fs.writeFileSync(file,Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));console.log('EXPANSION FRAME',file);
    };
    for(const [name,x,z,y]of [['appliances',12,6,9],['dishes',22,11,7],['furniture',12,16,9],['utilities',12,26,9],['shop',27,31,10],['rubble',20,44,10],['tower',11,14,21]])await frame(name,x,z,y);
    for(const id of ['tv_crt','tv_flat','plate','fork','glass','washing_machine','gas_boiler','rubble','fallen_tree','sandbag_wall','street_lamp']) {
        const i=assets.findIndex(a=>a.id==='household_'+id),a=assets[i];
        await frame(id,4.5+(i%8)*6,4.5+Math.floor(i/8)*5,Math.max(2.3,a.dimensions[2]*1.6+2));
    }
    for(const id of ['household_monument','household_monument_ruined','household_street_bench','household_workbench','household_road_sign','household_dumpster',
        'household_car_sedan','household_car_van','household_car_burned','household_downpipe',
        'nature_oak_green','nature_birch_dry','nature_pine_dead','nature_bush_green','nature_tall_grass_dry']){
        const i=assets.findIndex(a=>a.id===id),a=assets[i];
        await frame(id,4.5+(i%8)*6,4.5+Math.floor(i/8)*5,Math.max(3,a.dimensions[2]*1.5+2));
    }
    // Verify actual renderer reuse rather than only counting saved records.
    for(const id of ['household_monument_ruined','household_broken_boards','household_rubble','household_bed_single',
        'nature_oak_green','nature_birch_dry','nature_pine_green','nature_bush_green']){
        const i=assets.findIndex(a=>a.id===id);if(i<0)continue;const a=assets[i];
        await frame(id,4.5+(i%8)*6,4.5+Math.floor(i/8)*5,Math.max(3,a.dimensions[2]*1.5+2));
    }
    if(process.env.VTT_ASSET_FRAMES_ONLY==='1')return;
    assert.equal(await page.evaluate(`(async()=>{const {createHouseholdModel}=await import('/static/js/locationHouseholdModels.js'),{findLocationAsset}=await import('/static/js/locationAssetCatalog.js');
        const a=findLocationAsset('household_fork'),d={width:.035,depth:.2,height:.012},one=createHouseholdModel(T,a,d),two=createHouseholdModel(T,a,d);
        const ok=one.geometry===two.geometry&&one.material!==two.material;one.material.dispose();two.material.dispose();return ok})()`),true);
    // Tiny standalone fork placement uses the ordinary tool and survives reload.
    await page.evaluate(`(async()=>{L.setLocationEditMode(true);selectLocationEditorTool('assets');const {findLocationAsset}=await import('/static/js/locationAssetCatalog.js');
        L.setLocationAssetPreset(findLocationAsset('household_fork'));locationControls.target.set(53,1,58);locationControls.object.position.set(53,8,64);locationControls.update();
        document.getElementById('panel-tools').style.visibility='hidden';true})()`);
    await pause(200);
    const point=await page.evaluate(`(()=>{const p=new T.Vector3(53.5,1,58.5).project(locationControls.object),r=expandedRender.r.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,...point,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:1});
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObject?.type==='household_fork'&&m.userData.locationObject.tile_x===53)`,'fork manually placed');
    await page.evaluate(`L.clearLocationAssetPreset();document.getElementById('panel-tools').style.visibility='';true`);
    const saved=await request(url,null,token,'GET');
    assert.equal(saved.objects.find(o=>o.type==='household_fork'&&o.tile_x===53).properties.dimensions.height,.012);
    const lamp=saved.objects.find(o=>o.type==='household_street_lamp');
    await request(`${api}/locations/objects/${lamp.id}`,{properties:{...lamp.properties,is_on:true}},token,'PATCH');
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId===${lamp.id}&&m.userData.locationObject.properties.is_on===true)`,'street lamp switch sync');
    const light=await page.evaluate(`(async()=>{const F=await import('/static/js/locationFixtures.js');return F.electricFixtureLightSource(expandedRender.s.children.find(m=>m.userData.locationObjectId===${lamp.id}).userData.locationObject)})()`);
    assert.ok(light.height>4&&light.distance===12);
    await page.evaluate(`(async()=>{exitLocation();await enterLocation(${loc.id});return true})()`);
    await page.until(`expandedRender.s.children.filter(m=>m.userData.locationObjectId).length===${assets.length+1}`,'all assets survive reload');
    if(process.env.VTT_ASSET_PLACEMENT_ONLY!=='1') {
    const target=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json(),peer=await connect(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    try {
        await peer.until('window.enterLocation&&window.socket?.connected','peer ready');
        await peer.evaluate(`(async()=>{const T=await import('three');const add=T.Scene.prototype.add;
            T.Scene.prototype.add=function(...roots){if(roots.some(m=>m.userData.locationObjectId))window.expandedPeerScene=this;return add.apply(this,roots)};
            await enterLocation(${loc.id});return true})()`);
        await peer.until(`window.expandedPeerScene?.children.filter(m=>m.userData.locationObjectId).length===${assets.length+1}`,'peer sees every new model');
        const fork=saved.objects.find(o=>o.type==='household_fork'&&o.tile_x===53);
        await request(`${api}/locations/objects/${fork.id}`,{properties:{...fork.properties,offset_x:.125,color:'#7d7463'}},token,'PATCH');
        await peer.until(`expandedPeerScene.children.some(m=>m.userData.locationObjectId===${fork.id}&&m.userData.locationObject.properties.offset_x===.125)`,'new fork edits reach second client');
        assert.equal(await peer.evaluate('socket.io.engine.transport.name'),'websocket');
    } finally {peer.close();await page.call('Target.closeTarget',{targetId:target.targetId}).catch(()=>{});await page.call('Page.bringToFront');}
    }
    console.log('EXPANDED MODELS PASS',JSON.stringify({count:assets.length,vertices:modelReport.vertices.reduce((s,[,n])=>s+n,0),forkPlaced:true,lampSwitched:true}));
    // Exercise the real pointer path on a raised floor and a table, including
    // preview movement down again, saved offsets and a full scene reload.
    const supportSpecs=[
        {type:'floor',tile_x:54,tile_y:64,properties:{dimensions:{width:8,depth:8,height:.12},elevation:.3,roof_enabled:false,level:0}},
        {type:'table',tile_x:54,tile_y:64,properties:{dimensions:{width:2,depth:2,height:1},elevation:.335,level:0}},
        {type:'wall',tile_x:59,tile_y:64,properties:{dimensions:{width:4,depth:.18,height:2.4},level:0}}
    ];
    const support=await request(url+'/objects/batch',{objects:supportSpecs.map(o=>({...o,name:o.type}))},token);
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId===${support.objects[1].id})`,'table support loaded');
    await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('assets');locationControls.target.set(55,1,65);locationControls.object.position.set(55,11,73);locationControls.update();document.getElementById('panel-tools').style.visibility='hidden';true`);
    const hover=async(id,x,y,z,place=false)=>{
        await page.evaluate(`(async()=>{if(window.surfaceTestAsset!=='${id}'){const {findLocationAsset}=await import('/static/js/locationAssetCatalog.js');L.setLocationAssetPreset(findLocationAsset('${id}'));window.surfaceTestAsset='${id}';}return true})()`);
        const p=await page.evaluate(`(()=>{const p=new T.Vector3(${x},${y},${z}).project(locationControls.object),r=expandedRender.r.domElement.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p,button:'none'});await pause(120);
        const preview=await page.evaluate(`(()=>{const m=expandedRender.s.children.findLast(m=>!m.userData.locationObjectId&&(m.userData.locationObject?.type==='${id}'||'${id}'==='tent'&&m.children.some(c=>c.material?.opacity===.55)));return m?{x:m.position.x,y:m.position.y,z:m.position.z}:null})()`);
        if(place)for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,...p,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});
        return preview;
    };
    const onTable=await hover('household_plate',54.5,2.335,64.5,true);
    assert.ok(onTable&&Math.abs(onTable.y-2.335)<.02,JSON.stringify(onTable));
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId&&m.userData.locationObject.type==='household_plate'&&m.userData.locationObject.tile_y===64)`,'plate placed on table');
    const onFloor=await hover('household_plate',56.5,1.335,64.5,true);
    assert.ok(onFloor&&Math.abs(onFloor.y-1.335)<.02,JSON.stringify(onFloor));
    const onGround=await hover('household_plate',62.5,1,67.5);
    assert.ok(onGround&&Math.abs(onGround.y-1)<.02,JSON.stringify(onGround));
    const pipe=await hover('household_downpipe',59.5,1,64.85,true);
    assert.ok(pipe,'tall downpipe has a wall-mounted preview');
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId&&m.userData.locationObject.type==='household_downpipe'&&m.userData.locationObject.tile_y>=64)`,'downpipe placed');
    const placed=await request(url,null,token,'GET');
    const plates=placed.objects.filter(o=>o.type==='household_plate'&&o.tile_y===64);
    assert.equal(plates.length,2);assert.ok(plates.some(o=>Math.abs(o.properties.elevation-1.335)<.02));
    assert.ok(plates.some(o=>Math.abs(o.properties.elevation-.335)<.02));
    await page.evaluate(`L.clearLocationAssetPreset();exitLocation();enterLocation(${loc.id});true`);
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId===${plates[0].id})`,'surface placement survives reload');
    await frame('table-placement',55,64,5);
    const upperSupport=await request(url+'/objects/batch',{objects:[
        {name:'Upper floor',type:'floor',tile_x:54,tile_y:64,properties:{building_id:'support-test',dimensions:{width:8,depth:8,height:.12},roof_enabled:false,level:1}},
        {name:'Upper table',type:'table',tile_x:54,tile_y:64,properties:{building_id:'support-test',dimensions:{width:2,depth:2,height:1},elevation:.035,level:1}}
    ]},token);
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId===${upperSupport.objects[1].id})`,'upper table loaded');
    await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('assets');L.setLocationViewLevel(1);document.querySelector('[data-placement-level]').value='1';document.querySelector('[data-placement-building-id]').value='support-test';window.surfaceTestAsset=null;locationControls.target.set(55,3.4,65);locationControls.object.position.set(55,13,73);locationControls.update();document.getElementById('panel-tools').style.visibility='hidden';true`);
    const upperTable=await hover('household_plate',54.5,4.435,64.5,true);
    assert.ok(upperTable&&Math.abs(upperTable.y-4.435)<.02,JSON.stringify(upperTable));
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId&&m.userData.locationObject.type==='household_plate'&&m.userData.locationObject.properties.level===1)`,'plate saved on upper table');
    const upperSaved=(await request(url,null,token,'GET')).objects.find(o=>o.type==='household_plate'&&o.properties.level===1);
    assert.equal(upperSaved.properties.building_id,'support-test');assert.ok(Math.abs(upperSaved.properties.elevation-1.035)<.02);
    const upperBox=await hover('box',54.9,4.435,64.2,true);
    assert.ok(upperBox&&Math.abs(upperBox.y-4.435)<.02,'GLB crate uses surface placement');
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObjectId&&m.userData.locationObject.type==='box')`,'GLB crate placed');
    const tent=await hover('tent',57.3,3.435,65.5,true);
    assert.ok(tent&&Math.abs(tent.y-3.435)<.02,JSON.stringify(tent));
    await page.until(`expandedRender.s.children.some(m=>m.userData.sourceObject?.type==='tent'&&m.userData.tileX===57)`,'legacy decor placed on upper floor');
    const decorSaved=(await request(url,null,token,'GET')).tiles_data[65][57].objects.find(o=>o.type==='tent');
    assert.equal(decorSaved.level,1);assert.ok(Math.abs(decorSaved.elevation-.035)<.02);
    console.log('SURFACE PLACEMENT PASS',JSON.stringify({onTable,onFloor,onGround,pipe}));
    if(process.env.VTT_ASSET_PLACEMENT_ONLY==='1')return;
    // The same existing persistence/replacement API accepts every new purpose.
    for(const buildingType of ['workshop','cafe','clinic','office','school','garage','bathhouse']) {
        const b=await request(api+'/locations',{name:buildingType,world_tile_x:10,world_tile_z:10,grid_width:20,grid_height:20,
            tiles_data:Array.from({length:20},()=>Array.from({length:20},()=>({terrain:'bare_dirt',height:1,objects:[]})))},token);
        const {source,plan}=await fixture({shellOptions:{width:16,depth:16,storeys:1,basements:0,buildingType,wealth:'rich'}});
        const target=`${api}/locations/${b.id}`;
        const architecture=await request(target+'/objects/batch',{objects:source.map(({id,revision,...o})=>o)},token);
        const p=(await fixture({source:architecture.objects})).plan;
        const result=await request(target+'/objects/batch',{objects:p.objects,replace_furniture:p.replacement},token);
        assert.ok(result.objects.length>0,buildingType);
        await page.evaluate(`(async()=>{exitLocation();await enterLocation(${b.id});return true})()`);
        await page.until(`expandedRender.s.children.filter(m=>m.userData.locationObjectId).length===${architecture.objects.length+result.objects.length}`,buildingType+' rendered');
        await frame(buildingType,10,10,15);
        console.log('EXPANDED PURPOSE PASS',JSON.stringify({buildingType,furniture:plan.objects.length,rooms:source.flatMap(o=>o.properties.layout_rooms||[]).map(r=>r.name)}));
    }
    await page.evaluate(`L.setLocationEditMode(true);selectLocationEditorTool('building');document.getElementById('loc-generate-furniture').click();true`);
    await page.until(`!!document.querySelector('dialog [name="role"]')`,'new room purpose selector');
    assert.ok(await page.evaluate(`['child','bath','toilet','laundry','boiler','classroom','treatment','dishwashing'].every(value=>[...document.querySelector('dialog [name="role"]').options].some(o=>o.value===value))`));
    await page.evaluate(`document.querySelector('dialog').close();true`);
    const bed=await request(api+'/locations',{name:'Bed foot blanket check',world_tile_x:11,world_tile_z:11,grid_width:10,grid_height:10,
        tiles_data:Array.from({length:10},()=>Array.from({length:10},()=>({terrain:'bare_dirt',height:1,objects:[]})))},token);
    await request(`${api}/locations/${bed.id}/objects/batch`,{objects:[{type:'household_bed_single',name:'Bed',tile_x:5,tile_y:5,
        properties:{dimensions:{width:.95,depth:2.05,height:.85},level:0,elevation:0}}]},token);
    await page.evaluate(`(async()=>{exitLocation();await enterLocation(${bed.id});return true})()`);
    await page.until(`expandedRender.s.children.some(m=>m.userData.locationObject?.type==='household_bed_single')`,'bed rendered');
    await frame('bed-foot',5.5,5.5,3);await frame('bed-foot-low',5.5,5.5,2.2);
};
