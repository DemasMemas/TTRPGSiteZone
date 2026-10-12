export const ELECTRIC_FIXTURE_TYPES = new Set(['ceiling_bulb', 'wall_bulb']);

export function isElectricFixture(object) {
    return ELECTRIC_FIXTURE_TYPES.has(object?.type);
}

function ceilingBulbYOffset(dimensions) {
    const height = Number(dimensions.height || 0.7);
    const radius = Number(dimensions.width || 0.32) * 0.43;
    return -height * (0.64 + 0.19 / 2) - radius + 0.006;
}

function wallBulbYOffset(dimensions) {
    const height = Number(dimensions.height || 0.36);
    const radius = Math.min(Number(dimensions.width || 0.38), height) * 0.32;
    return radius - 0.012;
}

export function electricFixtureLightSource(object, includeOff = false) {
    if (!isElectricFixture(object) || (!includeOff && object.properties?.is_on === false)) return null;
    const properties = object.properties || {};
    const dimensions = properties.dimensions || {};
    const rotation = Number(properties.rotation || 0);
    const forward = object.type === 'wall_bulb' ? Number(dimensions.depth || 0.4) * 0.67 : 0;
    return {
        x: Number(object.tile_x) + 0.5 + Number(properties.offset_x || 0) + Math.sin(rotation) * forward,
        z: Number(object.tile_y) + 0.5 + Number(properties.offset_z || 0) + Math.cos(rotation) * forward,
        tileX: Number(object.tile_x),
        tileZ: Number(object.tile_y),
        height: Number(properties.elevation || 0)
            + (object.type === 'ceiling_bulb' ? ceilingBulbYOffset(dimensions) : wallBulbYOffset(dimensions)),
        color: properties.light_color || '#ffe2aa',
        intensity: properties.is_on === false ? 0 : 2.1,
        distance: 7,
    };
}

export function createElectricFixtureModel(THREE, object, dimensions) {
    const group = new THREE.Group();
    const { width, depth, height } = dimensions;
    const on = object.properties?.is_on !== false;
    const wallMounted = object.type === 'wall_bulb';
    const metal = new THREE.MeshStandardMaterial({ color: '#494841', metalness: 0.55, roughness: 0.5 });
    const socket = new THREE.MeshStandardMaterial({ color: '#726b59', metalness: 0.28, roughness: 0.67 });
    const glass = new THREE.MeshStandardMaterial({
        color: on ? (wallMounted ? '#f7e1ad' : '#fff0c8') : '#b9b5a7',
        emissive: on ? (wallMounted ? '#ffca73' : '#ffe1a0') : '#000000',
        emissiveIntensity: on ? (wallMounted ? 0.8 : 1.8) : 0, roughness: 0.18,
    });
    const add = (geometry, material, x, y, z) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        group.add(mesh);
        return mesh;
    };
    if (object.type === 'ceiling_bulb') {
        add(new THREE.CylinderGeometry(width * 0.42, width * 0.42, 0.055, 12), metal, 0, 0, 0);
        add(new THREE.CylinderGeometry(0.018, 0.018, height * 0.53, 6), metal,
            0, -height * 0.29, 0);
        add(new THREE.CylinderGeometry(width * 0.2, width * 0.26, height * 0.19, 10), socket,
            0, -height * 0.64, 0);
        add(new THREE.SphereGeometry(width * 0.43, 12, 10), glass,
            0, ceilingBulbYOffset(dimensions), 0);
    } else {
        add(new THREE.BoxGeometry(width * 0.68, height * 0.86, 0.055), metal, 0, 0, -depth * 0.38);
        add(new THREE.BoxGeometry(width * 0.14, height * 0.14, depth * 0.95), metal,
            0, -height * 0.25, depth * 0.15);
        add(new THREE.CylinderGeometry(width * 0.25, width * 0.16, height * 0.26, 10), socket,
            0, -height * 0.13, depth * 0.67);
        add(new THREE.SphereGeometry(Math.min(width, height) * 0.32, 12, 10), glass,
            0, wallBulbYOffset(dimensions), depth * 0.67);
    }
    return group;
}
