const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/bridge-bank');fs.mkdirSync(output,{recursive:true});
    const updates=[];
    for(let z=5;z<24;z++)for(let x=23;x<43;x++)updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,
        updates:{terrain:x===32?'water':'sand',height:x===32?.4:x<32?1:3,objects:[]}});
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.evaluate(`sceneModule.controls.target.set(32,1.5,12.5);sceneModule.camera.position.set(37,9,21);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld(true);`);
    await pause(700);
    // Repeat the terrain editing sequence that can leave a ground support box raised.
    for(const height of [4,2]){await request(`/lobbies/${lobby.id}/chunks/0/0/tile/31/12`,{height},token,'PATCH');await pause(700);}
    await page.until("sceneModule.chunksMap.get('0,0').tilesData[12][31].height===2&&sceneModule.chunksMap.get('0,0').smoothTileFoundation?.has(12*32+31)",'shore edits settled');
    const snapshot=`(()=>{const e=sceneModule.chunksMap.get('0,0'),m=new threeModule.Matrix4();e.ground.getMatrixAt(e.groundIndices[12*32+31],m);return {matrix:m.toArray(),bottom:m.elements[13]-m.elements[5]/2,foundation:e.smoothTileFoundation.get(12*32+31),height:e.tilesData[12][31].height}})()`;
    const before=await page.evaluate(snapshot);console.log('Bank before bridge:',JSON.stringify(before));
    // Hold only the existing deferred terrain rebuild to inspect the immediate
    // instance update; no diagnostic hooks are added to the application.
    await page.evaluate(`(()=>{const schedule=window.setTimeout;window.setTimeout=(fn,delay,...args)=>fn.name==='flushWorldTerrainRefresh'?(window.bankRefresh=fn,-1):schedule(fn,delay,...args);try{sceneModule.updateTileInChunk(0,0,31,12,{height:4});}finally{window.setTimeout=schedule;}sceneModule.renderer.render(sceneModule.scene,sceneModule.camera);})()`);
    const pending=await page.evaluate(snapshot);
    const pendingName=process.env.VTT_BRIDGE_BANK_BASELINE==='1'?'pending-before-fix':'pending-after-fix';
    fs.writeFileSync(path.join(output,pendingName+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    console.log('Bank during queued rebuild:',JSON.stringify(pending));
    if(process.env.VTT_BRIDGE_BANK_BASELINE==='1')return;
    assert.ok(Math.abs(pending.bottom)<1e-6,'pending rebuild must not lift the shore support');
    await page.evaluate('window.bankRefresh();sceneModule.updateTileInChunk(0,0,31,12,{height:2})');
    await pause(700);
    const terrain=await page.evaluate("JSON.stringify([...sceneModule.chunksMap].map(([k,e])=>[k,e.tilesData.map(r=>r.map(t=>[t.terrain,t.height]))]))");
    const shot=async name=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await shot('before-bridge');
    const data={waypoints:[[29,12],[35,12]],allow_bridges:true,settings:{scale:1,color:'#756f61'}};
    const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,data,token);
    console.log('Bridge plan:',JSON.stringify(plan.path.map(p=>({x:p.x,y:p.y,height:p.height,bridge:p.bridge,deck:p.bridge_height}))));
    await request(`/lobbies/${lobby.id}/world-roads/build`,{...data,signature:plan.signature},token);
    await page.until("sceneModule.chunksMap.get('1,0').tilesData[12][0].objects.some(o=>o.bridge)",'bridge saved');await pause(700);
    const after=await page.evaluate(snapshot);console.log('Bank after bridge:',JSON.stringify(after));
    assert.equal(await page.evaluate("JSON.stringify([...sceneModule.chunksMap].map(([k,e])=>[k,e.tilesData.map(r=>r.map(t=>[t.terrain,t.height]))]))"),terrain,'bridge must not change terrain data');
    assert.deepEqual(after,before,'bridge must not move ground instances');
    await shot('bridge-unequal-banks');
    assert.ok(Math.abs(after.bottom)<1e-6,'ground support must start at zero, not float above its foundation');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({before,pending,after,terrainUnchanged:true,groundTransformUnchanged:true},null,2)+'\n');
    console.log('PASS: bridge leaves terrain heights and ground transforms unchanged after shore edits');
};
