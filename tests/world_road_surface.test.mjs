import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRoadSurface,ROAD_SURFACE_LIFT} from '../app/static/js/worldRoadSurface.js';
import {terrainSurfaceHeight} from '../app/static/js/locationTerrain.js';

const near=(a,b,tolerance=2e-5)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const point=(x,z,tiles)=>({x,z,y:tiles[Math.floor(z)][Math.floor(x)].height+.06});
const grid=()=>Array.from({length:6},(_,z)=>Array.from({length:6},(_,x)=>({terrain:'sand',height:((x+z)%3===0?7:(x*2+z)%4===0?0:2)})));
const getter=tiles=>(x,z)=>tiles[z]?.[x]||null;
function checkSurface(data,tiles){
    assert.ok(data.positions.length>0);assert.equal(data.colors.length,data.positions.length);
    let checked=0;
    for(let i=0;i<data.positions.length;i+=9){
        const a=Array.from(data.positions.slice(i,i+3)),b=Array.from(data.positions.slice(i+3,i+6)),c=Array.from(data.positions.slice(i+6,i+9));
        const normalY=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);assert.ok(normalY>0,'upward winding, no roll');
        for(const weights of [[1/3,1/3,1/3],[.1,.7,.2],[.6,.1,.3]]){
            const p=[0,1,2].map(axis=>a[axis]*weights[0]+b[axis]*weights[1]+c[axis]*weights[2]);
            const tx=Math.floor(p[0]),tz=Math.floor(p[2]);
            const ground=terrainSurfaceHeight(tiles,tx,tz,p[0],p[2]);
            assert.ok(p[1]-ground>=ROAD_SURFACE_LIFT-2e-5,'every triangle interior stays above real terrain');
            assert.ok(p[1]-ground<ROAD_SURFACE_LIFT+.005,'no chord suspended above a valley');checked++;
        }
    }
    assert.ok(checked>3);
}
test('steep sand bands and both diagonal directions follow actual terrain triangles',()=>{
    const tiles=grid(),getTile=getter(tiles);
    for(const [a,b] of [[[1.5,1.5],[2.5,2.5]],[[2.5,1.5],[1.5,2.5]],[[2.5,2.5],[1.5,1.5]],[[1.5,2.5],[2.5,2.5]]]){
        const data=buildRoadSurface({getTile,links:[{from:point(...a,tiles),to:point(...b,tiles),widthScale:1.8,color:'#756f61'}]});
        checkSurface(data,tiles);
    }
});
test('junction pads, fractional offsets, zero heights and terrain edits remain conforming',()=>{
    const tiles=grid(),getTile=getter(tiles),position={x:2.8,z:2.65};
    const make=()=>buildRoadSurface({getTile,pads:[{position,scale:2,color:'#123456'}]});
    const before=make();checkSurface(before,tiles);
    tiles[2][2].height=0;tiles[3][3].height=9;
    const after=make();checkSurface(after,tiles);assert.notDeepEqual(after.positions,before.positions);
    near(after.colors[0],0x12/255);
});
test('flat roads keep width and short geometry; reversing an edge does not bank it',()=>{
    const tiles=Array.from({length:4},()=>Array.from({length:4},()=>({terrain:'grass',height:1})));
    const getTile=getter(tiles),from={x:1.5,y:1.06,z:1.5},to={x:2.5,y:1.06,z:2.5};
    for(const [a,b] of [[from,to],[to,from]]){
        const data=buildRoadSurface({getTile,links:[{from:a,to:b,widthScale:1}]});
        assert.ok(data.positions.length/9<40);
        for(let i=0;i<data.positions.length;i+=3){near(data.positions[i+1],1+ROAD_SURFACE_LIFT+.002);
            assert.ok(Math.abs((data.positions[i]-data.positions[i+2])/Math.SQRT2)<=.120001);}
    }
});
test('bridge decks remain above water and their bank approaches stay above terrain',()=>{
    const tiles=grid();for(const row of tiles)row[2]={terrain:'water',height:.3};
    const getTile=getter(tiles);
    const data=buildRoadSurface({getTile,links:[{from:{x:1.5,y:8,z:2.5},to:{x:3.5,y:8,z:2.5},widthScale:1,bridge:true}]});
    assert.ok(data.positions.length>0);
    for(let i=0;i<data.positions.length;i+=3)assert.ok(data.positions[i+1]>=8.0139);
});
test('empty or unloaded cells produce no dangling surface and do not mutate saves',()=>{
    const tiles=grid(),snapshot=JSON.stringify(tiles);
    buildRoadSurface({getTile:getter(tiles),links:[{from:point(1.5,1.5,tiles),to:point(2.5,2.5,tiles)}]});
    assert.equal(JSON.stringify(tiles),snapshot);
    assert.equal(buildRoadSurface({getTile:()=>null,links:[{from:{x:0,z:0},to:{x:1,z:1}}]}).positions.length,0);
});

test('bridge approaches trim junction pads and diagonal links at the same seam',()=>{
    const tiles=Array.from({length:4},()=>Array.from({length:4},()=>({terrain:'grass',height:1})));
    for(const toward of [{x:3.5,z:2.5},{x:1.5,z:2.5},{x:2.5,z:3.5},{x:2.5,z:1.5}]){
        const position={x:2.5,z:2.5},dx=toward.x-position.x,dz=toward.z-position.z;
        const from={x:position.x-dx*.5-dz*.5,z:position.z-dz*.5+dx*.5};
        const data=buildRoadSurface({getTile:getter(tiles),pads:[{position}],links:[{from,to:position}],
            bridgeApproaches:[{position,toward}]});
        assert.ok(data.positions.length>0);
        for(let i=0;i<data.positions.length;i+=3){
            assert.ok((data.positions[i]-position.x)*dx+(data.positions[i+2]-position.z)*dz<1e-7,'no land road triangles extend underneath bridge');
        }
        assert.ok(Array.from(data.positions).some((v,i)=>i%3===0&&Math.abs((v-position.x)*dx+(data.positions[i+2]-position.z)*dz)<1e-7),'road reaches the seam without a gap');
    }
});

test('trimmed bridge approach stays conforming on steep sand',()=>{
    const tiles=grid(),position=point(2.5,2.5,tiles);
    const data=buildRoadSurface({getTile:getter(tiles),pads:[{position,scale:2}],
        bridgeApproaches:[{position,toward:{x:3.5,z:2.5}}]});
    checkSurface(data,tiles);
    for(let i=0;i<data.positions.length;i+=3)assert.ok(data.positions[i]<=2.500001);
});
