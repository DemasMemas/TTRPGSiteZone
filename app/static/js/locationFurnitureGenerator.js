import { structurePose, structureLevel, structureBuildingId, floorVisualPose, floorSlabParts, doorOnWall } from './locationArchitecture.js';
import { findLocationAsset } from './locationAssetCatalog.js';
import { planBuildingInterior } from './locationInteriorGenerator.js';

// Check surviving geometry, rather than the original room or wall bounds.
export function hasFurnitureSupport(source, object, groundHeight=()=>0) {
    const asset=findLocationAsset(object.type),wallMounted=asset?.mount==='wall'||object.type==='poster';
    if(!wallMounted&&object.type!=='ceiling_bulb')return true;
    const p=structurePose(object),level=structureLevel(object),building=structureBuildingId(object);
    const y=level*2.4+Number(object.properties?.elevation||0)+Number(groundHeight(object.tile_x,object.tile_y));
    const peers=source.filter(o=>structureBuildingId(o)===building);
    if(wallMounted)return peers.some(o=>{
        if(o.type!=='wall'||structureLevel(o)!==level)return false;
        const w=structurePose(o),base=level*2.4+Number(o.properties?.elevation||0)+Number(groundHeight(o.tile_x,o.tile_y));
        if(y<base-.06||y+p.height>base+w.height+.02)return false;
        if(Math.abs(p.axis.x*w.axis.x+p.axis.z*w.axis.z)<.99)return false;
        return [-.5,0,.5].every(t=>{
            const dx=p.x+p.axis.x*p.width*t-w.x,dz=p.z+p.axis.z*p.width*t-w.z;
            return Math.abs(dx*w.axis.x+dz*w.axis.z)<=w.width/2-.01
                && Math.abs(dx*w.normal.x+dz*w.normal.z)<=w.depth/2+p.depth/2+.06;
        });
    });
    return peers.some(o=>{
        if(!['floor','ceiling','roof'].includes(o.type))return false;
        const base=structureLevel(o)*2.4+Number(o.properties?.elevation||0)+Number(groundHeight(o.tile_x,o.tile_y));
        if(base<y-.12||base>y+1.5)return false;
        const q=structurePose(o);
        const contains=(x,z,r)=>Math.abs((x-r.x)*r.axis.x+(z-r.z)*r.axis.z)<=r.width/2-.01
            &&Math.abs((x-r.x)*r.normal.x+(z-r.z)*r.normal.z)<=r.depth/2-.01;
        if(o.type==='floor'){
            const f=floorVisualPose(o,source),dx=p.x-f.x,dz=p.z-f.z;
            const x=dx*f.axis.x+dz*f.axis.z,z=dx*f.normal.x+dz*f.normal.z;
            return floorSlabParts(o,source).some(r=>Math.abs(x-r.x)<=r.width/2-.01&&Math.abs(z-r.z)<=r.depth/2-.01);
        }
        if(!contains(p.x,p.z,q))return false;
        const vertices=o.properties?.roof_geometry;
        if(!Array.isArray(vertices))return true;
        const dx=p.x-q.x,dz=p.z-q.z,x=dx*q.axis.x+dz*q.axis.z,z=dx*q.normal.x+dz*q.normal.z;
        for(let i=0;i<vertices.length;i+=9){
            const ax=vertices[i],az=vertices[i+2],bx=vertices[i+3],bz=vertices[i+5],cx=vertices[i+6],cz=vertices[i+8];
            const det=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);if(Math.abs(det)<1e-8)continue;
            const u=((x-ax)*(cz-az)-(z-az)*(cx-ax))/det,v=((bx-ax)*(z-az)-(bz-az)*(x-ax))/det;
            if(u>=-.001&&v>=-.001&&u+v<=1.001)return true;
        }
        return false;
    });
}

const key = (x,z) => `${x}:${z}`;
const adjacent = c => [[c.x-1,c.z],[c.x+1,c.z],[c.x,c.z-1],[c.x,c.z+1]];
const inside = (p,x,z,margin=0) => Math.abs((x-p.x)*p.axis.x+(z-p.z)*p.axis.z)<=p.width/2+margin
    && Math.abs((x-p.x)*p.normal.x+(z-p.z)*p.normal.z)<=p.depth/2+margin;
const bounds = p => ({x:Math.abs(p.axis.x)*p.width+Math.abs(p.normal.x)*p.depth,
    z:Math.abs(p.axis.z)*p.width+Math.abs(p.normal.z)*p.depth});
const distanceTo = (p,rectangle) => Math.hypot(
    Math.max(0,Math.abs((p.x-rectangle.x)*rectangle.axis.x+(p.z-rectangle.z)*rectangle.axis.z)-rectangle.width/2),
    Math.max(0,Math.abs((p.x-rectangle.x)*rectangle.normal.x+(p.z-rectangle.z)*rectangle.normal.z)-rectangle.depth/2));
function intersects(a,b,margin=.08) {
    return [a.axis,a.normal,b.axis,b.normal].every(v=>{
        const radius=p=>Math.abs(p.axis.x*v.x+p.axis.z*v.z)*p.width/2
            +Math.abs(p.normal.x*v.x+p.normal.z*v.z)*p.depth/2;
        return Math.abs((a.x-b.x)*v.x+(a.z-b.z)*v.z)<radius(a)+radius(b)+margin;
    });
}
// Matches the server's conservative, rotated bounding-box movement footprint.
export function furnitureFootprint(p) {
    const size=bounds(p),cells=[];
    for(let z=Math.floor(p.z-size.z/2);z<=Math.floor(p.z+size.z/2-.0001);z++)
        for(let x=Math.floor(p.x-size.x/2);x<=Math.floor(p.x+size.x/2-.0001);x++) cells.push({x,z});
    return cells;
}
export function buildingFloorParts(source,buildingId,level,groundHeight=()=>0) {
    return source.filter(o=>o.type==='floor'&&structureBuildingId(o)===buildingId&&structureLevel(o)===level)
        .flatMap(o=>{
            const p=floorVisualPose(o,source);
            return floorSlabParts(o,source).map(r=>({...p,x:p.x+r.x*p.axis.x+r.z*p.normal.x,
                z:p.z+r.x*p.axis.z+r.z*p.normal.z,width:r.width,depth:r.depth,
                surfaceHeight:Number(groundHeight(o.tile_x,o.tile_y))+Number(o.properties?.elevation||0)+.035}));
        });
}
function floorCells(areas) {
    const cells=new Map();
    for(const p of areas) {
        const b=bounds(p);
        if(b.x*b.z>4096) continue;
        for(let z=Math.floor(p.z-b.z/2);z<p.z+b.z/2;z++) for(let x=Math.floor(p.x-b.x/2);x<p.x+b.x/2;x++) {
            if(inside(p,x+.5,z+.5)) cells.set(key(x,z),{x,z});
        }
    }
    return cells;
}
function components(cells) {
    const left=new Map(cells),result=[];
    while(left.size) {
        const start=left.values().next().value,queue=[start];left.delete(key(start.x,start.z));
        for(let i=0;i<queue.length;i++) for(const [x,z] of adjacent(queue[i])) if(left.has(key(x,z))) {
            queue.push(left.get(key(x,z)));left.delete(key(x,z));
        }
        result.push(queue);
    }
    return result;
}

// Reuse BLD-04 room IDs, roles and cell contours. An unpartitioned floor needs
// no architectural edit: its connected floor sections are open rooms.
export function getFurnitureRooms(source,buildingId) {
    const peers=source.filter(o=>structureBuildingId(o)===buildingId),result=[];
    const levels=[...new Set(peers.filter(o=>o.type==='floor').map(structureLevel))].sort((a,b)=>a-b);
    for(const level of levels) {
        const objects=peers.filter(o=>structureLevel(o)===level);
        const saved=objects.find(o=>Array.isArray(o.properties?.layout_rooms))?.properties.layout_rooms;
        const layout=objects.find(o=>o.properties?.layout_generation)?.properties.layout_generation;
        const shell=objects.find(o=>o.properties?.building_generation)?.properties.building_generation;
        const areas=buildingFloorParts(source,buildingId,level),cells=floorCells(areas);
        // A compact open-plan floor may need no extra partitions. Recover its
        // functional zones with the same planner, rather than losing the foyer
        // and treating every floor as another living room or kitchen.
        const openPlan=!saved?.length&&shell?planBuildingInterior(source,{buildingId,level,seed:shell.seed}):null;
        const rooms=saved?.length?saved:openPlan&&!openPlan.error&&!openPlan.objects.length?openPlan.rooms:components(cells).map((list,i)=>({id:`open-${level}-${i}`,
            name:level<0?'Техническое помещение':'Общее помещение',cells:list}));
        for(const room of rooms) {
            if(typeof room.id!=='string'||!Array.isArray(room.cells))continue;
            const clipped=room.cells.filter(c=>Number.isInteger(c.x)&&Number.isInteger(c.z)&&cells.has(key(c.x,c.z)));
            if(clipped.length)result.push({id:room.id,name:String(room.name||'Помещение'),level,cells:clipped,
                wealth:layout?.wealth||shell?.wealth||'ordinary',condition:layout?.condition||shell?.condition||'intact'});
        }
    }
    return result;
}

export function furnitureOriginal(object) {
    const {furniture_generation,...properties}=object.properties||{};
    return {name:object.name,type:object.type,tile_x:object.tile_x,tile_y:object.tile_y,properties};
}
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function isUnchangedFurniture(object) {
    const generation=object.properties?.furniture_generation;
    return generation?.version===1&&generation.original
        &&canonical(generation.original)===canonical(furnitureOriginal(object));
}
export const FURNITURE_ROLES={living:'Гостиная',bedroom:'Спальня',child:'Детская',kitchen:'Кухня',studio:'Жилая комната с кухней',
    bathroom:'Санузел',bath:'Ванная',toilet:'Туалет',dining:'Столовая',dressing:'Гардеробная',laundry:'Прачечная',boiler:'Котельная',
    office:'Кабинет',storage:'Кладовая / склад',technical:'Техническая',shop:'Торговый зал',workshop:'Мастерская',garage:'Гараж',
    clinic:'Кабинет осмотра',treatment:'Процедурная',medical_storage:'Медицинское хранилище',classroom:'Класс',
    washroom:'Моечная',dishwashing:'Моечная посуды',sauna:'Парная',changing:'Предбанник',hallway:'Прихожая / коридор'};
function roleOf(name) {
    if(/детск/i.test(name))return 'child';
    if(/котель/i.test(name))return 'boiler';
    if(/прачеч/i.test(name))return 'laundry';
    if(/гардероб/i.test(name))return 'dressing';
    if(/туалет/i.test(name))return 'toilet';
    if(/обеденн|столовая/i.test(name))return 'dining';
    if(/медицинск.*хран/i.test(name))return 'medical_storage';
    if(/осмотр/i.test(name))return 'clinic';
    if(/процедур/i.test(name))return 'treatment';
    if(/мастерск|инструменталь/i.test(name))return 'workshop';
    if(/гараж/i.test(name))return 'garage';
    if(/класс/i.test(name))return 'classroom';
    if(/моечн.*посуд/i.test(name))return 'dishwashing';
    if(/моечн/i.test(name))return 'washroom';
    if(/парная/i.test(name))return 'sauna';
    if(/предбан/i.test(name))return 'changing';
    if(/ванная/i.test(name))return 'bath';
    if(/архив/i.test(name))return 'storage';
    if(/учительск/i.test(name))return 'office';
    if(/жилая.*кухн/i.test(name))return 'studio';
    if(/спаль|гостев/i.test(name))return 'bedroom';
    if(/кухн/i.test(name))return 'kitchen';
    if(/сануз|ванн/i.test(name))return 'bathroom';
    if(/прихож|коридор/i.test(name)&&!/гостин/i.test(name))return 'hallway';
    if(/кабинет/i.test(name))return 'office';
    if(/технич/i.test(name))return 'technical';
    if(/склад|кладов|подсоб/i.test(name))return 'storage';
    if(/торгов/i.test(name))return 'shop';
    return 'living';
}
function recipe(role,wealth) {
    const rich=wealth==='rich',poor=wealth==='poor';
    return {
        hallway:[],
        child:['household_child_bed','household_nightstand','table','household_wardrobe'],
        dining:['table','table','household_dining_bench','household_kitchen_cabinet'],
        dressing:['household_wardrobe','household_dresser','household_laundry_basket'],
        laundry:['household_washing_machine','household_clothes_dryer','household_laundry_basket','household_sink'],
        boiler:['household_gas_cylinder','household_storage_rack','household_bucket_metal'],
        toilet:['household_toilet','household_washbasin','household_trash_bin'],
        bath:['household_bathtub','household_washbasin','household_laundry_basket'],
        workshop:['household_workbench','household_tool_cabinet','household_storage_rack','household_tire'],
        garage:['household_tool_cabinet','household_workbench','household_tire','household_jerrycan'],
        clinic:['household_exam_couch','household_medical_cabinet','table','household_washbasin'],
        treatment:['household_exam_couch','household_medical_cabinet','household_washbasin','household_trash_bin'],
        medical_storage:['household_medical_cabinet','household_storage_rack','household_refrigerator'],
        classroom:['household_school_desk','household_school_desk','household_school_desk','shelf'],
        washroom:['household_shower','household_basin','household_dining_bench','household_washbasin'],
        dishwashing:['household_sink','household_kitchen_cabinet','household_trash_bin','household_storage_rack'],
        sauna:['household_sauna_stove','household_sauna_bench','household_tub'],
        changing:['household_dining_bench','household_wardrobe','household_coffee_table'],
        bedroom:[rich?'household_bed_double':'household_bed_single','household_nightstand','household_wardrobe','household_dresser','household_armchair'],
        kitchen:['household_cooker','household_sink','table','household_refrigerator','household_kitchen_cabinet'],
        studio:['household_bed_single','household_cooker','household_sink','table','household_armchair'],
        bathroom:['household_toilet','household_washbasin','household_bathtub','household_storage_rack'],
        office:['table','shelf','household_dresser','household_armchair','household_storage_rack'],
        technical:['household_generator','household_storage_rack','household_jerrycan','household_wood_crate','household_cardboard_box'],
        storage:['household_storage_rack','household_pallet','household_wood_crate','household_cardboard_box','shelf','household_pallet_jack'],
        shop:['household_shop_counter','household_display_case','household_refrigerated_display','household_storage_rack','shelf'],
        living:['household_sofa','table','household_tv_stand','household_armchair','shelf'],
    }[role];
}

export function planBuildingFurniture(source,{buildingId,scope='floor',level=0,roomId=null,seed='0',
    wealth='auto',condition='auto',role='auto',empty=false,occupiedCells=[],groundHeight=()=>0}={}) {
    if(!buildingId||!['room','floor','building'].includes(scope)||!Number.isInteger(level))return {error:'Выберите здание и область меблировки'};
    if(!['auto','poor','ordinary','rich'].includes(wealth)||!['auto','intact','worn','damaged','ruins'].includes(condition)
        ||!(role==='auto'||Object.hasOwn(FURNITURE_ROLES,role)))return {error:'Неизвестные параметры меблировки'};
    const allRooms=getFurnitureRooms(source,buildingId);
    const rooms=allRooms.filter(r=>scope==='building'||r.level===level&&(scope==='floor'||r.id===roomId));
    if(!rooms.length&&!empty)return {error:'В выбранной области нет помещений с целым полом'};
    const selected=new Set(rooms.map(r=>`${r.level}:${r.id}`));
    const belongs=o=>structureBuildingId(o)===buildingId&&(scope==='building'||structureLevel(o)===level
        &&(scope==='floor'||o.properties?.furniture_generation?.room_id===roomId));
    const replaced=source.filter(o=>belongs(o)&&isUnchangedFurniture(o));
    const retained=source.filter(o=>!replaced.includes(o));
    const objects=[],diagnostics={candidates:0,skipped:0,preservedEdits:source.filter(o=>belongs(o)&&o.properties?.furniture_generation&&!isUnchangedFurniture(o)).length};
    const random=text=>{
        let h=2166136261;for(const c of `${seed}:${text}`)h=Math.imul(h^c.charCodeAt(0),16777619);
        return (h>>>0)/4294967296;
    };
    for(const currentLevel of [...new Set(rooms.map(r=>r.level))]) {
        const areas=buildingFloorParts(source,buildingId,currentLevel,groundHeight),floor=floorCells(areas);
        if(floor.size>4096)return {error:'Меблировка поддерживает до 4096 клеток пола на этаже'};
        const sameLevel=retained.filter(o=>structureLevel(o)===currentLevel);
        const hazards=retained.filter(o=>['stairs','ladder'].includes(o.type)&&[currentLevel,currentLevel-1].includes(structureLevel(o))
            ||['hatch','floor_opening','anomaly'].includes(o.type)&&structureLevel(o)===currentLevel)
            .map(o=>({...structurePose(o),stair:o.type==='stairs'}));
        const doors=sameLevel.filter(o=>o.type==='door');
        const obstacles=sameLevel.filter(o=>o.properties?.passable!==true&&!['floor','ceiling','roof','floor_opening','hatch','stairs','ladder','door'].includes(o.type));
        const poses=obstacles.map(structurePose);
        const walls=obstacles.flatMap((o,i)=>o.type==='wall'?[poses[i]]:[]);
        const windows=sameLevel.filter(o=>o.type==='window').map(o=>({...structurePose(o),sill:Number(o.properties?.elevation||0)}));
        const blocked=new Set();
        for(const o of obstacles) {
            const cut=new Set(o.type==='wall'?doors.filter(d=>doorOnWall(d,o)).flatMap(d=>furnitureFootprint(structurePose(d)).map(c=>key(c.x,c.z))):[]);
            for(const c of furnitureFootprint(structurePose(o)))if(!cut.has(key(c.x,c.z)))blocked.add(key(c.x,c.z));
        }
        const free=new Map([...floor].filter(([k])=>!blocked.has(k)));
        const reserved=new Set(occupiedCells.filter(c=>c.level===currentLevel).map(c=>key(c.x,c.z)));
        // Keep the entrance hall aligned through the storeys, including floors
        // without an exterior door of their own.
        for(const entrance of retained.filter(o=>o.type==='door'&&structureLevel(o)===0&&o.properties?.building_generation)) {
            const p=structurePose(entrance);
            for(const side of [-1,1]) {
                const k=key(Math.floor(p.x+side*p.normal.x),Math.floor(p.z+side*p.normal.z));
                if(free.has(k))reserved.add(k);
            }
        }
        const protect=[...hazards,...doors.map(structurePose)];
        for(const p of protect)for(const c of furnitureFootprint({...p,width:p.width+.3,depth:p.depth+(p.stair?2.4:.3)}))reserved.add(key(c.x,c.z));
        // Reserve physical routes between room centres and existing doors/shafts.
        // Each candidate also preserves connectivity of every remaining free cell.
        const levelRooms=allRooms.filter(r=>r.level===currentLevel);
        const anchors=levelRooms.map(r=>{
            const x=r.cells.reduce((s,c)=>s+c.x,0)/r.cells.length,z=r.cells.reduce((s,c)=>s+c.z,0)/r.cells.length;
            return r.cells.filter(c=>free.has(key(c.x,c.z))).sort((a,b)=>(a.x-x)**2+(a.z-z)**2-((b.x-x)**2+(b.z-z)**2))[0];
        }).filter(Boolean);
        for(const component of components(free)) {
            const keys=new Set(component.map(c=>key(c.x,c.z)));
            const goals=[...anchors.filter(c=>keys.has(key(c.x,c.z))),...component.filter(c=>reserved.has(key(c.x,c.z)))];
            if(!goals.length)continue;
            const start=goals[0],queue=[start],parents=new Map([[key(start.x,start.z),null]]);
            for(let i=0;i<queue.length;i++)for(const [x,z] of adjacent(queue[i]))if(keys.has(key(x,z))&&!parents.has(key(x,z))) {
                parents.set(key(x,z),key(queue[i].x,queue[i].z));queue.push({x,z});
            }
            for(const goal of goals)for(let k=key(goal.x,goal.z);k!=null;k=parents.get(k))reserved.add(k);
        }
        for(const room of levelRooms.filter(r=>selected.has(`${r.level}:${r.id}`))) {
            if(empty)continue;
            const roomWealth=wealth==='auto'?room.wealth:wealth,roomCondition=condition==='auto'?room.condition:condition;
            const roomRole=role==='auto'||scope!=='room'?roleOf(room.name):role;
            const choices=[...recipe(roomRole,roomWealth)];
            // Keep essential items first; vary only the optional furnishings.
            const essential={bedroom:1,kitchen:3,studio:4,bathroom:2,office:1,living:3,classroom:3,workshop:2,shop:3}[roomRole]||1;
            choices.splice(essential,choices.length-essential,...choices.slice(essential).sort((a,b)=>random(`${room.id}:${a}`)-random(`${room.id}:${b}`)));
            const roomKeys=new Set(room.cells.map(c=>key(c.x,c.z)));
            const amount=Math.min(choices.length,{poor:3,ordinary:5,rich:7}[roomWealth],Math.max(1,Math.floor(room.cells.length/5)));
            const keep={intact:1,worn:.75,damaged:.45,ruins:.16}[roomCondition];
            const centers=room.cells.flatMap(c=>[.25,.5,.75].flatMap(dx=>[.25,.5,.75].map(dz=>({x:c.x+dx,z:c.z+dz}))));
            const edgeDistance=p=>Math.min(...walls.map(w=>distanceTo(p,w)),4);
            for(let index=0;index<amount&&objects.length<256;index++) {
                if(random(`${currentLevel}:${room.id}:keep:${index}`)>keep)continue;
                const asset=findLocationAsset(choices[index]);if(!asset)continue;
                if(retained.some(o=>structureLevel(o)===currentLevel
                    && (o.type===(asset.baseType||asset.id)||asset.id.startsWith('household_bed_')&&o.type.startsWith('household_bed_'))
                    && (()=>{const p=structurePose(o);return roomKeys.has(key(Math.floor(p.x),Math.floor(p.z)));})()))continue;
                const [width,depth,height]=asset.dimensions;
                const neighbors=objects.filter(o=>o.properties.level===currentLevel&&o.properties.furniture_generation.room_id===room.id);
                const table=neighbors.find(o=>o.type==='table');
                const tablePose=table?structurePose(table):null;
                const bed=neighbors.find(o=>o.type.startsWith('household_bed_'));
                const bedPose=bed?structurePose(bed):null;
                const score=p=>{
                    let value=edgeDistance(p);
                    if(['chair','household_stool'].includes(asset.id)&&tablePose)value=Math.abs(distanceTo(p,tablePose)-.4)+value*.05;
                    if(asset.id==='household_nightstand'&&bedPose) {
                        value=Math.min(...[-1,1].map(side=>Math.hypot(p.x-bedPose.x-side*bedPose.axis.x*(bedPose.width+width)/2+bedPose.normal.x*(bedPose.depth/2-.3),
                            p.z-bedPose.z-side*bedPose.axis.z*(bedPose.width+width)/2+bedPose.normal.z*(bedPose.depth/2-.3))))+value*.05;
                    }
                    return value+.08*random(`${room.id}:${index}:${p.x}:${p.z}`);
                };
                const wallCenters=walls.flatMap(w=>[-1,1].flatMap(side=>{
                    const normal={x:w.normal.x*side,z:w.normal.z*side};
                    const rotation=Math.atan2(normal.x,normal.z);
                    return Array.from({length:Math.ceil(w.width/.5)},(_,i)=>{
                        const along=-w.width/2+.25+i*.5;
                        return {x:w.x+w.axis.x*along+normal.x*(w.depth/2+depth/2+.035),
                            z:w.z+w.axis.z*along+normal.z*(w.depth/2+depth/2+.035),rotation};
                    });
                }));
                const ranked=[...wallCenters,...centers].map(center=>({center,score:score(center)})).sort((a,b)=>a.score-b.score).slice(0,600);
                let placed=false;
                for(const {center} of ranked) {
                    if(placed)break;
                    if(reserved.has(key(Math.floor(center.x),Math.floor(center.z))))continue;
                    const orientationScore=quarter=>{
                        const normal={x:Math.sin(quarter*Math.PI/2),z:Math.cos(quarter*Math.PI/2)};
                        if(['chair','household_stool'].includes(asset.id)&&tablePose)return -normal.x*(tablePose.x-center.x)-normal.z*(tablePose.z-center.z);
                        return edgeDistance({x:center.x-normal.x*depth/2,z:center.z-normal.z*depth/2});
                    };
                    for(const quarter of (center.rotation!==undefined?[center.rotation/(Math.PI/2)]:[0,1,2,3].sort((a,b)=>orientationScore(a)-orientationScore(b)))) {
                        diagnostics.candidates++;
                        const angle=quarter*Math.PI/2;
                        const p={...center,width,depth,height,axis:{x:Math.cos(angle),z:-Math.sin(angle)},normal:{x:Math.sin(angle),z:Math.cos(angle)}};
                        const footprint=furnitureFootprint(p),keys=footprint.map(c=>key(c.x,c.z));
                        if(keys.some(k=>reserved.has(k)||!roomKeys.has(k)))continue;
                        if(poses.some(q=>intersects(p,q,.02))||protect.some(q=>intersects(p,q,.3)))continue;
                        if(windows.some(w=>height>w.sill-.05 && intersects(p,{...w,depth:w.depth+.18},.06)))continue;
                        if(asset.id==='household_toilet') {
                            const front={...p,x:p.x+p.normal.x*(depth/2+.38),z:p.z+p.normal.z*(depth/2+.38),width:.6,depth:.7};
                            if(furnitureFootprint(front).some(c=>!roomKeys.has(key(c.x,c.z)))||poses.some(q=>intersects(front,q,.02)))continue;
                        }
                        // Leave a working aisle at the cooker, including the
                        // space occupied by pulled-out dining chairs.
                        if(['table','household_school_desk'].includes(asset.id)&&neighbors.some(o=>o.type==='household_cooker'&&intersects(p,structurePose(o),.9)))continue;
                        const support=areas.find(a=>inside(a,p.x,p.z));if(!support)continue;
                        let supported=true;
                        const samples=size=>Array.from({length:Math.ceil(size/.2)+1},(_,i)=>-size/2+size*i/Math.ceil(size/.2));
                        for(const x of samples(width))for(const z of samples(depth)) {
                            if(!areas.some(a=>Math.abs(a.surfaceHeight-support.surfaceHeight)<.01&&inside(a,p.x+x*p.axis.x+z*p.normal.x,p.z+x*p.axis.z+z*p.normal.z))){supported=false;break;}
                        }
                        if(!supported)continue;
                        const companions=[];
                        if(['table','household_school_desk'].includes(asset.id)) {
                            const seat=findLocationAsset(roomWealth==='poor'?'household_stool':'chair');
                            for(const side of [-1,1]) {
                                const rotation=angle+(side>0?Math.PI:0),[w,d,h]=seat.dimensions;
                                const chair={x:p.x+p.normal.x*side*(depth/2+d/2+.12),z:p.z+p.normal.z*side*(depth/2+d/2+.12),
                                    width:w,depth:d,height:h,axis:{x:Math.cos(rotation),z:-Math.sin(rotation)},normal:{x:Math.sin(rotation),z:Math.cos(rotation)},rotation,asset:seat};
                                const cells=furnitureFootprint(chair);
                                if(cells.some(c=>reserved.has(key(c.x,c.z))||!roomKeys.has(key(c.x,c.z)))
                                    ||poses.some(q=>intersects(chair,q,.02))||protect.some(q=>intersects(chair,q,.3)))continue;
                                if(neighbors.some(o=>o.type==='household_cooker'&&intersects(chair,structurePose(o),.8)))continue;
                                if(![-1,1].every(x=>[-1,1].every(z=>areas.some(a=>Math.abs(a.surfaceHeight-support.surfaceHeight)<.01
                                    &&inside(a,chair.x+x*w/2*chair.axis.x+z*d/2*chair.normal.x,chair.z+x*w/2*chair.axis.z+z*d/2*chair.normal.z)))))continue;
                                companions.push(chair);
                            }
                            if(!companions.length)continue;
                        }
                        const occupiedKeys=[...keys,...companions.flatMap(p=>furnitureFootprint(p).map(c=>key(c.x,c.z)))];
                        const next=new Map([...free].filter(([k])=>!occupiedKeys.includes(k)));
                        if(components(next).length!==components(free).length)continue;
                        const tile_x=Math.floor(p.x),tile_y=Math.floor(p.z);
                        const elevation=support.surfaceHeight-Number(groundHeight(tile_x,tile_y));
                        if(!Number.isFinite(elevation)||elevation<0||elevation>10)continue;
                        const object={type:asset.baseType||asset.id,name:asset.label,tile_x,tile_y,properties:{building_id:buildingId,level:currentLevel,
                            dimensions:{width,depth,height},rotation:angle,offset_x:p.x-tile_x-.5,offset_z:p.z-tile_y-.5,elevation,
                            color:asset.color,...(asset.passable?{passable:true,cover_enabled:false}:{}),...(asset.baseType?{visual_asset:asset.id}:{}),
                            ...(asset.container?{contents:[],interactions:['open_container']}:{}),
                            furniture_condition:roomCondition}};
                        object.properties.furniture_generation={version:1,seed:String(seed),room_id:room.id,role:roomRole,wealth:roomWealth,condition:roomCondition,
                            original:JSON.parse(JSON.stringify(furnitureOriginal(object)))};
                        objects.push(object);poses.push(p);for(const k of keys)free.delete(k);
                        for(const chair of companions) {
                            if(objects.length>=256)break;
                            const tile_x=Math.floor(chair.x),tile_y=Math.floor(chair.z);
                            const seated={type:chair.asset.id,name:chair.asset.label,tile_x,tile_y,properties:{building_id:buildingId,level:currentLevel,
                                dimensions:{width:chair.width,depth:chair.depth,height:chair.height},rotation:chair.rotation,
                                offset_x:chair.x-tile_x-.5,offset_z:chair.z-tile_y-.5,
                                elevation:support.surfaceHeight-Number(groundHeight(tile_x,tile_y)),color:chair.asset.color,furniture_condition:roomCondition}};
                            seated.properties.furniture_generation={version:1,seed:String(seed),room_id:room.id,role:roomRole,wealth:roomWealth,condition:roomCondition,
                                original:JSON.parse(JSON.stringify(furnitureOriginal(seated)))};
                            objects.push(seated);poses.push(chair);for(const c of furnitureFootprint(chair))free.delete(key(c.x,c.z));
                        }
                        placed=true;break;
                    }
                }
                if(!placed && choices[index]==='household_bed_double') { choices[index]='household_bed_single';index--; }
                else if(!placed)diagnostics.skipped++;
            }
            // Accessories use real support heights and their own vertical layer.
            // They remain ordinary editable objects with the same replacement tag.
            const addAccessory=(id,p,elevation)=>{
                if(objects.length>=256||elevation<0||elevation>10)return;
                const asset=findLocationAsset(id);if(!asset)return;
                if(retained.some(o=>o.type===id&&structureLevel(o)===currentLevel&&o.properties?.furniture_generation?.room_id===room.id))return;
                const tile_x=Math.floor(p.x),tile_y=Math.floor(p.z);
                const angle=p.rotation||0;
                const footprint=furnitureFootprint({...p,width:asset.dimensions[0],depth:asset.dimensions[1],axis:{x:Math.cos(angle),z:-Math.sin(angle)},normal:{x:Math.sin(angle),z:Math.cos(angle)}});
                if(footprint.some(c=>!roomKeys.has(key(c.x,c.z))||occupiedCells.some(a=>a.level===currentLevel&&a.x===c.x&&a.z===c.z)))return;
                if([-1,1].some(x=>[-1,1].some(z=>!areas.some(a=>inside(a,p.x+x*asset.dimensions[0]/2*Math.cos(angle)+z*asset.dimensions[1]/2*Math.sin(angle),p.z-x*asset.dimensions[0]/2*Math.sin(angle)+z*asset.dimensions[1]/2*Math.cos(angle))))))return;
                const object={type:id,name:asset.label,tile_x,tile_y,properties:{building_id:buildingId,level:currentLevel,
                    dimensions:{width:asset.dimensions[0],depth:asset.dimensions[1],height:asset.dimensions[2]},
                    offset_x:p.x-tile_x-.5,offset_z:p.z-tile_y-.5,rotation:p.rotation||0,elevation,
                    passable:true,cover_enabled:false,color:asset.color,is_on:false,furniture_condition:roomCondition}};
                if(!hasFurnitureSupport(retained,object,groundHeight))return;
                object.properties.furniture_generation={version:1,seed:String(seed),room_id:room.id,role:roomRole,wealth:roomWealth,condition:roomCondition,
                    original:JSON.parse(JSON.stringify(furnitureOriginal(object)))};
                objects.push(object);
            };
            const local=objects.filter(o=>structureLevel(o)===currentLevel&&o.properties.furniture_generation.room_id===room.id);
            const table=local.find(o=>o.type==='table');
            if(table&&roomWealth!=='poor'&&random(`${room.id}:accessory`)<keep) {
                const p=structurePose(table);
                addAccessory(roomRole==='office'?'household_old_computer':'household_table_setting',
                    {...p,rotation:p.angle},Number(table.properties.elevation)+p.height+.015);
            }
            for(const [supportType,accessory] of [
                ['household_tv_stand',roomWealth==='rich'?'household_tv_flat':'household_tv_crt'],
                ['household_shop_counter','household_cash_register'],['household_workbench','household_vise'],
                ['household_kitchen_cabinet',roomRole==='dishwashing'?'household_dish_rack':'household_kitchen_set'],['household_cooker','household_pot']
            ]) {
                const base=local.find(o=>o.type===supportType);
                if(base&&random(`${room.id}:${accessory}`)<keep){const p=structurePose(base);
                    addAccessory(accessory,{...p,rotation:p.angle},Number(base.properties.elevation)+p.height+.012);}
            }
            const wallItems={boiler:['household_gas_boiler','household_switchboard'],laundry:['household_water_heater'],
                bathroom:['household_mirror','household_towel_rail'],bath:['household_mirror','household_towel_rail'],
                toilet:['household_mirror'],classroom:['household_blackboard'],dressing:['household_mirror'],
                bedroom:['household_radiator'],office:['household_radiator']}[roomRole]||[];
            for(const id of wallItems) {
                const asset=findLocationAsset(id),[width,depth,height]=asset.dimensions;
                const mount=walls.filter(w=>w.height>=Number(asset.elevation)+height+.035).flatMap(w=>[-1,1].flatMap(side=>[-.25,0,.25].map(offset=>({
                    x:w.x+w.axis.x*w.width*offset+w.normal.x*side*(w.depth/2+depth/2+.012),
                    z:w.z+w.axis.z*w.width*offset+w.normal.z*side*(w.depth/2+depth/2+.012),
                    rotation:Math.atan2(w.normal.x*side,w.normal.z*side),wall:w}))))
                    .find(p=>p.wall.width>=width+.1&&roomKeys.has(key(Math.floor(p.x),Math.floor(p.z)))
                        &&!windows.some(w=>distanceTo(p,w)<width/2+.2)&&!protect.some(w=>distanceTo(p,w)<width/2+.2)
                        &&!objects.filter(o=>structureLevel(o)===currentLevel&&o.properties?.furniture_generation
                            &&Number(o.properties.elevation)+Number(o.properties.dimensions?.height)>Number(asset.elevation)).some(o=>distanceTo(p,structurePose(o))<width/2+.1));
                if(mount){const support=areas.find(a=>inside(a,mount.x,mount.z));
                    if(support)addAccessory(id,mount,support.surfaceHeight-Number(groundHeight(Math.floor(mount.x),Math.floor(mount.z)))+Number(asset.elevation));}
            }
            if(roomCondition!=='intact'&&random(`${room.id}:litter`)>.5) {
                const cell=room.cells.find(c=>free.has(key(c.x,c.z))&&!reserved.has(key(c.x,c.z)));
                if(cell){const p={x:cell.x+.5,z:cell.z+.5},support=areas.find(a=>inside(a,p.x,p.z));
                    if(support)addAccessory(roomRole==='kitchen'?'household_fork':'household_litter',p,support.surfaceHeight-Number(groundHeight(cell.x,cell.z))+.003);}
            }
            if(roomRole!=='hallway'&&random(`${room.id}:fixture`)<keep) {
                // Ceiling fixtures follow the room, independently of furniture
                // and circulation reserved on the floor below them.
                const centre={x:room.cells.reduce((s,c)=>s+c.x+.5,0)/room.cells.length,
                    z:room.cells.reduce((s,c)=>s+c.z+.5,0)/room.cells.length};
                const [width,depth]=findLocationAsset('ceiling_bulb').dimensions;
                const p=[centre,...centers].sort((a,b)=>Math.hypot(a.x-centre.x,a.z-centre.z)-Math.hypot(b.x-centre.x,b.z-centre.z)).find(c=>{
                    const pose={...c,width,depth,axis:{x:1,z:0},normal:{x:0,z:1}};
                    return furnitureFootprint(pose).every(c=>roomKeys.has(key(c.x,c.z)))
                        && !hazards.some(h=>intersects(pose,h,.1))
                        && [-1,1].every(x=>[-1,1].every(z=>areas.some(a=>inside(a,c.x+x*width/2,c.z+z*depth/2))));
                });
                const support=p&&areas.find(a=>inside(a,p.x,p.z));
                if(support)addAccessory('ceiling_bulb',p,support.surfaceHeight-Number(groundHeight(Math.floor(p.x),Math.floor(p.z)))+2.36);
            }
            if(roomWealth==='rich'&&['living','bedroom','office'].includes(roomRole)&&random(`${room.id}:rug`)<keep) {
                const asset=findLocationAsset('household_floor_rug'),[width,depth]=asset.dimensions;
                const open=room.cells.filter(c=>free.has(key(c.x,c.z)));
                const centre=open.length?{x:open.reduce((s,c)=>s+c.x+.5,0)/open.length,z:open.reduce((s,c)=>s+c.z+.5,0)/open.length}:null;
                const seats=local.filter(o=>['household_armchair','chair','household_stool'].includes(o.type)).map(structurePose);
                const rugCandidates=[...centers,...seats].flatMap(c=>[0,Math.PI/2].map(rotation=>({...c,rotation})));
                const rugScore=p=>Math.min(centre?Math.hypot(p.x-centre.x,p.z-centre.z):Infinity,
                    ...seats.map(s=>Math.hypot(p.x-s.x,p.z-s.z)))-edgeDistance(p)*.1;
                const point=rugCandidates.sort((a,b)=>rugScore(a)-rugScore(b)).find(c=>{
                    const p={...c,width,depth,axis:{x:Math.cos(c.rotation),z:-Math.sin(c.rotation)},normal:{x:Math.sin(c.rotation),z:Math.cos(c.rotation)}};
                    return furnitureFootprint(p).every(c=>roomKeys.has(key(c.x,c.z)))
                        && !walls.some(w=>intersects(p,w))
                        && !protect.some(w=>intersects(p,w,.1))
                        && !local.filter(o=>!o.properties.passable&&!['table','chair','household_stool','household_armchair'].includes(o.type)).some(o=>intersects(p,structurePose(o)))
                        && [-1,1].every(x=>[-1,1].every(z=>areas.some(a=>inside(a,p.x+x*width/2*p.axis.x+z*depth/2*p.normal.x,p.z+x*width/2*p.axis.z+z*depth/2*p.normal.z))));
                });
                if(point){const support=areas.find(a=>inside(a,point.x,point.z));
                    if(support)addAccessory('household_floor_rug',point,support.surfaceHeight-Number(groundHeight(Math.floor(point.x),Math.floor(point.z)))+.002);}
            }
            if(roomWealth!=='poor'&&random(`${room.id}:wall-decor`)<keep) {
                const id=roomRole==='hallway'?'household_wall_shelf'
                    :roomWealth==='rich'&&random(`${room.id}:wall-style`)>.5?'household_wall_rug':'poster';
                const asset=findLocationAsset(id),[width,depth,height]=asset.dimensions;
                const mount=walls.filter(w=>w.height>=1.085+height).flatMap(w=>[-1,1].map(side=>({x:w.x+w.normal.x*side*(w.depth/2+depth/2+.025),
                    z:w.z+w.normal.z*side*(w.depth/2+depth/2+.025),rotation:Math.atan2(w.normal.x*side,w.normal.z*side),wall:w})))
                    .find(p=>p.wall.width>=width+.1&&roomKeys.has(key(Math.floor(p.x),Math.floor(p.z)))
                        && !windows.some(w=>distanceTo(p,w)<width/2+.3)&&!protect.some(w=>distanceTo(p,w)<width/2+.4)
                        && !poses.some(q=>q!==p.wall&&distanceTo(p,q)<width/2+.1));
                if(mount){const support=areas.find(a=>inside(a,mount.x,mount.z));
                    if(support)addAccessory(id,mount,support.surfaceHeight-Number(groundHeight(Math.floor(mount.x),Math.floor(mount.z)))+1.05);}
            }
        }
    }
    return {objects,replacedIds:replaced.map(o=>o.id),rooms,diagnostics,
        replacement:{building_id:buildingId,scope,level,room_id:scope==='room'?roomId:null,object_ids:replaced.map(o=>o.id),
            source_versions:source.map(o=>[o.id,o.revision])}};
}
