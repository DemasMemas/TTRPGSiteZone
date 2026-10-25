const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby})=>{
    const pondExperiment=process.env.VTT_LOCAL_POND_EXPERIMENT==='1';
    const out=path.resolve(pondExperiment?'docs/material-previews/local-pond-experiment':'docs/material-previews/water-simple');fs.mkdirSync(out,{recursive:true});
    const state=process.env.VTT_WATER_BASELINE_DIR?'before':'after';
    const shot=async name=>{await page.evaluate('new Promise(r=>setTimeout(r,250))');fs.writeFileSync(path.join(out,`${state}-${name}.png`),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    await page.evaluate(`window.W=sceneModule;window.T=threeModule;window.look=(x,y,z,tx,ty,tz)=>{W.controls.target.set(tx,ty,tz);W.camera.position.set(x,y,z);W.controls.update();W.camera.updateMatrixWorld(true)};W.setCelestialTime(480)`);
    await page.until('W.getWorldTerrainMaterialDiagnostics().ready','PBR');
    const measure=async local=>page.evaluate(`(async()=>{const {renderer:r,scene,camera}=${local?'localRender':'W'},gl=r.getContext(),p=new Uint8Array(4),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),samples=[];
        for(let i=0;i<7;i++){const q=ext?gl.createQuery():null;if(q)gl.beginQuery(ext.TIME_ELAPSED_EXT,q);const t=performance.now();r.render(scene,camera);const cpu=performance.now()-t;if(q)gl.endQuery(ext.TIME_ELAPSED_EXT);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);const total=performance.now()-t;
            let gpu=null;if(q){for(let n=0;n<20&&!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE);n++)await new Promise(r=>setTimeout(r,10));if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(ext.GPU_DISJOINT_EXT))gpu=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);}if(i>1)samples.push({cpuMs:cpu,syncMs:total,gpuMs:gpu});}
        const median=k=>samples.map(s=>s[k]).sort((a,b)=>a-b)[2];return {cpuMs:median('cpuMs'),syncMs:median('syncMs'),gpuMs:median('gpuMs'),calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures,geometries:r.info.memory.geometries,shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length,device:gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL||gl.RENDERER)}})()`);
    const frameRate=async()=>page.evaluate(`new Promise(resolve=>{const times=[];let start;const tick=t=>{if(start===undefined)start=t;times.push(t);if(t-start<1500)requestAnimationFrame(tick);else resolve({fps:(times.length-1)*1000/(t-start),frameMs:(t-start)/(times.length-1)})};requestAnimationFrame(tick)})`);
    const world=[];
    if(process.env.VTT_SIMPLE_LOCAL_ONLY!=='1'&&!pondExperiment){
        await page.evaluate(`W.setMapDimensions(16,16);[...W.chunksMap.values()].forEach(c=>W.removeChunk(c.chunkX,c.chunkY));look(340,260,468,256,1,256)`);
        const build=Date.now();
        for(let cz=0;cz<16;cz++)for(let cx=0;cx<16;cx++)await page.evaluate(`W.addChunk(${cx},${cz},Array.from({length:32},(_,z)=>Array.from({length:32},(_,x)=>({terrain:Math.abs(${cx}*32+x-256-Math.round(Math.sin((${cz}*32+z)*.04)*5))<3?'water':'grass',height:1,objects:[]}))))`);
        console.log('Empty map build',Date.now()-build);
        for(const [distance,cam]of [['near',[265,10,267,256,1,256]],['far',[340,260,468,256,1,256]]]){
            await page.evaluate(`look(${cam.join(',')});new Promise(r=>setTimeout(r,700))`);await shot('world-'+distance);
            const chunks=await page.evaluate(`(()=>{const geometries=new Set();W.scene.traverse(m=>{if(m.geometry)geometries.add(m.geometry)});return {loadedChunks:W.chunksMap.size,visibleChunks:[...W.chunksMap.values()].filter(c=>c.ground.visible).length,meshBytes:[...geometries].reduce((n,g)=>n+Object.values(g.attributes).reduce((s,a)=>s+a.array.byteLength,0)+(g.index?.array.byteLength||0),0)}})()`);
            world.push({distance,variant:'normal',...await measure(false),...await frameRate(),...chunks});
            await page.evaluate(`window.hiddenWater=[...new Set([...W.chunksMap.values()].flatMap(c=>[c.waterSurface,c.waterBank]).filter(Boolean).map(m=>m.material))];hiddenWater.forEach(m=>m.visible=false)`);
            world.push({distance,variant:'withoutWater',...await measure(false)});
            await page.evaluate('hiddenWater.forEach(m=>m.visible=true)');
            if(state==='before'){
                await page.evaluate(`window.caps=[];window.sideGeometries=new Map();for(const c of W.chunksMap.values()){const m=c.ground,g=m.geometry;caps.push([m,g]);if(!sideGeometries.has(g)){const s=g.clone(),a=g.index.array,n=g.attributes.normal,indices=[];for(let i=0;i<a.length;i+=3)if(Math.abs(n.getY(a[i]))<.5)indices.push(a[i],a[i+1],a[i+2]);s.setIndex(indices);s.clearGroups();sideGeometries.set(g,s)}m.geometry=sideGeometries.get(g)}`);
                world.push({distance,variant:'withoutGroundCaps',...await measure(false)});
                await page.evaluate('caps.forEach(([m,g])=>m.geometry=g);sideGeometries.forEach(g=>g.dispose())');
            }
        }
        const ray=await page.evaluate(`(()=>{const ray=new T.Raycaster(new T.Vector3(250.5,5,250.5),new T.Vector3(0,-1,0));const m=W.chunksMap.get('7,7').ground;return ray.intersectObject(m).map(h=>({id:h.instanceId,y:h.point.y}))})()`);
        assert.ok(ray.some(h=>Math.abs(h.y-1)<1e-6),'ground picking remains available from above');
        fs.writeFileSync(path.join(out,state+'-world.json'),JSON.stringify({world,ray},null,2));console.log('World',JSON.stringify(world));
        await page.evaluate('[...W.chunksMap.values()].forEach(c=>W.removeChunk(c.chunkX,c.chunkY));W.setMapDimensions(2,2);look(36,4,12,32,1,8)');
    }
    const tiles=Array.from({length:20},()=>Array.from({length:20},()=>({terrain:'grass',height:1,objects:[]})));
    const rect=(x0,z0,x1,z1,terrain,height)=>{for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)tiles[z][x]={terrain,height,objects:[],...(terrain==='water'?{water_level_offset:0}:{})};};
    rect(3,3,7,6,'water',1);rect(11,2,15,6,'water',1);rect(10,5,11,7,'water',1);tiles[2][11]={terrain:'grass',height:1,objects:[]};
    rect(2,10,6,18,'snow',1.7);rect(3,12,5,16,'water',1);rect(11,11,17,17,'water',1);rect(14,14,14,14,'bare_dirt',1.25);
    if(pondExperiment){
        rect(0,0,19,19,'grass',1);
        rect(2,2,6,6,'bare_dirt',1);rect(4,4,4,4,'water',1);
        rect(11,3,15,6,'water',1);rect(10,5,11,7,'water',1);
        rect(2,12,6,16,'bare_dirt',1.7);rect(4,14,4,14,'water',1);
        rect(9,10,17,18,'grass',1.7);rect(11,12,15,16,'water',1);
    }
    const loc=await request(`/lobbies/${lobby.id}/locations`,{name:'Water contour comparison',world_tile_x:10,world_tile_z:10,grid_width:20,grid_height:20,tiles_data:tiles},token);
    await page.evaluate(`(()=>{const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...objects){for(const root of objects)root.traverse(m=>{if(!m.isMesh)return;const old=m.onBeforeRender;m.onBeforeRender=function(renderer,scene,camera,...args){old?.call(this,renderer,scene,camera,...args);if(window.isLocationActive&&renderer!==W.renderer)window.localRender={renderer,scene,camera}}});return add.apply(this,objects)}})()`);
    await page.evaluate(`window.enterLocation(${loc.id})`);await page.until('window.isLocationActive&&!!window.localRender&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','location');
    await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.C=await import('/static/js/locationWaterContourPrototype.js');window.G=await import('/static/js/locationTerrain.js');window.U=await import('/static/js/waterGeometryUtils.js');window.lookLocal=(...p)=>{locationControls.target.set(...p.slice(3));locationControls.object.position.set(...p.slice(0,3));locationControls.update();locationControls.object.updateMatrixWorld(true)};document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click()})()`);
    await page.until('L.getLocationTerrainMaterialDiagnostics()?.ready','local PBR');
    const cameras=pondExperiment?[['overview',[23,20,29,10,1,10]],['puddle',[6.8,2.7,7.5,4.5,1,4.5]],['large',[17,5,11,12.7,1,4.7]],['large-high',[17,5,20,13.5,1.3,14.5]],['puddle-high',[7,3.8,17,4.5,1.3,14.5]]]:[['overview',[23,20,29,10,1,10]],['small',[9,5,10,5,1,4.5]],['high',[9,5,20,4,1.3,14]],['island',[21,6,23,14,1,14]]];
    const local=[];
    for(const variant of ['current','prototype']){
        if(variant==='prototype')await page.evaluate(`(()=>{window.fixture=${JSON.stringify(tiles)};window.proto=C.buildWaterContourPrototype(T,fixture,G.createTerrainSurfaceHeightSampler(fixture),{puddles:${pondExperiment}});if(!proto.supported)throw Error(proto.reason);
            const s=localRender.scene,water=s.children.find(m=>m.isMesh&&!m.isInstancedMesh&&m.material?.customProgramCacheKey?.().includes('world-aligned-water-'));
            const banks=s.children.filter(m=>m.isMesh&&!m.isInstancedMesh&&m.geometry?.attributes.terrainTop?.array.every(v=>v===0));
            window.oldWater=[water,...banks];oldWater.forEach(m=>m.visible=false);window.prototypeMeshes=[];
            for(const [positions,mat,bank]of [[proto.water,water.material,false],[proto.bank,banks[0].material,true]]){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(U.smoothWaterNormals(positions),3));g.setAttribute('color',new T.Float32BufferAttribute(bank?proto.bankColors:proto.waterColors,3));if(bank){g.setAttribute('terrainTileCoord',new T.Float32BufferAttribute(U.shoreOwners(positions,fixture),2));g.setAttribute('terrainTop',new T.Float32BufferAttribute(Array(positions.length/3).fill(0),1));g.setAttribute('uv',new T.Float32BufferAttribute(positions.flatMap((v,i)=>i%3===1?[]:[v/20]),2))}const m=new T.Mesh(g,mat);m.receiveShadow=bank;m.raycast=()=>{};s.add(m);prototypeMeshes.push(m)}
        })()`);
        const views=[];
        for(const [name,cam]of cameras){await page.evaluate(`lookLocal(${cam.join(',')});new Promise(r=>setTimeout(r,1100))`);await shot('local-'+variant+'-'+name);if(pondExperiment)views.push({name,...await measure(true)});} 
        const cost=await measure(true);
        const memory=await page.evaluate(`(()=>{const meshes=${variant==='prototype'?'prototypeMeshes':'localRender.scene.children.filter(m=>m.isMesh&&!m.isInstancedMesh&&(m.material?.customProgramCacheKey?.().includes("world-aligned-water-")||m.geometry?.attributes.terrainTop?.array.every(v=>v===0)))'};return {waterTriangles:meshes.reduce((s,m)=>s+(m.geometry.index?.count||m.geometry.attributes.position.count)/3,0),waterBytes:meshes.reduce((s,m)=>s+Object.values(m.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(m.geometry.index?.array.byteLength||0),0)}})()`);
        local.push({variant,...cost,...memory,...await frameRate(),...(pondExperiment?{views}:{})});
    }
    const checks=await page.evaluate(`(()=>{const snap=JSON.stringify(fixture);const edit=fixture[3][3].terrain==='water'?[3,3]:[12,12];fixture[edit[1]][edit[0]].height=1.3;const result=C.buildWaterContourPrototype(T,fixture,G.createTerrainSurfaceHeightSampler(fixture));fixture[edit[1]][edit[0]].height=1;return {heightEdit:result.supported,reason:result.reason,unchanged:JSON.stringify(fixture)===snap,basins:proto.basins}})()`);
    assert.equal(checks.unchanged,true);assert.equal(checks.heightEdit,false);
    fs.writeFileSync(path.join(out,state+'-local.json'),JSON.stringify({local,checks},null,2));console.log('Local',JSON.stringify({local,checks}));
};
