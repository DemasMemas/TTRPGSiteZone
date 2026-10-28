const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const uri=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const architecture=uri(fs.readFileSync('app/static/js/locationArchitecture.js','utf8'));
const modulePromise=import(uri(fs.readFileSync('app/static/js/locationClipboard.js','utf8').replace('./locationArchitecture.js',architecture)));
const groundAt=()=>1;
let nextId=1;
const object=(type,x=3.5,z=3.5,level=0,building='old',extra={})=>({id:nextId++,revision:1,type,name:type,
    tile_x:Math.floor(x),tile_y:Math.floor(z),properties:{building_id:building,level,offset_x:x-Math.floor(x)-.5,
        offset_z:z-Math.floor(z)-.5,dimensions:{width:type==='floor'?4:1,depth:type==='floor'?4:.2,height:type==='floor'?.12:2},elevation:0,rotation:0,...extra}});
const entry=o=>({kind:'structure',source:o,x:o.tile_x+.5+o.properties.offset_x,z:o.tile_y+.5+o.properties.offset_z,
    level:o.properties.level,baseHeight:1+o.properties.level*2.4+o.properties.elevation});
const context=(objects=[])=>({objects,groundAt,floorOffset:.035,sourceLevel:0});
const target=(objects=[],extra={})=>({x:10.5,z:10.5,level:0,width:24,height:24,objects,groundAt,floorOffset:.035,buildingNames:{old:'copy-fresh','':'copy-none'},...extra});

test('copy is a detached snapshot; exact properties survive planning and repeated paste',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const o=object('box',3.375,3.625,0,'',{rotation:-12.345*Math.PI/180,dimensions:{width:.375,depth:.625,height:.875},color:'#335577',elevation:.125,contents:[]});
    const original=structuredClone(o),clip=captureLocationClipboard([entry(o)],context());
    o.properties.color='#000000';
    const p=planLocationPaste(clip,target());
    assert.equal(p.valid,true,p.error);assert.equal(p.entries[0].source.properties.rotation,original.properties.rotation);
    assert.deepEqual(p.entries[0].source.properties.dimensions,original.properties.dimensions);
    assert.equal(p.entries[0].source.properties.color,'#335577');assert.equal(p.entries[0].source.id,undefined);
    assert.equal(p.entries[0].source.revision,undefined);assert.equal(clip.entries[0].source.properties.color,'#335577');
    assert.deepEqual(planLocationPaste(clip,target()),p);
});

test('a floor, walls and door form a new building with preserved relative positions',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const objects=[object('floor'),object('wall',3.5,3.5,0,'old',{dimensions:{width:3,depth:.2,height:2.4}}),object('door')];
    const before=structuredClone(objects),clip=captureLocationClipboard(objects.map(entry),context(objects));
    const p=planLocationPaste(clip,target(objects));
    assert.equal(p.valid,true,p.error);assert.ok(p.entries.every(e=>e.source.properties.building_id==='copy-fresh'));
    assert.deepEqual(objects,before);
    const again=planLocationPaste(clip,target(objects,{buildingNames:{old:'copy-next'}}));
    assert.ok(again.entries.every(e=>e.source.properties.building_id==='copy-next'));
});

test('mixed decor, lamps and furniture preserve vertical offsets on another floor',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const table=entry(object('table',3.5,3.5,0,'old',{elevation:.375}));
    const decor={kind:'decor',source:{type:'rock',x:0,z:0,level:0,elevation:.125,rotation:12.345,scale:.75},x:4.5,z:3.5,level:0,baseHeight:1.125};
    const lamp={kind:'lamp',source:{x:3.5,z:4.5,height:2.125,level:0,azimuth:12.345,intensity:.375,distance:6},x:3.5,z:4.5,level:0,baseHeight:3.125};
    const clip=captureLocationClipboard([table,decor,lamp],context());
    const floor=object('floor',10.5,10.5,1,'target',{dimensions:{width:8,depth:8,height:.12}});
    const p=planLocationPaste(clip,target([floor],{level:1,floorOffset:0}));
    assert.equal(p.valid,true,p.error);assert.ok(p.entries.every(e=>e.level===1));
    assert.ok(Math.abs(p.entries[0].source.properties.elevation-.375)<1e-12);
    assert.ok(Math.abs(p.entries[2].source.height-(2.125+2.4))<1e-12);
    assert.equal(p.entries[0].source.properties.building_id,'target');
    assert.equal(p.entries[1].source.rotation,12.345);
    assert.ok(Math.abs(p.entries[1].x-p.entries[0].x-1)<1e-12);
    assert.deepEqual(p.supports,[[floor.id,1]]);
});

test('stairs and upper floor remain linked to a new copied base floor',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const objects=[object('floor'),object('floor',3.5,3.5,1),object('stairs')];
    const p=planLocationPaste(captureLocationClipboard(objects.map(entry),context(objects)),target(objects));
    assert.equal(p.valid,true,p.error);assert.ok(p.entries.every(e=>e.source.properties.building_id==='copy-fresh'));
    assert.deepEqual(p.entries.map(e=>e.level),[0,1,0]);
});

test('orphan stairs, doors, upper-storey parts and out-of-bounds groups are rejected',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    for(const [source,options]of [[object('stairs'),{}],[object('door'),{}],[object('table'),{level:1}],[object('wall'),{x:.1,z:.1}]]) {
        const clip=captureLocationClipboard([entry(source)],context());
        assert.equal(planLocationPaste(clip,target([],options)).valid,false);
    }
});

test('unsupported linked geometry, unknown references and filled containers fail explicitly',async()=>{
    const {captureLocationClipboard}=await modulePromise;
    for(const props of [{roof_section:{bodies:[]}},{generated_floor_spec:{}},{layout_generation:{version:1}},
        {wall_id:17},{support_id:17},{contents:[{name:'item'}]}]) {
        assert.throws(()=>captureLocationClipboard([entry(object('box',3.5,3.5,0,'old',props))],context()),/поддерживается/);
    }
});

test('terrain compensation keeps a common world-height translation without touching originals',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const objects=[object('box',3.5,3.5,0,'',{elevation:1}),object('box',4.5,3.5,0,'',{elevation:1})];
    const entries=objects.map(entry),clip=captureLocationClipboard(entries,context());
    const p=planLocationPaste(clip,target([],{groundAt:(x,z)=>x>10.5?1.5:1}));
    assert.equal(p.valid,true,p.error);
    assert.ok(Math.abs((p.entries[1].source.properties.elevation+1.5)-(p.entries[0].source.properties.elevation+1))<1e-12);
    assert.equal(objects[1].properties.elevation,1);
});

test('mixed groups use one translation compatible with server lamp rounding',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const entries=[entry(object('box',3.5,3.5,0,'')),
        {kind:'lamp',source:{x:6.5,z:3.5,height:2,level:0},x:6.5,z:3.5,level:0,baseHeight:3},
        {kind:'decor',source:{type:'rock',x:0,z:0,elevation:0,level:0},x:1.5,z:3.5,level:0,baseHeight:1}];
    const p=planLocationPaste(captureLocationClipboard(entries,context()),target());
    assert.equal(p.valid,true,p.error);
    assert.ok(Math.abs(p.entries[1].source.x*1000-Math.round(p.entries[1].source.x*1000))<1e-9);
    assert.ok(Math.abs(p.entries[1].x-p.entries[0].x-3)<1e-12);
    assert.ok(Math.abs(p.entries[2].x-p.entries[0].x+2)<1e-12);
});

test('copying a slab onto an existing floor is rejected',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const o=object('floor'),targetFloor=object('floor',10.5,10.5,0,'target');
    const p=planLocationPaste(captureLocationClipboard([entry(o)],context([o])),target([targetFloor]));
    assert.equal(p.valid,false);assert.match(p.error,/пересекается/);
});

test('fresh building IDs work on LAN HTTP without randomUUID',async()=>{
    const {freshClipboardBuildingId}=await modulePromise;
    const id=freshClipboardBuildingId({getRandomValues:values=>{values.set([1,2,3,4]);return values;}});
    assert.match(id,/^copy-[0-9a-f]{32}$/);
    assert.notEqual(freshClipboardBuildingId(null),freshClipboardBuildingId(null));
    assert.ok(id.length<=64);
});

test('a copied wall and door get a private group even without a copied floor',async()=>{
    const {captureLocationClipboard,planLocationPaste}=await modulePromise;
    const wall=object('wall',3.5,3.5,0,'old',{dimensions:{width:3,depth:.2,height:2.4},roof_wall:null,roof_wall_geometry:[],roof_group:null});
    const door=object('door'),objects=[wall,door];
    const p=planLocationPaste(captureLocationClipboard(objects.map(entry),context(objects)),target(objects));
    assert.equal(p.valid,true,p.error);
    assert.ok(p.entries.every(e=>e.source.properties.building_id==='copy-fresh'));
});
