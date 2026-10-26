import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
const files = ['locationImportedAssets.js', 'locationAssetCatalog.js', 'locationAssetVariants.js'];
const modules = new Map();
for (const file of files) {
    const source = await readFile(new URL(`../app/static/js/${file}`, import.meta.url), 'utf8');
    modules.set(file, new vm.SourceTextModule(source, { context }));
}
const variants = modules.get('locationAssetVariants.js');
await variants.link(specifier => modules.get(specifier.replace('./', '')));
await variants.evaluate();
const { placementForLocationAsset, visualAssetForLocationObject } = variants.namespace;
const { findLocationAsset } = modules.get('locationAssetCatalog.js').namespace;

test('replacement furniture keeps both generations of saved IDs and original dimensions', () => {
    for (const [canonical, alias, model, oldSize, newSize] of [
        ['table', 'household_dining_table', 'dining_table', [1.4,.8,1], [1.25,.75,.76]],
        ['chair', 'household_wood_chair', 'wood_chair', [.55,.55,1], [.45,.48,.88]],
    ]) {
        const original = findLocationAsset(canonical), replacement = findLocationAsset(alias);
        assert.equal(original.visual.family, 'household');
        assert.equal(original.visual.modelId, model);
        assert.deepEqual(Array.from(original.dimensions), oldSize);
        assert.deepEqual(Array.from(replacement.dimensions), newSize);
        assert.equal(replacement.hidden, true);
        for (const id of [canonical, alias]) {
            assert.equal(visualAssetForLocationObject(id, {}).id, id);
            assert.equal(placementForLocationAsset(findLocationAsset(id)).type, id);
        }
    }
});

test('plumbing is a separate category and leaves the kitchen sink available', () => {
    const assets = modules.get('locationAssetCatalog.js').namespace.LOCATION_ASSETS;
    assert.equal(assets.filter(a => a.group === 'Сантехника' && !a.hidden).length, 3);
    for (const id of ['household_washbasin', 'household_toilet', 'household_bathtub']) {
        assert.equal(findLocationAsset(id).group, 'Сантехника');
        assert.equal(findLocationAsset(id).visual.pivot, 'bottom-center');
    }
    assert.equal(findLocationAsset('household_sink').group, 'Кухня и быт');
});

test('artistic variants keep the existing gameplay type and stable visual id', () => {
    for (const [id, type] of [
        ['art_rusty_barrel', 'barrel'],
        ['art_wooden_crate', 'box'],
        ['art_chainlink_fence', 'fence'],
        ['art_worn_plaster', 'wall'],
        ['art_dirty_earth', 'floor'],
    ]) {
        const asset = findLocationAsset(id);
        assert.ok(asset, id);
        const placement = placementForLocationAsset(asset);
        assert.equal(placement.type, type);
        assert.equal(placement.visualAsset, id);
        assert.equal(visualAssetForLocationObject(type, { visual_asset: id }).id, id);
    }
});

test('unknown or mismatched variant falls back to the original asset', () => {
    assert.equal(visualAssetForLocationObject('box', { visual_asset: 'art_rusty_barrel' }).id, 'box');
    assert.equal(visualAssetForLocationObject('box', { visual_asset: 'missing' }).id, 'box');
    assert.equal(visualAssetForLocationObject('box', {}).id, 'box');
    assert.equal(placementForLocationAsset(findLocationAsset('box')).visualAsset, null);
});
