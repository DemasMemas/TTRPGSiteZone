const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../app/static/js'),url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const shared=url(fs.readFileSync(path.join(root,'locationEditorHistory.js'),'utf8'));
const source=fs.readFileSync(path.join(root,'worldEditorHistory.js'),'utf8');
const load=()=>import(url(`import {copy,equal} from '${shared}';`+source.slice(source.indexOf('const sessions'),source.indexOf('export function initWorldEditorHistory'))));
const cell=(before,after,x=31)=>({chunk_x:0,chunk_y:0,tile_x:x,tile_y:8,before,after});
const value=n=>({present:true,value:n}),absent={present:false};
test('a repeated stroke keeps first snapshots, final values and exact field absence',async()=>{
    const {mergeWorldCommands}=await load();
    const commands=[{cells:[cell({height:value(1),radiation:absent},{height:value(1.125),radiation:value(.125)})]},
        {cells:[cell({height:value(1.125)},{height:value(1.234567)}),cell({terrain:value('grass')},{terrain:value('sand')},30)]}];
    const original=structuredClone(commands),result=mergeWorldCommands(commands);
    assert.equal(result.cells.length,2);assert.deepEqual(result.cells[0].before,{height:value(1),radiation:absent});
    assert.deepEqual(result.cells[0].after,{height:value(1.234567),radiation:value(.125)});
    result.cells[0].after.height.value=3;assert.deepEqual(commands,original);
});
test('a stroke returning to its initial state contributes no undo entry',async()=>{
    const {mergeWorldCommands}=await load();
    assert.deepEqual(mergeWorldCommands([{cells:[cell({height:value(1)},{height:value(2)})]},
        {cells:[cell({height:value(2)},{height:value(1)})]}]),{objects:[],tiles:[],cells:[]});
});
