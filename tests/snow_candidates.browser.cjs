// Approval-only snow experiment. Only snow atlas slot / id=6 are patched.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
module.exports=async({page,request,token,lobby,integration=false})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/'+(integration?'snow-integration':'snow-candidates'));fs.mkdirSync(output,{recursive:true});
    const protectedFiles=['terrainMaterialCatalog.js','terrainMaterialLayer.js','lobby3d.js','locationScene.js','locationTerrainTexture.js'];
    const hashes=()=>Object.fromEntries(protectedFiles.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../app/static/js',f))).digest('hex')]));
    const before=hashes(),sources=[];
    const candidates=(integration?['Snow001']:['Snow001','Snow004','Snow010A']).map((id,index)=>{
        const folder=path.join(os.tmpdir(),'vtt-snow-candidates',id),manifest=JSON.parse(fs.readFileSync(path.join(folder,'material.json')));sources.push(manifest);
        const maps=Object.fromEntries(['color','normal','ao','roughness'].map(c=>{
            if(!manifest.maps[c])return [c,null];
            const b=fs.readFileSync(path.join(folder,c+'.jpg'));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),manifest.maps[c].sha256);
            return [c,'data:image/jpeg;base64,'+b.toString('base64')];
        }));
        return {id,maps,repeatWorld:[.03,.03,.04][index],repeatLocal:[3,3,4][index],normalWorld:[.12,.10,.14][index],normalLocal:[.22,.16,.24][index]};
    });
    const updates=[];
    for(let z=0;z<32;z++)for(let x=0;x<64;x++){
        const snowy=x>=21&&x<=47-Math.max(0,Math.abs(z-16)-6)/3&&z>=5&&z<=27;
        const h=1+.24*Math.max(0,1-((x-34)/12)**2)*Math.max(0,1-((z-18)/10)**2);
        updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,updates:{terrain:snowy?'snow':x>43?'bare_dirt':'grass',height:h,objects:[]}});
    }
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.until("sceneModule.getWorldTerrainMaterialDiagnostics().ready && sceneModule.chunksMap.get('1,0').tilesData[16][0].terrain==='snow'",'snow field');
    await page.evaluate('sceneModule.controls.target.set(34,1,16);sceneModule.camera.position.set(42,23,41);sceneModule.controls.update()');
    await page.until(`(()=>{let found=false;sceneModule.scene.traverse(n=>{for(const m of [].concat(n.material||[]))if(sceneModule.renderer.properties.get(m).uniforms?.terrainAtlasColor)found=true});return found})()`,'snow world atlas compiled');
    await page.evaluate(`(async()=>{
        const THREE=await import('three');
        const {adjustTerrainAlbedo}=await import('/static/js/terrainMaterialCatalog.js');
        const candidateTextures=[0,1,2].map(()=>{
            const c=document.createElement('canvas');c.width=c.height=1024;
            const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
            t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.anisotropy=4;return t;
        });
        const materials=new Set(),meshes=new WeakSet();let config={id:'current'},sceneKind='world';
        const patch=object=>object.traverse(n=>{
            if(n.isMesh&&!meshes.has(n)){
                meshes.add(n);const old=n.onBeforeRender;
                n.onBeforeRender=function(renderer,scene,camera,...args){
                    old?.call(this,renderer,scene,camera,...args);
                    if(window.isLocationActive&&renderer!==sceneModule.renderer)window.snowLocal={renderer,scene,camera};
                };
            }
            for(const m of [].concat(n.material||[])){
                if(!m.isMeshStandardMaterial||materials.has(m))continue;
                materials.add(m);const compile=m.onBeforeCompile,key=m.customProgramCacheKey.bind(m);
                m.customProgramCacheKey=()=>key()+':snow-approval:'+sceneKind+':'+config.id+':'+(config.diagnostic||'tuned');
                m.onBeforeCompile=shader=>{
                    compile(shader);if(config.id==='current'||!shader.fragmentShader.includes('void terrainReadMaterial'))return;
                    let s=shader.fragmentShader;
                    // Reference path bypasses the production packed snow reader,
                    // reproducing the approved three-texture prototype exactly.
                    const snowBody=s.indexOf('if (id == 6.0) {',s.indexOf('void terrainReadMaterial'));
                    const atlasBody=s.indexOf('vec3 albedo = terrainAtlasSample',snowBody);
                    if(snowBody>=0&&atlasBody>snowBody)s=s.slice(0,snowBody)+s.slice(atlasBody);
                    const repeat=sceneKind==='world'?config.repeatWorld:config.repeatLocal;
                    const strength=config.diagnostic==='raw'?1:config.diagnostic==='color-only'?0:(sceneKind==='world'?config.normalWorld:config.normalLocal);
                    const parameter=/if \\(id == 6\\.0\\) return vec4\\([^;]+;/;
                    if(!parameter.test(s))throw new Error('Missing snow parameters');
                    s=s.replace(parameter,'if(id==6.0)return vec4('+repeat.toFixed(4)+','+strength.toFixed(4)+',0.0,0.0);');
                    const ao=config.diagnostic==='raw'?1:config.diagnostic==='color-only'?0:(sceneKind==='world'?.10:.25);
                    ['Color','Normal','Arm'].forEach((name,i)=>shader.uniforms['snowPreview'+name]={value:candidateTextures[i]});
                    s=s.replace('void terrainReadMaterial(',\`
                        uniform sampler2D snowPreviewColor,snowPreviewNormal,snowPreviewArm;
                        vec4 snowPreviewRead(sampler2D tex,vec2 uv,vec2 dx,vec2 dy){
                            #if defined(GL_EXT_shader_texture_lod) || __VERSION__ >= 300
                                return texture2DGradEXT(tex,uv,dx,dy);
                            #else
                                return texture2D(tex,uv);
                            #endif
                        }
                        void terrainReadMaterial(
                    \`);
                    const marker='vec3 albedo = terrainAtlasSample(terrainAtlasColor, id, uv, dx, dy).rgb;';
                    if(!s.includes(marker))throw new Error('Missing snow sampling hook');
                    s=s.replace(marker,'if(id==6.0){color=terrainLinear(snowPreviewRead(snowPreviewColor,uv,dx,dy).rgb);'+
                        (sceneKind==='world'?
                            'vec3 macroSnow;'+
                            '\\n#if defined(GL_EXT_shader_texture_lod) || __VERSION__ >= 300\\n'+
                            'macroSnow=texture2DLodEXT(snowPreviewColor,uv*'+(repeat/.8).toFixed(6)+',6.0).rgb;'+
                            '\\n#else\\nmacroSnow=texture2D(snowPreviewColor,uv*'+(repeat/.8).toFixed(6)+',6.0).rgb;\\n#endif\\n'+
                            'color=mix(color,terrainLinear(macroSnow),.35);':'')+
                        'mapNormal=snowPreviewRead(snowPreviewNormal,uv,dx,dy).xyz*2.0-1.0;arm=snowPreviewRead(snowPreviewArm,uv,dx,dy).rgb;'+
                        'arm.r=mix(1.0,arm.r,'+ao.toFixed(4)+');arm.g=clamp(arm.g,.88,.98);arm.b=0.0;return;}'+marker);
                    shader.fragmentShader=s;
                };m.needsUpdate=true;
            }
        });
        patch(sceneModule.scene);const add=THREE.Scene.prototype.add;
        THREE.Scene.prototype.add=function(...objects){objects.forEach(patch);return add.apply(this,objects)};
        let textures;sceneModule.scene.traverse(n=>{for(const m of [].concat(n.material||[])){
            const u=sceneModule.renderer.properties.get(m).uniforms;if(u?.terrainAtlasColor)textures=[u.terrainAtlasColor.value,u.terrainAtlasNormal.value,u.terrainAtlasArm.value];
        }});
        const slotHashes=()=>textures.map(t=>{const data=t.image.getContext('2d').getImageData(1024,0,512,512).data;let h=0;for(const v of data)h=(h*31+v)|0;return h});
        const swampBefore=slotHashes();
        window.setSnowCandidate=async(next,kind)=>{
            config=next;sceneKind=kind;
            if(next.maps){
                const images={};for(const [c,url] of Object.entries(next.maps)){if(!url)continue;const img=new Image();img.src=url;await img.decode();images[c]=img;}
                const arm=document.createElement('canvas');arm.width=arm.height=1024;const ctx=arm.getContext('2d',{willReadFrequently:true});
                ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1024,1024);if(images.ao)ctx.drawImage(images.ao,0,0,1024,1024);
                const ao=ctx.getImageData(0,0,1024,1024);ctx.drawImage(images.roughness,0,0,1024,1024);const rough=ctx.getImageData(0,0,1024,1024);
                for(let i=0;i<ao.data.length;i+=4){ao.data[i+1]=rough.data[i];ao.data[i+2]=0;ao.data[i+3]=255;}ctx.putImageData(ao,0,0);
                for(const [i,image] of [images.color,images.normal,arm].entries()){
                    const c=candidateTextures[i].image.getContext('2d');c.drawImage(image,0,0,1024,1024);
                    if(i===0){const p=c.getImageData(0,0,1024,1024);adjustTerrainAlbedo(p.data,{albedo:{saturation:.35,gain:.88,tint:[.98,1,1.015]}});c.putImageData(p,0,0);}
                    candidateTextures[i].needsUpdate=true;
                }
            }
            materials.forEach(m=>m.needsUpdate=true);
            if(JSON.stringify(swampBefore)!==JSON.stringify(slotHashes()))throw new Error('Swamp atlas was touched');
        };
        window.freezeSnowScene=kind=>{
            window.snowWorld ||= {renderer:sceneModule.renderer,scene:sceneModule.scene,camera:sceneModule.camera};
            const target=kind==='world'?window.snowWorld:window.snowLocal;
            if(!target)throw new Error('Local renderer unavailable');
            if(!target.snowDraw){target.snowDraw=target.renderer.render.bind(target.renderer);target.renderer.render=()=>{};}
            window.activeSnowScene=target;
        };
        const lighting={mode:'manual',ambient_color:'#b9c4d0',ambient_intensity:.55,directional_color:'#fff0d5',directional_intensity:1,
            directional_azimuth:45,directional_elevation:50,background_color:'#283642',local_lights:[],dark_tiles:[]};
        window.drawSnowFrame=kind=>{
            if(kind==='world'){
                sceneModule.setCelestialTime(720);sceneModule.ambientLight.color.set(lighting.ambient_color);sceneModule.ambientLight.intensity=.55;
                sceneModule.fillLight.intensity=0;const light=sceneModule.directionalLight;
                light.color.set(lighting.directional_color);light.intensity=1;light.target.position.set(34,1,16);
                light.position.set(34+Math.cos(Math.PI/4)*Math.cos(50*Math.PI/180)*50,1+Math.sin(50*Math.PI/180)*50,16+Math.sin(Math.PI/4)*Math.cos(50*Math.PI/180)*50);
                light.target.updateMatrixWorld();
            }else previewSnowLocation.applyLocationLighting(lighting,false);
            const t=window.activeSnowScene;t.renderer.shadowMap.needsUpdate=true;t.snowDraw(t.scene,t.camera);
            const gl=t.renderer.getContext(),pixels=new Uint8Array(128*128*4);
            gl.readPixels(Math.floor(gl.drawingBufferWidth/2)-64,Math.floor(gl.drawingBufferHeight/2)-64,128,128,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            return Array.from(pixels);
        };
        window.snowSceneStats=()=>{const r=activeSnowScene.renderer;return {calls:r.info.render.calls,triangles:r.info.render.triangles,
            geometries:r.info.memory.geometries,textures:r.info.memory.textures,shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length,
            outputEncoding:r.outputEncoding,toneMapping:r.toneMapping,exposure:r.toneMappingExposure,heap:performance.memory?.usedJSHeapSize}};
        document.querySelectorAll('.draggable-panel:not(.collapsed) .panel-header .toggle-btn').forEach(b=>b.click());
    })()`);
    const statistics={},comparisons={},referencePixels={};
    const capture=async name=>{fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));console.log('Snow screenshot:',name)};
    for(const kind of ['world','local']){
        if(kind==='local'){
            await page.evaluate("setSnowCandidate({id:'current'},'world')");
            const tiles=Array.from({length:32},(_,z)=>Array.from({length:32},(_,x)=>({terrain:x>=6&&x<=26&&z>=4&&z<=28?'snow':x>23?'bare_dirt':'grass',
                height:1+.6*Math.max(0,1-((x-17)/10)**2)*Math.max(0,1-((z-18)/11)**2),objects:[]})));
            const loc=await request(`/lobbies/${lobby.id}/locations`,{name:'Snow approval only',world_tile_x:34,world_tile_z:16,grid_width:32,grid_height:32,tiles_data:tiles},token);
            await page.evaluate(`window.enterLocation(${loc.id})`);
            await page.until("window.snowLocal && document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'local snow game frame');
            await page.evaluate("(async()=>{window.previewSnowLocation=await import('/static/js/locationScene.js')})()");
            await page.until('previewSnowLocation.getLocationTerrainMaterialDiagnostics()?.ready','local material ready');
            await page.evaluate("document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()");
        }
        await page.evaluate(`freezeSnowScene('${kind}')`);
        statistics[kind]={};
        for(const config of [{id:'current'},...candidates]){
            await page.evaluate(`setSnowCandidate(${JSON.stringify(config)},'${kind}')`);
            for(const near of [false,true]){
                const target=kind==='world'?[34,1.1,16]:[17,1.5,16];
                const position=near?[target[0]+1.3,target[1]+3.2,target[2]+4.5]:[target[0]+8,target[1]+23,target[2]+25];
                const pixels=await page.evaluate(`(()=>{const c=${kind==='world'?'sceneModule.controls':'window.locationControls'};c.target.set(${target});c.object.position.set(${position});c.update();return drawSnowFrame('${kind}')})()`);
                if(integration){
                    const key=kind+'-'+(near?'near':'far');
                    if(config.id==='current')referencePixels[key]=pixels;
                    else {
                        let total=0,max=0;for(let i=0;i<pixels.length;i++)if(i%4!==3){const d=Math.abs(pixels[i]-referencePixels[key][i]);total+=d;max=Math.max(max,d);}
                        comparisons[key]={meanDifference:total/(128*128*3),maxDifference:max};
                        assert.ok(comparisons[key].meanDifference<=1.5&&max<=12,'packed snow must match approved prototype: '+key+' '+JSON.stringify(comparisons[key]));
                    }
                }
                await capture(kind+'-'+config.id+'-'+(near?'near':'far'));
            }
            statistics[kind][config.id]=await page.evaluate('snowSceneStats()');assert.equal(statistics[kind][config.id].shaderErrors,0);
            // Measure the normal game rAF while the real renderer is enabled. Chunk into short calls.
            await page.evaluate('activeSnowScene.renderer.render=activeSnowScene.snowDraw');
            const intervals=[];
            for(let batch=0;batch<2;batch++) intervals.push(...await page.evaluate(`(async()=>{let last=await new Promise(requestAnimationFrame);const values=[];
                for(let i=0;i<6;i++){const now=await new Promise(requestAnimationFrame);values.push(now-last);last=now;}return values})()`));
            await page.evaluate('activeSnowScene.renderer.render=()=>{}');
            intervals.sort((a,b)=>a-b);statistics[kind][config.id].medianFrameMs=intervals[6];statistics[kind][config.id].fps=1000/intervals[6];
            console.log('Snow metrics:',kind,config.id,JSON.stringify(statistics[kind][config.id]));
            if(!integration&&kind==='local'&&config.id!=='current'){
                for(const diagnostic of ['raw','color-only']){
                    await page.evaluate(`setSnowCandidate(${JSON.stringify({...config,diagnostic})},'local');drawSnowFrame('local')`);
                    await capture('local-'+config.id+'-'+diagnostic+'-near');
                    assert.equal((await page.evaluate('snowSceneStats()')).shaderErrors,0);
                }
            }
        }
    }
    await page.evaluate("setSnowCandidate({id:'current'},'local');drawSnowFrame('local')");
    assert.deepEqual(hashes(),before,'production sources unchanged');
    fs.writeFileSync(path.join(output,'sources.json'),JSON.stringify({sources,candidates:candidates.map(({maps,...c})=>c)},null,2)+'\n');
    fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify({statistics,comparisons,productionHashes:before},null,2)+'\n');
    console.log(integration
        ? 'PASS: packed Snow001 matches approved prototype, both real game scenes, 8 captures, protected production modules and swamp atlas'
        : 'PASS: three new snow bases, both real game scenes, 22 captures, protected production modules and swamp atlas');
};
