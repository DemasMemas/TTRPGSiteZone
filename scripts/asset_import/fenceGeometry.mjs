import { compactPrimitive } from '@gltf-transform/functions';

export function primitiveComponents(primitive) {
    const positions = primitive.getAttribute('POSITION');
    const indices = primitive.getIndices()?.getArray();
    if (!positions || !indices) throw new Error('Fence filtering requires indexed positions');
    const parent = Array.from({ length: positions.getCount() }, (_, index) => index);
    const find = index => {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    };
    const union = (a, b) => { parent[find(a)] = find(b); };
    const welded = new Map();
    const point = [];
    for (let index = 0; index < parent.length; index++) {
        positions.getElement(index, point);
        const key = point.map(value => Math.round(value * 100000)).join(',');
        if (welded.has(key)) union(index, welded.get(key));
        else welded.set(key, index);
    }
    for (let index = 0; index < indices.length; index += 3) {
        union(indices[index], indices[index + 1]);
        union(indices[index], indices[index + 2]);
    }
    const components = new Map();
    for (let index = 0; index < indices.length; index += 3) {
        const key = find(indices[index]);
        if (!components.has(key)) components.set(key, {
            indices: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
        });
        const component = components.get(key);
        for (const vertex of indices.slice(index, index + 3)) {
            component.indices.push(vertex);
            positions.getElement(vertex, point);
            for (let axis = 0; axis < 3; axis++) {
                component.min[axis] = Math.min(component.min[axis], point[axis]);
                component.max[axis] = Math.max(component.max[axis], point[axis]);
            }
        }
    }
    return [...components.values()];
}

export function filterFenceComponents(doc, rule) {
    let removed = 0;
    const node = doc.getRoot().listNodes().find(item => item.getName() === rule.node);
    if (!node?.getMesh()) throw new Error(`Fence section missing: ${rule.node}`);
    for (const mesh of [node.getMesh()]) {
        for (const primitive of mesh.listPrimitives()) {
            if (primitive.getMaterial()?.getName() !== rule.material) continue;
            const components = primitiveComponents(primitive);
            const retained = components.filter(component => {
                const size = component.max.map((value, axis) => value - component.min[axis]);
                const upright = size[1] >= rule.minVerticalHeight;
                const remove = !upright;
                if (remove) removed++;
                return !remove;
            });
            if (!retained.length) throw new Error('Fence filter would remove all solid geometry');
            primitive.getIndices().setArray(new Uint32Array(retained.flatMap(component => component.indices)));
            compactPrimitive(primitive);
        }
    }
    if (!removed) throw new Error('Fence filter did not match the inspected rail components');
    return removed;
}
