import { grassSubtype } from './locationGrassSubtype.js';

const COLORS = {
    grass: [94, 83, 63],
    sand: [193, 175, 125],
    swamp: [75, 65, 45],
    rock: [126, 128, 123],
    water: [43, 70, 62],
};

let forestGroundPixels = null;
let plainGroundPixels = null;
let grassGroundLoading = null;
const FOREST_TEXTURE_SIZE = 256;
const FOREST_TEXELS_PER_TILE = 64;

function loadGroundPixels(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = FOREST_TEXTURE_SIZE;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) { reject(new Error('Forest ground canvas unavailable')); return; }
            context.drawImage(image, 0, 0, FOREST_TEXTURE_SIZE, FOREST_TEXTURE_SIZE);
            resolve(context.getImageData(0, 0,
                FOREST_TEXTURE_SIZE, FOREST_TEXTURE_SIZE).data);
        };
        image.onerror = reject;
        image.src = url;
    });
}

export function loadGrassGroundPixels() {
    if (plainGroundPixels && forestGroundPixels) return Promise.resolve();
    if (grassGroundLoading) return grassGroundLoading;
    grassGroundLoading = Promise.all([
        loadGroundPixels('/static/materials/art/dirty_earth/color.jpg'),
        loadGroundPixels('/static/textures/vegetation/forrest_ground_01_diff_1k.jpg'),
    ]).then(([plain, forest]) => {
        plainGroundPixels = plain;
        forestGroundPixels = forest;
    }).catch(error => {
        grassGroundLoading = null;
        throw error;
    });
    return grassGroundLoading;
}

function hash(x, z, seed = 0) {
    let value = Math.imul(x + seed * 37 + 1, 374761393)
        + Math.imul(z + seed * 53 + 1, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function noise(x, z, scale, seed) {
    const px = x * scale;
    const pz = z * scale;
    const ix = Math.floor(px);
    const iz = Math.floor(pz);
    const fx = px - ix;
    const fz = pz - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const top = hash(ix, iz, seed) * (1 - sx) + hash(ix + 1, iz, seed) * sx;
    const bottom = hash(ix, iz + 1, seed) * (1 - sx) + hash(ix + 1, iz + 1, seed) * sx;
    return top * (1 - sz) + bottom * sz;
}

const smoothstep = value => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
};

function terrainAt(tiles, x, z) {
    const clampedZ = Math.max(0, Math.min(tiles.length - 1, z));
    const clampedX = Math.max(0, Math.min(tiles[clampedZ].length - 1, x));
    const tile = tiles[clampedZ][clampedX];
    return tile?.terrain === 'grass' && grassSubtype(tile) === 'forest'
        ? 'grass_forest' : tile?.terrain || 'grass';
}

function terrainColor(kind, detail, x, z) {
    const groundPixels = kind === 'grass_forest' ? forestGroundPixels
        : kind === 'grass' ? plainGroundPixels : null;
    if (groundPixels) {
        const px = ((Math.floor(x * FOREST_TEXELS_PER_TILE) % FOREST_TEXTURE_SIZE)
            + FOREST_TEXTURE_SIZE) % FOREST_TEXTURE_SIZE;
        const pz = ((Math.floor(z * FOREST_TEXELS_PER_TILE) % FOREST_TEXTURE_SIZE)
            + FOREST_TEXTURE_SIZE) % FOREST_TEXTURE_SIZE;
        const index = (pz * FOREST_TEXTURE_SIZE + px) * 4;
        return [0, 1, 2].map(channel => groundPixels[index + channel] * 0.88
            + COLORS.grass[channel] * 0.12 + detail.broad * 8);
    }
    if (kind === 'grass_forest') kind = 'grass';
    const color = COLORS[kind] || COLORS.grass;
    const { broad, fine, speck, dirt, moss, wet } = detail;
    if (kind === 'grass') {
        return [color[0] + broad * 23 + dirt * 33 + fine * 8,
            color[1] + broad * 21 + dirt * 13 + fine * 8,
            color[2] + broad * 17 + dirt * 10 + fine * 7];
    }
    if (kind === 'sand') {
        const grain = speck > 0.988 ? -27 : speck < 0.012 ? 13 : 0;
        return color.map((value, channel) => value + broad * 19 + fine * 9 + grain * (channel === 2 ? 0.8 : 1));
    }
    if (kind === 'swamp') {
        const silt = speck > 0.965 ? -10 : speck < 0.035 ? 8 : 0;
        return [color[0] + broad * 9 + fine * 7 - moss * 12 - wet * 26 + silt,
            color[1] + broad * 9 + fine * 8 + moss * 16 - wet * 5 + silt,
            color[2] + broad * 7 + fine * 6 + moss * 4 + wet * 14 + silt];
    }
    if (kind === 'rock') {
        const grit = speck > 0.976 ? -19 : speck < 0.02 ? 12 : 0;
        return color.map(value => value + broad * 23 + fine * 16 + grit);
    }
    return color.map(value => value + broad * 8);
}

function paintPixels(tiles, image, pixelsPerTile, startX, startZ, endX, endZ,
    originX = 0, originZ = 0, sampleTerrain = (x, z) => terrainAt(tiles, x, z)) {
    const { data, width } = image;
    for (let pz = startZ; pz < endZ; pz++) {
        for (let px = startX; px < endX; px++) {
            const x = originX + (px + 0.5) / pixelsPerTile;
            const z = originZ + (pz + 0.5) / pixelsPerTile;
            const cx = x - 0.5;
            const cz = z - 0.5;
            const ix = Math.floor(cx);
            const iz = Math.floor(cz);
            const wobbleX = (noise(ix + 0.5, z, 2.4, 63) - 0.5) * 0.13;
            const wobbleZ = (noise(x, iz + 0.5, 2.4, 71) - 0.5) * 0.13;
            const wx = smoothstep((cx - ix - 0.28 - wobbleX) / 0.44);
            const wz = smoothstep((cz - iz - 0.28 - wobbleZ) / 0.44);
            const w00 = (1 - wx) * (1 - wz);
            const w10 = wx * (1 - wz);
            const w01 = (1 - wx) * wz;
            const w11 = wx * wz;
            const k00 = w00 ? sampleTerrain(ix, iz) : null;
            const k10 = w10 ? sampleTerrain(ix + 1, iz) : null;
            const k01 = w01 ? sampleTerrain(ix, iz + 1) : null;
            const k11 = w11 ? sampleTerrain(ix + 1, iz + 1) : null;
            const grass = [k00, k10, k01, k11].some(kind => kind === 'grass' || kind === 'grass_forest');
            const swamp = k00 === 'swamp' || k10 === 'swamp' || k01 === 'swamp' || k11 === 'swamp';
            const detailColor = (k00 && k00 !== 'water') || (k10 && k10 !== 'water')
                || (k01 && k01 !== 'water') || (k11 && k11 !== 'water');
            const detail = {
                broad: noise(x, z, 0.82, 7) - 0.5,
                fine: detailColor ? noise(x, z, 5.8, 23) - 0.5 : 0,
                speck: hash(Math.floor(originX * pixelsPerTile) + px,
                    Math.floor(originZ * pixelsPerTile) + pz, 41),
                dirt: grass ? smoothstep((noise(x, z, 1.15, 12) - 0.48) * 4) : 0,
                moss: swamp ? smoothstep((noise(x, z, 6.2, 31) - 0.56) * 12) : 0,
                wet: swamp ? smoothstep((noise(x, z, 3.4, 51)
                    + (noise(x, z, 10.4, 52) - 0.5) * 0.22 - 0.62) * 10) : 0,
            };
            const rgb = [0, 0, 0];
            const firstKind = k00 || k10 || k01 || k11;
            if ((!k00 || k00 === firstKind) && (!k10 || k10 === firstKind)
                && (!k01 || k01 === firstKind) && (!k11 || k11 === firstKind)) {
                const sample = terrainColor(firstKind, detail, x, z);
                rgb[0] = sample[0]; rgb[1] = sample[1]; rgb[2] = sample[2];
            } else {
                for (const [kind, weight] of [[k00, w00], [k10, w10], [k01, w01], [k11, w11]]) {
                    if (!kind) continue;
                    const sample = terrainColor(kind, detail, x, z);
                    for (let channel = 0; channel < 3; channel++) rgb[channel] += sample[channel] * weight;
                }
            }
            const index = (pz * width + px) * 4;
            for (let channel = 0; channel < 3; channel++) {
                data[index + channel] = Math.max(0, Math.min(255, Math.round(rgb[channel])));
            }
            data[index + 3] = 255;
        }
    }
}

export function createLocationTerrainPixels(tiles, pixelsPerTile = 20) {
    const width = (tiles[0]?.length || 0) * pixelsPerTile;
    const height = tiles.length * pixelsPerTile;
    const data = new Uint8Array(width * height * 4);
    paintPixels(tiles, { data, width }, pixelsPerTile, 0, 0, width, height);
    return { data, width, height };
}

export function createTerrainPixelsRegion(sampleTerrain, originX, originZ,
    textureSize = 512, pixelsPerTile = 12) {
    const data = new Uint8Array(textureSize * textureSize * 4);
    const image = { data, width: textureSize, height: textureSize };
    paintPixels(null, image, pixelsPerTile, 0, 0, textureSize, textureSize,
        originX, originZ, sampleTerrain);
    return image;
}

export function updateTerrainPixelsRegion(image, sampleTerrain, originX, originZ,
    bounds, pixelsPerTile = 12) {
    const startX = Math.max(0, Math.floor((bounds.minX - 1 - originX) * pixelsPerTile));
    const startZ = Math.max(0, Math.floor((bounds.minZ - 1 - originZ) * pixelsPerTile));
    const endX = Math.min(image.width, Math.ceil((bounds.maxX + 2 - originX) * pixelsPerTile));
    const endZ = Math.min(image.height, Math.ceil((bounds.maxZ + 2 - originZ) * pixelsPerTile));
    if (endX <= startX || endZ <= startZ) return false;
    paintPixels(null, image, pixelsPerTile, startX, startZ, endX, endZ,
        originX, originZ, sampleTerrain);
    return true;
}

export function updateLocationTerrainPixels(tiles, image, changedTiles) {
    if (!changedTiles.length || !image.width || !image.height) return;
    const pixelsPerTile = image.width / (tiles[0]?.length || 1);
    const minX = Math.min(...changedTiles.map(tile => tile.x));
    const maxX = Math.max(...changedTiles.map(tile => tile.x));
    const minZ = Math.min(...changedTiles.map(tile => tile.z));
    const maxZ = Math.max(...changedTiles.map(tile => tile.z));
    paintPixels(tiles, image, pixelsPerTile,
        Math.max(0, Math.floor((minX - 1) * pixelsPerTile)),
        Math.max(0, Math.floor((minZ - 1) * pixelsPerTile)),
        Math.min(image.width, Math.ceil((maxX + 2) * pixelsPerTile)),
        Math.min(image.height, Math.ceil((maxZ + 2) * pixelsPerTile)));
}
