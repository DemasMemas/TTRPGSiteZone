// Shared scene adapter for map tools and markers. Rendering and surface picking
// remain owned by the world/local scene, rather than by another tool renderer.
import { scene, camera, renderer, controls, worldPointOnTerrain, getTileHeightAt } from './lobby3d.js';
let localContext = null;
export function setLocalMapSceneContext(context) {
    window.dispatchEvent(new Event('map-scene-changing'));
    localContext = context;
    window.dispatchEvent(new Event('map-scene-changed'));
}
export function getMapSceneContext() {
    if (window.isLocationActive) return localContext;
    return { scene, camera, canvas: renderer.domElement, controls, locationId: null,
        level: 0, unit: 'кл.', point: worldPointOnTerrain,
        surface: (x, z) => getTileHeightAt(x, z), visibleLevel: () => true };
}
export function sameMapScope(payload, context = getMapSceneContext()) {
    return Boolean(context) && (payload.location_id ?? null) === context.locationId;
}
