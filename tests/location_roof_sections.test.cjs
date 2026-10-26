const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../app/static/js',n),'utf8');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function modules(){const roof=url(read('locationRoofSections.js'));return {r:await import(roof),h:await import(url(read('locationHouseGenerator.js').replace("'./locationRoofSections.js'",`'${roof}'`)))};}
const contains=(poly,x,z)=>poly.every((a,i)=>{const b=poly[(i+1)%poly.length];return (b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0])>1e-8;});
test('flat, shed and joined gable roofs tile orthogonal bodies once without covering courts',async()=>{
    const {r,h}=await modules();
    for(const shape of ['rectangle','L','T','compound','U','C','cross'])for(const type of ['flat','shed','gable']) {
        const bodies=h.shellBodyRects(shape,12,12).map((b,i)=>r.roofBodyDefaults({...b,type,overhang:0},i));
        const surface=r.roofSurface(bodies,r.roofRect(0,0,12,12));
        for(let x=.137;x<12;x+=.47)for(let z=.183;z<12;z+=.53) {
            const expected=bodies.some(b=>x>b.x&&x<b.x+b.width&&z>b.z&&z<b.z+b.depth);
            assert.equal(surface.filter(p=>contains(p.points,x,z)).length,Number(expected),`${shape} ${type} ${x},${z}`);
        }
        const plan=r.planEditableRoofs([],bodies,{buildingId:'test'});
        assert.ok(plan.objects.length);assert.ok(plan.objects.every(o=>o.properties.passable));
        assert.deepEqual(JSON.parse(JSON.stringify(plan)),plan);
        for(const o of plan.objects.filter(o=>o.type==='roof'))assert.ok(o.properties.roof_geometry.every(Number.isFinite));
    }
});
test('a small same-level wing abuts a larger gable end with real facade geometry',async()=>{
    const {r}=await modules();
    const bodies=[r.roofBodyDefaults({x:0,z:0,width:8,depth:8,type:'gable'}),r.roofBodyDefaults({x:8,z:2,width:6,depth:4,type:'gable'},1)];
    const plan=r.planEditableRoofs([],bodies,{buildingId:'joint'});
    const joints=plan.objects.filter(o=>o.properties.roof_joint);
    assert.ok(joints.length);assert.ok(joints.every(o=>o.properties.roof_wall_geometry.length));
});
test('a shed raises its high wall; gable caps meet roof underside exactly',async()=>{
    const {r}=await modules();
    const body=r.roofBodyDefaults({x:0,z:0,width:8,depth:6,type:'shed',direction:'north',pitch:30});
    assert.ok(r.roofHeight([body],4,0)>r.roofHeight([body],4,6));
    for(const type of ['shed','gable']) {
        body.type=type;
        const wall={type:'wall',tile_x:0,tile_y:3,properties:{offset_x:-.5,offset_z:-.5,rotation:-Math.PI/2,level:0,dimensions:{width:6,depth:.2,height:2.4}}};
        const cap=r.wallRoofProperties(wall,[body]);assert.ok(cap.roof_wall_geometry.length);
        const heights=cap.roof_wall_geometry.filter((_,i)=>i%3===1);
        assert.ok(Math.max(...heights)>2.4);
    }
});
test('independent tall house and lower shed retain their own geometry and editable IDs',async()=>{
    const {r}=await modules();
    const bodies=[r.roofBodyDefaults({x:0,z:0,width:8,depth:8,level:1,type:'gable'}),r.roofBodyDefaults({x:8,z:2,width:6,depth:4,type:'shed',direction:'east'},1)];
    const plan=r.planEditableRoofs([],bodies,{buildingId:'mixed'});
    assert.deepEqual([...new Set(plan.objects.map(o=>o.properties.level))].sort(),[0,1]);
    const section=plan.objects.find(o=>o.properties.roof_section.owner===1);
    const changed=structuredClone(bodies);changed[1].pitch=35;
    const updated=r.rebuildRoofSection({...section,properties:{...section.properties,elevation:section.properties.elevation+.4}},changed);
    assert.ok(Math.abs(updated.elevation-updated.roof_section.base-.4)<1e-6);
    assert.deepEqual(updated.roof_section.bounds,section.properties.roof_section.bounds);
    const intact=r.planEditableRoofs([],bodies,{condition:'intact',seed:'same'});
    const ruins=r.planEditableRoofs([],bodies,{condition:'ruins',seed:'same'});
    assert.ok(ruins.objects.length<intact.objects.length/2);
});
test('roof edits retain per-section offsets, scales and signed storey moves',async()=>{
    const {r}=await modules();
    const bodies=[r.roofBodyDefaults({x:0,z:0,width:8,depth:8,type:'gable'})];
    const original=r.planEditableRoofs([],bodies,{buildingId:'edit'}).objects.find(o=>o.type==='roof'&&o.tile_x===3&&o.tile_y===3);
    original.properties.elevation+=.4;original.properties.level=2;
    original.properties.dimensions.width*=1.3;original.properties.dimensions.height*=1.2;
    const next=structuredClone(bodies);next[0].pitch=40;
    const result=r.rebuildRoofSection(original,next);
    assert.equal(result.roof_section.level,0);
    assert.ok(Math.abs(result.elevation-result.roof_section.base-.4)<1e-7);
    assert.ok(Math.abs(result.dimensions.height/result.roof_section.nativeSize.height-1.2)<1e-7);
    assert.equal(result.dimensions.width,original.properties.dimensions.width);
    assert.notEqual(result.dimensions.width,result.roof_section.nativeSize.width);
    assert.equal('level' in result,false);assert.equal('rotation' in result,false);
});
test('copying a storey retains roof geometry and isolates body editing from the source floor',async()=>{
    const {h}=await modules();
    const architecture=await import(url(read('locationArchitecture.js')));
    const plan=h.planBuildingShell({minX:2,minZ:2,width:10,depth:10,shape:'L',roofType:'gable',buildingId:'copy'});
    assert.equal(plan.error,undefined);
    const copied=architecture.storeyPlan({buildingId:'copy',sourceLevel:0,targetLevel:1,mode:'copy'},plan.objects);
    assert.equal(copied.error,undefined);
    const roof=copied.objects.find(o=>o.type==='roof'),source=plan.objects.find(o=>o.type==='roof');
    assert.equal(roof.properties.level,1);assert.equal(roof.properties.roof_section.level,1);
    assert.ok(roof.properties.roof_section.bodies.every(b=>b.level===1));
    assert.notEqual(roof.properties.roof_group,source.properties.roof_group);
    assert.deepEqual(roof.properties.roof_geometry,source.properties.roof_geometry);
    assert.ok(copied.objects.filter(o=>o.properties.roof_wall).every(o=>o.properties.roof_wall.bodies.every(b=>b.level===1)));
});
test('wall profiles meet a raised roof side and clip the opposite eave without protruding',async()=>{
    const {r}=await modules();
    const body=r.roofBodyDefaults({x:0,z:0,width:8,depth:6,type:'flat'});body.basePlane=[0,.1,0];
    const wall=z=>({type:'wall',tile_x:4,tile_y:z,properties:{offset_x:-.5,offset_z:-.5,dimensions:{width:2,depth:.2,height:2.4},roof_wall:{bodies:[body]}}});
    const spans=[{start:-1,end:1,bottom:0,top:2.4}];
    const low=r.wallRoofMeshGeometry(wall(0),spans),high=r.wallRoofMeshGeometry(wall(6),spans);
    assert.ok(low.length&&high.length);
    assert.ok(Math.abs(Math.max(...low.filter((_,i)=>i%3===1))-2.41)<1e-7);
    assert.ok(Math.abs(Math.max(...high.filter((_,i)=>i%3===1))-3.01)<1e-7);
});
test('moving, rotating and saving a shaped wall retains its profile and shared roof ground reference',async()=>{
    const {r}=await modules(),bodies=[r.roofBodyDefaults({x:0,z:0,width:8,depth:6,type:'gable'})];
    const wall={type:'wall',tile_x:0,tile_y:3,properties:{offset_x:-.5,offset_z:-.5,rotation:-Math.PI/2,
        roof_ground_anchor:{x:0,z:0},dimensions:{width:6,depth:.2,height:2.4}}};
    Object.assign(wall.properties,r.wallRoofProperties(wall,bodies));
    const spans=[{start:-3,end:3,bottom:0,top:2.4}],original=r.wallRoofMeshGeometry(wall,spans);
    const moved=structuredClone(wall);moved.tile_x=103;moved.tile_y=100;moved.properties.rotation=0;
    Object.assign(moved.properties,r.wallRoofProperties(moved,bodies));
    assert.deepEqual(r.wallRoofMeshGeometry(moved,spans),original);
    assert.deepEqual(moved.properties.roof_wall.frame,wall.properties.roof_wall.frame);
    const roof={type:'roof',tile_x:103,tile_y:96,properties:{...r.roofSectionProperties(bodies,r.roofRect(0,0,8,6),4,3,0),
        offset_x:-.5,offset_z:-.5,rotation:Math.PI/2,roof_ground_anchor:{x:0,z:0}}};
    assert.deepEqual(r.transformedRoofAnchor(moved),{x:100,z:99});
    assert.deepEqual(r.transformedRoofAnchor(roof),r.transformedRoofAnchor(moved));
});
test('a reversed mixed-height roof intersection is rejected explicitly, while a lower abutment is allowed',async()=>{
    const {r}=await modules();
    const bodies=[r.roofBodyDefaults({x:0,z:0,width:8,depth:8,level:1}),
        r.roofBodyDefaults({x:8,z:2,width:6,depth:4,type:'shed',pitch:60,direction:'west'},1)];
    assert.ok(r.planEditableRoofs([],bodies).error);
    bodies[1].direction='east';assert.equal(r.planEditableRoofs([],bodies).error,undefined);
});
