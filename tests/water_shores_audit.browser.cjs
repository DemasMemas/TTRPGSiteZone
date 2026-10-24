// Read-only renderer audit; fixture writes go only to the harness's temporary DB.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/water-audit');fs.mkdirSync(output,{recursive:true});
    const updates=[];
    for(let z=0;z<32;z++)for(let x=23;x<45;x++){
        const water=x>=31&&x<=34;
        const height=!water&&x===30&&z>=15&&z<=18?2.5:1;
        updates.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,updates:{terrain:water?'water':x<31?'grass':'sand',height,objects:[]}});
    }
    await request(`/lobbies/${lobby.id}/chunks/batch`,updates,token);
    await page.until("sceneModule.chunksMap.get('1,0').waterSurface&&sceneModule.chunksMap.get('0,0').tilesData[16][30].height===2.5",'audit fixture');await pause(600);
    await page.evaluate(`(async()=>{window.waterAuditModule=await import('/static/js/locationWaterEdge.js');window.terrainAudit=await import('/static/js/locationTerrain.js');window.at=(x,z)=>sceneModule.chunksMap.get(Math.floor(x/32)+','+Math.floor(z/32))?.tilesData[z%32]?.[x%32];window.look=(x,y,z,tx,ty,tz)=>{sceneModule.controls.target.set(tx,ty,tz);sceneModule.camera.position.set(x,y,z);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld(true)}})()`);
    const shot=async(name,camera)=>{await page.evaluate(`look(${camera.join(',')})`);await pause(400);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    await shot('overview',[42,16,31,32,1,16]);
    await shot('raised-shore',[33,4.4,21,30.8,1.5,17]);
    const before=await page.evaluate(`(()=>{const W=sceneModule;return [...W.chunksMap.values()].map(e=>({chunk:[e.chunkX,e.chunkY],waterTopTriangles:e.waterSurface.geometry.attributes.position.count/3,bankTriangles:e.waterBank.geometry.attributes.position.count/3,waterInstances:e.water.count,bankY:e.waterBank.position.y,receiveShadow:e.waterSurface.receiveShadow}))})()`);
    const classification=await page.evaluate(`(()=>{const results=[];for(const cx of [0,1]){const padded=Array.from({length:34},(_,z)=>Array.from({length:34},(_,x)=>at(cx*32+x-1,z-1)||null));const regions=waterAuditModule.classifyWaterRegions(padded);results.push({chunk:cx,sameWorldTile:[31,7],kind:regions.get((31-cx*32+1)+',8')});}return results})()`);
    // Compare sampled bank boundary height with the real triangulated terrain.
    const bankMismatch=await page.evaluate(`(()=>{const e=sceneModule.chunksMap.get('0,0'),a=e.waterBank.geometry.attributes.position,padded=Array.from({length:34},(_,z)=>Array.from({length:34},(_,x)=>at(x-1,z-1)||null)),sample=terrainAudit.createTerrainSurfaceHeightSampler(padded);let max=0,point=null;for(let i=0;i<a.count;i++){const x=a.getX(i)-1,z=a.getZ(i)-1;if(Math.abs(x-31)>1e-6||z<14||z>20)continue;const real=sample(31-1e-5+1,z+1),bank=a.getY(i)+e.waterBank.position.y,diff=bank-real;if(Math.abs(diff)>Math.abs(max)){max=diff;point={x,z,bank,terrain:real};}}return {maximumSignedDifference:max,point}})()`);
    const data={waypoints:[[28,7],[38,7]],allow_bridges:true,settings:{scale:1,color:'#756f61'}};
    const plan=await request(`/lobbies/${lobby.id}/world-roads/preview`,data,token);assert.ok(plan.bridges>0);
    const bankBefore=await page.evaluate('JSON.stringify([at(30,7),at(35,7)])');
    await request(`/lobbies/${lobby.id}/world-roads/build`,{...data,signature:plan.signature},token);
    await page.until("sceneModule.chunksMap.get('1,0').roads.some(m=>m.userData.worldBridgeAsset)",'bridge');
    const bankAfter=await page.evaluate('JSON.stringify([at(30,7),at(35,7)].map(t=>t.height))');
    assert.deepEqual(JSON.parse(bankAfter),JSON.parse(bankBefore).map(t=>t.height));
    await shot('bridge-and-chunk',[36,4,12,32.5,1,7.5]);
    await request(`/lobbies/${lobby.id}/chunks/1/0/tile/1/12`,{height:1.4},token,'PATCH');
    await page.until("at(33,12).height===1.4",'different levels');await pause(600);
    await shot('unequal-water-levels',[36,3.4,16,33.5,1.2,12.5]);
    const numerical=await page.evaluate(`(()=>{const tiles=[[{terrain:'water',height:1},{terrain:'water',height:1.4}]],d=waterAuditModule.buildRoundedWaterData(tiles,.24,()=>true,[0,.075,.23,.5,.77,.925,1],t=>Number(t.height)||1),edge=[];for(let i=0;i<d.water.length;i+=3)if(Math.abs(d.water[i]-1)<1e-7)edge.push(d.water[i+1]);const water=waterAuditModule.buildRoundedWaterData([[{terrain:'water',height:0}]],.24,()=>true,null,t=>Number(t.height)||1);return {sharedEdgeLevels:[...new Set(edge)],storedZeroRenderedTop:water.water[1],waterMaterial:{roughness:sceneModule.waterMat.roughness,metalness:sceneModule.waterMat.metalness,transparent:sceneModule.waterMat.transparent,normalMap:!!sceneModule.waterMat.normalMap,envMap:!!sceneModule.waterMat.envMap,environment:!!sceneModule.scene.environment,textureSize:[sceneModule.waterMat.map.image.width,sceneModule.waterMat.map.image.height]},lighting:{ambient:sceneModule.ambientLight.intensity,directional:sceneModule.directionalLight.intensity,fill:sceneModule.fillLight.intensity},renderer:{outputEncoding:sceneModule.renderer.outputEncoding,toneMapping:sceneModule.renderer.toneMapping}}})()`);
    const lighting=[];
    for(const [name,angle] of [['light-low',.2],['light-high',1.1]]){lighting.push(await page.evaluate(`(()=>{const l=sceneModule.directionalLight;l.position.set(12,${Math.tan(angle)*12},0);l.updateMatrixWorld(true);return {name:${JSON.stringify(name)},position:l.position.toArray(),intensity:l.intensity}})()`));await shot(name,[36,4,12,32.5,1,7.5]);}
    const result={scope:'isolated temporary lobby; production renderer unchanged',before,classification,bankMismatch,bridgeBuildLeavesBankHeights:JSON.parse(bankAfter),numerical,lighting};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log('WATER AUDIT:',JSON.stringify(result));
};
