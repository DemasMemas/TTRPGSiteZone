import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../app/static/js/worldRoadTool.js',import.meta.url),'utf8');
const {createWorldRoadTool}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const pause=()=>new Promise(r=>setTimeout(r,10));
function fixture(overrides={}){
    const requests=[],saves=[],shown=[],messages=[];
    const tool=createWorldRoadTool({delay:0,settings:()=>({scale:1,color:'#756f61'}),bridges:()=>false,
        request:async data=>{requests.push(data);return {path:data.waypoints,signature:'guard',reused:0,bridges:0};},
        save:async data=>saves.push(data),preview:p=>shown.push(p),clearPreview(){},status:m=>messages.push(m),notify:m=>messages.push(m),...overrides});
    return {tool,requests,saves,shown,messages};
}
test('hover is read-only and construction uses the clicked endpoint',async()=>{
    const f=fixture();f.tool.click([1,1]);f.tool.hover([8,1]);await pause();
    assert.equal(f.saves.length,0);assert.deepEqual(f.requests.at(-1).waypoints,[[1,1],[8,1]]);
    assert.equal(await f.tool.click([5,1]),true);assert.deepEqual(f.saves[0].waypoints,[[1,1],[5,1]]);assert.equal(f.saves[0].signature,'guard');
});
test('cancel never writes; water endpoints rejected',async()=>{
    const f=fixture();assert.equal(f.tool.click([2,2],true),false);assert.equal(f.tool.active,false);
    f.tool.click([1,1]);f.tool.hover([5,1]);f.tool.cancel();await pause();
    assert.equal(f.requests.length,0);assert.equal(f.saves.length,0);assert.equal(f.tool.active,false);
});
test('stale asynchronous preview is discarded after cancellation',async()=>{
    let resolve;const f=fixture({request:()=>new Promise(r=>{resolve=r;})});
    f.tool.click([1,1]);f.tool.hover([5,1]);await pause();f.tool.cancel();resolve({path:[],signature:'old'});await pause();
    assert.equal(f.shown.length,0);
});
test('preview requests coalesce while an older request is running',async()=>{
    const jobs=[];const f=fixture({request:data=>new Promise(resolve=>jobs.push({data,resolve}))});
    f.tool.click([1,1]);f.tool.hover([5,1]);await pause();f.tool.hover([7,1]);await pause();f.tool.hover([9,1]);await pause();
    assert.equal(jobs.length,1);jobs[0].resolve({path:[],signature:'old'});await pause();
    assert.equal(jobs.length,2);assert.deepEqual(jobs[1].data.waypoints,[[1,1],[9,1]]);
    jobs[1].resolve({path:[],signature:'new'});await pause();assert.equal(f.shown.at(-1).signature,'new');
});
test('conflict refreshes preview but requires another explicit confirmation',async()=>{
    let writes=0;const f=fixture({save:async()=>{writes++;throw Object.assign(new Error('changed'),{status:409});}});
    f.tool.click([1,1]);assert.equal(await f.tool.click([5,1]),false);
    assert.equal(writes,1);assert.equal(f.tool.active,true);assert.equal(f.tool.saving,false);assert.equal(f.shown.length,2);
    f.tool.cancel();
});
test('bridge option reaches the guarded save unchanged',async()=>{
    const f=fixture({bridges:()=>true});f.tool.click([1,1]);await f.tool.click([8,4]);
    assert.equal(f.saves[0].allow_bridges,true);assert.deepEqual(f.saves[0].waypoints,[[1,1],[8,4]]);
});
test('leaving the tool during confirmation does not restore preview or create a late build',async()=>{
    let resolve;const f=fixture({request:()=>new Promise(r=>resolve=r)});
    f.tool.click([1,1]);const confirmation=f.tool.click([5,1]);
    f.tool.cancel();resolve({path:[],signature:'late'});assert.equal(await confirmation,false);
    assert.equal(f.saves.length,0);assert.equal(f.shown.length,0);assert.equal(f.tool.active,false);
});
test('two clicks build a segment and subsequent clicks continue from the last endpoint',async()=>{
    const f=fixture();f.tool.click([1,1]);assert.equal(await f.tool.click([5,1]),true);
    assert.equal(f.tool.active,true);assert.deepEqual(f.saves[0].waypoints,[[1,1],[5,1]]);
    await f.tool.click([5,6]);assert.deepEqual(f.saves[1].waypoints,[[5,1],[5,6]]);
    f.tool.cancel();assert.equal(f.tool.active,false);
});
test('continuation can be disabled and failed endpoints do not become mandatory waypoints',async()=>{
    const f=fixture({continueLine:()=>false,request:async data=>{
        if(data.waypoints.at(-1)[0]===9)throw new Error('No dry path');
        return {path:data.waypoints,signature:'good',reused:0,bridges:0};
    }});
    f.tool.click([1,1]);assert.equal(await f.tool.click([9,1]),false);assert.equal(f.saves.length,0);
    assert.equal(await f.tool.click([5,1]),true);assert.deepEqual(f.saves[0].waypoints,[[1,1],[5,1]]);
    assert.equal(f.tool.active,false);
});
test('completed previews remain visible during continuous motion and respect changed anchors',async()=>{
    const jobs=[];const f=fixture({request:data=>new Promise(resolve=>jobs.push({data,resolve}))});
    f.tool.click([1,1]);f.tool.hover([5,1]);await pause();f.tool.hover([7,1]);await pause();
    jobs[0].resolve({path:jobs[0].data.waypoints,signature:'first'});await pause();
    assert.equal(f.shown.at(-1).signature,'first');assert.equal(jobs.length,2);
    f.tool.cancel();jobs[1].resolve({path:[],signature:'stale-anchor'});await pause();
    assert.equal(f.shown.at(-1).signature,'first');
    f.tool.cancel();for(const job of jobs.slice(2))job.resolve({path:[],signature:'cancelled'});
});
