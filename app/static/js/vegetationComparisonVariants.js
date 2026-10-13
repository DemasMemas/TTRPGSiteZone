function hash(x, z, salt = 0) {
    let value = Math.imul(x + salt + 17, 374761393) ^ Math.imul(z + 31, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

export function comparisonCovered(x, z) {
    if (z < 3 || (z >= 8 && z < 10)) return true;
    if (z >= 6) return false;
    const xi = Math.floor(x * 1024);
    const zi = Math.floor(z * 1024);
    let value = Math.imul(xi + 71, 374761393) ^ Math.imul(zi + 19, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295 > 0.33;
}

// These values are the D.2.1 Grass Cards snapshot, not tuning defaults for new types.
export const grassCardsD21Reference = Object.freeze({
    blades: 7, textureStrands: 12, margin: 0.56,
    scaleX: 0.9, scaleY: 0.62, scaleZ: 0.9,
    hue: 0.14, hueRange: 0.13, saturation: 0.15, saturationRange: 0.16,
    lightness: 0.58, lightnessRange: 0.13,
});

export function withinComparisonPlot(x, z, margin = grassCardsD21Reference.margin) {
    return x >= margin && x <= 8 - margin && z >= margin && z <= 14 - margin;
}

export function prepareComparisonTufts(tufts, density = 1, margin = grassCardsD21Reference.margin) {
    const result = [];
    for (const tuft of tufts) {
        if (!withinComparisonPlot(tuft.x, tuft.z, margin)) continue;
        for (let copy = 0; copy < density; copy++) {
            const offsetX = copy ? (hash(Math.floor(tuft.x * 4096), copy, 207) - 0.5) * 0.16 : 0;
            const offsetZ = copy ? (hash(Math.floor(tuft.z * 4096), copy, 311) - 0.5) * 0.16 : 0;
            result.push({ ...tuft, x: tuft.x + offsetX, z: tuft.z + offsetZ });
        }
    }
    return result;
}

function patchValue(x, z, salt) {
    const ix = Math.floor(x * 0.85);
    const iz = Math.floor(z * 0.85);
    const fx = x * 0.85 - ix;
    const fz = z * 0.85 - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const near = hash(ix, iz, salt) * (1 - sx) + hash(ix + 1, iz, salt) * sx;
    const far = hash(ix, iz + 1, salt) * (1 - sx) + hash(ix + 1, iz + 1, salt) * sx;
    return near * (1 - sz) + far * sz;
}

export function cardHabitat(z) {
    if (z < 3 || (z >= 8 && z < 10)) return 'bare';
    if (z >= 7.25 && z < 10.75) return 'road';
    if (z >= 11.6) return 'fence';
    if (z >= 10.75) return 'open';
    if (z >= 6) return 'dense';
    return 'open';
}

export function selectGrassCardTypes(tufts, variant, {
    habitatAt = (_x, z) => cardHabitat(z),
    acceptsSatellite = (x, z) => withinComparisonPlot(x, z, 0.5) && !comparisonCovered(x, z),
} = {}) {
    const selected = { reference: [], low: [], tall: [] };
    if (variant === 'reference') {
        selected.reference = tufts.slice();
        return selected;
    }
    const profiles = {
        road: { keep: 0.5, low: 0.66, tall: 0 },
        open: { keep: 0.82, low: 0.3, tall: 0.05 },
        dense: { keep: 0.94, low: 0.27, tall: 0.09 },
        fence: { keep: 0.97, low: 0.22, tall: 0.16 },
    };
    for (const tuft of tufts) {
        const habitat = habitatAt(tuft.x, tuft.z);
        const profile = profiles[habitat];
        if (!profile) continue;
        const xi = Math.floor(tuft.x * 4096);
        const zi = Math.floor(tuft.z * 4096);
        const patch = patchValue(tuft.x, tuft.z, 521);
        const chance = hash(xi, zi, 610);
        if (variant === 'tall') {
            const keep = habitat === 'road' ? 0.22 : habitat === 'fence' ? 0.72 : 0.55;
            if (chance < keep * (0.8 + patch * 0.35)) selected.tall.push(tuft);
            continue;
        }
        if (variant === 'low') {
            selected.low.push(tuft);
        } else if (variant === 'mixed') {
            if (chance >= profile.keep * (0.75 + patch * 0.4)) continue;
            const choice = hash(xi, zi, 611);
            const lowThreshold = profile.low + (0.5 - patch) * 0.12;
            const kind = choice < lowThreshold ? 'low'
                : choice < lowThreshold + profile.tall ? 'tall' : 'reference';
            selected[kind].push(tuft);
            if (kind === 'low') continue;
        } else {
            throw new Error(`Unknown grass card variant: ${variant}`);
        }

        // Short leaves occupy gaps around some plants; their position is not a regular offset.
        const companionChance = variant === 'low' ? (habitat === 'road' ? 0.08 : 0.28)
            : (habitat === 'road' ? 0.05 : 0.24 + patch * 0.13);
        if (hash(xi, zi, 612) >= companionChance) continue;
        const angle = hash(xi, zi, 613) * Math.PI * 2;
        const radius = 0.16 + hash(xi, zi, 614) * 0.11;
        const x = tuft.x + Math.cos(angle) * radius;
        const z = tuft.z + Math.sin(angle) * radius;
        if (acceptsSatellite(x, z) && habitatAt(x, z) !== 'road') {
            selected.low.push({ ...tuft, x, z, size: tuft.size * 0.65,
                turn: tuft.turn + angle });
        }
    }
    return selected;
}

function cardTexture(THREE, strands = 12) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    const palette = ['#d2c6a9', '#b1af91', '#9da488', '#e1d5b4'];
    for (let index = 0; index < strands; index++) {
        const startX = 94 + hash(index, 1, 23) * 68;
        const tipX = 46 + hash(index, 2, 23) * 164;
        const tipY = 12 + hash(index, 3, 23) * 73;
        const bend = (hash(index, 4, 23) - 0.5) * 32;
        context.strokeStyle = strands === 9
            ? ['#abb098', '#929e83', '#b6ad8d', '#a3a889'][index % 4]
            : strands === 6
                ? ['#a99b7e', '#b7a788', '#9d927a', '#bdae90'][index % 4]
                : palette[index % palette.length];
        context.lineWidth = 8 + hash(index, 5, 23) * 5;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(startX, 255);
        context.quadraticCurveTo((startX + tipX) / 2 + bend, tipY + 42, tipX, tipY);
        context.stroke();
        if (index % 3 !== 0) continue;
        for (let seed = -1; seed <= 1; seed++) {
            context.fillStyle = strands === 12
                ? (seed ? '#c4baa0' : '#eee1bf')
                : (seed ? '#9e947b' : '#b8ab8d');
            context.beginPath();
            context.ellipse(tipX + seed * 5, tipY + Math.abs(seed) * 9,
                2.1, 5, seed * 0.35, 0, Math.PI * 2);
            context.fill();
        }
    }
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 3] !== 0) continue;
        image.data[offset] = 187;
        image.data[offset + 1] = 179;
        image.data[offset + 2] = 150;
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

export function fanCardGeometry(THREE, kind = 'legacy') {
    const profile = {
        legacy: { count: 7, minHeight: 0.58, heightRange: 0.36,
            minReach: 0.19, reachRange: 0.14, minWidth: 0.065, widthRange: 0.035 },
        low: { count: 6, minHeight: 0.26, heightRange: 0.19,
            minReach: 0.25, reachRange: 0.15, minWidth: 0.095, widthRange: 0.035 },
        tall: { count: 4, minHeight: 0.83, heightRange: 0.4,
            minReach: 0.1, reachRange: 0.1, minWidth: 0.06, widthRange: 0.025 },
    }[kind];
    if (!profile) throw new Error(`Unknown grass card profile: ${kind}`);
    const positions = [];
    const uvs = [];
    const triangle = (a, b, c, au, bu, cu) => {
        positions.push(...a, ...b, ...c);
        uvs.push(...au, ...bu, ...cu);
    };
    for (let blade = 0; blade < profile.count; blade++) {
        const angle = blade * 2.39996 + (hash(blade, 4, 119) - 0.5) * 0.38;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        const sideX = -dz;
        const sideZ = dx;
        const base = 0.015 + hash(blade, 5, 119) * 0.055;
        const height = profile.minHeight + hash(blade, 6, 119) * profile.heightRange;
        const reach = profile.minReach + hash(blade, 7, 119) * profile.reachRange;
        const width = profile.minWidth + hash(blade, 8, 119) * profile.widthRange;
        const point = (distance, y, halfWidth, side) => [
            dx * distance + sideX * halfWidth * side, y,
            dz * distance + sideZ * halfWidth * side,
        ];
        const bottomL = point(base, 0, width * 0.36, -1);
        const bottomR = point(base, 0, width * 0.36, 1);
        const middleL = point(base + reach * 0.43, height * 0.55, width, -1);
        const middleR = point(base + reach * 0.43, height * 0.55, width, 1);
        const topL = point(base + reach, height, width * 0.56, -1);
        const topR = point(base + reach, height, width * 0.56, 1);
        triangle(bottomL, bottomR, middleL, [0, 0], [1, 0], [0, 0.55]);
        triangle(bottomR, middleR, middleL, [1, 0], [1, 0.55], [0, 0.55]);
        triangle(middleL, middleR, topL, [0, 0.55], [1, 0.55], [0, 1]);
        triangle(middleR, topR, topL, [1, 0.55], [1, 1], [0, 1]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
}

export function createComparisonResources(THREE) {
    const referenceTexture = cardTexture(THREE, grassCardsD21Reference.textureStrands);
    const lowTexture = cardTexture(THREE, 9);
    const tallTexture = cardTexture(THREE, 6);
    return {
        textures: { reference: referenceTexture, low: lowTexture, tall: tallTexture },
        geometries: {
            reference: fanCardGeometry(THREE),
            low: fanCardGeometry(THREE, 'low'),
            tall: fanCardGeometry(THREE, 'tall'),
        },
        materials: Object.fromEntries(Object.entries({ reference: referenceTexture,
            low: lowTexture, tall: tallTexture }).map(([kind, texture]) => [kind,
            new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.36,
                transparent: false, depthWrite: true, side: THREE.DoubleSide })])),
    };
}

export function createComparisonVegetation(THREE, variant, tufts, resources, options = {}) {
    const group = new THREE.Group();
    const selected = selectGrassCardTypes(tufts, variant, options);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const addInstances = (items, geometry, material, kind) => {
        if (!items.length) return;
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const variation = hash(Math.floor(item.x * 2048), Math.floor(item.z * 2048), 89);
            const shape = hash(Math.floor(item.x * 2048), Math.floor(item.z * 2048), 142);
            dummy.position.set(item.x, (options.getHeight?.(item.x, item.z) ?? 0) + 0.004, item.z);
            dummy.rotation.set(0, item.turn, 0);
            const size = item.size * (0.85 + variation * 0.36);
            const stretchX = 0.88 + shape * 0.22;
            const stretchZ = 1.04 - shape * 0.13;
            if (kind === 'reference') dummy.scale.set(size * grassCardsD21Reference.scaleX,
                size * grassCardsD21Reference.scaleY, size * grassCardsD21Reference.scaleZ);
            else if (kind === 'low') dummy.scale.set(size * (0.87 + variation * 0.12) * stretchX,
                size * (0.62 + variation * 0.12), size * (0.87 + variation * 0.12) * stretchZ);
            else dummy.scale.set(size * (0.75 + variation * 0.08) * stretchX,
                size * (0.85 + variation * 0.12), size * (0.75 + variation * 0.08) * stretchZ);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            if (kind === 'reference') color.setHSL(
                grassCardsD21Reference.hue + variation * grassCardsD21Reference.hueRange,
                grassCardsD21Reference.saturation + variation * grassCardsD21Reference.saturationRange,
                grassCardsD21Reference.lightness + variation * grassCardsD21Reference.lightnessRange);
            else if (kind === 'low') color.setHSL(0.16 + variation * 0.1,
                0.14 + variation * 0.12, 0.5 + variation * 0.08);
            else color.setHSL(0.11 + variation * 0.05,
                0.1 + variation * 0.09, 0.48 + variation * 0.08);
            mesh.setColorAt(index, color);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.raycast = () => {};
        group.add(mesh);
    };
    for (const kind of ['reference', 'low', 'tall']) {
        addInstances(selected[kind], resources.geometries[kind], resources.materials[kind], kind);
    }
    group.userData.counts = Object.fromEntries(['reference', 'low', 'tall']
        .map(kind => [kind, selected[kind].length]));
    return group;
}

