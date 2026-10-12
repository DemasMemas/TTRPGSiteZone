export const MAX_ASSET_ELEVATION = 10;

export function clampAssetElevation(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(MAX_ASSET_ELEVATION, number)) : 0;
}

export function bearingFromDelta(dx, dz, snap = false) {
    const degrees = Math.atan2(dz, dx) * 180 / Math.PI;
    return snap ? Math.round(degrees / 15) * 15 : Math.round(degrees);
}

// Three.js rotates local +X toward -Z for a positive Y angle.
export function bearingToObjectRotation(bearing) {
    return -Number(bearing) * Math.PI / 180;
}

export function objectRotationToBearing(rotation) {
    return -Number(rotation) * 180 / Math.PI;
}

export function rotatePointAround(x, z, centerX, centerZ, bearing) {
    const radians = Number(bearing) * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const dx = Number(x) - centerX;
    const dz = Number(z) - centerZ;
    return {
        x: centerX + dx * cosine - dz * sine,
        z: centerZ + dx * sine + dz * cosine,
    };
}
