"""Ground footprint of a placed anomaly, in location tile coordinates."""

import math


def _finite_number(value, default):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _clip_polygon(polygon, axis, boundary, keep_greater):
    if not polygon:
        return []
    clipped = []
    previous = polygon[-1]
    previous_inside = (previous[axis] >= boundary) if keep_greater else (previous[axis] <= boundary)
    for current in polygon:
        current_inside = (current[axis] >= boundary) if keep_greater else (current[axis] <= boundary)
        if current_inside != previous_inside:
            fraction = (boundary - previous[axis]) / (current[axis] - previous[axis])
            clipped.append((
                previous[0] + fraction * (current[0] - previous[0]),
                previous[1] + fraction * (current[1] - previous[1]),
            ))
        if current_inside:
            clipped.append(current)
        previous, previous_inside = current, current_inside
    return clipped


def anomaly_covers_tile(obj, origin_x, origin_y, tile_x, tile_y):
    """Whether at least 75% of a tile lies under the anomaly's rotated footprint."""
    is_tile_object = isinstance(obj, dict)
    properties = (obj.get('properties') if is_tile_object else obj.properties) or {}
    dimensions = properties.get('dimensions') if not is_tile_object else obj.get('dimensions', properties.get('dimensions'))
    if isinstance(dimensions, (list, tuple)):
        width = dimensions[0] if len(dimensions) > 0 else None
        depth = dimensions[1] if len(dimensions) > 1 else None
    elif isinstance(dimensions, dict):
        width, depth = dimensions.get('width'), dimensions.get('depth')
    else:
        width = depth = None
    scale = _finite_number(obj.get('scale'), 1) if is_tile_object and dimensions is None else 1
    width = _finite_number(width, scale)
    depth = _finite_number(depth, scale)
    if width <= 0 or depth <= 0:
        return False

    offset_x = obj.get('x') if is_tile_object else properties.get('offset_x')
    offset_y = obj.get('z') if is_tile_object else properties.get('offset_z')
    center_x = origin_x + 0.5 + _finite_number(offset_x, 0)
    center_y = origin_y + 0.5 + _finite_number(offset_y, 0)
    rotation = obj.get('rotation') if is_tile_object else properties.get('rotation')
    angle = _finite_number(rotation, 0)
    if is_tile_object:
        angle = math.radians(angle)
    cosine, sine = math.cos(angle), math.sin(angle)
    polygon = [
        (center_x + x * cosine - y * sine, center_y + x * sine + y * cosine)
        for x, y in ((-width / 2, -depth / 2), (width / 2, -depth / 2),
                     (width / 2, depth / 2), (-width / 2, depth / 2))
    ]
    for axis, boundary, greater in ((0, tile_x, True), (0, tile_x + 1, False),
                                    (1, tile_y, True), (1, tile_y + 1, False)):
        polygon = _clip_polygon(polygon, axis, boundary, greater)
        if not polygon:
            return False
    area = abs(sum(
        x * polygon[(index + 1) % len(polygon)][1] - y * polygon[(index + 1) % len(polygon)][0]
        for index, (x, y) in enumerate(polygon)
    )) / 2
    return area >= 0.75 - 1e-9
