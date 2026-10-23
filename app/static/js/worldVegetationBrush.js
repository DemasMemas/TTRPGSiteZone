export const WORLD_VEGETATION_TYPES = new Set(['tree', 'forest']);

function randomAt(x, y, seed) {
    let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function clusterAt(x, y, seed) {
    const cellX = Math.floor(x / 3), cellY = Math.floor(y / 3);
    const smooth = t => t * t * (3 - 2 * t);
    const tx = smooth(x / 3 - cellX), ty = smooth(y / 3 - cellY);
    const a = randomAt(cellX, cellY, seed), b = randomAt(cellX + 1, cellY, seed);
    const c = randomAt(cellX, cellY + 1, seed), d = randomAt(cellX + 1, cellY + 1, seed);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function vegetationStrokeCenters(from, to) {
    if (!from) return [to];
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    if (!steps) return [to];
    return Array.from({ length: steps }, (_, index) => ({
        x: Math.round(from.x + (to.x - from.x) * (index + 1) / steps),
        y: Math.round(from.y + (to.y - from.y) * (index + 1) / steps),
    }));
}

export function planWorldVegetationBrush({ centers, radius, density, ignoreGround, settings, seed,
    width, height, getTile, visited = new Set(), anchor = null }) {
    if (!WORLD_VEGETATION_TYPES.has(settings.type) || !(density > 0)) return [];
    const updates = [];
    const coverage = Math.max(0, Math.min(1, density / 100));
    for (const center of centers) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = center.x + dx, y = center.y + dy;
                if (x < 0 || y < 0 || x >= width || y >= height) continue;
                const key = `${x},${y}`;
                if (visited.has(key)) continue;
                visited.add(key);
                const tile = getTile(x, y);
                if (!tile || (!ignoreGround && ['water', 'rock'].includes(tile.terrain))) continue;
                const objects = tile.objects || [];
                if (objects.some(object => WORLD_VEGETATION_TYPES.has(object.type))) continue;
                // Smooth spatial density creates patches; the per-tile sample
                // leaves gaps within them. Both are independent of stroke order.
                if (radius > 0 && coverage < 1 && randomAt(x, y, seed + 1)
                    >= coverage * (0.15 + 1.7 * clusterAt(x, y, seed))) continue;
                const jitter = settings.type === 'forest' ? 0.24 : 0.34;
                const object = {
                    ...settings,
                    x: radius === 0 && anchor ? Math.max(-0.49, Math.min(0.49, anchor.x - x - 0.5))
                        : (randomAt(x, y, seed + 2) * 2 - 1) * jitter,
                    z: radius === 0 && anchor ? Math.max(-0.49, Math.min(0.49, anchor.z - y - 0.5))
                        : (randomAt(x, y, seed + 3) * 2 - 1) * jitter,
                    scale: Number(Math.max(0.2, Math.min(2,
                        settings.scale * (0.85 + randomAt(x, y, seed + 4) * 0.3))).toFixed(4)),
                    rotation: Math.round(settings.rotation + randomAt(x, y, seed + 5) * 359) % 360,
                };
                updates.push({ chunk_x: Math.floor(x / 32), chunk_y: Math.floor(y / 32),
                    tile_x: x % 32, tile_y: y % 32, updates: { objects: [...objects, object] } });
            }
        }
    }
    return updates;
}
