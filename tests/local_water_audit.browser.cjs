// Observe the existing local renderer; all fixture edits use a temporary DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/local-water-audit');fs.mkdirSync(output,{recursive:true});
    const protectedFiles=['locationScene.js','locationWaterEdge.js','locationTerrain.js','waterSurface.js','terrainMaterialLayer.js'];
    const hashes=()=>Object.fromEntries(protectedFiles.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../app/static/js',f))).digest('hex')]));
    const before=hashes(),tiles=Array.from({length:32},()=>Array.from({length:32},()=>({terrain:'grass',height:1,objects:[]})));
    const rectangle=(x0,z0,x1,z1,terrain,height)=>{for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)tiles[z][x]={terrain,height,objects:[]};};
    rectangle(3,3,6,6,'water',1);
    rectangle(11,2,18,8,'sand',1);rectangle(13,4,16,6,'water',1);
    for(const [x,z]of [[23,5],[25,5],[24,4]])tiles[z][x]={terrain:'sand',height:1,objects:[]};tiles[5][24]={terrain:'water',height:1,objects:[]};
    rectangle(3,13,7,17,'water',1);rectangle(2,13,2,17,'grass',2.5);rectangle(1,12,1,18,'grass',1.6);
    rectangle(13,13,17,17,'water',1);tiles[15][15].height=1.6;
    tiles[14][24]={terrain:'water',height:1,objects:[]};tiles[15][25]={terrain:'water',height:1.8,objects:[]};
    rectangle(3,24,8,24,'water',1);tiles[25][8]={terrain:'water',height:1,objects:[]};tiles[26][8]={terrain:'water',height:1,objects:[]};
    rectangle(13,23,19,28,'sand',.5);rectangle(15,24,17,26,'water',.5);
    const loc=await request(`/lobbies/${lobby.id}/locations`,{name:'Water local visual audit',world_tile_x:25,world_tile_z:15,grid_width:32,grid_height:32,tiles_data:tiles},token);
    await page.evaluate(`(()=>{const T=threeModule,add=T.Scene.prototype.add;window.waterAuditRestore=()=>T.Scene.prototype.add=add;T.Scene.prototype.add=function(...objects){for(const root of objects)root.traverse(n=>{if(!n.isMesh)return;const old=n.onBeforeRender;n.onBeforeRender=function(renderer,scene,camera,...args){old?.call(this,renderer,scene,camera,...args);if(window.isLocationActive&&renderer!==sceneModule.renderer)window.localWaterRender={renderer,scene,camera};};});return add.apply(this,objects)};})()`);
    await page.evaluate(`window.enterLocation(${loc.id})`);
    await page.until(`window.currentLocationId===${loc.id}&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')&&Boolean(window.localWaterRender)`,'local water scene');
    await page.evaluate("(async()=>{window.L=await import('/static/js/locationScene.js');window.edge=await import('/static/js/locationWaterEdge.js');window.waterAuditRestore();window.lookLocal=(x,y,z,tx,ty,tz)=>{locationControls.target.set(tx,ty,tz);locationControls.object.position.set(x,y,z);locationControls.update();locationControls.object.updateMatrixWorld(true)};window.waterTop=()=>localWaterRender.scene.children.find(m=>m.isMesh&&!m.isInstancedMesh&&m.material?.customProgramCacheKey?.().includes('world-aligned-water-v1'));window.waterY=(x,z)=>{const a=waterTop().geometry.attributes.position,ys=[];for(let i=0;i<a.count;i++)if(a.getX(i)>x+.1&&a.getX(i)<x+.9&&a.getZ(i)>z+.1&&a.getZ(i)<z+.9)ys.push(a.getY(i));return {minimum:Math.min(...ys),maximum:Math.max(...ys)};}})()");
    await page.until('L.getLocationTerrainMaterialDiagnostics()?.ready&&Boolean(waterTop())','local water material');
    await page.evaluate("document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click()");
    const capture=async(name,cam)=>{await page.evaluate(`lookLocal(${cam.join(',')});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    const cases=[['overview',[35,30,42,16,1,16]],['small-grass',[9,6,12,5,1,5]],['small-sand',[19,5.5,12,15,1,5]],['high-shore',[10,5,21,4,1.4,15]],['unequal-levels',[20,5,22,15.5,1.3,15.5]],['diagonal',[29,6,21,25,1.3,15]],['narrow-corners',[10,5,30,6,1,25]],['low-shore',[21,5,31,16,0.6,25]]];
    const viewsOnly=process.env.VTT_LOCAL_WATER_VIEWS_ONLY;
    for(const [name,cam]of (viewsOnly?cases.filter(([name],i)=>viewsOnly==='1'?i<5:name===viewsOnly):cases))await capture(name,cam);
    if(viewsOnly){
        if(viewsOnly==='diagonal'){
            const hits=await page.evaluate(`(()=>{const T=threeModule,ray=new T.Raycaster(new T.Vector3(28,1.4,15.5),new T.Vector3(-1,0,0)),out=[];localWaterRender.scene.updateMatrixWorld(true);for(const m of localWaterRender.scene.children){if(!m.isMesh)continue;const isSide=m.isInstancedMesh&&m.geometry.attributes.waterSideMask;if(m.isInstancedMesh&&!isSide)continue;if(!isSide&&m.material?.roughness!==.97)continue;const hits=[];(isSide?T.InstancedMesh:T.Mesh).prototype.raycast.call(m,ray,hits);for(const h of hits)out.push({distance:h.distance,point:h.point.toArray(),part:isSide?'water-exterior-instance':m.material.map?'textured-bank-or-cap':'untextured-bank',materialColor:m.material.color?.getHexString?.(),instanceColor:isSide?new T.Color().fromArray(m.instanceColor.array,h.instanceId*3).getHexString():null});}return out.sort((a,b)=>a.distance-b.distance).slice(0,8)})()`);
            fs.writeFileSync(path.join(output,'raised-water-diagnostic.json'),JSON.stringify(hits,null,2)+'\n');
        }
        assert.deepEqual(hashes(),before);console.log('PASS: unobstructed local water audit views');return;
    }
    const initial=await page.evaluate(`(()=>{const {renderer:r,scene}=localWaterRender,m=waterTop();return {material:{roughness:m.material.roughness,metalness:m.material.metalness,normalMap:!!m.material.normalMap,envMap:!!m.material.envMap,transparent:m.material.transparent,receiveShadow:m.receiveShadow},topTriangles:m.geometry.attributes.position.count/3,programErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length,pondY:waterY(24,5),terrain:L.getLocationTerrainMaterialDiagnostics(),load:window.getLocationLoadDiagnostics?.()}})()`);
    assert.equal(initial.programErrors,0);
    const saved=await request(`/lobbies/${lobby.id}/locations/${loc.id}`,null,token,'GET');assert.deepEqual(saved.tiles_data,tiles);
    await capture('classification-before',[28,4,10,24.5,1,5.5]);
    await page.evaluate("L.setLocationEditMode(true);L.applyLocationBrush(23,5,{terrain:'grass'},0)");
    await page.until('waterY(24,5).minimum>1','shore classification refresh');
    await page.evaluate('L.setLocationEditMode(false)');
    await capture('classification-after',[28,4,10,24.5,1,5.5]);
    const changed=await request(`/lobbies/${lobby.id}/locations/${loc.id}`,null,token,'GET');
    assert.equal(changed.tiles_data[5][24].height,1);
    const classificationAfter=await page.evaluate('waterY(24,5)');
    await page.evaluate("L.setLocationEditMode(true);L.applyLocationBrush(5,5,{height:1.5},0);L.setLocationEditMode(false)");
    await page.until('waterY(5,5).maximum>1.4','water height brush');
    await capture('edited-pond',[9,6,12,5,1,5]);
    await capture('edited-pond-low-angle',[10,2.5,9,5,1.2,5]);
    const after=hashes();assert.deepEqual(after,before);
    const result={location:loc.id,initial,classificationAfter,storedWaterHeightBefore:1,storedWaterHeightAfter:changed.tiles_data[5][24].height,productionFilesUnchanged:true,hashes:after,cameras:Object.fromEntries(cases)};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS: local water visual audit captured; renderer untouched:',JSON.stringify(result));
};
