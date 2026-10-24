import { buildRoundedWaterData, connectedWaterHeightAt } from './locationWaterEdge.js';
import { smoothWaterNormals, waterFaceNormal, shoreOwners } from './waterGeometryUtils.js';
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
        landSurfaceHeightAt:createTerrainSurfaceHeightSampler(tiles), flatShore:true,
    };
    const data=buildRoundedWaterData(tiles,.24,includeTile,null,worldWaterLevel,options);
    // Weld geometric normals across tile fans, including the padded neighbour
    // triangles at chunk edges, without requiring a separate normal-map resource.
    const halo=buildRoundedWaterData(tiles,.24,(x,z)=>!includeTile(x,z),null,worldWaterLevel,options);
    const waterNormals=smoothWaterNormals(data.water,halo.water);
    const bankPositions=[...data.bank,...data.sandBank],bankOwners=shoreOwners(bankPositions,tiles,originX,originZ);
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
    for(let i=0;i<sides.length;i+=9){const n=waterFaceNormal(sides,i),length=Math.hypot(...n)||1;for(let j=0;j<3;j++)waterNormals.push(...n.map(v=>v/length));}
    return {...data,bankPositions,bankOwners,sides,waterNormals};
}
