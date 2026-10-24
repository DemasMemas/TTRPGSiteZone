import { tileSurfaceTriangles } from './locationTerrain.js';

const EPS=1e-9;
// Terrain's rendered top sits at +.002; retain only a small depth separation.
export const ROAD_SURFACE_LIFT=.006;

// Clip the actual terrain triangles to each road footprint in XZ. Interpolating
// their Y values preserves steep terrain bands without sampling gaps or roll.
function clip(polygon,a,b) {
    const distance=p=>(b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
    const output=[];
    let previous=polygon.at(-1),before=distance(previous);
    for(const current of polygon){
        const after=distance(current);
        if((before>=-EPS)!==(after>=-EPS)){
            const t=before/(before-after);
            output.push(previous.map((v,i)=>v+(current[i]-v)*t));
        }
        if(after>=-EPS)output.push(current);
        previous=current;before=after;
    }
    return output;
}

export function buildRoadSurface({pads=[],links=[],getTile}) {
    const positions=[],colors=[],cache=new Map();
    const trianglesAt=(x,z)=>{
        const key=`${x},${z}`;
        if(!cache.has(key)){
            const tile=getTile(x,z);
            if(!tile||tile.terrain==='water')cache.set(key,null);
            else{
                const patch=Array.from({length:3},(_,b)=>Array.from({length:3},(_,a)=>getTile(x+a-1,z+b-1)));
                const triangles=tileSurfaceTriangles(patch,1,1).map(triangle=>triangle.map(([px,py,pz])=>[px+x-1,py,pz+z-1]));
                const height=triangles[0][0][1];
                triangles.flatHeight=triangles.every(t=>t.every(v=>Math.abs(v[1]-height)<EPS))?height:null;
                cache.set(key,triangles);
            }
        }
        return cache.get(key);
    };
    const append=(footprint,color,lift,deck=null)=>{
        const xs=footprint.map(p=>p[0]),zs=footprint.map(p=>p[1]);
        const hex=Number.parseInt(String(color||'#756f61').replace('#',''),16);
        const rgb=[(hex>>16&255)/255,(hex>>8&255)/255,(hex&255)/255];
        const left=Math.min(...xs),right=Math.max(...xs),near=Math.min(...zs),far=Math.max(...zs);
        if(!deck){
            let height=null,flat=true;
            for(let z=Math.floor(near);z<Math.ceil(far)&&flat;z++)for(let x=Math.floor(left);x<Math.ceil(right);x++){
                const triangles=trianglesAt(x,z),h=triangles?.flatHeight;
                if(h==null||(height!==null&&Math.abs(h-height)>EPS)){flat=false;break;}
                height=h;
            }
            if(flat&&height!==null){
                for(const index of [0,2,1,0,3,2]){positions.push(footprint[index][0],height+lift,footprint[index][1]);colors.push(...rgb);}
                return;
            }
        }
        for(let z=Math.floor(Math.min(...zs));z<Math.ceil(Math.max(...zs));z++)for(let x=Math.floor(Math.min(...xs));x<Math.ceil(Math.max(...xs));x++){
            let triangles=trianglesAt(x,z);
            if(!triangles){
                if(!deck||!getTile(x,z))continue;
                triangles=[[[x,0,z],[x,0,z+1],[x+1,0,z+1]],[[x,0,z],[x+1,0,z+1],[x+1,0,z]]];
            }
            for(const triangle of triangles){
                if(Math.max(...triangle.map(v=>v[0]))<=left+EPS||Math.min(...triangle.map(v=>v[0]))>=right-EPS
                    ||Math.max(...triangle.map(v=>v[2]))<=near+EPS||Math.min(...triangle.map(v=>v[2]))>=far-EPS)continue;
                let polygon=triangle;
                for(let i=0;i<footprint.length&&polygon.length;i++)polygon=clip(polygon,footprint[i],footprint[(i+1)%footprint.length]);
                for(let i=1;i<polygon.length-1;i++){
                    const vertices=[polygon[0],polygon[i],polygon[i+1]];
                    const [a,b,c]=vertices;
                    if(Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))<EPS)continue;
                    for(const [px,py,pz] of vertices){
                        // Technical bridge decks stay above water and their approaches
                        // stay above the bank; ordinary roads use only terrain height.
                        const y=deck?Math.max(getTile(x,z)?.terrain==='water'?-Infinity:py+lift,deck(px,pz)):py+lift;
                        positions.push(px,y,pz);colors.push(...rgb);
                    }
                }
            }
        }
    };
    for(const {from,to,widthScale=1,color,bridge=false} of links){
        const dx=to.x-from.x,dz=to.z-from.z,length=Math.hypot(dx,dz);
        if(length<EPS)continue;
        const sx=-dz/length*.12*widthScale,sz=dx/length*.12*widthScale;
        const footprint=[[from.x-sx,from.z-sz],[to.x-sx,to.z-sz],[to.x+sx,to.z+sz],[from.x+sx,from.z+sz]];
        const lift=ROAD_SURFACE_LIFT+(Math.abs(dx)<EPS?1:Math.abs(dz)<EPS?0:dx*dz>0?2:3)*.001;
        const deck=bridge?(x,z)=>from.y+(to.y-from.y)*Math.max(0,Math.min(1,((x-from.x)*dx+(z-from.z)*dz)/(length*length)))+.014:null;
        append(footprint,color,lift,deck);
    }
    for(const {position:p,scale=1,color,bridge=false} of pads){
        const half=.16*scale;
        append([[p.x-half,p.z-half],[p.x+half,p.z-half],[p.x+half,p.z+half],[p.x-half,p.z+half]],color,ROAD_SURFACE_LIFT+.004,bridge?()=>p.y+.018:null);
    }
    return {positions:new Float32Array(positions),colors:new Float32Array(colors)};
}
