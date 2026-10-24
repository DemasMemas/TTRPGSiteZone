import { planFenceLine, fenceEndpoints, fencesOverlap } from './worldFenceLine.js';

export function createFenceLineTool({ getTile, getBounds, getSettings, sampleHeight, preview, clearPreview, save, status, notify, continueLine, schedulePreview=callback=>callback() }) {
    let start=null, busy=false, generation=0;
    let pendingHover=null, framePending=false;
    const nearby=p=>{
        const result=[];
        for(let z=Math.floor(p.z)-2;z<=Math.floor(p.z)+2;z++)for(let x=Math.floor(p.x)-2;x<=Math.floor(p.x)+2;x++){
            (getTile(x,z)?.objects||[]).forEach((object,index)=>{if(object.type==='fence')result.push({x:x+.5+(object.x||0),z:z+.5+(object.z||0),object,key:`${x},${z},${index}`})});
        }
        return result;
    };
    const point=tile=>{
        const x=(tile.chunkX??tile.chunk?.chunkX)*32+tile.tileX+.5;
        const z=(tile.chunkY??tile.chunk?.chunkY)*32+tile.tileY+.5;
        const raw={x:tile.pointX??x,z:tile.pointZ??z};
        let p=raw,best=.12*(getSettings().scale??1);
        for(const reference of nearby(raw))for(const end of fenceEndpoints(reference.object,reference.x,reference.z)){
            const d=Math.hypot(end.x-raw.x,end.z-raw.z);
            if(d<best){best=d;p=end}
        }
        return p;
    };
    const plan=end=>{
        const [width,height]=getBounds();
        const result=planFenceLine({start,end,settings:getSettings(),width,height,getTile,sampleHeight});
        if(result.error)return result;
        const existing=new Map();
        for(const section of result.sections)for(const r of nearby(section))existing.set(r.key,r);
        for(const section of result.sections){
            const [a,b]=fenceEndpoints(section.object,section.x,section.z);
            for(const r of existing.values()){
                const [c,d]=fenceEndpoints(r.object,r.x,r.z);
                if(fencesOverlap(a,b,c,d))return {error:'Этот участок пересекается с уже проложенным забором',sections:[]};
            }
        }
        return result;
    };
    const describe=result=>status(result.error||`${result.sections.length} секций · ${Math.round(result.length*100)} м. Клик — построить; Esc / ПКМ — отменить.`);
    const cancel=()=>{const had=Boolean(start);generation++;start=null;clearPreview();status('Первый клик — начало, второй — конец. Esc / ПКМ — отменить.');return had;};
    const hover=tile=>{
        if(!start)return false;
        pendingHover=tile;
        if(!framePending){framePending=true;schedulePreview(()=>{
            framePending=false;
            if(!start||!pendingHover||busy){clearPreview();return;}
            const result=plan(point(pendingHover));preview(result.sections);describe(result);
        });}
        return true;
    };
    const click=async tile=>{
        if(busy||!tile)return false;
        const end=point(tile);
        if(!start){start=end;status('Начало задано. Укажите конец участка. Esc / ПКМ — отменить.');clearPreview();return true;}
        const result=plan(end);describe(result);preview(result.sections);
        if(result.error){notify(result.error);return false;}
        const packet=new Map();
        for(const section of result.sections){
            const key=`${section.tileX},${section.tileY}`;
            if(!packet.has(key)){
                const expected=JSON.parse(JSON.stringify(getTile(section.tileX,section.tileY)?.objects||[]));
                packet.set(key,{chunk_x:Math.floor(section.tileX/32),chunk_y:Math.floor(section.tileY/32),tile_x:section.tileX%32,tile_y:section.tileY%32,
                    expected_objects:expected,updates:{objects:[...expected]}});
            }
            packet.get(key).updates.objects.push(section.object);
        }
        const ownGeneration=generation;busy=true;status('Сохраняем участок…');
        try{
            await save([...packet.values()]);
            if(ownGeneration===generation){clearPreview();start=continueLine()?end:null;status(start?'Участок построен. Укажите следующий конец или завершите Esc / ПКМ.':'Участок построен. Укажите начало нового.');}
            return true;
        }catch(error){notify(error.message||'Не удалось сохранить забор');return false;}
        finally{busy=false;}
    };
    return {click,hover,cancel,get active(){return Boolean(start)},get busy(){return busy}};
}
