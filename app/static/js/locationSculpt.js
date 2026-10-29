// Heights stay in the existing tile data, in metres. Water keeps its own level.
export function sculptHeightChanges(tiles, from, to, seconds, { mode, radius, strength, softness, minHeight = -3, maxHeight = 3 }) {
    const changes = [];
    const reach = radius + 0.5;
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const samples = Math.max(1, Math.ceil(distance / Math.max(0.25, reach / 4)));
    const targets = new Map();
    for (let i = 1; i <= samples; i++) {
        let cx = from.x + (to.x - from.x) * i / samples;
        let cz = from.z + (to.z - from.z) * i / samples;
        // The existing zero-radius brush means one cell. Snap this smallest
        // footprint so a pointer at a tile corner cannot miss every cell centre.
        if (radius === 0) { cx = Math.floor(cx) + .5; cz = Math.floor(cz) + .5; }
        for (let z = Math.max(0, Math.floor(cz - reach)); z <= Math.min(tiles.length - 1, Math.floor(cz + reach)); z++) {
            for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(tiles[z].length - 1, Math.floor(cx + reach)); x++) {
                if (tiles[z][x].terrain === 'water') continue;
                const d = Math.hypot(x + .5 - cx, z + .5 - cz) / reach;
                if (d >= 1) continue;
                const edge = Math.min(1, (1 - d) / Math.max(.001, softness));
                const weight = edge * edge * (3 - 2 * edge) / samples;
                const key = `${x},${z}`;
                const target = targets.get(key) || { x, z, weight: 0 };
                target.weight += weight;
                targets.set(key, target);
            }
        }
    }
    // Read every neighbor before applying any result: smoothing is symmetric.
    for (const {x, z, weight} of targets.values()) {
        const old = Number(tiles[z][x].height ?? 1);
        let height;
        if (mode === 'smooth') {
            let sum = 0, count = 0;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                const tile = tiles[z + dz]?.[x + dx];
                if (tile && tile.terrain !== 'water') { sum += Number(tile.height ?? 1); count++; }
            }
            height = old + (sum / count - old) * (1 - Math.exp(-strength * weight * seconds));
        } else height = old + (mode === 'lower' ? -1 : 1) * strength * weight * seconds;
        height = Math.min(maxHeight, Math.max(minHeight, height));
        if (Math.abs(height - old) > 1e-9) changes.push({x, z, height});
    }
    return changes;
}
