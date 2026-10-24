// Experimental world-only shader hook and hand-authored component map, temporary DB.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
module.exports = async ({ page, request, token, lobby, experiment = null }) => {
    const output = path.resolve(__dirname, '../docs/material-previews/' + (experiment?.folder || 'bog-components'));
    fs.mkdirSync(output, { recursive: true });
    const layout = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/material-previews/bog-composition/layout.json')));
    const files = ['lobby3d.js','terrainMaterialCatalog.js','terrainMaterialLayer.js','locationScene.js','locationTerrainTexture.js'];
    const hashes = () => Object.fromEntries(files.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../app/static/js',f))).digest('hex')]));
    const before = hashes();
    await request(`/lobbies/${lobby.id}/chunks/batch`, layout.updates, token);
    await page.until("sceneModule.getWorldTerrainMaterialDiagnostics().ready && sceneModule.chunksMap.get('1,0').tilesData[15][0].terrain==='swamp'", 'component terrain');
    await page.evaluate('sceneModule.controls.target.set(32,1,16);sceneModule.camera.position.set(39,27,45);sceneModule.controls.update()');
    await page.until(`(()=>{let ready=false;sceneModule.scene.traverse(n=>{for(const m of [].concat(n.material||[]))if(sceneModule.renderer.properties.get(m).uniforms?.terrainAtlasColor)ready=true});return ready})()`, 'compiled world atlas');
    // Artist-authored curved ribbons: channel, strength, [world X, world Z, half-width].
    // No random numbers, lattice noise, per-tile stamps or generated water.
    const ribbons = [
        [0,.92,[[20,12,.5],[24,10,1.4],[29,10.5,2.1],[32,13,1.1],[36,14,2.2],[40,12,.8],[43,14,.35]]],
        [0,.85,[[20,17,.4],[25,15,1.8],[29,16,1.1],[30,19,1.8],[34,20,1.1],[39,19,.45]]],
        [0,.9,[[24,22,.45],[27,20,1.2],[30,22.5,1.9],[35,23,1.1],[39,22,.35]]],
        [0,.65,[[28,8,.4],[31,8.5,1.1],[34,10,.6]]],
        [0,.7,[[35,15,.6],[38,17,1.3],[41,18.5,.5]]],
        [1,.8,[[22,14,.3],[25,12.5,.7],[28,13,.35]]],
        [1,.72,[[32.5,15,.35],[35,16.5,1.0],[38,16.2,.45]]],
        [1,.82,[[25,23,.3],[28,22.5,.6],[30.5,24,.3]]],
        [1,.65,[[36,10,.3],[38,10.8,.7],[40,13,.35]]],
        [2,.7,[[30.8,12,.8],[32,13,1],[33.3,13,.55]]],
        [2,.65,[[25.5,19.5,.55],[27.5,20.5,.7],[29,20,.45]]],
    ];
    await page.evaluate(`(async()=>{
        const THREE=await import('three');
        const ribbons=${JSON.stringify(ribbons)};
        // Smooth hand-placed control points with Catmull-Rom; rasterise once on CPU.
        const segments=ribbons.map(([channel,strength,points])=>{
            const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)),false,'centripetal');
            return {channel,strength,points:curve.getPoints(120)};
        });
        const width=512,height=256,data=new Uint8Array(width*height*4);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
            const wx=(x+.5)*64/width,wz=(y+.5)*32/height,w=[0,0,0];
            for(const ribbon of segments){let best=0;
                for(let j=1;j<ribbon.points.length;j++){
                    const a=ribbon.points[j-1],b=ribbon.points[j],dx=b.x-a.x,dz=b.y-a.y;
                    const t=Math.max(0,Math.min(1,((wx-a.x)*dx+(wz-a.y)*dz)/(dx*dx+dz*dz||1)));
                    const d=Math.hypot(wx-a.x-dx*t,wz-a.y-dz*t),radius=a.z+(b.z-a.z)*t;
                    const v=Math.max(0,Math.min(1,(radius+.65-d)/1.3));
                    best=Math.max(best,v*v*(3-2*v));
                }
                w[ribbon.channel]=Math.max(w[ribbon.channel],best*ribbon.strength);
            }
            const scale=1/Math.max(1,w[0]+w[1]+w[2]),i=(y*width+x)*4;
            for(let c=0;c<3;c++)data[i+c]=Math.round(w[c]*scale*255);data[i+3]=255;
        }
        const texture=new THREE.DataTexture(data,width,height,THREE.RGBAFormat);
        texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
        texture.generateMipmaps=true;texture.wrapS=texture.wrapT=THREE.ClampToEdgeWrapping;texture.needsUpdate=true;
        let enabled=false;const materials=[];
        sceneModule.scene.traverse(n=>{for(const m of [].concat(n.material||[])){
            const u=sceneModule.renderer.properties.get(m).uniforms;
            if(!u?.terrainAtlasColor||materials.includes(m))continue;
            materials.push(m);const compile=m.onBeforeCompile,key=m.customProgramCacheKey.bind(m);
            m.customProgramCacheKey=()=>key()+':bog-components:'+enabled;
            m.onBeforeCompile=shader=>{compile(shader);if(!enabled)return;
                shader.uniforms.bogComponentMap={value:texture};
                shader.fragmentShader=shader.fragmentShader.replace('#include <common>',
                    '#include <common>\\nuniform sampler2D bogComponentMap;');
                const hook='color += materialColor * weight;';
                if(!shader.fragmentShader.includes(hook))throw new Error('Missing component hook');
                shader.fragmentShader=shader.fragmentShader.replace(hook,\`
                    if(id==3.0){
                        vec3 w=texture2D(bogComponentMap,vTerrainMaterialPosition.xz/vec2(64.0,32.0)).rgb;
                        w/=max(1.0,w.r+w.g+w.b);
                        float peat=1.0-w.r-w.g-w.b;
                        // Existing microtexture and source normal remain; macro distribution
                        // has its own world scale and never repeats per tile/chunk.
                        float detail=.55+1.8*sqrt(max(0.0,dot(materialColor,vec3(.2126,.7152,.0722))));
                        materialColor=(terrainLinear(vec3(.31,.225,.16))*peat
                            +terrainLinear(vec3(.36,.375,.245))*w.r
                            +terrainLinear(vec3(.53,.465,.32))*w.g
                            +terrainLinear(vec3(.42,.325,.22))*w.b)*detail;
                        materialNormal.xy*=.65;
                        materialArm.r=mix(1.0,materialArm.r,.35);
                        materialArm.g=clamp(materialArm.g,.84,.97);materialArm.b=0.0;
                    }
                    color += materialColor * weight;
                \`);
            };
        }});
        if(!materials.length)throw new Error('No compiled world terrain materials');
        window.setBogComponents=next=>{enabled=next;materials.forEach(m=>m.needsUpdate=true)};
        window.bogComponentStats=()=>({mapWidth:width,mapHeight:height,baseBytes:data.byteLength,
            estimatedMipBytes:Math.ceil(data.byteLength*4/3),materials:materials.length,
            sharedTexture:materials.every(m=>!enabled||sceneModule.renderer.properties.get(m).uniforms?.bogComponentMap?.value===texture)});
        window.bogMapData=()=>Array.from(data);
        window.drawBogComponents=sceneModule.renderer.render.bind(sceneModule.renderer);
        sceneModule.renderer.render=()=>{};
        document.querySelectorAll('.draggable-panel:not(.collapsed) .panel-header .toggle-btn').forEach(b=>b.click());
    })()`);
    if(experiment) await experiment.prepare(page,layout);
    const cameras = { overview: layout.cameras.overview, distant:layout.cameras.distant,
        near:{target:[32,1,16],position:[33.5,4.7,21]},
        boundary:{target:[42,1,20],position:[46,10,31]},
        seam:{target:[32,1,16],position:[32,14,29]} };
    const aim = async camera => page.evaluate(`sceneModule.controls.target.set(${camera.target});sceneModule.camera.position.set(${camera.position});sceneModule.controls.update()`);
    const draw = () => page.evaluate('sceneModule.setCelestialTime(720);sceneModule.renderer.shadowMap.needsUpdate=true;drawBogComponents(sceneModule.scene,sceneModule.camera)');
    // Compile the unmodified shader first; afterwards each mode gets the same camera/light.
    await aim(cameras.overview);await draw();
    const measurements={},allocation={};
    const modes=experiment?.modes || ['existing','prototype'];
    const select=mode=>page.evaluate('setBogComponents('+JSON.stringify(experiment ? mode : mode==='prototype')+')');
    for(const mode of modes){
        await select(mode);
        for(const [view,camera] of Object.entries(cameras)){
            await aim(camera);await draw();
            fs.writeFileSync(path.join(output,mode+'-'+view+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
            console.log('Components screenshot:',mode,view);
        }
        await aim(cameras.overview);await draw();
        allocation[mode]=await page.evaluate('({...sceneModule.renderer.info.memory})');
        // Warm programs/textures, finish GPU before timing. Alternating modes below
        // reduces one-off shader compilation and run-order bias.
        measurements[mode]={};
    }
    for(const mode of [...modes,...modes]){
        await select(mode);await draw();
        await page.evaluate('window.bogFrozenRender=sceneModule.renderer.render;sceneModule.renderer.render=window.drawBogComponents');
        const intervals=[];
        // Short CDP calls avoid a single long evaluation timeout on SwiftShader.
        for(let batch=0;batch<(experiment?2:4);batch++) intervals.push(...await page.evaluate(`(async()=>{
            const samples=[];let previous=await new Promise(requestAnimationFrame);
            for(let i=0;i<6;i++){const now=await new Promise(requestAnimationFrame);samples.push(now-previous);previous=now;}
            return samples;
        })()`));
        await page.evaluate('sceneModule.renderer.render=window.bogFrozenRender');
        intervals.sort((a,b)=>a-b);
        const metrics=await page.evaluate(`(()=>{
            const r=sceneModule.renderer;return {
                calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures,
                geometries:r.info.memory.geometries,jsHeapBytes:performance.memory?.usedJSHeapSize,
                shaderErrors:r.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
        })()`);
        metrics.gameRafMedianMs=intervals[Math.floor(intervals.length/2)];metrics.gameRafFPS=1000/metrics.gameRafMedianMs;
        metrics.p95FrameMs=intervals[Math.floor((intervals.length-1)*.95)];
        assert.equal(metrics.shaderErrors,0);
        (measurements[mode].runs??=[]).push(metrics);
        console.log('FPS sample:',mode,JSON.stringify(metrics));
    }
    const textureStats=await page.evaluate('bogComponentStats()');
    if(!experiment) assert.ok(textureStats.sharedTexture,'one world texture shared by both chunks');
    for(const mode of modes){
        assert.equal(measurements[mode].runs[1].calls,measurements[modes[0]].runs[1].calls);
        assert.equal(measurements[mode].runs[1].triangles,measurements[modes[0]].runs[1].triangles);
    }
    assert.deepEqual(hashes(),before);
    fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify({measurements,allocation,textureStats,productionHashes:before},null,2)+'\n');
    fs.writeFileSync(path.join(output,'distribution.json'),JSON.stringify({domain:[0,0,64,32],metresPerCell:100,ribbons,cameras},null,2)+'\n');
    if(experiment) await experiment.save(page,output);
    await select(modes[0]);await draw();
    console.log('PASS: world-only component prototype, '+modes.length*Object.keys(cameras).length+' matched frames, unchanged production files',JSON.stringify({measurements,textureStats}));
};
