const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const dir=path.join(__dirname,'../app/static/js');
const url=name=>{let source=fs.readFileSync(path.join(dir,name),'utf8');if(name==='locationWaterContourPrototype.js')source=source.replace("'./locationWaterEdge.js'",JSON.stringify(url('locationWaterEdge.js')));return 'data:text/javascript;base64,'+Buffer.from(source).toString('base64')};
const load=()=>import(url('locationWaterContourPrototype.js'));
const grid=()=>Array.from({length:7},()=>Array.from({length:7},()=>({terrain:'grass',height:1})));
test('one basin keeps its dry island and never changes saved cells',async()=>{
    const {connectedWaterContours}=await load(),tiles=grid();
    for(let z=1;z<6;z++)for(let x=1;x<6;x++)tiles[z][x]={terrain:'water',height:1};
    tiles[3][3]={terrain:'grass',height:2};const saved=JSON.stringify(tiles);
    const basins=connectedWaterContours(tiles);
    assert.equal(basins.length,1);assert.equal(basins[0].cells.length,24);
    assert.equal(basins[0].outer.length,1);assert.equal(basins[0].holes.length,1);
    assert.equal(JSON.stringify(tiles),saved);
});
test('diagonal contacts remain separate basins',async()=>{
    const {connectedWaterContours}=await load(),tiles=grid();
    tiles[2][2]={terrain:'water',height:1};tiles[3][3]={terrain:'water',height:1};
    const basins=connectedWaterContours(tiles);assert.equal(basins.length,2);
    assert.ok(basins.every(b=>b.outer.length===1&&b.outer[0].length===4));
});
test('a water height edit is rejected instead of flattening saved heights',async()=>{
    const {buildWaterContourPrototype}=await load(),tiles=grid();
    tiles[2][2]={terrain:'water',height:1};tiles[2][3]={terrain:'water',height:1.5};
    const saved=JSON.stringify(tiles),result=buildWaterContourPrototype({},tiles,()=>1);
    assert.equal(result.supported,false);assert.equal(result.reason,'unequal water levels');assert.equal(JSON.stringify(tiles),saved);
});
