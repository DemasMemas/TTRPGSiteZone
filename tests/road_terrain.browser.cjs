const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/road-terrain');fs.mkdirSync(output,{recursive:true});
    const updates=[];
    for(let z=5;z<24;z++)for(let x=20;x<45;x++)updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,
        updates:{terrain:'sand',height:(x<=29?5:1)+(z<=11?3:0)+(x===33&&z>=13&&z<=17?5:0),objects:[]}});
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    const route=[[25,10],[29,10],[33,10],[37,14],[33,18],[29,18],[25,14],[25,10]];
    for(let i=1;i<route.length;i++){
        const data={waypoints:[route[i-1],route[i]],allow_bridges:false,settings:{scale:1,color:'#756f61'}};
        const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,data,token);
        await request(`/lobbies/${lobby.id}/world-roads/build`,{...data,signature:plan.signature},token);
    }
    await page.evaluate(`(async()=>{window.editor=await import('/static/js/mapEdit.js');window.topology=await import('/static/js/worldRoadTopology.js');
        window.look=(x,y,z,tx,ty,tz)=>{sceneModule.controls.target.set(tx,ty,tz);sceneModule.camera.position.set(x,y,z);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld(true)};
        look(40,20,30,31,3,14);if(document.getElementById('gm-only-controls').style.display!=='none')window.toggleEditMode();
    })()`);
    await page.until("sceneModule.chunksMap.get('1,0').roads.some(m=>m.userData.roadSurface)",'surface batches');
    const shot=async name=>{await pause(500);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    // Reconstruct the previous endpoint boxes for a same-camera diagnostic comparison only.
    await page.evaluate(`(()=>{
        const T=threeModule,W=sceneModule,at=(x,z)=>W.chunksMap.get(Math.floor(x/32)+','+Math.floor(z/32))?.tilesData[z%32]?.[x%32],node=(x,z)=>topology.roadNode(at(x,z));
        const pads=[],links=[],point=(x,z,n)=>new T.Vector3(x+.5+(n.road?.x||0),topology.roadSurfaceHeight(at(x,z),n.road),z+.5+(n.road?.z||0));
        for(const e of W.chunksMap.values())e.tilesData.forEach((row,z)=>row.forEach((tile,x)=>{
            const gx=e.chunkX*32+x,gz=e.chunkY*32+z,n=node(gx,gz);if(!n?.road)return;
            pads.push(point(gx,gz,n));for(const [dx,dz] of [[1,0],[0,1],[1,1],[-1,1]])if(topology.roadConnectsAt(node,gx,gz,dx,dz))links.push([point(gx,gz,n),point(gx+dx,gz+dz,node(gx+dx,gz+dz))]);
        }));
        window.legacyRoads=[];const mat=[...W.chunksMap.values()].flatMap(e=>e.roads).find(m=>m.userData.roadSurface).material;
        for(const [geo,items,isLink] of [[new T.BoxGeometry(.32,.028,.32),pads,false],[new T.BoxGeometry(1,.028,.24),links,true]]){
            const mesh=new T.InstancedMesh(geo,mat,items.length),dummy=new T.Object3D();mesh.frustumCulled=false;
            items.forEach((item,i)=>{if(isLink){const [a,b]=item,d=b.clone().sub(a);dummy.position.copy(a).add(b).multiplyScalar(.5);dummy.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),d.clone().normalize());dummy.scale.set(d.length(),1,1);}else{dummy.position.copy(item);dummy.rotation.set(0,0,0);dummy.scale.set(1,1,1);}
                dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new T.Color('#756f61'));});mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;W.scene.add(mesh);legacyRoads.push(mesh);
        }
        window.roadMode=legacy=>{for(const e of W.chunksMap.values())for(const m of e.roads)m.visible=!legacy;legacyRoads.forEach(m=>m.visible=legacy);};roadMode(true);
    })()`);
    await shot('before-endpoint-boxes');await page.evaluate('roadMode(false)');await shot('after-terrain-surface');
    await page.evaluate('look(37,10,24,32,3,15)');await shot('close-diagonal');
    const verify=`(()=>{
        let min=Infinity,max=-Infinity,checked=0,triangles=0;const surfaces=[...sceneModule.chunksMap.values()].flatMap(e=>e.roads).filter(m=>m.userData.roadSurface);
        for(const m of surfaces){const a=m.geometry.attributes.position.array;triangles+=a.length/9;
            for(let i=0;i<a.length;i+=9){const x=(a[i]+a[i+3]+a[i+6])/3,y=(a[i+1]+a[i+4]+a[i+7])/3,z=(a[i+2]+a[i+5]+a[i+8])/3;
                const gap=y-sceneModule.sampleWorldGroundHeight(x,z);min=Math.min(min,gap);max=Math.max(max,gap);checked++;}}
        return {minGap:min,maxGap:max,checked,triangles,batches:surfaces.length};
    })()`;
    const before=await page.evaluate(verify);assert.ok(before.minGap>.0058&&before.maxGap<.0102,JSON.stringify(before));
    // Show the same conformed geometry in the actual road tool preview.
    await page.evaluate(`if(document.getElementById('gm-only-controls').style.display==='none')window.toggleEditMode();editor.selectWorldEditorTool('objects');editor.selectWorldObject('road')`);
    const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,{waypoints:[[28,13],[34,19]],settings:{scale:1,color:'#756f61'}},token);
    await page.evaluate(`sceneModule.showWorldRoadPreview(${JSON.stringify(plan)},{scale:1,color:'#756f61'})`);await shot('preview-slope');
    await page.evaluate('sceneModule.removeWorldRoadPreview();editor.selectWorldEditorTool("select")');
    const oldSurfaces=await page.evaluate(`(()=>{window.disposedRoadSurfaces=0;const m=[...sceneModule.chunksMap.values()].flatMap(e=>e.roads).filter(m=>m.userData.roadSurface);for(const s of m)s.geometry.addEventListener('dispose',()=>window.disposedRoadSurfaces++);return m.length})()`);
    await request(`/lobbies/${lobby.id}/chunks/0/0/tile/31/18`,{height:9},token,'PATCH');
    await page.until('window.disposedRoadSurfaces>0','local height edit replaces surface geometry');await pause(800);
    const after=await page.evaluate(verify);assert.ok(after.minGap>.0058&&after.maxGap<.0102,JSON.stringify(after));
    await shot('after-height-edit-seam');
    const performance=await page.evaluate(`(async()=>{
        const W=sceneModule,r=W.renderer,gl=r.getContext(),pixel=new Uint8Array(4);
        const sample=()=>{r.shadowMap.needsUpdate=false;const start=performance.now();r.render(W.scene,W.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return {ms:performance.now()-start,calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures,geometries:r.info.memory.geometries}};
        const measure=()=>{sample();const v=[sample(),sample(),sample()].sort((a,b)=>a.ms-b.ms);return v[1]};
        roadMode(true);const legacy=measure();roadMode(false);const terrain=measure();
        const buffers=[...W.chunksMap.values()].flatMap(e=>e.roads).filter(m=>m.userData.roadSurface).reduce((n,m)=>n+Object.values(m.geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0),0);
        legacyRoads.forEach(m=>{W.scene.remove(m);m.geometry.dispose();m.dispose()});return {legacy,terrain,surfaceBufferBytes:buffers};
    })()`);
    await page.call('Page.reload');await page.until('window.isGM&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','reload');
    await page.evaluate(`(async()=>{window.sceneModule=await import('/static/js/lobby3d.js')})()`);await page.until("sceneModule.chunksMap.get('1,0')?.roads.some(m=>m.userData.roadSurface)",'reload roads');
    const reloaded=await page.evaluate(verify);assert.ok(reloaded.minGap>.0058&&reloaded.maxGap<.0102,JSON.stringify(reloaded));
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({before,after,reloaded,disposedRoadSurfacesAtLeast:oldSurfaces>0,performance},null,2)+'\n');
    console.log('PASS: terrain-conforming roads, steep cardinal/diagonal, actual preview, chunk seam, height edit, reload; measurements:',JSON.stringify({before,after,performance}));
};
