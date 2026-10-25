// Experimental component contour. Not connected to the location renderer.
import { classifyWaterRegions, waterLevelForTile } from './locationWaterEdge.js';

const key=p=>p.join(',');
const area=loop=>loop.reduce((s,p,i)=>{const q=loop[(i+1)%loop.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;

export function connectedWaterContours(tiles) {
    const seen=new Set(),basins=[];
    for(let z=0;z<tiles.length;z++)for(let x=0;x<tiles[z].length;x++){
        if(tiles[z][x]?.terrain!=='water'||seen.has(`${x},${z}`))continue;
        const cells=[[x,z]],edges=[];
        seen.add(`${x},${z}`);
        for(const [cx,cz]of cells)for(const [dx,dz,a,b]of [
            [0,-1,[cx,cz],[cx+1,cz]],[1,0,[cx+1,cz],[cx+1,cz+1]],
            [0,1,[cx+1,cz+1],[cx,cz+1]],[-1,0,[cx,cz+1],[cx,cz]],
        ]){
            if(tiles[cz+dz]?.[cx+dx]?.terrain==='water'){
                const k=`${cx+dx},${cz+dz}`;
                if(!seen.has(k)){seen.add(k);cells.push([cx+dx,cz+dz]);}
            }else edges.push({a,b,used:false});
        }
        const starts=new Map();
        for(const e of edges){const k=key(e.a);if(!starts.has(k))starts.set(k,[]);starts.get(k).push(e);}
        const loops=[];
        for(const first of edges){
            if(first.used)continue;
            const loop=[];let e=first;
            while(e&&!e.used){
                e.used=true;loop.push(e.a);
                if(key(e.b)===key(first.a))break;
                const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1];
                const choices=(starts.get(key(e.b))||[]).filter(n=>!n.used);
                const turn=n=>{const nx=n.b[0]-n.a[0],nz=n.b[1]-n.a[1];return (Math.atan2(dx*nz-dz*nx,dx*nx+dz*nz)+Math.PI*2)%(Math.PI*2);};
                e=choices.sort((a,b)=>turn(a)-turn(b))[0];
            }
            if(loop.length>=4)loops.push(loop);
        }
        basins.push({cells,outer:loops.filter(l=>area(l)>0),holes:loops.filter(l=>area(l)<0)});
    }
    return basins;
}

function insetAndSmooth(loop,width=.24) {
    let points=loop.map((p,i)=>{
        const a=loop[(i+loop.length-1)%loop.length],b=loop[(i+1)%loop.length];
        const n=(u,v)=>{const dx=v[0]-u[0],dz=v[1]-u[1],l=Math.hypot(dx,dz);return [-dz/l,dx/l];};
        const u=n(a,p),v=n(p,b),dot=1+u[0]*v[0]+u[1]*v[1];
        return [p[0]+(u[0]+v[0])*width/dot,p[1]+(u[1]+v[1])*width/dot];
    });
    for(let pass=0;pass<2;pass++)points=points.flatMap((p,i)=>{
        const q=points[(i+1)%points.length];
        return [[p[0]*.75+q[0]*.25,p[1]*.75+q[1]*.25],[p[0]*.25+q[0]*.75,p[1]*.25+q[1]*.75]];
    });
    return points;
}

export function buildWaterContourPrototype(THREE,tiles,sampleLand,{puddles=false}={}) {
    const regions=classifyWaterRegions(tiles),basins=connectedWaterContours(tiles);
    const data={water:[],bank:[],bankColors:[],waterColors:[],regions,basins:basins.length};
    const emit=(target,outer,holes=[])=>{
        const points=[...outer,...holes.flat()],v=p=>new THREE.Vector2(p[0],p[2]);
        for(const face of THREE.ShapeUtils.triangulateShape(outer.map(v),holes.map(h=>h.map(v)))){
            const [a,b,c]=face.map(i=>points[i]);
            const up=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
            target.push(...a,...(up>=0?b:c),...(up>=0?c:b));
        }
    };
    for(const basin of basins){
        const levels=basin.cells.map(([x,z])=>waterLevelForTile(tiles[z][x],regions.get(`${x},${z}`)));
        if(Math.max(...levels)-Math.min(...levels)>1e-6)return {supported:false,reason:'unequal water levels'};
        if(basin.outer.length!==1)return {supported:false,reason:'touching boundary loops'};
        const y=levels[0]+.012;
        const ground=p=>{
            const heights=[];
            for(const dz of [-1e-5,1e-5])for(const dx of [-1e-5,1e-5]){
                const t=tiles[Math.floor(p[1]+dz)]?.[Math.floor(p[0]+dx)];
                if(t&&t.terrain!=='water')heights.push(sampleLand(p[0]+dx,p[1]+dz)+.002);
            }
            return [p[0],heights.length?heights.reduce((a,b)=>a+b,0)/heights.length:y,p[1]];
        };
        const outer=basin.outer[0];
        const waterPoint=p=>[p[0],y,p[1]];
        if(puddles&&basin.cells.length===1){
            // A fixed irregular outline, not random noise. Fill the rest of the
            // water cell with the existing shore material and a narrow damp rim.
            const [x,z]=basin.cells[0];
            const outline=[[.18,.33],[.28,.14],[.49,.18],[.63,.13],[.81,.29],[.83,.45],
                [.74,.57],[.82,.73],[.6,.84],[.44,.76],[.25,.83],[.14,.62]];
            const inner=outline.flatMap((p,i)=>{
                const q=outline[(i+1)%outline.length];
                return [[x+p[0]*.75+q[0]*.25,z+p[1]*.75+q[1]*.25],
                    [x+p[0]*.25+q[0]*.75,z+p[1]*.25+q[1]*.75]];
            });
            const rim=inner.map(p=>[x+.5+(p[0]-x-.5)*1.14,z+.5+(p[1]-z-.5)*1.14]);
            const corners=outer.map(ground),height=corners.reduce((s,p)=>s+p[1],0)/corners.length;
            const rimPoint=p=>[p[0],height,p[1]];
            emit(data.water,inner.map(waterPoint));
            emit(data.bank,corners,[rim.map(rimPoint)]);
            emit(data.bank,rim.map(rimPoint),[inner.map(waterPoint)]);
            for(let i=data.bankColors.length;i<data.bank.length;i+=3){
                const wet=inner.some(p=>Math.abs(p[0]-data.bank[i])<1e-6&&Math.abs(p[1]-data.bank[i+2])<1e-6);
                const tint=wet ? .83 : 1;
                data.bankColors.push(tint,tint,tint);
            }
            continue;
        }
        const inner=insetAndSmooth(outer),holes=basin.holes.map(l=>insetAndSmooth(l));
        emit(data.water,inner.map(waterPoint),holes.map(l=>l.map(waterPoint)));
        emit(data.bank,outer.map(ground),[inner.map(waterPoint)]);
        basin.holes.forEach((hole,i)=>emit(data.bank,holes[i].map(waterPoint).reverse(),[hole.map(ground).reverse()]));
        while(data.bankColors.length<data.bank.length)data.bankColors.push(1);
    }
    for(let i=0;i<data.water.length;i+=3)data.waterColors.push(1,1,1);
    return {...data,supported:true};
}
