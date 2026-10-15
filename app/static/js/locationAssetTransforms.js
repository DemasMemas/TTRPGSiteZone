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

export function cameraYawStepDegrees(camera, direction) {
    camera?.updateMatrixWorld();
    const matrix = camera?.matrixWorld?.elements;
    // Project +X and its positive-Y yaw derivative (-Z) onto the camera plane.
    const orientation = matrix ? matrix[4] * matrix[2] - matrix[0] * matrix[6] : 1;
    return direction * (orientation < -1e-6 ? 15 : -15);
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

export function anchoredResizeCenter(x, z, bearing, axis, oldSize, newSize, side) {
    if (!['width', 'depth'].includes(axis)) return { x, z };
    const angle = bearingToObjectRotation(bearing);
    const offset = (Number(newSize) - Number(oldSize)) * (side < 0 ? -0.5 : 0.5);
    return axis === 'width'
        ? { x: x + Math.cos(angle) * offset, z: z - Math.sin(angle) * offset }
        : { x: x + Math.sin(angle) * offset, z: z + Math.cos(angle) * offset };
}

export function volumeResize({ dimensions, center, elevation, rotation, axis, side,
    distance, symmetric = false, snap = 0, floor = false }) {
    const limits = { width: [0.05, 30], depth: [0.02, 30], height: [0.05, 20] };
    if (!limits[axis] || ![-1, 1].includes(side)) return null;
    const oldSize = Number(dimensions[axis]);
    const elevationFactor = axis !== 'height' ? 0 : floor
        ? (symmetric ? 0.5 : side > 0 ? 1 : 0)
        : (symmetric ? -0.5 : side < 0 ? -1 : 0);
    let [minimum, maximum] = limits[axis];
    if (elevationFactor) {
        const atMin = oldSize + (0 - elevation) / elevationFactor;
        const atMax = oldSize + (MAX_ASSET_ELEVATION - elevation) / elevationFactor;
        minimum = Math.max(minimum, Math.min(atMin, atMax));
        maximum = Math.min(maximum, Math.max(atMin, atMax));
    }
    if (minimum > maximum) return null;
    let size = oldSize + side * distance * (symmetric ? 2 : 1);
    if (snap > 0) size = oldSize + Math.round((size - oldSize) / snap) * snap;
    size = Math.max(minimum, Math.min(maximum,
        Math.round(Math.max(minimum, Math.min(maximum, size)) * 100) / 100));
    const nextCenter = axis === 'height' || symmetric ? center
        : anchoredResizeCenter(center.x, center.z, rotation, axis, oldSize, size, side);
    return {
        dimensions: { ...dimensions, [axis]: size },
        center: { x: nextCenter.x, z: nextCenter.z },
        elevation: Math.round((elevation + elevationFactor * (size - oldSize)) * 100) / 100,
    };
}

export function projectedAxisDrag(startX, startY, clientX, clientY, axisX, axisY) {
    const pixelsPerMeterSquared = axisX * axisX + axisY * axisY;
    if (pixelsPerMeterSquared < 36) return -(clientY - startY) * 0.01;
    return ((clientX - startX) * axisX + (clientY - startY) * axisY) / pixelsPerMeterSquared;
}
