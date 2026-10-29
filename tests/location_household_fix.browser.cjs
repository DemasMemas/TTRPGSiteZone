// Real local renderer, isolated SQLite lobby. VTT_HOUSEHOLD_FIX=1 in the shared harness.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
 const surfaces=process.env.VTT_HOUSEHOLD_SURFACES==='1';
 const storage=process.env.VTT_HOUSEHOLD_STORAGE==='1';
 const out=path.resolve(storage?'.tmp-household-storage':surfaces?'.tmp-household-surfaces':process.env.VTT_PLUMBING_MATERIALS==='1'?'docs/asset-previews/plumbing-materials':'docs/asset-previews/household-fix');fs.mkdirSync(out,{recursive:true});
 const api=`/lobbies/${lobby.id}`,objects=[];
 const loc=await request(api+'/locations',{name:'Household fix validation',world_tile_x:10,world_tile_z:10,grid_width:22,grid_height:22,tiles_data:Array.from({length:22},()=>Array.from({length:22},()=>({terrain:'bare_dirt',height:1,objects:[]})))},token);
 const add=async(type,x,z,properties={})=>{
  const o=await request(`${api}/locations/${loc.id}/objects`,{name:type,type,tile_x:Math.floor(x),tile_y:Math.floor(z),properties:{...properties,offset_x:x-Math.floor(x)-.5,offset_z:z-Math.floor(z)-.5}},token);objects.push(o);return o;
 };
 for(const [x,z]of [[6,6],[15,6],[6,15]]){
  await add('floor',x,z,{dimensions:{width:7,depth:7,height:.1},visual_asset:'art_aged_wood',color:'#776d5d'});
  await add('wall',x,z-3.5,{dimensions:{width:7,depth:.16,height:2.5},color:'#969283'});
  await add('wall',x-3.5,z,{dimensions:{width:7,depth:.16,height:2.5},rotation:Math.PI/2,color:'#969283'});
 }
 const legacy=await add('table',4.5,5,{rotation:.22,dimensions:{width:1.5,depth:.85,height:.78},elevation:.04});
 await add('chair',4.6,6.2,{rotation:-.2,dimensions:{width:.48,depth:.51,height:.9},elevation:.04});
 const alias=await add('household_wood_chair',7.5,6.2,{rotation:.3,dimensions:{width:.5,depth:.5,height:.92},elevation:.04});
 await add('household_dining_table',7.5,5,{rotation:-.15,elevation:.04});
 const defaults=await add('table',5,8); // An old save without dimensions must keep its original defaults.
 await add('chair',7.5,8);
 for(const [id,x,z,r]of [['washbasin',13,3.5,0],['toilet',15,3.6,0],['bathtub',17,5,Math.PI/2]])
  await add('household_'+id,x,z,{rotation:r,elevation:.04});
 const crate=await add('household_wood_crate',5.5,14.7,{rotation:.35});
 await add('household_wood_crate',6.5,15.2,{rotation:-.3});
 let surfaceFixture;
 if(surfaces){
  surfaceFixture={sink:await add('household_sink',14,6),rug:await add('household_floor_rug',6,6),raised:await add('household_floor_rug',8,7,{elevation:.04}),bare:await add('household_floor_rug',20,20)};
 }
 const storageFixtures=[];
 if(storage){
  for(const [i,type]of ['nightstand','wardrobe','dresser','wall_shelf','storage_rack','refrigerator','cooker','kitchen_cabinet','sink','wood_stove','wood_crate','cardboard_box'].entries())
   storageFixtures.push(await add('household_'+type,12+i%4*2,12+Math.floor(i/4)*2,{interactions:[]}));
  await add('household_bed_single',4,14.5);await add('household_bed_double',7,14.5);
 }
 const original=JSON.parse(JSON.stringify(objects));
 const hook=`(async()=>{
  window.T=await import('three');window.W=await import('/static/js/lobby3d.js');window.L=await import('/static/js/locationScene.js');
  const old=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return old.apply(this,roots)};
  window.lookFix=(x,y,z,tx,ty,tz)=>{locationControls.target.set(tx,ty,tz);locationControls.object.position.set(x,y,z);locationControls.update();locationControls.object.updateMatrixWorld(true)};
  return true;
 })()`;
 await page.evaluate(hook);await page.evaluate(`window.enterLocation(${loc.id})`);
 await page.until(`window.isLocationActive&&!!window.localRender&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'fixture ready');
 await page.evaluate(`document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click()`);
 const models=await page.evaluate(`(async()=>{
  const {createHouseholdModel}=await import('/static/js/locationHouseholdModels.js'),{LOCATION_ASSETS:A}=await import('/static/js/locationAssetCatalog.js');
  const meshes=A.filter(a=>a.visual?.family==='household').map(a=>({a,m:createHouseholdModel(T,a,{width:a.dimensions[0],depth:a.dimensions[1],height:a.dimensions[2]})}));
  const rows=meshes.map(({a,m})=>{const box=new T.Box3().setFromObject(m),n=m.geometry.attributes.normal,base=[].concat(m.material)[0];
   let normalError=0;for(let i=0;i<n.count;i++)normalError=Math.max(normalError,Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1));
   return {id:a.id,bottom:box.min.y,top:box.max.y,size:box.getSize(new T.Vector3()).toArray(),triangles:m.geometry.attributes.position.count/3,finite:Array.from(m.geometry.attributes.position.array).every(Number.isFinite),normalError,roughness:base.roughness,metalness:base.metalness,textured:!!base.map,normalMapped:!!base.normalMap,bumpMapped:!!base.bumpMap,flatShading:base.flatShading}});
  const shared=meshes.find(p=>p.a.id==='table').m.geometry===meshes.find(p=>p.a.id==='household_dining_table').m.geometry&&meshes.find(p=>p.a.id==='chair').m.geometry===meshes.find(p=>p.a.id==='household_wood_chair').m.geometry;
  for(const {m}of meshes)for(const material of [].concat(m.material))material.dispose();return {rows,shared,expected:A.filter(a=>a.visual?.family==='household').length};
 })()`);
 assert.equal(models.rows.length,models.expected);assert.ok(models.expected>=29);assert.ok(models.shared);
 for(const m of models.rows){assert.ok(m.finite&&m.triangles>0&&m.triangles<10000,m.id);assert.ok(Math.abs(m.bottom-(m.id==='household_wood_crate'?.01:0))<1e-5,m.id);
  if(['household_washbasin','household_toilet','household_bathtub'].includes(m.id)){
   assert.ok(m.normalError<1e-5,m.id);assert.ok(!m.flatShading&&!m.textured&&!m.normalMapped&&!m.bumpMapped,m.id);assert.ok(m.roughness>=.2&&m.roughness<=.4);assert.equal(m.metalness,0);
  }else if(m.textured){assert.equal(m.roughness,.9,m.id);assert.equal(m.metalness,.03,m.id)}
  else if(m.id.startsWith('nature_')){assert.equal(m.roughness,1,m.id);assert.equal(m.metalness,0,m.id)}
  else{assert.equal(m.roughness,.5,m.id);assert.equal(m.metalness,.12,m.id)}
 }
 const bounds=await page.evaluate(`(()=>{const root=localRender.scene.children.find(r=>r.userData.locationObjectId===${defaults.id}),b=new T.Box3().setFromObject(root);return {position:root.position.toArray(),size:b.getSize(new T.Vector3()).toArray()}})()`);
 for(const [i,v]of [1.4,1,.8].entries())assert.ok(Math.abs(bounds.size[i]-v)<1e-5);
 assert.deepEqual(bounds.position,[5,1,8]);
 const crateBounds=await page.evaluate(`(()=>{const root=localRender.scene.children.find(r=>r.userData.locationObjectId===${crate.id});return {root:root.position.y,bottom:new T.Box3().setFromObject(root).min.y}})()`);
 assert.ok(Math.abs(crateBounds.bottom-crateBounds.root-.01)<1e-5);
 let surfaceChecks=null;
 if(surfaces){
  surfaceChecks=await page.evaluate(`(()=>{
   const root=id=>localRender.scene.children.find(m=>m.userData.locationObjectId===id);
   const rug=root(${surfaceFixture.rug.id}),raised=root(${surfaceFixture.raised.id}),bare=root(${surfaceFixture.bare.id}),sink=root(${surfaceFixture.sink.id});
   const cast=[];rug.traverse(m=>{if(m.isMesh)cast.push({cast:m.castShadow,receive:m.receiveShadow})});
   const n=rug.children[0].geometry.attributes.normal;let tilted=false;
   for(let i=0;i<n.count;i++)if(Math.abs(n.getY(i))>1e-5&&Math.abs(Math.abs(n.getY(i))-1)>1e-5)tilted=true;
   sink.updateMatrixWorld(true);const ray=new T.Raycaster(new T.Vector3(sink.position.x,5,sink.position.z),new T.Vector3(0,-1,0));
   const center=ray.intersectObject(sink,true)[0].point.y;
   ray.ray.origin.x+=.8*.3;const rim=ray.intersectObject(sink,true)[0].point.y;
   const glaze=sink.children[0].material[1];
   const rows={rugY:rug.position.y,raisedY:raised.position.y,bareY:bare.position.y,cast,tilted,bowlDepth:rim-center,glaze:{roughness:glaze.roughness,textured:!!glaze.map}};
   const floor={id:-90000,type:'floor',tile_x:20,tile_y:20,properties:{offset_x:-.5,offset_z:-.5,dimensions:{width:3,depth:2,height:.12},rotation:.45}};
   L.addLocationObject(floor);rows.addedFloorY=bare.position.y;
   L.updateLocationObject({...floor,properties:{...floor.properties,elevation:.2}});rows.raisedFloorY=bare.position.y;
   L.removeLocationObject(floor.id);rows.removedFloorY=bare.position.y;
   return rows;
  })()`);
  assert.ok(Math.abs(surfaceChecks.rugY-1.036)<1e-5);assert.ok(Math.abs(surfaceChecks.raisedY-1.04)<1e-5);
  assert.equal(surfaceChecks.bareY,1);assert.ok(surfaceChecks.cast.every(m=>!m.cast&&m.receive));assert.equal(surfaceChecks.tilted,false);
  assert.ok(surfaceChecks.bowlDepth>.08,JSON.stringify(surfaceChecks));
  assert.equal(surfaceChecks.glaze.textured,false);assert.equal(surfaceChecks.glaze.roughness,.28);
  assert.ok(Math.abs(surfaceChecks.addedFloorY-1.036)<1e-5);assert.ok(Math.abs(surfaceChecks.raisedFloorY-1.236)<1e-5);assert.equal(surfaceChecks.removedFloorY,1);
 }
 // Surface inspection images stay private in the temporary test directory.
 const cameras=storage?[['beds-inspection',[8,4.2,13,5.5,1.5,14.5]],['wardrobe-inspection',[16,4,15,14,2,12]]]:surfaces?[['sink-inspection',[16,2.7,8,14,1.6,6]],['rug-inspection',[8,3,9,6,1.05,6]]]:[['furniture',[12,9,14,6,1.4,6]],['furniture-close',[10.5,4.8,9,6.3,1.5,5.8]],['bathroom',[21,8,13,15.2,1.4,5]],['bathroom-close',[19.5,4.5,9,15.4,1.4,4.5]],['washbasin-detail',[14.1,2.15,5.2,13,1.55,3.5]],['toilet-detail',[16.1,2.1,5.1,15,1.5,3.6]],['bath-faucet-detail',[14.7,2.3,6.3,16.3,1.5,5]],['crate',[8,2.6,17.5,5.8,1.15,15]]];
 for(const [name,cam]of cameras){
  await page.evaluate(`lookFix(${cam.join(',')});new Promise(r=>setTimeout(r,900))`);
  fs.writeFileSync(path.join(out,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 if(storage){
  for(const object of storageFixtures){
   await page.evaluate(`lookFix(${object.tile_x+3},4,${object.tile_y+4},${object.tile_x},1.5,${object.tile_y});document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
   const point=await page.evaluate(`(()=>{const root=localRender.scene.children.find(r=>r.userData.locationObjectId===${object.id});root.updateMatrixWorld(true);const surface={household_wall_shelf:.35,household_storage_rack:1.728,household_wood_stove:.55}['${object.type}'];const p=(surface===undefined?new T.Box3().setFromObject(root).getCenter(new T.Vector3()):root.localToWorld(new T.Vector3(0,surface,0))).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
   await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
   await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'right',buttons:2,clickCount:1});
   await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'right',buttons:0,clickCount:1});
   await page.until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Открыть содержимое'&&b.getClientRects().length)`,'container action '+object.type);
   await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Открыть содержимое'&&b.getClientRects().length).click()`);
   await page.until(`!!document.querySelector('.container-exchange-body')?.getClientRects().length`,'container window '+object.type);
   await page.evaluate(`Array.from(document.querySelectorAll('.container-close-btn')).find(b=>b.getClientRects().length).click()`);
  }
 }
 if(surfaces){
  await page.evaluate(`window.selectLocationEditorTool('assets');lookFix(24,25,29,10,1,10);document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
  for(const [id,x,z,y]of [['household_sink',13,7,null],['household_floor_rug',6,8,1.036],['household_floor_rug',10,10,1]]){
   await page.evaluate(`L.setLocationAssetPreset('${id}')`);
   const point=await page.evaluate(`(()=>{const p=new T.Vector3(${x}+.5,1,${z}+.5).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
   await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
   await page.evaluate('new Promise(r=>setTimeout(r,250))');
   await page.until(`(()=>{let root=null;localRender.scene.traverse(m=>{if(m.userData.householdAssetId==='${id}'&&[].concat(m.material).some(material=>material.transparent))root=m.parent});return root&&Math.abs(root.position.x-${x}-.5)<.6&&Math.abs(root.position.z-${z}-.5)<.6})()`,'surface preview '+id+' '+x+','+z);
   if(y!==null){const height=await page.evaluate(`(()=>{let height=null;localRender.scene.traverse(m=>{if(m.userData.householdAssetId==='${id}'&&[].concat(m.material).some(material=>material.transparent))height=m.parent.position.y});return height})()`);assert.ok(Math.abs(height-y)<1e-5,'rug preview height '+height)}
  }
  surfaceChecks.previews=true;
 }
 // Verify the actual catalogue, not only the source registry.
 await page.evaluate(`window.selectLocationEditorTool('assets');Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Мебель')?.click()`);
 const labels=await page.evaluate(`Array.from(document.querySelectorAll('.location-asset-card')).map(b=>b.lastChild.textContent)`);
 assert.equal(labels.filter(l=>l==='Стол').length,1);assert.equal(labels.filter(l=>l==='Стул').length,1);
 assert.ok(!labels.includes('Обеденный стол')&&!labels.includes('Деревянный стул'));
 await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Сантехника')?.click()`);
 const plumbingLabels=await page.evaluate(`(async()=>{const {LOCATION_ASSETS,findLocationAsset}=await import('/static/js/locationAssetCatalog.js');return LOCATION_ASSETS.filter(a=>a.group===findLocationAsset('household_washbasin').group&&!a.hidden).map(a=>a.label).sort()})()`);
 assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('.location-asset-card')).map(b=>b.lastChild.textContent).sort()`),plumbingLabels);
 await page.evaluate(`Array.from(document.querySelectorAll('.location-asset-card')).find(b=>b.lastChild.textContent==='Раковина').click();lookFix(21,8,13,15.2,1.4,5);document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
 const point=await page.evaluate(`(()=>{const p=new T.Vector3(15,1,7.5).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
 await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
 await page.until(`(()=>{let found=false;localRender.scene.traverse(m=>{if(m.userData.householdAssetId==='household_washbasin'&&m.material?.transparent)found=true});return found})()`,'sink preview');
 const click=async p=>{await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1})};
 await click(point);
 await page.until(`(async()=>{const r=await fetch('${api}/locations/${loc.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('access_token')}});return (await r.json()).objects.filter(o=>o.type==='household_washbasin').length===2})()`,'pointer sink placement');
 // Both generations of furniture must keep IDs and transforms after actual editor changes.
 for(const [obj,type,cam,x,z]of [[legacy,'table',[12,9,14,6,1.4,6],4.7,5.1],[alias,'household_wood_chair',[12,9,14,6,1.4,6],7.7,6.3]]){
  await page.evaluate(`window.selectLocationEditorTool('select');lookFix(${cam.join(',')});document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
  const pick=await page.evaluate(`(()=>{const root=localRender.scene.children.find(r=>r.userData.locationObjectId===${obj.id}),p=new T.Box3().setFromObject(root).getCenter(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
  await click(pick);await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='${type}'`,'select '+type);
  assert.equal(await page.evaluate(`L.updateSelectedLocationAssetDetails({x:${x},z:${z},elevation:.05,rotation:35,dimensions:{width:.7,depth:.6,height:.8}})`),true);
  const updated=(await request(`${api}/locations/${loc.id}`,null,token,'GET')).objects.find(o=>o.id===obj.id);
  assert.equal(updated.type,type);assert.equal(updated.properties.dimensions.width,.7);assert.ok(Math.abs(updated.properties.rotation+35*Math.PI/180)<1e-6);
 }
 const peerTarget=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
 const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json(),peer=await connect(tabs.find(t=>t.id===peerTarget.targetId).webSocketDebuggerUrl);
 try{
  await peer.call('Page.bringToFront');
  await peer.until(`Boolean(window.enterLocation&&window.socket?.connected)&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'peer ready');
  await peer.evaluate(`(async()=>{window.W=await import('/static/js/lobby3d.js');return true})()`);await peer.until('W.chunksMap.size===2','peer chunks');
  await peer.evaluate(`window.enterLocation(${loc.id})`);await peer.until(`window.isLocationActive&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'peer scene');
  await peer.evaluate(`(async()=>{const T=await import('three'),old=T.Scene.prototype.add;window.peerSeen=[];T.Scene.prototype.add=function(...roots){for(const r of roots)if(r.userData.locationObject)peerSeen.push(r.userData.locationObject);return old.apply(this,roots)};return true})()`);
  for(const obj of [legacy,alias,objects.find(o=>o.type==='household_toilet')]){
   const current=(await request(`${api}/locations/${loc.id}`,null,token,'GET')).objects.find(o=>o.id===obj.id);
   await request(`${api}/locations/objects/${obj.id}`,{properties:{...current.properties,rotation:.71,elevation:.06}},token,'PATCH');
   await peer.until(`peerSeen.some(o=>o.id===${obj.id}&&o.type==='${obj.type}'&&o.properties.rotation===.71&&o.properties.elevation===.06)`,'peer '+obj.type);
  }
 }finally{peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId})}
 await page.call('Page.bringToFront');
 const saved=await request(`${api}/locations/${loc.id}`,null,token,'GET');
 for(const obj of original.filter(o=>![legacy.id,alias.id,objects.find(o=>o.type==='household_toilet').id].includes(o.id))){
  const restored=saved.objects.find(o=>o.id===obj.id);assert.equal(restored.type,obj.type);assert.deepEqual(restored.properties,obj.properties);
 }
 await page.call('Page.reload');await page.until('Boolean(window.enterLocation)','reload main');await page.evaluate(hook);
 await page.until(`W.chunksMap.size===2&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'reload chunks');
 await page.evaluate(`window.enterLocation(${loc.id})`);await page.until('window.isLocationActive&&!!window.localRender','reload scene');
 const reloaded=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.deepEqual(reloaded.objects,saved.objects);
 for(const obj of saved.objects){
  const restored=await page.evaluate(`(()=>{const r=localRender.scene.children.find(r=>r.userData.locationObjectId===${obj.id});return r?{id:r.userData.locationObject.type,y:r.position.y,rotation:r.rotation.y}:null})()`);
  assert.ok(restored,obj.type);assert.equal(restored.id,obj.type);assert.ok(Math.abs(restored.rotation-(obj.properties.rotation||0))<1e-6);
 }
 const metrics=await page.evaluate(`(async()=>{
  lookFix(24,25,29,10,1,10);const {renderer:r,scene:s,camera:c}=localRender;await new Promise(done=>setTimeout(done,500));
  const sample=async()=>{const times=[];for(let i=0;i<15;i++){const t=performance.now();r.render(s,c);if(i>4)times.push(performance.now()-t)}const fps=await new Promise(resolve=>{let first=null,n=0;const tick=t=>{if(first===null)first=t;else n++;if(t-first<1200)requestAnimationFrame(tick);else resolve(n*1000/(t-first))};requestAnimationFrame(tick)});return {fps,cpuMs:times.reduce((a,b)=>a+b)/times.length,calls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures}};
  const resources=()=>{const geometryIds=new Set();s.traverse(m=>{if(m.userData.householdAssetId)geometryIds.add(m.geometry.uuid)});return {geometryIds:[...geometryIds].sort(),batches:s.children.filter(m=>m.userData.locationRenderBatch).length}};
  const before=await sample(),resourcesBefore=resources();for(let i=0;i<100;i++)L.addLocationObject({id:-1000-i,type:['household_washbasin','household_toilet','household_bathtub'][i%3],tile_x:3+i%10,tile_y:3+Math.floor(i/10),properties:{}});
  await new Promise(done=>setTimeout(done,500));const after=await sample(),gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
  return {before,after,resourcesBefore,resourcesAfter:resources(),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
 })()`);
 assert.equal(metrics.shaderErrors,0);assert.ok(metrics.after.calls-metrics.before.calls<=100);assert.equal(metrics.after.textures,metrics.before.textures);assert.deepEqual(metrics.resourcesAfter.geometryIds,metrics.resourcesBefore.geometryIds);assert.equal(metrics.after.geometries-metrics.before.geometries,metrics.resourcesAfter.batches-metrics.resourcesBefore.batches);
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({models,bounds,crateBounds,surfaceChecks,catalogue:true,pointerPlacement:true,legacyAndAliasTransforms:true,secondClient:true,saveReload:true,metrics},null,2));
 console.log('HOUSEHOLD FIX PASS',JSON.stringify({metrics,surfaceChecks,storageWindows:storageFixtures.length}));
};
