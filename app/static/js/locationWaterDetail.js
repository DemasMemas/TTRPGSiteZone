import { makeReedGeometry } from './locationGrassDetail.js';
import { waterLevelForTile } from './locationWaterEdge.js';

function hash(x, z, salt) {
    let value = Math.imul(x + 317 + salt, 374761393) ^ Math.imul(z + 97, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

export function waterDetailPlacements(tiles, regions) {
    const film = [];
    const reeds = [];
    const branches = [];
    const stones = [];
    const rebar = [];
    for (let z = 0; z < tiles.length; z++) {
        for (let x = 0; x < tiles[z].length; x++) {
            if (tiles[z][x].terrain !== 'water') continue;
            const kind = regions.get(`${x},${z}`);
            if (kind !== 'swamp' && kind !== 'rock') continue;
            const level = waterLevelForTile(tiles[z][x], kind);
            const point = salt => ({
                x: x + 0.32 + hash(x, z, salt) * 0.36,
                z: z + 0.32 + hash(x, z, salt + 1) * 0.36,
                y: level,
                turn: hash(x, z, salt + 2) * Math.PI * 2,
                size: 0.72 + hash(x, z, salt + 3) * 0.5,
            });
            if (kind === 'swamp') {
                if (hash(x, z, 11) < 0.22) film.push({ ...point(20), kind });
                if (hash(x, z, 12) < 0.14) reeds.push(point(30));
                if (hash(x, z, 13) < 0.08) branches.push(point(40));
            } else {
                if (hash(x, z, 14) < 0.17) film.push({ ...point(50), kind });
                if (hash(x, z, 15) < 0.13) stones.push(point(60));
                if (hash(x, z, 16) < 0.08) rebar.push(point(70));
            }
        }
    }
    return { film, reeds, branches, stones, rebar };
}

export function createWaterDetailGroup(THREE, tiles, regions) {
    const group = new THREE.Group();
    const placements = waterDetailPlacements(tiles, regions);
    const { film, reeds, branches, stones, rebar } = placements;
    if (film.length) {
        const positions = [];
        const colors = [];
        const centerColor = new THREE.Color();
        const rimColor = new THREE.Color();
        for (const patch of film) {
            const seedX = Math.floor(patch.x * 100);
            const seedZ = Math.floor(patch.z * 100);
            const islands = patch.kind === 'swamp' ? 3 : 2;
            for (let island = 0; island < islands; island++) {
                const angle = patch.turn + island * 2.39996;
                const spread = island === 0 ? 0 : 0.1 + hash(seedX, seedZ, island + 61) * 0.035;
                const x = patch.x + Math.cos(angle) * spread;
                const z = patch.z + Math.sin(angle) * spread;
                const radius = (patch.kind === 'swamp' ? 0.105 : 0.09) * patch.size
                    * (0.7 + hash(seedX, seedZ, island + 65) * 0.65);
                const palette = patch.kind === 'swamp'
                    ? [0x596246, 0x393f2b, 0x72734a] : [0x85583c, 0x5e5548, 0x9a6b46];
                centerColor.setHex(palette[(island + Math.floor(patch.turn * 3)) % palette.length]);
                rimColor.setHex(patch.kind === 'swamp' ? 0x2c3933 : 0x354046);
                const rim = Array.from({ length: 9 }, (_, side) => {
                    const direction = angle + side * Math.PI * 2 / 9;
                    const rough = 0.53 + hash(seedX + island * 17, seedZ, side + 73) * 0.86;
                    return [x + Math.cos(direction) * radius * rough,
                        patch.y + 0.012, z + Math.sin(direction) * radius * 0.78 * rough];
                });
                for (let side = 0; side < rim.length; side++) {
                    positions.push(x, patch.y + 0.024 + island * 0.005, z,
                        ...rim[(side + 1) % rim.length], ...rim[side]);
                    colors.push(centerColor.r, centerColor.g, centerColor.b,
                        rimColor.r, rimColor.g, rimColor.b,
                        rimColor.r, rimColor.g, rimColor.b);
                }
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true, side: THREE.DoubleSide, roughness: 0.92,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.raycast = () => {};
        group.add(mesh);
    }
    const addInstances = (items, createGeometry, createMaterial, transform, colorOf) => {
        if (!items.length) return;
        const mesh = new THREE.InstancedMesh(createGeometry(), createMaterial(), items.length);
        const dummy = new THREE.Object3D();
        items.forEach((item, index) => {
            dummy.position.set(item.x, item.y, item.z);
            dummy.rotation.set(0, item.turn, 0);
            transform(dummy, item);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            if (colorOf) mesh.setColorAt(index, new THREE.Color(colorOf(item)));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (colorOf) mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.raycast = () => {};
        group.add(mesh);
    };
    addInstances(reeds, () => makeReedGeometry(THREE),
        () => new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }),
        (dummy, item) => {
            dummy.position.y += 0.02;
            dummy.scale.setScalar(item.size * 0.82);
        }, () => 0xd2d3a1);
    addInstances(branches, () => new THREE.CylinderGeometry(0.012, 0.024, 0.42, 5),
        () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
        (dummy, item) => {
            dummy.position.y += 0.065;
            dummy.rotation.x = Math.PI / 2.8;
            dummy.scale.setScalar(item.size);
        }, () => 0x66513a);
    addInstances(stones, () => new THREE.IcosahedronGeometry(0.5, 0),
        () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }),
        (dummy, item) => {
            dummy.position.y += 0.045;
            dummy.scale.set(0.22 * item.size, 0.19 * item.size, 0.16 * item.size);
        }, () => 0x70726a);
    addInstances(rebar, () => new THREE.CylinderGeometry(0.012, 0.012, 0.47, 5),
        () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 }),
        (dummy, item) => {
            dummy.position.y += 0.14;
            dummy.rotation.x = 0.28;
            dummy.scale.setScalar(item.size);
        }, () => 0x7b4930);
    group.userData.detailCounts = Object.fromEntries(
        Object.entries(placements).map(([kind, items]) => [kind, items.length]));
    return group;
}
