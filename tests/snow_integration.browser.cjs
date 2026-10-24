const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async context=>{
    const {page,request,token,lobby,base,connect,debugPort}=context;
    const output=path.resolve(__dirname,'../docs/material-previews/snow-integration');
    fs.mkdirSync(output,{recursive:true});
    let locId;
    if(process.env.VTT_SNOW_ACCEPTANCE_ONLY==='1'){
        const updates=[];for(let z=4;z<28;z++)for(let x=20;x<46;x++)updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,updates:{terrain:'snow',height:1,objects:[]}});
        await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
        const loc=await request(`/lobbies/${lobby.id}/locations`,{name:'Snow production acceptance',world_tile_x:32,world_tile_z:12,grid_width:32,grid_height:32,
            tiles_data:Array.from({length:32},()=>Array.from({length:32},(_,x)=>({terrain:x<6?'grass':'snow',height:1,objects:[]})))},token);
        locId=loc.id;
    }else{
        await require('./snow_candidates.browser.cjs')({...context,integration:true});
        locId=await page.evaluate('window.currentLocationId');
    }
    // Exercise the real production modules after a reload removes every preview hook.
    await page.call('Page.reload');
    await page.until("window.isGM && document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'production reload');
    await page.evaluate("(async()=>{window.sceneModule=await import('/static/js/lobby3d.js');window.snowEditor=await import('/static/js/mapEdit.js')})()");
    await page.until("sceneModule.getWorldTerrainMaterialDiagnostics().ready && sceneModule.chunksMap.get('1,0')?.tilesData[16][0].terrain==='snow'",'saved world snow');
    const target=await(await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${base}/lobbies/${lobby.id}/page`)}`,{method:'PUT'})).json();
    const peer=await connect(target.webSocketDebuggerUrl);
    try{
        await peer.call('Runtime.enable');await peer.call('Page.enable');
        await peer.until("window.isGM && document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'second production client');
        await peer.evaluate("(async()=>{window.snowPeer=await import('/static/js/lobby3d.js')})()");
        await peer.until("snowPeer.chunksMap.get('1,0')?.tilesData[16][0].terrain==='snow'",'second client loads legacy snow ID');
        for(const x of [31,32])await request(`/lobbies/${lobby.id}/chunks/${x>>5}/0/tile/${x%32}/12`,{terrain:'grass'},token,'PATCH');
        await peer.until("snowPeer.chunksMap.get('1,0')?.tilesData[12][0].terrain==='grass'",'peer receives preparation');
        await page.evaluate("snowEditor.applyBrush({chunkX:0,chunkY:0,tileX:31,tileY:12},{terrain:'snow'},1)");
        await peer.until("snowPeer.chunksMap.get('0,0').tilesData[12][31].terrain==='snow' && snowPeer.chunksMap.get('1,0').tilesData[12][0].terrain==='snow'",'snow brush crosses chunk boundary');
        const chunks=await request(`/lobbies/${lobby.id}/chunks?min_chunk_x=0&max_chunk_x=1&min_chunk_y=0&max_chunk_y=0`,null,token,'GET');
        for(const x of [31,32])assert.equal(chunks.find(c=>c.chunk_x===(x>>5)).data[12][x%32].terrain,'snow');
        await page.call('Page.bringToFront');
        await page.evaluate(`sceneModule.controls.target.set(32,1.2,12);sceneModule.camera.position.set(34,9,22);sceneModule.controls.update();
            if(document.getElementById('gm-only-controls').style.display==='none')window.toggleEditMode();
            snowEditor.selectWorldEditorTool('terrain');document.getElementById('tile-type-select').value='snow';snowEditor.setBrushRadius(0)`);
        const hover=async(client,local)=>{
            const point=await client.evaluate(`(()=>{const THREE=window.threeModule;const camera=${local?'window.locationControls.object':'sceneModule.camera'};
                camera.updateMatrixWorld(true);
                const p=new THREE.Vector3(${local?'17.5,1.6,16.5':'32.5,1.2,12.5'}).project(camera);
                const rect=${local?"document.querySelector('#location-container canvas')":"sceneModule.renderer.domElement"}.getBoundingClientRect();
                return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2}})()`);
            await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
            // Dispatch on the canvas too: a floating editor panel can overlap
            // the projected point in headless layouts; the handler itself remains real.
            await client.evaluate(`(()=>{const canvas=${local?"document.querySelector('#location-container canvas')":"sceneModule.renderer.domElement"};
                canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:${point.x},clientY:${point.y},pointerType:'mouse'}));})()`);
        };
        await page.evaluate("(async()=>{window.threeModule=await import('three')})()");
        await hover(page,false);
        await page.until("sceneModule.scene.children.some(n=>n.isMesh&&n.visible&&n.material?.transparent&&n.material?.color?.getHex()===0xffff00)",'world brush highlight');
        // No test shader hooks in this screenshot: shows production snow across x=32.
        fs.writeFileSync(path.join(output,'world-production-seam-brush.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await peer.call('Page.bringToFront');
        await peer.evaluate(`window.enterLocation(${locId})`);
        await peer.until(`window.currentLocationId===${locId} && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'peer local');
        await peer.evaluate("window.snowUpdates=[];window.socket.on('location_tiles_updated',d=>snowUpdates.push(d));true");
        await page.evaluate(`(()=>{window.snowProductionScenes=new Set();const add=threeModule.Scene.prototype.add;
            threeModule.Scene.prototype.add=function(...objects){snowProductionScenes.add(this);return add.apply(this,objects)}})()`);
        await page.call('Page.bringToFront');
        await page.evaluate(`window.enterLocation(${locId})`);
        await page.until(`window.currentLocationId===${locId} && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'local production');
        await page.evaluate("(async()=>{window.snowLocalModule=await import('/static/js/locationScene.js')})()");
        await page.until('snowLocalModule.getLocationTerrainMaterialDiagnostics()?.ready','local snow resources');
        await page.evaluate("snowLocalModule.setLocationEditMode(true);snowLocalModule.setLocationBrushTerrain('snow');snowLocalModule.setLocationBrushRadius(0);snowLocalModule.applyLocationBrush(4,16,{terrain:'snow'},0)");
        await peer.until(`snowUpdates.some(d=>d.location_id===${locId}&&d.updates.some(t=>t.x===4&&t.z===16&&t.terrain==='snow'))`,'local snow brush sync');
        const local=await request(`/lobbies/${lobby.id}/locations/${locId}`,null,token,'GET');
        assert.equal(local.tiles_data[16][4].terrain,'snow');
        await page.evaluate('window.locationControls.target.set(17,1.5,16);window.locationControls.object.position.set(19,6,23);window.locationControls.update()');
        await page.call('Page.bringToFront');
        await hover(page,true);
        await page.until("[...snowProductionScenes].some(s=>s.children.some(n=>n.isMesh&&n.visible&&n.material?.color?.getHex()===0xffaa00))",'local brush highlight');
        fs.writeFileSync(path.join(output,'local-production-brush.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await page.evaluate(`window.enterLocation(${locId})`);
        await page.until("document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'local reload');
        await page.until('snowLocalModule.getLocationTerrainMaterialDiagnostics()?.ready','local reload snow');
        assert.equal(await page.evaluate('snowLocalModule.getLocationTerrainMaterialDiagnostics().shaderErrors'),0);
        const compatibility=await page.evaluate(`(async()=>{
            const THREE=await import('three'),{createTerrainMaterialLayer}=await import('/static/js/terrainMaterialLayer.js');
            const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl',{antialias:false});
            if(!gl)throw new Error('WebGL1 context unavailable');
            const renderer=new THREE.WebGLRenderer({canvas,context:gl});renderer.setSize(128,128);
            const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100);
            camera.position.set(2,4,4);camera.lookAt(1,0,1);scene.add(new THREE.AmbientLight(0xffffff,1));
            const geometry=new THREE.PlaneGeometry(2,2);geometry.rotateX(-Math.PI/2);geometry.translate(1,0,1);
            const layers=[];const pixels=[];
            for(const world of [false,true]){
                const layer=createTerrainMaterialLayer(THREE,{world});await layer.ready;layer.resize(2,2);layer.fill(Array.from({length:2},()=>[{terrain:'snow'},{terrain:'snow'}]));
                const material=new THREE.MeshStandardMaterial();layer.apply(material);const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
                const target=new THREE.WebGLRenderTarget(128,128);renderer.setRenderTarget(target);renderer.render(scene,camera);
                const data=new Uint8Array(128*128*4);renderer.readRenderTargetPixels(target,0,0,128,128,data);
                let min=255,max=0,count=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>250&&data[i]+data[i+1]+data[i+2]>0){min=Math.min(min,data[i]);max=Math.max(max,data[i]);count++;}
                if(count<100||min<1||max<30)throw new Error('Invalid WebGL1 snow pixels');
                pixels.push({world,min,max,count});scene.remove(mesh);material.dispose();target.dispose();layers.push(layer);
            }
            const errors=renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length;
            const result={version:gl.getParameter(gl.VERSION),textureUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),lod:!!gl.getExtension('EXT_shader_texture_lod'),errors,pixels};
            layers.forEach(l=>l.dispose());geometry.dispose();renderer.dispose();renderer.forceContextLoss();return result;
        })()`);
        assert.equal(compatibility.errors,0);
        fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify({worldBrush:true,crossChunkSync:true,worldPersistence:true,localBrush:true,localSync:true,localReload:true,compatibility},null,2)+'\n');
        console.log('PASS: Snow001 production persistence, cross-chunk brush, preview, two clients, local reload, WebGL1',JSON.stringify(compatibility));
    }finally{peer.close();}
};
