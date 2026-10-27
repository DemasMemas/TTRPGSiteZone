const {test}=require('node:test'),assert=require('node:assert/strict');
const {modules,fixture}=require('./location_furniture_fixture.cjs');

test('catalog furniture uses saved BLD-04 rooms without touching architecture, across shapes and damage',async()=>{
    const {F,C,A}=await modules();
    for(const shape of ['rectangle','L','U','C','T','cross','compound'])for(const condition of ['intact','worn','damaged','ruins']){
        const {source,rooms,plan}=await fixture({shellOptions:{shape,condition,wealth:'rich'}});
        const before=JSON.stringify(source);
        assert.equal(plan.error,undefined,`${shape}/${condition}`);
        assert.deepEqual(plan,F.planBuildingFurniture(source,{buildingId:'b',scope:'building',seed:'furniture'}));
        assert.equal(JSON.stringify(source),before);
        assert.ok(plan.objects.length<=256);
        for(const o of plan.objects){
            assert.ok(C.findLocationAsset(o.type));
            assert.ok(!['floor','wall','door','stairs','ladder','hatch','floor_opening'].includes(o.type));
            assert.ok(F.isUnchangedFurniture(o));
            const room=rooms.find(r=>r.id===o.properties.furniture_generation.room_id&&r.level===o.properties.level);
            assert.ok(room);
            const keys=new Set(room.cells.map(c=>`${c.x}:${c.z}`));
            assert.ok(F.furnitureFootprint(A.structurePose(o)).every(c=>keys.has(`${c.x}:${c.z}`)));
        }
        if(condition==='intact')assert.ok(plan.objects.length>0,shape);
    }
});

test('room, floor and building replacement preserve manual, moved and filled objects',async()=>{
    const {F}=await modules();
    const {source,plan}=await fixture();
    assert.ok(plan.objects.length>=3);
    const generated=plan.objects.map((o,i)=>({...o,id:10000+i,revision:1}));
    const moved=JSON.parse(JSON.stringify(generated[0]));moved.properties.offset_x+=.2;
    const filled=JSON.parse(JSON.stringify(generated[1]));filled.properties.contents=[{id:'loot',name:'Keepsake'}];
    const manual={...JSON.parse(JSON.stringify(generated[2])),id:20000};delete manual.properties.furniture_generation;
    const scene=[...source,moved,filled,...generated.slice(2),manual];
    const room=generated[2].properties.furniture_generation.room_id,level=generated[2].properties.level;
    const next=F.planBuildingFurniture(scene,{buildingId:'b',scope:'room',roomId:room,level,seed:'another'});
    assert.equal(next.error,undefined);
    assert.ok(!next.replacedIds.includes(moved.id)&&!next.replacedIds.includes(filled.id)&&!next.replacedIds.includes(manual.id));
    assert.ok(next.replacedIds.every(id=>generated.some(o=>o.id===id&&o.properties.level===level&&o.properties.furniture_generation.room_id===room)));
    const empty=F.planBuildingFurniture(scene,{buildingId:'b',scope:'floor',level,empty:true});
    assert.deepEqual(empty.objects,[]);
    assert.ok(empty.replacedIds.every(id=>scene.find(o=>o.id===id).properties.level===level));
    assert.ok(!empty.replacedIds.includes(manual.id));
    assert.ok(!F.planBuildingFurniture(scene,{buildingId:'b',scope:'building',empty:true}).replacedIds.includes(filled.id));
});

test('purpose, wealth, damage and empty shells are independent furniture inputs',async()=>{
    const {F}=await modules();
    const {source,rooms}=await fixture({noLayout:true,shellOptions:{width:16,depth:16,storeys:1,basements:0}});
    const room=rooms[0];
    const plan=opts=>F.planBuildingFurniture(source,{buildingId:'b',scope:'room',roomId:room.id,level:0,seed:'quality',...opts});
    assert.ok(plan({wealth:'rich'}).objects.length>plan({wealth:'poor'}).objects.length);
    assert.ok(plan({condition:'ruins'}).objects.length<plan({condition:'intact'}).objects.length);
    const bedroom=plan({role:'bedroom',wealth:'rich'});
    assert.ok(bedroom.objects.some(o=>o.type==='household_bed_double'));
    assert.ok(plan({role:'kitchen'}).objects.some(o=>o.type==='household_cooker'));
    assert.ok(plan({role:'bathroom'}).objects.some(o=>o.type==='household_toilet'));
    assert.deepEqual(plan({empty:true}).objects,[]);
    assert.ok(plan({scope:'room',roomId:'missing'}).error);
});

test('rotated floors, hatch clearances and floor height use real support rather than terrain alone',async()=>{
    const {F,A}=await modules();
    const floor={id:1,revision:1,type:'floor',name:'Raised floor',tile_x:8,tile_y:8,
        properties:{building_id:'b',level:-1,rotation:.37,elevation:.4,dimensions:{width:12,depth:10,height:.12}}};
    const hatch={id:2,revision:1,type:'hatch',name:'Hatch',tile_x:8,tile_y:8,
        properties:{building_id:'b',level:-1,dimensions:{width:1,depth:1,height:.08}}};
    const groundHeight=(x,z)=>x===8&&z===8?2:1;
    const plan=F.planBuildingFurniture([floor,hatch],{buildingId:'b',scope:'floor',level:-1,wealth:'rich',groundHeight});
    assert.ok(plan.objects.length>0);
    const p=A.structurePose(floor);
    for(const o of plan.objects){
        assert.ok(Math.abs(groundHeight(o.tile_x,o.tile_y)+o.properties.elevation-2.435)<.0001);
        const pose=A.structurePose(o);
        for(const x of [-pose.width/2,pose.width/2])for(const z of [-pose.depth/2,pose.depth/2]){
            const dx=pose.x+x*pose.axis.x+z*pose.normal.x-p.x,dz=pose.z+x*pose.axis.z+z*pose.normal.z-p.z;
            assert.ok(Math.abs(dx*p.axis.x+dz*p.axis.z)<=p.width/2+.0001);
            assert.ok(Math.abs(dx*p.normal.x+dz*p.normal.z)<=p.depth/2+.0001);
        }
        assert.ok(!F.furnitureFootprint(pose).some(c=>c.x===8&&c.z===8));
    }
});
