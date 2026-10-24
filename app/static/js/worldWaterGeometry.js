import { buildRoundedWaterData, connectedWaterHeightAt } from './locationWaterEdge.js';
import { createTerrainSurfaceHeightSampler } from './locationTerrain.js';

export const worldWaterLevel = tile => Number(tile?.height) || 1;

// A conservative envelope for a bridge, including water touching its corners.
export function worldWaterCeiling(getTile, x, z) {
    const tiles=Array.from({length:3},(_,j)=>Array.from({length:3},(_,i)=>getTile(x+i-1,z+j-1)));
    return Math.max(worldWaterLevel(tiles[1][1]), ...[[1,1],[2,1],[2,2],[1,2]].map(([px,pz])=>
        connectedWaterHeightAt(tiles,1,1,px,pz,new Map(),worldWaterLevel)))+.012;
}

// World adapter to the existing local shoreline ring. All dependencies remain
// within the tile's 3x3 neighbourhood; no flood-fill or persisted level map.
export function buildWorldWaterData(tiles, includeTile=()=>true, originX=0, originZ=0) {
    const options={
        shorelineRing:true, worldOrigin:{x:originX,z:originZ},
        landSurfaceHeightAt:createTerrainSurfaceHeightSampler(tiles),
    };
    const data=buildRoundedWaterData(tiles,.24,includeTile,null,worldWaterLevel,options);
    // Weld geometric normals across tile fans, including the padded neighbour
    // triangles at chunk edges. The water material itself remains unchanged.
    const halo=buildRoundedWaterData(tiles,.24,(x,z)=>!includeTile(x,z),null,worldWaterLevel,options);
    const normals=new Map(),key=(a,i)=>[a[i],a[i+1],a[i+2]].map(n=>Math.round(n*1e6)).join(',');
    const face=(a,i)=>{
        const ux=a[i+3]-a[i],uy=a[i+4]-a[i+1],uz=a[i+5]-a[i+2],
            vx=a[i+6]-a[i],vy=a[i+7]-a[i+1],vz=a[i+8]-a[i+2];
        return [uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    };
    for(const a of [data.water,halo.water])for(let i=0;i<a.length;i+=9){
        const n=face(a,i);for(const j of [i,i+3,i+6]){const k=key(a,j),sum=normals.get(k)||[0,0,0];
            for(let axis=0;axis<3;axis++)sum[axis]+=n[axis];normals.set(k,sum);}
    }
    const waterNormals=[];for(let i=0;i<data.water.length;i+=3){const n=normals.get(key(data.water,i)),length=Math.hypot(...n)||1;waterNormals.push(...n.map(v=>v/length));}
    const bankPositions=[...data.bank,...data.sandBank],bankOwners=[];
    // Assign each bank vertex its nearest real land owner for existing PBR maps.
    // Ties use spatial order, independent of traversal or chunk arrival order.
    for(let i=0;i<bankPositions.length;i+=3){
        const px=bankPositions[i],pz=bankPositions[i+2];let owner=null,distance=Infinity;
        for(let z=Math.floor(pz)-1;z<=Math.floor(pz)+1;z++)for(let x=Math.floor(px)-1;x<=Math.floor(px)+1;x++){
            if(!tiles[z]?.[x]||tiles[z][x].terrain==='water')continue;
            const dx=Math.max(x-px,0,px-x-1),dz=Math.max(z-pz,0,pz-z-1),d=dx*dx+dz*dz;
            if(d<distance-1e-10){owner=[x+originX,z+originZ];distance=d;}
        }
        bankOwners.push(...(owner||[px+originX,pz+originZ]));
    }
    const sides=[];
    // Only map/unloaded boundaries need a water volume wall. Along land the
    // shoreline ring closes the surface; between water cells there is no wall.
    for(let z=0;z<tiles.length;z++)for(let x=0;x<(tiles[z]?.length||0);x++){
        if(!includeTile(x,z)||tiles[z][x]?.terrain!=='water')continue;
        for(const [dx,dz,a,b] of [[0,-1,[x,z],[x+1,z]],[1,0,[x+1,z],[x+1,z+1]],
            [0,1,[x+1,z+1],[x,z+1]],[-1,0,[x,z+1],[x,z]]]){
            if(tiles[z+dz]?.[x+dx])continue;
            const middle=[(a[0]+b[0])/2,(a[1]+b[1])/2];
            for(const [p,q] of [[a,middle],[middle,b]]){
                const py=connectedWaterHeightAt(tiles,x,z,...p,data.regions,worldWaterLevel)+.012;
                const qy=connectedWaterHeightAt(tiles,x,z,...q,data.regions,worldWaterLevel)+.012;
                const bottom=Math.min(0,py-.05,qy-.05),P=[p[0],py,p[1]],Q=[q[0],qy,q[1]],
                    B=[p[0],bottom,p[1]],C=[q[0],bottom,q[1]];
                sides.push(...P,...Q,...B,...Q,...C,...B);
            }
        }
    }
    for(let i=0;i<sides.length;i+=9){const n=face(sides,i),length=Math.hypot(...n)||1;for(let j=0;j<3;j++)waterNormals.push(...n.map(v=>v/length));}
    return {...data,bankPositions,bankOwners,sides,waterNormals};
}
