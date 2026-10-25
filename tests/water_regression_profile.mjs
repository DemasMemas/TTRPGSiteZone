// Usage: node tests/water_regression_profile.mjs snapshot.json [baseline-js-dir]
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const chunks=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const margin=Number(process.argv[4]||1);
const source=path.resolve(process.argv[3]||'app/static/js');
const edge='data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(source,'locationWaterEdge.js'),'utf8')).toString('base64');
let code=fs.readFileSync(path.join(source,'worldWaterGeometry.js'),'utf8');
code=code.replaceAll("'./locationWaterEdge.js'",JSON.stringify(edge));
code=code.replace(/'\.\/([^']+)'/g,(_,name)=>JSON.stringify(pathToFileURL(path.resolve('app/static/js',name)).href));
const {buildWorldWaterData}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const cache=new Map(chunks.map(c=>[`${c.chunk_x},${c.chunk_y}`,c.data]));
const get=(x,z)=>cache.get(`${Math.floor(x/32)},${Math.floor(z/32)}`)?.[(z%32+32)%32]?.[(x%32+32)%32]||null;
const run=()=>{
    let triangles=0,bankTriangles=0,attributeBytes=0;
    const start=performance.now();
    for(const c of chunks){
        const ox=c.chunk_x*32-margin,oz=c.chunk_y*32-margin;
        const padded=Array.from({length:32+2*margin},(_,z)=>Array.from({length:32+2*margin},(_,x)=>get(ox+x,oz+z)));
        const d=buildWorldWaterData(padded,(x,z)=>x>=margin&&x<32+margin&&z>=margin&&z<32+margin,ox,oz);
        triangles+=(d.water.length+d.sides.length)/9;bankTriangles+=d.bankPositions.length/9;
        attributeBytes+=(d.water.length+d.sides.length+d.waterNormals.length+d.bankPositions.length*2+d.bankOwners.length+(d.bankNormals?.length||d.bankPositions.length)+d.bankPositions.length/3+d.bankPositions.length/3*2)*4;
    }
    return {ms:performance.now()-start,triangles,bankTriangles,attributeBytes};
};
const samples=[run(),run(),run()].sort((a,b)=>a.ms-b.ms);
console.log(JSON.stringify({source,chunks:chunks.length,median:samples[1],samples},null,2));
