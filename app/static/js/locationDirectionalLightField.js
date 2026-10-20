import { locationStaticLightFieldInputs } from './locationStaticLightField.js';
import { createDirectionalLightField, createDirectionalLightFieldTexture,
    applyDirectionalLightFieldMaterial, removeDirectionalLightFieldMaterial
} from './locationDirectionalLightFieldPrototype.js';

export const LOCATION_DIRECTIONAL_FIELD_SAMPLES_PER_METER = 2;

/** Runtime adapter: stationary point lights illuminate every supported PBR surface. */
export function createLocationDirectionalLightField(THREE, data, sources, tileHeightAt,
    dynamicLightIds = new Set()) {
    const startedAt = performance.now();
    const inputs = locationStaticLightFieldInputs(data, sources, tileHeightAt);
    const prepareMs = performance.now() - startedAt;
    const field = createDirectionalLightField({
        width: inputs.width, height: inputs.height, levels: inputs.levels,
        samplesPerMeter: LOCATION_DIRECTIONAL_FIELD_SAMPLES_PER_METER,
    });
    const stats = { ...field.rebuild({
        lamps: inputs.lamps, walls: inputs.walls, dynamicLightIds,
    }), prepareMs, totalMs: performance.now() - startedAt };
    const texture = createDirectionalLightFieldTexture(THREE, field);
    stats.totalMs = performance.now() - startedAt;
    return {
        field, texture, stats, inputs,
        update(nextData, nextSources, nextDynamicIds = new Set()) {
            const begun = performance.now();
            const next = locationStaticLightFieldInputs(nextData, nextSources, tileHeightAt);
            if (next.width !== field.width || next.height !== field.height
                || next.levels.length !== field.levels.length
                || next.levels.some((level, index) =>
                    level.id !== field.levels[index].id || level.y !== field.levels[index].y)) {
                return false;
            }
            this.inputs = next;
            this.stats = { ...field.rebuild({
                lamps: next.lamps, walls: next.walls, dynamicLightIds: nextDynamicIds,
            }), totalMs: performance.now() - begun };
            texture.needsUpdate = true;
            return true;
        },
        attach(material, level = 0) {
            if (!material?.isMeshStandardMaterial ||
                material.userData?.directionalLightFieldPrototype) return;
            applyDirectionalLightFieldMaterial(material, texture, field, level);
        },
        detach(material) { removeDirectionalLightFieldMaterial(material); },
        dispose() { texture.dispose(); },
    };
}
