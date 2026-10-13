import { floorVisualPose, structurePose } from './locationArchitecture.js';

export function roofPlans(objects, groundHeight = () => 1) {
    const walls = (objects || []).filter(object => object.type === 'wall'
        && !object.properties?.gm_hidden);
    return (objects || []).filter(object => object.type === 'floor'
        && !object.properties?.gm_hidden
        && object.properties?.roof_enabled !== false).flatMap(floor => {
        const pose = floorVisualPose(floor, objects);
        const sides = new Map();
        for (const wall of walls) {
            const edge = structurePose(wall);
            const dx = edge.x - pose.x;
            const dz = edge.z - pose.z;
            const along = dx * pose.axis.x + dz * pose.axis.z;
            const across = dx * pose.normal.x + dz * pose.normal.z;
            const alignment = Math.abs(edge.axis.x * pose.axis.x + edge.axis.z * pose.axis.z);
            let side = null;
            if (alignment > 0.94 && edge.width >= pose.width * 0.7
                && Math.abs(Math.abs(across) - pose.depth / 2) < 0.55
                && Math.abs(along) < pose.width * 0.2) side = across < 0 ? 'north' : 'south';
            if (alignment < 0.06 && edge.width >= pose.depth * 0.7
                && Math.abs(Math.abs(along) - pose.width / 2) < 0.55
                && Math.abs(across) < pose.depth * 0.2) side = along < 0 ? 'west' : 'east';
            if (side) {
                const height = groundHeight(wall.tile_x, wall.tile_y)
                    + Number(wall.properties?.elevation || 0) + edge.height;
                const coordinate = side === 'north' || side === 'south' ? across : along;
                const outer = coordinate + (side === 'north' || side === 'west' ? -1 : 1) * edge.depth / 2;
                if (!sides.has(side) || height > sides.get(side).height) {
                    sides.set(side, { height, color: wall.properties?.color || '#aa8866', outer });
                }
            }
        }
        if (sides.size !== 4) return [];
        const alongMin = sides.get('west').outer;
        const alongMax = sides.get('east').outer;
        const acrossMin = sides.get('north').outer;
        const acrossMax = sides.get('south').outer;
        const alongSpan = alongMax - alongMin;
        const acrossSpan = acrossMax - acrossMin;
        const acrossRidge = acrossSpan > alongSpan;
        const width = Math.max(alongSpan, acrossSpan) + 0.48;
        const depth = Math.min(alongSpan, acrossSpan) + 0.48;
        const centerAlong = (alongMin + alongMax) / 2;
        const centerAcross = (acrossMin + acrossMax) / 2;
        return [{ floorId: floor.id,
            x: pose.x + centerAlong * pose.axis.x + centerAcross * pose.normal.x,
            z: pose.z + centerAlong * pose.axis.z + centerAcross * pose.normal.z,
            angle: pose.angle + (acrossRidge ? Math.PI / 2 : 0),
            width, depth, eaveY: Math.max(...[...sides.values()].map(side => side.height)) + 0.12,
            rise: Math.max(0.5, Math.min(1.65, depth * 0.17)),
            color: floor.properties?.roof_color || '#575b52',
            gableColor: floor.properties?.gable_color
                || sides.get(acrossRidge ? 'north' : 'west').color }];
    });
}

export function createRoofGeometry(THREE, plan) {
    const halfWidth = plan.width / 2;
    const halfDepth = plan.depth / 2;
    const positions = [];
    for (const sign of [-1, 1]) {
        const a = [-halfWidth, 0, sign * halfDepth];
        const b = [halfWidth, 0, sign * halfDepth];
        const c = [halfWidth, plan.rise, 0];
        const d = [-halfWidth, plan.rise, 0];
        if (sign < 0) positions.push(...a, ...c, ...b, ...a, ...d, ...c);
        else positions.push(...b, ...d, ...a, ...b, ...c, ...d);
        const lowerA = [a[0], -0.12, a[2]];
        const lowerB = [b[0], -0.12, b[2]];
        const lowerC = [c[0], c[1] - 0.12, c[2]];
        const lowerD = [d[0], d[1] - 0.12, d[2]];
        positions.push(...lowerA, ...lowerB, ...lowerC,
            ...lowerA, ...lowerC, ...lowerD);
        positions.push(...a, ...b, ...lowerB, ...a, ...lowerB, ...lowerA);
        for (const [eave, ridge] of [[a, d], [b, c]]) {
            const lowerEave = [eave[0], eave[1] - 0.12, eave[2]];
            const lowerRidge = [ridge[0], ridge[1] - 0.12, ridge[2]];
            positions.push(...eave, ...ridge, ...lowerRidge,
                ...eave, ...lowerRidge, ...lowerEave);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}

export function createRoofGableGeometry(THREE, plan) {
    const positions = [];
    const halfWidth = (plan.width - 0.48) / 2;
    const halfDepth = (plan.depth - 0.48) / 2;
    const shoulderY = plan.rise * (1 - halfDepth / (plan.depth / 2)) - 0.12;
    for (const sign of [-1, 1]) {
        const x = sign * halfWidth;
        const leftBottom = [x, -0.12, -halfDepth];
        const rightBottom = [x, -0.12, halfDepth];
        const leftShoulder = [x, shoulderY, -halfDepth];
        const rightShoulder = [x, shoulderY, halfDepth];
        const peak = [x, plan.rise - 0.12, 0];
        positions.push(...leftBottom, ...rightBottom, ...rightShoulder,
            ...leftBottom, ...rightShoulder, ...leftShoulder,
            ...leftShoulder, ...rightShoulder, ...peak);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    return geometry;
}

export function roofVisibleForCamera(plan, target, cameraDistance, enabled, editing, cameraPosition = null) {
    if (!enabled || editing) return false;
    const position = cameraPosition || target;
    const dx = position.x - plan.x;
    const dz = position.z - plan.z;
    const along = dx * Math.cos(plan.angle) - dz * Math.sin(plan.angle);
    const across = dx * Math.sin(plan.angle) + dz * Math.cos(plan.angle);
    const edgeX = Math.max(0, Math.abs(along) - plan.width / 2);
    const edgeZ = Math.max(0, Math.abs(across) - plan.depth / 2);
    const height = cameraPosition ? Math.max(0, cameraPosition.y - plan.eaveY - plan.rise) : cameraDistance;
    return Math.hypot(edgeX, edgeZ, height) >= Math.max(5, Math.max(plan.width, plan.depth) * 0.85);
}

export function applyInteriorFloorShade(material, width, depth, entrance = null) {
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey?.bind(material);
    const intensity = { value: 0 };
    material.userData.interiorShade = intensity;
    material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}:interior-floor-shade`;
    material.onBeforeCompile = shader => {
        previousCompile?.(shader);
        shader.uniforms.interiorShadeIntensity = intensity;
        shader.uniforms.interiorFloorHalfSize = { value: [width / 2, depth / 2] };
        shader.uniforms.interiorEntrance = { value: entrance || [0, 0] };
        shader.uniforms.interiorEntranceEnabled = { value: entrance ? 1 : 0 };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vInteriorFloorXZ;')
            .replace('#include <project_vertex>', 'vInteriorFloorXZ = position.xz;\n#include <project_vertex>');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec2 vInteriorFloorXZ;
                uniform float interiorShadeIntensity;
                uniform vec2 interiorFloorHalfSize;
                uniform vec2 interiorEntrance;
                uniform float interiorEntranceEnabled;
            `)
            .replace('#include <color_fragment>', `#include <color_fragment>
                float interiorWallDistance = min(interiorFloorHalfSize.x - abs(vInteriorFloorXZ.x),
                    interiorFloorHalfSize.y - abs(vInteriorFloorXZ.y));
                float interiorOcclusion = 0.12 + 0.14
                    * (1.0 - smoothstep(0.0, 1.15, interiorWallDistance));
                vec2 interiorEdge = 1.0 - smoothstep(vec2(0.0), vec2(0.8),
                    interiorFloorHalfSize - abs(vInteriorFloorXZ));
                interiorOcclusion += 0.035 * interiorEdge.x * interiorEdge.y;
                vec2 entranceDelta = vInteriorFloorXZ - interiorEntrance;
                interiorOcclusion += interiorEntranceEnabled * 0.045
                    * (1.0 - smoothstep(0.05, 1.6, dot(entranceDelta, entranceDelta)));
                diffuseColor.rgb *= 1.0 - interiorShadeIntensity * interiorOcclusion;
            `);
    };
}
