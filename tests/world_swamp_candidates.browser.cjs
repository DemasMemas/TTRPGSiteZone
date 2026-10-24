// Approval-only base-map swaps. No added procedural shader effects or production assets.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/bog-bases');
    fs.mkdirSync(output,{recursive:true});
    const files=['terrainMaterialLayer.js','terrainMaterialCatalog.js','locationScene.js'];
    const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../app/static/js',file))).digest('hex')]));
    const before=hashes();
    const updates=[];
    for(let z=4;z<28;z++)for(let x=4;x<44;x++)updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,
        updates:{terrain:x<24?'bare_dirt':'swamp',height:1,objects:[]}});
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.until("sceneModule.chunksMap.get('1,0').tilesData[16][2].terrain==='swamp' && sceneModule.getWorldTerrainMaterialDiagnostics().ready",'candidate world');
    await page.evaluate('sceneModule.controls.target.set(34,1,16);sceneModule.camera.position.set(40.25,21,41);sceneModule.controls.update()');
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await page.until(`(()=>{let ready=false;sceneModule.scene.traverse(n=>{for(const m of [].concat(n.material||[]))if(sceneModule.renderer.properties.get(m).uniforms?.terrainAtlasColor)ready=true;});return ready})()`,'compiled atlas');
    await page.evaluate(`(async()=>{
        const {adjustTerrainAlbedo}=await import('/static/js/terrainMaterialCatalog.js');
        let config={id:'base'},textures;const materials=[];
        sceneModule.scene.traverse(n=>{for(const material of [].concat(n.material||[])){
            const u=sceneModule.renderer.properties.get(material).uniforms;
            if(!u?.terrainAtlasColor || materials.includes(material))continue;
            textures=[u.terrainAtlasColor.value,u.terrainAtlasNormal.value,u.terrainAtlasArm.value];
            materials.push(material);const compile=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material);
            material.customProgramCacheKey=()=>key()+':bog-base-preview:'+config.id;
            material.onBeforeCompile=shader=>{
                compile(shader);
                if(config.id!=='base'){
                    const pattern=/if \\(id == 3\\.0\\) return vec4\\([^;]+;/;
                    if(!pattern.test(shader.fragmentShader))throw new Error('Swamp parameter hook missing');
                    shader.fragmentShader=shader.fragmentShader.replace(pattern,'if(id==3.0)return vec4(4.0,0.25,0.0,0.0);');
                }
                if(shader.fragmentShader.includes('materialArm.g = mix(0.66, 0.22, wet)'))throw new Error('Unapproved roughness noise');
            };
        }});
        if(!textures)throw new Error('Atlas unavailable');
        const original=textures.map(t=>t.image.getContext('2d').getImageData(1024,0,512,512));
        window.setBogBase=async next=>{
            config=next;
            textures.forEach((t,i)=>t.image.getContext('2d').putImageData(original[i],1024,0));
            if(next.maps){
                const images={};for(const [name,url] of Object.entries(next.maps)){const image=new Image();image.src=url;await image.decode();images[name]=image;}
                // Lossless channel packing only: AO -> R, Roughness -> G, nonmetal -> B.
                const arm=document.createElement('canvas');arm.width=arm.height=1024;
                const ctx=arm.getContext('2d',{willReadFrequently:true});ctx.drawImage(images.ao,0,0);
                const ao=ctx.getImageData(0,0,1024,1024);ctx.drawImage(images.roughness,0,0);
                const rough=ctx.getImageData(0,0,1024,1024);
                for(let i=0;i<ao.data.length;i+=4){ao.data[i+1]=rough.data[i];ao.data[i+2]=0;ao.data[i+3]=255;}
                ctx.putImageData(ao,0,0);
                for(const [i,image] of [images.color,images.normal,arm].entries()){
                    const context=textures[i].image.getContext('2d');
                    context.save();context.beginPath();context.rect(1024,0,512,512);context.clip();context.translate(1032,504);context.scale(1,-1);
                    for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)context.drawImage(image,dx*496,dz*496,496,496);
                    context.restore();
                    if(i===0){const pixels=context.getImageData(1024,0,512,512);adjustTerrainAlbedo(pixels.data,{albedo:{saturation:0.5,gain:1.1,lift:0.08}});context.putImageData(pixels,1024,0);}
                }
            }
            textures.forEach(t=>t.needsUpdate=true);materials.forEach(m=>m.needsUpdate=true);
        };
        const renderer=sceneModule.renderer,draw=renderer.render.bind(renderer);renderer.render=()=>{};
        window.drawBogBase=()=>{sceneModule.setCelestialTime(720);renderer.shadowMap.needsUpdate=true;draw(sceneModule.scene,sceneModule.camera);};
    })()`);
    const manifests=[];
    for(const id of ['base','Moss002','Moss003']){
        const next={id};
        if(id!=='base'){
            const folder=path.join(os.tmpdir(),'vtt-bog-candidates',id);
            const manifest=JSON.parse(fs.readFileSync(path.join(folder,'material.json'),'utf8'));manifests.push(manifest);
            next.maps=Object.fromEntries(['color','normal','ao','roughness'].map(channel=>{
                const content=fs.readFileSync(path.join(folder,channel+'.jpg'));
                assert.equal(crypto.createHash('sha256').update(content).digest('hex'),manifest.maps[channel].sha256);
                return [channel,'data:image/jpeg;base64,'+content.toString('base64')];
            }));
        }
        await page.evaluate(`setBogBase(${JSON.stringify(next)})`);
        for(const near of [false,true]){
            await page.evaluate(near
                ? 'sceneModule.controls.target.set(34,1,16);sceneModule.camera.position.set(35.25,5,21);sceneModule.controls.update()'
                : 'sceneModule.controls.target.set(34,1,16);sceneModule.camera.position.set(40.25,21,41);sceneModule.controls.update()');
            await page.evaluate('drawBogBase()');
            const name=id+'-'+(near?'near':'far')+'.png';
            fs.writeFileSync(path.join(output,name),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
            console.log('Bog base candidate:',name);
        }
    }
    assert.equal(await page.evaluate('sceneModule.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length'),0);
    await page.evaluate("setBogBase({id:'base'});drawBogBase()");
    assert.deepEqual(hashes(),before);
    fs.writeFileSync(path.join(output,'sources.json'),JSON.stringify({productionHashes:before,candidates:manifests},null,2)+'\n');
    console.log('PASS: temporary Base PBR and two CC0 moss bases, no new procedural effects, no candidate integration');
};
