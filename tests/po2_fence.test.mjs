import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const file = '../app/static/models/art/';
const geometry = JSON.parse(fs.readFileSync(new URL(`${file}po2_section.json`, import.meta.url)));
const { position, normal, uv } = geometry.data.attributes;

test('PO-2 has bounded real two-sided relief, closed ends and a small vertex budget', () => {
    assert.equal(position.array.length / 9, 240);
    assert.equal(normal.array.length, position.array.length);
    assert.equal(uv.array.length / 2, position.array.length / 3);
    const bounds = [0,1,2].map(axis => {
        const values = position.array.filter((_,i) => i%3 === axis);
        return [Math.min(...values), Math.max(...values)];
    });
    assert.deepEqual(bounds, [[-.07,.07],[-.25,.25],[-.4,.4]]);
    assert.ok(new Set(position.array.filter((_,i) => i%3 === 0)).size >= 6, 'actual relief depth, not a flat face');
    assert.ok(normal.array.filter((_,i) => i%3 === 0).some(n => n > .5 && n < .99), 'sloping front facets');
    assert.ok(normal.array.filter((_,i) => i%3 === 0).some(n => n < -.5 && n > -.99), 'sloping back facets');
    assert.ok(uv.array.every(n => n >= 0 && n <= 1));
    for (let i=0;i<position.array.length;i+=9) {
        const a=position.array.slice(i,i+3), b=position.array.slice(i+3,i+6), c=position.array.slice(i+6,i+9);
        const ab=b.map((n,j)=>n-a[j]), ac=c.map((n,j)=>n-a[j]);
        const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
        assert.ok(cross.reduce((sum,n,j)=>sum+n*normal.array[i+j],0) > 0, 'winding agrees with normal');
    }
});

test('CC0 texture is preserved byte for byte; runtime keeps instancing and saved fence ID', () => {
    const hash = p => crypto.createHash('sha256').update(fs.readFileSync(new URL(p, import.meta.url))).digest('hex');
    assert.equal(hash(`${file}po2_concrete.png`), hash('../assets/sources/opengameart/po2/original/model/medicsubsta_zaborclear.png'));
    const source=fs.readFileSync(new URL('../app/static/js/lobby3d.js',import.meta.url),'utf8');
    assert.match(source,/new THREE.InstancedMesh\(fenceGeo, fenceMat, fenceCount\)/);
    assert.match(source,/case 'fence': return fenceGeo/);
    assert.match(source,/type === 'fence' \? fenceMat.clone\(\)/);
    assert.equal(geometry.userData.sectionPitch, .8);
    assert.equal(geometry.userData.license, 'CC0');
});
