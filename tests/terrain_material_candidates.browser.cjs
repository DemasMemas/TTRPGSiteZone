// Approval previews only. Candidate maps live in TEMP; changes exist only in this
// isolated browser's atlas/shaders. No production catalog or saved tile type changes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
module.exports = async ({ page, request, token, lobby }) => {
    const output = path.resolve(__dirname, '../docs/material-previews/fix-4');
    fs.mkdirSync(output, { recursive: true });
    const maps = asset => Object.fromEntries(['color','normal','arm'].map(channel => {
        const folder = asset === 'snow_field_aerial'
            ? path.resolve(__dirname,'../app/static/materials/terrain',asset)
            : path.join(os.tmpdir(),'vtt-mat04-candidates',asset);
        return [channel, 'data:image/jpeg;base64,' + fs.readFileSync(path.join(folder,channel+'.jpg')).toString('base64')];
    }));
    const capture = async name => {
        await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
        fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        console.log('Candidate screenshot:',name);
    };
    const updates=[];
    for(let z=4;z<28;z++) for(let x=4;x<44;x++) updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,
        updates:{terrain:x<24?'snow':'swamp',height:1,objects:[]}});
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.until("sceneModule.chunksMap.get('0,0').tilesData[12][12].terrain==='snow' && sceneModule.getWorldTerrainMaterialDiagnostics().ready",'preview world');
    await page.evaluate('sceneModule.controls.target.set(24,1,16);sceneModule.camera.position.set(24,32,42);sceneModule.controls.update()');
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await page.until(`(()=>{let ready=false;sceneModule.scene.traverse(node=>{for(const material of [].concat(node.material||[])){
        if(sceneModule.renderer.properties.get(material).uniforms?.terrainAtlasColor)ready=true;
    }});return ready})()`,'compiled game atlas');
    await page.evaluate(`(async()=>{
        const THREE=await import('three');
        const {adjustTerrainAlbedo}=await import('/static/js/terrainMaterialCatalog.js');
        const materials=new Set();
        let config={name:'current'};
        const patch=material=>{
            if(!material?.isMeshStandardMaterial || materials.has(material))return;
            materials.add(material);
            const original=material.onBeforeCompile, key=material.customProgramCacheKey.bind(material);
            material.customProgramCacheKey=()=>key()+':approval-preview:'+config.name;
            material.onBeforeCompile=shader=>{
                original?.(shader);
                if(!shader.fragmentShader.includes('void terrainReadMaterial'))return;
                let fragment=shader.fragmentShader;
                if(config.snow) {
                    fragment=fragment.replace(/if \\(id == 6\\.0\\) return vec4\\([^;]+;/,
                        'if (id == 6.0) return vec4('+config.snow.repeat.toFixed(3)+',0.45,0.0,0.10);');
                    const start=fragment.indexOf('            if (id == 6.0) {');
                    const end=fragment.indexOf('            }',start);
                    if(start<0 || end<0)throw new Error('Snow preview hook unavailable');
                    fragment=fragment.slice(0,start)+'if(id==6.0){mapNormal.xy*=0.75;arm.r=mix(1.0,arm.r,0.35);}' +fragment.slice(end+13);
                }
                if(config.bog) {
                    const marker='            color += materialColor * weight;';
                    if(!fragment.includes(marker))throw new Error('Bog preview hook unavailable');
                    fragment=fragment.replace(marker,config.bog+String.fromCharCode(10)+marker);
                }
                shader.fragmentShader=fragment;
            };
            material.needsUpdate=true;
        };
        const inspect=object=>object.traverse(node=>[].concat(node.material||[]).forEach(patch));
        inspect(sceneModule.scene);
        const originalAdd=THREE.Scene.prototype.add;
        THREE.Scene.prototype.add=function(...objects){objects.forEach(inspect);return originalAdd.apply(this,objects);};
        let textures;
        sceneModule.scene.traverse(node=>{for(const material of [].concat(node.material||[])){
            const u=sceneModule.renderer.properties.get(material).uniforms;
            if(u?.terrainAtlasColor)textures=[u.terrainAtlasColor.value,u.terrainAtlasNormal.value,u.terrainAtlasArm.value];
        }});
        if(!textures)throw new Error('Game atlas unavailable');
        const slots=[2,5];
        const originals=textures.map(texture=>slots.map(slot=>texture.image.getContext('2d').getImageData(slot%4*512,Math.floor(slot/4)*512,512,512)));
        window.setMaterialCandidate=async next=>{
            config=next;
            textures.forEach((texture,i)=>slots.forEach((slot,j)=>texture.image.getContext('2d').putImageData(originals[i][j],slot%4*512,Math.floor(slot/4)*512)));
            for(const [kind,slot] of [['snow',5],['peat',2]]) if(next[kind]) {
                const entry=next[kind];
                for(const [index,channel] of ['color','normal','arm'].entries()) {
                    const image=new Image();image.src=entry.maps[channel];await image.decode();
                    const context=textures[index].image.getContext('2d'),x=slot%4*512,y=Math.floor(slot/4)*512;
                    context.save();context.beginPath();context.rect(x,y,512,512);context.clip();
                    context.translate(x+8,y+504);context.scale(1,-1);
                    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)context.drawImage(image,dx*496,dz*496,496,496);
                    context.restore();
                    if(index===0){const pixels=context.getImageData(x,y,512,512);adjustTerrainAlbedo(pixels.data,{albedo:entry.albedo});context.putImageData(pixels,x,y);}
                }
            }
            textures.forEach(texture=>texture.needsUpdate=true);
            materials.forEach(material=>material.needsUpdate=true);
        };
    })()`);
    const camera = async (scene,kind,near) => {
        const x=scene==='world'?(kind==='snow'?14:34):12,z=scene==='world'?16:12;
        const distance=near?(scene==='world'?5:4):25;
        await page.evaluate(scene==='world'
            ? `sceneModule.controls.target.set(${x},1,${z});sceneModule.camera.position.set(${x+distance*.25},${1+distance*.8},${z+distance});sceneModule.controls.update()`
            : `window.locationControls.target.set(${x},1,${z});window.locationControls.object.position.set(${x+distance*.25},${1+distance*.8},${z+distance});window.locationControls.update()`);
    };
    const shots=async(scene,kind,label)=>{for(const near of [false,true]){await camera(scene,kind,near);await capture(scene+'-'+kind+'-'+label+'-'+(near?'near':'far'));}};
    await page.evaluate('sceneModule.setCelestialTime(720)');
    await shots('world','snow','current');
    await shots('world','swamp','current');
    const cold={saturation:0.3,gain:0.6,lift:0.38,tint:[0.98,1,1.02]};
    await page.evaluate(`setMaterialCandidate(${JSON.stringify({name:'aerial',snow:{maps:maps('snow_field_aerial'),repeat:0.8,albedo:cold}})})`);
    await shots('world','snow','aerial');
    const bog = wet => `if(id==3.0){
        vec2 p=vTerrainMaterialPosition.xz;
        vec2 bend=vec2(terrainNoise(p*0.21+3.1),terrainNoise(p*0.19+9.7));
        float relief=terrainNoise(p*0.48+bend*1.4)*0.7+terrainNoise(p*1.13+8.0)*0.3;
        float wet=smoothstep(${wet},${wet+0.14},relief);
        float moss=smoothstep(0.36,0.67,terrainNoise(p*0.38+19.0)*0.7+terrainNoise(p*1.7)*0.3)*(1.0-wet);
        float grain=dot(materialColor,vec3(0.2126,0.7152,0.0722));
        vec3 peat=vec3(0.10,0.085,0.06)*(0.9+grain*2.0);
        vec3 green=vec3(0.18,0.20,0.10)*(0.75+0.3*terrainNoise(p*5.3));
        materialColor=mix(mix(peat,green,moss*0.9),vec3(0.04,0.065,0.055),wet*0.9);
        materialNormal.xy*=mix(0.7,0.08,wet);materialArm.r=mix(materialArm.r,1.0,wet);
        materialArm.g=mix(0.83,0.22,wet);materialArm.b=0.0;
    }`;
    for(const [name,wet] of [['peat-moss',0.59],['wet-bog',0.48]]) {
        await page.evaluate(`setMaterialCandidate(${JSON.stringify({name,bog:bog(wet),peat:{maps:maps('brown_mud'),albedo:{saturation:0.2,gain:1,lift:0.1}}})})`);
        await shots('world','swamp',name);
    }
    await page.evaluate("setMaterialCandidate({name:'current'})");
    const tiles=Array.from({length:24},()=>Array.from({length:24},()=>({terrain:'snow',height:1,objects:[]})));
    const location=await request(`/lobbies/${lobby.id}/locations`,{name:'Snow candidate approval',world_tile_x:14,world_tile_z:16,grid_width:24,grid_height:24,tiles_data:tiles},token);
    await page.evaluate(`window.enterLocation(${location.id})`);
    await page.until("document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'local candidate scene');
    await page.evaluate("(async()=>{window.previewLocation=await import('/static/js/locationScene.js')})()");
    await page.until('previewLocation.getLocationTerrainMaterialDiagnostics()?.ready','local atlas');
    await page.evaluate("document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()");
    await shots('local','snow','current');
    await page.evaluate(`setMaterialCandidate(${JSON.stringify({name:'snow03',snow:{maps:maps('snow_03'),repeat:2,albedo:cold}})})`);
    await shots('local','snow','snow03');
    assert.equal(await page.evaluate('previewLocation.getLocationTerrainMaterialDiagnostics().shaderErrors'),0);
    assert.equal(await page.evaluate('sceneModule.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length'),0);
    console.log('PASS: approval candidates rendered in isolated game scenes; working catalog unchanged');
};
