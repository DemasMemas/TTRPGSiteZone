import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

class TextureLoader {
    load(url, onLoad) { onLoad({ url, disposals:0, dispose(){this.disposals++;} }); }
}

class Vector3 {
    fromBufferAttribute(attribute, index) {
        this.x = attribute.getX(index);
        this.y = attribute.getY(index);
        this.z = attribute.getZ(index);
        return this;
    }
}

const context = vm.createContext({ console });
const three = new vm.SyntheticModule(['TextureLoader', 'Vector3', 'RepeatWrapping', 'sRGBEncoding'], function () {
    this.setExport('TextureLoader', TextureLoader);
    this.setExport('Vector3', Vector3);
    this.setExport('RepeatWrapping', 'repeat');
    this.setExport('sRGBEncoding', 'srgb');
}, { context });
const source = await readFile(new URL('../app/static/js/locationPbrMaterials.js', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(source, { context });
await module.link(specifier => {
    assert.equal(specifier, 'three');
    return three;
});
await module.evaluate();
const { alignLocationPbrFloorUvs, applyLocationPbrMaterial, releaseLocationPbrMaterial, releaseLocationPbrTextures,
    tileLocationPbrBoxUvs } = module.namespace;

test('PBR texture slots use color sRGB and share the packed ARM map', async () => {
    const material = { userData: {}, color: { set(value) { this.value = value; } } };
    assert.equal(applyLocationPbrMaterial(material, {
        color: '/color.jpg', normal: '/normal.jpg', arm: '/arm.jpg',
    }), true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(material.color.value, 0xffffff);
    assert.equal(material.map.encoding, 'srgb');
    assert.equal(material.normalMap.url, '/normal.jpg');
    assert.equal(material.aoMap, material.roughnessMap);
    assert.equal(material.roughnessMap, material.metalnessMap);
    assert.equal(material.map.wrapS, 'repeat');
    releaseLocationPbrMaterial(material);
    assert.equal(material.userData.pbrActive, false);
});

test('PBR box UVs repeat by physical dimensions without changing base UV2 references', () => {
    const coords = Array.from({ length: 24 }, () => [1, 1]);
    const uv = {
        count: 24,
        getX(index) { return coords[index][0]; },
        getY(index) { return coords[index][1]; },
        setXY(index, u, v) { coords[index] = [u, v]; },
        clone() { return { values: coords.map(value => [...value]) }; },
    };
    const geometry = { attributes: { uv }, setAttribute(name, value) { this.attributes[name] = value; } };
    tileLocationPbrBoxUvs(geometry, 4, 2, 0.2);
    assert.equal(coords[0][0], 0.1);
    assert.equal(coords[0][1], 1);
    assert.equal(coords[16][0], 2);
    assert.equal(coords[16][1], 1);
    assert.notEqual(geometry.attributes.uv2, uv);
});

test('scene exit releases cached GPU texture listeners while reopening reuses loaded images',async()=>{
    const create=()=>({userData:{},color:{set(){}}}),maps={color:'/exit-color.jpg',normal:'/exit-normal.jpg',arm:'/exit-arm.jpg'};
    const first=create();applyLocationPbrMaterial(first,maps);
    await new Promise(resolve=>setImmediate(resolve));
    releaseLocationPbrMaterial(first);releaseLocationPbrTextures();
    await new Promise(resolve=>setImmediate(resolve));
    for(const texture of [first.map,first.normalMap,first.aoMap])assert.equal(texture.disposals,1);
    const reopened=create();applyLocationPbrMaterial(reopened,maps);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reopened.map,first.map);assert.equal(reopened.aoMap,first.aoMap);
    assert.equal(reopened.userData.pbrActive,true);
    releaseLocationPbrMaterial(reopened);
});

test('neighboring PBR floors share the same UV phase at their world-space edge', () => {
    const makeTile = (centerX, localX) => {
        const values = [];
        const geometry = {
            attributes: {
                position: { count: 1, getX() { return localX; }, getY() { return 0; }, getZ() { return 0; } },
                normal: { getY() { return 1; } },
                uv: { setXY(_index, u, v) { values.push([u, v]); }, clone() { return {}; } },
            },
            setAttribute(name, value) { this.attributes[name] = value; },
        };
        alignLocationPbrFloorUvs(geometry, { localToWorld(point) { point.x += centerX; return point; } });
        assert.ok(geometry.attributes.uv2);
        return values[0];
    };
    assert.deepEqual(makeTile(0.5, 0.5), makeTile(1.5, -0.5));
    assert.deepEqual(makeTile(0.5, 0.5), [0.5, 0]);
});
