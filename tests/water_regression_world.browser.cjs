// Read-only snapshot of the reported map, rendered in the isolated test lobby.
const fs=require('node:fs'),path=require('node:path');
module.exports=async({page,shot,measure,output,mode})=>{
    let chunks=JSON.parse(fs.readFileSync(process.env.VTT_WATER_REGRESSION_MAP,'utf8'));
    const original=await page.evaluate('[...W.chunksMap.values()].map(c=>({x:c.chunkX,z:c.chunkY,data:c.tilesData}))');
    const region=process.env.VTT_WATER_REGRESSION_REGION;
    if(region==='bridge')chunks=chunks.filter(c=>c.chunk_x>=7&&c.chunk_x<=8&&c.chunk_y>=5&&c.chunk_y<=6);
    await page.evaluate('W.setMapDimensions(16,16); [...W.chunksMap.values()].forEach(c=>W.removeChunk(c.chunkX,c.chunkY)); look(213,7,284,208.5,1.6,278.5)');
    const start=Date.now();
    for(const c of chunks)await page.evaluate(`W.addChunk(${c.chunk_x},${c.chunk_y},${JSON.stringify(c.data)})`);
    await page.evaluate('new Promise(r=>setTimeout(r,1500))');
    const buildMs=Date.now()-start;
    for(const [name,cam]of [
        ['reported-shore',[213,5,284,208.5,1.6,278.5]],
        ['reported-shore-low',[211,2.7,281,208.5,1.6,278.5]],
        ['reported-bridge-long',[266,4,198,261.5,1.5,197.5]],
        ['reported-bridge-short',[258,5,205,254.5,2,204.5]],
    ]){if(region==='bridge'&&name.includes('shore'))continue;await page.evaluate(`look(${cam.join(',')})`);await shot(name);}
    const performance=[];
    for(const [distance,cam]of [
        ['close',[218,12,291,208,1,278]],
        ['medium',[255,75,355,208,1,278]],
        ['far',[300,260,490,208,1,278]],
    ]){
        if(region)break;
        await page.evaluate(`look(${cam.join(',')});new Promise(r=>setTimeout(r,800))`);
        await shot('map-'+distance);
        const frame=await measure(false);
        if(process.env.VTT_BROWSER_GPU==='1'){
            frame.animation=await page.evaluate(`new Promise(resolve=>{const deltas=[];let prev=null,warm=8;const next=now=>{if(prev!==null&&warm--<=0)deltas.push(now-prev);prev=now;if(deltas.length<32)requestAnimationFrame(next);else{const sorted=deltas.slice().sort((a,b)=>a-b);resolve({fps:1000/(deltas.reduce((a,b)=>a+b,0)/deltas.length),medianMs:sorted[16],p95Ms:sorted[30]})}};requestAnimationFrame(next)})`);
        }
        performance.push({distance,...frame});
    }
    const geometry=await page.evaluate(`(()=>{const cs=[...W.chunksMap.values()];return {chunks:cs.length,waterTriangles:cs.reduce((n,c)=>n+(c.waterSurface?.geometry.index?.count||c.waterSurface?.geometry.attributes.position.count||0)/3,0),bankTriangles:cs.reduce((n,c)=>n+(c.waterBank?.geometry.index?.count||c.waterBank?.geometry.attributes.position.count||0)/3,0),shoreBytes:cs.reduce((n,c)=>n+[c.waterSurface,c.waterBank].filter(Boolean).reduce((n,m)=>n+Object.values(m.geometry.attributes).reduce((s,a)=>s+a.array.byteLength,0)+(m.geometry.index?.array.byteLength||0),0),0)}})()`);
    fs.writeFileSync(path.join(output,mode+'-large-map.json'),JSON.stringify({buildMs,geometry,performance},null,2));
    console.log('Large map',mode,JSON.stringify({buildMs,geometry,performance}));
    if(process.env.VTT_WATER_REGRESSION_ONLY==='1')return;
    // Restore the saved test lobby; its save/sync checks remain independent.
    await page.evaluate("[...W.chunksMap.values()].forEach(c=>W.removeChunk(c.chunkX,c.chunkY));W.setMapDimensions(2,2);look(36,4,12,32.5,1,7.5)");
    for(const c of original)await page.evaluate(`W.addChunk(${c.x},${c.z},${JSON.stringify(c.data)})`);
    await page.until('W.chunksMap.size===4','fixture chunks');
};
