// VTT_BUILDING_SHELL=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
module.exports = async ({page,request,token,lobby,base,connect,debugPort}) => {
    const api = `/lobbies/${lobby.id}`;
    const loc = await request(`${api}/locations`, { name:'Shell acceptance', world_tile_x:12,world_tile_z:12,
        grid_width:24,grid_height:24,tiles_data:Array.from({length:24},()=>Array.from({length:24},()=>({terrain:'bare_dirt',height:1,objects:[]}))) },token);
    const detail = ()=>request(`${api}/locations/${loc.id}`,null,token,'GET');
    await page.evaluate(`(async()=>{
        window.T=threeModule;const old=T.Scene.prototype.add;
        T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;
            const before=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);if(window.isLocationActive)window.shellRender={r,s,c}}});return old.apply(this,roots)};
        window.L=await import('/static/js/locationScene.js');await enterLocation(${loc.id});
        L.setLocationEditMode(true);selectLocationEditorTool('assets');
        locationControls.target.set(8,1,8);locationControls.object.position.set(17,18,22);locationControls.update();
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();
        document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();
    })()`);
    await page.until('window.shellRender&&document.querySelector("[data-house-draw]")','local renderer');
    const aim=(x,z)=>page.evaluate(`(()=>{const p=new T.Vector3(${x},1.05,${z}).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const draw=async(min=2.5,max=11.5)=>{
        await page.evaluate(`L.setLocationHouseDrawMode(true);true`);
        const a=await aim(min,min),b=await aim(max,max);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...a});await pause(100);
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...a});
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,...b});
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...b});
        await page.until('!!document.querySelector("dialog[open] [data-shell-preview]")','shell options after drag');
    };
    await draw();
    await page.evaluate(`(()=>{const f=document.querySelector('dialog form');f.elements.shape.value='L';f.elements.width.value=10;f.elements.depth.value=10;
        f.elements.storeys.value=2;f.elements.basements.value=1;f.elements.wealth.value='rich';f.elements.condition.value='damaged';
        f.elements.shape.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('[data-shell-preview]').click()})()`);
    assert.equal((await detail()).objects.length,0,'preview must not persist objects');
    assert.equal(await page.evaluate('document.querySelector("[data-shell-create]").disabled'),false);
    assert.ok(await page.evaluate('document.querySelector("dialog[open]").getBoundingClientRect().bottom <= innerHeight'));
    // Read preview in the ordinary game camera; retain only a temporary inspection frame.
    if(process.env.VTT_SHELL_INSPECT==='1'){
        const file=path.join(os.tmpdir(),'vtt-shell-preview.png');
        fs.writeFileSync(file,Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        console.log('INSPECTION FRAME',file);
    }
    await page.evaluate(`document.querySelector('dialog form').requestSubmit(document.querySelector('[data-shell-create]'));true`);
    await page.until(`document.body.innerText.includes('Все элементы доступны для ручной правки')`,'shell persisted');
    const built=await detail();
    assert.ok(built.objects.length>80);
    const buildingId=built.objects[0].properties.building_id;
    assert.ok(built.objects.every(o=>o.properties.building_id===buildingId));
    assert.deepEqual([...new Set(built.objects.map(o=>o.properties.level))].sort(),[-1,0,1]);
    await page.until(`socket.connected&&socket.io.engine.transport.name==='websocket'`,'actual WebSocket');
    const target=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    try {
        await peer.call('Page.bringToFront');
        await peer.until('window.enterLocation&&window.socket?.connected&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','second game client');
        await peer.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');
            window.shellUpdates=[];socket.on('location_object_updated',d=>shellUpdates.push(d));
            socket.on('joined_location',d=>window.shellJoined=d);await enterLocation(${loc.id})})()`);
        await peer.until(`isLocationActive&&shellJoined?.location_id===${loc.id}`,'peer joined location room');
        await peer.until(`socket.io.engine.transport.name==='websocket'`,'peer WebSocket');
        await page.call('Page.bringToFront');
        const floor=built.objects.find(o=>o.type==='floor'&&o.properties.level===0);
        await request(`${api}/locations/objects/${floor.id}`,{properties:{color:'#ac9872'}},token,'PATCH');
        await peer.until(`shellUpdates.some(d=>JSON.stringify(d).includes('#ac9872'))`,'manual edit delivered to second client');
        await page.evaluate(`L.setLocationViewLevel(-1);true`);await pause(500);
        await page.evaluate(`L.setLocationViewLevel(1);true`);await pause(500);
        await page.evaluate(`L.setLocationViewLevel(0);true`);
        // Repeating at the same site must preserve every object and the manual edit.
        await draw();
        await page.evaluate(`document.querySelector('[data-shell-preview]').click();document.querySelector('dialog form').requestSubmit(document.querySelector('[data-shell-create]'));true`);
        await page.until(`document.body.innerText.includes('На этом месте уже есть')`,'overlap refused');
        const after=await detail();assert.equal(after.objects.length,built.objects.length);
        assert.equal(after.objects.find(o=>o.id===floor.id).properties.color,'#ac9872');
        const actor=await request(`${api}/characters`,{name:'Shell climber',data:{}},token);
        const g=built.objects[0].properties.building_generation;
        await request(`${api}/locations/${loc.id}/spawn_character`,{character_id:actor.id,tile_x:g.minX+1,tile_y:g.minZ+1},token);
        await page.evaluate(`window.shellMoves=[];window.shellRejects=[];socket.on('character_moved',d=>shellMoves.push(d));socket.on('movement_rejected',d=>shellRejects.push(d));L.setLocationEditMode(false);true`);
        const move=async(x,y,level)=>{
            await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:${x},y:${y},floor_level:${level}});true`);
            await page.until(`shellMoves.at(-1)?.x===${x}&&shellMoves.at(-1)?.y===${y}&&shellMoves.at(-1)?.floor_level===${level}`,'generated ladder movement');
            await pause(600);
        };
        await move(g.minX+2,g.minZ+2,-1);
        await move(g.minX+1,g.minZ+1,0);
        await move(g.minX+1,g.minZ+1,1);
        assert.equal(await page.evaluate('shellRejects.length'),0);
        if(process.env.VTT_SHELL_INSPECT==='1'){
            await page.evaluate(`L.setLocationViewLevel(-1);true`);await pause(800);
            fs.writeFileSync(path.join(os.tmpdir(),'vtt-shell-basement.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
            await page.evaluate(`L.setLocationViewLevel(1);locationControls.object.position.set(${g.minX+8},12,${g.minZ+10});locationControls.target.set(${g.minX+4},3.4,${g.minZ+4});locationControls.update();true`);await pause(800);
            fs.writeFileSync(path.join(os.tmpdir(),'vtt-shell-created.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        }
        await page.evaluate('window.shellReloadMarker=true;true');
        await page.call('Page.reload');
        await page.until('!window.shellReloadMarker&&window.enterLocation&&window.socket?.connected&&document.getElementById("scene-loading-screen").classList.contains("is-hidden")','reload');
        await page.evaluate(`window.enterLocation(${loc.id});true`);await page.until('window.isLocationActive','room re-entry');
        assert.deepEqual((await detail()).objects.map(o=>o.id).sort(),after.objects.map(o=>o.id).sort());
        // A second, free area previews a different shape, wealth and ruin geometry.
        await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');L.setLocationEditMode(true);selectLocationEditorTool('assets');
            const T=await import('three');
            locationControls.target.set(17,1,17);locationControls.object.position.set(26,18,31);locationControls.update();
            document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();
            document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();window.T=T})()`);
        await pause(700);
        await draw(13.5,22.5);
        await page.evaluate(`(()=>{const f=document.querySelector('dialog form');f.elements.shape.value='C';f.elements.width.value=10;f.elements.depth.value=10;f.elements.wealth.value='poor';f.elements.condition.value='ruins';f.elements.shape.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-shell-preview]').click()})()`);
        if(process.env.VTT_SHELL_INSPECT==='1'){
            await pause(700);
            fs.writeFileSync(path.join(os.tmpdir(),'vtt-shell-ruins.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        }
        await page.evaluate(`document.querySelector('dialog').close();true`);
        assert.equal((await detail()).objects.length,after.objects.length,'cancelled ruin preview persists nothing');
        console.log('BUILDING SHELL PASS',JSON.stringify({objects:built.objects.length,levels:[-1,0,1],transport:'websocket',preview:true,manualEdit:true,reload:true,overlapPreserved:true,characterMovement:true}));
    } finally {peer.close();await page.call('Target.closeTarget',{targetId:target.targetId});}
};
