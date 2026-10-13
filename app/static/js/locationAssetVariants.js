import { findLocationAsset } from './locationAssetCatalog.js';

export function placementForLocationAsset(asset) {
    return {
        type: asset.baseType || asset.id,
        visualAsset: asset.baseType ? asset.id : null,
    };
}

export function visualAssetForLocationObject(type, properties) {
    const variant = properties?.visual_asset ? findLocationAsset(properties.visual_asset) : null;
    return variant?.baseType === type ? variant : findLocationAsset(type);
}
