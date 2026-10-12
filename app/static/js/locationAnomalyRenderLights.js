export const MAX_ANOMALY_RENDER_LIGHTS = 6;

export function selectAnomalyRenderLights(sources, target, intersects, limit = MAX_ANOMALY_RENDER_LIGHTS) {
    const closest = [];
    for (const source of sources) {
        if (!intersects(source)) continue;
        const distanceSquared = (source.x - target.x) ** 2 + (source.z - target.z) ** 2;
        const entry = { source, distanceSquared };
        let index = closest.findIndex(other => other.distanceSquared > distanceSquared);
        if (index < 0) index = closest.length;
        if (index >= limit) continue;
        closest.splice(index, 0, entry);
        if (closest.length > limit) closest.pop();
    }
    return closest.map(entry => entry.source);
}
