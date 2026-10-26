// Convex planar patches, clipped before meshing. Persisted roof sections remain
// ordinary LocationObjects; rendering never has to reconstruct a whole building.
const EPS = 1e-7;
const rectangle = (x0,z0,x1,z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const area = p => Math.abs(p.reduce((a,v,i)=>a+v[0]*p[(i+1)%p.length][1]-v[1]*p[(i+1)%p.length][0],0))/2;
const value = (p,x,z) => p[0]*x+p[1]*z+p[2];

function clip(poly, a,b,c) {
    const out=[];
    for(let i=0;i<poly.length;i++) {
        const p=poly[i],q=poly[(i+1)%poly.length],u=a*p[0]+b*p[1]+c,v=a*q[0]+b*q[1]+c;
        if(u>=-EPS)out.push(p);
        if((u>EPS&&v<-EPS)||(u<-EPS&&v>EPS)) {
            const t=u/(u-v);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);
        }
    }
    return out.length>=3&&area(out)>EPS?out:[];
}
function intersect(p,q) {
    for(let i=0;i<q.length&&p.length;i++) {
        const a=q[i],b=q[(i+1)%q.length];p=clip(p,a[1]-b[1],b[0]-a[0],a[0]*b[1]-b[0]*a[1]);
    }
    return p;
}
function subtract(p,q) {
    const out=[];
    for(let i=0;i<q.length&&p.length;i++) {
        const u=q[i],v=q[(i+1)%q.length],a=u[1]-v[1],b=v[0]-u[0],c=u[0]*v[1]-v[0]*u[1];
        const outside=clip(p,-a,-b,-c);if(outside.length)out.push(outside);
        p=clip(p,a,b,c);
    }
    return out;
}

export function validateRoofBodies(bodies) {
    if(!Array.isArray(bodies)||!bodies.length||bodies.length>16)return 'Нужно от 1 до 16 прямоугольных корпусов';
    for(const b of bodies) {
        if(![b.x,b.z,b.width,b.depth,b.eave,b.pitch,b.overhang].every(Number.isFinite)
            ||b.width<=0||b.depth<=0||b.eave<1.8||b.eave>20||b.pitch<0||b.pitch>60||b.overhang<0||b.overhang>.6
            ||!Number.isInteger(b.level)||b.level<-10||b.level>10
            ||b.basePlane&&(!Array.isArray(b.basePlane)||b.basePlane.length!==3||!b.basePlane.every(Number.isFinite))
            ||!['flat','shed','gable'].includes(b.type)||!['north','south','east','west'].includes(b.direction))return 'Некорректные размеры или параметры кровли';
    }
    for(let i=0;i<bodies.length;i++)for(let j=0;j<bodies.length;j++) {
        const high=bodies[i],low=bodies[j];if(high.level<=low.level)continue;
        const x0=Math.max(high.x,low.x),x1=Math.min(high.x+high.width,low.x+low.width);
        const z0=Math.max(high.z,low.z),z1=Math.min(high.z+high.depth,low.z+low.depth);
        if(x1<x0-EPS||z1<z0-EPS)continue;
        if(x1-x0<=EPS&&z1-z0<=EPS)continue;
        let crossing=false;
        if(x1-x0>EPS&&z1-z0>EPS)crossing=roofSurface([high,low],rectangle(x0,z0,x1,z1),false).some(p=>p.body===1);
        else {
            const xs=[x0,x1,(low.x+low.width/2),(high.x+high.width/2)].filter(x=>x>=x0-EPS&&x<=x1+EPS);
            const zs=[z0,z1,(low.z+low.depth/2),(high.z+high.depth/2)].filter(z=>z>=z0-EPS&&z<=z1+EPS);
            crossing=xs.some(x=>zs.some(z=>roofHeight([low],x,z)>roofHeight([high],x,z)+.001));
        }
        if(crossing)return 'Обратная врезка крыш разной этажности не поддерживается: уменьшите высоту/уклон нижнего корпуса или направьте скат от высокой стены';
    }
    return null;
}

export function roofPatches(bodies, overhang = true) {
    const patches=[];
    bodies.forEach((b,body)=>{
        if(bodies.some(other=>other.level>b.level&&other.x<=b.x+EPS&&other.z<=b.z+EPS
            &&other.x+other.width>=b.x+b.width-EPS&&other.z+other.depth>=b.z+b.depth-EPS))return;
        const margin=overhang?b.overhang:0;
        const x0=b.x-margin,z0=b.z-margin,x1=b.x+b.width+margin,z1=b.z+b.depth+margin;
        const slope=b.type==='flat'?0:Math.tan(b.pitch*Math.PI/180);
        const base=b.level*2.4+b.eave;
        const push=(plane,poly)=>{
            const tilt=b.basePlane||[0,0,0];
            plane=[plane[0]+tilt[0],plane[1]+tilt[1],plane[2]+tilt[2]-tilt[0]*b.x-tilt[1]*b.z];
            let parts=[poly];
            if(overhang)for(let j=0;j<bodies.length;j++) {
                if(j===body)continue;
                const q=bodies[j];
                // Eaves project only into exterior air, never erase the lower
                // roof where it meets a taller facade.
                const forbidden=subtract(rectangle(q.x,q.z,q.x+q.width,q.z+q.depth),rectangle(b.x,b.z,b.x+b.width,b.z+b.depth));
                for(const cut of forbidden)parts=parts.flatMap(p=>subtract(p,cut));
            }
            for(const part of parts)patches.push({plane,poly:part,body});
        };
        if(b.type==='flat')push([0,0,base],rectangle(x0,z0,x1,z1));
        else if(b.direction==='north'||b.direction==='south') {
            if(b.type==='shed')push(b.direction==='south'?[0,slope,base-slope*b.z]:[0,-slope,base+slope*(b.z+b.depth)],rectangle(x0,z0,x1,z1));
            else {
                const middle=b.z+b.depth/2;
                push([0,slope,base-slope*b.z],rectangle(x0,z0,x1,middle));
                push([0,-slope,base+slope*(b.z+b.depth)],rectangle(x0,middle,x1,z1));
            }
        } else if(b.type==='shed')push(b.direction==='east'?[slope,0,base-slope*b.x]:[-slope,0,base+slope*(b.x+b.width)],rectangle(x0,z0,x1,z1));
        else {
            const middle=b.x+b.width/2;
            push([slope,0,base-slope*b.x],rectangle(x0,z0,middle,z1));
            push([-slope,0,base+slope*(b.x+b.width)],rectangle(middle,z0,x1,z1));
        }
    });
    return patches;
}

// Upper envelope: lower roofs end at the facade of a taller body. Equal-height
// intersecting gables meet along the exact plane intersection (valley), once.
export function roofSurface(bodies, bounds, overhang=true) {
    const patches=roofPatches(bodies,overhang),result=[];
    patches.forEach((patch,index)=>{
        let parts=[intersect(patch.poly,bounds)].filter(p=>p.length);
        for(let j=0;j<patches.length&&parts.length;j++) {
            if(j===index)continue;
            const other=patches[j],delta=other.plane.map((v,k)=>v-patch.plane[k]);
            let occluder;
            if(delta.every(v=>Math.abs(v)<EPS)) {
                if(j>index)continue;
                occluder=other.poly;
            } else occluder=clip(other.poly,...delta);
            if(occluder.length)parts=parts.flatMap(p=>subtract(p,occluder));
        }
        for(const poly of parts)result.push({body:patch.body,plane:patch.plane,points:poly.map(([x,z])=>[x,value(patch.plane,x,z),z])});
    });
    return result;
}

export function roofHeight(bodies,x,z) {
    const heights=roofPatches(bodies,false).filter(p=>p.poly.every((v,i)=>{
        const q=p.poly[(i+1)%p.poly.length];return (q[0]-v[0])*(z-v[1])-(q[1]-v[1])*(x-v[0])>=-EPS;
    })).map(p=>value(p.plane,x,z));
    return heights.length?Math.max(...heights):null;
}

// Compact JSON polygon solids. Coordinates are local to each editable object.
export function roofSolid(polygons, x,z,base, thickness=.13) {
    const positions=[];
    const tri=(a,b,c)=>positions.push(...a,...b,...c);
    for(const {points} of polygons) {
        const top=points.map(p=>[p[0]-x,p[1]-base+thickness,p[2]-z]);
        const bottom=top.map(p=>[p[0],p[1]-thickness,p[2]]);
        for(let i=1;i<top.length-1;i++){tri(top[0],top[i+1],top[i]);tri(bottom[0],bottom[i],bottom[i+1]);}
        for(let i=0;i<top.length;i++) {
            const j=(i+1)%top.length;tri(top[i],top[j],bottom[j]);tri(top[i],bottom[j],bottom[i]);
        }
    }
    return positions;
}

export function roofSectionProperties(bodies, bounds, x,z,level, owner=0) {
    const polygons=roofSurface(bodies,bounds);
    const heights=polygons.flatMap(p=>p.points.map(v=>v[1]));
    if(!heights.length)return null;
    const base=Math.min(...heights);
    const localBounds=bounds.map(p=>[p[0]-x,p[1]-z]);
    const dimensions={width:Math.max(...bounds.map(p=>p[0]))-Math.min(...bounds.map(p=>p[0])),
        depth:Math.max(...bounds.map(p=>p[1]))-Math.min(...bounds.map(p=>p[1])),height:Math.max(...heights)-base+.13};
    return {roof_section:{version:1,bodies:JSON.parse(JSON.stringify(bodies)),bounds:localBounds,owner,origin:[x,z],level,base:base-level*2.4,nativeSize:{...dimensions}},
        roof_geometry:roofSolid(polygons,x,z,base),elevation:base-level*2.4,
        dimensions,passable:true};
}

export function roofBodyDefaults(body,index=0) {
    return {id:body.id||`body-${index}`,x:body.x,z:body.z,width:body.width,depth:body.depth,
        level:body.level??0,eave:body.eave??2.4,type:body.type||'gable',pitch:body.pitch??25,
        direction:body.direction||(body.width>=body.depth?'south':'east'),overhang:body.overhang??.25};
}

// Maximal rectangles of an orthogonal union; overlap is intentional, but only
// their clipped upper envelope is rendered. No roof spans an unoccupied court.
export function roofBodiesFromRects(rects, settings={}) {
    const xs=[...new Set(rects.flatMap(r=>[r.x,r.x+r.width]))].sort((a,b)=>a-b);
    const zs=[...new Set(rects.flatMap(r=>[r.z,r.z+r.depth]))].sort((a,b)=>a-b);
    if(xs.length>40||zs.length>40)return {error:'Слишком сложный контур: разбейте кровлю на несколько групп'};
    const occupied=(i,j)=>rects.some(r=>xs[i]>=r.x-EPS&&xs[i+1]<=r.x+r.width+EPS&&zs[j]>=r.z-EPS&&zs[j+1]<=r.z+r.depth+EPS);
    const candidates=[];
    for(let a=0;a<zs.length-1;a++) {
        const columns=Array(xs.length-1).fill(true);
        for(let b=a;b<zs.length-1;b++) {
            for(let i=0;i<columns.length;i++)columns[i]&&=occupied(i,b);
            let start=-1;
            for(let i=0;i<=columns.length;i++) {
                if(columns[i]&&start<0)start=i;
                if(!columns[i]&&start>=0){candidates.push({x:xs[start],z:zs[a],width:xs[i]-xs[start],depth:zs[b+1]-zs[a]});start=-1;}
            }
        }
    }
    const maximal=candidates.filter((r,i)=>!candidates.some((s,j)=>j!==i&&s.x<=r.x&&s.z<=r.z&&s.x+s.width>=r.x+r.width&&s.z+s.depth>=r.z+r.depth&&(s.width*s.depth>r.width*r.depth)));
    if(maximal.length>16)return {error:'Контур требует более 16 корпусов; разделите группу кровли'};
    return {bodies:maximal.map((b,i)=>roofBodyDefaults({...b,...settings},i))};
}

export function roofRect(x,z,width,depth) {return rectangle(x,z,x+width,z+depth);}

export function wallRoofProperties(object,bodies) {
    const original=object;
    object=roofWallBasisObject(object);
    const p=object.properties||{},d=p.dimensions||{},angle=p.rotation||0;
    const x=object.tile_x+.5+(p.offset_x||0),z=object.tile_y+.5+(p.offset_z||0);
    const bounds=rectangle(-d.width/2,-d.depth/2,d.width/2,d.depth/2).map(([a,b])=>[x+a*Math.cos(angle)+b*Math.sin(angle),z-a*Math.sin(angle)+b*Math.cos(angle)]);
    const level=p.level||0,base=level*2.4+(p.elevation||0),delta=p.roof_ground_delta||0,positions=[];
    const local=point=>{const dx=point[0]-x,dz=point[2]-z;return [dx*Math.cos(angle)-dz*Math.sin(angle),point[1]-base+delta,dx*Math.sin(angle)+dz*Math.cos(angle)];};
    const tri=(a,b,c)=>positions.push(...local(a),...local(b),...local(c));
    for(const {points,plane} of roofSurface(bodies,bounds)) {
        // Top of the normal wall remains a normal editable dimension. Only the
        // extra triangular/trapezoidal closure is derived from roof planes.
        const [ax,az,constant]=plane;
        const poly=clip(points.map(v=>[v[0],v[2]]),ax,az,constant-base-d.height+delta);
        if(!poly.length)continue;
        const top=poly.map(([px,pz])=>[px,ax*px+az*pz+constant,pz]);
        if(top.every(v=>v[1]-base+delta<=d.height+EPS))continue;
        const bottom=top.map(v=>[v[0],base+d.height-delta,v[2]]);
        for(let i=1;i<top.length-1;i++){tri(top[0],top[i+1],top[i]);tri(bottom[0],bottom[i],bottom[i+1]);}
        for(let i=0;i<top.length;i++){const j=(i+1)%top.length;tri(top[i],top[j],bottom[j]);tri(top[i],bottom[j],bottom[i]);}
    }
    const frame=original.properties?.roof_wall?.frame||{x,z,angle,level,elevation:p.elevation||0,width:d.width,depth:d.depth};
    return {roof_wall:{version:1,bodies:JSON.parse(JSON.stringify(bodies)),frame},roof_wall_geometry:positions};
}

export function planEditableRoofs(objects,bodies,{condition='intact',seed='0',buildingId,group='roof',groundHeight=()=>0}={}) {
    const error=validateRoofBodies(bodies);if(error)return {error};
    const floors=objects.filter(o=>o.type==='floor');
    const anchor=floors.reduce((best,o)=>groundHeight(o.tile_x,o.tile_y)>groundHeight(best.x,best.z)?{x:o.tile_x,z:o.tile_y}:best,
        {x:Math.floor(bodies[0].x),z:Math.floor(bodies[0].z)});
    const xs=new Set(),zs=new Set();
    for(const b of bodies) {
        for(const [set,start,length] of [[xs,b.x,b.width],[zs,b.z,b.depth]]) {
            for(let t=0;t<length;t+=2)set.add(start+t);
            set.add(start+length);
        }
    }
    const margin=Math.max(...bodies.map(b=>b.overhang));
    xs.add(Math.min(...xs)-margin);xs.add(Math.max(...xs)+margin);
    zs.add(Math.min(...zs)-margin);zs.add(Math.max(...zs)+margin);
    const x=[...xs].sort((a,b)=>a-b),z=[...zs].sort((a,b)=>a-b),roofs=[];
    for(let j=0;j<z.length-1;j++)for(let i=0;i<x.length-1;i++) {
        const cx=(x[i]+x[i+1])/2,cz=(z[j]+z[j+1])/2,bounds=rectangle(x[i],z[j],x[i+1],z[j+1]);
        const surface=roofSurface(bodies,bounds);if(!surface.length)continue;
        const owner=surface.reduce((a,b)=>area(a.points.map(v=>[v[0],v[2]]))>=area(b.points.map(v=>[v[0],v[2]]))?a:b).body;
        const level=bodies[owner].level;
        let hash=2166136261;for(const ch of `${seed}:${i}:${j}`){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
        if((hash>>>0)/4294967296<(condition==='ruins'?.82:condition==='damaged'?.28:condition==='worn'?.03:0))continue;
        const properties=roofSectionProperties(bodies,bounds,cx,cz,level,owner);
        roofs.push({type:'roof',name:`Кровля · ${bodies[owner].id}`,tile_x:Math.floor(cx),tile_y:Math.floor(cz),properties:{
            building_id:buildingId,level,offset_x:cx-Math.floor(cx)-.5,offset_z:cz-Math.floor(cz)-.5,
            rotation:0,roof_group:group,roof_ground_anchor:anchor,color:condition==='worn'?'#68675a':'#575b52',...properties}});
    }
    const walls=objects.filter(o=>{
        if(o.type!=='wall'||(o.properties?.dimensions?.height||0)<1.8)return false;
        const p=o.properties,x=o.tile_x+.5+(p.offset_x||0),z=o.tile_y+.5+(p.offset_z||0);
        const peers=bodies.filter(b=>x>=b.x-EPS&&x<=b.x+b.width+EPS&&z>=b.z-EPS&&z<=b.z+b.depth+EPS);
        return peers.length&&Math.max(...peers.map(b=>b.level))===(p.level||0);
    });
    const joints=condition==='ruins'?[]:planRoofJoints(bodies,{buildingId,group,anchor,groundHeight});
    return {objects:[...roofs,...joints],walls:walls.map(object=>{
        const delta=groundHeight(anchor.x,anchor.z)-groundHeight(object.tile_x,object.tile_y);
        return {object,properties:{roof_group:group,roof_ground_anchor:anchor,roof_ground_delta:delta,
            ...wallRoofProperties({...object,properties:{...object.properties,roof_ground_delta:delta}},bodies)}};
    }),bodies};
}

// A lower roof may meet a gable end (or a higher mono-pitch edge) on the same
// storey. Close the height discontinuity with a real, editable facade piece.
export function planRoofJoints(bodies,{buildingId,group,anchor={x:0,z:0},groundHeight=()=>0}={}) {
    const joints=new Map();
    for(let i=0;i<bodies.length;i++)for(let j=0;j<bodies.length;j++) {
        if(i===j||bodies[i].level!==bodies[j].level)continue;
        const a=bodies[i],b=bodies[j];
        for(const [vertical,coordinate,start,end] of [[true,a.x,a.z,a.z+a.depth],[true,a.x+a.width,a.z,a.z+a.depth],
            [false,a.z,a.x,a.x+a.width],[false,a.z+a.depth,a.x,a.x+a.width]]) {
            const side0=vertical?b.x:b.z,side1=side0+(vertical?b.width:b.depth);
            if(coordinate<side0-EPS||coordinate>side1+EPS)continue;
            const low=Math.max(start,vertical?b.z:b.x),high=Math.min(end,vertical?b.z+b.depth:b.x+b.width);
            for(let t=low;t<high-EPS;t+=2) {
                const stop=Math.min(t+2,high),middle=(t+stop)/2;
                const changed=[.2,.5,.8].some(f=>{
                    const v=t+(stop-t)*f,x=vertical?coordinate:v,z=vertical?v:coordinate;
                    const h1=roofHeight(bodies,x+(vertical?.001:0),z+(vertical?0:.001));
                    const h2=roofHeight(bodies,x-(vertical?.001:0),z-(vertical?0:.001));
                    return h1!==null&&h2!==null&&Math.abs(h1-h2)>.01;
                });
                if(!changed)continue;
                const key=[vertical,coordinate,t,stop].join(':');if(joints.has(key))continue;
                const x=vertical?coordinate:middle,z=vertical?middle:coordinate;
                const tile_x=Math.floor(x),tile_y=Math.floor(z);
                const object={type:'wall',name:'Примыкание кровли',tile_x,tile_y,properties:{
                    building_id:buildingId,level:a.level,offset_x:x-tile_x-.5,offset_z:z-tile_y-.5,
                    rotation:vertical?-Math.PI/2:0,elevation:2.4,dimensions:{width:stop-t,depth:.12,height:.01},
                    roof_group:group,roof_joint:key,roof_ground_anchor:anchor,roof_ground_delta:groundHeight(anchor.x,anchor.z)-groundHeight(tile_x,tile_y),passable:true,color:'#aaa18e'}};
                Object.assign(object.properties,wallRoofProperties(object,bodies));joints.set(key,object);
            }
        }
    }
    return [...joints.values()];
}

export function rebuildRoofSection(object,bodies) {
    const p=object.properties,s=p.roof_section;
    if(!s)return null;
    const [x,z]=s.origin;
    const result=roofSectionProperties(bodies,s.bounds.map(v=>[v[0]+x,v[1]+z]),x,z,s.level??p.level??0,s.owner);
    if(!result)return null;
    result.elevation+=(p.elevation||0)-s.base;
    result.dimensions.width=p.dimensions.width;result.dimensions.depth=p.dimensions.depth;
    result.dimensions.height*=p.dimensions.height/(s.nativeSize?.height||p.dimensions.height);
    return result;
}

export function createSavedRoofGeometry(THREE,positions) {
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    const uv=[];for(let i=0;i<positions.length;i+=3)uv.push(positions[i]*.5,positions[i+2]*.5);
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(positions.length).fill(1),3));
    geometry.computeVertexNormals();return geometry;
}

export function wallRoofMeshGeometry(object,spans,ceilingHeight=Infinity) {
    const actualWidth=object.properties.dimensions.width;
    object=roofWallBasisObject(object);
    spans=spans.map(s=>({...s,start:s.start*object.properties.dimensions.width/actualWidth,end:s.end*object.properties.dimensions.width/actualWidth}));
    const p=object.properties,d=p.dimensions,angle=p.rotation||0,level=p.level||0;
    const x=object.tile_x+.5+(p.offset_x||0),z=object.tile_y+.5+(p.offset_z||0);
    const base=level*2.4+(p.elevation||0),delta=p.roof_ground_delta||0,positions=[];
    const world=(a,b)=>[x+a*Math.cos(angle)+b*Math.sin(angle),z-a*Math.sin(angle)+b*Math.cos(angle)];
    const local=v=>{const dx=v[0]-x,dz=v[2]-z;return [dx*Math.cos(angle)-dz*Math.sin(angle),v[1]-base+delta,dx*Math.sin(angle)+dz*Math.cos(angle)];};
    const tri=(a,b,c)=>positions.push(...local(a),...local(b),...local(c));
    for(const span of spans) {
        const bounds=rectangle(span.start,-d.depth/2,span.end,d.depth/2).map(v=>world(...v));
        const bottom=base+span.bottom-delta;
        const ceiling=Math.min(base+ceilingHeight-delta,Math.abs(span.top-d.height)<.001?Infinity:base+span.top-delta);
        for(const {points,plane:[ax,az,constant]} of roofSurface(p.roof_wall.bodies,bounds)) {
            const poly=clip(points.map(v=>[v[0],v[2]]),ax,az,constant-bottom);
            if(!poly.length)continue;
            const pieces=Number.isFinite(ceiling)?[
                {poly:clip(poly,-ax,-az,ceiling-constant),plane:[ax,az,constant]},
                {poly:clip(poly,ax,az,constant-ceiling),plane:[0,0,ceiling]},
            ]:[{poly,plane:[ax,az,constant]}];
            for(const part of pieces) {
                if(!part.poly.length)continue;
                const top=part.poly.map(([px,pz])=>[px,value(part.plane,px,pz),pz]),low=top.map(v=>[v[0],bottom,v[2]]);
                for(let i=1;i<top.length-1;i++){tri(top[0],top[i+1],top[i]);tri(low[0],low[i],low[i+1]);}
                for(let i=0;i<top.length;i++){const j=(i+1)%top.length;tri(top[i],top[j],low[j]);tri(top[i],low[j],low[i]);}
            }
        }
    }
    return positions;
}

export function roofWallBasisObject(object) {
    const p=object.properties,frame=p?.roof_wall?.frame;
    if(!frame)return object;
    return {...object,tile_x:Math.floor(frame.x),tile_y:Math.floor(frame.z),properties:{...p,
        offset_x:frame.x-Math.floor(frame.x)-.5,offset_z:frame.z-Math.floor(frame.z)-.5,
        rotation:frame.angle,level:frame.level,elevation:frame.elevation,
        dimensions:{...p.dimensions,width:frame.width,depth:frame.depth}}};
}

export function transformedRoofAnchor(object) {
    const p=object.properties,anchor=p?.roof_ground_anchor;
    if(!anchor)return null;
    const section=p.roof_section,frame=p.roof_wall?.frame;
    if(!section&&!frame)return anchor;
    const [ox,oz]=section?.origin||[frame.x,frame.z],angle=(p.rotation||0)-(frame?.angle||section?.angle||0);
    const x=object.tile_x+.5+(p.offset_x||0),z=object.tile_y+.5+(p.offset_z||0);
    const dx=anchor.x+.5-ox,dz=anchor.z+.5-oz;
    return {x:Math.floor(x+dx*Math.cos(angle)+dz*Math.sin(angle)+EPS),z:Math.floor(z-dx*Math.sin(angle)+dz*Math.cos(angle)+EPS)};
}
