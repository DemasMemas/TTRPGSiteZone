const fs=require('node:fs');
const {loadPlanners}=require('./pripyat_quarter.cjs');
async function repair(data){
    const {F,I,C}=await loadPlanners(),original=data.objects,deleted=new Set(),added=[];
    let source=[...original];
    const groundHeight=(x,z)=>data.tiles[z]?.[x]?.height??1;
    for(const buildingId of [...new Set(original.map(o=>o.properties?.building_id).filter(Boolean))]){
        const spec=original.find(o=>o.properties?.building_id===buildingId&&o.properties?.building_generation)?.properties.building_generation;
        if(!spec)continue;
        for(const level of [...new Set(original.filter(o=>o.properties?.building_id===buildingId&&o.type==='floor').map(o=>o.properties.level))]){
            const partitions=source.filter(o=>o.properties?.building_id===buildingId&&o.properties.level===level&&o.properties.layout_generation);
            // Preserve any manually edited layout and furniture.
            if(partitions.some(o=>o.revision>1))continue;
            const base=source.filter(o=>!partitions.includes(o)&&!F.isUnchangedFurniture(o));
            const plan=I.planBuildingInterior(base,{buildingId,level,seed:spec.seed,buildingType:spec.buildingType});
            if(plan.error)throw Error(plan.error);
            partitions.forEach(o=>deleted.add(o.id));
            source=source.filter(o=>!partitions.includes(o)).concat(plan.objects);
            added.push(...plan.objects);
        }
        const plan=F.planBuildingFurniture(source,{buildingId,scope:'building',seed:spec.seed,groundHeight});
        if(plan.error)throw Error(plan.error);
        plan.replacedIds.forEach(id=>deleted.add(id));
        source=source.filter(o=>!deleted.has(o.id)).concat(plan.objects);
        added.push(...plan.objects);
    }
    function asset(id,x,z,rotation=0){
        if(original.some(o=>o.properties?.quarter_polish_asset===id))return;
        const a=C.findLocationAsset(id),[width,depth,height]=a.dimensions;
        added.push({type:id,name:a.label,tile_x:Math.floor(x),tile_y:Math.floor(z),properties:{dimensions:{width,depth,height},
            offset_x:x-Math.floor(x)-.5,offset_z:z-Math.floor(z)-.5,elevation:.005,rotation,passable:a.passable,
            color:a.color,level:0,quarter_polish_asset:id}});
    }
    asset('household_monument_ruined',27,44);
    for(const [id,x,z]of [['nature_birch_green',4,43],['nature_birch_dry',66,43],['nature_oak_green',19,69],['nature_oak_dead',65,69],
        ['nature_pine_green',67,57],['nature_pine_dry',4,69],['nature_bush_green',35,47],['nature_bush_dry',62,48],
        ['nature_tall_grass_green',16,47],['nature_tall_grass_dry',67,41],['nature_tall_grass_dead',36,65]])asset(id,x,z);
    const updates=original.filter(o=>['household_broken_boards','household_litter'].includes(o.type)&&!o.properties?.building_id&&o.revision===1)
        .map(o=>({id:o.id,properties:{...o.properties,elevation:.002}}));
    return{deletedIds:[...deleted],added,updates};
}
if(require.main===module)repair(JSON.parse(fs.readFileSync(0,'utf8'))).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
