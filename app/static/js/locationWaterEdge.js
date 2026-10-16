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

export function waterExposedSideMask(tiles, x, z) {
    if (tiles[z]?.[x]?.terrain !== 'water') return 0;
    const exposed = (dx, dz) => tiles[z + dz]?.[x + dx]?.terrain !== 'water';
    return (exposed(1, 0) ? 1 : 0) | (exposed(-1, 0) ? 2 : 0)
        | (exposed(0, 1) ? 4 : 0) | (exposed(0, -1) ? 8 : 0);
}

export function connectedWaterHeightAt(tiles, x, z, px, pz, regions,
    levelForWater = waterLevelForTile) {
    const xEdge = Math.round(px);
    const zEdge = Math.round(pz);
    const xs = Math.abs(px - xEdge) < 1e-8 ? [xEdge - 1, xEdge] : [x];
    const zs = Math.abs(pz - zEdge) < 1e-8 ? [zEdge - 1, zEdge] : [z];
    const touching = new Map();
    for (const tz of zs) for (const tx of xs) {
        if (tiles[tz]?.[tx]?.terrain === 'water') touching.set(`${tx},${tz}`, [tx, tz]);
    }
    const connected = new Set([`${x},${z}`]);
    const queue = [[x, z]];
    for (const [cx, cz] of queue) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${cx + dx},${cz + dz}`;
            if (!touching.has(key) || connected.has(key)) continue;
            connected.add(key);
            queue.push(touching.get(key));
        }
    }
    let total = 0;
    for (const key of connected) {
        const [tx, tz] = touching.get(key);
        total += levelForWater(tiles[tz][tx], regions.get(key) || 'grass');
    }
    return total / connected.size;
}

export function waterSideCornerDrops(tiles, x, z, regions, renderedHeight) {
    const drop = (px, pz) => {
        const waterTop = connectedWaterHeightAt(tiles, x, z, px, pz, regions) + 0.012;
        return (renderedHeight - Math.max(0, Math.min(renderedHeight, waterTop))) / renderedHeight;
    };
    return [drop(x, z), drop(x + 1, z), drop(x + 1, z + 1), drop(x, z + 1)];
}

export function buildRoundedWaterData(tiles, radius = 0.24,
    includeTile = () => true, bankSamples = null, levelForWater = waterLevelForTile,
    { shorelineRing = false, landSurfaceHeightAt = null } = {}) {
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
    // Sample from touching land tiles so adjacent water cells agree on their shared shore edge.
    const sharedShoreHeight = (px, pz) => {
        const xEdge = Math.round(px);
        const zEdge = Math.round(pz);
        const xs = Math.abs(px - xEdge) < 1e-8 ? [xEdge - 1, xEdge] : [Math.floor(px)];
        const zs = Math.abs(pz - zEdge) < 1e-8 ? [zEdge - 1, zEdge] : [Math.floor(pz)];
        const heights = [];
        for (const landZ of zs) {
            for (const landX of xs) {
                if (!isLand(landX, landZ)) continue;
                const value = landSurfaceHeightAt
                    ? landSurfaceHeightAt(
                        Math.max(landX + 0.00001, Math.min(landX + 0.99999, px)),
                        Math.max(landZ + 0.00001, Math.min(landZ + 0.99999, pz)))
                    : Number(tiles[landZ][landX].height);
                if (Number.isFinite(value)) heights.push(value);
            }
        }
        return heights.length ? heights.reduce((sum, value) => sum + value, 0) / heights.length : null;
    };
    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < tiles[z].length; x++) {
            const tile = tiles[z][x];
            if (tile?.terrain !== 'water' || !includeTile(x, z)) continue;
            const kind = regions.get(`${x},${z}`) || 'grass';
            const height = levelForWater(tile, kind);
            const waterHeightAt = (px, pz) => shorelineRing
                ? connectedWaterHeightAt(tiles, x, z, px, pz, regions, levelForWater) : height;
            const strip = 0.075;
            const r = Math.max(strip * 2, Math.min(radius, 0.45));
            const diagonal = (r - strip) * Math.SQRT1_2;
            const north = isLand(x, z - 1);
            const east = isLand(x + 1, z);
            const south = isLand(x, z + 1);
            const west = isLand(x - 1, z);
            const corners = [
                {
                    first: west, second: north, at: [x, z], diagonal: [x - 1, z - 1],
                    firstOnly: [x + strip, z], secondOnly: [x, z + strip], diagonalLand: isLand(x - 1, z - 1),
                    arc: [[x + strip, z + r], [x + r - diagonal, z + r - diagonal], [x + r, z + strip]],
                    edge: [x + 0.5, z + (north ? strip + 0.025 * Math.sin(x * 4.3 + z * 1.7) : 0)],
                },
                {
                    first: north, second: east, at: [x + 1, z], diagonal: [x + 1, z - 1],
                    firstOnly: [x + 1, z + strip], secondOnly: [x + 1 - strip, z], diagonalLand: isLand(x + 1, z - 1),
                    arc: [[x + 1 - r, z + strip], [x + 1 - r + diagonal, z + r - diagonal], [x + 1 - strip, z + r]],
                    edge: [x + 1 - (east ? strip + 0.025 * Math.sin(x * 3.1 + z * 5.1) : 0), z + 0.5],
                },
                {
                    first: east, second: south, at: [x + 1, z + 1], diagonal: [x + 1, z + 1],
                    firstOnly: [x + 1 - strip, z + 1], secondOnly: [x + 1, z + 1 - strip], diagonalLand: isLand(x + 1, z + 1),
                    arc: [[x + 1 - strip, z + 1 - r], [x + 1 - r + diagonal, z + 1 - r + diagonal], [x + 1 - r, z + 1 - strip]],
                    edge: [x + 0.5, z + 1 - (south ? strip + 0.025 * Math.sin(x * 4.3 + (z + 1) * 1.7) : 0)],
                },
                {
                    first: south, second: west, at: [x, z + 1], diagonal: [x - 1, z + 1],
                    firstOnly: [x, z + 1 - strip], secondOnly: [x + strip, z + 1], diagonalLand: isLand(x - 1, z + 1),
                    arc: [[x + r, z + 1 - strip], [x + r - diagonal, z + 1 - r + diagonal], [x + strip, z + 1 - r]],
                    edge: [x + (west ? strip + 0.025 * Math.sin((x - 1) * 3.1 + z * 5.1) : 0), z + 0.5],
                },
            ];
            const outline = [];
            const waterOutline = [];
            const diagonalCorners = [];
            for (const corner of corners) {
                let points;
                let diagonalOnly = false;
                const diagonalWater = shorelineRing
                    && tiles[corner.diagonal[1]]?.[corner.diagonal[0]]?.terrain === 'water';
                if (corner.first && corner.second) points = corner.arc;
                else if (shorelineRing && corner.diagonalLand && !corner.first && !corner.second) {
                    // Keep the ordinary ring out of this corner; its water triangle is replaced by a cap.
                    points = [corner.at];
                    waterOutline.push(corner.secondOnly, corner.firstOnly);
                    diagonalCorners.push(corner);
                    diagonalOnly = true;
                } else if (corner.first && (corner.diagonalLand || diagonalWater)) {
                    points = [corner.firstOnly];
                } else if (corner.second && (corner.diagonalLand || diagonalWater)) {
                    points = [corner.secondOnly];
                } else points = [corner.at];
                outline.push(...points);
                if (!diagonalOnly) waterOutline.push(...points);
                outline.push(corner.edge);
                waterOutline.push(corner.edge);
            }
            const shore = [
                { x, z: z - 1, distance: (u, v) => v },
                { x: x + 1, z, distance: (u) => 1 - u },
                { x, z: z + 1, distance: (u, v) => 1 - v },
                { x: x - 1, z, distance: (u) => u },
            ].filter(side => isLand(side.x, side.z));
            if (shore.length) {
                const bankPoint = (u, v) => {
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
                };
                const target = kind === 'sand'
                    ? [sandBank, sandBankColors, sandBankUvs] : [bank, bankColors, bankUvs];
                const baseColors = kind === 'sand' ? null : bankBaseColors;
                if (shorelineRing) {
                    const centerX = x + 0.5;
                    const centerZ = z + 0.5;
                    const edgePoint = (u, v) => {
                        const point = bankPoint(u, v);
                        const meetsWater = outline.some(([px, pz]) =>
                            Math.abs(px - point.x) < 1e-8 && Math.abs(pz - point.z) < 1e-8);
                        point.y = meetsWater ? waterHeightAt(point.x, point.z) + 0.012
                            : (sharedShoreHeight(point.x, point.z)
                                ?? (waterHeightAt(point.x, point.z) + 0.006)) + 0.006;
                        return point;
                    };
                    const angleOf = ([px, pz]) => Math.atan2(pz - centerZ, px - centerX);
                    const outerPoint = ([px, pz]) => {
                        const dx = px - centerX;
                        const dz = pz - centerZ;
                        const scale = 0.5 / Math.max(Math.abs(dx), Math.abs(dz));
                        return edgePoint(0.5 + dx * scale, 0.5 + dz * scale);
                    };
                    const addTriangle = (a, b, c) => {
                        const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
                        if (Math.abs(area) < 1e-10) return;
                        pushBankTriangle(...target, a, b, c, tiles[z].length, tiles.length, baseColors);
                    };
                    const squareCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
                    const addShoreSegment = (a, b, levelA, levelB) => {
                        const innerA = { ...bankPoint(a[0] - x, a[1] - z), y: levelA + 0.012 };
                        const innerB = { ...bankPoint(b[0] - x, b[1] - z), y: levelB + 0.012 };
                        const start = angleOf(a);
                        let end = angleOf(b);
                        if (end <= start) end += Math.PI * 2;
                        const outerPath = [{ angle: start, point: outerPoint(a) }];
                        for (let corner = 0; corner < squareCorners.length; corner++) {
                            let angle = -Math.PI * 3 / 4 + corner * Math.PI / 2;
                            if (angle <= start) angle += Math.PI * 2;
                            if (angle > start + 1e-8 && angle < end - 1e-8) {
                                const [u, v] = squareCorners[corner];
                                outerPath.push({ angle, point: edgePoint(u, v) });
                            }
                        }
                        outerPath.push({ angle: end, point: outerPoint(b) });
                        outerPath.sort((left, right) => left.angle - right.angle);
                        for (let path = 0; path < outerPath.length - 1; path++) {
                            addTriangle(innerA, outerPath[path].point, outerPath[path + 1].point);
                        }
                        addTriangle(innerA, outerPath[outerPath.length - 1].point, innerB);
                    };
                    for (let index = 0; index < outline.length; index++) {
                        const a = outline[index];
                        const b = outline[(index + 1) % outline.length];
                        const levelA = waterHeightAt(a[0], a[1]);
                        const levelB = waterHeightAt(b[0], b[1]);
                        const outerA = outerPoint(a);
                        const outerB = outerPoint(b);
                        const span = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]),
                            Math.hypot(outerB.x - outerA.x, outerB.z - outerA.z));
                        // Limit large corner facets without restoring the dense bank grid.
                        const segments = Math.max(1, Math.ceil(span / 0.16));
                        const along = fraction => [a[0] + (b[0] - a[0]) * fraction,
                            a[1] + (b[1] - a[1]) * fraction];
                        for (let segment = 0; segment < segments; segment++) {
                            const start = segment / segments;
                            const end = (segment + 1) / segments;
                            addShoreSegment(along(start), along(end),
                                levelA + (levelB - levelA) * start,
                                levelA + (levelB - levelA) * end);
                        }
                    }
                } else {
                    const samples = bankSamples || [0, 0.05, 0.075, 0.125, 0.25, 0.375, 0.5,
                        0.625, 0.75, 0.875, 0.925, 0.95, 1];
                    const vertices = samples.map(v => samples.map(u => bankPoint(u, v)));
                    for (let row = 0; row < samples.length - 1; row++) {
                        for (let column = 0; column < samples.length - 1; column++) {
                            const a = vertices[row][column];
                            const b = vertices[row][column + 1];
                            const c = vertices[row + 1][column + 1];
                            const d = vertices[row + 1][column];
                            pushBankTriangle(...target, a, b, c, tiles[z].length, tiles.length, baseColors);
                            pushBankTriangle(...target, a, c, d, tiles[z].length, tiles.length, baseColors);
                        }
                    }
                }
            }
            if (shorelineRing) {
                for (const corner of diagonalCorners) {
                    const land = tiles[corner.diagonal[1]][corner.diagonal[0]];
                    const shoreY = sharedShoreHeight(...corner.at);
                    if (shoreY == null) continue;
                    const tint = LAND_COLORS[land.terrain] || LAND_COLORS.grass;
                    const point = ([px, pz], y, color) => ({
                        x: px, y, z: pz, color, baseColor: tint,
                    });
                    const waterTint = kind === 'sand' ? [0.61, 0.53, 0.35] : [0.73, 0.85, 0.87];
                    const landTint = kind === 'sand' ? [0.83, 0.73, 0.47] : [1, 1, 1];
                    const a = point(corner.at, shoreY + 0.006, landTint);
                    const b = point(corner.firstOnly,
                        waterHeightAt(...corner.firstOnly) + 0.012, waterTint);
                    const c = point(corner.secondOnly,
                        waterHeightAt(...corner.secondOnly) + 0.012, waterTint);
                    const target = kind === 'sand'
                        ? [sandBank, sandBankColors, sandBankUvs] : [bank, bankColors, bankUvs];
                    pushBankTriangle(...target, a, b, c, tiles[z].length, tiles.length,
                        kind === 'sand' ? null : bankBaseColors);
                }
            }
            const center = [x + 0.5, z + 0.5];
            for (let index = 0; index < waterOutline.length; index++) {
                if (shorelineRing) {
                    const a = waterOutline[index];
                    const b = waterOutline[(index + 1) % waterOutline.length];
                    const points = [
                        [center[0], height + 0.012, center[1]],
                        [a[0], waterHeightAt(a[0], a[1]) + 0.012, a[1]],
                        [b[0], waterHeightAt(b[0], b[1]) + 0.012, b[1]],
                    ];
                    const [first, second, third] = points;
                    const cross = (second[2] - first[2]) * (third[0] - first[0])
                        - (second[0] - first[0]) * (third[2] - first[2]);
                    for (const point of cross >= 0 ? points : [first, third, second]) water.push(...point);
                } else {
                    pushTriangle(water, center, waterOutline[index],
                        waterOutline[(index + 1) % waterOutline.length], height + 0.012);
                }
                for (let vertex = 0; vertex < 3; vertex++) waterColors.push(...WATER_TINTS[kind]);
            }
        }
    }
    return { water, waterColors, bank, bankColors, bankUvs, bankBaseColors,
        sandBank, sandBankColors, sandBankUvs, regions };
}
