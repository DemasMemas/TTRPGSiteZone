import { ROAD_SURFACE_LIFT } from './worldRoadSurface.js';
import { worldWaterCeiling } from './worldWaterGeometry.js';

export const BRIDGE_WATER_CLEARANCE=.025;

const road = tile => tile?.objects?.find(o=>o.type==='road');
const wet = tile => tile?.terrain==='water' && road(tile)?.bridge;
const center = (x,z,tile) => ({x:x+.5+Number(road(tile)?.x||0),z:z+.5+Number(road(tile)?.z||0)});

// Derive the complete connected span on either side of a chunk. Ownership is
// assigned to water cells, including the half-cell approaches on dry banks.
export function buildWorldBridgeLayout({nodes,getTile,connected,sampleHeight,owns=()=>true}) {
    const seen=new Set(),sections=[];
    for(const node of nodes){
        if(seen.has(`${node.x},${node.z}`)||!wet(getTile(node.x,node.z)))continue;
        const north=connected(node.x,node.z,0,-1)||connected(node.x,node.z,0,1);
        const dx=north?0:1,dz=north?1:0;
        let x=node.x,z=node.z;
        for(let i=0;i<2048&&connected(x,z,-dx,-dz)&&wet(getTile(x-dx,z-dz));i++){x-=dx;z-=dz;}
        const cells=[];
        for(let i=0;i<2048;i++){
            cells.push({x,z});seen.add(`${x},${z}`);
            if(!connected(x,z,dx,dz)||!wet(getTile(x+dx,z+dz)))break;
            x+=dx;z+=dz;
        }
        const first=cells[0],last=cells.at(-1);
        const endpoint=(cell,sign)=>{
            const bx=cell.x+dx*sign,bz=cell.z+dz*sign,tile=getTile(bx,bz);
            if(connected(cell.x,cell.z,dx*sign,dz*sign)&&tile&&tile.terrain!=='water'){
                const p=center(bx,bz,tile);
                return {...p,y:sampleHeight(p.x,p.z)+ROAD_SURFACE_LIFT+.004,land:true};
            }
            const t=getTile(cell.x,cell.z),p=center(cell.x,cell.z,t);
            return {x:p.x+dx*sign*.5,z:p.z+dz*sign*.5,y:Number(road(t)?.bridge_height??t.height+.06)+.014};
        };
        const start=endpoint(first,-1),end=endpoint(last,1);
        const vx=end.x-start.x,vy=end.y-start.y,vz=end.z-start.z;
        const length=Math.hypot(vx,vy,vz);
        if(length<1e-6)continue;
        const width=cells.reduce((sum,c)=>sum+Number(road(getTile(c.x,c.z))?.scale||1),0)/cells.length;
        // Original asphalt width / section length. Uniform scaling preserves
        // the author's proportions; additional length uses additional modules.
        let count=Math.max(1,Math.ceil(length/(.24*width/.5768363904)));
        const scale=length/count;
        const along=dx?vx:vz,origin=dx?start.x:start.z;
        // The global water path uses the tile level without the sand-region
        // reduction and places its visible surface at level + .012.
        const intervals=cells.map(c=>({
            from:Math.max(0,((dx?c.x:c.z)-origin)/along),
            to:Math.min(1,((dx?c.x:c.z)+1-origin)/along),
            height:worldWaterCeiling(getTile,c.x,c.z)+BRIDGE_WATER_CLEARANCE,
        }));
        const lift=intervals.some(c=>Math.min(start.y+vy*c.from,start.y+vy*c.to)<c.height);
        if(lift){
            // Leave a whole dry section for each approach. Water sections can
            // then rise without lifting the bank road node or changing terrain.
            const approach=Math.min(start.land&&intervals[0].from>1e-8?intervals[0].from:1,
                end.land&&intervals.at(-1).to<1-1e-8?1-intervals.at(-1).to:1);
            count=Math.max(count,Math.ceil(1/approach-1e-8));
        }
        const joints=Array.from({length:count+1},(_,i)=>({x:start.x+vx*i/count,y:start.y+vy*i/count,z:start.z+vz*i/count}));
        if(lift){
            let cursor=0;
            for(let i=0;i<count;i++){
                const a=i/count,b=(i+1)/count;
                while(cursor<intervals.length&&intervals[cursor].to<=a+1e-9)cursor++;
                for(let j=cursor;j<intervals.length&&intervals[j].from<b-1e-9;j++){
                    if(i>0||!start.land)joints[i].y=Math.max(joints[i].y,intervals[j].height);
                    if(i+1<count||!end.land)joints[i+1].y=Math.max(joints[i+1].y,intervals[j].height);
                }
            }
        }
        // Constrain the deck, rather than the bottom of the complete model.
        // The dry endpoints remain the existing road anchors. A single pass
        // collects ground constraints; the envelope below removes local ripples.
        for(let i=0;i<count;i++){
            const a=joints[i],b=joints[i+1],run=Math.hypot(b.x-a.x,b.z-a.z),ux=(b.x-a.x)/run,uz=(b.z-a.z)/run;
            for(let k=0;k<=16;k++){
                const t=k/16,px=a.x+(b.x-a.x)*t,pz=a.z+(b.z-a.z)*t;
                const tile=getTile(Math.floor(px),Math.floor(pz));
                if(!tile||tile.terrain==='water')continue;
                // At the road cross-section the asphalt follows the road;
                // broaden the clearance check across the bank-side approach.
                const distance=Math.min(Math.hypot(px-start.x,pz-start.z),Math.hypot(px-end.x,pz-end.z));
                const half=.2884181952*scale*Math.min(1,distance/.25);
                const ground=Math.max(...[-half,0,half].map(side=>{
                    const x=px-uz*side,z=pz+ux*side;
                    const tile=getTile(Math.floor(x),Math.floor(z));
                    return tile&&tile.terrain!=='water'?sampleHeight(x,z)+ROAD_SURFACE_LIFT+.004:-Infinity;
                }));
                if(i===0&&start.land){if(t>1e-8)b.y=Math.max(b.y,(ground-a.y*(1-t))/t);}
                else if(i===count-1&&end.land){if(t<1-1e-8)a.y=Math.max(a.y,(ground-b.y*t)/(1-t));}
                else {a.y=Math.max(a.y,ground);b.y=Math.max(b.y,ground);}
            }
        }
        // Use the upper concave envelope of the required deck heights. It
        // removes local peaks/dips while keeping both dry road anchors fixed.
        // Abutments may enter the bank: lifting the complete model's underside
        // above land was what raised the road and caused the previous regression.
        const hull=[];
        for(let i=0;i<joints.length;i++){
            while(hull.length>1){
                const a=hull.at(-2),b=hull.at(-1);
                if((joints[b].y-joints[a].y)/(b-a)>(joints[i].y-joints[b].y)/(i-b)+1e-10)break;
                hull.pop();
            }
            hull.push(i);
        }
        for(let k=1;k<hull.length;k++){
            const a=hull[k-1],b=hull[k];
            for(let i=a+1;i<b;i++)joints[i].y=joints[a].y+(joints[b].y-joints[a].y)*(i-a)/(b-a);
        }
        for(let i=0;i<count;i++){
            const a=joints[i],b=joints[i+1],p={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2};
            const sx=b.x-a.x,sy=b.y-a.y,sz=b.z-a.z,sectionLength=Math.hypot(sx,sy,sz);
            const index=Math.max(0,Math.min(cells.length-1,Math.round(dx?p.x-first.x-.5:p.z-first.z-.5)));
            const c=cells[index];
            if(owns(c.x,c.z))sections.push({position:p,direction:{x:sx/sectionLength,y:sy/sectionLength,z:sz/sectionLength},
                scale,length:sectionLength,owner:c});
        }
    }
    return sections;
}
