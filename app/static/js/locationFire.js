export const FIRE_OBJECT_TYPES = new Set(['campfire', 'torch', 'wall_torch', 'fire_barrel']);

export function isFireObject(object) {
    return FIRE_OBJECT_TYPES.has(object?.type);
}

export function fireLightSource(object, includeUnlit = false) {
    if (!isFireObject(object) || (!includeUnlit && object.properties?.is_lit !== true)) return null;
    const properties = object.properties || {};
    const modelHeight = Number(properties.dimensions?.height)
        || (object.type === 'torch' ? 1.7 : object.type === 'wall_torch' ? 0.75
            : object.type === 'fire_barrel' ? 0.78 : 0.7);
    const height = modelHeight * (object.type === 'torch' ? 0.96 : object.type === 'wall_torch' ? 0.88
        : object.type === 'fire_barrel' ? 0.9 : 0.55);
    const rotation = Number(properties.rotation || 0);
    const forward = object.type === 'wall_torch' ? Number(properties.dimensions?.depth || 0.42) * 0.55 : 0;
    return {
        x: Number(object.tile_x) + 0.5 + Number(properties.offset_x || 0) + Math.sin(rotation) * forward,
        z: Number(object.tile_y) + 0.5 + Number(properties.offset_z || 0) + Math.cos(rotation) * forward,
        tileX: Number(object.tile_x),
        tileZ: Number(object.tile_y),
        height: height + Number(properties.elevation || 0),
        color: '#ffb064',
        intensity: object.properties?.is_lit === true ? (['torch', 'wall_torch'].includes(object.type) ? 1.8 : 2.4) : 0,
        distance: ['torch', 'wall_torch'].includes(object.type) ? 5 : 6,
    };
}

export function getFireLightSources(objects) {
    return (objects || []).map(object => fireLightSource(object)).filter(Boolean);
}

export function createFireObjectModel(THREE, object, dimensions) {
    const group = new THREE.Group();
    const { width, depth, height } = dimensions;
    const dark = new THREE.MeshStandardMaterial({ color: object.properties?.color || '#534a3c', roughness: 0.95 });
    const char = new THREE.MeshStandardMaterial({ color: '#25211d', roughness: 1 });
    const ember = new THREE.MeshStandardMaterial({ color: '#7d3923', emissive: '#9b310f', emissiveIntensity: 0.25 });
    const add = (geometry, material, x, y, z) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        group.add(mesh);
        return mesh;
    };
    let flameBase;
    let flameWidth;
    if (object.type === 'campfire') {
        const radius = Math.min(width, depth) * 0.35;
        for (let index = 0; index < 9; index++) {
            const angle = index * Math.PI * 2 / 9;
            add(new THREE.DodecahedronGeometry(radius * 0.23, 0), dark,
                Math.cos(angle) * radius, radius * 0.16, Math.sin(angle) * radius);
        }
        for (let index = 0; index < 3; index++) {
            const log = add(new THREE.CylinderGeometry(radius * 0.11, radius * 0.14, radius * 1.55, 7), char,
                0, radius * 0.25, 0);
            log.rotation.z = Math.PI / 2;
            log.rotation.y = index * Math.PI / 3;
        }
        add(new THREE.CylinderGeometry(radius * 0.45, radius * 0.5, 0.04, 10), ember, 0, 0.04, 0);
        flameBase = Math.min(height * 0.3, 0.22);
        flameWidth = radius * 0.65;
    } else if (object.type === 'wall_torch') {
        add(new THREE.BoxGeometry(width * 0.72, height * 0.45, 0.06), char,
            0, height * 0.42, -depth * 0.38);
        const arm = add(new THREE.CylinderGeometry(width * 0.1, width * 0.13, depth * 0.83, 7), dark,
            0, height * 0.43, 0);
        arm.rotation.x = Math.PI / 2;
        add(new THREE.CylinderGeometry(width * 0.16, width * 0.2, height * 0.58, 8), dark,
            0, height * 0.56, depth * 0.4);
        add(new THREE.CylinderGeometry(width * 0.39, width * 0.25, height * 0.12, 8), char,
            0, height * 0.88, depth * 0.4);
        flameBase = height * 0.91;
        flameWidth = width * 0.45;
    } else if (object.type === 'torch') {
        add(new THREE.CylinderGeometry(width * 0.13, width * 0.23, height * 0.83, 8), dark,
            0, height * 0.415, 0);
        add(new THREE.CylinderGeometry(width * 0.34, width * 0.22, height * 0.13, 8), char,
            0, height * 0.85, 0);
        flameBase = height * 0.91;
        flameWidth = width * 0.42;
    } else {
        const radius = Math.min(width, depth) * 0.5;
        add(new THREE.CylinderGeometry(radius, radius * 0.93, height * 0.72, 16, 1, true), dark,
            0, height * 0.36, 0);
        add(new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 0.025, 16), char,
            0, height * 0.72, 0);
        add(new THREE.TorusGeometry(radius * 0.91, radius * 0.08, 5, 16), dark,
            0, height * 0.73, 0).rotation.x = Math.PI / 2;
        for (const y of [height * 0.16, height * 0.62]) {
            add(new THREE.TorusGeometry(radius * 0.95, radius * 0.055, 5, 16), char,
                0, y, 0).rotation.x = Math.PI / 2;
        }
        flameBase = height * 0.75;
        flameWidth = radius * 0.58;
    }

    if (object.properties?.is_lit === true) {
        const outer = new THREE.MeshStandardMaterial({ color: '#ff7b26', emissive: '#ff6a16', emissiveIntensity: 2,
            transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
        const inner = new THREE.MeshStandardMaterial({ color: '#ffe3a1', emissive: '#ffc458', emissiveIntensity: 2,
            transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide });
        const flames = [];
        for (let index = 0; index < 3; index++) {
            const flameHeight = ['torch', 'wall_torch'].includes(object.type) ? height * 0.2 : height * 0.36;
            const flame = add(new THREE.ConeGeometry(flameWidth * (index ? 0.72 : 1), flameHeight, 6),
                index === 1 ? inner : outer,
                (index - 1) * flameWidth * 0.35, flameBase + flameHeight * 0.47,
                object.type === 'wall_torch' ? depth * 0.4 : 0);
            flame.rotation.y = index * 1.6;
            flame.userData.fireFlame = true;
            flames.push({ mesh: flame, phase: index * 1.8 });
        }
        group.userData.fireFlames = flames;
    }
    return group;
}

export function animateFireObjectModels(meshes, timeMs) {
    for (const root of meshes) {
        for (const { mesh, phase } of root.userData.fireFlames || []) {
            mesh.scale.y = 0.9 + 0.12 * Math.sin(timeMs * 0.006 + phase);
            mesh.rotation.z = 0.07 * Math.sin(timeMs * 0.004 + phase);
        }
    }
}
