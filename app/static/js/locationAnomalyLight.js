const LIGHT_BY_VISUAL = {
    fire: { color: '#ff813d', intensity: 0.85, distance: 3.1 },
    electric: { color: '#92dcff', intensity: 0.65, distance: 2.7 },
    acid: { color: '#a8ec69', intensity: 0.45, distance: 2.4 },
};

function anomalyLight(decor, x, z) {
    if (decor.type !== 'anomaly' || decor.gm_hidden) return null;
    const category = String(decor.anomalyCategory || '');
    const visual = decor.anomalyType || (
        category.includes('Термич') ? 'fire'
            : category.includes('Электрич') ? 'electric'
                : category.includes('Химич') ? 'acid' : null
    );
    const light = LIGHT_BY_VISUAL[visual];
    if (!light) return null;
    return {
        ...light,
        x: x + 0.5 + Number(decor.x || 0),
        z: z + 0.5 + Number(decor.z || 0),
        tileX: x,
        tileZ: z,
        height: 0.55 + Number(decor.elevation || 0),
        castsShadow: false,
    };
}

export function getAnomalyLightSources(tiles) {
    const sources = [];
    for (const [z, row] of (tiles || []).entries()) {
        for (const [x, tile] of row.entries()) {
            for (const decor of tile.objects || []) {
                const source = anomalyLight(decor, x, z);
                if (source) sources.push(source);
            }
        }
    }
    return sources;
}
