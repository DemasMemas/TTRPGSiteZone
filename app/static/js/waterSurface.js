import * as THREE from 'three';
import { createSurfaceTexture } from './locationTerrainDetail.js';

export const WATER_PROFILE_COLOR_GLSL = `
vec3 waterProfileColor(vec4 context,float sediment,float floc,float rust){
    vec3 appearance = vec3(0.105,0.225,0.275);
    appearance = mix(appearance,vec3(0.34,0.30,0.20),context.r*(0.65+0.25*sediment));
    appearance = mix(appearance,vec3(0.16,0.135,0.095),context.g*(0.85+0.10*floc));
    appearance = mix(appearance,vec3(0.23,0.255,0.26),context.b*0.78);
    appearance = mix(appearance,vec3(0.235,0.175,0.105),context.a*(0.45+0.38*rust));
    return appearance;
}
`;

export function createWaterTexture() {
    const texture=createSurfaceTexture(THREE,'water'),canvas=texture.image,ctx=canvas.getContext('2d'),pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    // Original RGB channels share one wave/defect signal. Preserve R/B in A/B
    // and reconstruct G between them; use RG for a tileable ripple normal.
    // Thus colour and normals share the same existing 128² mipmapped texture.
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const i=(y*canvas.width+x)*4,u=x/canvas.width*Math.PI*2,v=y/canvas.height*Math.PI*2,
            a=Math.cos(u*3+Math.sin(v*2)*.6),b=Math.cos(v*5-u*2);
        pixels.data[i+3]=pixels.data[i];
        pixels.data[i]=Math.round(127.5+(3*a-.8*b)/4*127.5);
        pixels.data[i+1]=Math.round(127.5+(1.2*a*Math.cos(v*2)+2*b)/4*127.5);
    }
    ctx.putImageData(pixels,0,0);texture.encoding=THREE.LinearEncoding;texture.needsUpdate=true;
    return texture;
}

export function createWaterMaterial({ world = false, profileLayer = null } = {}) {
    const waterTexture = createWaterTexture();
    const material = new THREE.MeshStandardMaterial({
        map: waterTexture,
        color: 0xb8c3c7,
        roughness: 0.78,
        metalness: 0,
        emissive: 0x04090d,
        transparent: false,
        opacity: 1,
    });
    material.extensions = { derivatives: true };
    material.customProgramCacheKey = () => `world-aligned-water-v4:${world}:${!!profileLayer}`;
    material.onBeforeCompile = shader => {
        if(profileLayer)Object.assign(shader.uniforms,profileLayer.uniforms);
        shader.uniforms.waterPatternOffset = { value: waterTexture.offset };
        shader.uniforms.waterRipple = { value: new THREE.Vector2(world ? 2 : 0.5, world ? 0.035 : 0.045) };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vWaterWorldXZ;')
            .replace('#include <project_vertex>', `
                vec4 waterWorld = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    waterWorld = instanceMatrix * waterWorld;
                #endif
                vWaterWorldXZ = (modelMatrix * waterWorld).xz;
                #include <project_vertex>
            `);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec2 vWaterWorldXZ;
                uniform vec2 waterPatternOffset;
                uniform vec2 waterRipple;
                ${profileLayer ? `uniform sampler2D waterProfiles;
                uniform vec2 waterProfilesSize;
                vec4 waterContext;
                float waterFloc;
                ${WATER_PROFILE_COLOR_GLSL}` : ''}
            `)
            .replace('#include <map_fragment>', `
                #ifdef USE_MAP
                    vec4 waterSample = texture2D(map, vWaterWorldXZ * ${world ? '0.16' : '0.36'} + waterPatternOffset);
                    vec3 waterColor = vec3(waterSample.a,mix(waterSample.a,waterSample.b,52.0/69.0),waterSample.b);
                    ${profileLayer ? `
                    waterContext = texture2D(waterProfiles, vWaterWorldXZ / waterProfilesSize);
                    float waveSignal=clamp((waterSample.a-55.0/255.0)*20.0,-1.0,1.0);
                    float sediment = smoothstep(-0.35,0.45,waveSignal);
                    waterFloc = smoothstep(0.25,0.70,waterSample.r*0.55+waterSample.g*0.45);
                    float rustStreak = smoothstep(0.38,0.68,waterSample.r)
                        * (0.35+0.65*sediment);
                    // Profile radiance is already in the renderer working (linear) space.
                    vec3 appearance = waterProfileColor(waterContext,sediment,waterFloc,rustStreak);
                    float cleanWave = 1.0+waveSignal*0.12;
                    waterColor = appearance * cleanWave;
                    ` : ''}
                    ${profileLayer ? 'diffuseColor *= vec4(waterColor,1.0);' : 'diffuseColor *= sRGBToLinear(vec4(waterColor,1.0));'}
                #endif
            `)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                vec2 slope = texture2D(map,vWaterWorldXZ*waterRipple.x+waterPatternOffset*4.0).rg*2.0-1.0;
                normal = normalize(normal + (viewMatrix * vec4(-slope.x,0.0,-slope.y,0.0)).xyz
                    * waterRipple.y);
            `);
        if(profileLayer)shader.fragmentShader=shader.fragmentShader
            .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
                roughnessFactor=clamp(roughnessFactor+waterContext.r*0.09+waterContext.b*0.06
                    +waterContext.g*waterFloc*0.08+waterContext.a*0.035,0.7,0.95);`);
    };
    return material;
}
