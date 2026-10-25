const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
 const out=path.resolve('docs/material-previews/water-profiles');fs.mkdirSync(out,{recursive:true});
 const baseline=!!process.env.VTT_WATER_BASELINE_DIR,state=baseline?'before':process.env.VTT_FORCE_WEBGL1==='1'?'webgl1':'after',profiles=['auto','clean','neutral','sandy','peat','mineral','industrial'];
 const shot=async name=>{await page.evaluate('new Promise(r=>setTimeout(r,1200))');if(process.env.VTT_FORCE_WEBGL1==='1')return;fs.writeFileSync(path.join(out,`${state}-${name}.png`),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
 const measure=async local=>page.evaluate(`(async()=>{const {renderer:r,scene,camera}=${local?'localRender':'W'},gl=r.getContext(),p=new Uint8Array(4),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),samples=[];
 for(let i=0;i<7;i++){const q=ext?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);const t=performance.now();r.render(scene,camera);const cpu=performance.now()-t;if(q)gl.endQuery(ext.TIME_ELAPSED_EXT);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);const total=performance.now()-t;let gpu=null;if(q){for(let n=0;n<20&&!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE);n++)await new Promise(r=>setTimeout(r,10));if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(ext.GPU_DISJOINT_EXT))gpu=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);}if(i>1)samples.push({cpuMs:cpu,syncMs:total,gpuMs:gpu});}
 const median=k=>samples.map(s=>s[k]).sort((a,b)=>a-b)[2];return {webgl2:r.capabilities.isWebGL2,cpuMs:median('cpuMs'),syncMs:median('syncMs'),gpuMs:median('gpuMs'),calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures,shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length,device:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL||gl.RENDERER)}})()`);
 await page.evaluate(`window.W=sceneModule;window.T=threeModule;window.look=(...p)=>{W.controls.target.set(...p.slice(3));W.camera.position.set(...p.slice(0,3));W.controls.update();W.camera.updateMatrixWorld(true)};W.setCelestialTime(480);document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click()`);
 const tiles=Array.from({length:64},()=>Array.from({length:64},()=>({terrain:'grass',height:1,objects:[]})));
 const rect=(grid,x0,z0,x1,z1,terrain,profile)=>{for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)grid[z][x]={terrain,height:1,objects:[],...(terrain==='water'?{water_level_offset:0,...(profile?{water_profile:profile}:{})}:{})};};
 for(let i=0;i<7;i++)rect(tiles,3+i*8,4,6+i*8,10,'water',profiles[i]==='auto'?undefined:profiles[i]);
 const kinds=['grass','sand','swamp','rock','metal','bare_dirt','snow'];
 for(let i=0;i<7;i++){rect(tiles,2+i*8,14,7+i*8,20,kinds[i]);rect(tiles,4+i*8,16,5+i*8,18,'water');}
 rect(tiles,3,23,25,43,'water');rect(tiles,2,23,2,43,'sand');rect(tiles,26,23,26,43,'metal');rect(tiles,12,24,14,28,'water','peat');rect(tiles,15,24,17,28,'water','sandy');rect(tiles,43,24,58,41,'snow');
 const updates=tiles.flatMap((row,z)=>row.map((tile,x)=>({chunk_x:x>>5,chunk_y:z>>5,tile_x:x%32,tile_y:z%32,updates:tile})));
 await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
 await page.until("W.chunksMap.get('1,1')?.tilesData[4][15].terrain==='snow'",'fixture');
 await page.until('W.getWorldTerrainMaterialDiagnostics().ready','PBR');
 const worldViews=[['world-profiles',[32,30,36,30,1,8]],['world-auto',[33,26,43,30,1,18]],['world-lake',[33,21,51,15,1,32]],['world-snow',[58,12,44,49,1,31]]];
 for(const [name,cam]of worldViews){await page.evaluate(`look(${cam.join(',')})`);await shot(name);}
 const worldPerformance=await measure(false),checks={};
 assert.equal(worldPerformance.shaderErrors,0);assert.ok(worldPerformance.calls>1);
 if(!baseline){
  await page.evaluate(`(async()=>{window.waterAPI=await import('/static/js/mapEdit.js');waterAPI.setEditMode(true);waterAPI.selectWorldEditorTool('terrain');window.setCurrentTileTypeFromUI('water')})()`);
  assert.equal(await page.evaluate("document.getElementById('world-water-profile').options.length"),7);
  assert.equal(await page.evaluate("!document.querySelector('[data-world-tool=water_profile]')&&document.getElementById('world-water-profile').closest('[data-world-settings]').dataset.worldSettings==='terrain'&&!document.getElementById('world-water-profile').closest('section').hidden"),true);
  await page.evaluate("window.setCurrentTileTypeFromUI('grass')");
  assert.equal(await page.evaluate("document.getElementById('world-water-profile').closest('section').hidden"),true);
  await page.evaluate("window.setCurrentTileTypeFromUI('water')");
  await page.evaluate(`look(9,8,13,4.5,1,5.5);document.getElementById('world-water-profile').value='industrial';window.testWaterAim=(x,z)=>{const r=W.renderer.domElement.getBoundingClientRect(),v=new T.Vector3(x,1.02,z).project(W.camera);return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}}`);
  await page.evaluate('new Promise(r=>setTimeout(r,400))');
  await shot('world-editor');
  await page.evaluate("document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()");
  await page.evaluate("window.firstProfileGeo=W.chunksMap.get('0,0').waterSurface.geometry");
  const start=await page.evaluate('testWaterAim(4.5,5.5)'),end=await page.evaluate('testWaterAim(5.5,5.5)');
  await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...start});
  await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
  await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1});
  await page.evaluate('new Promise(r=>setTimeout(r,300))');
  await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',buttons:0,clickCount:1});
  console.log('Pointer',await page.evaluate(`({target:document.elementFromPoint(${end.x},${end.y})?.tagName,tool:worldEditorTool,mode:waterAPI.getEditMode(),hover:W.getHoveredTile()&&[W.getHoveredTile().tileX,W.getHoveredTile().tileY],profile:W.chunksMap.get('0,0').tilesData[5][5].water_profile})`));
  await page.until("W.chunksMap.get('0,0').tilesData[5][5].water_profile==='industrial'",'real pointer water brush');checks.worldPointerBrush=true;assert.equal(await page.evaluate("W.chunksMap.get('0,0').waterSurface.geometry===firstProfileGeo"),true);
  await page.evaluate(`window.worldWaterMesh=W.chunksMap.get('0,0').waterSurface;window.worldWaterPositions=Array.from(worldWaterMesh.geometry.attributes.position.array);window.autoBefore=Array.from(W.worldWaterProfiles.uniforms.waterProfiles.value.image.data.slice((16*64+4)*4,(16*64+4)*4+4));window.applyBrush({chunkX:0,chunkY:0,tileX:4,tileY:5},{water_profile:'industrial'},0)`);
  await page.until("W.chunksMap.get('0,0').tilesData[5][4].water_profile==='industrial'",'manual brush');
  assert.equal(await page.evaluate("W.chunksMap.get('0,0').waterSurface===worldWaterMesh"),true);
  await page.evaluate("document.getElementById('world-water-basin').checked=true;waterAPI.applyWorldWaterProfile({chunkX:1,chunkY:0,tileX:12,tileY:5},'clean',0)");
  await page.until("W.chunksMap.get('1,0').tilesData[10][14].water_profile==='clean'",'whole basin');
  await request(`/lobbies/${lobby.id}/chunks/0/0/tile/3/16`,{terrain:'metal'},token,'PATCH');
  await page.until("W.chunksMap.get('0,0').tilesData[16][3].terrain==='metal'",'auto shore edit');
  await page.until("W.worldWaterProfiles.uniforms.waterProfiles.value.image.data[(16*64+4)*4+3]>autoBefore[3]",'auto appearance updated');
  assert.equal(await page.evaluate("W.chunksMap.get('0,0').tilesData[5][4].water_profile"),'industrial');
  // Profile painting must preserve geometry and height, not rebuild a mesh.
  checks.worldProfiles=await page.evaluate(`({bytes:W.worldWaterProfiles.diagnostics().bytes,manual:W.chunksMap.get('0,0').tilesData[5][4].water_profile,height:W.chunksMap.get('0,0').tilesData[5][4].height})`);
  await page.evaluate("document.getElementById('world-water-basin').checked=false;window.applyBrush({chunkX:0,chunkY:0,tileX:4,tileY:5},{water_profile:'auto'},0)");
  await page.until("W.chunksMap.get('0,0').tilesData[5][4].water_profile==='auto'",'auto reset');
  await page.evaluate('new Promise(r=>setTimeout(r,700))');
  await page.call('Page.reload');await page.until('window.isGM','reload');await page.evaluate("(async()=>{window.W=window.sceneModule=await import('/static/js/lobby3d.js');window.T=await import('three')})()");
  await page.until("W.chunksMap.get('1,0')?.tilesData[10][14].water_profile==='clean'",'saved world profile');checks.worldReload=true;
 }
 const local=Array.from({length:26},()=>Array.from({length:30},()=>({terrain:'grass',height:1,objects:[]})));
 for(let i=0;i<7;i++)rect(local,1+i*4,2,2+i*4,5,'water',profiles[i]==='auto'?undefined:profiles[i]);
 for(let i=0;i<7;i++){rect(local,i*4,8,3+i*4,13,kinds[i]);rect(local,1+i*4,10,2+i*4,11,'water');}
 rect(local,5,17,23,23,'water');rect(local,4,17,4,23,'sand');rect(local,24,17,24,23,'metal');rect(local,11,17,12,19,'water','peat');rect(local,13,17,14,19,'water','sandy');
 const loc=await request(`/lobbies/${lobby.id}/locations`,{name:'Water profiles',world_tile_x:10,world_tile_z:10,grid_width:30,grid_height:26,tiles_data:local},token);
 await page.evaluate(`(()=>{const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...objects){for(const root of objects)root.traverse(m=>{if(!m.isMesh)return;const old=m.onBeforeRender;m.onBeforeRender=function(renderer,scene,camera,...args){old?.call(this,renderer,scene,camera,...args);if(window.isLocationActive&&renderer!==W.renderer)window.localRender={renderer,scene,camera}}});return add.apply(this,objects)}})()`);
 await page.evaluate(`window.enterLocation(${loc.id})`);await page.until('window.isLocationActive&&!!window.localRender&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','location');
 await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.lookLocal=(...p)=>{locationControls.target.set(...p.slice(3));locationControls.object.position.set(...p.slice(0,3));locationControls.update();locationControls.object.updateMatrixWorld(true)};document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click()})()`);
 await page.until('L.getLocationTerrainMaterialDiagnostics()?.ready','local PBR');
 for(const [name,cam]of [['local-profiles',[16,20,24,14,1,4]],['local-auto',[17,18,31,14,1,11]],['local-close',[10,4,7,8,1,3.5]],['local-lake',[27,12,30,14,1,20]]]){await page.evaluate(`lookLocal(${cam.join(',')})`);await shot(name);}
 const localPerformance=await measure(true);assert.equal(localPerformance.shaderErrors,0);
 if(!baseline){
  await page.evaluate(`window.selectLocationEditorTool('terrain');L.setLocationBrushTerrain('water');window.localWaterMesh=localRender.scene.children.find(m=>m.isMesh&&!m.isInstancedMesh&&m.material?.customProgramCacheKey?.().includes('world-aligned-water-'));window.localWaterGeo=localWaterMesh.geometry;L.applyLocationBrush(1,3,{water_profile:'industrial'},0)`);
  assert.equal(await page.evaluate("document.getElementById('loc-water-profile').options.length"),7);
  assert.equal(await page.evaluate("!document.querySelector('[data-location-tool=water_profile]')&&!document.getElementById('loc-water-profile').closest('section').hidden"),true);
  await page.evaluate("L.setLocationBrushTerrain('grass')");
  assert.equal(await page.evaluate("document.getElementById('loc-water-profile').closest('section').hidden"),true);
  await page.evaluate("L.setLocationBrushTerrain('water');L.applyLocationBrush(3,3,{terrain:'water',water_profile:'sandy'},0)");
  await page.until(`(async()=>{const r=await fetch('/lobbies/${lobby.id}/locations/${loc.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('access_token')}});const t=(await r.json()).tiles_data[3][3];return t.terrain==='water'&&t.water_profile==='sandy'})()`,'new water with selected profile');
  await page.until(`(async()=>{const r=await fetch('/lobbies/${lobby.id}/locations/${loc.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('access_token')}});return (await r.json()).tiles_data[3][1].water_profile==='industrial'})()`,'local saved brush');
  await page.evaluate('new Promise(r=>setTimeout(r,500))');
  await page.evaluate("window.localWaterMesh=localRender.scene.children.find(m=>m.isMesh&&!m.isInstancedMesh&&m.material?.customProgramCacheKey?.().includes('world-aligned-water-'));window.localWaterGeo=localWaterMesh.geometry");
  const revision=await page.evaluate('L.getLocationWaterProfileDiagnostics().revision');
  await page.evaluate("L.applyLocationBrush(0,10,{terrain:'metal'},0)");
  await page.until(`L.getLocationWaterProfileDiagnostics().revision>${revision}`,'local auto shore appearance');
  await page.evaluate('new Promise(r=>setTimeout(r,500))');
  assert.equal(await page.evaluate('localWaterMesh.geometry===localWaterGeo&&localRender.scene.children.includes(localWaterMesh)'),true);checks.localAutoWithoutGeometry=true;
  const target=await(await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(base+'/lobbies/'+lobby.id+'/page')}`,{method:'PUT'})).json(),peer=await connect(target.webSocketDebuggerUrl);
  try{
   await peer.call('Page.enable');await peer.call('Runtime.enable');await peer.until('window.isGM','peer');
   await peer.evaluate("(async()=>{window.P=await import('/static/js/lobby3d.js')})()");
   await peer.until("P.chunksMap.size===4&&window.socket?.connected",'peer initial world loaded');
   await request(`/lobbies/${lobby.id}/chunks/0/0/tile/12/5`,{water_profile:'industrial'},token,'PATCH');
   await peer.until("P.chunksMap.get('0,0')?.tilesData[5][12].water_profile==='industrial'",'world peer profile');checks.worldPeerSync=true;
   await peer.evaluate(`window.enterLocation(${loc.id})`);await peer.until(`window.currentLocationId===${loc.id}&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'peer local');
   await peer.evaluate("window.profileEvents=[];window.socket.on('location_tiles_updated',e=>profileEvents.push(e));true");
   await page.call('Page.bringToFront');await page.evaluate("document.getElementById('loc-water-basin').checked=true;L.applyLocationBrush(5,3,{water_profile:'peat'},0)");
   await peer.until("profileEvents.some(e=>e.updates.some(u=>u.x===6&&u.z===5&&u.water_profile==='peat'))",'local peer profile');checks.localPeerSync=true;
   await page.evaluate("document.getElementById('loc-water-basin').checked=false;L.applyLocationBrush(1,3,{water_profile:'auto'},0)");
   await page.evaluate('new Promise(r=>setTimeout(r,500))');const saved=await request(`/lobbies/${lobby.id}/locations/${loc.id}`,null,token,'GET');
   assert.equal(saved.tiles_data[3][1].water_profile,'auto');assert.equal(saved.tiles_data[5][6].water_profile,'peat');assert.equal(saved.tiles_data[3][1].height,1);
   await page.evaluate(`window.enterLocation(${loc.id})`);await page.until(`window.currentLocationId===${loc.id}&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'local reopen');
   checks.localReload=true;checks.localProfileBytes=await page.evaluate('L.getLocationWaterProfileDiagnostics().bytes');
  }finally{await peer.call('Page.close').catch(()=>{});peer.close();}
 }
 fs.writeFileSync(path.join(out,`${state}-results.json`),JSON.stringify({worldPerformance,localPerformance,checks},null,2));console.log('PASS water profiles',JSON.stringify({worldPerformance,localPerformance,checks}));
};
