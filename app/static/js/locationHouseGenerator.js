// The room graph is transient. Only ordinary location objects are persisted.
const WALL_HEIGHT = 2.4;
const WALL_DEPTH = 0.2;
const DOOR_WIDTH = 0.9;

function hashSeed(seed) {
    let hash = 2166136261;
    for (const character of String(seed)) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function houseFootprint(startX, startZ, endX, endZ) {
    const minX = Math.min(startX, endX);
    const minZ = Math.min(startZ, endZ);
    return { minX, minZ, width: Math.abs(endX - startX) + 1, depth: Math.abs(endZ - startZ) + 1 };
}

export function houseBuildingId(locationId, footprint, seed) {
    const key = [locationId, footprint.minX, footprint.minZ,
        footprint.width, footprint.depth, seed].join(':');
    return `house-${locationId}-${hashSeed(key).toString(36)}`;
}

export function generatedFloorBlueprint(objects, buildingId, level = 0) {
    if (!buildingId || !Array.isArray(objects)) return null;
    const belongs = object => object?.properties?.building_id === buildingId
        && Number(object.properties?.level || 0) === Number(level);
    for (const wall of objects) {
        if (!belongs(wall) || wall.type !== 'wall') continue;
        const spec = wall.properties?.generated_floor_spec;
        const size = spec?.properties?.dimensions;
        if (spec?.type === 'floor' && belongs(spec) && spec.properties?.generation_seed != null
            && Number.isInteger(spec.tile_x) && Number.isInteger(spec.tile_y)
            && Number(size?.width) > 0 && Number(size?.depth) > 0 && Number(size?.height) > 0) {
            return JSON.parse(JSON.stringify(spec));
        }
    }
    return null;
}

export function restorableGeneratedFloor(objects, buildingId, level = 0) {
    if (objects?.some(object => object.type === 'floor'
        && object.properties?.building_id === buildingId
        && Number(object.properties?.level || 0) === Number(level))) return null;
    return generatedFloorBlueprint(objects, buildingId, level);
}

export function planResidentialHouse({ minX, minZ, width, depth, seed = 0, buildingId, assetById = () => null }) {
    if (!Number.isInteger(minX) || !Number.isInteger(minZ)
        || !Number.isInteger(width) || !Number.isInteger(depth)
        || width < 4 || depth < 4 || width > 12 || depth > 12 || !buildingId) {
        return { error: 'Дом: прямоугольник от 4×4 до 12×12 клеток' };
    }
    const maxX = minX + width;
    const maxZ = minZ + depth;
    const mirror = (hashSeed(seed) & 1) === 1;
    const rooms = [];
    const connections = [];
    const objects = [];
    const roomDoors = [];
    const furniture = [];
    const common = { building_id: buildingId, level: 0 };
    const makeObject = (type, name, x, z, length, thickness, height, rotation = 0, extra = {}) => ({
        name, type,
        tile_x: Math.min(maxX - 1, Math.max(minX, Math.floor(x))),
        tile_y: Math.min(maxZ - 1, Math.max(minZ, Math.floor(z))),
        properties: { ...common, dimensions: { width: length, depth: thickness, height },
            offset_x: x - Math.min(maxX - 1, Math.max(minX, Math.floor(x))) - 0.5,
            offset_z: z - Math.min(maxZ - 1, Math.max(minZ, Math.floor(z))) - 0.5,
            rotation, elevation: 0, ...extra },
    });
    const wall = (name, x, z, length, alongZ = false) => {
        objects.push(makeObject('wall', name, x, z, length, WALL_DEPTH, WALL_HEIGHT,
            alongZ ? -Math.PI / 2 : 0, { color: '#d4d0c4' }));
    };
    const door = (name, x, z, alongZ = false, from = null, to = null) => {
        objects.push(makeObject('door', name, x, z, DOOR_WIDTH, 0.18, 2,
            alongZ ? -Math.PI / 2 : 0, { color: '#665241' }));
        if (from && to) {
            connections.push([from, to]);
            roomDoors.push({ x, z, from, to });
        }
    };
    const room = (id, name, left, front, right, back) => {
        rooms.push({ id, name, bounds: { minX: left, minZ: front, maxX: right, maxZ: back } });
    };

    objects.push(makeObject('floor', 'Дом · пол', minX + width / 2, minZ + depth / 2,
        width, depth, 0.12, 0, { color: '#746b5d', roof_type: 'gable',
            generation_seed: String(seed) }));
    wall('Наружная стена', minX + width / 2, minZ, width);
    objects[1].properties.generated_floor_spec = JSON.parse(JSON.stringify(objects[0]));
    wall('Наружная стена', minX + width / 2, maxZ, width);
    wall('Наружная стена', minX, minZ + depth / 2, depth, true);
    wall('Наружная стена', maxX, minZ + depth / 2, depth, true);

    if (width >= 7 && depth >= 7 && width * depth >= 48) {
        const corridorWidth = 1.4;
        const corridorLeft = minX + (width - corridorWidth) / 2;
        const corridorRight = corridorLeft + corridorWidth;
        const splitZ = minZ + depth / 2;
        room('hall', 'Прихожая', corridorLeft, minZ, corridorRight, maxZ);
        const leftRoles = mirror ? [['bedroom', 'Спальня'], ['bathroom', 'Санузел']]
            : [['living', 'Гостиная'], ['kitchen', 'Кухня']];
        const rightRoles = mirror ? [['living', 'Гостиная'], ['kitchen', 'Кухня']]
            : [['bedroom', 'Спальня'], ['bathroom', 'Санузел']];
        for (const [side, edgeX, roles, left, right] of [
            ['left', corridorLeft, leftRoles, minX, corridorLeft],
            ['right', corridorRight, rightRoles, corridorRight, maxX],
        ]) {
            wall('Перегородка прихожей', edgeX, minZ + depth / 2, depth, true);
            wall('Межкомнатная перегородка', (left + right) / 2, splitZ, right - left);
            roles.forEach(([id, name], index) => {
                const front = index ? splitZ : minZ;
                const back = index ? maxZ : splitZ;
                room(id, name, left, front, right, back);
                door(`Дверь: ${name}`, edgeX, (front + back) / 2, true, 'hall', id);
            });
            // A window on the exterior side of each room, away from the corridor doors.
            const outerX = side === 'left' ? minX : maxX;
            for (const z of [(minZ + splitZ) / 2, (splitZ + maxZ) / 2]) {
                objects.push(makeObject('window', 'Окно', outerX, z, 1.2, 0.14, 1,
                    -Math.PI / 2, { color: '#9bb7bc', elevation: 1 }));
            }
        }
        door('Входная дверь', minX + width / 2, minZ, false, 'outside', 'hall');
    } else {
        const splitZ = minZ + (depth < 5 ? depth / 2 : Math.max(2.4, depth * 0.55));
        room('common', 'Прихожая · гостиная · кухня', minX, minZ, maxX, splitZ);
        wall('Межкомнатная перегородка', minX + width / 2, splitZ, width);
        door('Входная дверь', minX + width / 2, minZ, false, 'outside', 'common');
        if (width >= 6 && depth >= 5 && width * depth >= 30) {
            const splitX = minX + width / 2;
            const rearRoles = mirror ? [['bathroom', 'Санузел'], ['bedroom', 'Спальня']]
                : [['bedroom', 'Спальня'], ['bathroom', 'Санузел']];
            wall('Межкомнатная перегородка', splitX, (splitZ + maxZ) / 2, maxZ - splitZ, true);
            rearRoles.forEach(([id, name], index) => {
                const left = index ? splitX : minX;
                const right = index ? maxX : splitX;
                room(id, name, left, splitZ, right, maxZ);
                door(`Дверь: ${name}`, (left + right) / 2, splitZ, false, 'common', id);
                objects.push(makeObject('window', 'Окно', (left + right) / 2, maxZ,
                    1.2, 0.14, 1, 0, { color: '#9bb7bc', elevation: 1 }));
            });
        } else {
            room('bedroom', 'Спальня', minX, splitZ, maxX, maxZ);
            door('Дверь: Спальня', minX + width / 2, splitZ, false, 'common', 'bedroom');
            objects.push(makeObject('window', 'Окно', minX + width / 2, maxZ,
                1.2, 0.14, 1, 0, { color: '#9bb7bc', elevation: 1 }));
        }
    }

    const furnish = (roomId, assetId, x, z, requestedWidth = null) => {
        const bounds = rooms.find(item => item.id === roomId)?.bounds;
        const asset = assetById(assetId);
        if (!bounds || !asset || asset.id !== assetId || !Array.isArray(asset.dimensions)) return;
        const [baseWidth, furnitureDepth, furnitureHeight] = asset.dimensions;
        const furnitureWidth = requestedWidth ?? baseWidth;
        const margin = 0.25;
        if (x - furnitureWidth / 2 < bounds.minX + margin || x + furnitureWidth / 2 > bounds.maxX - margin
            || z - furnitureDepth / 2 < bounds.minZ + margin || z + furnitureDepth / 2 > bounds.maxZ - margin) return;
        if (roomDoors.some(entry => (entry.from === roomId || entry.to === roomId)
            && Math.abs(x - entry.x) < furnitureWidth / 2 + 0.75
            && Math.abs(z - entry.z) < furnitureDepth / 2 + 0.75)) return;
        if (furniture.some(entry => entry.roomId === roomId
            && Math.abs(x - entry.x) < (furnitureWidth + entry.width) / 2 + 0.1
            && Math.abs(z - entry.z) < (furnitureDepth + entry.depth) / 2 + 0.1)) return;
        objects.push(makeObject(assetId, asset.label, x, z, furnitureWidth, furnitureDepth,
            furnitureHeight, 0, { color: asset.color }));
        furniture.push({ roomId, x, z, width: furnitureWidth, depth: furnitureDepth });
    };
    for (const entry of rooms) {
        const { minX: left, minZ: front, maxX: right, maxZ: back } = entry.bounds;
        const outerLeft = left === minX;
        const outerX = outerLeft ? left : right;
        const inward = outerLeft ? 1 : -1;
        if (['common', 'living', 'kitchen'].includes(entry.id)) {
            const tableWidth = width === 4 ? 0.9 : 1.4;
            const tableX = outerX + inward * (width === 4 ? 0.8 : 0.95);
            const tableZ = front + (entry.id === 'common' ? 0.85 : 1.05);
            furnish(entry.id, 'table', tableX, tableZ, tableWidth);
            if (entry.id === 'living') furnish(entry.id, 'chair', tableX + inward * 1.15, tableZ);
        }
        if (['bedroom', 'kitchen'].includes(entry.id)) {
            furnish(entry.id, 'shelf', outerX + inward * 0.55, back - 0.5);
        }
    }

    return { rooms, connections, objects, footprint: { minX, minZ, width, depth } };
}
