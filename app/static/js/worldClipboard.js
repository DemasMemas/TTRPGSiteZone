import { copy, equal } from './locationEditorHistory.js';
import { worldObjectGroupTransform } from './worldObjectSelection.js';

export const MAX_WORLD_CLIPBOARD_CELLS=4096, MAX_WORLD_CLIPBOARD_OBJECTS=1000;
const ref=(x,z)=>({chunk_x:Math.floor(x/32),chunk_y:Math.floor(z/32),tile_x:x%32,tile_y:z%32});
const key=(x,z)=>`${x},${z}`;
const directions={N:[0,-1],S:[0,1],W:[-1,0],E:[1,0],NW:[-1,-1],NE:[1,-1],SW:[-1,1],SE:[1,1]};
const field=(tile,name)=>({present:Object.hasOwn(tile,name),...(Object.hasOwn(tile,name)?{value:copy(tile[name])}:{})});
function safe(value){
    if(!value||typeof value!=='object')return;
    for(const [name,item]of Object.entries(value)){
        if(/^(id|location_id|character_id|marker_id|object_id|container_id|inventory_id|parent_id)$/.test(name)&&item!=null)throw Error(`Копирование игровой ссылки «${name}» не поддерживается.`);
        if(name==='contents'&&Array.isArray(item)&&item.length)throw Error('Сначала освободите игровой контейнер перед копированием.');
        safe(item);
    }
}
function trimRoadLinks(entries){
    const roads=new Set(entries.filter(e=>e.object.type==='road').map(e=>key(e.x,e.z)));
    for(const e of entries)if(e.object.type==='road')for(const name of ['connections','manual_connections'])if(Array.isArray(e.object[name])){
        e.object[name]=e.object[name].filter(direction=>{const d=directions[direction];return d&&roads.has(key(e.x+d[0],e.z+d[1]));});
    }
}
export function captureWorldObjects(members,getTile){
    if(!members.length)throw Error('Выберите объект или группу с Shift.');
    if(members.length>MAX_WORLD_CLIPBOARD_OBJECTS)throw Error(`Для одной вставки допускается до ${MAX_WORLD_CLIPBOARD_OBJECTS} объектов.`);
    const entries=members.map(m=>{
        const x=m.chunkX*32+m.tileX,z=m.chunkY*32+m.tileY,tile=getTile(x,z);
        if(!tile||!equal(tile.objects?.[m.index],m.object))throw Error('Выделенные объекты изменились. Выберите их снова.');
        safe(m.object);return{...copy(m),x,z,height:Number(tile.height??1)};
    });
    trimRoadLinks(entries);
    return{kind:'objects',entries};
}
export function captureWorldArea(bounds,getTile){
    const width=bounds.maxX-bounds.minX+1,height=bounds.maxZ-bounds.minZ+1;
    if(width*height>MAX_WORLD_CLIPBOARD_CELLS)throw Error(`Участок может содержать до ${MAX_WORLD_CLIPBOARD_CELLS} клеток.`);
    let count=0;const cells=[],objects=[];
    for(let z=0;z<height;z++)for(let x=0;x<width;x++){
        const tile=getTile(bounds.minX+x,bounds.minZ+z);
        if(!tile)throw Error('Дождитесь загрузки всех чанков выделенного участка.');
        safe(tile);const state=copy(tile);count+=(state.objects||[]).length;
        for(const object of state.objects||[])objects.push({x,z,object});
        cells.push({x,z,state});
    }
    if(count>MAX_WORLD_CLIPBOARD_OBJECTS)throw Error(`Для одной вставки допускается до ${MAX_WORLD_CLIPBOARD_OBJECTS} объектов.`);
    trimRoadLinks(objects);
    return{kind:'area',width,height,cells,count};
}
export function planWorldPaste(clipboard,point,{getTile,width,height}){
    const cells=new Map(),objects=[],references=[];
    const cellAt=(x,z)=>{
        if(x<0||z<0||x>=width||z>=height)throw Error('Вставка выходит за границы карты.');
        const k=key(x,z);if(cells.has(k))return cells.get(k);
        const before=getTile(x,z);if(!before)throw Error('Дождитесь загрузки чанков места вставки.');
        if(clipboard.kind==='area')safe(before);
        const c={...ref(x,z),x,z,original:copy(before),state:copy(before)};cells.set(k,c);return c;
    };
    if(clipboard.kind==='objects'){
        const x=Math.floor(point.x),z=Math.floor(point.z);
        const plans=worldObjectGroupTransform(clipboard.entries,{x:point.x-x-.5,z:point.z-z-.5},{tile_x:x,tile_y:z},width,height);
        if(!plans)throw Error('Группа выходит за границы карты.');
        for(const plan of plans){
            const cell=cellAt(plan.target.tile_x,plan.target.tile_y),object={...copy(plan.reference.object),...plan.changes};
            if(object.type==='road'&&Number.isFinite(object.bridge_height))object.bridge_height+=Number(cell.state.height??1)-plan.reference.height;
            const index=(cell.state.objects||[]).length;cell.state.objects=[...(cell.state.objects||[]),object];
            references.push({chunkX:cell.chunk_x,chunkY:cell.chunk_y,tileX:cell.tile_x,tileY:cell.tile_y,index});
            objects.push({x:cell.x,z:cell.z,object,tile:cell.state});
        }
    }else{
        const x=Math.floor(point.x),z=Math.floor(point.z);
        for(const source of clipboard.cells){const cell=cellAt(x+source.x,z+source.z);cell.state=copy(source.state);
            for(const [index,object]of (cell.state.objects||[]).entries()){
                objects.push({x:cell.x,z:cell.z,object,tile:cell.state});
                references.push({chunkX:cell.chunk_x,chunkY:cell.chunk_y,tileX:cell.tile_x,tileY:cell.tile_y,index});
            }
        }
    }
    const changed=[...cells.values()].flatMap(c=>{
        const keys=[...new Set([...Object.keys(c.original),...Object.keys(c.state)])].filter(k=>!equal(field(c.original,k),field(c.state,k)));
        return keys.length?[{chunk_x:c.chunk_x,chunk_y:c.chunk_y,tile_x:c.tile_x,tile_y:c.tile_y,
            before:Object.fromEntries(keys.map(k=>[k,field(c.original,k)])),after:Object.fromEntries(keys.map(k=>[k,field(c.state,k)]))}]:[];
    });
    return{command:{objects:[],tiles:[],cells:changed},cells:[...cells.values()],objects,references};
}
