import { findLocationAsset } from './locationAssetCatalog.js';

export function baseAssetDimensions(type, kind = 'decor') {
    const preset = findLocationAsset(type);
    const fallback = kind === 'lamp'
        ? (type === 'spot' ? [0.4, 0.4, 0.35] : [0.36, 0.36, 0.36])
        : [1, 1, 1];
    const [width, depth, height] = preset?.dimensions || fallback;
    return { width, depth, height };
}

export function assetDimensions(source, kind, type) {
    const base = baseAssetDimensions(type, kind);
    const value = source?.properties?.dimensions || source?.dimensions;
    if (Array.isArray(value)) {
        return { width: Number(value[0]), depth: Number(value[1]), height: Number(value[2]) };
    }
    if (value && typeof value === 'object') {
        return {
            width: Number(value.width ?? base.width),
            depth: Number(value.depth ?? base.depth),
            height: Number(value.height ?? base.height),
        };
    }
    const scale = kind === 'decor' ? Number(source?.scale || 1) : 1;
    return {
        width: base.width * scale,
        depth: base.depth * scale,
        height: base.height * scale,
    };
}

export function validAssetDimensions(value) {
    if (!value || typeof value !== 'object') return false;
    return Number.isFinite(value.width) && value.width >= 0.05 && value.width <= 30
        && Number.isFinite(value.depth) && value.depth >= 0.02 && value.depth <= 30
        && Number.isFinite(value.height) && value.height >= 0.05 && value.height <= 20;
}

export function resizedAxis(value, minimum = 0.05, maximum = 30) {
    return Math.round(Math.min(maximum, Math.max(minimum, value)) * 100) / 100;
}

export function resizedUniformDimensions(base, factor) {
    const limits = { width: [0.05, 30], depth: [0.02, 30], height: [0.05, 20] };
    const axes = Object.keys(limits);
    const minimum = Math.max(...axes.map(axis => limits[axis][0] / base[axis]));
    const maximum = Math.min(...axes.map(axis => limits[axis][1] / base[axis]));
    const scale = Math.min(maximum, Math.max(minimum, factor));
    return Object.fromEntries(axes.map(axis => [axis, resizedAxis(base[axis] * scale, ...limits[axis])]));
}
