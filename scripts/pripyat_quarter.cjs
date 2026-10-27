// Scene data only: uses the same editable building planners as the game.
const fs=require('node:fs'),path=require('node:path');
const read=n=>fs.readFileSync(path.join(__dirname,'../app/static/js',n),'utf8');
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function loadPlanners(){
    const architecture=url(read('locationArchitecture.js')),catalog=url(read('locationAssetCatalog.js'));
    const interior=url(read('locationInteriorGenerator.js').replace("'./locationArchitecture.js'",JSON.stringify(architecture)));
    const I=await import(interior),C=await import(catalog);
    const H=await import(url(read('locationHouseGenerator.js').replace("'./locationRoofSections.js'",JSON.stringify(url(read('locationRoofSections.js'))))));
    const F=await import(url(read('locationFurnitureGenerator.js').replace("'./locationArchitecture.js'",JSON.stringify(architecture)).replace("'./locationAssetCatalog.js'",JSON.stringify(catalog)).replace("'./locationInteriorGenerator.js'",JSON.stringify(interior))));
    return {I,C,H,F};
}
async function build(){
    const {I,C,H,F}=await loadPlanners();
    const width=72,height=72,objects=[],buildings=[];
    const tiles=Array.from({length:height},()=>Array.from({length:width},()=>({terrain:'grass',height:1,objects:[],radiation:0})));
    const pave=(x,z,w,d,terrain='concrete')=>{for(let j=z;j<z+d;j++)for(let i=x;i<x+w;i++)tiles[j][i].terrain=terrain;};
    pave(39,0,6,72,'gravel');
    for(const z of [1,22,43,49,68])pave(2,z,66,3);
    pave(18,40,20,10,'granite_tiles');pave(45,40,18,10,'granite_tiles');
    for(const x of [2,20,64])pave(x,0,2,72);
    const specs=[
        ['residential','Жилой дом № 1',6,5,12,12,3],
        ['residential','Жилой дом № 2',24,5,12,12,3],
        ['school','Школа',48,5,16,12,2],
        ['cafe','Кафе «Полесье»',6,27,12,10,1],
        ['office','Управление квартала',24,27,12,12,2],
        ['clinic','Поликлиника',48,27,14,12,2],
        ['workshop','Ремонтная мастерская',6,53,12,12,1],
        ['garage','Гаражи коммунальной службы',24,53,12,10,1],
        ['bathhouse','Городская баня',48,53,12,12,1],
    ];
    for(const [purpose,name,x,z,w,d,storeys]of specs){
        const buildingId='pripyat-'+buildings.length,seed=buildingId+'-2026';
        pave(x-1,z-2,w+2,d+3);
        const shell=H.planBuildingShell({minX:x,minZ:z,width:w,depth:d,storeys,basements:0,buildingId,seed,buildingType:purpose,roofType:'flat',wealth:'ordinary',condition:'damaged',groundHeight:()=>1});
        if(shell.error)throw Error(name+': '+shell.error);
        const source=shell.objects;
        for(let level=0;level<storeys;level++){
            const plan=I.planBuildingInterior(source,{buildingId,level,seed,buildingType:purpose});
            if(plan.error)throw Error(name+': '+plan.error);
            source.push(...plan.objects);
        }
        const furniture=F.planBuildingFurniture(source,{buildingId,scope:'building',seed,groundHeight:()=>1});
        if(furniture.error)throw Error(name+': '+furniture.error);
        for(const o of source){
            if(o.type==='wall'&&!o.properties.interior)o.properties.color=['#a5a597','#a9a49a','#aaa99d'][buildings.length%3];
            o.properties.quarter_building_name=name;
        }
        objects.push(...source,...furniture.objects);
        buildings.push({name,purpose,buildingId,x,z,width:w,depth:d,storeys,rooms:F.getFurnitureRooms(source,buildingId).length});
    }
    function asset(id,x,z,rotation=0,extra={}){
        const a=C.findLocationAsset(id)||C.findLocationAsset('household_'+id);if(!a)throw Error('Missing '+id);
        const [w,d,h]=a.dimensions;
        objects.push({name:a.label,type:a.id,tile_x:Math.floor(x),tile_y:Math.floor(z),properties:{dimensions:{width:w,depth:d,height:h},offset_x:x-Math.floor(x)-.5,offset_z:z-Math.floor(z)-.5,elevation:.015,rotation,color:a.color,passable:a.passable,level:0,is_on:false,...extra}});
    }
    for(const z of [3,21,42,50,67])for(const x of [38,46])asset('street_lamp',x,z,Math.PI*(x===38?0:1));
    for(const [x,z]of [[22,42],[31,42],[49,42],[58,42],[22,48],[31,48],[49,48],[58,48]]){
        asset('street_bench',x,z,z===42?Math.PI:0);asset('trash_bin',x+2,z);
    }
    for(const [x,z]of [[4,19],[19,39],[36,19],[64,39],[4,66],[62,66]])asset('dumpster',x,z);
    asset('power_tower',68,8);asset('transformer',68,14);
    for(const z of [25,47,68])asset('electric_pole',68,z);
    asset('road_sign',45.5,69);asset('mailbox',37.5,26);
    for(const [x,z]of [[7,51],[9,51],[15,66],[26,65],[30,65]])asset('tire',x,z,.7*x);
    asset('pallet',26,51);asset('pallet_jack',29,51);asset('sandbag_wall',34,51);
    asset('gas_cylinder',19,63);asset('bucket_metal',19,61);asset('tub',61,63);
    asset('fallen_tree',34,46,.5);asset('fallen_tree',5,47,-.7);
    for(const [x,z]of [[4,25],[19,18],[36,40],[61,25],[5,67],[62,51],[26,20]]){
        asset('rubble',x,z,x*.4);asset('brick',x+.9,z+.8);asset('broken_boards',x-.3,z+1.5,.8);
    }
    for(const [x,z]of [[23,46],[32,47],[50,45],[59,47],[17,25],[25,51]]){
        asset('bottle',x,z,.7);asset('tin_can',x+.3,z+.8);asset('litter',x-.7,z+.5);
    }
    asset('fork',23.5,46.4,.8);
    for(const [id,x,z]of [['household_monument_ruined',27,44],['nature_birch_green',4,43],['nature_birch_dry',66,43],
        ['nature_oak_green',19,69],['nature_oak_dead',65,69],['nature_pine_green',67,57],['nature_pine_dry',4,69],
        ['nature_bush_green',35,47],['nature_bush_dry',62,48],['nature_tall_grass_green',16,47],
        ['nature_tall_grass_dry',67,41],['nature_tall_grass_dead',36,65]])asset(id,x,z,0,{quarter_polish_asset:id});
    // Young trees reclaim planting beds, while entrances and circulation stay clear.
    for(const [x,z]of [[24,45],[29,45],[53,46],[58,46],[4,8],[4,14],[19,9],[19,15],[37,8],[37,15],[66,8],[66,18],[4,31],[19,32],[37,34],[66,33],[3,56],[19,60],[37,60],[63,59],[8,70],[16,70],[52,70],[60,70]]){
        tiles[z][x].terrain='grass';tiles[z][x].objects.push({type:'tree',scale:1.8+(x%3)*.45,color:'#526344',rotation:(x*17)%360});
    }
    for(const [x,z]of [[25,45],[28,46],[53,45],[57,47],[34,48],[19,42],[61,49]])tiles[z][x].terrain='grass';
    return {name:'Припять — заросший квартал',width,height,tiles,objects,buildings,spawn_points:[{x:42,y:69}],description:'Заброшенный советский квартал по мотивам Припяти: площадь, два жилых дома, школа, управление, поликлиника, кафе, мастерская, гаражи и баня. Вход с юга по дороге; общественные здания — в центре, хозяйственный двор — на юге. Все здания имеют помещения и мебель; объекты доступны обычному редактору.'};
}
module.exports={build,loadPlanners};
if(require.main===module)build().then(scene=>process.stdout.write(JSON.stringify(scene))).catch(e=>{console.error(e.message);process.exitCode=1;});
