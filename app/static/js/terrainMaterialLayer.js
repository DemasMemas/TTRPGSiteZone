import { TERRAIN_MATERIALS, TERRAIN_ATLAS_CELL, TERRAIN_REPEAT_TILES,
    TERRAIN_ATLAS_COLUMNS, TERRAIN_ATLAS_ROWS, TERRAIN_ATLAS_GUTTER, adjustTerrainAlbedo,
    terrainMaterialIndex } from './terrainMaterialCatalog.js';

// One atlas set per Three.js module instance, shared by world and local scenes.
// Shared power-of-two atlases; adding surfaces never creates per-chunk PBR maps.
const resources = new WeakMap();
function sharedAtlases(THREE) {
    if (resources.has(THREE)) return resources.get(THREE);
    const size = TERRAIN_ATLAS_CELL;
    const canvases = ['color', 'normal', 'arm'].map(() => {
        const canvas = document.createElement('canvas');
        canvas.width = size * TERRAIN_ATLAS_COLUMNS;
        canvas.height = size * TERRAIN_ATLAS_ROWS;
        return canvas;
    });
    const textures = canvases.map(canvas => {
        const texture = new THREE.CanvasTexture(canvas);
        texture.flipY = false;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 4;
        return texture;
    });
    // One full-resolution snow set, shared by chunks, previews and scene layers.
    // A whole repeating texture has isolated mip levels; the atlas cannot provide
    // that at snow's 3 m scale without bleeding neighbouring material cells.
    const snowTextures = [0, 1].map(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1024;
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 4;
        return texture;
    });
    const result = { textures, snowTextures, ready: { value: 0 }, error: null, promise: null };
    const load = url => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Terrain map unavailable: ${url}`));
        image.src = url;
    });
    result.promise = Promise.all(TERRAIN_MATERIALS.map(async (entry, index) => {
        if (entry.roughnessInColorAlpha) {
            const images = await Promise.all(['color', 'normal'].map(channel => load(entry[channel])));
            images.forEach((image, channel) => {
                const context = snowTextures[channel].image.getContext('2d', { willReadFrequently: channel === 0 });
                context.drawImage(image, 0, 0, 1024, 1024);
                if (channel === 0) {
                    const pixels = context.getImageData(0, 0, 1024, 1024);
                    adjustTerrainAlbedo(pixels.data, entry); // Alpha remains source roughness.
                    context.putImageData(pixels, 0, 0);
                }
            });
            return;
        }
        const images = await Promise.all(['color', 'normal', 'arm'].map(channel => load(entry[channel])));
        images.forEach((image, channel) => {
            const context = canvases[channel].getContext('2d', { willReadFrequently: channel === 0 });
            const x = index % TERRAIN_ATLAS_COLUMNS * size, y = Math.floor(index / TERRAIN_ATLAS_COLUMNS) * size;
            // Match TextureLoader's flipY for each cell, without reversing atlas rows.
            // Wrapped gutters keep bilinear, mip and anisotropic taps inside this material.
            const core = size - 2 * TERRAIN_ATLAS_GUTTER;
            context.save();
            context.beginPath();
            context.rect(x, y, size, size);
            context.clip();
            context.translate(x + TERRAIN_ATLAS_GUTTER, y + size - TERRAIN_ATLAS_GUTTER);
            context.scale(1, -1);
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                context.drawImage(image, dx * core, dz * core, core, core);
            }
            context.restore();
            if (entry.albedo && channel === 0) {
                const pixels = context.getImageData(x, y, size, size);
                adjustTerrainAlbedo(pixels.data, entry);
                context.putImageData(pixels, x, y);
            }
        });
    })).then(() => {
        textures.forEach(texture => { texture.needsUpdate = true; });
        snowTextures.forEach(texture => { texture.needsUpdate = true; });
        result.ready.value = 1;
        return true;
    }).catch(error => {
        result.error = String(error);
        console.warn('Terrain PBR unavailable; keeping existing terrain surfaces', error);
        return false;
    });
    resources.set(THREE, result);
    return result;
}

// The tiny nearest-filtered lookup stores material IDs, never color or PBR pixels.
// A world layer spans the map, so adjacent chunks use precisely the same lookup.
export function createTerrainMaterialLayer(THREE, { world = false } = {}) {
    const atlas = sharedAtlases(THREE);
    const uniforms = { terrainAtlasColor: { value: atlas.textures[0] },
        terrainSnowColorRoughness: { value: atlas.snowTextures[0] },
        terrainSnowNormal: { value: atlas.snowTextures[1] },
        terrainAtlasNormal: { value: atlas.textures[1] }, terrainAtlasArm: { value: atlas.textures[2] },
        terrainAtlasReady: atlas.ready, terrainKinds: { value: null },
        terrainMaterialDarkness: { value: atlas.textures[0] }, terrainMaterialHasDarkness: { value: 0 },
        terrainKindsSize: { value: new THREE.Vector2(1, 1) } };
    let texture = null;
    const layer = {
        ready: atlas.promise,
        setDarkness(texture) {
            uniforms.terrainMaterialDarkness.value = texture || atlas.textures[0];
            uniforms.terrainMaterialHasDarkness.value = texture ? 1 : 0;
        },
        resize(width, height) {
            if (texture?.image.width === width && texture?.image.height === height) return;
            texture?.dispose();
            texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height,
                THREE.RGBAFormat, THREE.UnsignedByteType);
            texture.magFilter = texture.minFilter = THREE.NearestFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            uniforms.terrainKinds.value = texture;
            uniforms.terrainKindsSize.value.set(width, height);
        },
        update(x, z, tile) {
            if (!texture || x < 0 || z < 0 || x >= texture.image.width || z >= texture.image.height) return;
            const offset = (z * texture.image.width + x) * 4;
            const top = terrainMaterialIndex(tile), side = terrainMaterialIndex(tile, true);
            const water = world && tile?.terrain === 'water' ? 255 : 0;
            if (texture.image.data[offset] === top && texture.image.data[offset + 1] === side
                && texture.image.data[offset + 2] === water) return;
            texture.image.data[offset] = top;
            texture.image.data[offset + 1] = side;
            texture.image.data[offset + 2] = water;
            texture.needsUpdate = true;
        },
        fill(tiles, originX = 0, originZ = 0) {
            tiles.forEach((row, z) => row.forEach((tile, x) => layer.update(originX + x, originZ + z, tile)));
        },
        clear(originX, originZ, width, height) {
            for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
                layer.update(originX + x, originZ + z, null);
            }
        },
        dispose() { texture?.dispose(); texture = null; uniforms.terrainKinds.value = null; },
        diagnostics() { return { ready: atlas.ready.value === 1, error: atlas.error,
            atlasBytes: TERRAIN_ATLAS_CELL ** 2 * TERRAIN_ATLAS_COLUMNS * TERRAIN_ATLAS_ROWS * 4 * 4,
            snowBytes: Math.ceil(2 * 1024 ** 2 * 4 * 4 / 3),
            materials: TERRAIN_MATERIALS.length, lookupBytes: texture?.image.data.byteLength || 0 }; },
        apply(material, { sides = false, smooth = false, shore = false } = {}) {
            material.extensions = { ...material.extensions, derivatives: true, shaderTextureLOD: true };
            const previousCompile = material.onBeforeCompile;
            const previousKey = material.customProgramCacheKey?.bind(material);
            material.customProgramCacheKey = () => `${previousKey?.() || ''}:terrain-pbr-v7:${world}:${sides}:${smooth}:${shore}`;
            material.onBeforeCompile = shader => {
                previousCompile?.(shader);
                Object.assign(shader.uniforms, uniforms);
                const topAttribute = smooth && !shader.vertexShader.includes('attribute float terrainTop;')
                    ? 'attribute float terrainTop;' : '';
                shader.vertexShader = shader.vertexShader
                    .replace('#include <common>', `#include <common>
                        varying vec3 vTerrainMaterialPosition;
                        varying vec3 vTerrainMaterialNormal;
                        ${smooth ? `attribute vec2 terrainTileCoord; ${topAttribute} varying vec3 vTerrainOwner;` : ''}`)
                    .replace('#include <project_vertex>', `
                        vec4 terrainPosition = vec4(transformed, 1.0);
                        vec3 terrainNormal = normal;
                        #ifdef USE_INSTANCING
                            terrainPosition = instanceMatrix * terrainPosition;
                            terrainNormal = mat3(instanceMatrix) * terrainNormal;
                        #endif
                        vTerrainMaterialPosition = (modelMatrix * terrainPosition).xyz;
                        vTerrainMaterialNormal = normalize(mat3(modelMatrix) * terrainNormal);
                        ${smooth ? 'vTerrainOwner = vec3(terrainTileCoord, terrainTop);' : ''}
                        #include <project_vertex>`);
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', `#include <common>\n${fragmentHelpers(sides, smooth, world)}`)
                    // Inject after map/color, before scene darkness and static light callbacks.
                    .replace('#include <color_fragment>', `#include <color_fragment>\n${fragmentSample(sides, smooth, world, shore)}`)
                    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                        roughnessFactor = mix(roughnessFactor, max(0.08, terrainArm.g), terrainCoverage);`)
                    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
                        metalnessFactor = mix(metalnessFactor, terrainArm.b, terrainCoverage);`)
                    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
                        if (terrainCoverage > 0.001) {
                            normal = normalize(mix(normal, terrainPerturbNormal(-vViewPosition, normal,
                                terrainUv, normalize(terrainNormalSample), faceDirection), terrainCoverage));
                        }`)
                    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
                        reflectedLight.indirectDiffuse *= mix(1.0, mix(1.0, terrainArm.r, 0.7), terrainCoverage);`);
            };
        },
    };
    layer.resize(1, 1);
    return layer;
}

function fragmentHelpers(sides, smooth, world) {
    return `
        varying vec3 vTerrainMaterialPosition;
        varying vec3 vTerrainMaterialNormal;
        ${smooth ? 'varying vec3 vTerrainOwner;' : ''}
        uniform sampler2D terrainAtlasColor;
        uniform sampler2D terrainAtlasNormal;
        uniform sampler2D terrainAtlasArm;
        uniform sampler2D terrainSnowColorRoughness;
        uniform sampler2D terrainSnowNormal;
        uniform sampler2D terrainKinds;
        uniform vec2 terrainKindsSize;
        uniform float terrainAtlasReady;
        ${sides ? 'uniform sampler2D terrainMaterialDarkness; uniform float terrainMaterialHasDarkness;' : ''}
        vec2 terrainId(vec2 tile) {
            return floor(texture2D(terrainKinds, (clamp(tile, vec2(0.0), terrainKindsSize - 1.0)
                + 0.5) / terrainKindsSize).rg * 255.0 + 0.5);
        }
        vec2 terrainAtlasUv(float id, vec2 uv) {
            float slot = max(0.0, id - 1.0);
            vec2 cellUv = (fract(uv) * ${(TERRAIN_ATLAS_CELL - 2 * TERRAIN_ATLAS_GUTTER).toFixed(1)}
                + ${TERRAIN_ATLAS_GUTTER.toFixed(1)}) / ${TERRAIN_ATLAS_CELL.toFixed(1)};
            return (vec2(mod(slot, ${TERRAIN_ATLAS_COLUMNS.toFixed(1)}), floor(slot / ${TERRAIN_ATLAS_COLUMNS.toFixed(1)}))
                + cellUv) / vec2(${TERRAIN_ATLAS_COLUMNS.toFixed(1)}, ${TERRAIN_ATLAS_ROWS.toFixed(1)});
        }
        vec3 terrainLinear(vec3 color) {
            return mix(color / 12.92, pow((color + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), color));
        }
        vec4 terrainAtlasSample(sampler2D atlas, float id, vec2 uv, vec2 dx, vec2 dy) {
            // Derivatives must use continuous UVs, not fract(atlasUv): otherwise
            // every repeat boundary selects the coarsest mip of the entire atlas.
            #if defined(GL_EXT_shader_texture_lod) || __VERSION__ >= 300
                return texture2DGradEXT(atlas, terrainAtlasUv(id, uv),
                    dx * ${((TERRAIN_ATLAS_CELL - 2 * TERRAIN_ATLAS_GUTTER) / TERRAIN_ATLAS_CELL).toFixed(5)}
                        / vec2(${TERRAIN_ATLAS_COLUMNS.toFixed(1)}, ${TERRAIN_ATLAS_ROWS.toFixed(1)}),
                    dy * ${((TERRAIN_ATLAS_CELL - 2 * TERRAIN_ATLAS_GUTTER) / TERRAIN_ATLAS_CELL).toFixed(5)}
                        / vec2(${TERRAIN_ATLAS_COLUMNS.toFixed(1)}, ${TERRAIN_ATLAS_ROWS.toFixed(1)}));
            #else
                return texture2D(atlas, terrainAtlasUv(id, uv));
            #endif
        }
        vec4 terrainSnowSample(sampler2D map, vec2 uv, vec2 dx, vec2 dy) {
            #if defined(GL_EXT_shader_texture_lod) || __VERSION__ >= 300
                return texture2DGradEXT(map, uv, dx, dy);
            #else
                return texture2D(map, uv);
            #endif
        }
        vec3 terrainPerturbNormal(vec3 eye, vec3 n, vec2 uv, vec3 mapNormal, float faceSign) {
            vec3 q0 = dFdx(eye), q1 = dFdy(eye);
            vec2 st0 = dFdx(uv), st1 = dFdy(uv);
            vec3 t = cross(q1, n) * st0.x + cross(n, q0) * st1.x;
            vec3 b = cross(q1, n) * st0.y + cross(n, q0) * st1.y;
            float scale = faceSign * inversesqrt(max(max(dot(t, t), dot(b, b)), 0.00000001));
            return normalize(t * mapNormal.x * scale + b * mapNormal.y * scale + n * mapNormal.z);
        }
        float terrainNoise(vec2 p) {
            vec2 cell = floor(p), t = fract(p);
            t = t * t * (3.0 - 2.0 * t);
            vec4 h = fract(sin(vec4(dot(cell, vec2(127.1,311.7)),
                dot(cell + vec2(1.0,0.0), vec2(127.1,311.7)),
                dot(cell + vec2(0.0,1.0), vec2(127.1,311.7)),
                dot(cell + 1.0, vec2(127.1,311.7)))) * 43758.5453);
            return mix(mix(h.x,h.y,t.x), mix(h.z,h.w,t.x), t.y);
        }
        vec2 terrainWarp(vec2 uv, float strength) {
            return uv + strength * (vec2(terrainNoise(uv * 1.73), terrainNoise(uv * 1.31 + 13.7)) - 0.5);
        }
        vec4 terrainParameters(float id) {
            ${TERRAIN_MATERIALS.map((entry, index) => `if (id == ${(index + 1).toFixed(1)}) return vec4(${[
                (world ? entry.world?.repeat : null) ?? entry.repeat ?? TERRAIN_REPEAT_TILES,
                (world ? entry.world?.normalStrength : null) ?? entry.normalStrength ?? 1,
                entry.variation ?? 0, entry.warp ?? 0].map(value => value.toFixed(3)).join(',')});`).join('\n')}
            return vec4(${TERRAIN_REPEAT_TILES.toFixed(1)},1.0,0.0,0.0);
        }
        void terrainReadMaterial(float id, vec2 uv, vec2 dx, vec2 dy,
            out vec3 color, out vec3 mapNormal, out vec3 arm) {
            if (id == 6.0) {
                vec4 snow = terrainSnowSample(terrainSnowColorRoughness, uv, dx, dy);
                color = terrainLinear(snow.rgb);
                ${world ? `vec3 macroSnow;
                #if defined(GL_EXT_shader_texture_lod) || __VERSION__ >= 300
                    macroSnow = texture2DLodEXT(terrainSnowColorRoughness, uv * 0.0375, 6.0).rgb;
                #else
                    macroSnow = texture2D(terrainSnowColorRoughness, uv * 0.0375, 6.0).rgb;
                #endif
                color = mix(color, terrainLinear(macroSnow), 0.35);` : ''}
                mapNormal = terrainSnowSample(terrainSnowNormal, uv, dx, dy).xyz * 2.0 - 1.0;
                arm = vec3(1.0, clamp(snow.a, 0.88, 0.98), 0.0);
                return;
            }
            vec3 albedo = terrainAtlasSample(terrainAtlasColor, id, uv, dx, dy).rgb;
            color = terrainLinear(albedo);
            mapNormal = terrainAtlasSample(terrainAtlasNormal, id, uv, dx, dy).xyz * 2.0 - 1.0;
            arm = terrainAtlasSample(terrainAtlasArm, id, uv, dx, dy).rgb;
        }
        void terrainAccumulate(float id, float weight, vec2 uv, vec2 dx, vec2 dy, inout vec3 color,
            inout vec3 mapNormal, inout vec3 arm, inout float coverage) {
            if (id < 0.5 || weight < 0.001) return;
            vec4 settings = terrainParameters(id);
            float uvScale = ${TERRAIN_REPEAT_TILES.toFixed(1)} / settings.x;
            uv *= uvScale; dx *= uvScale; dy *= uvScale;
            if (settings.w > 0.0) {
                vec2 warped = terrainWarp(uv, settings.w);
                dx = terrainWarp(uv + dx, settings.w) - warped;
                dy = terrainWarp(uv + dy, settings.w) - warped;
                uv = warped;
            }
            vec3 materialColor, materialNormal, materialArm;
            terrainReadMaterial(id, uv, dx, dy, materialColor, materialNormal, materialArm);
            // Only sand/snow use a second continuous projection. This retains detail
            // without enlarging one low-resolution atlas cell over 16-18 tiles.
            if (id == 2.0 || id == 6.0) {
                mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
                vec3 otherColor, otherNormal, otherArm;
                terrainReadMaterial(id, turn * uv * 1.37 + vec2(0.31, 0.73),
                    turn * dx * 1.37, turn * dy * 1.37, otherColor, otherNormal, otherArm);
                // Bring the second tangent normal back to the first UV frame.
                otherNormal.xy = vec2(dot(vec2(0.8, 0.6), otherNormal.xy),
                    dot(vec2(-0.6, 0.8), otherNormal.xy));
                float balance = 0.4 + 0.2 * terrainNoise(vTerrainMaterialPosition.xz * 0.17);
                materialColor = mix(materialColor, otherColor, balance);
                materialNormal = normalize(mix(materialNormal, otherNormal, balance));
                materialArm = mix(materialArm, otherArm, balance);
            }
            materialNormal.xy *= settings.y;
            if (id == 1.0 || id == 5.0) materialArm.r = mix(1.0, materialArm.r, 0.65);
            if (id == 3.0) materialArm.r = mix(1.0, materialArm.r, 0.55);
            if (settings.z > 0.0) {
                float variation = terrainNoise(vTerrainMaterialPosition.xz * 0.19)
                    * 0.7 + terrainNoise(vTerrainMaterialPosition.xz * 0.73 + 8.3) * 0.3;
                materialColor *= 1.0 + (variation - 0.5) * settings.z * 2.0;
                if (id == 7.0) {
                    materialColor *= mix(vec3(0.91,0.96,1.0), vec3(1.07,0.94,0.84), variation);
                    materialArm.g = clamp(materialArm.g + (variation - 0.5) * 0.12, 0.08, 1.0);
                    materialArm.b *= 1.0 - variation * 0.2;
                }
            }
            color += materialColor * weight;
            mapNormal += normalize(materialNormal) * weight;
            arm += materialArm * weight;
            coverage += weight;
        }
    `;
}

function fragmentSample(sides, smooth, world, shore) {
    return `
        float terrainCoverage = 0.0;
        vec3 terrainColor = vec3(0.0), terrainNormalSample = vec3(0.0), terrainArm = vec3(0.0);
        vec3 terrainAxis = abs(normalize(vTerrainMaterialNormal));
        bool terrainSide = ${sides ? (smooth ? 'vTerrainOwner.z < 0.5' : 'terrainAxis.y < 0.5') : 'false'};
        vec2 terrainUv = vTerrainMaterialPosition.xz / ${TERRAIN_REPEAT_TILES.toFixed(1)};
        if (terrainSide) terrainUv = (terrainAxis.x > terrainAxis.z
            ? vTerrainMaterialPosition.zy : vTerrainMaterialPosition.xy) / ${TERRAIN_REPEAT_TILES.toFixed(1)};
        // Derivatives must be evaluated before the non-uniform material/weight branches.
        vec2 terrainDx = dFdx(terrainUv), terrainDy = dFdy(terrainUv);
        if (terrainAtlasReady > 0.5) {
            if (terrainSide) {
                vec2 owner = ${smooth ? 'vTerrainOwner.xy' : 'floor(vTerrainMaterialPosition.xz - vTerrainMaterialNormal.xz * 0.02)'};
                float sideId = terrainId(owner).g;
                ${world ? `
                // Grass has no PBR side atlas entry. Use existing bare earth
                // only on the world shore and land walls adjoining water.
                if (sideId == 0.0) {
                    float nearWater = ${shore ? '1.0' : `0.0;
                    for (int z=-1; z<=1; z++) for (int x=-1; x<=1; x++) {
                        vec2 cell = clamp(owner + vec2(float(x),float(z)),vec2(0.0),terrainKindsSize-1.0);
                        nearWater = max(nearWater,texture2D(terrainKinds,(cell+0.5)/terrainKindsSize).b);
                    }`}${shore ? ';' : ''}
                    if (nearWater > 0.5) sideId = ${terrainMaterialIndex('bare_dirt').toFixed(1)};
                }` : ''}
                terrainAccumulate(sideId, 1.0, terrainUv, terrainDx, terrainDy,
                    terrainColor, terrainNormalSample, terrainArm, terrainCoverage);
            } else {
                vec2 cell = floor(vTerrainMaterialPosition.xz - 0.5);
                vec2 blend = smoothstep(vec2(0.28), vec2(0.72), fract(vTerrainMaterialPosition.xz - 0.5));
                vec4 ids = vec4(terrainId(cell).r, terrainId(cell + vec2(1.0, 0.0)).r,
                    terrainId(cell + vec2(0.0, 1.0)).r, terrainId(cell + 1.0).r);
                if (ids.x == ids.y && ids.x == ids.z && ids.x == ids.w) {
                    terrainAccumulate(ids.x, 1.0, terrainUv, terrainDx, terrainDy, terrainColor, terrainNormalSample, terrainArm, terrainCoverage);
                } else {
                    terrainAccumulate(ids.x, (1.0-blend.x)*(1.0-blend.y), terrainUv, terrainDx, terrainDy, terrainColor, terrainNormalSample, terrainArm, terrainCoverage);
                    terrainAccumulate(ids.y, blend.x*(1.0-blend.y), terrainUv, terrainDx, terrainDy, terrainColor, terrainNormalSample, terrainArm, terrainCoverage);
                    terrainAccumulate(ids.z, (1.0-blend.x)*blend.y, terrainUv, terrainDx, terrainDy, terrainColor, terrainNormalSample, terrainArm, terrainCoverage);
                    terrainAccumulate(ids.w, blend.x*blend.y, terrainUv, terrainDx, terrainDy, terrainColor, terrainNormalSample, terrainArm, terrainCoverage);
                }
            }
            if (terrainCoverage > 0.001) {
                ${sides ? `if (terrainMaterialHasDarkness > 0.5) terrainColor *= texture2D(terrainMaterialDarkness,
                    clamp(vTerrainMaterialPosition.xz / terrainKindsSize, vec2(0.0), vec2(1.0))).r;` : ''}
                diffuseColor.rgb = diffuseColor.rgb * (1.0 - terrainCoverage) + terrainColor;
                terrainArm /= terrainCoverage;
            }
        }
    `;
}
