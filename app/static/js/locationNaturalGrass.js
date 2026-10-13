const ROOT = '/static/models/vegetation/polyhaven-d51/grass_medium_01/';
const MODEL = '/static/models/vegetation/grass_medium_01_game_d7.glb';
const CHUNK_SIZE = 12;
let assetPromise = null;

function hash(x, z, salt) {
    let value = Math.imul(x + salt * 37, 374761393) ^ Math.imul(z + salt * 53, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function patch(x, z) {
    const ix = Math.floor(x / 4);
    const iz = Math.floor(z / 4);
    const fx = x / 4 - ix;
    const fz = z / 4 - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz, 81) * (1 - sx) + hash(ix + 1, iz, 81) * sx;
    const b = hash(ix, iz + 1, 81) * (1 - sx) + hash(ix + 1, iz + 1, 81) * sx;
    return a * (1 - sz) + b * sz;
}

export function naturalGrassPlacements(tiles, isCovered = () => false) {
    const medium01 = [];
    const grassTiles = tiles.reduce((sum, row) => sum + row.filter(tile => tile.terrain === 'grass').length, 0);
    const stats = { grassTiles, plainTiles: 0, forestTiles: 0,
        densityRejected: 0, floorRejected: 0 };
    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < tiles[z].length; x++) {
            const tile = tiles[z][x];
            if (tile.terrain !== 'grass') continue;
            const forest = tile.grass_subtype === 'forest';
            stats[forest ? 'forestTiles' : 'plainTiles']++;
            const density = Math.max(0.08, Math.min(1, (patch(x + 0.5, z + 0.5) - 0.25) * 1.8));
            const candidates = forest ? 3 : 5;
            const anchorX = x + 0.2 + hash(x, z, 205) * 0.6;
            const anchorZ = z + 0.2 + hash(x, z, 305) * 0.6;
            for (let index = 0; index < candidates; index++) {
                const chance = density * (forest ? 0.08 : 0.12)
                    * [1, 1, 0.9, 0.75, 0.55][index];
                if (hash(x, z, 110 + index) >= chance) {
                    stats.densityRejected++;
                    continue;
                }
                const clustered = index >= 2;
                const px = clustered
                    ? Math.max(x + 0.19, Math.min(x + 0.81,
                        anchorX + (hash(x, z, 210 + index) - 0.5) * 0.42))
                    : x + 0.19 + hash(x, z, 210 + index) * 0.62;
                const pz = clustered
                    ? Math.max(z + 0.19, Math.min(z + 0.81,
                        anchorZ + (hash(x, z, 310 + index) - 0.5) * 0.42))
                    : z + 0.19 + hash(x, z, 310 + index) * 0.62;
                if (isCovered(px, pz) || isCovered(px - 0.14, pz)
                    || isCovered(px + 0.14, pz) || isCovered(px, pz - 0.14)
                    || isCovered(px, pz + 0.14)) {
                    stats.floorRejected++;
                    continue;
                }
                medium01.push({ x: px, z: pz,
                    size: 0.86 + hash(x, z, 410 + index) * 0.28,
                    width: 0.9 + hash(x, z, 610 + index) * 0.25,
                    depth: 0.9 + hash(x, z, 710 + index) * 0.25,
                    lean: (hash(x, z, 810 + index) - 0.5) * 0.16,
                    tone: hash(x, z, 910 + index),
                    turn: hash(x, z, 510 + index) * Math.PI * 2 });
            }
        }
    }
    return { medium01, stats };
}

export function loadNaturalGrassAssets(THREE, outputEncoding = THREE.LinearEncoding) {
    if (assetPromise) return assetPromise;
    assetPromise = import('https://unpkg.com/three@0.128.0/examples/jsm/loaders/GLTFLoader.js')
        .then(({ GLTFLoader }) => {
            const loader = new GLTFLoader();
            const textures = new THREE.TextureLoader();
            const fail = (url, reject) => error => reject(new Error(
                `Failed to load grass asset ${url}: ${error?.message || error?.type || error}`));
            const model = url => new Promise((resolve, reject) => loader.load(
                url, resolve, undefined, fail(url, reject)));
            const texture = url => new Promise((resolve, reject) => textures.load(
                url, resolve, undefined, fail(url, reject)));
            return Promise.all([
                model(MODEL),
                texture(`${ROOT}textures/grass_medium_01_diff_1k.jpg`),
                texture(`${ROOT}textures/grass_medium_01_alpha_1k.png`),
                texture(`${ROOT}textures/grass_medium_01_nor_gl_1k.jpg`),
            ]);
        }).then(([model, map, alphaMap, normalMap]) => {
            let mesh = null;
            model.scene.traverse(child => {
                if (child.isMesh && child.name === 'grass_medium_01_small_b_LOD0') mesh = child;
            });
            if (!mesh) throw new Error('Missing optimized grass mesh');
            for (const texture of [map, alphaMap, normalMap]) {
                texture.flipY = false;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
            }
            // Keep the atlas in the renderer's output space. The local scene currently
            // outputs linear; decoding sRGB without re-encoding made these leaves black.
            map.encoding = outputEncoding;
            const material = new THREE.MeshStandardMaterial({
                map, alphaMap, normalMap,
                normalScale: new THREE.Vector2(0.35, 0.35),
                alphaTest: 0.35, transparent: false, depthWrite: true,
                side: THREE.DoubleSide, roughness: 0.95, metalness: 0,
            });
            mesh.geometry.computeBoundingBox();
            const bounds = mesh.geometry.boundingBox;
            return { medium01: { geometry: mesh.geometry, material,
                scale: 0.165 / (bounds.max.y - bounds.min.y), bottom: bounds.min.y } };
        }).catch(error => {
            assetPromise = null;
            throw error;
        });
    return assetPromise;
}

export function addNaturalGrassInstances(THREE, group, placements, assets, getHeight) {
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const renderedCounts = { medium01: 0 };
    const chunksByKind = { medium01: 0 };
    for (const kind of ['medium01']) {
        const plants = placements[kind].filter(plant => {
            const center = getHeight(plant.x, plant.z);
            return Math.max(
                Math.abs(center - getHeight(plant.x - 0.14, plant.z)),
                Math.abs(center - getHeight(plant.x + 0.14, plant.z)),
                Math.abs(center - getHeight(plant.x, plant.z - 0.14)),
                Math.abs(center - getHeight(plant.x, plant.z + 0.14)),
            ) < 0.12;
        });
        renderedCounts[kind] = plants.length;
        if (!plants.length) continue;
        const source = assets[kind];
        const geometry = source.geometry.clone();
        // Instance coordinates are chunk-local, so one conservative bound works for every chunk.
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(6, 1.5, 6), 9.5);
        const material = source.material.clone();
        const chunks = new Map();
        for (const plant of plants) {
            const cx = Math.floor(plant.x / CHUNK_SIZE);
            const cz = Math.floor(plant.z / CHUNK_SIZE);
            const key = `${cx},${cz}`;
            if (!chunks.has(key)) chunks.set(key, { cx, cz, plants: [] });
            chunks.get(key).plants.push(plant);
        }
        for (const { cx, cz, plants: chunkPlants } of chunks.values()) {
            const mesh = new THREE.InstancedMesh(geometry, material, chunkPlants.length);
            mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
            for (let index = 0; index < chunkPlants.length; index++) {
                const plant = chunkPlants[index];
                dummy.position.set(plant.x - mesh.position.x,
                    getHeight(plant.x, plant.z) + 0.012 - source.bottom * source.scale * plant.size,
                    plant.z - mesh.position.z);
                dummy.rotation.set(plant.lean, plant.turn, plant.lean * 0.55, 'YXZ');
                dummy.scale.set(source.scale * plant.size * plant.width * 1.15,
                    source.scale * plant.size,
                    source.scale * plant.size * plant.depth * 1.15);
                dummy.updateMatrix();
                mesh.setMatrixAt(index, dummy.matrix);
                color.setRGB(...(plant.tone < 0.16 ? [1.22, 1.13, 0.84]
                    : plant.tone < 0.42 ? [0.98, 1.08, 0.91]
                        : [0.92, 1.16, 1.0]));
                mesh.setColorAt(index, color);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.instanceColor.needsUpdate = true;
            mesh.userData.naturalGrassKind = kind;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.raycast = () => {};
            group.add(mesh);
        }
        chunksByKind[kind] = chunks.size;
    }
    group.userData.naturalGrassCounts = renderedCounts;
    group.userData.detailCounts.tufts += renderedCounts.medium01;
    return { created: { medium01: placements.medium01.length },
        added: renderedCounts,
        slopeRejected: { medium01: placements.medium01.length - renderedCounts.medium01 },
        chunks: chunksByKind,
        triangles: Object.fromEntries(['medium01'].map(kind => {
            const geometry = assets[kind].geometry;
            const triangles = (geometry.index ? geometry.index.count
                : geometry.getAttribute('position').count) / 3;
            return [kind, Math.round(renderedCounts[kind] * triangles)];
        })) };
}
