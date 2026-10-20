const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const asUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

async function modules() {
    const architectureUrl = asUrl(read('locationArchitecture.js'));
    const [house, architecture, roof, catalog] = await Promise.all([
        import(asUrl(read('locationHouseGenerator.js'))),
        import(architectureUrl),
        import(asUrl(read('locationRoof.js').replace(
            "from './locationArchitecture.js'", `from '${architectureUrl}'`))),
        import(asUrl(read('locationAssetCatalog.js'))),
    ]);
    return { house, architecture, roof, catalog };
}

function reachable(rooms, connections) {
    const visited = new Set(['outside']);
    let changed = true;
    while (changed) {
        changed = false;
        for (const [from, to] of connections) {
            if (visited.has(from) && !visited.has(to)) {
                visited.add(to);
                changed = true;
            }
            if (visited.has(to) && !visited.has(from)) {
                visited.add(from);
                changed = true;
            }
        }
    }
    assert.ok(rooms.every(room => visited.has(room.id)));
    for (const privateRoom of rooms.filter(room => ['bedroom', 'bathroom'].includes(room.id))) {
        assert.equal(connections.filter(link => link.includes(privateRoom.id)).length, 1);
    }
}

test('small, medium and large houses have reachable terminal private rooms and valid openings', async () => {
    const { house, architecture, roof } = await modules();
    for (let width = 4; width <= 12; width++) for (let depth = 4; depth <= 12; depth++) {
        const expectedRooms = width >= 7 && depth >= 7 && width * depth >= 48 ? 5
            : width >= 6 && depth >= 5 && width * depth >= 30 ? 3 : 2;
        for (const seed of ['0', '1']) {
            const plan = house.planResidentialHouse({
                minX: 2, minZ: 3, width, depth, seed, buildingId: 'house-test',
            });
            assert.equal(plan.error, undefined);
            assert.equal(plan.rooms.length, expectedRooms);
            reachable(plan.rooms, plan.connections);
            assert.equal(plan.connections.length, plan.objects.filter(object => object.type === 'door').length);
            assert.equal(plan.objects.filter(object => object.type === 'floor').length, 1);
            assert.equal(roof.roofPlans(plan.objects, () => 0).length, 1);
            for (const object of plan.objects) {
                assert.equal(object.properties.building_id, 'house-test');
                assert.equal(object.properties.level, 0);
                assert.ok(object.tile_x >= 2 && object.tile_x < 2 + width);
                assert.ok(object.tile_y >= 3 && object.tile_y < 3 + depth);
                if (['door', 'window'].includes(object.type)) {
                    const matches = plan.objects.filter(wall => wall.type === 'wall'
                        && architecture.doorOnWall(object, wall));
                    assert.equal(matches.length, 1, `${width}×${depth} ${seed}: ${object.name}`);
                }
            }
            assert.deepEqual(
                JSON.parse(JSON.stringify(plan.objects)),
                JSON.parse(JSON.stringify(house.planResidentialHouse({
                    minX: 2, minZ: 3, width, depth, seed, buildingId: 'house-test',
                }).objects)),
            );
        }
    }
});

test('drag direction and seed produce stable footprints, IDs and JSON-saveable objects', async () => {
    const { house } = await modules();
    const footprint = house.houseFootprint(9, 8, 2, 3);
    assert.deepEqual(footprint, { minX: 2, minZ: 3, width: 8, depth: 6 });
    const id = house.houseBuildingId(17, footprint, 'perimeter');
    assert.equal(id, house.houseBuildingId(17, footprint, 'perimeter'));
    assert.notEqual(id, house.houseBuildingId(17, footprint, 'other'));
    const plan = house.planResidentialHouse({ ...footprint, seed: 'perimeter', buildingId: id });
    assert.equal(plan.objects[0].properties.generation_seed, 'perimeter');
    assert.deepEqual(JSON.parse(JSON.stringify(plan.objects)).length, plan.objects.length);
    assert.ok(house.planResidentialHouse({
        minX: 0, minZ: 0, width: 3, depth: 4, buildingId: id,
    }).error);
});

test('a generated floor is restorable exactly from saved wall metadata, without replacing the house', async () => {
    const { house, architecture, roof } = await modules();
    const plan = house.planResidentialHouse({ minX: 2, minZ: 3, width: 8, depth: 7,
        seed: 'home', buildingId: 'house-restore' });
    const saved = JSON.parse(JSON.stringify(plan.objects));
    const original = saved.find(object => object.type === 'floor');
    assert.equal(house.restorableGeneratedFloor(saved, 'house-restore', 0), null);
    const withoutFloor = saved.filter(object => object !== original);
    const restored = house.restorableGeneratedFloor(withoutFloor, 'house-restore', 0);
    assert.deepEqual(restored, original);
    assert.deepEqual(architecture.floorVisualPose(restored, withoutFloor),
        architecture.floorVisualPose(original, saved));
    assert.equal(roof.roofPlans([...withoutFloor, restored], () => 0).length, 1);
    assert.equal(withoutFloor.length, saved.length - 1);
    assert.equal(house.restorableGeneratedFloor([...withoutFloor, restored], 'house-restore', 0), null);
    assert.equal(house.restorableGeneratedFloor(withoutFloor, 'house-restore', 1), null);
    assert.equal(house.restorableGeneratedFloor(withoutFloor, 'other-house', 0), null);
    const oldHouse = JSON.parse(JSON.stringify(withoutFloor));
    delete oldHouse[0].properties.generated_floor_spec;
    assert.equal(house.restorableGeneratedFloor(oldHouse, 'house-restore', 0), null);
});

test('fitting a resized generated floor recovers its saved footprint without replacing rooms', async () => {
    const { house, architecture } = await modules();
    const plan = house.planResidentialHouse({ minX: 2, minZ: 3, width: 8, depth: 7,
        seed: 'fit', buildingId: 'house-fit' });
    const floor = plan.objects.find(object => object.type === 'floor');
    const altered = { ...floor, properties: { ...floor.properties,
        dimensions: { ...floor.properties.dimensions, width: 3, depth: 3 } } };
    const objects = plan.objects.map(object => object === floor ? altered : object);
    const blueprint = house.generatedFloorBlueprint(objects, 'house-fit', 0);
    const fitted = architecture.floorFitPlan(altered, objects, blueprint);
    assert.equal(fitted.error, undefined);
    assert.equal(fitted.pose.width, 8);
    assert.equal(fitted.pose.depth, 7);
    assert.equal(objects.length, plan.objects.length);
});

test('the restore action creates only one ordinary floor and refuses a second restore', async () => {
    const { house } = await modules();
    const plan = house.planResidentialHouse({ minX: 1, minZ: 1, width: 7, depth: 7,
        seed: 'again', buildingId: 'house-action' });
    const data = { objects: JSON.parse(JSON.stringify(plan.objects.filter(object => object.type !== 'floor'))) };
    const sceneSource = read('locationScene.js');
    const start = sceneSource.indexOf('export function canRestoreGeneratedLocationFloor(');
    const end = sceneSource.indexOf('function createPosterMesh(', start);
    assert.ok(start > 0 && end > start);
    const created = [];
    const context = vm.createContext({
        currentLocationData: data, currentLocationId: 5, houseFloorRestorePending: false, houseSceneEpoch: 1,
        window: { currentLobbyId: 9 }, restorableGeneratedFloor: house.restorableGeneratedFloor,
        Server: { createLocationObject: async (lobby, location, spec) => {
            assert.equal(lobby, 9);
            assert.equal(location, 5);
            created.push(spec);
            return { ...spec, id: 101 };
        } },
        addLocationObject: object => data.objects.push(object), showNotification() {},
    });
    vm.runInContext(sceneSource.slice(start, end).replaceAll('export ', ''), context);
    assert.equal(context.canRestoreGeneratedLocationFloor('house-action', 0), true);
    assert.equal(await context.restoreGeneratedLocationFloor('house-action', 0), true);
    assert.equal(await context.restoreGeneratedLocationFloor('house-action', 0), false);
    assert.equal(created.length, 1);
    assert.equal(data.objects.filter(object => object.type === 'floor').length, 1);
    assert.equal(data.objects.length, plan.objects.length);
});

test('catalog furniture stays inside its room, clear of doorways and other furniture', async () => {
    const { house, architecture, catalog } = await modules();
    for (let width = 4; width <= 12; width++) for (let depth = 4; depth <= 12; depth++) {
        for (const seed of ['0', '1']) {
            const options = { minX: 2, minZ: 3, width, depth, seed, buildingId: 'house-test',
                assetById: catalog.findLocationAsset };
            const plan = house.planResidentialHouse(options);
            const furniture = plan.objects.filter(object => ['table', 'chair', 'shelf'].includes(object.type));
            assert.ok(furniture.length > 0);
            assert.ok(furniture.some(object => object.type === 'table'));
            const doors = plan.objects.filter(object => object.type === 'door');
            for (const item of furniture) {
                const pose = architecture.structurePose(item);
                const room = plan.rooms.find(entry => pose.x > entry.bounds.minX
                    && pose.x < entry.bounds.maxX && pose.z > entry.bounds.minZ
                    && pose.z < entry.bounds.maxZ);
                assert.ok(room, `furniture outside rooms: ${item.name}`);
                assert.ok(pose.x - pose.width / 2 >= room.bounds.minX + 0.25 - 1e-6);
                assert.ok(pose.x + pose.width / 2 <= room.bounds.maxX - 0.25 + 1e-6);
                assert.ok(pose.z - pose.depth / 2 >= room.bounds.minZ + 0.25 - 1e-6);
                assert.ok(pose.z + pose.depth / 2 <= room.bounds.maxZ - 0.25 + 1e-6);
                for (const door of doors) {
                    const at = architecture.structurePose(door);
                    assert.ok(Math.abs(pose.x - at.x) >= pose.width / 2 + 0.75
                        || Math.abs(pose.z - at.z) >= pose.depth / 2 + 0.75);
                }
                for (const other of furniture) {
                    if (other === item) continue;
                    const at = architecture.structurePose(other);
                    assert.ok(Math.abs(pose.x - at.x) >= (pose.width + at.width) / 2 + 0.1 - 1e-6
                        || Math.abs(pose.z - at.z) >= (pose.depth + at.depth) / 2 + 0.1 - 1e-6);
                }
            }
            assert.deepEqual(plan.objects, house.planResidentialHouse(options).objects);
        }
    }
});

test('house draw uses the existing editor pointer and object persistence paths', () => {
    const scene = read('locationScene.js');
    const main = read('main.js');
    assert.match(scene, /houseDrawStart = \{ \.\.\.hoveredTileCoords \}/);
    assert.match(scene, /void createResidentialHouse\(start, end\)/);
    assert.match(scene, /Server\.createLocationObject\(lobbyId, locationId, spec\)/);
    assert.match(scene, /Server\.getLocationDetail\(lobbyId, locationId\)/);
    assert.match(scene, /Server\.deleteLocationObject\(lobbyId, object\.id\)/);
    assert.match(main, /data-house-draw/);
    assert.match(main, /setLocationHouseDrawMode\(enabled\)/);
});
