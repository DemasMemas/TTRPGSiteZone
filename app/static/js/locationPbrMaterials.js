import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(url, colorSpace = false) {
    if (!textureCache.has(url)) {
        textureCache.set(url, new Promise((resolve, reject) => {
            loader.load(url, texture => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                if (colorSpace) texture.encoding = THREE.sRGBEncoding;
                resolve(texture);
            }, undefined, reject);
        }).catch(error => {
            textureCache.delete(url);
            throw error;
        }));
    }
    return textureCache.get(url);
}

export function applyLocationPbrMaterial(material, maps) {
    if (!maps?.color || !maps.normal || !maps.arm) return false;
    material.userData.pbrActive = true;
    material.color.set(0xffffff);
    Promise.all([loadTexture(maps.color, true), loadTexture(maps.normal), loadTexture(maps.arm)])
        .then(([color, normal, arm]) => {
            if (!material.userData.pbrActive) return;
            material.map = color;
            material.normalMap = normal;
            material.aoMap = arm;
            material.roughnessMap = arm;
            material.metalnessMap = arm;
            material.metalness = 1;
            material.roughness = 1;
            material.aoMapIntensity = 0.7;
            material.needsUpdate = true;
        })
        .catch(error => console.warn('PBR maps unavailable; keeping procedural surface', error));
    return true;
}

export function releaseLocationPbrMaterial(material) {
    if (material?.userData) material.userData.pbrActive = false;
}

// Called after all local materials have been released. Keep the downloaded
// images cached, but remove renderer dispose callbacks and GPU allocations.
export function releaseLocationPbrTextures() {
    for (const pending of textureCache.values()) pending.then(texture => texture.dispose()).catch(() => {});
}

export function tileLocationPbrBoxUvs(geometry, width, height, depth, metersPerTile = 2) {
    const uv = geometry.attributes.uv;
    if (!uv || uv.count !== 24) return;
    const faces = [
        [depth, height], [depth, height],
        [width, depth], [width, depth],
        [width, height], [width, height],
    ];
    faces.forEach(([u, v], face) => {
        for (let corner = 0; corner < 4; corner++) {
            const index = face * 4 + corner;
            uv.setXY(index, uv.getX(index) * u / metersPerTile,
                uv.getY(index) * v / metersPerTile);
        }
    });
    uv.needsUpdate = true;
    geometry.setAttribute('uv2', uv.clone());
}

export function alignLocationPbrFloorUvs(geometry, mesh, metersPerTile = 2) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const uv = geometry.attributes.uv;
    if (!position || !normal || !uv) return;
    const point = new THREE.Vector3();
    for (let index = 0; index < position.count; index++) {
        if (Math.abs(normal.getY(index)) < 0.5) continue;
        point.fromBufferAttribute(position, index);
        mesh.localToWorld(point);
        uv.setXY(index, point.x / metersPerTile, point.z / metersPerTile);
    }
    uv.needsUpdate = true;
    geometry.setAttribute('uv2', uv.clone());
}
