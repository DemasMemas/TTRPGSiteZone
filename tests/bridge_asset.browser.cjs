const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const waterTest=process.env.VTT_BRIDGE_WATER_ONLY==='1';
    const output=path.resolve(__dirname,waterTest?'../docs/material-previews/bridge-water':process.env.VTT_BRIDGE_SEAM_ONLY==='1'?'../docs/material-previews/bridge-seam':'../docs/material-previews/bridge-asset');fs.mkdirSync(output,{recursive:true});
    const updates=[];
    for(let z=0;z<32;z++)for(let x=23;x<64;x++){
        const water=(x>=31&&x<=35&&!(x>=32&&z>=5&&z<=9))||(z>=22&&z<=25&&x>=36);
        updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,updates:{terrain:water?'water':'sand',height:water?(waterTest?1:.4):(x>=36&&z>=17&&z<=21?2:1),objects:[]}});
    }
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.until("sceneModule.chunksMap.get('1,0').tilesData[14][0].terrain==='water'",'fixture');await pause(700);
    const routes=[[[28,7],[38,7]],[[26,19],[38,19]],[[42,20],[42,28]]];
    for(const points of routes){
        const data={waypoints:points,allow_bridges:true,settings:{scale:1,color:'#756f61'}};
        const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,data,token);
        assert.ok(plan.bridges>0);
        if(process.env.VTT_BRIDGE_PREVIEW_ONLY==='1'){
            await page.evaluate(`sceneModule.showWorldRoadPreview(${JSON.stringify(plan)},{scale:1});sceneModule.controls.target.set(31.5,1,7.5);sceneModule.camera.position.set(33,3.7,11);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld(true)`);
            await page.until('sceneModule.scene.children.some(m=>m.userData.worldBridgeAsset&&m.userData.roadRoutePreview)','original model before construction');
            assert.equal(await page.evaluate("sceneModule.chunksMap.get('0,0').tilesData[7][31].objects.length"),0);
            fs.writeFileSync(path.join(output,'preview-before-build.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
            await page.evaluate('sceneModule.removeWorldRoadPreview()');
            assert.equal(await page.evaluate('sceneModule.scene.children.some(m=>m.userData.roadRoutePreview)'),false);
            console.log('PASS: original GLB preview before construction, no saved bridge, clean cancellation');return;
        }
        await request(`/lobbies/${lobby.id}/world-roads/build`,{...data,signature:plan.signature},token);
    }
    await page.until("[...sceneModule.chunksMap.values()].filter(e=>e.roads.some(m=>m.userData.worldBridgeAsset)).length===2",'original bridge asset on both chunks');
    await page.evaluate(`(async()=>{window.bridgeModule=await import('/static/js/worldRoadBridge.js');window.bridgeResources=await bridgeModule.loadWorldRoadBridge();window.roadTopology=await import('/static/js/worldRoadTopology.js');window.roadSurface=await import('/static/js/worldRoadSurface.js');window.look=(x,y,z,tx,ty,tz)=>{sceneModule.controls.target.set(tx,ty,tz);sceneModule.camera.position.set(x,y,z);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld(true)};look(44,16,34,33,1,16)})()`);
    const shot=async name=>{await pause(300);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    if(waterTest){
        // Sample the actual transformed asphalt triangles over the wet cell,
        // rather than trusting the layout calculation alone.
        await page.evaluate(`window.checkWaterBridge=(preview=false)=>{const T=threeModule,W=sceneModule,matrix=new T.Matrix4(),meshes=preview?W.scene.children:[...W.chunksMap.values()].flatMap(e=>e.roads);let samples=0,min=Infinity;for(const m of meshes.filter(m=>m.userData.bridgePart==='deck_3'&&!!m.userData.roadRoutePreview===preview)){const a=m.geometry.attributes.position;for(let i=0;i<m.count;i++){if(m.userData.bridgeOwners[i].x!==31||m.userData.bridgeOwners[i].z!==7)continue;m.getMatrixAt(i,matrix);for(let j=0;j<a.count;j+=3){const v=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(a,j+k).applyMatrix4(matrix));for(let u=0;u<=20;u++)for(let q=0;q<=20-u;q++){const p=v[0].clone().multiplyScalar(u/20).addScaledVector(v[1],q/20).addScaledVector(v[2],1-(u+q)/20);if(p.x>31.001&&p.x<31.999){min=Math.min(min,p.y);samples++;}}}}}if(!samples)throw Error('No asphalt sampled');const tile=W.chunksMap.get('0,0').tilesData[7][31],water=(Number(tile.height)||1)+.012;if(min<water+.0249)throw Error('Submerged asphalt: '+min+' water '+water);return {samples,minimumAsphalt:min,water,clearance:min-water};}`);
        const equal=await page.evaluate('checkWaterBridge()');
        await page.evaluate('look(33,3.7,11,31.5,1,7.5)');await shot('equal-level');
        const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,{waypoints:routes[0],allow_bridges:true,settings:{scale:1,color:'#756f61'}},token);
        await page.evaluate(`sceneModule.showWorldRoadPreview(${JSON.stringify(plan)},{scale:1})`);
        const preview=await page.evaluate('checkWaterBridge(true)');await shot('preview');await page.evaluate('sceneModule.removeWorldRoadPreview()');
        await request(`/lobbies/${lobby.id}/chunks/0/0/tile/31/7`,{height:1.2},token,'PATCH');
        await page.until("sceneModule.chunksMap.get('0,0').tilesData[7][31].height===1.2",'raised water data');
        await page.until("(()=>{try{return checkWaterBridge().minimumAsphalt>1.23}catch{return false}})()",'bridge follows raised water');
        const raised=await page.evaluate('checkWaterBridge()');await shot('raised-water');
        const banks=await page.evaluate("[sceneModule.chunksMap.get('0,0').tilesData[7][30].height,sceneModule.chunksMap.get('1,0').tilesData[7][0].height]");assert.deepEqual(banks,[1,1]);
        fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({equal,preview,raised,unchangedBankHeights:banks},null,2)+'\n');
        console.log('PASS: actual asphalt above equal/raised water, live update, preview, unchanged banks:',JSON.stringify({equal,preview,raised}));return;
    }
    if(process.env.VTT_BRIDGE_SEAM_ONLY==='1'){
        const verify=`(meshes,banks)=>banks.map(([x,z,dx,dz])=>{const px=x+.5,pz=z+.5;let triangles=0;for(const m of meshes){const a=m.geometry.attributes.position.array;for(let i=0;i<a.length;i+=9){const v=[0,3,6].map(j=>[a[i+j],a[i+j+2]]);if(v.every(p=>Math.abs(p[0]-px)<.161&&Math.abs(p[1]-pz)<.161)){triangles++;if(v.some(p=>(p[0]-px)*dx+(p[1]-pz)*dz>1e-6))throw new Error('Road overlaps bridge at '+[x,z]);}}}return {x,z,triangles};})`;
        const banks=[[30,7,1,0],[32,7,-1,0],[30,19,1,0],[36,19,-1,0],[42,21,0,1],[42,26,0,-1]];
        const saved=await page.evaluate(`(${verify})([...sceneModule.chunksMap.values()].flatMap(e=>e.roads).filter(m=>m.userData.roadSurface),${JSON.stringify(banks)})`);
        assert.ok(saved.every(b=>b.triangles>0),'all six land junctions checked');
        await page.evaluate('look(33,3.7,11,31.5,1,7.5)');await shot('short-close');
        await page.evaluate('look(33.5,2.4,9.5,32.5,1,7.5)');await shot('chunk-seam-close');
        await page.evaluate('look(36,5.5,26,32.5,1.5,19.5)');await shot('unequal-banks');
        await page.evaluate('look(46,4.5,29,42.5,1.5,24)');await shot('north-close');
        const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,{waypoints:routes[0],allow_bridges:true,settings:{scale:1,color:'#756f61'}},token);
        await page.evaluate(`sceneModule.showWorldRoadPreview(${JSON.stringify(plan)},{scale:1})`);
        const preview=await page.evaluate(`(${verify})(sceneModule.scene.children.filter(m=>m.userData.roadRoutePreview&&m.userData.roadSurface),${JSON.stringify(banks.slice(0,2))})`);
        assert.ok(preview.every(b=>b.triangles>0));
        await page.evaluate('look(33.5,2.4,9.5,32.5,1,7.5)');await shot('preview-seam');await page.evaluate('sceneModule.removeWorldRoadPreview()');
        fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({saved,preview,noOverlap:true},null,2)+'\n');
        console.log('PASS: no road/bridge overlap at six bank junctions, both axes, slope, chunk boundary, preview');return;
    }
    await shot('overview');await page.evaluate('look(33,3.7,11,31.5,1,7.5)');await shot('short-close');
    await page.evaluate('look(36,5.5,26,32.5,1.5,19.5)');await shot('unequal-banks');
    await page.evaluate('look(53,32,45,33,1,16)');await shot('distant');
    const shape=await page.evaluate(`(()=>{const all=[...sceneModule.chunksMap.values()].flatMap(e=>e.roads).filter(m=>m.userData.worldBridgeAsset);return {batches:all.length,parts:[...new Set(all.map(m=>m.userData.bridgePart))],instances:all.map(m=>({part:m.userData.bridgePart,count:m.count})),geometries:new Set(all.map(m=>m.geometry)).size,materials:new Set(all.map(m=>m.material)).size,textureBytes:[...new Set(bridgeResources.parts.flatMap(p=>[p.material.map,p.material.normalMap]).filter(Boolean))].reduce((n,t)=>n+t.image.width*t.image.height*4*4/3,0)}})()`);
    assert.equal(shape.parts.length,5);assert.equal(shape.geometries,5);assert.equal(shape.materials,4);
    const previewData={waypoints:routes[1],allow_bridges:true,settings:{scale:1,color:'#756f61'}};
    const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,previewData,token);
    await page.evaluate(`sceneModule.showWorldRoadPreview(${JSON.stringify(plan)},{scale:1})`);
    assert.ok(await page.evaluate('sceneModule.scene.children.some(m=>m.userData.roadRoutePreview&&m.userData.worldBridgeAsset)'));
    await page.evaluate('look(36,5.5,26,32.5,1.5,19.5)');await shot('preview');await page.evaluate('sceneModule.removeWorldRoadPreview()');
    const westBefore=await page.evaluate("Array.from(sceneModule.chunksMap.get('0,0').roads.find(m=>m.userData.bridgePart==='deck_3').instanceMatrix.array)");
    await request(`/lobbies/${lobby.id}/chunks/1/0/tile/4/19`,{height:2.4},token,'PATCH');
    await page.until(`JSON.stringify(Array.from(sceneModule.chunksMap.get('0,0').roads.find(m=>m.userData.bridgePart==='deck_3').instanceMatrix.array))!==${JSON.stringify(JSON.stringify(westBefore))}`,'bank edit updates the whole span across chunks');
    // Select an actual model instance, not the former fixed-height road box.
    const pick=await page.evaluate(`(()=>{const T=threeModule;sceneModule.scene.updateMatrixWorld(true);const m=[...sceneModule.chunksMap.values()].flatMap(e=>e.roads).find(m=>m.userData.bridgePart==='deck_3'&&m.userData.bridgeOwners.some(o=>o.x===32&&o.z===19));const i=m.userData.bridgeOwners.findIndex(o=>o.x===32&&o.z===19),matrix=new T.Matrix4();m.getMatrixAt(i,matrix);const p=new T.Vector3().setFromMatrixPosition(matrix).project(sceneModule.camera),rect=sceneModule.renderer.domElement.getBoundingClientRect();return sceneModule.pickWorldObject(rect.left+(p.x+1)*rect.width/2,rect.top+(1-p.y)*rect.height/2)})()`);
    assert.ok(pick&&pick.tileY===19,'bridge model resolves to an editable saved road');
    // Same-camera baseline reconstructs only the previous technical bridge
    // renderer from the same saved routes; it is never an application fallback.
    await page.evaluate(`(()=>{
        const T=threeModule,W=sceneModule;W.controls.target.set(33,1,16);W.camera.position.set(44,16,34);W.controls.update();W.camera.updateMatrixWorld(true);
    })()`);
    await pause(1000);
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.ok(await page.evaluate('[...sceneModule.chunksMap.values()].every(e=>e.terrainVisible)'), 'full terrain visible in performance camera');
    await page.evaluate(`(async()=>{window.roadTopology=await import('/static/js/worldRoadTopology.js');window.roadSurface=await import('/static/js/worldRoadSurface.js');window.bridgeResources=await (await import('/static/js/worldRoadBridge.js')).loadWorldRoadBridge()})()`);
    const performance=await page.evaluate(`(()=>{
        const T=threeModule,W=sceneModule,r=W.renderer,gl=r.getContext(),pixel=new Uint8Array(4),legacy=[];
        const at=(x,z)=>W.chunksMap.get(Math.floor(x/32)+','+Math.floor(z/32))?.tilesData[z%32]?.[x%32],node=(x,z)=>roadTopology.roadNode(at(x,z));
        const pads=[],links=[],poses=[];const point=(x,z)=>({x:x+.5,z:z+.5,y:roadTopology.roadSurfaceHeight(at(x,z),node(x,z)?.road)});
        for(const e of W.chunksMap.values())e.tilesData.forEach((row,z)=>row.forEach((tile,x)=>{x+=e.chunkX*32;z+=e.chunkY*32;const n=node(x,z);if(!n?.road)return;const p=point(x,z);pads.push({position:p,bridge:n.road.bridge});if(n.road.bridge)poses.push({p,north:roadTopology.roadConnectsAt(node,x,z,0,1)||roadTopology.roadConnectsAt(node,x,z,0,-1)});for(const [dx,dz]of[[1,0],[0,1],[1,1],[-1,1]])if(roadTopology.roadConnectsAt(node,x,z,dx,dz))links.push({from:p,to:point(x+dx,z+dz),bridge:n.road.bridge||node(x+dx,z+dz)?.road?.bridge});}));
        const a=[],normals=[];const box=(w,h,d,x,y,z)=>{const g=new T.BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);a.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);g.dispose()};
        for(const side of[-1,1]){box(1,.025,.025,0,.14,side*.17);for(const x of[-.4,.4])box(.025,.16,.025,x,.07,side*.17)}for(const x of[-.3,.3])box(.06,.5,.28,x,-.25,0);
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
        const material=new T.MeshStandardMaterial({color:'#777b78'}),d=new T.Object3D();
        const roadMaterial=[...W.chunksMap.values()].flatMap(e=>e.roads).find(m=>m.userData.roadSurface).material;
        for(const e of W.chunksMap.values()){
            const owns=p=>Math.floor(p.x/32)===e.chunkX&&Math.floor(p.z/32)===e.chunkY,items=poses.filter(o=>owns(o.p));
            if(items.length){const frames=new T.InstancedMesh(g,material,items.length);items.forEach(({p,north},i)=>{d.position.set(p.x,p.y,p.z);d.rotation.y=north?Math.PI/2:0;d.updateMatrix();frames.setMatrixAt(i,d.matrix)});frames.frustumCulled=false;W.scene.add(frames);legacy.push(frames);}
            const data=roadSurface.buildRoadSurface({pads:pads.filter(o=>owns(o.position)),links:links.filter(o=>owns(o.from)),getTile:at}),surface=new T.BufferGeometry();surface.setAttribute('position',new T.BufferAttribute(data.positions,3));surface.setAttribute('color',new T.BufferAttribute(data.colors,3));surface.computeVertexNormals();
            const road=new T.Mesh(surface,roadMaterial);road.frustumCulled=false;W.scene.add(road);legacy.push(road);
        }
        const actual=[...W.chunksMap.values()].flatMap(e=>e.roads),mode=old=>{actual.forEach(m=>m.visible=!old);legacy.forEach(m=>m.visible=old)};
        const sample=()=>{r.shadowMap.needsUpdate=false;const start=performance.now();r.render(W.scene,W.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const ms=performance.now()-start;return {ms,fps:1000/ms,calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures}};
        const measure=()=>{sample();return [sample(),sample(),sample()].sort((a,b)=>a.ms-b.ms)[1]};
        mode(true);const old=measure();mode(false);const asset=measure();
        const vertexBytes=bridgeResources.parts.reduce((n,p)=>n+Object.values(p.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0),0),instanceBytes=actual.filter(m=>m.userData.worldBridgeAsset).reduce((n,m)=>n+m.instanceMatrix.array.byteLength,0);
        legacy.forEach(m=>{W.scene.remove(m);if(m.geometry!==g)m.geometry.dispose();if(m.isInstancedMesh)m.dispose()});g.dispose();material.dispose();return {old,asset,vertexBytes,instanceBytes};
    })()`);
    const target=await(await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${base}/lobbies/${lobby.id}/page`)}`,{method:'PUT'})).json();
    const peer=await connect(target.webSocketDebuggerUrl);
    try{
        await peer.call('Runtime.enable');await peer.call('Page.enable');await peer.until('window.isGM','peer');
        await peer.evaluate("(async()=>{window.W=await import('/static/js/lobby3d.js')})()");
        await peer.until("[...W.chunksMap.values()].some(e=>e.roads.some(m=>m.userData.worldBridgeAsset))",'peer original asset');
        const source={tile_x:32,tile_y:19,index:0};
        let expected=await page.evaluate("sceneModule.chunksMap.get('1,0').tilesData[19][0].objects[0]");
        await request(`/lobbies/${lobby.id}/world-objects/edit`,{source,target:source,expected,changes:{name:'Asset bridge edited'}},token);
        await peer.until("W.chunksMap.get('1,0').tilesData[19][0].objects[0].name==='Asset bridge edited'",'live peer edit');
        // Delete the short bridge node using the existing guarded object API.
        expected=await page.evaluate("sceneModule.chunksMap.get('0,0').tilesData[7][31].objects[0]");
        const short={tile_x:31,tile_y:7,index:0};
        await request(`/lobbies/${lobby.id}/world-objects/edit`,{source:short,target:short,expected,changes:{},delete:true},token);
        await peer.until("W.chunksMap.get('0,0').tilesData[7][31].objects.length===0",'peer deletion');
        await page.call('Page.bringToFront');
        await page.until("!sceneModule.chunksMap.get('0,0').roads.some(m=>m.userData.bridgeOwners?.some(o=>o.x===31&&o.z===7))",'short bridge instances removed');
        await page.call('Page.reload');await page.until('window.isGM','reload');
        await page.evaluate("(async()=>{window.sceneModule=await import('/static/js/lobby3d.js');window.threeModule=await import('three')})()");
        await page.until("sceneModule.chunksMap.get('1,0')?.roads?.some(m=>m.userData.worldBridgeAsset)",'reload original model');
        await page.until("window.getWorldLoadDiagnostics?.().fullLoadMs>0&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'complete terrain reload before measurements');
        assert.equal(await page.evaluate("sceneModule.chunksMap.get('1,0').tilesData[19][0].objects[0].name"),'Asset bridge edited');
        assert.equal(await page.evaluate("sceneModule.chunksMap.get('0,0').tilesData[7][31].objects.length"),0);
    }finally{await peer.call('Page.close').catch(()=>{});peer.close();}
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({shape,pick,short:true,long:true,north:true,unequalBanks:true,preview:true,edit:true,delete:true,reload:true,peerSync:true,chunkSeam:true,performance},null,2)+'\n');
    console.log('PASS: original model, short/long/north/slope bridges, preview, model picking, edit/delete, peer/reload, chunks; performance:',JSON.stringify({shape,performance}));
};
