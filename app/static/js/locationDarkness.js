import { doorOnWall, structurePose } from './locationArchitecture.js';

const key = (x, z) => `${x},${z}`;

export function paintDarkTiles(tiles, width, height, centerX, centerZ, radius, erase = false) {
    const existing = new Set(tiles.map(tile => key(tile.x, tile.z)));
    const next = tiles.slice();
    let changed = false;
    for (let z = Math.max(0, centerZ - radius); z <= Math.min(height - 1, centerZ + radius); z++) {
        for (let x = Math.max(0, centerX - radius); x <= Math.min(width - 1, centerX + radius); x++) {
            const cell = key(x, z);
            if (erase ? existing.delete(cell) : !existing.has(cell)) {
                if (!erase) { existing.add(cell); next.push({ x, z }); }
                changed = true;
            }
        }
    }
    return changed ? (erase ? next.filter(tile => existing.has(key(tile.x, tile.z))) : next) : tiles;
}

function segmentCrossing(start, end, wall, pose = structurePose(wall)) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const determinant = dx * pose.axis.z - dz * pose.axis.x;
    if (Math.abs(determinant) < 1e-6) return null;
    const wx = pose.x - start.x;
    const wz = pose.z - start.z;
    const alongRay = (wx * pose.axis.z - wz * pose.axis.x) / determinant;
    const alongWall = (wx * dz - wz * dx) / determinant;
    if (alongRay <= 0.001 || alongRay >= 0.999 || Math.abs(alongWall) > pose.width / 2) return null;
    return { along: alongWall, fraction: alongRay };
}

export function lightPathOpen(start, end, objects, sight = null) {
    if (sight) {
        for (const wall of sight.walls) {
            if (Math.max(start.x,end.x) < wall.minX || Math.min(start.x,end.x) > wall.maxX
                || Math.max(start.z,end.z) < wall.minZ || Math.min(start.z,end.z) > wall.maxZ) continue;
            const crossing = segmentCrossing(start,end,wall.object,wall.pose);
            if (!crossing) continue;
            const height = sight.fromHeight + (sight.toHeight-sight.fromHeight)*crossing.fraction;
            if (height < wall.bottom || height > wall.top) continue;
            if (!wall.openings.some(o=>Math.abs(crossing.along-o.along)<o.width/2
                && height >= wall.bottom+o.bottom && height <= wall.bottom+o.bottom+o.height)) return false;
        }
        return true;
    }
    for (const wall of objects || []) {
        if (wall?.type !== 'wall') continue;
        const crossing = segmentCrossing(start, end, wall);
        if (crossing === null) continue;
        const portal = (objects || []).some(object => {
            if (!['door', 'window'].includes(object.type) || !object.properties?.is_open) return false;
            const opening = doorOnWall(object, wall);
            return opening && Math.abs(crossing.along - opening.along) < opening.width / 2;
        });
        if (!portal) return false;
    }
    return true;
}

export function computeDarknessFactors(width, height, darkTiles, objects, lights, daylight = 1) {
    const factors = new Float32Array(width * height).fill(1);
    const dark = new Set((darkTiles || []).map(tile => key(tile.x, tile.z)));
    if (!dark.size) return factors;
    const worldSources = [];
    if (daylight > 0.01) {
        for (const portal of objects || []) {
            if (!['door', 'window'].includes(portal.type) || !portal.properties?.is_open) continue;
            if (!(objects || []).some(wall => wall?.type === 'wall' && doorOnWall(portal, wall))) continue;
            const pose = structurePose(portal);
            for (const sign of [-1, 1]) {
                const x = pose.x + pose.normal.x * sign * 0.65;
                const z = pose.z + pose.normal.z * sign * 0.65;
                if (dark.has(key(Math.floor(x), Math.floor(z)))) continue;
                worldSources.push({ x, z, distance: 6, intensity: daylight * 3 });
            }
        }
    }
    for (const tile of darkTiles || []) {
        const x = tile.x + 0.5;
        const z = tile.z + 0.5;
        let illumination = 0;
        for (const source of [...(lights || []), ...worldSources]) {
            const radius = Number(source.distance) || 0;
            const distance = Math.hypot(x - Number(source.x), z - Number(source.z));
            if (radius <= 0 || distance >= radius) continue;
            if (!lightPathOpen({ x: Number(source.x), z: Number(source.z) }, { x, z }, objects)) continue;
            const strength = Math.min(1, Math.max(0, Number(source.intensity) / 3));
            illumination = Math.max(illumination, strength * Math.sqrt(1 - distance / radius));
        }
        factors[tile.z * width + tile.x] = 0.07 + 0.93 * illumination;
    }
    return factors;
}
