function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clipPolygon(polygon, axis, boundary, keepGreater) {
    if (!polygon.length) return [];
    const clipped = [];
    let previous = polygon.at(-1);
    let previousInside = keepGreater ? previous[axis] >= boundary : previous[axis] <= boundary;
    for (const current of polygon) {
        const currentInside = keepGreater ? current[axis] >= boundary : current[axis] <= boundary;
        if (currentInside !== previousInside) {
            const fraction = (boundary - previous[axis]) / (current[axis] - previous[axis]);
            clipped.push([
                previous[0] + fraction * (current[0] - previous[0]),
                previous[1] + fraction * (current[1] - previous[1]),
            ]);
        }
        if (currentInside) clipped.push(current);
        previous = current;
        previousInside = currentInside;
    }
    return clipped;
}

export function anomalyCoversTile(object, originX, originY, tileX, tileY) {
    const databaseObject = object.tile_x !== undefined;
    const properties = object.properties || {};
    const dimensions = databaseObject ? properties.dimensions : (object.dimensions || properties.dimensions);
    const scale = !databaseObject && !dimensions ? finiteNumber(object.scale, 1) : 1;
    const width = finiteNumber(Array.isArray(dimensions) ? dimensions[0] : dimensions?.width, scale);
    const depth = finiteNumber(Array.isArray(dimensions) ? dimensions[1] : dimensions?.depth, scale);
    if (width <= 0 || depth <= 0) return false;
    const centerX = originX + 0.5 + finiteNumber(databaseObject ? properties.offset_x : object.x, 0);
    const centerY = originY + 0.5 + finiteNumber(databaseObject ? properties.offset_z : object.z, 0);
    const angle = finiteNumber(databaseObject ? properties.rotation : object.rotation, 0)
        * (databaseObject ? 1 : Math.PI / 180);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    let polygon = [
        [-width / 2, -depth / 2], [width / 2, -depth / 2],
        [width / 2, depth / 2], [-width / 2, depth / 2],
    ].map(([x, y]) => [centerX + x * cosine - y * sine, centerY + x * sine + y * cosine]);
    for (const [axis, boundary, greater] of [
        [0, tileX, true], [0, tileX + 1, false], [1, tileY, true], [1, tileY + 1, false],
    ]) {
        polygon = clipPolygon(polygon, axis, boundary, greater);
        if (!polygon.length) return false;
    }
    const area = Math.abs(polygon.reduce((sum, [x, y], index) => {
        const next = polygon[(index + 1) % polygon.length];
        return sum + x * next[1] - y * next[0];
    }, 0)) / 2;
    return area >= 0.75 - 1e-9;
}
