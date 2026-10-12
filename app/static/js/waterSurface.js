import * as THREE from 'three';
import { createSurfaceTexture } from './locationTerrainDetail.js';

export function createWaterTexture() {
    return createSurfaceTexture(THREE, 'water');
}

export function createWaterMaterial() {
    const waterTexture = createWaterTexture();
    const material = new THREE.MeshStandardMaterial({
        map: waterTexture,
        color: 0xc9e1e3,
        roughness: 0.38,
        metalness: 0.08,
        emissive: 0x07121a,
        transparent: false,
        opacity: 1,
    });
    material.customProgramCacheKey = () => 'world-aligned-water-v1';
    material.onBeforeCompile = shader => {
        shader.uniforms.waterPatternOffset = { value: waterTexture.offset };
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
            `)
            .replace('#include <map_fragment>', `
                #ifdef USE_MAP
                    vec4 waterSample = texture2D(map, vWaterWorldXZ * 0.16 + waterPatternOffset);
                    diffuseColor *= mapTexelToLinear(waterSample);
                #endif
            `);
    };
    return material;
}
