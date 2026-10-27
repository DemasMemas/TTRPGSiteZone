const {test}=require('node:test'),assert=require('node:assert/strict');
const {modules,fixture}=require('./location_furniture_fixture.cjs');

test('a house has an entrance hall, one ground-floor kitchen, and cellar access outside private rooms',async()=>{
    const {A,I}=await modules();
    for(const shape of ['rectangle','L','U','C','T','cross','compound']) {
        const {source,rooms,plan}=await fixture({shellOptions:{width:16,depth:16,shape,storeys:3,wealth:'rich'}});
        const kitchens=rooms.filter(r=>/кухн/i.test(r.name));
        assert.equal(kitchens.length,1,shape);assert.equal(kitchens[0].level,0);
        const entry=source.find(o=>o.type==='door'&&o.properties.building_generation);
        const hall=rooms.find(r=>r.level===0&&r.name.includes('Прихожая'));
        assert.ok(hall.cells.some(c=>c.x===entry.tile_x&&c.z===entry.tile_y+1),shape);
        const layout=I.planBuildingInterior(source,{buildingId:'b',level:0,seed:'furniture'});
        for(const hatch of source.filter(o=>o.type==='hatch'&&o.properties.level===0)) {
            const p=A.structurePose(hatch);
            assert.ok(layout.rooms.find(r=>r.name.includes('Прихожая')).cells.some(c=>Math.hypot(c.x+.5-p.x,c.z+.5-p.z)<1.5),shape);
            assert.ok(!rooms.filter(r=>r.level===0&&r.name==='Санузел').some(r=>r.cells.some(c=>Math.hypot(c.x+.5-p.x,c.z+.5-p.z)<1.1)),shape);
        }
        const cookers=plan.objects.filter(o=>o.type==='household_cooker');
        assert.ok(cookers.length<=1,shape);
        for(const cooker of cookers)for(const o of plan.objects.filter(o=>['table','chair','household_stool'].includes(o.type)&&o.properties.level===0)) {
            const p=A.structurePose(cooker),q=A.structurePose(o);
            const bounds=p=>({x:Math.abs(p.axis.x)*p.width+Math.abs(p.normal.x)*p.depth,z:Math.abs(p.axis.z)*p.width+Math.abs(p.normal.z)*p.depth});
            const a=bounds(p),b=bounds(q);
            assert.ok(Math.hypot(Math.max(0,Math.abs(p.x-q.x)-(a.x+b.x)/2),Math.max(0,Math.abs(p.z-q.z)-(a.z+b.z)/2))>=.79,shape);
        }
    }
});

test('residential purpose prioritizes beds, kitchens and bathrooms with sparse halls and switched off fixtures',async()=>{
    const {F}=await modules(),{source,rooms,plan}=await fixture({shellOptions:{wealth:'rich',width:16,depth:16}});
    for(const role of ['bedroom','kitchen','bathroom']) {
        assert.ok(plan.objects.some(o=>o.properties.level===0&&o.properties.furniture_generation.role===role),role);
    }
    assert.ok(plan.objects.some(o=>o.type.startsWith('household_bed_')));
    assert.ok(plan.objects.some(o=>o.type==='ceiling_bulb'&&o.properties.is_on===false));
    const hall=F.planBuildingFurniture(source,{buildingId:'b',scope:'room',roomId:rooms.find(r=>r.level===0).id,level:0,role:'hallway',wealth:'rich'});
    assert.ok(hall.objects.every(o=>o.properties.passable===true));
    const smallSource=[{type:'floor',tile_x:5,tile_y:5,properties:{building_id:'small',level:0,dimensions:{width:5,depth:5,height:.12}}}];
    const room=F.getFurnitureRooms(smallSource,'small')[0];
    const small=F.planBuildingFurniture(smallSource,{buildingId:'small',scope:'room',roomId:room.id,role:'bedroom'});
    assert.ok(small.objects.some(o=>o.type==='household_bed_single'));
    assert.ok(small.objects.filter(o=>!o.properties.passable).length<=5);
    assert.equal(small.objects.filter(o=>o.type==='table').length,0);
});

test('building anomalies use signed floors and support, avoid furniture, and fill vacancies without duplicates',async()=>{
    const {B,A,F}=await modules();
    const catalog=[{key:'vspishka',name:'Искра',visual:'electric'}];
    for(const condition of ['intact','worn','damaged','ruins']) {
        const {source,plan}=await fixture({shellOptions:{condition}});
        const scene=[...source,...plan.objects],before=JSON.stringify(scene);
        const options={buildingId:'b',catalog,seed:'anomalies',groundHeight:()=>1};
        const first=B.planBuildingAnomalies(scene,options);
        assert.equal(first.error,undefined);assert.ok(first.objects.length>0,condition);
        assert.deepEqual(first,B.planBuildingAnomalies(scene,options));
        assert.equal(JSON.stringify(scene),before);
        assert.ok(first.objects.some(o=>o.properties.level===-1));
        if(condition==='intact')assert.ok(first.objects.some(o=>o.properties.level===1));
        for(const o of first.objects) {
            const cell=`${o.tile_x}:${o.tile_y}`;
            assert.ok(!scene.filter(p=>A.structureLevel(p)===o.properties.level&&!p.properties?.passable&&p.properties?.furniture_generation)
                .some(p=>F.furnitureFootprint(A.structurePose(p)).some(c=>`${c.x}:${c.z}`===cell)));
            assert.ok(Math.abs(o.properties.elevation-.035)<.0001);
        }
        const again=B.planBuildingAnomalies([...scene,...first.objects],options);
        assert.deepEqual(again.objects,[],'repeat at same density adds no duplicates');
        assert.deepEqual(B.planBuildingAnomalies(scene,{...options,density:0}).objects,undefined);
    }
});

test('tall furniture backs meet solid walls and leave windows clear',async()=>{
    const {F,A}=await modules();
    const object=(type,x,z,width,depth,height,extra={})=>({type,tile_x:Math.floor(x),tile_y:Math.floor(z),
        properties:{building_id:'b',level:0,offset_x:x-Math.floor(x)-.5,offset_z:z-Math.floor(z)-.5,
            dimensions:{width,depth,height},...extra}});
    const source=[object('floor',6,6,8,8,.12),object('wall',6,2,8,.2,2.4),object('wall',6,10,8,.2,2.4),
        object('window',6,2,7.5,.14,1,{elevation:1})];
    const room=F.getFurnitureRooms(source,'b')[0];
    const plan=F.planBuildingFurniture(source,{buildingId:'b',scope:'room',roomId:room.id,role:'bedroom',wealth:'rich'});
    const wardrobe=plan.objects.find(o=>o.type==='household_wardrobe');
    assert.ok(wardrobe);
    const p=A.structurePose(wardrobe);
    assert.ok(Math.abs(p.z+(p.depth/2)*p.normal.z-9.9)<.06 || Math.abs(p.z-(p.depth/2)*p.normal.z-9.9)<.06,
        'wardrobe rests at the solid south wall surface');
    assert.ok(plan.objects.filter(o=>o.properties.dimensions.height>1).every(o=>A.structurePose(o).z>3));
    const lamp=plan.objects.find(o=>o.type==='ceiling_bulb');
    assert.ok(lamp&&Math.abs(lamp.properties.elevation-2.395)<.001,'pendant pivot is mounted at the ceiling');
});

test('furnished homes pair tables with seats, keep cookers in poor kitchens, and give bathrooms less space',async()=>{
    const {A}=await modules();
    for(const wealth of ['poor','ordinary','rich']) {
        const {rooms,plan}=await fixture({shellOptions:{width:16,depth:16,wealth,basements:0,storeys:1}});
        const bathroom=rooms.find(r=>r.name==='Санузел');
        assert.ok(bathroom&&bathroom.cells.length<=16);
        assert.ok(plan.objects.some(o=>o.type==='household_cooker'&&o.properties.furniture_generation.role==='kitchen'));
        const tables=plan.objects.filter(o=>o.type==='table');assert.ok(tables.length);
        for(const table of tables) {
            const p=A.structurePose(table);
            const seats=plan.objects.filter(o=>['chair','household_stool'].includes(o.type)
                &&o.properties.furniture_generation.room_id===table.properties.furniture_generation.room_id);
            assert.ok(seats.some(o=>{const q=A.structurePose(o);return Math.hypot(q.x-p.x,q.z-p.z)<1.6
                &&q.normal.x*(p.x-q.x)+q.normal.z*(p.z-q.z)>0;}),'each table has a nearby seat facing it');
        }
    }
});
