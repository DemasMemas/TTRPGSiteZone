const DEFAULT_DIMENSIONS = {
    wall: { width: 3, depth: 0.2, height: 2.4 },
    door: { width: 0.9, depth: 0.18, height: 2 },
    window: { width: 1.2, depth: 0.14, height: 1 },
    floor: { width: 2, depth: 2, height: 0.12 },
};

export const STOREY_HEIGHT = 2.4;

export function structureLevel(object) {
    const level = Number(object?.properties?.level);
    return Number.isInteger(level) && level > 0 ? level : 0;
}

export function structureLevelOffset(object) {
    return structureLevel(object) * STOREY_HEIGHT;
}

export function structureBuildingId(object) {
    const id = object?.properties?.building_id;
    return id == null ? null : String(id).trim() || null;
}

export function sameBuildingLevel(a, b) {
    return structureLevel(a) === structureLevel(b)
        && structureBuildingId(a) === structureBuildingId(b);
}

export function nextStoreyFloors(source, objects) {
    if (source?.type !== 'floor') return { error: 'Выберите пол первого этажа' };
    const buildingId = structureBuildingId(source);
    if (!buildingId) return { error: 'Сначала назначьте ID старому зданию и его элементам' };
    if (structureLevel(source) !== 0) return { error: 'Пока поддерживаются только два этажа' };
    const floors = (objects || []).filter(object => object.type === 'floor'
        && structureBuildingId(object) === buildingId);
    const upper = floors.filter(object => structureLevel(object) === 1);
    const sameFootprint = (a, b) => {
        const p = structurePose(a);
        const q = structurePose(b);
        return Math.abs(p.x - q.x) < 0.001 && Math.abs(p.z - q.z) < 0.001
            && Math.abs(p.width - q.width) < 0.001 && Math.abs(p.depth - q.depth) < 0.001
            && Math.abs(p.angle - q.angle) < 0.001;
    };
    const lower = floors.filter(object => structureLevel(object) === 0);
    const missing = lower.filter((object, index) => !upper.some(other => sameFootprint(object, other))
        && !lower.slice(0, index).some(other => sameFootprint(object, other)));
    if (!missing.length) return { error: 'Перекрытие второго этажа уже существует' };
    return { objects: missing.map(floor => ({
        name: floor.name || 'floor', type: 'floor', tile_x: floor.tile_x, tile_y: floor.tile_y,
        properties: { ...floor.properties, building_id: buildingId, level: 1,
            dimensions: floor.properties?.dimensions ? { ...floor.properties.dimensions } : undefined },
    })) };
}

export function structurePose(object) {
    const properties = object?.properties || {};
    const dimensions = { ...(DEFAULT_DIMENSIONS[object?.type] || DEFAULT_DIMENSIONS.wall), ...(properties.dimensions || {}) };
    const angle = Number(properties.rotation || 0);
    return {
        x: Number(object?.tile_x || 0) + 0.5 + Number(properties.offset_x || 0),
        z: Number(object?.tile_y || 0) + 0.5 + Number(properties.offset_z || 0),
        angle,
        axis: { x: Math.cos(angle), z: -Math.sin(angle) },
        normal: { x: Math.sin(angle), z: Math.cos(angle) },
        width: Number(dimensions.width),
        depth: Number(dimensions.depth),
        height: Number(dimensions.height),
    };
}

export function floorVisualPose(object, objects) {
    const pose = structurePose(object);
    const wallGap = 0.01;
    let minAlong = -pose.width / 2;
    let maxAlong = pose.width / 2;
    let minAcross = -pose.depth / 2;
    let maxAcross = pose.depth / 2;
    for (const wall of objects || []) {
        if (wall.type !== 'wall' || !sameBuildingLevel(object, wall)) continue;
        const edge = structurePose(wall);
        const dx = edge.x - pose.x;
        const dz = edge.z - pose.z;
        const along = dx * pose.axis.x + dz * pose.axis.z;
        const across = dx * pose.normal.x + dz * pose.normal.z;
        const parallel = Math.abs(edge.axis.x * pose.axis.x + edge.axis.z * pose.axis.z);
        if (parallel >= 0.98 && edge.width >= pose.width * 0.5
            && Math.abs(Math.abs(across) - pose.depth / 2) <= 0.2) {
            if (across < 0) minAcross = Math.max(minAcross, across + edge.depth / 2 + wallGap);
            else maxAcross = Math.min(maxAcross, across - edge.depth / 2 - wallGap);
        } else if (parallel <= 0.02 && edge.width >= pose.depth * 0.5
            && Math.abs(Math.abs(along) - pose.width / 2) <= 0.2) {
            if (along < 0) minAlong = Math.max(minAlong, along + edge.depth / 2 + wallGap);
            else maxAlong = Math.min(maxAlong, along - edge.depth / 2 - wallGap);
        }
    }
    const shiftAlong = (minAlong + maxAlong) / 2;
    const shiftAcross = (minAcross + maxAcross) / 2;
    return {
        ...pose,
        x: pose.x + shiftAlong * pose.axis.x + shiftAcross * pose.normal.x,
        z: pose.z + shiftAlong * pose.axis.z + shiftAcross * pose.normal.z,
        width: maxAlong - minAlong,
        depth: maxAcross - minAcross,
    };
}

export function floorEntrancePoint(pose, objects, floor = null) {
    const halfWidth = pose.width / 2;
    const halfDepth = pose.depth / 2;
    for (const object of objects || []) {
        if (object?.type !== 'door' || (floor && !sameBuildingLevel(floor, object))) continue;
        const door = structurePose(object);
        const dx = door.x - pose.x;
        const dz = door.z - pose.z;
        const along = dx * pose.axis.x + dz * pose.axis.z;
        const across = dx * pose.normal.x + dz * pose.normal.z;
        if (Math.abs(along) > halfWidth + 0.5 || Math.abs(across) > halfDepth + 0.5) continue;
        if (Math.min(Math.abs(Math.abs(along) - halfWidth),
            Math.abs(Math.abs(across) - halfDepth)) > 0.5) continue;
        return [Math.max(-halfWidth, Math.min(halfWidth, along)),
            Math.max(-halfDepth, Math.min(halfDepth, across))];
    }
    return null;
}

export function doorOnWall(door, wall) {
    if (!sameBuildingLevel(door, wall)) return null;
    const a = structurePose(wall);
    const b = structurePose(door);
    const parallel = Math.abs(a.axis.x * b.axis.x + a.axis.z * b.axis.z);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const along = dx * a.axis.x + dz * a.axis.z;
    const away = Math.abs(dx * a.normal.x + dz * a.normal.z);
    const wallElevation = Number(wall.properties?.elevation || 0);
    const doorElevation = Number(door.properties?.elevation || 0);
    const bottom = doorElevation - wallElevation;
    if ((door.type === 'window' ? bottom < 0 || bottom + b.height > a.height + 0.15 : Math.abs(bottom) > 0.15)
        || parallel < 0.94 || away > (a.depth + b.depth) / 2 + 0.12
        || Math.abs(along) > (a.width + b.width) / 2) return null;
    return { along, width: b.width, height: b.height, bottom };
}

export function doorFrameStyle(door, objects) {
    const doorPose = structurePose(door);
    const wall = (objects || []).find(item => item?.type === 'wall' && doorOnWall(door, item));
    if (!wall) {
        return { inWall: false, height: doorPose.height + 0.12,
            depth: doorPose.depth + 0.08, bottom: 0, color: '#4e3829' };
    }
    const wallPose = structurePose(wall);
    return {
        inWall: true,
        height: wallPose.height,
        depth: wallPose.depth + 0.04,
        bottom: Number(wall.properties?.elevation || 0) - Number(door.properties?.elevation || 0),
        color: wall.properties?.color || '#aa8866',
    };
}

export function doorTrimLayout(width, height, frame, jamb = 0.09) {
    const openingHeight = frame.inWall ? Math.min(height, frame.bottom + frame.height) : height;
    const baseY = frame.inWall ? Math.max(0, frame.bottom) : 0;
    const inset = frame.inWall ? 0.006 : 0;
    return {
        baseY,
        postX: frame.inWall ? width / 2 - jamb / 2 - inset : width / 2 + jamb / 2,
        postHeight: frame.inWall ? openingHeight - baseY : frame.height,
        postY: frame.inWall ? (baseY + openingHeight) / 2 : frame.bottom + frame.height / 2,
        lintelWidth: frame.inWall ? width : width + 2 * jamb,
        lintelY: frame.inWall ? openingHeight - 0.06 - inset : frame.bottom + frame.height - 0.06,
        pivotX: frame.inWall ? -width / 2 + jamb + 0.01 : -width / 2,
        panelWidth: frame.inWall ? Math.max(0.05, width - 2 * jamb - 0.02) : width,
        panelHeight: frame.inWall ? Math.max(0.05, openingHeight - baseY - 0.13) : height,
    };
}

export function houseWallWear(x, y, start, end, openings = []) {
    const fade = (distance, range) => Math.max(0, 1 - distance / range);
    const base = 0.055 * fade(y, 0.7);
    const corner = 0.025 * fade(Math.min(x - start, end - x), 0.7);
    let entrance = 0;
    for (const opening of openings) {
        if (opening.bottom > 0.15 || opening.top < 1.4) continue;
        const edge = Math.min(Math.abs(x - opening.start), Math.abs(x - opening.end));
        entrance = Math.max(entrance, fade(edge, 0.75) * fade(y, 1.8));
    }
    return Math.max(0.85, 1 - base - corner - 0.045 * entrance);
}

function intersection(a, b) {
    const determinant = a.axis.x * b.axis.z - a.axis.z * b.axis.x;
    if (Math.abs(determinant) < 0.4) return null;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return {
        onA: (dx * b.axis.z - dz * b.axis.x) / determinant,
        onB: (dx * a.axis.z - dz * a.axis.x) / determinant,
    };
}

function wallTakesOuterCorner(wall, other, a, b) {
    const horizontalDifference = Math.abs(a.axis.x) - Math.abs(b.axis.x);
    if (Math.abs(horizontalDifference) > 0.1) return horizontalDifference > 0;
    return String(wall.id ?? '') < String(other.id ?? '');
}

export function wallVisualPlan(wall, objects) {
    const pose = structurePose(wall);
    let start = -pose.width / 2;
    let end = pose.width / 2;
    for (const other of objects || []) {
        if (other === wall || other?.type !== 'wall' || !sameBuildingLevel(wall, other)
            || (wall.id != null && other.id === wall.id)) continue;
        const otherPose = structurePose(other);
        const meeting = intersection(pose, otherPose);
        if (!meeting || Math.abs(Math.abs(meeting.onA) - pose.width / 2) > 0.7
            || Math.abs(Math.abs(meeting.onB) - otherPose.width / 2) > 0.7) continue;
        const sign = meeting.onA >= 0 ? 1 : -1;
        const outer = wallTakesOuterCorner(wall, other, pose, otherPose);
        const adjusted = meeting.onA + sign * (outer ? otherPose.depth / 2 : -otherPose.depth / 2);
        if (sign > 0) end = Math.min(end + 0.7, adjusted);
        else start = Math.max(start - 0.7, adjusted);
    }
    if (end - start < 0.1) { start = -pose.width / 2; end = pose.width / 2; }
    const openings = (objects || []).filter(item => ['door', 'window'].includes(item?.type))
        .map(door => doorOnWall(door, wall))
        .filter(Boolean)
        .map(opening => ({
            start: Math.max(start, opening.along - opening.width / 2),
            end: Math.min(end, opening.along + opening.width / 2),
            bottom: Math.max(0, opening.bottom),
            top: Math.min(pose.height, opening.bottom + opening.height),
        }))
        .filter(opening => opening.end - opening.start > 0.1)
        .sort((a, b) => a.start - b.start);
    const spans = [];
    let cursor = start;
    for (const opening of openings) {
        if (opening.start > cursor + 0.01) spans.push({ start: cursor, end: opening.start, bottom: 0, top: pose.height });
        if (opening.bottom > 0.01) spans.push({ start: opening.start, end: opening.end, bottom: 0, top: opening.bottom });
        if (opening.top < pose.height - 0.01) spans.push({ start: opening.start, end: opening.end, bottom: opening.top, top: pose.height });
        cursor = Math.max(cursor, opening.end);
    }
    if (cursor < end - 0.01) spans.push({ start: cursor, end, bottom: 0, top: pose.height });
    return { pose, spans, openings };
}
