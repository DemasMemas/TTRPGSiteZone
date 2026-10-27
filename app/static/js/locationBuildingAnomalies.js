import { structurePose, structureLevel, structureBuildingId, doorOnWall } from './locationArchitecture.js';
import { getFurnitureRooms, buildingFloorParts, furnitureFootprint } from './locationFurnitureGenerator.js';

// Ordinary LocationObjects: persistence, transforms, combat and synchronization
// use the same paths as hand placed objects. Re-running only fills vacancies.
export function planBuildingAnomalies(source,{buildingId,seed='0',density=1,catalog=[],groundHeight=()=>0,
    occupiedCells=[],tileAnomalies=[]}={}) {
    if(!buildingId||!Number.isFinite(density)||density<.25||density>2||!catalog.length)
        return {error:'Выберите здание, плотность 0.25–2 и доступные типы аномалий'};
    const rooms=getFurnitureRooms(source,buildingId),objects=[];
    if(!rooms.length)return {error:'В здании нет доступных участков пола'};
    const hash=value=>{let h=2166136261;for(const c of `${seed}:${value}`)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
    for(const level of [...new Set(rooms.map(r=>r.level))]) {
        const areas=buildingFloorParts(source,buildingId,level,groundHeight);
        const cells=new Map(rooms.filter(r=>r.level===level).flatMap(r=>r.cells).map(c=>[`${c.x}:${c.z}`,c]));
        const peers=source.filter(o=>structureLevel(o)===level);
        const blocked=new Set(occupiedCells.filter(c=>c.level===level).map(c=>`${c.x}:${c.z}`));
        const doors=peers.filter(o=>o.type==='door');
        const existing=[...peers.filter(o=>o.type==='anomaly'),...tileAnomalies.filter(o=>structureLevel(o)===level)];
        const count=existing.filter(o=>structureBuildingId(o)===buildingId||cells.has(`${o.tile_x}:${o.tile_y}`)).length;
        const maximum=Math.min(12,Math.max(1,Math.floor(cells.size*density/48)));
        for(const o of source.filter(o=>structureLevel(o)===level
            ||['stairs','ladder'].includes(o.type)&&structureLevel(o)===level-1)) {
            if(['floor','ceiling','roof'].includes(o.type)||o.properties?.passable===true&&!['stairs','ladder','floor_opening'].includes(o.type))continue;
            const cut=new Set(o.type==='wall'?doors.filter(d=>doorOnWall(d,o)).flatMap(d=>furnitureFootprint(structurePose(d)).map(c=>`${c.x}:${c.z}`)):[]);
            const p=structurePose(o),margin=['door','stairs','ladder','hatch','floor_opening'].includes(o.type)?1:0;
            for(const c of furnitureFootprint({...p,width:p.width+margin,depth:p.depth+margin}))
                if(!cut.has(`${c.x}:${c.z}`))blocked.add(`${c.x}:${c.z}`);
        }
        // Reachability uses the same conservative rotated footprints as movement.
        const free=new Map([...cells].filter(([k])=>!blocked.has(k)));
        const starts=doors.flatMap(d=>{
            const p=structurePose(d);
            return [-1,1].map(s=>({x:Math.floor(p.x+s*p.normal.x),z:Math.floor(p.z+s*p.normal.z)}));
        }).filter(c=>free.has(`${c.x}:${c.z}`));
        const reachable=new Set(),queue=starts.length?starts:[...free.values()].slice(0,1);
        for(const c of queue)reachable.add(`${c.x}:${c.z}`);
        for(let i=0;i<queue.length;i++)for(const [x,z] of [[queue[i].x-1,queue[i].z],[queue[i].x+1,queue[i].z],[queue[i].x,queue[i].z-1],[queue[i].x,queue[i].z+1]]) {
            const k=`${x}:${z}`;if(free.has(k)&&!reachable.has(k)){reachable.add(k);queue.push(free.get(k));}
        }
        const ranked=[...free.values()].filter(c=>reachable.has(`${c.x}:${c.z}`)).sort((a,b)=>hash(`${level}:${a.x}:${a.z}`)-hash(`${level}:${b.x}:${b.z}`));
        let added=0;
        for(const c of ranked) {
            if(count+added>=maximum)break;
            const x=c.x+.5,z=c.z+.5;
            if([...existing,...objects.filter(o=>structureLevel(o)===level)].some(o=>{
                const p=structurePose(o);return Math.hypot(p.x-x,p.z-z)<3+Math.max(p.width,p.depth)/2;
            }))continue;
            const support=areas.find(a=>[-.49,.49].every(dx=>[-.49,.49].every(dz=>{
                const px=x+dx-a.x,pz=z+dz-a.z;
                return Math.abs(px*a.axis.x+pz*a.axis.z)<=a.width/2&&Math.abs(px*a.normal.x+pz*a.normal.z)<=a.depth/2;
            })));
            if(!support)continue;
            const elevation=support.surfaceHeight-Number(groundHeight(c.x,c.z));
            if(elevation<0||elevation>10)continue;
            const profile=catalog[hash(`type:${level}:${c.x}:${c.z}`)%catalog.length];
            objects.push({type:'anomaly',name:profile.name,tile_x:c.x,tile_y:c.z,properties:{building_id:buildingId,level,
                elevation,dimensions:{width:1,depth:1,height:1},passable:true,cover_enabled:false,
                anomaly_key:profile.key,anomalyType:profile.visual||'void',color:'#79d7dd',
                anomaly_generation:{version:1,seed:String(seed),density}}});
            added++;
        }
    }
    return {objects,sourceVersions:source.map(o=>[o.id,o.revision])};
}
