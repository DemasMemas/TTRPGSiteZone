import { STOREY_HEIGHT, structureLevel, structureBuildingId, structurePose, doorOnWall } from './locationArchitecture.js';

const clone = value => structuredClone(value);
const unsafe = /^(roof_(section|wall|wall_geometry|geometry|joint|group|ground_anchor|ground_delta)|generated_floor_spec|.*_generation)$/;
const reference = /(^|_)(object|wall|floor|parent|target|roof|stair|ladder|hatch)_?ids?$/i;
const catalogReferences = new Set(['building_id','asset_id','model_id','item_id','key_id','owner_id']);
let fallbackSerial=0;

export function freshClipboardBuildingId(entropy = globalThis.crypto) {
    if(entropy?.randomUUID)return `copy-${entropy.randomUUID()}`;
    // LAN HTTP pages may expose getRandomValues but not secure-context UUIDs.
    if(entropy?.getRandomValues) {
        const values=entropy.getRandomValues(new Uint32Array(4));
        return `copy-${[...values].map(n=>n.toString(16).padStart(8,'0')).join('')}`;
    }
    return `copy-${Date.now().toString(36)}-${++fallbackSerial}-${Math.random().toString(36).slice(2)}`;
}

function checkProperties(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
        if (unsafe.test(key) && item != null && item !== false && item !== '' && (!Array.isArray(item)||item.length)) throw Error('Копирование составных крыш и данных процедурного здания пока не поддерживается. Выберите обычные ручные элементы.');
        if ((reference.test(key) || /(_ids?|Id|Ids)$/.test(key) && !catalogReferences.has(key)) && item != null) throw Error(`Копирование ссылки «${key}» пока не поддерживается.`);
        if (key === 'contents' && Array.isArray(item) && item.length) throw Error('Копирование заполненных контейнеров пока не поддерживается.');
        checkProperties(item);
    }
}

export function floorAt(objects, x, z, level, buildingId = null, margin = .001) {
    return objects.find(o => {
        if (o.type !== 'floor' || structureLevel(o) !== level || (buildingId && structureBuildingId(o) !== buildingId)) return false;
        const p = structurePose(o), dx = x-p.x, dz = z-p.z;
        return Math.abs(dx*p.axis.x+dz*p.axis.z) <= p.width/2+margin
            && Math.abs(dx*p.normal.x+dz*p.normal.z) <= p.depth/2+margin;
    });
}

function overlaps(a,b) {
    const p=structurePose(a),q=structurePose(b),dx=q.x-p.x,dz=q.z-p.z;
    return [p.axis,p.normal,q.axis,q.normal].every(axis=>{
        const radius=o=>(Math.abs(o.axis.x*axis.x+o.axis.z*axis.z)*o.width+Math.abs(o.normal.x*axis.x+o.normal.z*axis.z)*o.depth)/2;
        return Math.abs(dx*axis.x+dz*axis.z)<radius(p)+radius(q)-.001;
    });
}

export function captureLocationClipboard(entries, { objects = [], groundAt, sourceLevel, floorOffset = 0 } = {}) {
    if (!entries.length) throw Error('Сначала выберите объект или группу объектов.');
    if (entries.length > 5000) throw Error('Слишком много объектов для одной вставки.');
    for (const entry of entries) {
        if (!['structure', 'decor', 'lamp'].includes(entry.kind) || !entry.source) throw Error('Этот тип объекта нельзя скопировать.');
        if(entry.kind==='structure'&&(entry.source.type==='ground_item'||entry.source.properties?.is_ground_item))throw Error('Копирование игровых предметов на земле пока не поддерживается.');
        checkProperties(entry.kind === 'structure' ? entry.source.properties : entry.source);
    }
    const pivot = { x: entries.reduce((v,e)=>v+e.x,0)/entries.length, z: entries.reduce((v,e)=>v+e.z,0)/entries.length };
    const level = sourceLevel ?? Math.min(...entries.map(e=>e.level));
    const hasFloors = entries.some(e=>e.kind==='structure'&&e.source.type==='floor');
    const support = hasFloors ? null : floorAt(objects, pivot.x, pivot.z, level);
    return clone({ entries, pivot, level, hasFloors,
        anchorHeight: groundAt(pivot.x,pivot.z)+level*STOREY_HEIGHT+(support ? Number(support.properties?.elevation||0)+floorOffset : 0) });
}

// Planning is read-only. The caller supplies fresh building names for each
// paste attempt, while the same names remain stable as its preview moves.
export function planLocationPaste(clipboard, { x, z, level, width, height, objects = [], groundAt, buildingNames, floorOffset = 0 }) {
    const supports=new Map();
    const remember=o=>{if(o?.id>0)supports.set(o.id,o.revision);return o;};
    const findFloor=(...args)=>remember(floorAt(...args));
    const lamps=clipboard.entries.filter(e=>e.kind==='lamp');
    // Lamps use the established server precision of 0.001. Quantize the common
    // translation, never each item separately, so mixed groups stay aligned.
    const precise=value=>lamps.length?Math.round(value*1000)/1000:value;
    const dx=precise(x-clipboard.pivot.x), dz=precise(z-clipboard.pivot.z), dl=level-clipboard.level;
    const support = clipboard.hasFloors ? null : findFloor(objects,x,z,level);
    let dy=groundAt(x,z)+level*STOREY_HEIGHT+(support ? Number(support.properties?.elevation||0)+floorOffset : 0)-clipboard.anchorHeight;
    if(lamps.length) {
        const first=lamps[0],h=first.baseHeight+dy-groundAt(first.x+dx,first.z+dz);
        dy+=Math.round(h*1000)/1000-h;
    }
    const entries=clipboard.entries.map(entry=>{
        const source=clone(entry.source), nx=entry.x+dx, nz=entry.z+dz, nextLevel=entry.level+dl;
        const base=entry.baseHeight+dy-groundAt(nx,nz);
        if(entry.kind==='structure') {
            delete source.id; delete source.revision;
            source.tile_x=Math.floor(nx);source.tile_y=Math.floor(nz);
            source.properties={...source.properties,offset_x:nx-source.tile_x-.5,offset_z:nz-source.tile_y-.5,
                level:nextLevel,elevation:base-nextLevel*STOREY_HEIGHT};
        } else if(entry.kind==='decor') {
            source.x=nx-Math.floor(nx)-.5;source.z=nz-Math.floor(nz)-.5;
            source.level=nextLevel;source.elevation=base-nextLevel*STOREY_HEIGHT;
        } else { source.x=nx;source.z=nz;source.level=nextLevel;source.height=Math.round(base*1000)/1000; }
        if(entry.kind!=='lamp') {
            const props=entry.kind==='structure'?source.properties:source;
            if(Math.abs(props.elevation)<1e-9)props.elevation=0;
        }
        return { ...entry, source, x:nx,z:nz,level:nextLevel,
            lampPrecisionError:entry.kind==='lamp'?Math.abs(base*1000-Math.round(base*1000)):0 };
    });
    let error=null;
    const fail=message=>{error ||= message;};
    if(!Number.isInteger(level)||!Number.isFinite(x)||!Number.isFinite(z))fail('Некорректный этаж или положение вставки.');
    const structures=entries.filter(e=>e.kind==='structure');
    const groups=new Map();
    for(const e of structures) {
        const original=structureBuildingId(e.source)||'';
        if(!groups.has(original))groups.set(original,[]);
        groups.get(original).push(e);
    }
    for(const [original,group]of groups) {
        const floors=group.filter(e=>e.source.type==='floor');
        const copiedWall=group.some(e=>e.source.type==='wall');
        for(const e of group) {
            let id;
            if(floors.length && level===0) {
                id=buildingNames[original];
                if(!id)fail('Не удалось назначить новый ID копии здания.');
            }
            else {
                let target=findFloor(objects,e.x,e.z,e.level)
                    || (e.source.type==='floor' ? findFloor(objects,e.x,e.z,e.level+(e.level>0?-1:1)) : null);
                if(!target&&!copiedWall&&['door','window'].includes(e.source.type))target=remember(objects.find(w=>w.type==='wall'
                    &&doorOnWall({...e.source,properties:{...e.source.properties,building_id:structureBuildingId(w)}},w)));
                id=target ? structureBuildingId(target) : copiedWall&&e.level===0 ? buildingNames[original] : null;
                if(floors.length && !id)fail('Для переноса пола на другой этаж нужна опора существующего здания.');
            }
            if(id)e.source.properties.building_id=id;
            else delete e.source.properties.building_id;
        }
    }
    const planned=structures.map(e=>e.source), all=[...objects,...planned];
    for(const e of entries) {
        if(e.x<0||e.z<0||e.x>=width||e.z>=height)fail('Вся группа должна находиться внутри подлокации.');
        const elevation=e.kind==='lamp'?e.source.height-e.level*STOREY_HEIGHT:e.source.properties?.elevation??e.source.elevation;
        if(!Number.isFinite(elevation)||elevation< -1e-9||elevation>10)fail('Перепад грунта выводит высоту объекта за допустимые границы.');
        if(e.kind!=='structure') {
            if(e.lampPrecisionError>1e-6)fail('Перепад грунта не позволяет сохранить взаимную высоту ламп с точностью 0,001 м.');
            if(e.level!==0&&!findFloor(all,e.x,e.z,e.level))fail('На этом этаже под объектом нет пола.');
            continue;
        }
        const o=e.source, id=structureBuildingId(o), p=structurePose(o);
        const rx=(Math.abs(p.axis.x)*p.width+Math.abs(p.normal.x)*p.depth)/2;
        const rz=(Math.abs(p.axis.z)*p.width+Math.abs(p.normal.z)*p.depth)/2;
        if(e.x-rx<0||e.z-rz<0||e.x+rx>width||e.z+rz>height)fail('Габариты постройки выходят за границы подлокации.');
        if(o.type==='floor') {
            if(objects.some(f=>f.type==='floor'&&structureLevel(f)===e.level&&overlaps(o,f)))fail('Пол копии пересекается с существующим полом этого этажа.');
            if(e.level!==0&&!findFloor(all,e.x,e.z,e.level+(e.level>0?-1:1),id))fail('Нельзя создать этаж без связанного пола снизу или сверху.');
        } else if(e.level!==0&&!findFloor(all,e.x,e.z,e.level,id))fail('На этом этаже под строительным элементом нет связанного пола.');
        if(['door','window'].includes(o.type)&&!remember(all.find(w=>w.type==='wall'&&doorOnWall(o,w))))fail('Для двери или окна нужна подходящая стена той же группы и этажа.');
        if((e.mount==='wall'||['wall_bulb','wall_torch'].includes(o.type))&&!remember(all.find(w=>w.type==='wall'&&structureLevel(w)===e.level
            &&structureBuildingId(w)===id&&doorOnWall({...o,type:'window'},w))))fail('Настенному предмету нужна подходящая стена.');
        if(['stairs','ladder'].includes(o.type)&&!findFloor(all,e.x,e.z,e.level+1,id))fail('Для лестницы нужен связанный пол верхнего этажа.');
        if(['hatch','floor_opening'].includes(o.type)&&!remember(all.find(s=>['stairs','ladder'].includes(s.type)
            &&structureBuildingId(s)===id&&structureLevel(s)===e.level-1
            &&Math.hypot(structurePose(s).x-e.x,structurePose(s).z-e.z)<Math.max(p.width,p.depth))))fail('Для люка или межэтажного проёма нужна связанная лестница снизу.');
    }
    return { entries, error, valid:!error, supports:[...supports], anchor:{x,z} };
}
