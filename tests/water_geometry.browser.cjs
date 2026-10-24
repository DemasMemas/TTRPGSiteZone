const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/water-geometry');fs.mkdirSync(output,{recursive:true});
    const updates=[];
    for(let z=0;z<64;z++)for(let x=23;x<45;x++){
        const wet=x>=31&&x<=34;
        let height=!wet&&x===30&&z>=15&&z<=18?2.5:1;
        if(x===33&&z===12)height=1.4;
        if((x===31||x===32)&&(z===31||z===32))height=1+((x-31)*2+z-31)*.15;
        updates.push({chunk_x:x>>5,chunk_y:z>>5,tile_x:x%32,tile_y:z%32,updates:{terrain:wet?'water':x<31?'grass':'sand',height,objects:[]}});
    }
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.until("sceneModule.chunksMap.get('1,1')?.waterSurface&&sceneModule.chunksMap.get('0,0').tilesData[16][30].height===2.5",'four-chunk river');await pause(800);
    await page.evaluate(`(async()=>{window.W=sceneModule;window.T=threeModule;window.at=(x,z)=>W.chunksMap.get(Math.floor(x/32)+','+Math.floor(z/32))?.tilesData[z%32]?.[x%32];window.look=(x,y,z,tx,ty,tz)=>{W.controls.target.set(tx,ty,tz);W.camera.position.set(x,y,z);W.controls.update();W.camera.updateMatrixWorld(true)};window.checkSeams=()=>{const edge=(cx,cz,field,axis,n)=>{const m=W.chunksMap.get(cx+','+cz)[field],a=m?.geometry.attributes.position,out=[];if(!a)return [];for(let i=0;i<a.count;i++){const p=[a.getX(i)+m.position.x,a.getY(i)+m.position.y,a.getZ(i)+m.position.z];if(Math.abs(p[axis]-n)<1e-5){if(field==='waterBank'){const across=axis===0?[[n-1,Math.floor(p[2]-1e-5)],[n,Math.floor(p[2]-1e-5)],[n-1,Math.floor(p[2]+1e-5)],[n,Math.floor(p[2]+1e-5)]]:[[Math.floor(p[0]-1e-5),n-1],[Math.floor(p[0]-1e-5),n],[Math.floor(p[0]+1e-5),n-1],[Math.floor(p[0]+1e-5),n]];if(!across.every(([x,z])=>at(x,z)?.terrain==='water'))continue;}out.push(p.map(x=>Math.round(x*1e4)).join(','));}}return [...new Set(out)].sort()};const results=[];for(const field of ['waterSurface','waterBank'])for(const [a,b,axis,n] of [[[0,0],[1,0],0,32],[[0,1],[1,1],0,32],[[0,0],[0,1],2,32],[[1,0],[1,1],2,32]]){const left=edge(...a,field,axis,n),right=edge(...b,field,axis,n);if(JSON.stringify(left)!==JSON.stringify(right))throw Error('Seam '+field+' '+a+' '+b);results.push({field,a,b,vertices:left.length});}return results};window.auditDataBefore=JSON.stringify([...W.chunksMap.values()].map(e=>e.tilesData));await W.getWorldTerrainMaterialDiagnostics();})()`);
    await page.until('W.getWorldTerrainMaterialDiagnostics().ready','PBR textures');
    const seams=await page.evaluate('checkSeams()');
    if(process.env.VTT_FORCE_WEBGL1==='1'){
        const capabilities=await page.evaluate(`(()=>{W.renderer.render(W.scene,W.camera);return {version:W.renderer.getContext().getParameter(W.renderer.getContext().VERSION),webgl2:W.renderer.capabilities.isWebGL2,programs:W.renderer.info.programs.map(p=>({runnable:p.diagnostics?.runnable!==false}))}})()`);
        assert.equal(capabilities.webgl2,false);assert.ok(capabilities.programs.every(p=>p.runnable));
        fs.writeFileSync(path.join(output,'webgl1.json'),JSON.stringify({capabilities,seams},null,2)+'\n');console.log('PASS: real WebGL1 water/shore shaders and four chunks');return;
    }
    const data={waypoints:[[28,7],[38,7]],allow_bridges:true,settings:{scale:1,color:'#756f61'}};
    const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,data,token);assert.ok(plan.bridges>0);
    await page.evaluate(`W.showWorldRoadPreview(${JSON.stringify(plan)},{scale:1})`);
    await page.until('W.scene.children.some(m=>m.userData.worldBridgeAsset&&m.userData.roadRoutePreview)','bridge preview');
    const shot=async(name,cam)=>{await page.evaluate(`look(${cam.join(',')})`);await pause(300);if(process.env.VTT_WATER_SKIP_CAPTURE==='1')return;fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    await shot('bridge-preview',[36,4,12,32.5,1,7.5]);await page.evaluate('W.removeWorldRoadPreview()');
    await request(`/lobbies/${lobby.id}/world-roads/build`,{...data,signature:plan.signature},token);
    await page.until("W.chunksMap.get('1,0').roads.some(m=>m.userData.worldBridgeAsset)",'saved bridge');
    await shot('former-cube',[36,3.4,16,33.5,1.2,12.5]);
    await shot('high-bank',[33,4.4,21,30.8,1.5,17]);
    await shot('two-chunks',[36,4,12,32.5,1,7.5]);
    await shot('four-chunks',[36,5,37,32,1.2,32]);
    await shot('river-overview',[48,34,55,32,1,32]);
    // Reconstruct the pre-fix geometry and side shading only inside this test.
    await page.evaluate(`(async()=>{const water=await import('/static/js/locationWaterEdge.js'),layerModule=await import('/static/js/terrainMaterialLayer.js'),detail=await import('/static/js/locationTerrainDetail.js');const layer=layerModule.createTerrainMaterialLayer(T,{world:true});layer.resize(64,64);for(const e of W.chunksMap.values())layer.fill(e.tilesData,e.chunkX*32,e.chunkY*32);window.legacyWater=[];const bankMat=new T.MeshStandardMaterial({map:detail.getSurfaceTexture(T,'local_terrain'),vertexColors:true,side:T.DoubleSide,roughness:.97});layer.apply(bankMat);for(const e of W.chunksMap.values()){const ox=e.chunkX*32-1,oz=e.chunkY*32-1,tiles=Array.from({length:34},(_,z)=>Array.from({length:34},(_,x)=>at(x+ox,z+oz)||null)),d=water.buildRoundedWaterData(tiles,.24,(x,z)=>x>0&&x<=32&&z>0&&z<=32,[0,.075,.23,.5,.77,.925,1],t=>Number(t.height)||1);for(const [positions,colors,mat,dy]of[[d.water,null,W.waterMat,0],[[...d.bank,...d.sandBank],[...d.bankBaseColors,...d.sandBankColors],bankMat,-.018]]){if(!positions.length)continue;const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));if(colors){g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setAttribute('uv',new T.Float32BufferAttribute(positions.flatMap((v,i)=>i%3===0?[(v+ox)*.25,(positions[i+2]+oz)*.25]:[]),2));}g.computeVertexNormals();const m=new T.Mesh(g,mat);m.position.set(ox,dy,oz);m.frustumCulled=false;m.receiveShadow=!!colors;m.visible=false;W.scene.add(m);legacyWater.push(m);}}window.legacyLand=[];const materialCache=new Map();for(const e of W.chunksMap.values())for(const m of [e.ground,e.smoothTerrain]){if(!m)continue;const actual=m.material;if(!materialCache.has(actual)){const clone=actual.clone(),compile=actual.onBeforeCompile;clone.onBeforeCompile=(shader,renderer)=>{compile.call(actual,shader,renderer);const start=shader.fragmentShader.indexOf('// Grass has no PBR'),end=shader.fragmentShader.indexOf('terrainAccumulate(sideId',start);if(start>=0&&end>start)shader.fragmentShader=shader.fragmentShader.slice(0,start)+shader.fragmentShader.slice(end);};clone.customProgramCacheKey=()=>actual.customProgramCacheKey()+':before-water-fix';materialCache.set(actual,clone);}legacyLand.push({mesh:m,actual,old:materialCache.get(actual)});}window.waterMode=old=>{for(const e of W.chunksMap.values()){e.waterSurface.visible=!old;e.waterBank.visible=!old;const hidden=e.water.material[2];e.water.material=old?[W.waterMat,W.waterMat,hidden,W.waterMat,W.waterMat,W.waterMat]:Array(6).fill(hidden);}legacyWater.forEach(m=>m.visible=old);legacyLand.forEach(p=>p.mesh.material=old?p.old:p.actual);};window.waterGeometryCount=()=>[...W.chunksMap.values()].map(e=>({chunk:[e.chunkX,e.chunkY],waterTriangles:e.waterSurface.geometry.attributes.position.count/3,bankTriangles:e.waterBank.geometry.attributes.position.count/3,bytes:[e.waterSurface,e.waterBank].reduce((n,m)=>n+Object.values(m.geometry.attributes).reduce((s,a)=>s+a.array.byteLength,0),0)}));})()`);
    const geometry=await page.evaluate('waterGeometryCount()');
    await page.evaluate('waterMode(true)');await shot('before-cube',[36,3.4,16,33.5,1.2,12.5]);await shot('before-high-bank',[33,4.4,21,30.8,1.5,17]);
    await page.evaluate('look(48,34,55,32,1,32)');await pause(800);
    const performance=process.env.VTT_WATER_SKIP_PERF==='1'?JSON.parse(fs.readFileSync(path.join(output,'performance.json'),'utf8')).performance:await page.evaluate(`(()=>{const r=W.renderer,gl=r.getContext(),p=new Uint8Array(4),sample=()=>{const s=performance.now();r.render(W.scene,W.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return {ms:performance.now()-s,calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures}},measure=()=>{sample();const a=[sample(),sample(),sample()].sort((a,b)=>a.ms-b.ms);return {...a[1],fps:1000/a[1].ms}};waterMode(true);const before=measure();waterMode(false);const after=measure();return {before,after}})()`);
    fs.writeFileSync(path.join(output,'performance.json'),JSON.stringify({performance,geometry},null,2)+'\n');console.log('Water performance:',JSON.stringify(performance));
    await page.evaluate('waterMode(false);legacyWater.forEach(m=>{W.scene.remove(m);m.geometry.dispose()});legacyLand=[]');
    // Real editor pointer-down keeps the live brush preview active before release.
    await page.evaluate(`(async()=>{window.E=await import('/static/js/mapEdit.js');window.toggleEditMode();E.selectWorldEditorTool('height',{autoExpand:false});E.setBrushRadius(0);E.setTileHeightFromInput(1.8);look(35,9,39,31.5,1.2,31.5)})()`);
    const pointer=await page.evaluate(`(()=>{const p=new T.Vector3(31.5,at(31,31).height+.012,31.5).project(W.camera),rect=W.renderer.domElement.getBoundingClientRect();return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}})()`);
    await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...pointer});await pause(200);
    await page.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...pointer});
    await page.until('at(31,31).height===1.8','held height brush');await pause(400);
    const previewSeams=await page.evaluate('checkSeams()');
    await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...pointer});await pause(800);
    await page.evaluate('window.toggleEditMode()');const finalSeams=await page.evaluate('checkSeams()');
    for(const terrain of ['grass','water','grass','water']){await request(`/lobbies/${lobby.id}/chunks/1/1/tile/0/1`,{terrain},token,'PATCH');await page.until(`at(32,33).terrain===${JSON.stringify(terrain)}`,'land-water transition');await pause(400);await page.evaluate('checkSeams()');}
    await shot('edited-four-chunks',[36,5,37,32,1.2,32]);
    const target=await(await fetch('http://127.0.0.1:'+debugPort+'/json/new?'+encodeURIComponent(base+'/lobbies/'+lobby.id+'/page'),{method:'PUT'})).json(),peer=await connect(target.webSocketDebuggerUrl);
    try{
        await peer.call('Runtime.enable');await peer.call('Page.enable');await peer.until('window.isGM','second client');await peer.evaluate("(async()=>{window.P=await import('/static/js/lobby3d.js')})()");
        await peer.until("Boolean(P.chunksMap.get('1,1')?.waterSurface)",'peer water');
        await request(`/lobbies/${lobby.id}/chunks/1/1/tile/0/0`,{height:1.7},token,'PATCH');
        await peer.until("P.chunksMap.get('1,1').tilesData[0][0].height===1.7",'peer synced height');
        await page.call('Page.bringToFront');await page.until('at(32,32).height===1.7','first client data');await pause(600);await page.evaluate('checkSeams()');
        const saved=await page.evaluate('JSON.stringify([...W.chunksMap.values()].sort((a,b)=>a.chunkY-b.chunkY||a.chunkX-b.chunkX).map(e=>e.tilesData))');
        await page.call('Page.reload');await page.until('window.isGM','reload');await page.evaluate("(async()=>{window.W=await import('/static/js/lobby3d.js')})()");await page.until("W.chunksMap.size===4&&[...W.chunksMap.values()].every(e=>e.waterSurface)&&W.chunksMap.get('1,0').roads?.some(m=>m.userData.worldBridgeAsset)",'reloaded chunks');
        assert.deepEqual(JSON.parse(await page.evaluate('JSON.stringify([...W.chunksMap.values()].sort((a,b)=>a.chunkY-b.chunkY||a.chunkX-b.chunkX).map(e=>e.tilesData))')),JSON.parse(saved));
    }finally{await peer.call('Page.close').catch(()=>{});peer.close();}
    const result={seams,previewSeams,finalSeams,geometry,performance,heldBrush:true,landWaterLand:true,bridge:true,bridgePreview:true,saveReload:true,peerSync:true,renderer:'Chrome SwiftShader; material and lighting unchanged; legacy geometry reconstructed only in test'};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS water geometry:',JSON.stringify(result));
};
