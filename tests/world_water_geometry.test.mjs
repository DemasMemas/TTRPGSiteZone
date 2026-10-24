import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorldWaterData,worldWaterCeiling} from '../app/static/js/worldWaterGeometry.js';
import {createTerrainSurfaceHeightSampler} from '../app/static/js/locationTerrain.js';
import {smoothWaterNormals} from '../app/static/js/waterGeometryUtils.js';
import {waterLevelForTile} from '../app/static/js/locationWaterEdge.js';

test('equal-level shore has no inset soil ribbon, while a raised bank retains its ring',()=>{
    const tiles=Array.from({length:3},()=>Array.from({length:3},()=>land(1)));tiles[1][1]=water(1);
    let d=buildWorldWaterData(tiles);assert.equal(d.bankPositions.length,0);
    assert.ok(d.water.some((v,i)=>i%3===0&&v===1));
    for(let i=0;i<d.water.length;i+=3)if(d.water[i]===1||d.water[i]===2||d.water[i+2]===1||d.water[i+2]===2)
        assert.ok(Math.abs(d.water[i+1]-1)<1e-8,'level perimeter closes on the land, without an open raised lip');
    tiles[1][0].height=2;
    d=buildWorldWaterData(tiles);assert.ok(d.bankPositions.length>0);
});
test('local stored offset is independent of shore tint and welded normals agree',()=>{
    assert.equal(waterLevelForTile({height:1,water_level_offset:-.2},'grass'),.8);
    assert.equal(waterLevelForTile({height:1,water_level_offset:0},'sand'),1);
    const p=[0,0,0, 1,0,0, 0,0,1, 0,0,1, 1,0,0, 1,1,1],n=smoothWaterNormals(p);
    assert.deepEqual(n.slice(3,6),n.slice(12,15));assert.deepEqual(n.slice(6,9),n.slice(9,12));
});

const land=h=>({terrain:'grass',height:h}),water=h=>({terrain:'water',height:h});
test('unequal water cells share one edge and have no internal volume walls',()=>{
    const tiles=[[water(1),water(1.4)]],snapshot=JSON.stringify(tiles),d=buildWorldWaterData(tiles);
    const ys=[];for(let i=0;i<d.water.length;i+=3)if(d.water[i]===1)ys.push(d.water[i+1]);
    assert.ok(ys.length>0);assert.ok(ys.every(y=>Math.abs(y-1.212)<1e-8));
    for(let i=0;i<d.sides.length;i+=9)assert.ok(![0,3,6].every(k=>d.sides[i+k]===1),'no internal wall');
    assert.equal(JSON.stringify(tiles),snapshot);
});
test('high shore joins actual terrain and all bank vertices have land owners',()=>{
    const tiles=Array.from({length:5},()=>Array.from({length:5},()=>land(1)));
    tiles[2][1]=land(2.5);tiles[2][2]=water(1);tiles[1][2]=water(1);
    const d=buildWorldWaterData(tiles),sample=createTerrainSurfaceHeightSampler(tiles);
    assert.equal(d.bankOwners.length,d.bankPositions.length/3*2);
    for(let i=0;i<d.bankPositions.length;i+=3){
        const j=i/3,ox=d.bankOwners[j*2],oz=d.bankOwners[j*2+1];assert.notEqual(tiles[oz][ox].terrain,'water');
        const x=d.bankPositions[i],z=d.bankPositions[i+2];
        if(Math.abs(x-2)<1e-9&&z>2&&z<3){
            assert.ok(Math.abs(d.bankPositions[i+1]-sample(2-1e-5,z)-.006)<1e-4);
        }
    }
});
function fixture(){return Array.from({length:64},(_,z)=>Array.from({length:64},(_,x)=>
    x>=29&&x<=34?water(1+((x+z)%4)*.15):{terrain:x<29?'grass':'sand',height:1+((x+z)%3)*.4}));}
function chunk(tiles,cx,cz){
    const ox=cx*32-1,oz=cz*32-1,padded=Array.from({length:34},(_,z)=>Array.from({length:34},(_,x)=>tiles[z+oz]?.[x+ox]||null));
    const d=buildWorldWaterData(padded,(x,z)=>x>0&&x<=32&&z>0&&z<=32,ox,oz);
    return {water:d.water,bank:d.bankPositions,normals:d.waterNormals.slice(0,d.water.length),ox,oz};
}
function edge(d,field,axis,coordinate){
    const out=[];for(let i=0;i<d[field].length;i+=3){const p=[d[field][i]+d.ox,d[field][i+1],d[field][i+2]+d.oz];if(Math.abs(p[axis]-coordinate)<1e-7)out.push(p.map(n=>Math.round(n*1e5)).join(','));}
    return [...new Set(out)].sort();
}
test('river and shore agree at two-chunk edges and the four-chunk corner in both traversal orders',()=>{
    const tiles=fixture(),keys=[[0,0],[1,0],[0,1],[1,1]],a=keys.map(k=>chunk(tiles,...k)),b=keys.slice().reverse().map(k=>chunk(tiles,...k)).reverse();
    assert.deepEqual(a,b);
    for(const field of ['water','bank']){
        assert.deepEqual(edge(a[0],field,0,32),edge(a[1],field,0,32));
        assert.deepEqual(edge(a[2],field,0,32),edge(a[3],field,0,32));
        assert.deepEqual(edge(a[0],field,2,32),edge(a[2],field,2,32));
        assert.deepEqual(edge(a[1],field,2,32),edge(a[3],field,2,32));
    }
    const normals=d=>{const out=new Map();for(let i=0;i<d.water.length;i+=3){const x=d.water[i]+d.ox,z=d.water[i+2]+d.oz;
        if(Math.abs(x-32)<1e-7&&z>=1&&z<=63)out.set([x,d.water[i+1],z].map(n=>Math.round(n*1e5)).join(','),d.normals.slice(i,i+3));}return out;};
    const left=normals(a[0]),right=normals(a[1]);for(const [key,n]of left){if(!right.has(key))continue;n.forEach((v,i)=>assert.ok(Math.abs(v-right.get(key)[i])<1e-5,'shared normal'));}
    tiles[31][31].height=2.4;
    const next=keys.map(k=>chunk(tiles,...k));
    assert.deepEqual(edge(next[0],'water',0,32),edge(next[1],'water',0,32));
    assert.deepEqual(edge(next[0],'water',2,32),edge(next[2],'water',2,32));
});
test('bridge clearance includes higher water beside the route',()=>{
    const tiles=Array.from({length:3},()=>Array.from({length:3},()=>water(1)));tiles[0][1].height=2;
    assert.ok(worldWaterCeiling((x,z)=>tiles[z]?.[x],1,1)>=1.262);
});

test('dry island on a four-chunk corner matches an unpartitioned world through land-water-land edits',()=>{
    const tiles=fixture(),round=a=>a.map(n=>Math.round(n*1e4));
    for(const terrain of ['grass','water','grass']){
        tiles[32][32]={terrain,height:2.3};
        for(const [cx,cz]of [[0,0],[1,0],[0,1],[1,1]]){
            const part=chunk(tiles,cx,cz),full=buildWorldWaterData(tiles,(x,z)=>Math.floor(x/32)===cx&&Math.floor(z/32)===cz);
            for(const [field,whole]of [['water',full.water],['bank',full.bankPositions]]){
                const world=part[field].map((v,i)=>v+(i%3===0?part.ox:i%3===2?part.oz:0));
                assert.deepEqual(round(world),round(whole),`partition-independent ${field}, ${terrain}, ${cx},${cz}`);
            }
        }
    }
});

test('temporary exposed walls disappear as neighbours arrive in different orders',()=>{
    const full=fixture(),orders=[[[0,0],[1,0],[0,1],[1,1]],[[1,1],[0,1],[1,0],[0,0]]],final=[];
    for(const order of orders){
        const loaded=Array.from({length:64},()=>Array(64).fill(null)),built=new Map();
        for(const [cx,cz]of order){
            for(let z=cz*32;z<(cz+1)*32;z++)for(let x=cx*32;x<(cx+1)*32;x++)loaded[z][x]=full[z][x];
            for(const [nx,nz]of order){if(!loaded[nz*32][nx*32])continue;built.set(`${nx},${nz}`,chunk(loaded,nx,nz));}
        }
        final.push([...built].sort(([a],[b])=>a.localeCompare(b)));
    }
    assert.deepEqual(final[0],final[1]);
    assert.deepEqual(final[0].map(([key,d])=>d),[[0,0],[0,1],[1,0],[1,1]].map(c=>chunk(full,...c)));
});
