import { structurePose, structureLevel, structureBuildingId } from './locationArchitecture.js';

// Plans only partitions. Slabs, shafts, stairs, exterior walls and hand placed
// objects retain their IDs and geometry, including damage already in the shell.
export function planBuildingInterior(source, { buildingId, level = 0, seed = '0',
    buildingType = 'residential', wealth, condition } = {}) {
    if (!buildingId || !Number.isInteger(level) || !Array.isArray(source)) return { error: 'Выберите здание и этаж' };
    const peers = source.filter(o => structureBuildingId(o) === buildingId);
    const floor = peers.filter(o => structureLevel(o) === level);
    const previous = floor.filter(o => ['wall','door'].includes(o.type) && o.properties?.layout_generation?.version === 1);
    const kept = floor.filter(o => !previous.includes(o));
    const spec = kept.find(o => o.properties?.building_generation)?.properties.building_generation;
    wealth ??= spec?.wealth || 'ordinary';
    condition ??= spec?.condition || 'intact';
    if (!['poor', 'ordinary', 'rich'].includes(wealth)
        || !['intact', 'worn', 'damaged', 'ruins'].includes(condition)
        || !['residential', 'shop', 'warehouse'].includes(buildingType)) return { error: 'Неизвестные параметры планировки' };
    const slabs = kept.filter(o => o.type === 'floor');
    if (!slabs.length) return { error: 'На выбранном этаже нет перекрытия' };
    if (slabs.some(o => Math.abs(Number(o.properties?.elevation || 0) - Number(slabs[0].properties?.elevation || 0)) > .01)) {
        return { error: 'Для планировки нужен пол на одной высоте' };
    }
    const elevation = Number(slabs[0].properties?.elevation || 0);
    const poses = slabs.map(structurePose);
    const inside = (p, x, z, margin = 0) => Math.abs((x-p.x)*p.axis.x+(z-p.z)*p.axis.z) <= p.width/2+margin
        && Math.abs((x-p.x)*p.normal.x+(z-p.z)*p.normal.z) <= p.depth/2+margin;
    const holes = kept.filter(o => ['floor_opening', 'hatch'].includes(o.type)).map(structurePose);
    const circulation = peers.filter(o => ['stairs', 'ladder'].includes(o.type)
        && [level, level-1].includes(structureLevel(o))).map(structurePose);
    const incoming = peers.filter(o => ['stairs', 'ladder'].includes(o.type)
        && structureLevel(o) === level-1).map(structurePose);
    const protectedPoses = [...holes, ...circulation,
        ...kept.filter(o => {
            if (['floor', 'roof', 'ceiling', 'floor_opening', 'hatch', 'window'].includes(o.type)) return false;
            if (o.type !== 'wall') return true;
            const p=structurePose(o);
            return [-1,1].every(s=>poses.some(f=>inside(f,p.x+s*p.normal.x*.4,p.z+s*p.normal.z*.4)));
        }).map(structurePose)];
    const corners = poses.flatMap(p => [-1,1].flatMap(a => [-1,1].map(b => ({
        x:p.x+a*p.width/2*p.axis.x+b*p.depth/2*p.normal.x,
        z:p.z+a*p.width/2*p.axis.z+b*p.depth/2*p.normal.z,
    }))));
    const minX = Math.floor(Math.min(...corners.map(p=>p.x))), maxX = Math.ceil(Math.max(...corners.map(p=>p.x)));
    const minZ = Math.floor(Math.min(...corners.map(p=>p.z))), maxZ = Math.ceil(Math.max(...corners.map(p=>p.z)));
    if ((maxX-minX)*(maxZ-minZ) > 4096) return { error: 'Планировка поддерживает контур до 4096 м²' };
    const key = (x,z) => `${x}:${z}`;
    const cells = [];
    for (let z=minZ;z<maxZ;z++) for(let x=minX;x<maxX;x++) {
        // Sample the entire tile, rather than bridging a courtyard or a collapsed slab.
        if ([-.49,0,.49].every(dx=>[-.49,0,.49].every(dz=>
            poses.some(p=>inside(p,x+.5+dx,z+.5+dz)) && !holes.some(p=>inside(p,x+.5+dx,z+.5+dz))
            && !incoming.some(p=>inside(p,x+.5+dx,z+.5+dz))))) cells.push({x,z});
    }
    if (!cells.length) return { error: 'Нет целых участков пола для планировки' };
    const neighbors = c => [[c.x-1,c.z],[c.x+1,c.z],[c.x,c.z-1],[c.x,c.z+1]].map(([x,z])=>key(x,z));
    const components = list => {
        const remaining = new Map(list.map(c=>[key(c.x,c.z),c])), result=[];
        while (remaining.size) {
            const start=remaining.values().next().value, queue=[start]; remaining.delete(key(start.x,start.z));
            for(let i=0;i<queue.length;i++) for(const k of neighbors(queue[i])) if(remaining.has(k)) {
                queue.push(remaining.get(k));remaining.delete(k);
            }
            result.push(queue);
        }
        return result;
    };
    const random = text => {
        let h=2166136261;for(const c of `${seed}:${level}:${text}`) h=Math.imul(h^c.charCodeAt(0),16777619);
        return (h>>>0)/4294967296;
    };
    const minimum = buildingType==='warehouse' ? 24 : wealth==='rich' ? 16 : wealth==='poor' ? 18 : 10;
    const limit = {residential:{poor:2,ordinary:5,rich:8},shop:{poor:2,ordinary:4,rich:6},warehouse:{poor:1,ordinary:2,rich:3}}[buildingType][wealth];
    const rooms = components(cells).map(cells=>({cells}));
    const cuts=[];
    while(rooms.length<limit) {
        let best=null;
        for(const room of rooms) for(const axis of ['x','z']) {
            const lo=Math.min(...room.cells.map(c=>c[axis])),hi=Math.max(...room.cells.map(c=>c[axis]));
            for(let at=lo+2;at<=hi-1;at++) {
                const a=room.cells.filter(c=>c[axis]<at),b=room.cells.filter(c=>c[axis]>=at);
                if(Math.min(a.length,b.length)<minimum || components(a).length!==1 || components(b).length!==1) continue;
                const aset=new Set(a.map(c=>key(c.x,c.z)));
                const boundary=b.filter(c=>aset.has(key(c.x-(axis==='x'?1:0),c.z-(axis==='z'?1:0))));
                const bset=new Set(b.map(c=>key(c.x,c.z)));
                // Wall thickness occupies both neighbouring server tiles. Keep
                // three metres on each side, including narrow wings of concave shapes.
                if(boundary.some(c=>!aset.has(key(c.x-(axis==='x'?3:0),c.z-(axis==='z'?3:0)))
                    || !bset.has(key(c.x+(axis==='x'?2:0),c.z+(axis==='z'?2:0))))) continue;
                const edges=boundary
                    .map(c=>({x:axis==='x'?at:c.x+.5,z:axis==='z'?at:c.z+.5}));
                // Never cut an approach to an existing doorway, ladder, hatch,
                // manual furnishing or wall. Holes remain the shell's responsibility.
                if(!edges.length || edges.some(e=>protectedPoses.some(p=>inside(p,e.x,e.z,.8)))) continue;
                const score=Math.min(a.length,b.length)+random(`${axis}:${at}:${lo}:${hi}`)*3;
                if(!best || score>best.score) best={room,a,b,axis,at,edges,score};
            }
        }
        if(!best) break;
        rooms.splice(rooms.indexOf(best.room),1,{cells:best.a},{cells:best.b});
        cuts.push(best);
    }
    const generation={version:1,seed:String(seed),buildingType,wealth,condition};
    const objects=[],connections=[];
    const add=(type,x,z,width,rotation,height,extra={})=>{
        const tile_x=Math.max(minX,Math.min(maxX-1,Math.floor(x))),tile_y=Math.max(minZ,Math.min(maxZ-1,Math.floor(z)));
        objects.push({type,name:type==='wall'?'Внутренняя перегородка':'Межкомнатный проход',tile_x,tile_y,
            properties:{building_id:buildingId,level,offset_x:x-tile_x-.5,offset_z:z-tile_y-.5,
                rotation,elevation,dimensions:{width,depth:type==='wall'?.14:.18,height},layout_generation:generation,...extra}});
    };
    for(const cut of cuts) {
        const along=cut.axis==='x'?'z':'x', sorted=cut.edges.sort((a,b)=>a[along]-b[along]),runs=[];
        for(const e of sorted) {
            const run=runs.at(-1);
            if(run && Math.abs(run.at(-1)[along]+1-e[along])<.01) run.push(e);else runs.push([e]);
        }
        for(const run of runs) {
            // A narrow seam stays open; do not turn it into a blocked dead end.
            if(run.length<3) continue;
            const rotation=cut.axis==='x'?-Math.PI/2:0;
            const center={x:(run[0].x+run.at(-1).x)/2,z:(run[0].z+run.at(-1).z)/2};
            const roll=random(`damage:${cut.axis}:${cut.at}:${run[0][along]}`);
            const missing=condition==='ruins'&&roll<.65 || condition==='damaged'&&roll<.25;
            if(missing) continue;
            // Doors are aligned with tile centres for the server's physical routes.
            const door=run[1+Math.floor(random(`door:${cut.axis}:${cut.at}`)*(run.length-2))];
            const broken=condition==='ruins'||condition==='damaged'&&roll<.7;
            if(broken) {
                // Missing wall section with an irregular low remnant. The 1.2 m
                // gap is real geometry, so collision and rendering agree.
                const start=run[0][along]-.5,end=run.at(-1)[along]+.5;
                for(const [lo,hi] of [[start,door[along]-.6],[door[along]+.6,end]]) if(hi-lo>.1) {
                    add('wall',cut.axis==='x'?cut.at:(lo+hi)/2,cut.axis==='z'?cut.at:(lo+hi)/2,
                        hi-lo,rotation,.5+roll,{visual_asset:'inner_wall'});
                }
            } else {
                add('wall',center.x,center.z,run.length,rotation,2.4,{visual_asset:'inner_wall'});
                const opening=condition==='worn'&&roll<.35;
                add('door',door.x,door.z,1.1,rotation,2,{is_open:true,
                    ...(opening?{visual_asset:'opening',interactions:[]}:{color:wealth==='rich'?'#78654e':'#665c4c'})});
            }
            connections.push({x:door.x,z:door.z});
        }
    }
    const roles=level<0?['Техническое помещение','Кладовая']
        :buildingType==='warehouse'?['Склад','Подсобное помещение','Техническое помещение']
        :buildingType==='shop'?['Торговый зал','Склад','Кабинет','Подсобное помещение']
        :['Гостиная · прихожая','Кухня','Спальня','Санузел','Кабинет','Спальня','Кладовая','Гостевая'];
    const roomPlan=rooms.map((r,i)=>({id:`room-${level}-${i}`,name:roles[i%roles.length],cells:r.cells}));
    if(objects.length) objects[0].properties.layout_rooms=roomPlan;
    return {objects,rooms:roomPlan,connections,generation,replacedIds:previous.map(o=>o.id).filter(Number.isInteger)};
}
