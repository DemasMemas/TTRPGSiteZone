import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWorldWaterData,worldWaterCeiling,indexWaterGeometry} from '../app/static/js/worldWaterGeometry.js';
import {createTerrainSurfaceHeightSampler} from '../app/static/js/locationTerrain.js';
import {smoothWaterNormals} from '../app/static/js/waterGeometryUtils.js';
import {waterLevelForTile,buildRoundedWaterData} from '../app/static/js/locationWaterEdge.js';

test('water indexing preserves every rendered triangle and splits differing attributes',()=>{
    class Attribute{constructor(values,itemSize,normalized=false){this.array=new Float32Array(values);this.itemSize=itemSize;this.normalized=normalized;this.count=this.array.length/itemSize;}}
    const geometry={attributes:{position:new Attribute([0,0,0,1,0,0,0,0,1,0,0,1,1,0,0,1,0,1],3),
        normal:new Attribute([0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0],3),
        owner:new Attribute([0,0,0,0,0,0,1,0,0,0,0,0],2)},
        setAttribute(name,a){this.attributes[name]=a;},setIndex(index){this.index=index;}};
    const before=structuredClone(Object.fromEntries(Object.entries(geometry.attributes).map(([k,a])=>[k,{array:a.array,itemSize:a.itemSize}])));
    indexWaterGeometry(geometry);
    assert.equal(geometry.index.length,6);assert.equal(geometry.attributes.position.count,5,'different owners cannot be merged');
    for(const [name,a]of Object.entries(geometry.attributes)){
        const expanded=geometry.index.flatMap(i=>Array.from(a.array.slice(i*a.itemSize,(i+1)*a.itemSize)));
        assert.deepEqual(expanded,Array.from(before[name].array));
    }
});

test('equal-level shore rounds the footprint without a depression and high banks retain their slope',()=>{
    const tiles=Array.from({length:3},()=>Array.from({length:3},()=>land(1)));tiles[1][1]=water(1);
    let d=buildWorldWaterData(tiles);assert.ok(d.bankPositions.length>0);
    for(let i=0;i<d.bankPositions.length;i+=3){
        assert.ok(d.bankPositions[i+1]>=1-1e-8&&d.bankPositions[i+1]<=1.012+1e-8,'no artificial equal-level pit or raised wall');
        if(d.bankPositions[i]===1||d.bankPositions[i]===2||d.bankPositions[i+2]===1||d.bankPositions[i+2]===2)
            assert.ok(Math.abs(d.bankPositions[i+1]-1.002)<1e-8,'boundary closes on real land');
    }
    tiles[1][0].height=2;d=buildWorldWaterData(tiles);
    assert.ok(d.bankPositions.some((v,i)=>i%3===1&&v>1.5));
});

test('local stored offset is independent of shore tint and welded normals agree',()=>{
    assert.equal(waterLevelForTile({height:1,water_level_offset:-.2},'grass'),.8);
    assert.equal(waterLevelForTile({height:1,water_level_offset:0},'sand'),1);
    const p=[0,0,0, 1,0,0, 0,0,1, 0,0,1, 1,0,0, 1,1,1],n=smoothWaterNormals(p);
    assert.deepEqual(n.slice(3,6),n.slice(12,15));assert.deepEqual(n.slice(6,9),n.slice(9,12));
});

test('reported swamp shore joins the rendered land even below high water',()=>{
    // Lobby 19, around (208,278): water 2.1/1, swamp 2.1/1.25.
    const tiles=Array.from({length:5},(_,z)=>Array.from({length:5},(_,x)=>({
        terrain:x+z<5?'water':'swamp',height:x+z<5?(z<3?2.1:1):z<3?2.1:1.25,
    })));
    const sample=createTerrainSurfaceHeightSampler(tiles),snapshot=JSON.stringify(tiles);
    const d=buildWorldWaterData(tiles);
    let checked=0;
    for(let i=0;i<d.bankPositions.length;i+=3){
        const x=d.bankPositions[i],y=d.bankPositions[i+1],z=d.bankPositions[i+2];
        if(Math.abs(x-Math.round(x))>1e-8&&Math.abs(z-Math.round(z))>1e-8)continue;
        const touching=[];
        for(const dz of [-1e-5,1e-5])for(const dx of [-1e-5,1e-5]){
            const tile=tiles[Math.floor(z+dz)]?.[Math.floor(x+dx)];
            if(tile&&tile.terrain!=='water')touching.push(sample(x+dx,z+dz));
        }
        if(!touching.length)continue;
        assert.ok(Math.abs(y-(touching.reduce((a,b)=>a+b,0)/touching.length+.002))<1e-4,'no open edge between shore and land cap');
        checked++;
    }
    assert.ok(checked>10);assert.equal(JSON.stringify(tiles),snapshot);
});

test('open global water retains the compact eight-face surface at map scale',()=>{
    const tiles=Array.from({length:34},()=>Array.from({length:34},()=>({terrain:'water',height:1})));
    const d=buildWorldWaterData(tiles,(x,z)=>x>0&&x<33&&z>0&&z<33);
    assert.equal(d.water.length/9,32*32*8);assert.equal(d.bankPositions.length,0);
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
            assert.ok(Math.abs(d.bankPositions[i+1]-sample(2-1e-5,z)-.002)<1e-4);
        }
    }
});
function fixture(){return Array.from({length:64},(_,z)=>Array.from({length:64},(_,x)=>
    x>=29&&x<=34?water(1+((x+z)%4)*.15):{terrain:x<29?'grass':'sand',height:1+((x+z)%3)*.4}));}
function chunk(tiles,cx,cz){
    const ox=cx*32-2,oz=cz*32-2,padded=Array.from({length:36},(_,z)=>Array.from({length:36},(_,x)=>tiles[z+oz]?.[x+ox]||null));
    const d=buildWorldWaterData(padded,(x,z)=>x>=2&&x<34&&z>=2&&z<34,ox,oz);
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

test('compact open water and a coast one cell inside a chunk share lighting normals',()=>{
    const tiles=Array.from({length:64},(_,z)=>Array.from({length:64},(_,x)=>({
        terrain:x===30?'grass':'water',height:x===30?2:1+(x%3)*.2+(z%2)*.1,
    })));
    const maps=[chunk(tiles,0,0),chunk(tiles,1,0)].map(d=>{
        const result=new Map();
        for(let i=0;i<d.water.length;i+=3)if(Math.abs(d.water[i]+d.ox-32)<1e-7){
            const key=[32,d.water[i+1],d.water[i+2]+d.oz].map(v=>v.toFixed(6)).join(',');
            result.set(key,d.normals.slice(i,i+3));
        }
        return result;
    });
    let checked=0;
    for(const [key,n]of maps[0])if(maps[1].has(key)){
        n.forEach((v,i)=>assert.ok(Math.abs(v-maps[1].get(key)[i])<1e-6));checked++;
    }
    assert.ok(checked>30);
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

test('all corner occupancies and rotations partition and join in both scenes at equal and unequal levels',()=>{
    const cells=[[1,1],[2,1],[1,2],[2,2]],key=p=>p.map(v=>Math.round(v*1e7)).join(',');
    for(const scene of ['world','local'])for(const uneven of [false,true])for(let mask=1;mask<16;mask++){
        const tiles=Array.from({length:4},()=>Array.from({length:4},()=>({terrain:'swamp',height:1.7})));
        cells.forEach(([x,z],i)=>{if(mask&(1<<i))tiles[z][x]={terrain:'water',height:uneven?1+i*.3:1,water_level_offset:0};});
        const before=JSON.stringify(tiles),parts=new Map();
        for(const [x,z]of cells){
            if(tiles[z][x].terrain!=='water')continue;
            const include=(px,pz)=>px===x&&pz===z;
            const d=scene==='world'?buildWorldWaterData(tiles,include):buildRoundedWaterData(tiles,.24,include,null,waterLevelForTile,
                {shorelineRing:true,landSurfaceHeightAt:createTerrainSurfaceHeightSampler(tiles)});
            const fields=[d.water,d.bankPositions||[...d.bank,...d.sandBank]];let area=0;
            for(const positions of fields)for(let i=0;i<positions.length;i+=9){
                const [a,b,c]=[0,3,6].map(k=>positions.slice(i+k,i+k+3));
                const size=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
                assert.ok(size>1e-10,'no vertical internal face or degenerate fin');area+=size;
            }
            assert.ok(Math.abs(area-1)<1e-7,'water and bank cover exactly one cell');parts.set(`${x},${z}`,fields);
        }
        const edge=(fields,axis,coordinate)=>{
            const result=[];
            for(let field=0;field<fields.length;field++)for(let i=0;i<fields[field].length;i+=9)for(let k=0;k<3;k++){
                const a=fields[field].slice(i+k*3,i+k*3+3),b=fields[field].slice(i+(k+1)%3*3,i+(k+1)%3*3+3);
                if(Math.abs(a[axis]-coordinate)<1e-8&&Math.abs(b[axis]-coordinate)<1e-8)
                    result.push(field+':'+[key(a),key(b)].sort().join('|'));
            }
            return result.sort();
        };
        for(const [x,z]of cells)for(const [dx,dz,axis]of [[1,0,0],[0,1,2]]){
            const a=parts.get(`${x},${z}`),b=parts.get(`${x+dx},${z+dz}`);if(!a||!b)continue;
            assert.deepEqual(edge(a,axis,axis===0?x+1:z+1),edge(b,axis,axis===0?x+1:z+1),`${scene}, heights ${uneven}, corner mask ${mask}`);
        }
        assert.equal(JSON.stringify(tiles),before);
    }
});

test('all 256 surrounding occupancies cover the cell in both scenes across materials and height patterns',()=>{
    const materials=['grass','bare_dirt','sand','rock','concrete','swamp'];
    for(const scene of ['world','local'])for(const uneven of [false,true])for(let mask=0;mask<256;mask++){
        let bit=0;
        const tiles=Array.from({length:3},(_,z)=>Array.from({length:3},(_,x)=>{
            const dry=x===1&&z===1?false:Boolean(mask&(1<<bit++));
            return {terrain:dry?materials[mask%materials.length]:'water',height:uneven?1+((x+z*3)%5)*.25:1,water_level_offset:0};
        }));
        const include=(x,z)=>x===1&&z===1,snapshot=JSON.stringify(tiles);
        const d=scene==='world'?buildWorldWaterData(tiles,include):buildRoundedWaterData(tiles,.24,include,null,waterLevelForTile,
            {shorelineRing:true,landSurfaceHeightAt:createTerrainSurfaceHeightSampler(tiles)});
        let area=0;
        for(const p of [d.water,d.bank,d.sandBank])for(let i=0;i<p.length;i+=9){
            const a=(p[i+3]-p[i])*(p[i+8]-p[i+2])-(p[i+5]-p[i+2])*(p[i+6]-p[i]);
            assert.ok(a< -1e-10,'upward, nondegenerate face, with no vertical internal wall');area-=a/2;
            for(let k=0;k<9;k++)assert.ok(Number.isFinite(p[i+k]));
        }
        assert.ok(Math.abs(area-1)<1e-7,`${scene}, mask ${mask}, heights ${uneven}`);
        assert.equal(JSON.stringify(tiles),snapshot);
    }
});
