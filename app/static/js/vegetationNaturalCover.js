function random(seed) {
    let value = seed >>> 0;
    return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

function hash(x, z, seed) {
    let value = Math.imul(x + seed, 374761393) ^ Math.imul(z + 31, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function noise(x, z, frequency, seed) {
    const fx = x * frequency;
    const fz = z * frequency;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const sx = (fx - ix) ** 2 * (3 - 2 * (fx - ix));
    const sz = (fz - iz) ** 2 * (3 - 2 * (fz - iz));
    const near = hash(ix, iz, seed) * (1 - sx) + hash(ix + 1, iz, seed) * sx;
    const far = hash(ix, iz + 1, seed) * (1 - sx) + hash(ix + 1, iz + 1, seed) * sx;
    return near * (1 - sz) + far * sz;
}

function smoothstep(low, high, value) {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
}

function patch(x, z, cx, cz, rx, rz) {
    return Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2) * 1.4);
}

export function naturalDensityAt(x, z) {
    const broad = noise(x, z, 0.78, 163);
    const local = noise(x, z, 2.05, 271);
    const growth = 0.16 + broad * 0.72 + local * 0.22
        + patch(x, z, -0.94, 0.33, 1.0, 0.85) * 0.24
        + patch(x, z, 1.05, 1.17, 0.7, 0.67) * 0.23
        - patch(x, z, 0.27, 0.51, 0.48, 0.57) * 0.72;
    const edge = 0.24 + 0.76 * smoothstep(-1.48, -0.15, z);
    return Math.max(0, Math.min(1, growth * edge));
}

// An exact placement snapshot of the unmodified D.4 comparison scene.
export function createD4BasePlacements() {
    const rng = random(4024);
    const positions = [];
    for (let index = 0; index < 4; index++) {
        positions.push({ x: -1.42 + index * 0.94, z: -1.35,
            size: 0.9 + rng() * 0.2, turn: rng() * Math.PI * 2 });
    }
    for (let index = 0; index < 76; index++) {
        const x = -1.7 + rng() * 3.4;
        const z = -0.12 + rng() * 1.88;
        const opening = Math.hypot(x + 0.75, z - 0.63) < 0.5;
        if (opening || (x > 0.65 && z < 0.65 && rng() < 0.62)) continue;
        positions.push({ x, z, size: 0.8 + rng() * 0.38, turn: rng() * Math.PI * 2 });
    }
    return positions;
}

export function createNaturalCoverPlacements() {
    const rng = random(4117);
    const positions = [];
    const add = (x, z, minDistance) => {
        if (Math.abs(x) > 1.78 || Math.abs(z) > 1.78) return false;
        if (positions.some(plant => (plant.x - x) ** 2 + (plant.z - z) ** 2 < minDistance ** 2)) {
            return false;
        }
        const size = 0.80 + rng() * 0.32;
        positions.push({ x, z, turn: rng() * Math.PI * 2,
            tone: hash(Math.floor(x * 1537), Math.floor(z * 1537), 907),
            scaleX: size * (1.55 + rng() * 0.43),
            scaleY: size * (0.86 + rng() * 0.22),
            scaleZ: size * (1.48 + rng() * 0.43),
            tiltX: (rng() - 0.5) * 0.22,
            tiltZ: (rng() - 0.5) * 0.22 });
        return true;
    };

    // Rejection sampling follows a continuous habitat field; no cell centres or rows.
    for (let index = 0; index < 1450; index++) {
        const x = -1.78 + rng() * 3.56;
        const z = -1.78 + rng() * 3.56;
        const density = naturalDensityAt(x, z);
        if (rng() < 0.06 + density * 0.67) add(x, z, 0.105);
    }
    const roots = positions.slice();
    for (const plant of roots) {
        const density = naturalDensityAt(plant.x, plant.z);
        if (density < 0.48 || rng() > 0.15 + density * 0.32) continue;
        const angle = rng() * Math.PI * 2;
        const distance = 0.105 + rng() * 0.16;
        const x = plant.x + Math.cos(angle) * distance;
        const z = plant.z + Math.sin(angle) * distance;
        if (naturalDensityAt(x, z) >= 0.35) add(x, z, 0.085);
    }
    return positions;
}

export function createAccentPlacements(natural) {
    const rng = random(7319);
    const candidates = natural.filter(plant => plant.z > -0.32
        && naturalDensityAt(plant.x, plant.z) > 0.56);
    const accents = [];
    for (let index = 0; index < candidates.length && accents.length < 15; index++) {
        const plant = candidates[index];
        if (rng() > 0.16) continue;
        const angle = rng() * Math.PI * 2;
        const x = plant.x + Math.cos(angle) * 0.13;
        const z = plant.z + Math.sin(angle) * 0.13;
        if (Math.abs(x) > 1.72 || Math.abs(z) > 1.72) continue;
        accents.push({ x, z, turn: rng() * Math.PI * 2,
            scaleX: 0.88 + rng() * 0.18,
            scaleY: 1.18 + rng() * 0.34,
            scaleZ: 0.85 + rng() * 0.21,
            tiltX: (rng() - 0.5) * 0.08,
            tiltZ: (rng() - 0.5) * 0.08,
            accent: true });
    }
    return accents;
}

export function splitMixedCoverPlacements(natural) {
    const bermuda = [];
    const broadleaf = [];
    for (const plant of natural) {
        const density = naturalDensityAt(plant.x, plant.z);
        const roll = hash(Math.floor(plant.x * 719), Math.floor(plant.z * 719), 1429);
        // Reuse every D.4.1 root; only the species changes within denser habitats.
        if (roll < 0.26 + density * 0.24) broadleaf.push(plant);
        else bermuda.push(plant);
    }
    return { bermuda, broadleaf };
}

function splitAtRoots(natural, selected) {
    const chosen = new Set(selected);
    return {
        bermuda: natural.filter(plant => !chosen.has(plant)),
        broadleaf: natural.filter(plant => chosen.has(plant)),
    };
}

export function createReducedWeedPlacements(natural) {
    const baseline = splitMixedCoverPlacements(natural);
    const ranked = baseline.broadleaf.map(plant => ({
        plant,
        score: naturalDensityAt(plant.x, plant.z) * 0.55
            + hash(Math.floor(plant.x * 991), Math.floor(plant.z * 991), 1847) * 0.45,
    }));
    ranked.sort((a, b) => b.score - a.score);
    return splitAtRoots(natural, ranked.slice(0, 49).map(item => item.plant));
}

export function createClusteredWeedPlacements(natural) {
    const ranked = natural.map(plant => {
        const x = plant.x;
        const z = plant.z;
        const warpX = (noise(x, z, 1.65, 2231) - 0.5) * 0.42;
        const warpZ = (noise(x, z, 1.53, 2281) - 0.5) * 0.38;
        const habitat = Math.max(
            patch(x + warpX, z + warpZ, -0.93, 0.17, 0.72, 0.47),
            patch(x - warpZ, z + warpX, 1.02, 1.13, 0.52, 0.65),
            patch(x + warpZ, z - warpX, 0.58, -0.48, 0.40, 0.29) * 0.76,
        );
        return { plant, score: habitat * (0.7 + naturalDensityAt(x, z) * 0.3)
            + noise(x, z, 3.9, 2437) * 0.18
            + hash(Math.floor(x * 1117), Math.floor(z * 1117), 2591) * 0.075 };
    });
    ranked.sort((a, b) => b.score - a.score);
    return splitAtRoots(natural, ranked.slice(0, 34).map(item => item.plant));
}

export function groundTintAt(x, z) {
    const broad = noise(x, z, 0.88, 3011);
    const local = noise(x, z, 2.7, 3167);
    const density = naturalDensityAt(x, z);
    const moisture = Math.max(0, density - 0.48) * 0.20;
    const value = 0.56 + (broad - 0.5) * 0.16 + (local - 0.5) * 0.07 - moisture * 0.45;
    return { r: value, g: value * 0.85, b: value * 0.76 };
}
