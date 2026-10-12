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

export function applySurfaceDarkness(material, texture, size) {
    material.onBeforeCompile = shader => {
        shader.uniforms.locationDarknessMap = { value: texture };
        shader.uniforms.locationDarknessSize = { value: size };
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
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D locationDarknessMap;
                uniform vec2 locationDarknessSize;
                varying vec2 vLocationDarkXZ;
            `)
            .replace('#include <color_fragment>', `#include <color_fragment>
                diffuseColor.rgb *= texture2D(locationDarknessMap,
                    clamp(vLocationDarkXZ / locationDarknessSize, vec2(0.0), vec2(1.0))).r;
            `);
    };
}
