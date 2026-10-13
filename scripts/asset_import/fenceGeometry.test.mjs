import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { primitiveComponents } from './fenceGeometry.mjs';

test('assembled fence retains cutout mesh and posts without tube rails or brackets', async () => {
    const doc = await new NodeIO().registerExtensions(KHRONOS_EXTENSIONS)
        .read(fileURLToPath(new URL('../../app/static/models/art/art_chainlink_fence.glb', import.meta.url)));
    const nodes = doc.getRoot().listNodes();
    const panel = nodes.find(node => node.getName() === 'modular_chainlink_fence_double');
    const wire = panel.getMesh().listPrimitives().find(primitive => primitive.getMaterial().getName().endsWith('_wire'));
    assert.equal(wire.getMaterial().getAlphaMode(), 'BLEND');
    const solid = panel.getMesh().listPrimitives().find(primitive => primitive !== wire);
    const components = primitiveComponents(solid);
    assert.equal(components.length, 2);
    for (const component of components) {
        const size = component.max.map((value, axis) => value - component.min[axis]);
        assert.ok(size[1] >= 2);
    }
    const left = nodes.find(node => node.getName() === 'fence_post_left');
    const right = nodes.find(node => node.getName() === 'fence_post_right');
    assert.deepEqual(left.getTranslation(), [-2, 0, 0]);
    assert.deepEqual(right.getTranslation(), [0, 0, 0]);
    assert.equal(left.getMesh(), right.getMesh());
});
