const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function loadWaterDetail() {
    const grassUrl = url(read('locationGrassDetail.js'));
    const edgeUrl = url(read('locationWaterEdge.js'));
    return import(url(read('locationWaterDetail.js')
        .replace("'./locationGrassDetail.js'", `'${grassUrl}'`)
        .replace("'./locationWaterEdge.js'", `'${edgeUrl}'`)));
}

test('water details follow the dominant shore and remain deterministic', async () => {
    const { waterDetailPlacements } = await loadWaterDetail();
    const tiles = Array.from({ length: 18 }, () => Array.from({ length: 18 }, () => (
        { terrain: 'water', height: 1 }
    )));
    const regions = kind => new Map(tiles.flatMap((row, z) => row.map((_, x) => [`${x},${z}`, kind])));
    const swamp = waterDetailPlacements(tiles, regions('swamp'));
    assert.deepEqual(swamp, waterDetailPlacements(tiles, regions('swamp')));
    assert.ok(swamp.film.length > 20);
    assert.ok(swamp.reeds.length > 15);
    assert.ok(swamp.branches.length > 5);
    assert.equal(swamp.stones.length, 0);
    assert.equal(swamp.rebar.length, 0);

    const rock = waterDetailPlacements(tiles, regions('rock'));
    assert.ok(rock.film.length > 15);
    assert.ok(rock.stones.length > 10);
    assert.ok(rock.rebar.length > 5);
    assert.equal(rock.reeds.length, 0);
    assert.equal(rock.branches.length, 0);
    for (const kind of ['grass', 'sand']) {
        assert.ok(Object.values(waterDetailPlacements(tiles, regions(kind)))
            .every(items => items.length === 0));
    }
    assert.match(read('locationWaterDetail.js'), /new THREE\.InstancedMesh\(createGeometry\(\), createMaterial\(\), items\.length\)/);
    assert.match(read('locationWaterDetail.js'), /makeReedGeometry\(THREE\)/);
});

test('swamp film is split into tonal islands rather than one flat decal', async () => {
    const { createWaterDetailGroup, waterDetailPlacements } = await loadWaterDetail();
    const tiles = Array.from({ length: 12 }, () => Array.from({ length: 12 }, () => (
        { terrain: 'water', height: 1 }
    )));
    const regions = new Map(tiles.flatMap((row, z) => row.map((_, x) => [`${x},${z}`, 'swamp'])));
    class Geometry {
        constructor() { this.attributes = {}; }
        setAttribute(name, attribute) { this.attributes[name] = attribute; }
        computeVertexNormals() {}
    }
    class Color {
        constructor(hex = 0xffffff) { this.setHex(hex); }
        setHex(hex) {
            this.r = ((hex >> 16) & 255) / 255;
            this.g = ((hex >> 8) & 255) / 255;
            this.b = (hex & 255) / 255;
            return this;
        }
    }
    class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
    class InstancedMesh extends Mesh {
        constructor(geometry, material) { super(geometry, material); this.instanceMatrix = {}; this.instanceColor = {}; }
        setMatrixAt() {}
        setColorAt() {}
    }
    const THREE = {
        Group: class { constructor() { this.children = []; this.userData = {}; } add(child) { this.children.push(child); } },
        BufferGeometry: Geometry,
        Float32BufferAttribute: class { constructor(array) { this.array = array; } },
        MeshStandardMaterial: class { constructor(options) { Object.assign(this, options); } },
        CylinderGeometry: Geometry, IcosahedronGeometry: Geometry,
        Object3D: class {
            constructor() {
                this.position = { set() {}, y: 0 };
                this.rotation = { set() {}, x: 0 };
                this.scale = { set() {}, setScalar() {} };
            }
            updateMatrix() { this.matrix = {}; }
        },
        Color, Mesh, InstancedMesh, DoubleSide: 2,
    };
    const group = createWaterDetailGroup(THREE, tiles, regions);
    const film = group.children.find(child => child.constructor === Mesh);
    assert.ok(film);
    const patches = waterDetailPlacements(tiles, regions).film.length;
    assert.equal(film.geometry.attributes.position.array.length, patches * 3 * 9 * 9);
    const values = film.geometry.attributes.color.array;
    const shades = new Set();
    for (let index = 0; index < values.length; index += 3) {
        shades.add(values.slice(index, index + 3).join(','));
    }
    assert.ok(shades.size >= 4);
    const heights = new Set(film.geometry.attributes.position.array.filter((_, index) => index % 3 === 1));
    assert.ok(heights.size > 2);
});
