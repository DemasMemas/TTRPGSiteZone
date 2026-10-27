import { structurePose, structureLevel, structureBuildingId, floorVisualPose, floorSlabParts, doorOnWall } from './locationArchitecture.js';
import { findLocationAsset } from './locationAssetCatalog.js';

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
function parts(source,buildingId,level,groundHeight=()=>0) {
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
        const areas=parts(source,buildingId,level),cells=floorCells(areas);
        const rooms=saved?.length?saved:components(cells).map((list,i)=>({id:`open-${level}-${i}`,
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
function roleOf(name) {
    if(/спаль|гостев/i.test(name))return 'bedroom';
    if(/кухн/i.test(name))return 'kitchen';
    if(/сануз|ванн/i.test(name))return 'bathroom';
    if(/кабинет/i.test(name))return 'office';
    if(/технич/i.test(name))return 'technical';
    if(/склад|кладов|подсоб/i.test(name))return 'storage';
    if(/торгов/i.test(name))return 'shop';
    return 'living';
}
function recipe(role,wealth) {
    const rich=wealth==='rich',poor=wealth==='poor';
    return {
        bedroom:[rich?'household_bed_double':'household_bed_single','household_nightstand','household_wardrobe','household_dresser','household_armchair','household_nightstand'],
        kitchen:[poor?'household_wood_stove':'household_cooker','household_sink',poor?'household_stool':'table','household_refrigerator','household_kitchen_cabinet','chair','chair'],
        bathroom:['household_toilet','household_washbasin','household_bathtub','household_storage_rack'],
        office:['table','chair','shelf','household_dresser','household_armchair','household_storage_rack'],
        technical:['household_generator','household_storage_rack','household_jerrycan','household_wood_crate','household_cardboard_box'],
        storage:['household_storage_rack','household_wood_crate','household_cardboard_box','shelf','household_wood_crate','household_jerrycan'],
        shop:['shelf','table','household_storage_rack','chair','household_wood_crate','shelf'],
        living:[poor?'table':'household_armchair','table',poor?'household_stool':'chair','shelf','household_wardrobe','household_armchair','chair','household_dresser'],
    }[role];
}

export function planBuildingFurniture(source,{buildingId,scope='floor',level=0,roomId=null,seed='0',
    wealth='auto',condition='auto',role='auto',empty=false,occupiedCells=[],groundHeight=()=>0}={}) {
    if(!buildingId||!['room','floor','building'].includes(scope)||!Number.isInteger(level))return {error:'Выберите здание и область меблировки'};
    if(!['auto','poor','ordinary','rich'].includes(wealth)||!['auto','intact','worn','damaged','ruins'].includes(condition)
        ||!['auto','bedroom','kitchen','bathroom','office','technical','storage','shop','living'].includes(role))return {error:'Неизвестные параметры меблировки'};
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
        const areas=parts(source,buildingId,currentLevel,groundHeight),floor=floorCells(areas);
        if(floor.size>4096)return {error:'Меблировка поддерживает до 4096 клеток пола на этаже'};
        const sameLevel=retained.filter(o=>structureLevel(o)===currentLevel);
        const hazards=retained.filter(o=>['stairs','ladder'].includes(o.type)&&[currentLevel,currentLevel-1].includes(structureLevel(o))
            ||['hatch','floor_opening'].includes(o.type)&&structureLevel(o)===currentLevel).map(structurePose);
        const doors=sameLevel.filter(o=>o.type==='door');
        const obstacles=sameLevel.filter(o=>!['floor','ceiling','roof','floor_opening','hatch','stairs','ladder','door'].includes(o.type));
        const poses=obstacles.map(structurePose);
        const walls=obstacles.filter(o=>o.type==='wall').map(structurePose);
        const blocked=new Set();
        for(const o of obstacles) {
            const cut=new Set(o.type==='wall'?doors.filter(d=>doorOnWall(d,o)).flatMap(d=>furnitureFootprint(structurePose(d)).map(c=>key(c.x,c.z))):[]);
            for(const c of furnitureFootprint(structurePose(o)))if(!cut.has(key(c.x,c.z)))blocked.add(key(c.x,c.z));
        }
        const free=new Map([...floor].filter(([k])=>!blocked.has(k)));
        const reserved=new Set(occupiedCells.filter(c=>c.level===currentLevel).map(c=>key(c.x,c.z)));
        const protect=[...hazards,...doors.map(structurePose)];
        for(const p of protect)for(const c of furnitureFootprint({...p,width:p.width+1.5,depth:p.depth+1.5}))reserved.add(key(c.x,c.z));
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
            const choices=recipe(roomRole,roomWealth),roomKeys=new Set(room.cells.map(c=>key(c.x,c.z)));
            const amount=Math.min(choices.length,{poor:3,ordinary:5,rich:8}[roomWealth]);
            const keep={intact:1,worn:.75,damaged:.45,ruins:.16}[roomCondition];
            const centers=room.cells.flatMap(c=>[0,.5].flatMap(dx=>[0,.5].map(dz=>({x:c.x+.25+dx,z:c.z+.25+dz}))));
            const edgeDistance=p=>Math.min(...walls.map(w=>distanceTo(p,w)),4);
            for(let index=0;index<amount&&objects.length<256;index++) {
                if(random(`${currentLevel}:${room.id}:keep:${index}`)>keep)continue;
                const asset=findLocationAsset(choices[index]);if(!asset)continue;
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
                const ranked=centers.map(center=>({center,score:score(center)})).sort((a,b)=>a.score-b.score).slice(0,600);
                let placed=false;
                for(const {center} of ranked) {
                    if(placed)break;
                    if(reserved.has(key(Math.floor(center.x),Math.floor(center.z))))continue;
                    const orientationScore=quarter=>{
                        const normal={x:Math.sin(quarter*Math.PI/2),z:Math.cos(quarter*Math.PI/2)};
                        if(['chair','household_stool'].includes(asset.id)&&tablePose)return -normal.x*(tablePose.x-center.x)-normal.z*(tablePose.z-center.z);
                        return edgeDistance({x:center.x-normal.x*depth/2,z:center.z-normal.z*depth/2});
                    };
                    for(const quarter of [0,1,2,3].sort((a,b)=>orientationScore(a)-orientationScore(b))) {
                        diagnostics.candidates++;
                        const angle=quarter*Math.PI/2+(roomCondition==='damaged'||roomCondition==='ruins'?(random(`${room.id}:angle:${index}`)-.5)*.18:0);
                        const p={...center,width,depth,height,axis:{x:Math.cos(angle),z:-Math.sin(angle)},normal:{x:Math.sin(angle),z:Math.cos(angle)}};
                        const footprint=furnitureFootprint(p),keys=footprint.map(c=>key(c.x,c.z));
                        if(keys.some(k=>reserved.has(k)||!roomKeys.has(k)))continue;
                        if(poses.some(q=>intersects(p,q))||protect.some(q=>intersects(p,q,.8)))continue;
                        const support=areas.find(a=>inside(a,p.x,p.z));if(!support)continue;
                        let supported=true;
                        const samples=size=>Array.from({length:Math.ceil(size/.2)+1},(_,i)=>-size/2+size*i/Math.ceil(size/.2));
                        for(const x of samples(width))for(const z of samples(depth)) {
                            if(!areas.some(a=>Math.abs(a.surfaceHeight-support.surfaceHeight)<.01&&inside(a,p.x+x*p.axis.x+z*p.normal.x,p.z+x*p.axis.z+z*p.normal.z))){supported=false;break;}
                        }
                        if(!supported)continue;
                        const next=new Map([...free].filter(([k])=>!keys.includes(k)));
                        if(components(next).length!==components(free).length)continue;
                        const tile_x=Math.floor(p.x),tile_y=Math.floor(p.z);
                        const elevation=support.surfaceHeight-Number(groundHeight(tile_x,tile_y));
                        if(!Number.isFinite(elevation)||elevation<0||elevation>10)continue;
                        const object={type:asset.baseType||asset.id,name:asset.label,tile_x,tile_y,properties:{building_id:buildingId,level:currentLevel,
                            dimensions:{width,depth,height},rotation:angle,offset_x:p.x-tile_x-.5,offset_z:p.z-tile_y-.5,elevation,
                            color:asset.color,...(asset.baseType?{visual_asset:asset.id}:{}),
                            ...(asset.container?{contents:[],interactions:['open_container']}:{}),
                            furniture_condition:roomCondition}};
                        object.properties.furniture_generation={version:1,seed:String(seed),room_id:room.id,role:roomRole,wealth:roomWealth,condition:roomCondition,
                            original:JSON.parse(JSON.stringify(furnitureOriginal(object)))};
                        objects.push(object);poses.push(p);for(const k of keys)free.delete(k);
                        placed=true;break;
                    }
                }
                if(!placed)diagnostics.skipped++;
            }
        }
    }
    return {objects,replacedIds:replaced.map(o=>o.id),rooms,diagnostics,
        replacement:{building_id:buildingId,scope,level,room_id:scope==='room'?roomId:null,object_ids:replaced.map(o=>o.id),
            source_versions:source.map(o=>[o.id,o.revision])}};
}
