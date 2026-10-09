const MAX_SMOOTH_STEP = 1;
const EPSILON = 0.000001;
const NEIGHBORS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function landTile(tiles, x, z) {
    const tile = tiles[z]?.[x];
    return tile && tile.terrain !== 'water' ? tile : null;
}

function tileHeight(tiles, x, z) {
    return Number(tiles[z][x].height) || 1;
}

function canBlend(tiles, ax, az, bx, bz) {
    return Math.abs(ax - bx) + Math.abs(az - bz) === 1
        && Boolean(landTile(tiles, ax, az) && landTile(tiles, bx, bz))
        && Math.abs(tileHeight(tiles, ax, az) - tileHeight(tiles, bx, bz)) <= MAX_SMOOTH_STEP + EPSILON;
}

export function isSmoothTerrainTile(tiles, x, z) {
    if (!landTile(tiles, x, z)) return false;
    const height = tileHeight(tiles, x, z);
    return NEIGHBORS.some(([dx, dz]) => canBlend(tiles, x, z, x + dx, z + dz)
        && Math.abs(height - tileHeight(tiles, x + dx, z + dz)) > EPSILON);
}

export function buildSmoothTerrainData(tiles) {
    const positions = [];
    const tileByFace = [];
    const tileByVertex = [];

    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < (tiles[z]?.length || 0); x++) {
            if (!isSmoothTerrainTile(tiles, x, z)) continue;
            const height = tileHeight(tiles, x, z);
            const corner = (dx, dz) => {
                const candidates = new Map();
                for (const cz of [z + dz - 1, z + dz]) {
                    for (const cx of [x + dx - 1, x + dx]) {
                        if (landTile(tiles, cx, cz)) candidates.set(`${cx}:${cz}`, [cx, cz]);
                    }
                }
                const connected = new Map([[`${x}:${z}`, [x, z]]]);
                const queue = [[x, z]];
                while (queue.length) {
                    const [cx, cz] = queue.shift();
                    for (const [nx, nz] of candidates.values()) {
                        const key = `${nx}:${nz}`;
                        if (!connected.has(key) && canBlend(tiles, cx, cz, nx, nz)) {
                            connected.set(key, [nx, nz]);
                            queue.push([nx, nz]);
                        }
                    }
                }
                return [...connected.values()].reduce((sum, [cx, cz]) => sum + tileHeight(tiles, cx, cz), 0)
                    / connected.size;
            };
            const edge = (nx, nz) => canBlend(tiles, x, z, nx, nz)
                ? (height + tileHeight(tiles, nx, nz)) / 2 : height;
            const ring = [
                [x, corner(0, 0), z],
                [x + 0.5, edge(x, z - 1), z],
                [x + 1, corner(1, 0), z],
                [x + 1, edge(x + 1, z), z + 0.5],
                [x + 1, corner(1, 1), z + 1],
                [x + 0.5, edge(x, z + 1), z + 1],
                [x, corner(0, 1), z + 1],
                [x, edge(x - 1, z), z + 0.5],
            ];
            const center = [x + 0.5, height, z + 0.5];
            const triangle = (a, b, c) => {
                positions.push(...a, ...b, ...c);
                tileByFace.push({ x, z });
                tileByVertex.push({ x, z }, { x, z }, { x, z });
            };
            for (let side = 0; side < ring.length; side++) {
                triangle(center, ring[(side + 1) % ring.length], ring[side]);
            }
            for (let side = 0; side < NEIGHBORS.length; side++) {
                const [dx, dz] = NEIGHBORS[side];
                if (canBlend(tiles, x, z, x + dx, z + dz)) continue;
                const a = ring[side * 2];
                const b = ring[(side * 2 + 1) % ring.length];
                const c = ring[(side * 2 + 2) % ring.length];
                const groundA = [a[0], 0, a[2]];
                const groundB = [b[0], 0, b[2]];
                const groundC = [c[0], 0, c[2]];
                triangle(a, groundA, b);
                triangle(b, groundA, groundB);
                triangle(b, groundB, c);
                triangle(c, groundB, groundC);
            }
        }
    }
    return { positions, tileByFace, tileByVertex };
}
