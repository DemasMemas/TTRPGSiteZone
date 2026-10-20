// Shared field math and shader hook for the isolated fixture and the opt-in location test.
export const STATIC_LIGHT_FIELD_RANGE = 8;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function wallCrossesRay(x1, z1, y1, x2, z2, y2, wall) {
    const rx = x2 - x1;
    const rz = z2 - z1;
    const sx = wall.x2 - wall.x1;
    const sz = wall.z2 - wall.z1;
    const divisor = rx * sz - rz * sx;
    if (Math.abs(divisor) < 1e-8) return false;
    const dx = wall.x1 - x1;
    const dz = wall.z1 - z1;
    const rayFraction = (dx * sz - dz * sx) / divisor;
    const wallFraction = (dx * rz - dz * rx) / divisor;
    const crossingY = y1 + (y2 - y1) * rayFraction;
    return rayFraction > 1e-4 && rayFraction < 1 - 1e-4
        && wallFraction >= -1e-4 && wallFraction <= 1 + 1e-4
        && (wall.bottomY == null || crossingY >= wall.bottomY - 1e-4)
        && (wall.topY == null || crossingY <= wall.topY + 1e-4);
}

function lightColor(value) {
    const hex = /^#([0-9a-f]{6})$/i.exec(value || '');
    if (!hex) throw new Error(`Static light field requires a six-digit color: ${value}`);
    const number = Number.parseInt(hex[1], 16);
    return [(number >> 16) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

export function createStaticLightField({ width, height, levels, samplesPerMeter = 4,
    surfaceHeightAt = null }) {
    if (!(width > 0 && height > 0) || !Number.isInteger(samplesPerMeter) || samplesPerMeter < 1
        || !Array.isArray(levels) || !levels.length || levels.some(level =>
            !Number.isFinite(Number(level.id)) || !Number.isFinite(Number(level.y)))) {
        throw new Error('Invalid static light field dimensions or levels');
    }
    const columns = Math.ceil(width * samplesPerMeter);
    const rows = Math.ceil(height * samplesPerMeter);
    const levelIndex = new Map(levels.map((level, index) => [Number(level.id), index]));
    if (levelIndex.size !== levels.length) throw new Error('Duplicate static light field level');
    const planeCells = columns * rows * levels.length;
    const pixels = new Uint8Array(planeCells * 2 * 4);
    const radiance = new Float32Array(planeCells * 2 * 3);
    const surfaceHeights = surfaceHeightAt ? new Float32Array(planeCells) : null;
    const wallDistance = new Float32Array(planeCells);
    const wallNormalX = new Float32Array(planeCells);
    const wallNormalZ = new Float32Array(planeCells);
    const wallHeight = new Float32Array(planeCells);

    function samplePlane(x, z, level, wall) {
        const layer = levelIndex.get(Number(level));
        if (layer == null) return [0, 0, 0];
        const column = clamp(Math.floor(x * samplesPerMeter), 0, columns - 1);
        const row = clamp(Math.floor(z * samplesPerMeter), 0, rows - 1);
        const offset = (((layer * rows + row) * columns + column)
            + (wall ? planeCells : 0)) * 4;
        return [0, 1, 2].map(channel => pixels[offset + channel]
            * STATIC_LIGHT_FIELD_RANGE / 255);
    }
    const sample = (x, z, level) => samplePlane(x, z, level, false);
    const sampleWall = (x, z, level) => samplePlane(x, z, level, true);

    function rebuild({ lamps = [], walls = [], dynamicLightIds = new Set() } = {}) {
        const startedAt = performance.now();
        radiance.fill(0);
        wallDistance.fill(Infinity);
        if (surfaceHeights) {
            for (let layer = 0; layer < levels.length; layer++) {
                for (let row = 0; row < rows; row++) {
                    for (let column = 0; column < columns; column++) {
                        surfaceHeights[(layer * rows + row) * columns + column] = surfaceHeightAt(
                            (column + 0.5) / samplesPerMeter,
                            (row + 0.5) / samplesPerMeter, levels[layer].id,
                        );
                    }
                }
            }
        }
        // Rasterize only cells near actual wall faces; the second texture plane shares the same atlas.
        for (const wall of walls) {
            const layer = levelIndex.get(Number(wall.level));
            if (layer == null) continue;
            const dx = wall.x2 - wall.x1;
            const dz = wall.z2 - wall.z1;
            const lengthSquared = dx * dx + dz * dz;
            if (lengthSquared < 1e-8) continue;
            const length = Math.sqrt(lengthSquared);
            const xMin = clamp(Math.floor((Math.min(wall.x1, wall.x2) - 0.5) * samplesPerMeter), 0, columns - 1);
            const xMax = clamp(Math.ceil((Math.max(wall.x1, wall.x2) + 0.5) * samplesPerMeter), 0, columns - 1);
            const zMin = clamp(Math.floor((Math.min(wall.z1, wall.z2) - 0.5) * samplesPerMeter), 0, rows - 1);
            const zMax = clamp(Math.ceil((Math.max(wall.z1, wall.z2) + 0.5) * samplesPerMeter), 0, rows - 1);
            for (let row = zMin; row <= zMax; row++) {
                const z = (row + 0.5) / samplesPerMeter;
                for (let column = xMin; column <= xMax; column++) {
                    const x = (column + 0.5) / samplesPerMeter;
                    const along = clamp(((x - wall.x1) * dx + (z - wall.z1) * dz) / lengthSquared, 0, 1);
                    const sideX = x - wall.x1 - along * dx;
                    const sideZ = z - wall.z1 - along * dz;
                    const distance = Math.hypot(sideX, sideZ);
                    const side = sideX * -dz + sideZ * dx;
                    const index = (layer * rows + row) * columns + column;
                    if (distance > 0.5 || Math.abs(side) < 1e-6 || distance >= wallDistance[index]) continue;
                    wallDistance[index] = distance;
                    const sign = Math.sign(side) / length;
                    wallNormalX[index] = -dz * sign;
                    wallNormalZ[index] = dx * sign;
                    wallHeight[index] = wall.bottomY != null && wall.topY != null
                        ? (wall.bottomY + wall.topY) / 2 : Number(levels[layer].y) + 1.2;
                }
            }
        }
        const lampStats = lamps.map(lamp => ({ id: lamp.id,
            reason: dynamicLightIds.has(lamp.id) ? 'dynamic'
                : !(Number(lamp.intensity) > 0) ? 'off'
                    : !(Number(lamp.distance) > 0) ? 'no-range'
                        : !levelIndex.has(Number(lamp.level)) ? 'missing-level' : 'field',
            sampleVisits: 0, blockedCells: 0, contributions: 0 }));
        const active = lamps.flatMap((lamp, index) => lampStats[index].reason === 'field'
            ? [{ lamp, sourceStats: lampStats[index] }] : []);
        let sampleVisits = 0;
        let wallChecks = 0;
        let contributions = 0;
        for (const { lamp, sourceStats } of active) {
            const layer = levelIndex.get(Number(lamp.level));
            const floorY = Number(levels[layer].y);
            const x = Number(lamp.x);
            const z = Number(lamp.z);
            const y = Number(lamp.y);
            const radius = Number(lamp.distance);
            const radiusSquared = radius * radius;
            const heightSquared = (y - floorY) ** 2;
            if (!Number.isFinite(x + y + z) || (!surfaceHeights && heightSquared >= radiusSquared)) {
                sourceStats.reason = 'outside-range';
                continue;
            }
            const rgb = lightColor(lamp.color);
            const nearbyWalls = walls.filter(wall => Number(wall.level) === Number(lamp.level)
                && Math.min(wall.x1, wall.x2) <= x + radius
                && Math.max(wall.x1, wall.x2) >= x - radius
                && Math.min(wall.z1, wall.z2) <= z + radius
                && Math.max(wall.z1, wall.z2) >= z - radius);
            const xMin = clamp(Math.floor((x - radius) * samplesPerMeter), 0, columns - 1);
            const xMax = clamp(Math.ceil((x + radius) * samplesPerMeter), 0, columns - 1);
            const zMin = clamp(Math.floor((z - radius) * samplesPerMeter), 0, rows - 1);
            const zMax = clamp(Math.ceil((z + radius) * samplesPerMeter), 0, rows - 1);
            for (let row = zMin; row <= zMax; row++) {
                const worldZ = (row + 0.5) / samplesPerMeter;
                for (let column = xMin; column <= xMax; column++) {
                    sampleVisits++;
                    sourceStats.sampleVisits++;
                    const worldX = (column + 0.5) / samplesPerMeter;
                    const sampleY = surfaceHeights
                        ? surfaceHeights[(layer * rows + row) * columns + column] : floorY;
                    const distanceSquared = (worldX - x) ** 2 + (worldZ - z) ** 2
                        + (y - sampleY) ** 2;
                    const index = (layer * rows + row) * columns + column;
                    if (distanceSquared < radiusSquared) {
                        let blocked = false;
                        for (const wall of nearbyWalls) {
                            wallChecks++;
                            if (wallCrossesRay(x, z, y, worldX, worldZ, sampleY, wall)) {
                                blocked = true;
                                break;
                            }
                        }
                        if (blocked) sourceStats.blockedCells++;
                        else {
                            const distance = Math.sqrt(distanceSquared);
                            // Match the legacy PointLight decay=2 and floor cosine used by Three.js r128.
                            const falloff = (1 - distance / radius) ** 2;
                            const floorCosine = Math.max(0, (y - sampleY) / Math.max(distance, 0.0001));
                            const strength = Number(lamp.intensity) * falloff * floorCosine;
                            const offset = index * 3;
                            for (let channel = 0; channel < 3; channel++) radiance[offset + channel] += rgb[channel] * strength;
                            if (strength > 0) { contributions++; sourceStats.contributions++; }
                        }
                    }
                    if (wallDistance[index] === Infinity) continue;
                    const wallY = wallHeight[index];
                    const wallDistanceSquared = (worldX - x) ** 2 + (worldZ - z) ** 2
                        + (y - wallY) ** 2;
                    if (wallDistanceSquared >= radiusSquared) continue;
                    let wallBlocked = false;
                    for (const wall of nearbyWalls) {
                        wallChecks++;
                        if (wallCrossesRay(x, z, y, worldX, worldZ, wallY, wall)) {
                            wallBlocked = true;
                            break;
                        }
                    }
                    if (wallBlocked) continue;
                    const wallRange = Math.sqrt(wallDistanceSquared);
                    const incidence = Math.max(0, ((x - worldX) * wallNormalX[index]
                        + (z - worldZ) * wallNormalZ[index]) / Math.max(wallRange, 0.0001));
                    const wallStrength = Number(lamp.intensity)
                        * (1 - wallRange / radius) ** 2 * incidence;
                    const wallOffset = (planeCells + index) * 3;
                    for (let channel = 0; channel < 3; channel++) {
                        radiance[wallOffset + channel] += rgb[channel] * wallStrength;
                    }
                }
            }
        }
        for (let index = 0; index < radiance.length / 3; index++) {
            const source = index * 3;
            const destination = index * 4;
            for (let channel = 0; channel < 3; channel++) {
                pixels[destination + channel] = Math.round(255 * Math.min(
                    radiance[source + channel] / STATIC_LIGHT_FIELD_RANGE, 1));
            }
            pixels[destination + 3] = 255;
        }
        return {
            buildMs: performance.now() - startedAt, activeLights: active.length,
            excludedLights: lamps.length - active.length, sampleVisits, wallChecks, contributions,
            fieldBytes: pixels.byteLength + radiance.byteLength + (surfaceHeights?.byteLength || 0)
                + wallDistance.byteLength + wallNormalX.byteLength + wallNormalZ.byteLength
                + wallHeight.byteLength,
            lampStats,
        };
    }

    return { width, height, columns, rows, levels, samplesPerMeter, pixels, sample, sampleWall, rebuild };
}

export function createStaticLightFieldTexture(THREE, field) {
    const texture = new THREE.DataTexture(field.pixels, field.columns,
        field.rows * field.levels.length * 2, THREE.RGBAFormat);
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
}

export function applyStaticLightFieldMaterial(material, texture, field, level = 0) {
    if (!material?.isMeshStandardMaterial || !field.levels.some(item => Number(item.id) === Number(level))) {
        throw new Error('Static light field prototype requires MeshStandardMaterial and a known level');
    }
    if (material.userData.staticLightFieldPrototype) {
        throw new Error('Static light field prototype already installed on this material');
    }
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const controls = { enabled: { value: 1 } };
    material.userData.staticLightFieldPrototype = { ...controls, previousCompile, previousKey };
    material.customProgramCacheKey = () => `${previousKey ? previousKey.call(material) : ''}:static-light-field-prototype-v2`;
    material.onBeforeCompile = shader => {
        previousCompile?.(shader);
        const vertexMarker = '#include <project_vertex>';
        const fragmentMarker = '#include <lights_fragment_end>';
        if (!shader.vertexShader.includes(vertexMarker) || !shader.fragmentShader.includes(fragmentMarker)) {
            throw new Error('Unsupported Three.js shader chunks for static light field prototype');
        }
        shader.uniforms.staticLightFieldMap = { value: texture };
        shader.uniforms.staticLightFieldSize = { value: [field.width, field.height] };
        shader.uniforms.staticLightFieldGrid = { value: [field.columns, field.rows] };
        shader.uniforms.staticLightFieldLevel = { value: field.levels.findIndex(item => Number(item.id) === Number(level)) };
        shader.uniforms.staticLightFieldLayers = { value: field.levels.length };
        shader.uniforms.staticLightFieldEnabled = controls.enabled;
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', `#include <common>
                varying vec3 vStaticLightWorldPosition;
                varying vec3 vStaticLightWorldNormal;`)
            .replace(vertexMarker, `
                vec4 staticLightPosition = vec4(transformed, 1.0);
                vec3 staticLightNormal = normal;
                #ifdef USE_INSTANCING
                    staticLightPosition = instanceMatrix * staticLightPosition;
                    staticLightNormal = mat3(instanceMatrix) * staticLightNormal;
                #endif
                vStaticLightWorldPosition = (modelMatrix * staticLightPosition).xyz;
                vStaticLightWorldNormal = normalize(mat3(modelMatrix) * staticLightNormal);
                ${vertexMarker}`);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D staticLightFieldMap;
                uniform vec2 staticLightFieldSize;
                uniform vec2 staticLightFieldGrid;
                uniform float staticLightFieldLevel;
                uniform float staticLightFieldLayers;
                uniform float staticLightFieldEnabled;
                varying vec3 vStaticLightWorldPosition;
                varying vec3 vStaticLightWorldNormal;`)
            .replace(fragmentMarker, `${fragmentMarker}
                if (staticLightFieldEnabled > 0.5) {
                    vec3 fieldNormal = normalize(vStaticLightWorldNormal);
                    vec2 wallOffset = fieldNormal.xz * (1.0 - abs(fieldNormal.y))
                        * (0.55 * staticLightFieldSize / staticLightFieldGrid);
                    vec2 position = clamp(vStaticLightWorldPosition.xz + wallOffset,
                        vec2(0.0), staticLightFieldSize - vec2(0.0001));
                    vec2 cell = floor(position * staticLightFieldGrid / staticLightFieldSize);
                    float surfaceLayer = staticLightFieldLevel
                        + (abs(fieldNormal.y) < 0.5 ? staticLightFieldLayers : 0.0);
                    vec2 fieldUv = vec2((cell.x + 0.5) / staticLightFieldGrid.x,
                        (surfaceLayer * staticLightFieldGrid.y + cell.y + 0.5)
                        / (staticLightFieldGrid.y * staticLightFieldLayers * 2.0));
                    vec3 fieldIrradiance = texture2D(staticLightFieldMap, fieldUv).rgb
                        * ${STATIC_LIGHT_FIELD_RANGE.toFixed(1)};
                    // Three.js r128 multiplies direct irradiance by PI in its legacy lighting mode.
                    #ifndef PHYSICALLY_CORRECT_LIGHTS
                        fieldIrradiance *= PI;
                    #endif
                    reflectedLight.indirectDiffuse += fieldIrradiance
                        * BRDF_Diffuse_Lambert(material.diffuseColor);
                }`);
    };
    material.needsUpdate = true;
    return controls;
}

export function removeStaticLightFieldMaterial(material) {
    const state = material?.userData?.staticLightFieldPrototype;
    if (!state) return false;
    material.onBeforeCompile = state.previousCompile;
    material.customProgramCacheKey = state.previousKey;
    delete material.userData.staticLightFieldPrototype;
    material.needsUpdate = true;
    return true;
}
