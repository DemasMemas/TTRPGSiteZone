const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
 const out=path.resolve('docs/asset-previews/household');fs.mkdirSync(out,{recursive:true});
 const api=`/lobbies/${lobby.id}`,objects=[];
 const loc=await request(api+'/locations',{name:'Furniture validation',world_tile_x:10,world_tile_z:10,grid_width:22,grid_height:22,tiles_data:Array.from({length:22},()=>Array.from({length:22},()=>({terrain:'bare_dirt',height:1,objects:[]})))},token);
 const add=async(type,x,z,properties={})=>{const o=await request(`${api}/locations/${loc.id}/objects`,{name:type,type,tile_x:Math.floor(x),tile_y:Math.floor(z),properties:{...properties,offset_x:x-Math.floor(x)-.5,offset_z:z-Math.floor(z)-.5}},token);objects.push(o);return o};
 for(const [x,z]of [[6,6],[15,6],[6,15],[15,15]]){
  await add('floor',x,z,{dimensions:{width:7,depth:7,height:.12},color:'#776d5d',visual_asset:'art_aged_wood'});
  await add('wall',x,z-3.5,{dimensions:{width:7,depth:.16,height:2.7},color:'#969283'});
  await add('wall',x-3.5,z,{dimensions:{width:7,depth:.16,height:2.7},rotation:Math.PI/2,color:'#969283'});
 }
 const layout=[['bed_double',4.2,5.5],['nightstand',5.45,4.8],['wardrobe',8.3,3.5],['dresser',8.3,5.4],['armchair',7.8,7.5],['floor_rug',6.8,6.1],['wall_rug',6.3,2.6,.7],['refrigerator',12.3,3.4],['cooker',13.2,3.4],['sink',14.4,3.4],['kitchen_cabinet',15.5,3.4],['wall_shelf',14.5,2.72,1.15],['dining_table',14.5,6.4],['wood_chair',14.5,7.3],['bed_single',4.1,15.5],['wood_stove',7.8,12.5],['stool',7.4,15.6],['wood_crate',7.9,17.3],['storage_rack',12.4,12.3],['generator',15.5,12.7],['old_computer',14.4,15.5,.76],['desk_lamp',13.5,15.5,.76],['cardboard_box',12.4,17],['jerrycan',16.3,12.7]];
 const assets=await page.evaluate(`(async()=>{const c=await import('/static/js/locationAssetCatalog.js');return c.LOCATION_ASSETS.filter(a=>a.visual?.family==='household')})()`);assert.equal(assets.length,29);
 assert.deepEqual([...new Set(assets.map(a=>a.group))].sort(),['Декор','Кухня и быт','Мебель','Техника','Сантехника'].sort());
 assert.ok(assets.every(a=>a.label&&!a.label.includes('?')));
 for(const [short,x,z,elevation=0]of layout){const a=assets.find(a=>a.id==='household_'+short);await add(a.id,x,z,{dimensions:{width:a.dimensions[0],depth:a.dimensions[1],height:a.dimensions[2]},color:a.color,elevation})}
 await add('household_dining_table',14.4,15.5,{dimensions:{width:1.7,depth:.8,height:.76}});
 await page.evaluate(`window.W=sceneModule;window.T=threeModule;const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;const old=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){old.call(this,r,s,c,...args);if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return add.apply(this,roots)};window.enterLocation(${loc.id})`);
 await page.until(`window.isLocationActive&&!!window.localRender&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'furnished location');
 await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.lookHouse=(x,y,z,tx,ty,tz)=>{locationControls.target.set(tx,ty,tz);locationControls.object.position.set(x,y,z);locationControls.update();locationControls.object.updateMatrixWorld(true)};document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click()})()`);
 const modelChecks=await page.evaluate(`(async()=>{const {createHouseholdModel}=await import('/static/js/locationHouseholdModels.js'),{LOCATION_ASSETS}=await import('/static/js/locationAssetCatalog.js');return LOCATION_ASSETS.filter(a=>a.visual?.family==='household').map(a=>{const d={width:a.dimensions[0],depth:a.dimensions[1],height:a.dimensions[2]},m=createHouseholdModel(T,a,d),n=createHouseholdModel(T,a,d);const box=new T.Box3().setFromObject(m),size=box.getSize(new T.Vector3());const row={id:a.id,triangles:m.geometry.attributes.position.count/3,sharedGeometry:m.geometry===n.geometry,sharedTexture:[].concat(m.material)[0].map===[].concat(n.material)[0].map,independentTint:m.material!==n.material,bottom:box.min.y,size:size.toArray()};for(const material of [...[].concat(m.material),...[].concat(n.material)])material.dispose();return row})})()`);
 for(const m of modelChecks){assert.ok(m.sharedGeometry&&m.sharedTexture&&m.independentTint);assert.ok(Math.abs(m.bottom-(m.id==='household_wood_crate'?.01:0))<1e-5);assert.ok(m.triangles<1500)}
 for(const [name,cam]of [['living',[12,9,14,6,1,6]],['kitchen',[21,9,14,15,1,6]],['rural',[12,10,22,6,1,15]],['technical',[21,10,22,15,1,15]],['technical-close',[18,5,19,14.5,1.9,15.5]],['overview',[28,29,34,10,1,10]]]){
  await page.evaluate(`lookHouse(${cam.join(',')});new Promise(r=>setTimeout(r,1000))`);
  fs.writeFileSync(path.join(out,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 await page.evaluate(`lookHouse(21,9,14,15,1,6);window.selectLocationEditorTool('assets');L.setLocationAssetPreset('household_wall_shelf');document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
 const aim=await page.evaluate(`(()=>{const r=localRender.renderer.domElement.getBoundingClientRect(),p=new T.Vector3(16.7,1,2.72).project(localRender.camera);return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
 await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...aim});
 await page.until(`(()=>{let found=false;localRender.scene.traverse(m=>{if(m.userData.householdAssetId==='household_wall_shelf'&&m.material?.transparent)found=true});return found})()`,'wall shelf preview');
 await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...aim,button:'left',buttons:1,clickCount:1});
 await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...aim,button:'left',buttons:0,clickCount:1});
 await page.until(`(async()=>{const r=await fetch('${api}/locations/${loc.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('access_token')}});return (await r.json()).objects.filter(o=>o.type==='household_wall_shelf').length===2})()`,'wall shelf pointer placement');
 const placed=await request(`${api}/locations/${loc.id}`,null,token,'GET');const shelf=placed.objects.filter(o=>o.type==='household_wall_shelf').at(-1);
 assert.equal(shelf.properties.passable,true);assert.equal(shelf.properties.rotation,0);assert.ok(Math.abs(shelf.tile_y+.5+shelf.properties.offset_z-2.718)<.001);
 await page.evaluate(`window.selectLocationEditorTool('select')`);
 const target=objects.find(o=>o.type==='household_nightstand');
 await page.evaluate(`lookHouse(12,9,14,6,1,6);document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
 const pick=await page.evaluate(`(()=>{const root=localRender.scene.children.find(m=>m.userData.locationObjectId===${target.id}),center=new T.Box3().setFromObject(root).getCenter(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return {x:r.left+(center.x+1)*r.width/2,y:r.top+(1-center.y)*r.height/2}})()`);
 await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...pick});
 await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...pick,button:'left',buttons:1,clickCount:1});
 await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...pick,button:'left',buttons:0,clickCount:1});
 await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='household_nightstand'`,'new furniture picking');
 assert.equal(await page.evaluate(`L.updateSelectedLocationAssetDetails({x:5.65,z:4.85,elevation:.03,rotation:35,dimensions:{width:.6,depth:.5,height:.65}})`),true);
 const edited=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.equal(edited.objects.find(o=>o.id===target.id).properties.dimensions.width,.6);
 await page.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await page.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
 const tabsBefore=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
 const peerTarget=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
 const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();const peer=await connect(tabs.find(t=>t.id===peerTarget.targetId).webSocketDebuggerUrl);
 try{
  await peer.until('Boolean(window.enterLocation&&window.socket?.connected)','peer startup');await peer.evaluate(`window.enterLocation(${loc.id})`);await peer.until('window.isLocationActive','peer location');await peer.evaluate('new Promise(r=>setTimeout(r,1400))');
  const update={properties:{...target.properties,rotation:.7,dimensions:{width:.6,depth:.5,height:.65},offset_x:.2,elevation:.03}};
  await request(`${api}/locations/objects/${target.id}`,update,token,'PATCH');
  await peer.until(`(async()=>{const c=await import('/static/js/locationScene.js');return true})()`,'peer module');
  // Observe the actual second scene, rather than another REST read.
  await peer.evaluate(`(async()=>{const T=await import('three');const old=T.Scene.prototype.add;window.peerSeen=[];T.Scene.prototype.add=function(...roots){for(const r of roots)if(r.userData.locationObject)peerSeen.push(r.userData.locationObject);return old.apply(this,roots)}})()`);
  update.properties.rotation=1.1;await request(`${api}/locations/objects/${target.id}`,update,token,'PATCH');
  await peer.until(`peerSeen.some(o=>o.id===${target.id}&&o.properties.rotation===1.1)`,'second-client furniture update');
 }finally{peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId});}
 await page.call('Page.bringToFront');
 const saved=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.equal(saved.objects.find(o=>o.id===target.id).properties.rotation,1.1);
 await page.call('Page.reload');await page.until('Boolean(window.enterLocation)','reload startup');
 await page.evaluate(`(async()=>{window.T=await import('three');window.W=await import('/static/js/lobby3d.js');const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;const old=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){old.call(this,r,s,c,...args);if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return add.apply(this,roots)}})()`);
 await page.until("W.chunksMap.size===2&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'world ready before reload entry');
 await page.evaluate(`window.enterLocation(${loc.id})`);
 await page.until('window.isLocationActive&&!!window.localRender','reload location');
 const reload=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.equal(reload.objects.length,saved.objects.length);
 const deletion=await fetch(`${base}${api}/locations/objects/${target.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});assert.equal(deletion.status,204);
 const remaining=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.ok(!remaining.objects.some(o=>o.id===target.id));
 // Renderer captured again after reload; use the module's installed hook.
 await page.until('!!window.localRender','local renderer after reload');
 const performance=await page.evaluate(`(async()=>{
  const L=await import('/static/js/locationScene.js');const {renderer:r,scene:s,camera:c}=localRender;
  locationControls.target.set(10,1,10);c.position.set(22,24,29);locationControls.update();
  const sample=async()=>{
   const times=[];for(let i=0;i<15;i++){const t=window.performance.now();r.render(s,c);if(i>4)times.push(window.performance.now()-t)}
   const fps=await new Promise(resolve=>{let start=null,count=0;const tick=t=>{if(start===null)start=t;else count++;if(t-start<1200)requestAnimationFrame(tick);else resolve(count*1000/(t-start))};requestAnimationFrame(tick)});
   return {fps,cpuMs:times.reduce((a,b)=>a+b)/times.length,calls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures};
  };
  await new Promise(r=>setTimeout(r,500));const before=await sample();
  const started=window.performance.now();for(let i=0;i<400;i++)L.addLocationObject({id:-1000-i,type:'household_wood_chair',tile_x:Math.floor(3+i%20*.7),tile_y:Math.floor(3+Math.floor(i/20)*.7),properties:{offset_x:(3+i%20*.7)%1-.5,offset_z:(3+Math.floor(i/20)*.7)%1-.5,dimensions:{width:.45,depth:.48,height:.88}}});
  const buildMs=window.performance.now()-started;await new Promise(r=>setTimeout(r,500));const after=await sample();
  return {before,after,buildMs,shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
 })()`);
 assert.equal(performance.shaderErrors,0);assert.ok(performance.after.calls-performance.before.calls<=400);
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({models:modelChecks,performance,wallPointerPlacement:true,selectionAndTransform:true,saveReload:true,secondClient:true,delete:true},null,2));console.log('HOUSEHOLD PASS',JSON.stringify(performance));
};
