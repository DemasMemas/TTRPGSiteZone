import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorldBridgeLayout,BRIDGE_WATER_CLEARANCE} from '../app/static/js/worldBridgeLayout.js';
import {createTerrainSurfaceHeightSampler} from '../app/static/js/locationTerrain.js';

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
test('short and long bridges use repeated original sections with constant width and fixed terrain anchors',()=>{
    for(const length of [1,6,20]){
        const f=fixture(length),snapshot=JSON.stringify([...Array.from({length:length+2},(_,i)=>f.getTile(29+i,12))]);
        const sections=buildWorldBridgeLayout(f);
        assert.ok(sections.length>length);
        const first=sections[0],last=sections.at(-1);
        assert.ok(first.position.y-first.direction.y*first.length/2>=1.01-1e-8);
        assert.ok(last.position.y+last.direction.y*last.length/2>=2.01-1e-8);
        for(let i=1;i<sections.length;i++){
            const a=sections[i-1],b=sections[i];
            for(const k of ['x','y','z'])assert.ok(Math.abs(a.position[k]+a.direction[k]*a.length/2-b.position[k]+b.direction[k]*b.length/2)<1e-8);
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
test('one-cell crossing stays above equal-height or raised water with terrain-clear bank joins',()=>{
    for(const north of [false,true])for(const level of [1,1.2,0])for(const width of [1,2]){
        const f=fixture(1,north),first=f.nodes[0],dx=north?0:1,dz=north?1:0;
        f.getTile(first.x-dx,first.z-dz).height=1;
        f.getTile(first.x+dx,first.z+dz).height=1;
        f.getTile(first.x,first.z).height=level;
        f.getTile(first.x,first.z).objects[0].scale=width;
        const sections=buildWorldBridgeLayout(f),a=sections[0],b=sections.at(-1);
        assert.ok(a.position.y-a.direction.y*a.length/2>=1.01-1e-8);
        assert.ok(b.position.y+b.direction.y*b.length/2>=1.01-1e-8);
        const start=a.position.y-a.direction.y*a.length/2,end=b.position.y+b.direction.y*b.length/2;
        for(let i=0;i<sections.length;i++)assert.ok(sections[i].position.y>=start+(end-start)*(i+.5)/sections.length-1e-7,'no artificial sag below the raised bank chord');
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

test('bank side ridges cannot raise road anchors or introduce profile ripples',()=>{
    for(const north of [false,true]){
        const tiles=Array.from({length:9},()=>Array.from({length:10},()=>({terrain:'grass',height:1,objects:[]})));
        const at=(x,z)=>north?tiles[x]?.[z]:tiles[z]?.[x];
        for(let x=2;x<=7;x++){
            const t=at(x,4);t.terrain=x>2&&x<7?'water':'sand';t.height=x===7?1.6:1;
            t.objects=[{type:'road',bridge:t.terrain==='water',scale:1.5}];
        }
        at(2,3).height=3.1;at(7,5).height=2.5;
        const snapshot=JSON.stringify(tiles),sample=createTerrainSurfaceHeightSampler(tiles);
        const getTile=(x,z)=>tiles[z]?.[x],nodes=Array.from({length:4},(_,i)=>north?{x:4,z:i+3}:{x:i+3,z:4});
        const connected=(x,z,dx,dz)=>Boolean(getTile(x,z)?.objects.length&&getTile(x+dx,z+dz)?.objects.length);
        const sections=buildWorldBridgeLayout({nodes,getTile,connected,sampleHeight:sample});let checks=0;
        const first=sections[0],last=sections.at(-1);
        assert.ok(Math.abs(first.position.y-first.direction.y*first.length/2-sample(north?4.5:2.5,north?2.5:4.5)-.01)<1e-8);
        assert.ok(Math.abs(last.position.y+last.direction.y*last.length/2-sample(north?4.5:7.5,north?7.5:4.5)-.01)<1e-8);
        for(const s of sections){
            const d=s.direction,h=Math.hypot(d.x,d.z),ux=d.x/h,uz=d.z/h;
            for(let along=0;along<=16;along++)for(const side of [0]){
                const t=along/16-.5;
                const x=s.position.x+d.x*s.length*t-uz*side*s.scale,z=s.position.z+d.z*s.length*t+ux*side*s.scale;
                if(getTile(Math.floor(x),Math.floor(z))?.terrain==='water')continue;
                const underside=s.position.y+d.y*s.length*t;
                assert.ok(underside>=sample(x,z)+.006-1e-5,`asphalt intersects terrain at ${x},${z}`);checks++;
            }
        }
        assert.ok(checks>5,'both approach centre lines were checked');
        for(let i=1;i<sections.length;i++)for(const axis of ['x','y','z']){
            const a=sections[i-1],b=sections[i];
            assert.ok(Math.abs(a.position[axis]+a.direction[axis]*a.length/2-b.position[axis]+b.direction[axis]*b.length/2)<1e-7);
        }
        assert.equal(JSON.stringify(tiles),snapshot);
    }
});
