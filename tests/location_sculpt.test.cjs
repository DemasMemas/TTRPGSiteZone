const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const url=name=>'data:text/javascript;base64,'+Buffer.from(fs.readFileSync(require('node:path').join(__dirname,'../app/static/js',name),'utf8')).toString('base64');
const load=()=>import(url('locationSculpt.js'));
const flat=(size=17)=>Array.from({length:size},()=>Array.from({length:size},()=>({terrain:'grass',height:1})));
const settings={mode:'raise',radius:3,strength:1,softness:1};
async function run(tiles,seconds,fps,options=settings,from={x:8.5,z:8.5},to=from){
    const {sculptHeightChanges}=await load();
    for(let i=0;i<seconds*fps;i++){
        const a={x:from.x+(to.x-from.x)*i/(seconds*fps),z:from.z+(to.z-from.z)*i/(seconds*fps)};
        const b={x:from.x+(to.x-from.x)*(i+1)/(seconds*fps),z:from.z+(to.z-from.z)*(i+1)/(seconds*fps)};
        for(const c of sculptHeightChanges(tiles,a,b,1/fps,options))tiles[c.z][c.x].height=c.height;
    }
}
test('raise/lower use elapsed time, circular falloff and existing height limits',async()=>{
    const a=flat(),b=flat();await run(a,1,15);await run(b,1,144);
    for(let z=0;z<a.length;z++)for(let x=0;x<a[z].length;x++)assert.ok(Math.abs(a[z][x].height-b[z][x].height)<1e-10);
    assert.ok(Math.abs(a[8][8].height-2)<1e-10);assert.ok(a[8][8].height>a[8][9].height&&a[8][9].height>a[8][11].height);
    assert.equal(a[0][0].height,1);
    await run(a,8,30);assert.ok(Math.abs(a[8][8].height-3)<1e-10);
    await run(a,8,30,{...settings,mode:'lower'});assert.ok(Math.abs(a[8][8].height+3)<1e-10);
});
test('smoothing reduces a peak without overshoot and leaves flat terrain alone',async()=>{
    const a=flat(),b=flat();a[8][8].height=3;b[8][8].height=3;
    await run(a,1,60,{...settings,mode:'smooth'});await run(b,1,120,{...settings,mode:'smooth'});
    assert.ok(a[8][8].height<2.1&&a[8][8].height>1);
    for(let z=0;z<a.length;z++)for(let x=0;x<a[z].length;x++)assert.ok(Math.abs(a[z][x].height-b[z][x].height)<.005);
    const c=flat();await run(c,1,60,{...settings,mode:'smooth'});assert.ok(c.flat().every(t=>t.height===1));
});
test('the smallest brush has no dead zone at a cell corner',async()=>{
    const a=flat();await run(a,1,60,{...settings,radius:0},{x:8.001,z:8.001});
    assert.ok(Math.abs(a[8][8].height-2)<1e-10);
    assert.equal(a.flat().filter(t=>t.height!==1).length,1);
});
test('strokes clip at boundaries, interpolate fast movement and preserve water and metadata',async()=>{
    const a=flat();a[8][8]={terrain:'water',height:.5,water_profile:'river',objects:[{type:'rock'}]};
    const water=structuredClone(a[8][8]);
    await run(a,1,1,settings,{x:-1,z:8.5},{x:18,z:8.5});
    assert.deepEqual(a[8][8],water);
    assert.ok(a[8][0].height>1&&a[8][16].height>1);
    assert.ok(a[8].filter(t=>t.terrain!=='water').every(t=>t.height>1));
    const hard=flat(),soft=flat();await run(hard,1,60,{...settings,softness:.05});await run(soft,1,60);
    assert.ok(hard[8][10].height>soft[8][10].height);
});
test('local surface caps match merged terrain at an internal region boundary',async()=>{
    const T=await import(url('locationTerrain.js')),tiles=flat();
    tiles[8][7].height=3;tiles[8][8].height=-1;
    const full=T.buildSmoothTerrainData(tiles,()=>true,-3.05);
    const bounds={minX:8,minZ:8,maxX:15,maxZ:15};
    const local=T.buildSmoothTerrainData(tiles,()=>true,-3.05,{minX:7,minZ:7,maxX:16,maxZ:16});
    const a=T.buildTerrainSurfaceData(tiles,full,bounds),b=T.buildTerrainSurfaceData(tiles,local,bounds);
    assert.deepEqual(a,b);
});
