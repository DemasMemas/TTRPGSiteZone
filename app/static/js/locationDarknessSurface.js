export function writeDarknessPixels(factors, pixels) {
    for (let index = 0; index < factors.length; index++) {
        const shade = Math.round(Math.max(0, Math.min(1, factors[index])) * 255);
        const offset = index * 4;
        pixels[offset] = shade;
        pixels[offset + 1] = shade;
        pixels[offset + 2] = shade;
        pixels[offset + 3] = 255;
    }
}

export function applySurfaceDarkness(material, texture, size, terrainDetail = null) {
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}:${terrainDetail ? 'location-surface-detail' : 'location-surface-plain'}`;
    material.onBeforeCompile = shader => {
        previousCompile?.(shader);
        shader.uniforms.locationDarknessMap = { value: texture };
        shader.uniforms.locationDarknessSize = { value: size };
        if (terrainDetail) shader.uniforms.locationTerrainDetail = { value: terrainDetail };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vLocationDarkXZ;')
            .replace('#include <project_vertex>', `
                vec4 locationDarkWorld = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    locationDarkWorld = instanceMatrix * locationDarkWorld;
                #endif
                vLocationDarkXZ = (modelMatrix * locationDarkWorld).xz;
                #include <project_vertex>
            `);
        const detailUniform = terrainDetail ? 'uniform sampler2D locationTerrainDetail;' : '';
        const detailColor = terrainDetail ? `
                float terrainShade = texture2D(locationTerrainDetail, vLocationDarkXZ * 0.14).r;
                float grassTintMask = smoothstep(0.045, 0.14, diffuseColor.g - diffuseColor.r);
                float broadGrassTone = texture2D(locationTerrainDetail,
                    vLocationDarkXZ * 0.055 + vec2(0.23, 0.41)).r;
                float patch = smoothstep(0.91, 0.98,
                    broadGrassTone + 0.06 * (terrainShade - 0.94));
                vec3 grassTint = mix(vec3(1.16, 0.92, 0.78),
                    vec3(0.71, 1.13, 0.73), patch);
                diffuseColor.rgb *= mix(vec3(1.0), grassTint, grassTintMask * 0.88);
                float chroma = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b)
                    - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
                float rockMask = 1.0 - smoothstep(0.018, 0.105, chroma);
                float concrete = smoothstep(0.895, 0.98,
                    terrainShade + 0.04 * (broadGrassTone - 0.94));
                diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72 + 0.38 * concrete), rockMask * 0.82);
                float luminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                float swampMask = (1.0 - smoothstep(0.22, 0.36, luminance))
                    * (1.0 - grassTintMask);
                float wet = smoothstep(0.94, 0.99, broadGrassTone);
                vec3 swampTint = mix(vec3(0.91, 1.06, 0.79),
                    vec3(0.71, 0.97, 1.15), wet);
                diffuseColor.rgb *= mix(vec3(1.0), swampTint, swampMask * 0.63);
                diffuseColor.rgb *= 0.61 + 0.44 * terrainShade;
            ` : '';
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D locationDarknessMap;
                uniform vec2 locationDarknessSize;
                varying vec2 vLocationDarkXZ;
                ${detailUniform}
            `)
            .replace('#include <color_fragment>', `#include <color_fragment>
                ${detailColor}
                diffuseColor.rgb *= texture2D(locationDarknessMap,
                    clamp(vLocationDarkXZ / locationDarknessSize, vec2(0.0), vec2(1.0))).r;
            `);
    };
}
