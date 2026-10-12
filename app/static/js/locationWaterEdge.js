function pushTriangle(positions, a, b, c, height) {
    const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const points = cross >= 0 ? [a, b, c] : [a, c, b];
    for (const [x, z] of points) positions.push(x, height, z);
}

function pushBankTriangle(positions, colors, uvs, a, b, c, width, height, baseColors = null) {
    const cross = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    for (const point of cross >= 0 ? [a, b, c] : [a, c, b]) {
        positions.push(point.x, point.y, point.z);
        colors.push(...point.color);
        uvs.push(point.x / width, point.z / height);
        if (baseColors) baseColors.push(...point.baseColor);
    }
}

const LAND_COLORS = {
    grass: [0.23, 0.37, 0.07], sand: [0.76, 0.7, 0.5],
    swamp: [0.29, 0.25, 0.18], rock: [0.5, 0.5, 0.49],
};

const WATER_TINTS = {
    grass: [1, 1, 1],
    swamp: [0.8, 1.1, 0.47],
    sand: [2.5, 1.28, 0.38],
    rock: [1.9, 0.94, 0.65],
};

export function classifyWaterRegions(tiles) {
    const regions = new Map();
    const visited = new Set();
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < tiles[z].length; x++) {
            const key = `${x},${z}`;
            if (tiles[z][x]?.terrain !== 'water' || visited.has(key)) continue;
            const cells = [];
            const shore = { grass: 0, swamp: 0, sand: 0, rock: 0 };
            const queue = [[x, z]];
            visited.add(key);
            for (let index = 0; index < queue.length; index++) {
                const [cx, cz] = queue[index];
                cells.push([cx, cz]);
                for (const [dx, dz] of directions) {
                    const nx = cx + dx;
                    const nz = cz + dz;
                    const neighbor = tiles[nz]?.[nx];
                    if (!neighbor) continue;
                    if (neighbor.terrain === 'water') {
                        const neighborKey = `${nx},${nz}`;
                        if (!visited.has(neighborKey)) {
                            visited.add(neighborKey);
                            queue.push([nx, nz]);
                        }
                    } else if (shore[neighbor.terrain] !== undefined) {
                        shore[neighbor.terrain]++;
                    }
                }
            }
            const total = Object.values(shore).reduce((sum, count) => sum + count, 0);
            const [dominant, count] = Object.entries(shore)
                .sort((a, b) => b[1] - a[1])[0];
            const kind = total && count / total >= 0.55 ? dominant : 'grass';
            for (const [cx, cz] of cells) regions.set(`${cx},${cz}`, kind);
        }
    }
    return regions;
}

export function waterLevelForTile(tile, kind) {
    return (Number(tile.height) || 1) - (kind === 'sand' ? 0.2 : 0);
}

export function buildRoundedWaterData(tiles, radius = 0.24,
    includeTile = () => true, bankSamples = null, levelForWater = waterLevelForTile) {
    const water = [];
    const waterColors = [];
    const bank = [];
    const bankColors = [];
    const bankUvs = [];
    const bankBaseColors = [];
    const sandBank = [];
    const sandBankColors = [];
    const sandBankUvs = [];
    const regions = classifyWaterRegions(tiles);
    const isLand = (x, z) => Boolean(tiles[z]?.[x] && tiles[z][x].terrain !== 'water');
    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < tiles[z].length; x++) {
            const tile = tiles[z][x];
            if (tile?.terrain !== 'water' || !includeTile(x, z)) continue;
            const kind = regions.get(`${x},${z}`) || 'grass';
            const height = levelForWater(tile, kind);
            const strip = 0.075;
            const r = Math.max(strip * 2, Math.min(radius, 0.45));
            const diagonal = (r - strip) * Math.SQRT1_2;
            const north = isLand(x, z - 1);
            const east = isLand(x + 1, z);
            const south = isLand(x, z + 1);
            const west = isLand(x - 1, z);
            const corners = [
                {
                    first: west, second: north, at: [x, z],
                    firstOnly: [x + strip, z], secondOnly: [x, z + strip], diagonalLand: isLand(x - 1, z - 1),
                    arc: [[x + strip, z + r], [x + r - diagonal, z + r - diagonal], [x + r, z + strip]],
                    edge: [x + 0.5, z + (north ? strip + 0.025 * Math.sin(x * 4.3 + z * 1.7) : 0)],
                },
                {
                    first: north, second: east, at: [x + 1, z],
                    firstOnly: [x + 1, z + strip], secondOnly: [x + 1 - strip, z], diagonalLand: isLand(x + 1, z - 1),
                    arc: [[x + 1 - r, z + strip], [x + 1 - r + diagonal, z + r - diagonal], [x + 1 - strip, z + r]],
                    edge: [x + 1 - (east ? strip + 0.025 * Math.sin(x * 3.1 + z * 5.1) : 0), z + 0.5],
                },
                {
                    first: east, second: south, at: [x + 1, z + 1],
                    firstOnly: [x + 1 - strip, z + 1], secondOnly: [x + 1, z + 1 - strip], diagonalLand: isLand(x + 1, z + 1),
                    arc: [[x + 1 - strip, z + 1 - r], [x + 1 - r + diagonal, z + 1 - r + diagonal], [x + 1 - r, z + 1 - strip]],
                    edge: [x + 0.5, z + 1 - (south ? strip + 0.025 * Math.sin(x * 4.3 + (z + 1) * 1.7) : 0)],
                },
                {
                    first: south, second: west, at: [x, z + 1],
                    firstOnly: [x, z + 1 - strip], secondOnly: [x + strip, z + 1], diagonalLand: isLand(x - 1, z + 1),
                    arc: [[x + r, z + 1 - strip], [x + r - diagonal, z + 1 - r + diagonal], [x + strip, z + 1 - r]],
                    edge: [x + (west ? strip + 0.025 * Math.sin((x - 1) * 3.1 + z * 5.1) : 0), z + 0.5],
                },
            ];
            const outline = [];
            for (const corner of corners) {
                if (corner.first && corner.second) outline.push(...corner.arc);
                else if (corner.diagonalLand && corner.first) outline.push(corner.firstOnly);
                else if (corner.diagonalLand && corner.second) outline.push(corner.secondOnly);
                else outline.push(corner.at);
                outline.push(corner.edge);
            }
            const shore = [
                { x, z: z - 1, distance: (u, v) => v },
                { x: x + 1, z, distance: (u) => 1 - u },
                { x, z: z + 1, distance: (u, v) => 1 - v },
                { x: x - 1, z, distance: (u) => u },
            ].filter(side => isLand(side.x, side.z));
            if (shore.length) {
                const samples = bankSamples || [0, 0.05, 0.075, 0.125, 0.25, 0.375, 0.5,
                    0.625, 0.75, 0.875, 0.925, 0.95, 1];
                const vertices = samples.map(v => samples.map(u => {
                    let nearest = 1;
                    let weightTotal = 0;
                    let landHeight = 0;
                    const landColor = [0, 0, 0];
                    for (const side of shore) {
                        const distance = side.distance(u, v);
                        nearest = Math.min(nearest, distance);
                        const weight = 1 / (0.12 + distance) ** 3;
                        const land = tiles[side.z][side.x];
                        weightTotal += weight;
                        landHeight += (Number(land.height) || 1) * weight;
                        const tint = LAND_COLORS[land.terrain] || LAND_COLORS.grass;
                        for (let channel = 0; channel < 3; channel++) {
                            landColor[channel] += tint[channel] * weight;
                        }
                    }
                    const rise = Math.min(1, nearest / (kind === 'sand' ? 0.23 : 0.05));
                    const smoothRise = rise * rise * (3 - 2 * rise);
                    const ripple = Math.sin((x + u) * 19.3 + Math.cos((z + v) * 13.7)) * 0.018;
                    const wetShade = Math.max(0, Math.min(1,
                        (nearest + ripple) / (kind === 'sand' ? 0.31 : 0.19)));
                    return {
                        x: x + u,
                        y: landHeight / weightTotal * (1 - smoothRise) + height * smoothRise + 0.006,
                        z: z + v,
                        color: kind === 'sand'
                            ? [0.83 - 0.22 * wetShade, 0.73 - 0.2 * wetShade, 0.47 - 0.12 * wetShade]
                            : [1 - 0.27 * wetShade, 1 - 0.15 * wetShade, 1 - 0.13 * wetShade],
                        baseColor: landColor.map(value => value / weightTotal * (1 - 0.2 * wetShade)),
                    };
                }));
                const target = kind === 'sand'
                    ? [sandBank, sandBankColors, sandBankUvs] : [bank, bankColors, bankUvs];
                for (let row = 0; row < samples.length - 1; row++) {
                    for (let column = 0; column < samples.length - 1; column++) {
                        const a = vertices[row][column];
                        const b = vertices[row][column + 1];
                        const c = vertices[row + 1][column + 1];
                        const d = vertices[row + 1][column];
                        const baseColors = kind === 'sand' ? null : bankBaseColors;
                        pushBankTriangle(...target, a, b, c, tiles[z].length, tiles.length, baseColors);
                        pushBankTriangle(...target, a, c, d, tiles[z].length, tiles.length, baseColors);
                    }
                }
            }
            const center = [x + 0.5, z + 0.5];
            for (let index = 0; index < outline.length; index++) {
                pushTriangle(water, center, outline[index], outline[(index + 1) % outline.length], height + 0.012);
                for (let vertex = 0; vertex < 3; vertex++) waterColors.push(...WATER_TINTS[kind]);
            }
        }
    }
    return { water, waterColors, bank, bankColors, bankUvs, bankBaseColors,
        sandBank, sandBankColors, sandBankUvs, regions };
}
