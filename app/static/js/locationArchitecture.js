const DEFAULT_DIMENSIONS = {
    wall: { width: 3, depth: 0.2, height: 2.4 },
    door: { width: 0.9, depth: 0.18, height: 2 },
    window: { width: 1.2, depth: 0.14, height: 1 },
    floor: { width: 2, depth: 2, height: 0.12 },
};

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
        if (wall.type !== 'wall') continue;
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

export function doorOnWall(door, wall) {
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
        if (other === wall || other?.type !== 'wall' || (wall.id != null && other.id === wall.id)) continue;
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
