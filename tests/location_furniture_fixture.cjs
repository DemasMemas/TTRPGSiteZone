const fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../app/static/js',n),'utf8');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function modules(){
    const architecture=url(read('locationArchitecture.js')),catalog=url(read('locationAssetCatalog.js'));
    const F=await import(url(read('locationFurnitureGenerator.js').replace("'./locationArchitecture.js'",JSON.stringify(architecture))
        .replace("'./locationAssetCatalog.js'",JSON.stringify(catalog))));
    const H=await import(url(read('locationHouseGenerator.js').replace("'./locationRoofSections.js'",JSON.stringify(url(read('locationRoofSections.js'))))));
    const I=await import(url(read('locationInteriorGenerator.js').replace("'./locationArchitecture.js'",JSON.stringify(architecture))));
    return {F,H,I,A:await import(architecture),C:await import(catalog)};
}
async function fixture({source,shellOptions={},options={},noLayout=false}={}){
    const {F,H,I}=await modules();
    if(!source){
        source=H.planBuildingShell({minX:2,minZ:2,width:12,depth:12,storeys:2,basements:1,
            buildingId:'b',seed:'furniture',...shellOptions}).objects;
        if(!source)throw Error('Invalid shell');
        if(!noLayout)for(const level of [...new Set(source.filter(o=>o.type==='floor').map(o=>o.properties.level))]){
            const plan=I.planBuildingInterior(source,{buildingId:'b',level,seed:'furniture'});
            if(!plan.error)source.push(...plan.objects);
        }
        source=source.map((o,i)=>({...o,id:i+1,revision:1}));
    }
    return {source,rooms:F.getFurnitureRooms(source,'b'),plan:F.planBuildingFurniture(source,{buildingId:'b',scope:'building',seed:'furniture',...options})};
}
module.exports={modules,fixture};
if(require.main===module)fixture(JSON.parse(fs.readFileSync(0,'utf8')||'{}')).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e);process.exitCode=1;});
