const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/po2');fs.mkdirSync(output,{recursive:true});
    await page.until('sceneModule.getWorldFenceDiagnostics().geometryReady && sceneModule.getWorldFenceDiagnostics().textureReady','PO-2 asset');
    const byTile=new Map();
    const add=(x,z,rotation=90)=>{
        const tx=Math.floor(x),tz=Math.floor(z),key=`${tx},${tz}`;
        if(!byTile.has(key))byTile.set(key,{tx,tz,objects:[]});
        byTile.get(key).objects.push({type:'fence',x:x-tx-.5,z:z-tz-.5,rotation,scale:1,color:'#ffffff'});
    };
    for(let i=0;i<16;i++)add(27.2+i*.8,12);
    for(let i=0;i<12;i++)add(39.6,12.4+i*.8,0);
    add(30,14,0); // A separate end, both faces and feet visible.
    const updates=[...byTile.values()].map(({tx,tz,objects})=>({chunk_x:tx>>5,chunk_y:0,tile_x:tx%32,tile_y:tz,updates:{terrain:'grass',height:1,objects}}));
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.until("sceneModule.chunksMap.get('0,0')?.fences?.count>0 && sceneModule.chunksMap.get('1,0')?.fences?.count>0",'both fence chunks');
    await page.evaluate(`(()=>{
        window.po2Errors=[];const error=console.error;console.error=(...args)=>{po2Errors.push(args.map(String).join(' '));error(...args)};
        window.po2Look=(x,y,z,tx,ty,tz)=>{sceneModule.controls.target.set(tx,ty,tz);sceneModule.camera.position.set(x,y,z);sceneModule.controls.update()};
        window.po2Stats=()=>{const r=sceneModule.renderer;return {calls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures,asset:sceneModule.getWorldFenceDiagnostics()}};
    })()`);
    const shot=async(name,camera)=>{
        await page.evaluate(`po2Look(${camera.join(',')});sceneModule.renderer.render(sceneModule.scene,sceneModule.camera)`);
        await new Promise(r=>setTimeout(r,700));
        fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    };
    if(process.env.VTT_PO2_LIGHTING_ONLY==='1'){
        for(const [name,time] of [['daylight',720],['evening',1080]]){
            await page.evaluate(`sceneModule.setCelestialTime(${time})`);
            await shot(name,[32.5,2.1,14.6,31.6,1.25,12]);
        }
        const lighting=await page.evaluate('({asset:sceneModule.getWorldFenceDiagnostics(),errors:po2Errors})');
        assert.deepEqual(lighting.asset.errors,[]);assert.deepEqual(lighting.errors,[]);
        fs.writeFileSync(path.join(output,'lighting.json'),JSON.stringify(lighting,null,2)+'\n');
        console.log('PASS: PO-2 daytime and evening game lighting');return;
    }
    await shot('overview',[44,11,28,33,1,15]);
    await shot('near-front',[32.5,2.1,14.6,31.6,1.25,12]);
    await shot('near-back',[30.2,2,9.5,31.6,1.25,12]);
    await shot('corner',[41.3,2.4,10.4,39.5,1.2,12.5]);
    await shot('far',[48,25,42,33,1,15]);
    // Preview shares the actual model/texture, but owns its translucent material.
    await page.evaluate(`sceneModule.createPreviewObject({chunkX:0,chunkY:0,tileX:31,tileY:14,tileData:{height:1}},{type:'fence',color:'#ffffff',offsetX:0,offsetZ:0,scale:1,rotation:45})`);
    assert.equal(await page.evaluate("sceneModule.scene.children.some(n=>n.userData.previewType==='fence' && n.geometry===sceneModule.chunksMap.get('0,0').fences.geometry && !!n.material.map)"),true);
    await shot('preview',[32.5,3,17,31.5,1.2,14]);
    await page.evaluate('sceneModule.removePreviewObject()');
    // A peer and a fresh reload use unchanged saved fence objects.
    const target=await(await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${base}/lobbies/${lobby.id}/page`)}`,{method:'PUT'})).json();
    const peer=await connect(target.webSocketDebuggerUrl);
    try {
        await peer.call('Runtime.enable');await peer.call('Page.enable');
        await peer.until('window.isGM','peer login');
        await peer.evaluate("(async()=>{window.peerWorld=await import('/static/js/lobby3d.js')})()");
        await peer.until("peerWorld.chunksMap.get('1,0')?.fences?.count>0 && peerWorld.getWorldFenceDiagnostics().geometryReady",'peer saved fence');
        const edited={...byTile.get('32,12').objects[0],rotation:135,scale:1.2,color:'#bfc7be'};
        await request(`/lobbies/${lobby.id}/chunks/1/0/tile/0/12`,{objects:[edited]},token,'PATCH');
        await peer.until("peerWorld.chunksMap.get('1,0').tilesData[12][0].objects[0].rotation===135",'fence sync');
        const saved=await request(`/lobbies/${lobby.id}/chunks?min_chunk_x=1&max_chunk_x=1&min_chunk_y=0&max_chunk_y=0`,null,token,'GET');
        assert.equal(saved[0].data[12][0].objects[0].type,'fence');
        assert.equal(saved[0].data[12][0].objects[0].scale,1.2);
    }finally{peer.close()}
    await page.call('Page.bringToFront');
    await page.call('Page.reload');
    await page.until("window.isGM && document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'reload');
    await page.evaluate("(async()=>{window.sceneModule=await import('/static/js/lobby3d.js');window.threeModule=await import('three')})()");
    await page.until("sceneModule.getWorldFenceDiagnostics().geometryReady && sceneModule.chunksMap.get('1,0')?.tilesData[12][0].objects[0].rotation===135",'saved fence transform');
    // Isolate model cost in the actual game renderer: retain terrain, light and
    // shadows; use repeated instances in one chunk at identical camera/viewport.
    const result=await page.evaluate(`(async()=>{
        const THREE=threeModule, w=sceneModule,r=w.renderer;
        const mesh=w.chunksMap.get('0,0').fences, geometry=mesh.geometry,material=mesh.material;
        const originalRender=r.render.bind(r);r.render=()=>{};
        const oldMeshes=[];w.scene.traverse(n=>{if(n.isInstancedMesh && n.geometry===geometry){oldMeshes.push([n,n.visible]);n.visible=false}});
        const position=[],normal=[];
        const parts=[[.11,.52,.11,0,0,-.34],[.11,.52,.11,0,0,.34],[.07,.06,.74,-.035,-.09,0],[.07,.06,.74,-.035,.12,0],...[-.24,-.12,0,.12,.24].map((z,i)=>[.07,.39+i%3*.025,.075,.035,-.04+i%3*.012,z])];
        for(const [sx,sy,sz,x,y,z] of parts){const g=new THREE.BoxGeometry(sx,sy,sz).toNonIndexed();g.translate(x,y,z);position.push(...g.attributes.position.array);normal.push(...g.attributes.normal.array);g.dispose()}
        const legacy=new THREE.BufferGeometry();legacy.setAttribute('position',new THREE.Float32BufferAttribute(position,3));legacy.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));
        const detail=await import('/static/js/locationTerrainDetail.js');const legacyMat=new THREE.MeshStandardMaterial();detail.applySurfacePattern(legacyMat,detail.getSurfaceTexture(THREE,'fence'),.4);
        w.controls.target.set(32,1,15);w.camera.position.set(42,12,26);w.controls.update();
        let test;
        window.po2Measure=async(count,kind)=>{
            if(!test || test.count!==count){
                if(test){w.scene.remove(test);test.dispose()}
                test=new THREE.InstancedMesh(geometry,material,count);test.castShadow=true;test.receiveShadow=false;test.frustumCulled=false;
                test.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(count*3).fill(1),3);
                const dummy=new THREE.Object3D();
                for(let i=0;i<count;i++){dummy.position.set(20+(i%32)*.8,1.25,4+Math.floor(i/32)*.8);dummy.rotation.y=Math.PI/2;dummy.updateMatrix();test.setMatrixAt(i,dummy.matrix)}
                w.scene.add(test);
            }
                test.geometry=kind==='legacy'?legacy:geometry;test.material=kind==='legacy'?legacyMat:material;
                const times=[];
                const gl=r.getContext(),probe=new Uint8Array(4);
                for(let n=0;n<8;n++){
                    r.shadowMap.needsUpdate=true;
                    const start=performance.now();originalRender(w.scene,w.camera);
                    // Chromium may acknowledge finish() without waiting for the GPU.
                    // Reading the rendered framebuffer forces completion of the draw.
                    gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,probe);
                    const elapsed=performance.now()-start;if(n>=2)times.push(elapsed);
                    await new Promise(resolve=>setTimeout(resolve,0));
                }
                times.sort((a,b)=>a-b);
                return {medianFrameMs:(times[2]+times[3])/2,fps:1000/((times[2]+times[3])/2),calls:r.info.render.calls,triangles:r.info.render.triangles,geometries:r.info.memory.geometries,textures:r.info.memory.textures};
        };
        window.po2Finish=()=>{w.scene.remove(test);test.dispose();legacy.dispose();legacyMat.dispose();for(const [n,visible]of oldMeshes)n.visible=visible;r.render=originalRender;
            return {shaderErrors:r.info.programs.filter(p=>p.diagnostics && !p.diagnostics.runnable).length}};
        return {stats:{},asset:w.getWorldFenceDiagnostics(),renderer:r.getContext().getParameter(r.getContext().RENDERER)};
    })()`);
    for(const count of [64,256,1024]){
        result.stats[count]={};
        for(const kind of ['legacy','relief']){
            result.stats[count][kind]=await page.evaluate(`po2Measure(${count},'${kind}')`);
            console.log('PO-2 measurement',count,kind,JSON.stringify(result.stats[count][kind]));
        }
    }
    Object.assign(result,await page.evaluate('po2Finish()'));
    result.webgl1=await page.evaluate(`(()=>{
        const THREE=threeModule,canvas=document.createElement('canvas'),gl=canvas.getContext('webgl');
        if(!gl)throw new Error('WebGL1 context unavailable');
        const r=new THREE.WebGLRenderer({canvas,context:gl});r.setSize(128,128);
        const scene=new THREE.Scene(),source=sceneModule.chunksMap.get('0,0').fences;
        scene.add(new THREE.Mesh(source.geometry,source.material));
        scene.add(new THREE.AmbientLight(0xffffff,.7));const light=new THREE.DirectionalLight(0xffffff,1);light.position.set(1,2,1);scene.add(light);
        const camera=new THREE.PerspectiveCamera(45,1,.01,10);camera.position.set(1,.6,1);camera.lookAt(0,0,0);
        r.render(scene,camera);const pixels=new Uint8Array(128*128*4);gl.readPixels(0,0,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]+pixels[i+1]+pixels[i+2]>0)count++;
        const answer={version:gl.getParameter(gl.VERSION),pixels:count,errors:r.info.programs.filter(p=>p.diagnostics && !p.diagnostics.runnable).length};
        r.dispose();r.forceContextLoss();return answer;
    })()`);
    assert.ok(result.webgl1.pixels>0);assert.equal(result.webgl1.errors,0);
    assert.equal(result.shaderErrors,0);assert.deepEqual(result.asset.errors,[]);
    for(const pair of Object.values(result.stats))assert.equal(pair.relief.calls,pair.legacy.calls);
    result.checks={preview:true,sync:true,reload:true,crossChunk:true};
    fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify(result,null,2)+'\n');
    console.log('PASS: PO-2 geometry, preview, cross-chunk instances, persistence, peer sync, performance',JSON.stringify(result));
};
