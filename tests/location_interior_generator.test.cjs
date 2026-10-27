const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../app/static/js',n),'utf8');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function modules(){
    const architecture=url(read('locationArchitecture.js'));
    return {A:await import(architecture),I:await import(url(read('locationInteriorGenerator.js').replace("'./locationArchitecture.js'",JSON.stringify(architecture)))),
        H:await import(url(read('locationHouseGenerator.js').replace("'./locationRoofSections.js'",JSON.stringify(url(read('locationRoofSections.js'))))))};
}
test('layouts preserve shell, shafts, manual edits and unrelated floors across shapes and damage',async()=>{
    const {I,H,A}=await modules();
    for(const shape of ['rectangle','L','U','C','T','cross','compound']) for(const condition of ['intact','worn','damaged','ruins']) {
        const source=H.planBuildingShell({minX:2,minZ:2,width:12,depth:12,shape,storeys:2,basements:1,condition,buildingId:'b',seed:'test'}).objects;
        source.forEach((o,i)=>o.id=i+1);
        const before=JSON.stringify(source);
        for(const level of [-1,0,1]) {
            const options={buildingId:'b',level,seed:'test',wealth:'rich'};
            const plan=I.planBuildingInterior(source,options);
            assert.equal(plan.error,undefined,`${shape}/${condition}/${level}`);
            assert.deepEqual(plan,I.planBuildingInterior(source,options));
            assert.equal(JSON.stringify(source),before);
            assert.ok(plan.objects.every(o=>['wall','door'].includes(o.type)&&o.properties.level===level));
            for(const c of plan.connections) {
                assert.ok(source.some(o=>o.type==='floor'&&A.structureLevel(o)===level&&(()=>{const p=A.structurePose(o);return Math.abs(c.x-p.x)<p.width/2+.01&&Math.abs(c.z-p.z)<p.depth/2+.01})()));
            }
            const generated=plan.objects.map((o,i)=>({...o,id:10000+i}));
            const other=I.planBuildingInterior([...source,...generated],{...options,level:level+1});
            if(!other.error)assert.deepEqual(other.replacedIds,[]);
            assert.deepEqual(I.planBuildingInterior([...source,...generated],options).replacedIds,generated.map(o=>o.id));
        }
    }
});
test('wealth and purpose change room count and minimum room areas',async()=>{
    const {I,H}=await modules();
    const source=H.planBuildingShell({minX:2,minZ:2,width:16,depth:16,buildingId:'b'}).objects;
    const plan=options=>I.planBuildingInterior(source,{buildingId:'b',...options});
    const poor=plan({wealth:'poor'}),ordinary=plan({wealth:'ordinary'}),rich=plan({wealth:'rich'});
    assert.ok(poor.rooms.length<ordinary.rooms.length);
    assert.ok(ordinary.rooms.length<rich.rooms.length);
    assert.ok(rich.rooms.every(r=>r.cells.length>=16));
    assert.ok(plan({buildingType:'warehouse'}).rooms.length<ordinary.rooms.length);
    assert.ok(plan({condition:'ruins'}).objects.length<ordinary.objects.length);
});
