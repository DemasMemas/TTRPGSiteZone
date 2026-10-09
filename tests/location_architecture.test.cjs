const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '../app/static/js', name), 'utf8');
const load = async name => import(`data:text/javascript;base64,${Buffer.from(read(name)).toString('base64')}`);

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

test('door frame follows its wall height and color while its panel stays separate', async () => {
    const { doorFrameStyle } = await load('locationArchitecture.js');
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
    door.properties.elevation = 0.1;
    assert.ok(Math.abs(doorFrameStyle(door, [wall]).bottom + 0.1) < 1e-8);
    wall.properties.color = '#9c654f';
    assert.equal(doorFrameStyle(door, [wall]).color, '#9c654f');
    door.properties.offset_z = 1;
    const standalone = doorFrameStyle(door, [wall]);
    assert.equal(standalone.inWall, false);
    assert.equal(standalone.color, '#4e3829');
    const scene = read('locationScene.js');
    assert.match(scene, /const frame = doorFrameStyle\(obj, currentLocationData\?\.objects \|\| \[\]\)/);
    assert.match(scene, /new THREE\.MeshStandardMaterial\(\{ color: frame\.color \}\)/);
    assert.match(scene, /new THREE\.BoxGeometry\(jamb, frame\.height, frame\.depth\)/);
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
