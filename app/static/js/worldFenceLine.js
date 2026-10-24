// World PO-2 uses the same saved objects and scale limits as individual placement.
export const FENCE_PITCH = 0.8;
export const MAX_FENCE_SECTIONS = 1000; // Existing atomic group editor limit.
const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

export function fenceEndpoints(object, x, z) {
    const yaw = (object.rotation || 0) * Math.PI / 180;
    const half = FENCE_PITCH * (object.scale ?? 1) / 2;
    const dx = Math.sin(yaw) * half, dz = Math.cos(yaw) * half;
    return [{ x: x-dx, z: z-dz }, { x: x+dx, z: z+dz }];
}

export function planFenceLine({ start, end, settings, width, height, getTile, sampleHeight }) {
    const fail = error => ({ error, sections: [] });
    if (![start, end].every(p => p && Number.isFinite(p.x) && Number.isFinite(p.z)
        && p.x >= 0 && p.z >= 0 && p.x < width && p.z < height)) return fail('Линия выходит за границы карты');
    const length = distance(start, end), requested = settings.scale ?? 1;
    if (length < FENCE_PITCH*.2) return fail('Укажите конец дальше от начала');
    if (!(requested >= .2 && requested <= 2)) return fail('Недопустимый масштаб секции');
    const dx=(end.x-start.x)/length, dz=(end.z-start.z)/length;
    const rotation = (Math.atan2(dx,dz)*180/Math.PI+360)%360;
    // Visit every crossed cell, even a tiny water sliver between sample points.
    const crossings=[0,1];
    for(const axis of ['x','z'])if(Math.abs(end[axis]-start[axis])>1e-9){
        for(let edge=Math.floor(Math.min(start[axis],end[axis]))+1;edge<Math.max(start[axis],end[axis]);edge++)crossings.push((edge-start[axis])/(end[axis]-start[axis]));
    }
    crossings.sort((a,b)=>a-b);
    for(let i=1;i<crossings.length;i++){
        const t=(crossings[i-1]+crossings[i])/2,tile=getTile(Math.floor(start.x+(end.x-start.x)*t),Math.floor(start.z+(end.z-start.z)*t));
        if(!tile)return fail('Дождитесь загрузки всех чанков линии');
        if(tile.terrain==='water')return fail('Забор нельзя провести через воду');
    }
    // All sections have equal scale: no short, low last panel and no gaps at ends.
    const maximum=Math.min(MAX_FENCE_SECTIONS,Math.floor(length/(FENCE_PITCH*.2)+1e-8));
    if(Math.ceil(length/(FENCE_PITCH*requested))>MAX_FENCE_SECTIONS)return fail(`Не более ${MAX_FENCE_SECTIONS} секций за один участок: увеличьте масштаб или сократите длину`);
    if(Math.ceil(length/(FENCE_PITCH*2))>maximum)return fail(`Не более ${MAX_FENCE_SECTIONS} секций за один участок`);
    for (let count=Math.min(maximum,Math.ceil(length/(FENCE_PITCH*requested))); count<=maximum;) {
        const scale=length/(count*FENCE_PITCH), span=length/count;
        if(scale < .2-1e-9) return fail('Рельеф слишком неровный для целой секции: измените маршрут или высоту');
        const sections=[];
        let needsShorter=false;
        for(let i=0;i<count;i++) {
            const a={x:start.x+dx*span*i,z:start.z+dz*span*i};
            const b={x:start.x+dx*span*(i+1),z:start.z+dz*span*(i+1)};
            const heights=[];
            for(const t of [0,.25,.5,.75,1]) {
                const p={x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};
                const tile=getTile(Math.floor(p.x),Math.floor(p.z));
                if(!tile) return fail('Дождитесь загрузки всех чанков линии');
                if(tile.terrain==='water') return fail('Забор нельзя провести через воду');
                const y=sampleHeight(p.x,p.z);
                if(!Number.isFinite(y)) return fail('Не удалось определить поверхность грунта');
                heights.push(y);
            }
            if(heights.some((y,j)=>Math.abs(y-(heights[0]+(heights[4]-heights[0])*j/4)) > .025*scale)) needsShorter=true;
            const x=(a.x+b.x)/2,z=(a.z+b.z)/2,tx=Math.floor(x),ty=Math.floor(z);
            sections.push({ tileX:tx,tileY:ty,x,z,object:{...settings,type:'fence',rotation,scale:Math.min(2,Math.max(.2,scale)),x:x-tx-.5,z:z-ty-.5} });
        }
        if(!needsShorter) return {sections,length,scale,start,end};
        if(count===maximum)return fail('Рельеф слишком неровный для целой секции: измените маршрут или высоту');
        count=Math.min(maximum,Math.max(count+1,Math.ceil(count*1.5)));
    }
    return fail(`Не более ${MAX_FENCE_SECTIONS} секций за один участок`);
}

export function fencesOverlap(a,b,c,d) {
    const length=distance(a,b), dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    if(Math.abs((d.x-c.x)*dz-(d.z-c.z)*dx)>.001 || Math.abs((c.x-a.x)*dz-(c.z-a.z)*dx)>.01)return false;
    const u=(c.x-a.x)*dx+(c.z-a.z)*dz,v=(d.x-a.x)*dx+(d.z-a.z)*dz;
    return Math.min(length,Math.max(u,v))-Math.max(0,Math.min(u,v))>.02;
}

// A rigid panel follows the slope. The extra longitudinal scale preserves the
// exact horizontal endpoint positions without shearing the relief or its normals.
export function fenceMatrixElements(object, x, z, sampleHeight) {
    const [a,b]=fenceEndpoints(object,x,z), span=distance(a,b);
    const ya=sampleHeight(a.x,a.z), yb=sampleHeight(b.x,b.z);
    const yaw=(object.rotation||0)*Math.PI/180, slope=Math.atan2(yb-ya,span);
    const s=object.scale??1, c=Math.cos(yaw), t=Math.sin(yaw), cp=Math.cos(slope), sp=Math.sin(slope);
    const vx=[c,0,-t], vy=[-t*sp,cp,-c*sp], vz=[t*cp,sp,c*cp];
    return [...vx.map(n=>n*s),0,...vy.map(n=>n*s),0,...vz.map(n=>n*s/cp),0,
        x+vy[0]*.25*s,(ya+yb)/2+vy[1]*.25*s,z+vy[2]*.25*s,1];
}

export function connectedFenceReferences(references, first, tolerance=.015) {
    const buckets=new Map(), key=(x,z)=>`${x},${z}`, bucket=p=>[Math.floor(p.x/tolerance),Math.floor(p.z/tolerance)];
    const ends=references.map(r=>fenceEndpoints(r.object,r.chunkX*32+r.tileX+.5+(r.object.x||0),r.chunkY*32+r.tileY+.5+(r.object.z||0)));
    ends.forEach((points,i)=>points.forEach(p=>{const k=key(...bucket(p));if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push([i,p])}));
    const initial=references.findIndex(r=>['chunkX','chunkY','tileX','tileY','index'].every(k=>r[k]===first[k]));
    if(initial<0)return [];
    const seen=new Set([initial]),queue=[initial];
    for(let n=0;n<queue.length;n++)for(const p of ends[queue[n]]){
        const [x,z]=bucket(p);
        for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const [i,q]of buckets.get(key(x+dx,z+dz))||[]){
            if(!seen.has(i)&&distance(p,q)<=tolerance){seen.add(i);queue.push(i)}
        }
    }
    return queue.map(i=>references[i]);
}
