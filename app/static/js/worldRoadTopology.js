const ROAD_SETTLEMENTS = new Set(['hamlet', 'village', 'factory', 'base']);
export function roadSurfaceHeight(tile,road) {
    const ground=Number(tile?.height??1)+.06;
    return road?.bridge&&Number.isFinite(Number(road.bridge_height))?Math.max(ground,Number(road.bridge_height)):ground;
}
const ROAD_DIRECTIONS = {
    '1,0': ['E', 'W'], '-1,0': ['W', 'E'],
    '0,1': ['S', 'N'], '0,-1': ['N', 'S'],
    '1,1': ['SE', 'NW'], '-1,-1': ['NW', 'SE'],
    '1,-1': ['NE', 'SW'], '-1,1': ['SW', 'NE'],
};

export function roadNode(tile) {
    const objects = tile?.objects || [];
    const roads = objects.filter(object => object.type === 'road');
    const road = roads[0] || null;
    const settlement = objects.some(object => ROAD_SETTLEMENTS.has(object.type));
    const legacyGenerated = roads.length > 0 && roads.every(object => Number(object.scale) === 1.1
        && object.color === '#756f61' && [0, 90].includes(Number(object.rotation || 0)));
    const legacyDirections = legacyGenerated ? new Set(roads.flatMap(object => Number(object.rotation || 0) === 90
        ? ['N', 'S'] : ['E', 'W'])) : null;
    return road || settlement ? { road, settlement, legacyDirections } : null;
}

export function roadConnects(from, to, sideA = null, sideB = null) {
    if (!from || !to || !(from.road || to.road)) return false;
    // Prefer the two orthogonal links to a diagonal shortcut through a junction.
    const viaA = roadConnects(from, sideA) && roadConnects(sideA, to);
    const viaB = roadConnects(from, sideB) && roadConnects(sideB, to);
    return !(viaA || viaB);
}

function roadAxisAt(nodeAt, x, z) {
    const legacyAt=(x,z)=>{const node=nodeAt(x,z);return node?.road?.authored_route?null:node;};
    const score = (dx, dz) => {
        let neighbors = 0;
        let continuation = 0;
        for (const sign of [-1, 1]) {
            if (!legacyAt(x + dx * sign, z + dz * sign)) continue;
            neighbors++;
            if (legacyAt(x + dx * sign * 2, z + dz * sign * 2)) continuation++;
        }
        return neighbors + (neighbors === 2 ? 1 : 0) + continuation * 0.5;
    };
    const horizontal = score(1, 0);
    const vertical = score(0, 1);
    if (horizontal !== vertical) return horizontal > vertical ? 'x' : 'z';
    const angle = Number(nodeAt(x, z)?.road?.rotation || 0) * Math.PI / 180;
    return Math.abs(Math.cos(angle)) >= Math.abs(Math.sin(angle)) ? 'x' : 'z';
}

function hasCardinalRoad(nodeAt, x, z) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dz]) => {const node=nodeAt(x+dx,z+dz);return Boolean(node&&!node.road?.authored_route);});
}

export function roadConnectsAt(nodeAt, x, z, dx, dz) {
    const from = nodeAt(x, z);
    const to = nodeAt(x + dx, z + dz);
    if (!from || !to) return false;
    const names = ROAD_DIRECTIONS[`${dx},${dz}`];
    if (names && from.road?.manual_connections?.includes(names[0])
        && to.road?.manual_connections?.includes(names[1])) return true;
    const fromDirections = from.road?.connections;
    const toDirections = to.road?.connections;
    if (Array.isArray(fromDirections) || Array.isArray(toDirections)) {
        return Boolean(names && (!dx || !dz) && (!Array.isArray(fromDirections) || fromDirections.includes(names[0]))
            && (!Array.isArray(toDirections) || toDirections.includes(names[1])));
    }
    if (from.legacyDirections || to.legacyDirections) {
        return Boolean(names && (!dx || !dz) && (!from.legacyDirections || from.legacyDirections.has(names[0]))
            && (!to.legacyDirections || to.legacyDirections.has(names[1])));
    }
    const oldSide=(x,z)=>{const node=nodeAt(x,z);return node?.road?.authored_route?null:node;};
    const sideA = dx && dz ? oldSide(x + dx, z) : null;
    const sideB = dx && dz ? oldSide(x, z + dz) : null;
    if (!roadConnects(from, to, sideA, sideB)) return false;
    if (!dx || !dz) {
        if (from.settlement || to.settlement) return true;
        const axis = dx ? 'x' : 'z';
        return roadAxisAt(nodeAt, x, z) === axis
            || roadAxisAt(nodeAt, x + dx, z + dz) === axis;
    }
    // Two adjacent straight roads must not acquire diagonal rungs either.
    return !hasCardinalRoad(nodeAt, x, z)
        || !hasCardinalRoad(nodeAt, x + dx, z + dz);
}
