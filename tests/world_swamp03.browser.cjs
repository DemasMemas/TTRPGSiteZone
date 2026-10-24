// TASK-SWAMP-03: runtime-only A/B experiment; never imported by the game.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
module.exports=async context=>{
    const sources=['grass_ground','withered_grass'].map(id=>JSON.parse(fs.readFileSync(path.join(os.tmpdir(),'vtt-swamp03',id,'material.json'))));
    const materials=[{id:'dirty_earth',folder:path.resolve(__dirname,'../app/static/materials/art/dirty_earth')},
        ...sources.map(s=>({id:s.id,folder:path.join(os.tmpdir(),'vtt-swamp03',s.id)}))];
    const maps=materials.map(m=>Object.fromEntries(['color','normal','arm'].map(c=>[c,'data:image/jpeg;base64,'+fs.readFileSync(path.join(m.folder,c+'.jpg')).toString('base64')])));
    // Hand-drawn outlines, not radius strokes: narrow necks, lobes and indentations.
    const patchesA=[
        [0,[[23,10],[25,9.3],[27,9.8],[26.3,10.5],[28.3,11],[27.5,12],[25.6,11.5],[24.8,12.2],[23.5,11.6]]],
        [0,[[30,10],[31.5,9.8],[33,10.6],[32.4,11.4],[34.5,12],[34,13],[32.5,12.8],[31.8,11.9],[30.3,11.6]]],
        [0,[[36,13],[38.5,11.7],[40,12],[39.3,13.2],[40.4,14],[38,14.7],[37.5,14],[36,14.3]]],
        [0,[[23,16],[25.2,14.8],[27,15.3],[26,16],[27.5,17],[26.4,18],[24.3,17.4],[23.4,18],[22.5,17.2]]],
        [0,[[30,17],[32.4,16],[34,16.6],[33,17.6],[35.1,18],[34.5,19.3],[32.7,18.8],[31.4,19.5],[30.5,18.8]]],
        [0,[[28,22],[30,21.2],[32,22],[31.5,22.8],[33,23.2],[32,24],[29.8,23.5],[28.7,24],[27.6,23.2]]],
        [0,[[37,20],[39.3,19.5],[40,20.5],[38.8,21.4],[37,21.7],[36.5,20.8]]],
        [1,[[26,12],[27.5,11.8],[28.7,12.5],[28,13.4],[26.5,13],[25.7,13.5],[25.2,12.7]]],
        [1,[[35,16],[36.7,15.2],[38,15.8],[37,16.5],[38.2,17],[37.3,17.6],[35.4,16.9]]],
        [1,[[29,20],[30.2,19.7],[31.3,20.7],[30.7,21.5],[29.4,21.1],[28.8,21.5],[28.3,20.6]]],
    ];
    const patchesB=[
        [0,[[21,12],[24,9.3],[27,9.5],[28,10.3],[30,9.8],[33,11],[32.6,12],[35.5,12.5],[37,11.6],[40.4,12.1],[39.4,13.8],[41,14.3],[39.6,15.8],[37.4,15],[35.2,15.6],[33.5,14.6],[31,14.9],[30.2,13.1],[27.8,13.7],[26.6,12.1],[24.3,13.4],[22.2,13.3]]],
        [0,[[21,17],[24.5,14.7],[26.5,15],[27.7,16.5],[30,15.5],[32,16.2],[31.5,17.4],[34,18],[36.3,17],[39,18],[41,17.3],[42,19],[39.8,20],[37.7,19.5],[36,21],[33,20],[31.5,21.2],[29.2,19.7],[27.5,20],[26.5,18.5],[23.8,19],[22.4,18.1]]],
        [0,[[26,22],[28.5,20.8],[31,21.6],[33,21.2],[35.5,22.5],[38,21.8],[39,23],[36.7,24],[34,23.5],[31.8,24.4],[29.5,23.5],[27.3,24]]],
        ...patchesA.filter(p=>p[0]===1),
        [1,[[34,10],[35.5,9.7],[37,10.3],[36.2,11.3],[34.5,11.5],[33.8,10.7]]],
        [1,[[24,21],[25.8,20.5],[27,21.3],[26.2,22.2],[24.7,22.7],[24,22]]],
    ];
    const specification={patchesA,patchesB,worldBounds:[0,0,64,32],mapPixels:[512,256],edgeMetres:35};
    await require('./world_swamp_components.browser.cjs')({...context,experiment:{folder:'swamp03',modes:['previous','A','B'],
        prepare:async(page,layout)=>{
            await page.evaluate(`(async()=>{
                const THREE=await import('three'),maps=${JSON.stringify(maps)},layout=${JSON.stringify(layout.updates)},spec=${JSON.stringify(specification)};
                const atlas=[];
                for(const channel of ['color','normal','arm']){
                    const canvas=document.createElement('canvas');canvas.width=canvas.height=1024;
                    const ctx=canvas.getContext('2d',{willReadFrequently:true});
                    for(let id=0;id<3;id++){
                        const image=new Image();image.src=maps[id][channel];await image.decode();
                        const ox=(id%2)*512,oy=Math.floor(id/2)*512;
                        ctx.save();ctx.beginPath();ctx.rect(ox,oy,512,512);ctx.clip();
                        // Copy with periodic gutters; flip exactly as the existing terrain atlas.
                        ctx.translate(ox+8,oy+504);ctx.scale(1,-1);
                        for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)ctx.drawImage(image,x*496,y*496,496,496);
                        ctx.restore();
                    }
                    const texture=new THREE.CanvasTexture(canvas);texture.flipY=false;
                    texture.anisotropy=4;texture.minFilter=THREE.LinearMipmapLinearFilter;atlas.push(texture);
                }
                const tiles=new Map(layout.map(t=>[(t.chunk_x*32+t.tile_x)+','+t.tile_y,t.updates.terrain]));
                function signedDistance(x,y,polygon){let inside=false,d=100;
                    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
                        const a=polygon[j],b=polygon[i];
                        if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
                        const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
                        d=Math.min(d,Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t));
                    }return inside?d:-d;
                }
                const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t)};
                const distributions={},fractions={};
                for(const [name,controls] of [['A',spec.patchesA],['B',spec.patchesB]]){
                    const patches=controls.map(([channel,polygon])=>[channel,new THREE.CatmullRomCurve3(
                        polygon.map(p=>new THREE.Vector3(p[0],0,p[1])),true,'centripetal').getPoints(160).map(p=>[p.x,p.z])]);
                    const data=new Uint8Array(512*256*4),sums=[0,0,0];let covered=0;
                    for(let y=0;y<256;y++)for(let x=0;x<512;x++){
                        const wx=(x+.5)/8,wz=(y+.5)/8,w=[0,0];
                        for(const [channel,polygon] of patches)w[channel]=Math.max(w[channel],smooth(-.35,.35,signedDistance(wx,wz,polygon)));
                        const scale=1/Math.max(1,w[0]+w[1]);w[0]*=scale;w[1]*=scale;
                        // Smooth occupancy derived from unchanged tile IDs, shared in world X/Z.
                        let total=0,swamp=0;
                        for(let dz=-2;dz<=2;dz++)for(let dx=-2;dx<=2;dx++){
                            const tx=Math.floor(wx)+dx,tz=Math.floor(wz)+dz;
                            const weight=Math.exp(-((wx-tx-.5)**2+(wz-tz-.5)**2)/(.85**2*2));
                            total+=weight;if(tiles.get(tx+','+tz)==='swamp')swamp+=weight;
                        }
                        const coverage=smooth(.30,.70,swamp/total),i=(y*512+x)*4;
                        data[i]=w[0]*255;data[i+1]=w[1]*255;data[i+2]=0;data[i+3]=coverage*255;
                        covered+=coverage;sums[0]+=(1-w[0]-w[1])*coverage;sums[1]+=w[0]*coverage;sums[2]+=w[1]*coverage;
                    }
                    const t=new THREE.DataTexture(data,512,256,THREE.RGBAFormat);t.generateMipmaps=true;
                    t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.needsUpdate=true;
                    distributions[name]=t;fractions[name]=sums.map(v=>v/covered);
                }
                let mode='previous';const seen=[];
                sceneModule.scene.traverse(n=>{for(const m of [].concat(n.material||[])){
                    if(!sceneModule.renderer.properties.get(m).uniforms?.terrainAtlasColor||seen.includes(m))continue;
                    seen.push(m);const compile=m.onBeforeCompile,key=m.customProgramCacheKey.bind(m);
                    m.customProgramCacheKey=()=>key()+':swamp03:'+mode;
                    m.onBeforeCompile=shader=>{compile(shader);if(mode==='previous')return;
                        shader.uniforms.bog03Weights={value:distributions[mode]};
                        ['Color','Normal','Arm'].forEach((c,i)=>shader.uniforms['bog03'+c]={value:atlas[i]});
                        const definitions=\`
                            uniform sampler2D bog03Weights,bog03Color,bog03Normal,bog03Arm;
                            vec4 bog03Sample(sampler2D tex,float id,vec2 uv,vec2 dx,vec2 dy){
                                vec2 cell=vec2(mod(id,2.0),floor(id/2.0));
                                vec2 at=(cell+vec2(.015625)+fract(uv)*.96875)*.5;
                                #if defined(GL_EXT_shader_texture_lod) || __VERSION__ >= 300
                                    return texture2DGradEXT(tex,at,dx*.484375,dy*.484375);
                                #else
                                    return texture2D(tex,at);
                                #endif
                            }
                            void bog03Surface(vec3 weights,vec2 world,vec2 ddx,vec2 ddy,out vec3 c,out vec3 n,out vec3 arm){
                                // Three genuinely separate source Color / Normal GL / ARM sets.
                                vec3 c0=terrainLinear(bog03Sample(bog03Color,0.0,world*2.0,ddx*2.0,ddy*2.0).rgb);
                                vec3 c1=terrainLinear(bog03Sample(bog03Color,1.0,world*1.3,ddx*1.3,ddy*1.3).rgb);
                                vec3 c2=terrainLinear(bog03Sample(bog03Color,2.0,world*1.8,ddx*1.8,ddy*1.8).rgb);
                                mat2 turn=mat2(.8,.6,-.6,.8);
                                c0=mix(c0,terrainLinear(bog03Sample(bog03Color,0.0,turn*world*2.74+vec2(.31,.73),turn*ddx*2.74,turn*ddy*2.74).rgb),.5);
                                c1=mix(c1,terrainLinear(bog03Sample(bog03Color,1.0,turn*world*1.781+vec2(.23,.57),turn*ddx*1.781,turn*ddy*1.781).rgb),.5);
                                c2=mix(c2,terrainLinear(bog03Sample(bog03Color,2.0,turn*world*2.466+vec2(.67,.19),turn*ddx*2.466,turn*ddy*2.466).rgb),.5);
                                vec3 n0=bog03Sample(bog03Normal,0.0,world*2.0,ddx*2.0,ddy*2.0).xyz*2.0-1.0;
                                vec3 n1=bog03Sample(bog03Normal,1.0,world*1.3,ddx*1.3,ddy*1.3).xyz*2.0-1.0;
                                vec3 n2=bog03Sample(bog03Normal,2.0,world*1.8,ddx*1.8,ddy*1.8).xyz*2.0-1.0;
                                vec3 a0=bog03Sample(bog03Arm,0.0,world*2.0,ddx*2.0,ddy*2.0).rgb;
                                vec3 a1=bog03Sample(bog03Arm,1.0,world*1.3,ddx*1.3,ddy*1.3).rgb;
                                vec3 a2=bog03Sample(bog03Arm,2.0,world*1.8,ddx*1.8,ddy*1.8).rgb;
                                // Surface detail breaks the short transition, not the macro layout.
                                weights.xy=clamp(weights.xy+(vec2(a1.r,a2.r)-.6)*.24*weights.xy*(1.0-weights.xy),0.0,1.0);
                                weights.z=max(0.0,1.0-weights.x-weights.y);weights/=dot(weights,vec3(1.0));
                                float l0=dot(c0,vec3(.2126,.7152,.0722));
                                float l1=dot(c1,vec3(.2126,.7152,.0722));
                                float l2=dot(c2,vec3(.2126,.7152,.0722));
                                c0=mix(vec3(l0),c0,.35)*vec3(1.15,1.05,.95);
                                c1=mix(vec3(l1),c1,.35)*vec3(.83,.91,.65);
                                c2=mix(c0,mix(vec3(l2),c2,.25)*vec3(.62,.60,.49),.45);
                                n2=normalize(mix(n0,n2,.45));a2=mix(a0,a2,.45);
                                c=c0*weights.z+c1*weights.x+c2*weights.y;
                                n=normalize(n0*weights.z+n1*weights.x+n2*weights.y);n.xy*=.38;
                                arm=a0*weights.z+a1*weights.x+a2*weights.y;
                                arm.r=mix(1.0,arm.r,.5);arm.g=clamp(arm.g,.80,.97);arm.b=0.0;
                            }
                        \`;
                        // Function definitions go after terrainLinear has been declared.
                        shader.fragmentShader=shader.fragmentShader.replace('void terrainAccumulate(',definitions+'\\nvoid terrainAccumulate(');
                        shader.fragmentShader=shader.fragmentShader.replace('if (id < 0.5 || weight < 0.001) return;',
                            'if (id < 0.5 || weight < 0.001 || id == 3.0) return;');
                        // Replace the rejected colour-ribbon expression, which is now unreachable.
                        shader.fragmentShader=shader.fragmentShader.replace(/if\\(id==3\\.0\\)\\{[\\s\\S]*?color \\+= materialColor \\* weight;/,'color += materialColor * weight;');
                        const hook='if (terrainCoverage > 0.001) {';
                        if(!shader.fragmentShader.includes(hook))throw new Error('Missing surface blend hook');
                        shader.fragmentShader=shader.fragmentShader.replace(hook,\`
                            vec4 bogWeights=texture2D(bog03Weights,vTerrainMaterialPosition.xz/vec2(64.0,32.0));
                            if(!terrainSide && bogWeights.a>.001){
                                vec3 bogC,bogN,bogA;
                                bog03Surface(vec3(bogWeights.rg,0.0),vTerrainMaterialPosition.xz,terrainDx*4.0,terrainDy*4.0,bogC,bogN,bogA);
                                float oldCoverage=terrainCoverage;
                                vec3 background=oldCoverage>.001?terrainColor/oldCoverage:diffuseColor.rgb;
                                vec3 oldN=oldCoverage>.001?normalize(terrainNormalSample):vec3(0.0,0.0,1.0);
                                vec3 oldA=oldCoverage>.001?terrainArm/oldCoverage:vec3(1.0,.94,0.0);
                                terrainColor=mix(background,bogC,bogWeights.a);terrainCoverage=1.0;
                                terrainNormalSample=normalize(mix(oldN,bogN,bogWeights.a));
                                terrainArm=mix(oldA,bogA,bogWeights.a);
                            }
                            if (terrainCoverage > 0.001) {
                        \`);
                    };
                }});
                const oldSet=window.setBogComponents;
                window.setBogComponents=next=>{mode=next;oldSet(true);seen.forEach(m=>m.needsUpdate=true)};
                window.swamp03Stats=()=>({fractions,atlasBytesWithMips:3*1024*1024*4*4/3,
                    mapsBytesWithMips:2*512*256*4*4/3,sourceSets:3,sharedMaterials:seen.length,
                    sharedWeights:seen.every(m=>sceneModule.renderer.properties.get(m).uniforms?.bog03Weights?.value===distributions[mode]),
                    materials:seen.map(m=>({mode,hasWeights:!!sceneModule.renderer.properties.get(m).uniforms?.bog03Weights}))});
            })()`);
            const stats=await page.evaluate('swamp03Stats()');
            assert.ok(stats.fractions.A[1]>.1 && stats.fractions.B[1]>stats.fractions.A[1]+.15,'both manually drawn component maps must contain distinct vegetation coverage');
        },save:async(page,output)=>{
            const stats=await page.evaluate('swamp03Stats()');
            assert.ok(stats.sharedWeights,'one component map shared across world chunk materials');
            assert.ok(stats.fractions.B[1]>stats.fractions.A[1]+.15);
            fs.writeFileSync(path.join(output,'components.json'),JSON.stringify({specification,sources,existingMaterial:'app/static/materials/art/dirty_earth/material.json',stats},null,2)+'\n');
        }
    }});
};
