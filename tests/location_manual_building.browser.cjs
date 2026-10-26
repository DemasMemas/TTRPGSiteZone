// Run: $env:VTT_MANUAL_BUILDING='1'; node tests/world_object_editor.browser.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async ({page, request, token, lobby, base, connect, debugPort}) => {
    const out = path.resolve('docs/asset-previews/manual-building');
    fs.mkdirSync(out, {recursive:true});
    const api = `/lobbies/${lobby.id}`;
    const loc = await request(api+'/locations', {name:'Manual building audit', world_tile_x:10, world_tile_z:10,
        grid_width:36, grid_height:24, tiles_data:Array.from({length:24}, (_,z) =>
            Array.from({length:36}, (_,x) => ({terrain:'bare_dirt',height:x>=25?1.7:1,objects:[]})))}, token);
    const add = async (type,x,z,w,d,h,extra={}) => request(`${api}/locations/${loc.id}/objects`, {
        name:type,type,tile_x:Math.floor(x),tile_y:Math.floor(z),properties:{
            building_id:x<12?'L':x<24?'U':'C',level:0,dimensions:{width:w,depth:d,height:h},
            offset_x:x-Math.floor(x)-.5,offset_z:z-Math.floor(z)-.5,...extra}},token);
    // Three orthogonal footprints assembled from the same independent parts as the editor.
    const shapes = [
        {x:3,z:4,cells:[[0,0],[0,1],[0,2],[1,2],[2,2]]},
        {x:15,z:4,cells:[[0,0],[0,1],[0,2],[1,2],[2,2],[2,1],[2,0]]},
        {x:27,z:4,cells:[[0,0],[1,0],[2,0],[0,1],[0,2],[1,2],[2,2]]},
    ];
    const panels=[];
    for (const shape of shapes) {
        const keys = new Set(shape.cells.map(c=>c.join(',')));
        for (const [cx,cz] of shape.cells) {
            const x=shape.x+cx*2,z=shape.z+cz*2;
            await add('floor',x,z,2,2,.12,{roof_enabled:false,color:'#776d5d'});
            panels.push(await add('roof',x,z,2,2,.13,{elevation:2.4,passable:true,cover_enabled:false,color:'#575b52'}));
            for (const [dx,dz] of [[0,-1],[0,1],[-1,0],[1,0]]) {
                if (keys.has([cx+dx,cz+dz].join(','))) continue;
                await add('wall',x+dx,z+dz,2,.2,2.4,{rotation:dx?Math.PI/2:0,color:'#80786c'});
            }
        }
    }
    await add('wall',5,8,3,.12,2.4,{visual_asset:'inner_wall'});
    await add('door',4.5,8,.9,.18,2,{visual_asset:'opening',is_open:true,interactions:[]});
    await add('window',2,6,1.2,.14,1,{rotation:Math.PI/2,elevation:1});
    await add('ceiling',7,7,2,2,.12,{elevation:2.27,passable:true,cover_enabled:false});
    await add('household_wood_chair',4,7,.45,.48,.88);
    await page.evaluate(`window.T=threeModule;window.W=sceneModule;const old=T.Scene.prototype.add;
        T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;
        const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);
        if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return old.apply(this,roots)};
        window.enterLocation(${loc.id})`);
    await page.until('window.isLocationActive&&!!window.localRender&&window.selectLocationEditorTool', 'location');
    await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');
        window.look=(x,y,z,tx,ty,tz)=>{locationControls.target.set(tx,ty,tz);locationControls.object.position.set(x,y,z);locationControls.update();locationControls.object.updateMatrixWorld(true)};
        document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();look(13,13,20,6,1,7)})()`);
    const shot = async name => {await pause(700);fs.writeFileSync(path.join(out,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    // Place the new stair asset with actual mouse input in the running game.
    await page.evaluate(`L.setLocationEditMode(true);window.selectLocationEditorTool('assets');L.setLocationAssetPreset('stairs');
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
    await pause(2500);
    const aim = async (x,y,z) => page.evaluate(`(()=>{const p=new T.Vector3(${x},${y},${z}).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const click = async point => {await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(1800);
        for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...point});};
    await click(await aim(9.5,1,7.5));
    let saved;
    for(let i=0;i<30;i++){saved=await request(`${api}/locations/${loc.id}`,null,token,'GET');if(saved.objects.some(o=>o.type==='stairs'))break;await pause(150);}
    const stairs=saved.objects.find(o=>o.type==='stairs');assert.ok(stairs,'pointer creates stair');
    await page.until(`localRender.scene.children.some(m=>m.userData.locationObjectId===${stairs.id})`,'saved stair mesh');
    await page.evaluate(`L.clearLocationAssetPreset();window.selectLocationEditorTool('select');
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
    const pick = await page.evaluate(`(()=>{const m=localRender.scene.children.find(m=>m.userData.locationObjectId===${stairs.id});const p=new T.Box3().setFromObject(m).getCenter(new T.Vector3()).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    await click(pick);
    await page.until(`L.getSelectedLocationEditorAsset()?.structureType==='stairs'`,'stair selection');
    assert.equal(await page.evaluate(`L.updateSelectedLocationAssetDetails({x:6,z:5.5,elevation:.1,rotation:90,dimensions:{width:1.25,depth:3,height:2.4}})`),true);
    await shot('editor-stairs');
    await page.evaluate(`L.setLocationEditMode(false);look(13,8,19,6,1,7)`);
    await shot('L-exterior');
    await page.evaluate(`document.getElementById('location-roof-btn').click();look(10,10,15,5,1,6)`);
    await shot('L-interior');
    await page.evaluate(`look(24,13,20,17,1,6)`);await shot('U-interior');
    await page.evaluate(`look(35,13,20,29,1.7,6)`);await shot('C-raised');
    const peerTarget = await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===peerTarget.targetId).webSocketDebuggerUrl);
    try {
        await peer.until('Boolean(window.enterLocation&&window.socket?.connected)','peer startup');
        await peer.evaluate(`window.enterLocation(${loc.id})`);await peer.until('window.isLocationActive','peer location');
        await peer.evaluate(`(async()=>{const T=await import('three'),old=T.Scene.prototype.add;window.seen=[];
            T.Scene.prototype.add=function(...roots){for(const r of roots)if(r.userData.locationObject)seen.push(r.userData.locationObject);return old.apply(this,roots)}})()`);
        await request(`${api}/locations/objects/${stairs.id}`,{properties:{rotation:.7}},token,'PATCH');
        await peer.until(`seen.some(o=>o.id===${stairs.id}&&o.properties.rotation===.7)`,'peer sees stair transform');
    } finally {peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId});}
    await page.call('Page.bringToFront');
    // Height edits move all independent parts through the existing terrain anchor path.
    const current=await request(`${api}/locations/${loc.id}`,null,token,'GET');
    const edited=current.objects.find(o=>o.id===stairs.id);
    await page.evaluate(`L.applyLocationTilesUpdate(${loc.id},[{x:${edited.tile_x},z:${edited.tile_y},height:2}])`);
    const y=await page.evaluate(`localRender.scene.children.find(m=>m.userData.locationObjectId===${stairs.id}).position.y`);
    assert.ok(Math.abs(y-2.1)<.001,'stairs follow their terrain anchor');
    await page.evaluate(`window.socket.emit('update_location_tiles',{token:localStorage.getItem('access_token'),
        location_id:${loc.id},updates:[{x:${edited.tile_x},z:${edited.tile_y},height:2}]});true`);
    await page.until(`(async()=>{const r=await fetch('${api}/locations/${loc.id}',{headers:{Authorization:'Bearer '+localStorage.getItem('access_token')}});
        return (await r.json()).tiles_data[${edited.tile_y}][${edited.tile_x}].height===2})()`,'saved terrain height');
    saved=await request(`${api}/locations/${loc.id}`,null,token,'GET');
    assert.equal(saved.objects.find(o=>o.id===stairs.id).properties.rotation,.7);
    await page.call('Page.reload');await page.until('!window.L&&Boolean(window.enterLocation)&&window.socket?.connected','reload startup');
    await page.evaluate(`window.enterLocation(${loc.id})`);await page.until('window.isLocationActive','reload location');
    const reloaded=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.equal(reloaded.objects.length,saved.objects.length);
    assert.equal(reloaded.tiles_data[edited.tile_y][edited.tile_x].height,2);
    const deletion=await fetch(`${base}${api}/locations/objects/${stairs.id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});assert.equal(deletion.status,204);
    const remaining=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.ok(!remaining.objects.some(o=>o.id===stairs.id));
    fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({pointerPlacement:true,selection:true,exactTransform:true,
        secondClient:true,reload:true,delete:true,orthogonalShapes:['L','U','C'],stairHeightAfterLocalEdit:y},null,2));
    console.log('MANUAL BUILDING PASS');
};
