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

function tileSurfaceRing(tiles, x, z) {
    const height = tileHeight(tiles, x, z);
    if (!isSmoothTerrainTile(tiles, x, z)) return [
        [x, height, z], [x + 0.5, height, z], [x + 1, height, z],
        [x + 1, height, z + 0.5], [x + 1, height, z + 1],
        [x + 0.5, height, z + 1], [x, height, z + 1], [x, height, z + 0.5],
    ];
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
    return [
        [x, corner(0, 0), z],
        [x + 0.5, edge(x, z - 1), z],
        [x + 1, corner(1, 0), z],
        [x + 1, edge(x + 1, z), z + 0.5],
        [x + 1, corner(1, 1), z + 1],
        [x + 0.5, edge(x, z + 1), z + 1],
        [x, corner(0, 1), z + 1],
        [x, edge(x - 1, z), z + 0.5],
    ];
}

export function buildTerrainGridData(tiles, includeTile = () => true) {
    const positions = [];
    const tileByVertex = [];
    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < (tiles[z]?.length || 0); x++) {
            if (!includeTile(x, z)) continue;
            const ring = tileSurfaceRing(tiles, x, z);
            const segment = (a, b) => {
                for (const index of [a, b]) {
                    const [px, py, pz] = ring[index];
                    positions.push(px, py + 0.025, pz);
                    tileByVertex.push({ x, z });
                }
            };
            segment(0, 1);
            segment(1, 2);
            segment(6, 7);
            segment(7, 0);
            if (!tiles[z][x + 1] || !includeTile(x + 1, z)) {
                segment(2, 3);
                segment(3, 4);
            }
            if (!tiles[z + 1]?.[x] || !includeTile(x, z + 1)) {
                segment(4, 5);
                segment(5, 6);
            }
        }
    }
    return { positions, tileByVertex };
}

export function buildFloorGridData(floors) {
    const positions = [];
    const tileByVertex = [];
    for (const floor of floors) {
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({
            x: floor.x + a * floor.width / 2 * floor.axis.x + b * floor.depth / 2 * floor.normal.x,
            z: floor.z + a * floor.width / 2 * floor.axis.z + b * floor.depth / 2 * floor.normal.z,
        }));
        const segment = (a, b) => {
            positions.push(a.x, floor.top + 0.025, a.z, b.x, floor.top + 0.025, b.z);
            tileByVertex.push({ ...a, floor: true }, { ...b, floor: true });
        };
        for (const axis of ['x', 'z']) {
            const other = axis === 'x' ? 'z' : 'x';
            const bounds = corners.map(point => point[axis]);
            for (let line = Math.ceil(Math.min(...bounds)); line <= Math.floor(Math.max(...bounds)); line++) {
                const intersections = [];
                for (let side = 0; side < corners.length; side++) {
                    const a = corners[side];
                    const b = corners[(side + 1) % corners.length];
                    const span = b[axis] - a[axis];
                    if (Math.abs(span) < EPSILON) {
                        if (Math.abs(line - a[axis]) < EPSILON) intersections.push(a[other], b[other]);
                        continue;
                    }
                    const t = (line - a[axis]) / span;
                    if (t >= -EPSILON && t <= 1 + EPSILON) {
                        intersections.push(a[other] + t * (b[other] - a[other]));
                    }
                }
                if (intersections.length < 2) continue;
                const start = Math.min(...intersections);
                const end = Math.max(...intersections);
                if (end - start < EPSILON) continue;
                segment({ [axis]: line, [other]: start }, { [axis]: line, [other]: end });
            }
        }
    }
    return { positions, tileByVertex };
}

export function buildFogSurfaceData(tiles) {
    const positions = [];
    const tileIndices = [];
    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < tiles[z].length; x++) {
            const first = positions.length / 3;
            positions.push(x + 0.5, tileHeight(tiles, x, z) + 0.045, z + 0.5);
            const ring = tileSurfaceRing(tiles, x, z);
            for (const [px, py, pz] of ring) positions.push(px, py + 0.045, pz);
            const indices = [];
            for (let side = 0; side < ring.length; side++) {
                indices.push(first, first + 1 + (side + 1) % ring.length, first + 1 + side);
            }
            tileIndices.push(indices);
        }
    }
    return { positions, tileIndices };
}

export function buildSmoothTerrainData(tiles) {
    const positions = [];
    const tileByFace = [];
    const tileByVertex = [];

    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < (tiles[z]?.length || 0); x++) {
            if (!isSmoothTerrainTile(tiles, x, z)) continue;
            const height = tileHeight(tiles, x, z);
            const ring = tileSurfaceRing(tiles, x, z);
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
