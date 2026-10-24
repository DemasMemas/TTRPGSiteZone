import * as THREE from 'three';
import { createSurfaceTexture } from './locationTerrainDetail.js';

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

export function createWaterMaterial({ world = false } = {}) {
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
    material.customProgramCacheKey = () => `world-aligned-water-v3:${world}`;
    material.onBeforeCompile = shader => {
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
            `)
            .replace('#include <map_fragment>', `
                #ifdef USE_MAP
                    vec4 waterSample = texture2D(map, vWaterWorldXZ * ${world ? '0.16' : '0.36'} + waterPatternOffset);
                    vec3 waterColor = vec3(waterSample.a,mix(waterSample.a,waterSample.b,52.0/69.0),waterSample.b);
                    diffuseColor *= sRGBToLinear(vec4(waterColor,1.0));
                #endif
            `)
            .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                vec2 slope = texture2D(map,vWaterWorldXZ*waterRipple.x+waterPatternOffset*4.0).rg*2.0-1.0;
                normal = normalize(normal + (viewMatrix * vec4(-slope.x,0.0,-slope.y,0.0)).xyz
                    * waterRipple.y);
            `);
    };
    return material;
}
