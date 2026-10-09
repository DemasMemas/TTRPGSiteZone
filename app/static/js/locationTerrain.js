export function buildSmoothTerrainData(tiles) {
    const positions = [];
    const tileByFace = [];
    const tileByVertex = [];
    const isSmooth = (x, z) => tiles[z]?.[x]?.surface === 'smooth' && tiles[z][x].terrain !== 'water';
    const height = (x, z) => Number(tiles[z][x].height) || 1;
    const average = cells => cells.reduce((sum, [x, z]) => sum + height(x, z), 0) / cells.length;

    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < (tiles[z]?.length || 0); x++) {
            if (!isSmooth(x, z)) continue;
            const corner = (dx, dz) => {
                const cells = [];
                for (const cz of [z + dz - 1, z + dz]) {
                    for (const cx of [x + dx - 1, x + dx]) {
                        if (isSmooth(cx, cz)) cells.push([cx, cz]);
                    }
                }
                return average(cells);
            };
            const edge = (nx, nz) => isSmooth(nx, nz)
                ? (height(x, z) + height(nx, nz)) / 2 : height(x, z);
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
            const center = [x + 0.5, height(x, z), z + 0.5];
            const triangle = (a, b, c) => {
                positions.push(...a, ...b, ...c);
                tileByFace.push({ x, z });
                tileByVertex.push({ x, z }, { x, z }, { x, z });
            };
            for (let side = 0; side < ring.length; side++) {
                triangle(center, ring[(side + 1) % ring.length], ring[side]);
            }
            const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
            for (let side = 0; side < neighbors.length; side++) {
                const [dx, dz] = neighbors[side];
                if (isSmooth(x + dx, z + dz)) continue;
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
