const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/static/js/combatMenuPresentation.js'), 'utf8');
const modulePromise = import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
// Read the real server catalog without initializing Flask or touching a database.
const venvPython = path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const result = spawnSync(process.env.PYTHON || (fs.existsSync(venvPython) ? venvPython : 'python'), ['-c',
    "import ast,json,pathlib; tree=ast.parse(pathlib.Path('app/services/combat.py').read_text(encoding='utf-8')); print(json.dumps(next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='ACTION_CATALOG' for t in n.targets))))"], {cwd:root,encoding:'utf8'});
assert.equal(result.status, 0, result.stderr);
const catalog = JSON.parse(result.stdout);
async function view(item, extra = {}) {
    const {combatMenuPresentation} = await modulePromise;
    return combatMenuPresentation({item, catalog, actor:{action_points_current:5,free_actions_current:1,movement_points_current:0},
        active:true,controlled:true,currentTurn:true,condition:{state:'active'},allowed:true,...extra});
}
test('fixed menu prices agree with the server catalog and resource shortages disable actions', async () => {
    for (const actionKey of ['console_ally','place_gunpoint','gunpoint_shot','escape_anomaly','must_do_it','recover_from_shock']) {
        const action = catalog.find(a=>a.key===actionKey);
        const result = await view({actionKey});
        assert.equal(result.cost, actionKey==='must_do_it'?'1 стресс':`${action.action_points} ОД`);
        const empty = await view({actionKey}, {actor:{action_points_current:0,free_actions_current:0,movement_points_current:0}});
        assert.equal(empty.allowed, action.action_points===0);
        if(action.action_points>0) assert.match(empty.reason,/Недостаточно ресурсов/);
    }
});
test('OP conversion uses alternative prices, preferring SD, and never demands both', async () => {
    const item={actionKey:'convert_free_action_to_movement'};
    assert.equal((await view(item)).cost,'1 СД');
    assert.equal((await view(item,{actor:{action_points_current:2,free_actions_current:0}})).cost,'2 ОД');
    assert.equal((await view(item,{actor:{action_points_current:0,free_actions_current:1}})).allowed,true);
    const empty=await view(item,{actor:{action_points_current:1,free_actions_current:0}});
    assert.equal(empty.allowed,false); assert.equal(empty.tooltipCost,'1 СД или 2 ОД');
});
test('variable selectors remain accessible without claiming a free or fixed price', async () => {
    for(const key of ['movement','attack','medical','posture','facing','interaction','melee','gunpoint','narrative','help']) {
        const result=await view({key},{actor:{action_points_current:0,free_actions_current:0,movement_points_current:0}});
        assert.equal(result.allowed,true,key); assert.ok(result.detail); assert.equal(result.cost,'');
    }
});
test('disabled explanations distinguish permissions, turn, combat and pain recovery', async () => {
    assert.match((await view({}, {allowed:false,controlled:false})).reason,/разрешения/);
    assert.match((await view({}, {allowed:false,currentTurn:false})).reason,/другого персонажа/);
    assert.match((await view({requiresCombat:true}, {allowed:false,active:false})).reason,/только в бою/);
    const pain=await view({actionKey:'recover_from_shock'}, {condition:{state:'pain_shock',can_recover:false}});
    assert.equal(pain.allowed,false); assert.match(pain.reason,/боль/);
    assert.match(pain.detail,/завершает ход/);
});
test('reaction reserve requires resources, while help supports deferred OD payment', async () => {
    const empty={actor:{action_points_current:0,free_actions_current:0,movement_points_current:0}};
    assert.equal((await view({key:'reaction'},empty)).allowed,false);
    assert.equal((await view({key:'help'},empty)).allowed,true);
    assert.equal((await view({key:'reserved_reaction'},empty)).allowed,true);
    assert.equal((await view({key:'help'},{reactionInProgress:true})).allowed,false);
});
test('a missing catalog never presents an unknown price as zero', async () => {
    assert.equal((await view({actionKey:'console_ally'},{catalog:[]})).cost,'Уточняется');
});

test('compact tooltips explain the effect without duplicating the visible price', async () => {
    const comfort=await view({actionKey:'console_ally',title:'Помочь союзнику справиться со стрессом.'});
    assert.equal(comfort.cost,'3 ОД');assert.doesNotMatch(comfort.detail,/3 ОД/);assert.equal(comfort.tooltipCost,'');
    const convert=await view({actionKey:'convert_free_action_to_movement',title:'Добавить очки перемещения.'});
    assert.equal(convert.tooltipCost,'1 СД или 2 ОД');assert.doesNotMatch(convert.detail,/СД|ОД/);
    const repeat=await view({actionKey:'must_do_it',title:'Ручной повтор по разрешению ведущего.',conditions:'Осталось попыток: 1/1.'});
    assert.equal(repeat.cost,'1 стресс');assert.doesNotMatch(repeat.detail,/Должен это сделать|стресс|Стоимость/);
    assert.match(repeat.detail,/Осталось попыток: 1\/1/);
});
