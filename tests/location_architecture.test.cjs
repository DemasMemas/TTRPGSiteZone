const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const load = async name => import(`data:text/javascript;base64,${Buffer.from(read(name)).toString('base64')}`);

test('floor fit follows a complete rotated wall contour on the selected level', async () => {
    const { floorFitPlan, floorVisualPose, structurePose } = await load('locationArchitecture.js');
    const make = (type, x, z, width, depth, angle, level = 1) => {
        const tileX = Math.floor(x);
        const tileZ = Math.floor(z);
        return { type, tile_x: tileX, tile_y: tileZ, properties: {
            building_id: 'fit-house', level, rotation: angle,
            offset_x: x - tileX - 0.5, offset_z: z - tileZ - 0.5,
            dimensions: { width, depth, height: type === 'floor' ? 0.12 : 2.4 },
        } };
    };
    for (const angle of [0, Math.PI / 4]) {
        const cx = 10;
        const cz = 12;
        const axis = { x: Math.cos(angle), z: -Math.sin(angle) };
        const normal = { x: Math.sin(angle), z: Math.cos(angle) };
        const at = (along, across) => ({ x: cx + along * axis.x + across * normal.x,
            z: cz + along * axis.z + across * normal.z });
        const walls = [
            ...[-3, 3].map(across => {
                const point = at(0, across);
                return make('wall', point.x, point.z, 8, 0.2, angle);
            }),
            ...[-4, 4].map(along => {
                const point = at(along, 0);
                return make('wall', point.x, point.z, 6, 0.2, angle + Math.PI / 2);
            }),
        ];
        const floor = make('floor', cx, cz, 3, 2, angle);
        const result = floorFitPlan(floor, [...walls, floor,
            make('wall', 30, 30, 20, 0.2, angle, 0)]);
        assert.equal(result.error, undefined);
        assert.ok(Math.abs(result.pose.x - cx) < 1e-8);
        assert.ok(Math.abs(result.pose.z - cz) < 1e-8);
        assert.ok(Math.abs(result.pose.width - 8) < 1e-8);
        assert.ok(Math.abs(result.pose.depth - 6) < 1e-8);
        const adjusted = make('floor', result.pose.x, result.pose.z,
            result.pose.width, result.pose.depth, result.pose.angle);
        const visual = floorVisualPose(adjusted, [...walls, adjusted]);
        assert.ok(visual.width > 7.7 && visual.width < 8);
        assert.ok(visual.depth > 5.7 && visual.depth < 6);
        assert.equal(structurePose(floor).height, 0.12);
    }
});

test('floor fit rejects multiple floor segments and incomplete or nonrectangular borders', async () => {
    const { floorFitPlan } = await load('locationArchitecture.js');
    const obj = (type, x, z, width, rotation = 0) => ({ type,
        tile_x: Math.floor(x), tile_y: Math.floor(z), properties: {
            building_id: 'safe-house', level: 0, rotation,
            offset_x: x - Math.floor(x) - 0.5, offset_z: z - Math.floor(z) - 0.5,
            dimensions: { width, depth: type === 'floor' ? 3 : 0.2, height: 0.12 },
        } });
    const floor = obj('floor', 4, 4, 3);
    const walls = [obj('wall', 4, 2, 4), obj('wall', 4, 6, 4),
        obj('wall', 2, 4, 4, Math.PI / 2), obj('wall', 6, 4, 4, Math.PI / 2)];
    assert.ok(floorFitPlan(floor, [...walls, floor, obj('floor', 5, 4, 1)]).error);
    assert.ok(floorFitPlan(floor, [...walls.slice(0, 3), floor]).error);
    assert.ok(floorFitPlan(floor, [...walls.slice(0, 3),
        obj('wall', 6, 3, 2, Math.PI / 2), floor]).error);
});

test('fitting a floor persists only its geometry and retains material, elevation and building links', async () => {
    const { floorFitPlan, structureBuildingId, structureLevel, structurePose } = await load('locationArchitecture.js');
    const floor = { id: 8, type: 'floor', tile_x: 4, tile_y: 4, properties: {
        building_id: 'house', level: 0, color: '#664433', elevation: 0.35, roof_type: 'flat',
        rotation: 0, dimensions: { width: 2, depth: 2, height: 0.12 },
    } };
    const wall = (x, z, length, rotation = 0) => ({ type: 'wall', tile_x: x, tile_y: z,
        properties: { building_id: 'house', level: 0, rotation,
            offset_x: -0.5, offset_z: -0.5,
            dimensions: { width: length, depth: 0.2, height: 2.4 } } });
    const data = { grid_width: 20, grid_height: 20, objects: [floor,
        wall(4, 2, 4), wall(4, 6, 4), wall(2, 4, 4, Math.PI / 2), wall(6, 4, 4, Math.PI / 2)] };
    const sceneSource = read('locationScene.js');
    const start = sceneSource.indexOf('export function getSelectedLocationFloorFit()');
    const end = sceneSource.indexOf('export async function addFloorAboveSelectedLocationAsset()', start);
    assert.ok(start > 0 && end > start);
    let saved;
    const context = vm.createContext({ currentLocationData: data, currentLocationId: 3,
        editorSelection: { kind: 'structure', id: 8 }, editorSelections: [{ kind: 'structure', id: 8 }],
        getSelectedEditorSource: () => data.objects[0],
        floorFitPlan, generatedFloorBlueprint: () => null,
        structureBuildingId, structureLevel, structurePose,
        window: { currentLobbyId: 2, confirm: () => true },
        Server: { updateLocationObject: async (lobby, id, changes) => {
            assert.equal(lobby, 2);
            assert.equal(id, 8);
            saved = { ...floor, ...changes, properties: { ...floor.properties, ...changes.properties } };
            return saved;
        } },
        updateLocationObject: object => { data.objects[0] = object; },
        notifyEditorSelection() {}, showNotification() {},
    });
    vm.runInContext(sceneSource.slice(start, end).replaceAll('export ', ''), context);
    assert.equal(await context.fitSelectedLocationFloorToBuilding(), true);
    assert.equal(saved.properties.dimensions.width, 4);
    assert.equal(saved.properties.dimensions.depth, 4);
    assert.equal(saved.properties.color, '#664433');
    assert.equal(saved.properties.elevation, 0.35);
    assert.equal(saved.properties.roof_type, 'flat');
    assert.equal(saved.properties.building_id, 'house');
    assert.equal(saved.properties.level, 0);
    assert.equal(data.objects.length, 5);
    assert.deepEqual(JSON.parse(JSON.stringify(data.objects[0])), JSON.parse(JSON.stringify(saved)));
});

test('upper floor reuses all saved footprints and rejects duplicate or legacy floors', async () => {
    const { nextStoreyFloors, structureLevelOffset } = await load('locationArchitecture.js');
    const lower = { id: 1, name: 'floor', type: 'floor', tile_x: 4, tile_y: 6,
        properties: { building_id: 'building-a', level: 0, elevation: 0.2, roof_type: 'flat',
            rotation: Math.PI / 2, offset_x: 0.1,
            dimensions: { width: 3, depth: 4, height: 0.12 } } };
    const second = { ...lower, id: 3, tile_x: 9 };
    const result = nextStoreyFloors(lower, [lower, second]);
    assert.equal(result.error, undefined);
    assert.equal(result.objects.length, 2);
    assert.equal(result.objects[0].properties.building_id, 'building-a');
    assert.equal(result.objects[0].properties.level, 1);
    assert.equal(structureLevelOffset(result.objects[0]), 2.4);
    assert.equal(result.objects[0].properties.roof_type, 'flat');
    assert.equal(result.objects[0].properties.elevation, 0.2);
    assert.deepEqual(result.objects[0].properties.dimensions, lower.properties.dimensions);
    assert.notEqual(result.objects[0].properties.dimensions, lower.properties.dimensions);
    assert.equal(result.objects[0].tile_x, lower.tile_x);
    assert.equal(result.objects[1].tile_x, second.tile_x);
    assert.deepEqual(JSON.parse(JSON.stringify(result.objects))[0].properties,
        { ...lower.properties, level: 1 });
    assert.equal(nextStoreyFloors(lower, [lower, second, { ...result.objects[0], id: 2 }]).objects.length, 1);
    assert.ok(nextStoreyFloors(lower, [lower, second, ...result.objects]).error);
    assert.ok(nextStoreyFloors({ ...lower, properties: { ...lower.properties, building_id: undefined } }, [lower]).error);
    assert.ok(nextStoreyFloors({ ...lower, properties: { ...lower.properties, level: 1 } }, [lower]).error);
});

test('walls meet without both protruding through an outside corner', async () => {
    const { wallVisualPlan } = await load('locationArchitecture.js');
    const horizontal = { id: 1, type: 'wall', tile_x: 1, tile_y: 1,
        properties: { dimensions: { width: 2, depth: 0.2, height: 2.4 }, rotation: 0 } };
    const vertical = { id: 2, type: 'wall', tile_x: 2, tile_y: 2,
        properties: { dimensions: { width: 2, depth: 0.2, height: 2.4 }, rotation: Math.PI / 2 } };
    const horizontalPlan = wallVisualPlan(horizontal, [horizontal, vertical]);
    const verticalPlan = wallVisualPlan(vertical, [horizontal, vertical]);
    assert.equal(horizontalPlan.spans[0].end, 1.1);
    assert.ok(Math.abs(verticalPlan.spans[0].end - 0.9) < 1e-8);
});

test('aligned door cuts an opening and leaves a lintel above the frame', async () => {
    const { doorOnWall, wallVisualPlan } = await load('locationArchitecture.js');
    const wall = { id: 1, type: 'wall', tile_x: 1, tile_y: 1,
        properties: { dimensions: { width: 3, depth: 0.2, height: 2.4 }, rotation: 0 } };
    const door = { id: 2, type: 'door', tile_x: 1, tile_y: 1,
        properties: { dimensions: { width: 0.9, depth: 0.18, height: 2 }, rotation: 0 } };
    assert.ok(doorOnWall(door, wall));
    const plan = wallVisualPlan(wall, [wall, door]);
    assert.equal(plan.openings.length, 1);
    assert.equal(plan.spans.length, 3);
    assert.equal(plan.spans[1].bottom, 2);
    assert.equal(plan.spans[1].top, 2.4);
    door.properties.offset_z = 1;
    assert.equal(doorOnWall(door, wall), null);
    door.properties.offset_z = 0;
    door.properties.elevation = 2;
    assert.equal(doorOnWall(door, wall), null);
});

test('an elevated window cuts a wall between its sill and lintel', async () => {
    const { doorOnWall, wallVisualPlan } = await load('locationArchitecture.js');
    const wall = { type: 'wall', tile_x: 1, tile_y: 1,
        properties: { dimensions: { width: 3, depth: 0.2, height: 2.4 } } };
    const window = { type: 'window', tile_x: 1, tile_y: 1,
        properties: { elevation: 1, dimensions: { width: 1.2, depth: 0.14, height: 1 } } };
    assert.ok(doorOnWall(window, wall));
    const plan = wallVisualPlan(wall, [wall, window]);
    assert.ok(plan.spans.some(span => span.bottom === 0 && span.top === 1));
    assert.ok(plan.spans.some(span => span.bottom === 2 && span.top === 2.4));
    window.properties.elevation = 2;
    assert.equal(doorOnWall(window, wall), null);
});

test('building and level isolate coincident walls, openings, and upper floor boundaries', async () => {
    const { doorOnWall, floorVisualPose, sameBuildingLevel, structureLevelOffset,
        wallVisualPlan } = await load('locationArchitecture.js');
    const dimensions = { width: 3, depth: 0.2, height: 2.4 };
    const lower = { id: 1, type: 'wall', tile_x: 2, tile_y: 2,
        properties: { building_id: 'house-a', level: 0, dimensions } };
    const upper = { ...lower, id: 2, properties: { ...lower.properties, level: 1 } };
    const otherBuilding = { ...lower, id: 3, properties: { ...lower.properties, building_id: 'house-b' } };
    const upperDoor = { type: 'door', tile_x: 2, tile_y: 2,
        properties: { building_id: 'house-a', level: 1,
            dimensions: { width: 0.9, depth: 0.18, height: 2 } } };
    assert.equal(structureLevelOffset(lower), 0);
    assert.equal(structureLevelOffset(upper), 2.4);
    assert.equal(sameBuildingLevel(lower, upper), false);
    assert.equal(sameBuildingLevel(lower, otherBuilding), false);
    assert.equal(doorOnWall(upperDoor, lower), null);
    assert.ok(doorOnWall(upperDoor, upper));
    assert.equal(wallVisualPlan(lower, [lower, upperDoor]).openings.length, 0);
    assert.equal(wallVisualPlan(upper, [upper, upperDoor]).openings.length, 1);

    const upperCorner = { ...upper, id: 4, tile_x: 3, tile_y: 3,
        properties: { ...upper.properties, rotation: Math.PI / 2,
            dimensions: { ...dimensions, width: 2 } } };
    assert.deepEqual(wallVisualPlan(lower, [lower, upperCorner]).spans,
        wallVisualPlan(lower, [lower]).spans);

    const upperFloor = { type: 'floor', tile_x: 2, tile_y: 2,
        properties: { building_id: 'house-a', level: 1,
            dimensions: { width: 3, depth: 3, height: 0.12 } } };
    const upperEdge = { ...upper, id: 5, tile_y: 0,
        properties: { ...upper.properties, offset_z: 0.5 } };
    const matching = floorVisualPose(upperFloor, [upperFloor, upperEdge]);
    const mismatched = floorVisualPose(upperFloor, [upperFloor, lower,
        { ...upperEdge, properties: { ...upperEdge.properties, level: 0 } }]);
    assert.ok(matching.depth < mismatched.depth);
    assert.equal(mismatched.depth, 3);
});

test('door frame follows its wall height and color while its panel stays separate', async () => {
    const { doorFrameStyle, doorTrimLayout } = await load('locationArchitecture.js');
    const wall = { type: 'wall', tile_x: 2, tile_y: 3,
        properties: { color: '#496d73', dimensions: { width: 3, depth: 0.3, height: 3.2 } } };
    const door = { type: 'door', tile_x: 2, tile_y: 3,
        properties: { color: '#77543a', dimensions: { width: 0.9, depth: 0.18, height: 2 } } };
    const frame = doorFrameStyle(door, [door, wall]);
    assert.equal(frame.inWall, true);
    assert.equal(frame.height, 3.2);
    assert.equal(frame.color, wall.properties.color);
    assert.notEqual(frame.color, door.properties.color);
    assert.ok(frame.depth > wall.properties.dimensions.depth);
    const trim = doorTrimLayout(0.9, 2, frame);
    assert.ok(trim.postX + 0.09 / 2 < 0.45);
    assert.ok(trim.postX + 0.09 / 2 > 0.44);
    assert.equal(trim.lintelWidth, 0.9);
    assert.ok(trim.lintelY + 0.06 < 2);
    assert.ok(trim.lintelY + 0.06 > 1.99);
    assert.ok(trim.pivotX + trim.panelWidth < trim.postX - 0.09 / 2);
    assert.ok(trim.panelHeight < trim.lintelY - 0.06);
    door.properties.elevation = 0.1;
    assert.ok(Math.abs(doorFrameStyle(door, [wall]).bottom + 0.1) < 1e-8);
    door.properties.elevation = -0.1;
    const raisedWallTrim = doorTrimLayout(0.9, 2, doorFrameStyle(door, [wall]));
    assert.ok(Math.abs(raisedWallTrim.baseY - 0.1) < 1e-8);
    assert.ok(Math.abs(raisedWallTrim.postY - raisedWallTrim.postHeight / 2 - 0.1) < 1e-8);
    door.properties.elevation = 0;
    wall.properties.color = '#9c654f';
    assert.equal(doorFrameStyle(door, [wall]).color, '#9c654f');
    door.properties.offset_z = 1;
    const standalone = doorFrameStyle(door, [wall]);
    assert.equal(standalone.inWall, false);
    assert.equal(standalone.color, '#4e3829');
    const scene = read('locationScene.js');
    assert.match(scene, /const frame = doorFrameStyle\(obj, currentLocationData\?\.objects \|\| \[\]\)/);
    assert.match(scene, /new THREE\.MeshStandardMaterial\(\{ color: frame\.color \}\)/);
    assert.match(scene, /new THREE\.BoxGeometry\(jamb, trim\.postHeight, frame\.depth\)/);
});

test('house wall wear is slight and localized to the base, corners, and entrance', async () => {
    const { houseWallWear } = await load('locationArchitecture.js');
    const openings = [{ start: -0.45, end: 0.45, bottom: 0, top: 2 }];
    const clean = houseWallWear(0, 1.5, -2, 2);
    const base = houseWallWear(0, 0, -2, 2);
    const corner = houseWallWear(-2, 1.5, -2, 2);
    const entrance = houseWallWear(-0.45, 0.3, -2, 2, openings);
    assert.equal(clean, 1);
    assert.ok(base < clean && corner < clean && entrance < houseWallWear(-0.45, 0.3, -2, 2));
    assert.ok(Math.min(base, corner, entrance) >= 0.85);
});

test('interior floor finds a nearby doorway without including distant doors', async () => {
    const { floorEntrancePoint } = await load('locationArchitecture.js');
    const pose = { x: 0, z: 0, width: 4, depth: 4,
        axis: { x: 1, z: 0 }, normal: { x: 0, z: 1 } };
    const door = { type: 'door', tile_x: 0, tile_y: 1,
        properties: { offset_x: -0.5, offset_z: 0.6 } };
    assert.deepEqual(floorEntrancePoint(pose, [door]), [0, 2]);
    door.tile_y = 8;
    assert.equal(floorEntrancePoint(pose, [door]), null);
});

test('the visual sandbox has joined outer corners and three wall-mounted doors', async () => {
    const { doorOnWall, wallVisualPlan } = await load('locationArchitecture.js');
    const wall = (x, z, width, rotation = 0, offsetX = 0, offsetZ = 0) => ({
        type: 'wall', tile_x: x, tile_y: z,
        properties: { rotation, offset_x: offsetX, offset_z: offsetZ,
            dimensions: { width, depth: 0.2, height: 2.5 } },
    });
    const pi2 = Math.PI / 2;
    const walls = [
        wall(9, 3, 13, 0, 0.5), wall(9, 14, 13, 0, 0.5),
        wall(3, 8, 11, pi2, 0, 0.5), wall(16, 8, 11, pi2, 0, 0.5),
        wall(14, 24, 8), wall(14, 30, 8),
        wall(10, 27, 6, pi2), wall(18, 27, 6, pi2),
    ];
    const doors = [
        { type: 'door', tile_x: 9, tile_y: 14, properties: { dimensions: { width: 0.9, depth: 0.18, height: 2.1 } } },
        { type: 'door', tile_x: 16, tile_y: 9, properties: { rotation: pi2, dimensions: { width: 0.9, depth: 0.18, height: 2.1 } } },
        { type: 'door', tile_x: 14, tile_y: 24, properties: { dimensions: { width: 0.9, depth: 0.18, height: 2.1 } } },
    ];
    for (const door of doors) assert.equal(walls.filter(item => doorOnWall(door, item)).length, 1);
    assert.equal(wallVisualPlan(walls[3], [...walls, ...doors]).openings.length, 1);
    assert.ok(wallVisualPlan(walls[0], walls).spans[0].end > 6.5);
    assert.ok(wallVisualPlan(walls[2], walls).spans[0].end <= 5.5);
});

test('a floor ends before the inner faces of matching walls without shrinking beside unrelated walls', async () => {
    const { floorVisualPose } = await load('locationArchitecture.js');
    const floor = { type: 'floor', tile_x: 9, tile_y: 8,
        properties: { offset_x: 0.5, offset_z: 0.5,
            dimensions: { width: 13, depth: 11, height: 0.12 } } };
    const wall = (x, z, width, rotation = 0, offsetX = 0, offsetZ = 0) => ({
        type: 'wall', tile_x: x, tile_y: z,
        properties: { rotation, offset_x: offsetX, offset_z: offsetZ,
            dimensions: { width, depth: 0.2, height: 2.5 } },
    });
    const walls = [
        wall(9, 3, 13, 0, 0.5), wall(9, 14, 13, 0, 0.5),
        wall(3, 8, 11, Math.PI / 2, 0, 0.5), wall(16, 8, 11, Math.PI / 2, 0, 0.5),
    ];
    const pose = floorVisualPose(floor, [floor, ...walls]);
    assert.ok(Math.abs(pose.width - 12.78) < 1e-8);
    assert.ok(Math.abs(pose.depth - 10.78) < 1e-8);
    assert.equal(pose.x, 10);
    assert.equal(pose.z, 9);
    assert.ok(pose.x - pose.width / 2 > 3.6);
    assert.ok(pose.x + pose.width / 2 < 16.4);
    assert.ok(pose.z - pose.depth / 2 > 3.6);
    assert.ok(pose.z + pose.depth / 2 < 14.4);
    assert.equal(floorVisualPose(floor, [floor, wall(25, 25, 13)]).width, 13);
    assert.equal(floorVisualPose(floor, [floor]).depth, 11);
});

test('road joins cardinally or at 45 degrees, and passes beneath a settlement', async () => {
    const { roadNode, roadConnects, roadConnectsAt } = await load('worldRoadTopology.js');
    const road = roadNode({ objects: [{ type: 'road' }] });
    const village = roadNode({ objects: [{ type: 'village' }] });
    assert.equal(roadConnects(road, village), true);
    assert.equal(roadConnects(village, road), true);
    assert.equal(roadConnects(village, village), false);
    assert.equal(roadConnects(road, road, null, null), true);
    assert.equal(roadConnects(road, road, road, null), false);
    const nodes = new Map([['0,0', road], ['1,1', road]]);
    const nodeAt = (x, z) => nodes.get(`${x},${z}`) || null;
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 1), true);
    nodes.set('1,0', road);
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 1), false);
    const scene = read('lobby3d.js');
    assert.match(scene, /rebuildRoadMeshes\(entry\)/);
    assert.match(scene, /refreshRoadNeighborhood\(cx, cy\)/);
});

test('parallel neighboring road lines do not turn into a ladder', async () => {
    const { roadNode, roadConnectsAt } = await load('worldRoadTopology.js');
    const road = roadNode({ objects: [{ type: 'road' }] });
    const horizontal = new Map();
    const vertical = new Map();
    for (let position = 0; position < 6; position++) {
        for (let lane = 0; lane < 2; lane++) {
            horizontal.set(`${position},${lane}`, road);
            vertical.set(`${lane},${position}`, road);
        }
    }
    const horizontalAt = (x, z) => horizontal.get(`${x},${z}`) || null;
    const verticalAt = (x, z) => vertical.get(`${x},${z}`) || null;
    for (let position = 0; position < 5; position++) {
        assert.equal(roadConnectsAt(horizontalAt, position, 0, 1, 0), true);
        assert.equal(roadConnectsAt(verticalAt, 0, position, 0, 1), true);
        assert.equal(roadConnectsAt(horizontalAt, position, 0, 0, 1), false);
        assert.equal(roadConnectsAt(verticalAt, 0, position, 1, 0), false);
        assert.equal(roadConnectsAt(horizontalAt, position, 0, 1, 1), false);
        assert.equal(roadConnectsAt(verticalAt, 0, position, 1, 1), false);
    }
});

test('manual road links override automatic junction filtering without changing other exits', async () => {
    const { roadNode, roadConnectsAt } = await load('worldRoadTopology.js');
    const roads = new Map();
    for (let x = 0; x < 4; x++) {
        roads.set(`${x},0`, { type: 'road', connections: ['E', 'W'] });
        roads.set(`${x},1`, { type: 'road', connections: ['E', 'W'] });
    }
    const nodeAt = (x, z) => roads.has(`${x},${z}`)
        ? roadNode({ objects: [roads.get(`${x},${z}`)] }) : null;
    assert.equal(roadConnectsAt(nodeAt, 1, 0, 0, 1), false);
    roads.get('1,0').manual_connections = ['S'];
    roads.get('1,1').manual_connections = ['N'];
    assert.equal(roadConnectsAt(nodeAt, 1, 0, 0, 1), true);
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 0), true);
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 1), false);
    roads.get('0,0').manual_connections = ['SE'];
    roads.get('1,1').manual_connections.push('NW');
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 1), true);
});

test('new authored neighbours preserve legacy diagonal connections and do not create rungs',async()=>{
    const {roadNode,roadConnectsAt,roadSurfaceHeight}=await load('worldRoadTopology.js');
    const old=roadNode({objects:[{type:'road'}]}),fresh=roadNode({objects:[{type:'road',authored_route:true,connections:['E','W']}]});
    const nodes=new Map([['0,0',old],['1,1',old]]),at=(x,z)=>nodes.get(`${x},${z}`);
    assert.equal(roadConnectsAt(at,0,0,1,1),true);
    nodes.set('1,0',fresh);nodes.set('0,1',fresh);
    assert.equal(roadConnectsAt(at,0,0,1,1),true);
    assert.equal(roadConnectsAt(at,0,0,0,1),false);
    assert.equal(roadSurfaceHeight({height:0},{}),.06);
    assert.equal(roadSurfaceHeight({height:.4},{bridge:true,bridge_height:1.2}),1.2);
});

test('a corner and a T junction keep their deliberate side links', async () => {
    const { roadNode, roadConnectsAt } = await load('worldRoadTopology.js');
    const road = roadNode({ objects: [{ type: 'road' }] });
    const corner = new Map([['0,0', road], ['1,0', road], ['1,1', road], ['1,2', road]]);
    const cornerAt = (x, z) => corner.get(`${x},${z}`) || null;
    assert.equal(roadConnectsAt(cornerAt, 0, 0, 1, 0), true);
    assert.equal(roadConnectsAt(cornerAt, 1, 0, 0, 1), true);
    const junction = new Map([['0,1', road], ['1,1', road], ['2,1', road], ['1,2', road], ['1,3', road]]);
    const junctionAt = (x, z) => junction.get(`${x},${z}`) || null;
    assert.equal(roadConnectsAt(junctionAt, 0, 1, 1, 0), true);
    assert.equal(roadConnectsAt(junctionAt, 1, 1, 1, 0), true);
    assert.equal(roadConnectsAt(junctionAt, 1, 1, 0, 1), true);
});

test('bases and factories continue roads, while stored route edges reject accidental shoreline links', async () => {
    const { roadNode, roadConnectsAt } = await load('worldRoadTopology.js');
    for (const type of ['factory', 'base']) {
        const nodes = new Map([
            ['0,0', roadNode({ objects: [{ type: 'road', connections: ['E'] }] })],
            ['1,0', roadNode({ objects: [{ type }] })],
        ]);
        const nodeAt = (x, z) => nodes.get(`${x},${z}`) || null;
        assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 0), true);
    }
    const nodes = new Map([
        ['0,0', roadNode({ objects: [{ type: 'road', connections: ['E'] }] })],
        ['1,0', roadNode({ objects: [{ type: 'road', connections: ['W'] }] })],
        ['0,1', roadNode({ objects: [{ type: 'road', connections: ['E'] }] })],
        ['1,1', roadNode({ objects: [{ type: 'road', connections: ['W'] }] })],
    ]);
    const nodeAt = (x, z) => nodes.get(`${x},${z}`) || null;
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 0), true);
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 0, 1), false);
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 1), false);
});

test('legacy generated road segments keep their stored axis beside water', async () => {
    const { roadNode, roadConnectsAt } = await load('worldRoadTopology.js');
    const horizontal = roadNode({ objects: [{ type: 'road', scale: 1.1,
        color: '#756f61', rotation: 0 }] });
    const vertical = roadNode({ objects: [{ type: 'road', scale: 1.1,
        color: '#756f61', rotation: 90 }] });
    const nodes = new Map([['0,0', horizontal], ['1,0', horizontal], ['0,1', vertical]]);
    const nodeAt = (x, z) => nodes.get(`${x},${z}`) || null;
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 0), true);
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 0, 1), false);
    assert.equal(roadConnectsAt(nodeAt, 0, 0, 1, 1), false);
});
