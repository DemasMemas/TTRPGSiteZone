import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorldBridgeLayout,BRIDGE_WATER_CLEARANCE} from '../app/static/js/worldBridgeLayout.js';

function fixture(length=6,north=false){
    const tiles=new Map(),nodes=[];
    for(let i=0;i<length+2;i++){
        const x=north?31:29+i,z=north?10+i:12;
        tiles.set(`${x},${z}`,{terrain:i&&i<=length?'water':'sand',height:i===length+1?2:i===0?1:.4,
            objects:[{type:'road',bridge:i>0&&i<=length,bridge_height:2.06}]});
        if(i&&i<=length)nodes.push({x,z});
    }
    const getTile=(x,z)=>tiles.get(`${x},${z}`);
    return {nodes,getTile,connected:(x,z,dx,dz)=>Boolean(getTile(x,z)&&getTile(x+dx,z+dz)),
        sampleHeight:(x,z)=>getTile(Math.floor(x),Math.floor(z)).height};
}
test('short and long bridges use uniformly scaled repeated original sections',()=>{
    for(const length of [1,6,20]){
        const f=fixture(length),snapshot=JSON.stringify([...Array.from({length:length+2},(_,i)=>f.getTile(29+i,12))]);
        const sections=buildWorldBridgeLayout(f);
        assert.ok(sections.length>length);
        const first=sections[0],last=sections.at(-1);
        assert.ok(Math.abs(first.position.y-first.direction.y*first.scale/2-1.01)<1e-8);
        assert.ok(Math.abs(last.position.y+last.direction.y*last.scale/2-2.01)<1e-8);
        for(let i=1;i<sections.length;i++){
            const a=sections[i-1],b=sections[i];
            for(const k of ['x','y','z'])assert.ok(Math.abs(a.position[k]+a.direction[k]*a.scale/2-b.position[k]+b.direction[k]*b.scale/2)<1e-8);
        }
        assert.equal(JSON.stringify([...Array.from({length:length+2},(_,i)=>f.getTile(29+i,12))]),snapshot);
    }
});
test('chunk ownership partitions the same complete span without duplicates or seams',()=>{
    const f=fixture(),all=buildWorldBridgeLayout(f);
    const west=buildWorldBridgeLayout({...f,nodes:f.nodes.filter(n=>n.x<32),owns:x=>x<32});
    const east=buildWorldBridgeLayout({...f,nodes:f.nodes.filter(n=>n.x>=32),owns:x=>x>=32});
    assert.deepEqual([...west,...east],all);
});
test('northbound spans and deleted isolated water nodes stay finite',()=>{
    const f=fixture(5,true),sections=buildWorldBridgeLayout(f);
    assert.ok(sections.every(s=>s.direction.x===0&&s.direction.z>0));
    const isolated=buildWorldBridgeLayout({...f,nodes:[f.nodes[2]],connected:()=>false});
    assert.ok(isolated.length>0&&isolated.every(s=>Number.isFinite(s.position.y)));
});

function checkWaterClearance(f,sections,north=false){
    for(const cell of f.nodes){
        const coordinate=north?cell.z:cell.x,water=(Number(f.getTile(cell.x,cell.z).height)||1)+.012;
        for(const section of sections){
            const key=north?'z':'x',d=section.direction,p=section.position,l=section.length;
            const begin=p[key]-d[key]*l/2,end=p[key]+d[key]*l/2;
            const lo=Math.max(begin,coordinate),hi=Math.min(end,coordinate+1);
            if(hi-lo<1e-9)continue;
            for(const x of [lo,hi]){
                const y=p.y-d.y*l/2+(x-begin)/(end-begin)*d.y*l;
                assert.ok(y>=water+BRIDGE_WATER_CLEARANCE-1e-8,`deck ${y} below water ${water}`);
            }
        }
    }
}
test('one-cell crossing stays above equal-height or raised water with unchanged bank joins',()=>{
    for(const north of [false,true])for(const level of [1,1.2,0])for(const width of [1,2]){
        const f=fixture(1,north),first=f.nodes[0],dx=north?0:1,dz=north?1:0;
        f.getTile(first.x-dx,first.z-dz).height=1;
        f.getTile(first.x+dx,first.z+dz).height=1;
        f.getTile(first.x,first.z).height=level;
        f.getTile(first.x,first.z).objects[0].scale=width;
        const sections=buildWorldBridgeLayout(f),a=sections[0],b=sections.at(-1);
        assert.ok(Math.abs(a.position.y-a.direction.y*a.length/2-1.01)<1e-8);
        assert.ok(Math.abs(b.position.y+b.direction.y*b.length/2-1.01)<1e-8);
        assert.ok(sections.every(s=>s.scale===a.scale),'width and thickness stay constant through ramps');
        checkWaterClearance(f,sections,north);
    }
});
test('different water levels and bank heights remain continuous across chunk ownership',()=>{
    const f=fixture(6);
    f.nodes.forEach((c,i)=>{f.getTile(c.x,c.z).height=i%2?1.4:1.2;});
    const sections=buildWorldBridgeLayout(f);
    checkWaterClearance(f,sections);
    for(let i=1;i<sections.length;i++)for(const key of ['x','y','z']){
        const a=sections[i-1],b=sections[i];
        assert.ok(Math.abs(a.position[key]+a.direction[key]*a.length/2-b.position[key]+b.direction[key]*b.length/2)<1e-8);
    }
    const west=buildWorldBridgeLayout({...f,nodes:f.nodes.filter(n=>n.x<32),owns:x=>x<32});
    const east=buildWorldBridgeLayout({...f,nodes:f.nodes.filter(n=>n.x>=32),owns:x=>x>=32});
    assert.deepEqual([...west,...east],sections);
});
