import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planFenceLine,fenceEndpoints,fenceMatrixElements,connectedFenceReferences,fencesOverlap} from '../app/static/js/worldFenceLine.js';
import {createFenceLineTool} from '../app/static/js/worldFenceTool.js';
import {terrainSurfaceHeight,buildSmoothTerrainData} from '../app/static/js/locationTerrain.js';

const tile={terrain:'grass',height:1,objects:[]};
const base={start:{x:27.2,z:12},end:{x:39.6,z:12},settings:{color:'#ffffff',scale:1},width:64,height:32,getTile:()=>tile,sampleHeight:()=>1};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('line fits fractional endpoints across a chunk with equal legal section scales and no gaps',()=>{
    const p=planFenceLine(base);assert.ok(!p.error);assert.equal(p.sections.length,16);
    near(p.sections[0].x,27.2+.775/2);
    p.sections.forEach((s,i)=>{assert.ok(s.object.scale>=.2&&s.object.scale<=2);assert.equal(s.object.type,'fence');
        const [a,b]=fenceEndpoints(s.object,s.x,s.z);near(a.x,27.2+i*.775);near(b.x,27.2+(i+1)*.775);near(a.z,12);
    });
    assert.ok(p.sections.some(s=>s.tileX<32)&&p.sections.some(s=>s.tileX>=32));
});
test('diagonal and reverse lines reach their exact endpoints; invalid, unloaded and wet routes fail atomically',()=>{
    for(const [start,end]of [[{x:5.1,z:2.3},{x:18.6,z:19.7}],[base.end,base.start]]){
        const p=planFenceLine({...base,start,end});assert.ok(!p.error);
        const a=fenceEndpoints(p.sections[0].object,p.sections[0].x,p.sections[0].z)[0],s=p.sections.at(-1),b=fenceEndpoints(s.object,s.x,s.z)[1];
        near(a.x,start.x);near(a.z,start.z);near(b.x,end.x);near(b.z,end.z);
    }
    for(const options of [{end:{x:27.21,z:12}},{end:{x:64,z:12}},{getTile:x=>x===32?null:tile},{getTile:x=>x===32?{terrain:'water'}:tile},{end:{x:63,z:31},settings:{scale:.001}}]){
        const p=planFenceLine({...base,...options});assert.ok(p.error);assert.equal(p.sections.length,0);
    }
});
test('rigid slope transform puts both lower endpoints on terrain without shear',()=>{
    const object={scale:1.2,rotation:37},x=31.9,z=12;
    const height=(x,z)=>.12*x+.08*z;
    const matrix=fenceMatrixElements(object,x,z,height);
    const transform=v=>[0,1,2].map(axis=>matrix[axis]*v[0]+matrix[4+axis]*v[1]+matrix[8+axis]*v[2]+matrix[12+axis]);
    for(const p of [[0,-.25,-.4],[0,-.25,.4]]){const q=transform(p);near(q[1],height(q[0],q[2]));}
    const expected=fenceEndpoints(object,x,z);
    expected.forEach((p,i)=>{const q=transform([0,-.25,i===0?-.4:.4]);near(q[0],p.x);near(q[2],p.z)});
    for(const [a,b]of [[0,4],[0,8],[4,8]])near(matrix[a]*matrix[b]+matrix[a+1]*matrix[b+1]+matrix[a+2]*matrix[b+2],0);
});
test('terrain query samples rendered triangle heights, including steep sand',()=>{
    for(const terrain of ['grass','sand']){
        const tiles=Array.from({length:3},(_,z)=>Array.from({length:3},(_,x)=>({terrain,height:1+x*.8+z*.6})));
        const data=buildSmoothTerrainData(tiles,()=>[1,1,1]);
        // Height at the tile centre always coincides with the mesh centre fan.
        near(terrainSurfaceHeight(tiles,1,1,1.5,1.5),tiles[1][1].height);
        for(let i=0;i<data.positions.length;i+=9){
            if(data.tileByFace[i/9].x!==1||data.tileByFace[i/9].z!==1||!data.topByVertex[i/3])continue;
            const a=data.positions.slice(i,i+3),b=data.positions.slice(i+3,i+6),c=data.positions.slice(i+6,i+9);
            near(terrainSurfaceHeight(tiles,1,1,(a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3),(a[1]+b[1]+c[1])/3);
        }
        const h=terrainSurfaceHeight(tiles,1,1,1.02,1.7);assert.ok(h>1&&h<4);
    }
});
test('minimum scale still fits a fractional short line, and enormous runs require a shorter section',()=>{
    const p=planFenceLine({...base,start:{x:2,z:2},end:{x:2.17,z:2},settings:{scale:.2}});assert.equal(p.sections.length,1);assert.ok(p.sections[0].object.scale>=.2);
    assert.ok(planFenceLine({...base,width:512,end:{x:511,z:12},settings:{scale:.2}}).error);
});
test('connected selection follows endpoints through turns and chunks, but not nearby parallel fences',()=>{
    const p=planFenceLine(base),last=p.sections.at(-1),end=fenceEndpoints(last.object,last.x,last.z)[1];
    const turn=planFenceLine({...base,start:end,end:{x:end.x,z:end.z+4}});
    const refs=[...p.sections,...turn.sections,{...p.sections[0],z:12.2,object:{...p.sections[0].object,z:-.3}}].map((s,index)=>({chunkX:Math.floor(s.tileX/32),chunkY:0,tileX:s.tileX%32,tileY:s.tileY,index,object:s.object}));
    assert.equal(connectedFenceReferences(refs,refs[0]).length,p.sections.length+turn.sections.length);
    assert.equal(fencesOverlap({x:0,z:0},{x:1,z:0},{x:.5,z:0},{x:1.5,z:0}),true);
    assert.equal(fencesOverlap({x:0,z:0},{x:1,z:0},{x:1,z:0},{x:2,z:0}),false);
});

function toolCase({saveError=false,schedulePreview,saveWait}={}){
    const tiles=new Map(),messages=[],packets=[];let ghost=[];
    const getTile=(x,z)=>x>=0&&x<64&&z>=0&&z<32?(tiles.get(`${x},${z}`)||tile):null;
    const tool=createFenceLineTool({getTile,getBounds:()=>[64,32],getSettings:()=>({type:'fence',scale:1,color:'#ffffff'}),sampleHeight:()=>1,schedulePreview,
        preview:s=>{ghost=s},clearPreview:()=>{ghost=[]},status:s=>messages.push(s),notify:s=>messages.push(s),continueLine:()=>true,
        async save(packet){packets.push(packet);if(saveWait)await saveWait;if(saveError)throw new Error('conflict');for(const p of packet)tiles.set(`${p.chunk_x*32+p.tile_x},${p.tile_y}`,{...tile,...p.updates})}});
    const point=(x,z)=>({chunkX:Math.floor(x/32),chunkY:0,tileX:Math.floor(x)%32,tileY:Math.floor(z),pointX:x,pointZ:z,tileData:getTile(Math.floor(x),Math.floor(z))});
    return {tool,tiles,messages,packets,point,get ghost(){return ghost}};
}
test('first click and preview write nothing; commit batches once, preserves neighbours and blocks duplicate runs',async()=>{
    const c=toolCase();c.tiles.set('31,12',{...tile,objects:[{type:'tree',name:'keep'}]});
    await c.tool.click(c.point(27.2,12));c.tool.hover(c.point(39.6,12));assert.equal(c.packets.length,0);assert.equal(c.ghost.length,16);
    assert.equal(await c.tool.click(c.point(39.6,12)),true);assert.equal(c.packets.length,1);
    assert.equal(c.tiles.get('31,12').objects[0].name,'keep');assert.ok(c.packets[0].every(p=>Array.isArray(p.expected_objects)));
    // Continuation is anchored at the saved endpoint; returning over it is rejected.
    assert.equal(await c.tool.click(c.point(27.2,12)),false);assert.equal(c.packets.length,1);
    assert.equal(c.tool.cancel(),true);assert.equal(c.ghost.length,0);assert.equal(c.tool.active,false);
});
test('failed persistence retains an editable unsaved line and never mutates the tiles',async()=>{
    const c=toolCase({saveError:true});await c.tool.click(c.point(27.2,12));assert.equal(await c.tool.click(c.point(39.6,12)),false);
    assert.equal(c.tiles.size,0);assert.equal(c.tool.active,true);assert.equal(c.tool.busy,false);assert.ok(c.messages.includes('conflict'));
});
test('rapid hover events coalesce to the latest point and cancellation defeats a queued preview',async()=>{
    const frames=[],c=toolCase({schedulePreview:callback=>frames.push(callback)});
    await c.tool.click(c.point(27.2,12));
    c.tool.hover(c.point(31.6,12));c.tool.hover(c.point(39.6,12));assert.equal(frames.length,1);assert.equal(c.ghost.length,0);
    frames.shift()();assert.equal(c.ghost.length,16);
    c.tool.hover(c.point(33.6,12));c.tool.cancel();frames.shift()();assert.equal(c.ghost.length,0);assert.equal(c.packets.length,0);
});
test('double confirm while saving cannot duplicate the packet; cancel cannot resurrect continuation',async()=>{
    let finish;const c=toolCase({saveWait:new Promise(resolve=>{finish=resolve})});
    await c.tool.click(c.point(27.2,12));const saved=c.tool.click(c.point(39.6,12));
    assert.equal(await c.tool.click(c.point(39.6,12)),false);assert.equal(c.packets.length,1);
    c.tool.cancel();finish();await saved;assert.equal(c.tool.active,false);assert.equal(c.tool.busy,false);
});
