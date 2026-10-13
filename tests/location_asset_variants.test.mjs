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
