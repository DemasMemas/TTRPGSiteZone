import { STOREY_HEIGHT, doorOnWall, floorVisualPose, structureLevel, structureLevelOffset,
    structurePose, wallVisualPlan } from './locationArchitecture.js';
import { createDirectionalLightField, createDirectionalLightFieldTexture,
    applyDirectionalLightFieldMaterial, removeDirectionalLightFieldMaterial } from './locationDirectionalLightFieldPrototype.js';

export const LOCATION_DIRECTIONAL_FIELD_SAMPLES_PER_METER = 2;
const MAX_DIRECTIONAL_FIELD_BYTES = 128 * 1024 * 1024;

function insideFloor(x, z, pose) {
    const dx = x - pose.x;
    const dz = z - pose.z;
    return Math.abs(dx * pose.axis.x + dz * pose.axis.z) <= pose.width / 2
        && Math.abs(dx * pose.normal.x + dz * pose.normal.z) <= pose.depth / 2;
}

export function locationStaticLightFieldInputs(data, sources, tileHeightAt) {
    const objects = data.objects || [];
    const floors = objects.filter(object => object.type === 'floor').map(object => ({
        level: structureLevel(object), pose: floorVisualPose(object, objects),
        y: tileHeightAt(object.tile_x, object.tile_y) + structureLevelOffset(object)
            + Number(object.properties?.elevation || 0) + 0.035,
    }));
    const decorations = (data.tiles_data || []).flatMap(row=>row.flatMap(tile=>tile.objects || []));
    const knownLevels = [...objects.map(structureLevel), ...decorations.map(structureLevel),
        ...sources.filter(s=>Number.isInteger(s.level)).map(s=>s.level)];
    const maxLevel = Math.max(0, ...knownLevels);
    const minLevel = Math.min(0, ...knownLevels);
    const levels = Array.from({ length: maxLevel - minLevel + 1 }, (_, index) => {
        const id = minLevel + index;
        return {id,y:id*STOREY_HEIGHT};
    });
    const lamps = sources.flatMap((source, index) => {
        const containing = floors.filter(floor => insideFloor(source.x, source.z, floor.pose)
            && source.y >= floor.y + 0.1).sort((a, b) => b.y - a.y);
        return [{ ...source, id: index, level: Number.isInteger(source.level) ? source.level : containing[0]?.level || 0 }];
    });
    const walls = [];
    const wallMountedDoors = new Set();
    for (const wall of objects) {
        if (wall.type !== 'wall') continue;
        const { pose, spans } = wallVisualPlan(wall, objects);
        const level = structureLevel(wall);
        const baseY = tileHeightAt(wall.tile_x, wall.tile_y) + structureLevelOffset(wall)
            + Number(wall.properties?.elevation || 0);
        const add = (start, end, bottom, top) => {
            if (end - start <= 0.01 || top - bottom <= 0.01) return;
            walls.push({ level,
                x1: pose.x + start * pose.axis.x, z1: pose.z + start * pose.axis.z,
                x2: pose.x + end * pose.axis.x, z2: pose.z + end * pose.axis.z,
                bottomY: baseY + bottom, topY: baseY + top });
        };
        for (const span of spans) add(span.start, span.end, span.bottom, span.top);
        for (const portal of objects) {
            if (portal.type !== 'door' || portal.properties?.is_open) continue;
            const opening = doorOnWall(portal, wall);
            if (opening) {
                wallMountedDoors.add(portal);
                add(opening.along - opening.width / 2,
                    opening.along + opening.width / 2, opening.bottom,
                    opening.bottom + opening.height);
            }
        }
    }
    for (const door of objects) {
        if (door.type !== 'door' || door.properties?.is_open || wallMountedDoors.has(door)) continue;
        const pose = structurePose(door);
        const baseY = tileHeightAt(door.tile_x, door.tile_y) + structureLevelOffset(door)
            + Number(door.properties?.elevation || 0);
        walls.push({ level: structureLevel(door),
            x1: pose.x - pose.axis.x * pose.width / 2,
            z1: pose.z - pose.axis.z * pose.width / 2,
            x2: pose.x + pose.axis.x * pose.width / 2,
            z2: pose.z + pose.axis.z * pose.width / 2,
            bottomY: baseY, topY: baseY + pose.height });
    }
    return { width: data.grid_width, height: data.grid_height,
        levels, lamps, walls };
}

export function createLocationDirectionalLightField(THREE, data, sources, tileHeightAt,
    maxTextureSize = Infinity) {
    const startedAt = performance.now();
    const inputs = locationStaticLightFieldInputs(data, sources, tileHeightAt);
    const samplesPerMeter = LOCATION_DIRECTIONAL_FIELD_SAMPLES_PER_METER;
    const planes = inputs.levels.length * 3 * 6;
    const atlasColumns = Math.ceil(Math.sqrt(planes));
    const atlasRows = Math.ceil(planes / atlasColumns);
    const atlasCells = Math.ceil(inputs.width * samplesPerMeter) * atlasColumns
        * Math.ceil(inputs.height * samplesPerMeter) * atlasRows;
    if (Math.ceil(inputs.width * samplesPerMeter) * atlasColumns > maxTextureSize
        || Math.ceil(inputs.height * samplesPerMeter) * atlasRows > maxTextureSize
        || atlasCells * 16 > MAX_DIRECTIONAL_FIELD_BYTES) {
        throw new Error('Directional light field exceeds the texture or memory limit');
    }
    const prepareMs = performance.now() - startedAt;
    const field = createDirectionalLightField({ width: inputs.width, height: inputs.height,
        levels: inputs.levels, samplesPerMeter });
    const stats = { ...field.rebuild({ lamps: inputs.lamps, walls: inputs.walls }), prepareMs, totalMs: performance.now() - startedAt };
    const texture = createDirectionalLightFieldTexture(THREE, field);
    return {
        directional: true, field, texture, stats, inputs,
        update(nextData, nextSources) {
            const updateStartedAt = performance.now();
            const next = locationStaticLightFieldInputs(nextData, nextSources, tileHeightAt);
            if (next.width !== field.width || next.height !== field.height
                || next.levels.length !== field.levels.length
                || next.levels.some((level, index) => level.id !== field.levels[index].id
                    || level.y !== field.levels[index].y)) return false;
            this.inputs = next;
            this.stats = { ...field.rebuild({ lamps: next.lamps, walls: next.walls }), totalMs: performance.now() - updateStartedAt };
            texture.needsUpdate = true;
            return true;
        },
        attach(material, level) {
            if (!material?.isMeshStandardMaterial
                || material.userData.directionalLightFieldPrototype) return;
            applyDirectionalLightFieldMaterial(material, texture, field, level);
        },
        detach(material) { removeDirectionalLightFieldMaterial(material); },
        dispose() { texture.dispose(); },
    };
}
