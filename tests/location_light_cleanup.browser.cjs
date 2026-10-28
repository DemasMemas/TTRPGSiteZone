// Isolated game/SQLite scenario: VTT_LOC_LIGHT_CLEANUP=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async ({page,request,token,lobby,base,connect,debugPort}) => {
    const api=`/lobbies/${lobby.id}/locations`;
    const lights=Array.from({length:20},(_,i)=>({x:3+(i%5)*2,z:4+Math.floor(i/5)*2,
        height:2,color:i%2?'#ffd090':'#c0d8ff',intensity:1+i*.05,distance:5,
        kind:i%4?'point':'spot',azimuth:45}));
    const loc=await request(api,{name:'Legacy saved lighting',world_tile_x:10,world_tile_z:10,
        grid_width:16,grid_height:16,tiles_data:Array.from({length:16},()=>Array.from({length:16},()=>({terrain:'concrete',height:1,objects:[]}))),
        lighting:{mode:'manual',ambient_intensity:.15,directional_intensity:.4,local_lights:lights,dark_tiles:[{x:1,z:1}]}},token);
    const add=async(type,x,z,properties)=>request(`${api}/${loc.id}/objects`,{name:type,type,tile_x:x,tile_y:z,properties},token);
    await add('floor',8,8,{building_id:'house',level:0,dimensions:{width:5,depth:5,height:.12}});
    await add('floor',8,8,{building_id:'house',level:1,dimensions:{width:5,depth:5,height:.12}});
    await add('wall',8,6,{building_id:'house',dimensions:{width:5,depth:.2,height:2.4}});
    await add('campfire',4,5,{is_lit:true});
    await add('ceiling_bulb',7,7,{is_lit:true});
    const detail=()=>request(`${api}/${loc.id}`,null,token,'GET');
    const saved=await detail();
    assert.equal(saved.lighting.mode,'manual');
    assert.deepEqual(saved.lighting.dark_tiles,[{x:1,z:1}]);
    const mount=async(client,id=loc.id)=>{
        await client.call('Page.bringToFront');
        await client.evaluate(`(async()=>{window.T=await import('three');window.W=await import('/static/js/lobby3d.js');window.L=await import('/static/js/locationScene.js');window.UI=await import('/static/js/ui_interactions.js');
            if(!window.lightingRenderHook){window.lightingRenderHook=true;const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;const old=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){old.call(this,r,s,c,...args);if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return add.apply(this,roots)}}
            await enterLocation(${id});return true})()`);
        await client.until("window.localRender&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'local scene loaded');
        await client.evaluate("L.setLocationEditMode(true);locationControls.target.set(8,1,8);locationControls.object.position.set(8,18,22);locationControls.update();UI.collapseMapToolsPanel();true");
    };
    const healthy=async(client,count=20)=>{
        await client.until('L.getLocationStaticLightFieldDiagnostics().enabled','permanent field');
        const result=await client.evaluate(`(()=>{const d=L.getLocationStaticLightFieldDiagnostics();return{d,
            toggle:typeof window.setLocationStaticLightFieldEnabled,
            exported:typeof L.setLocationStaticLightFieldEnabled,
            buttons:[...document.querySelectorAll('button')].filter(b=>/\u0421\u0432\u0435\u0442\u043e\u0432\u043e\u0435 \u043f\u043e\u043b\u0435:/.test(b.textContent)).length,
            oldLights:localRender.scene.children.flatMap(r=>r.children||[]).filter(m=>m.userData.firePoolLight||m.userData.decorFireLight).length}})()`);
        assert.equal(result.toggle,'undefined');assert.equal(result.exported,'undefined');assert.equal(result.buttons,0);
        assert.equal(result.oldLights,0);assert.ok(result.d.materialCount>5);assert.ok(result.d.fieldBytes>0);
        assert.equal(result.d.lampRoutes.length,count);
        assert.ok(result.d.lampRoutes.every(l=>l.route==='field'));
        return result.d;
    };
    await mount(page);await healthy(page);
    const peerTarget=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`});
    const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(pages.find(p=>p.id===peerTarget.targetId).webSocketDebuggerUrl);
    try{
        await peer.call('Runtime.enable');await peer.until('Boolean(window.enterLocation&&window.isGM)','peer startup');
        await mount(peer);await healthy(peer);
        await page.call('Page.bringToFront');
        await page.evaluate("L.setLocationViewLevel(1);true");await healthy(page);
        await page.evaluate("document.getElementById('location-roof-btn').click();true");await healthy(page);
        await page.evaluate("document.getElementById('location-roof-btn').click();L.setLocationViewLevel(0);true");
        await healthy(page);
        const next=structuredClone(saved.lighting);next.local_lights[0].intensity=2.345;
        next.local_lights[0].x=3.125;next.local_lights.push({...lights[0],x:12,z:12,kind:'spot',azimuth:-12.345});
        await request(`${api}/${loc.id}`,{lighting:next},token,'PUT');
        for(const client of [page,peer]){
            await client.until('L.getLocationStaticLightFieldDiagnostics().lampRoutes.length===21&&L.getLocationStaticLightFieldDiagnostics().lampRoutes[0].intensity===2.345','saved lamps synchronized into field');
            await healthy(client,21);
        }
        const latest=await detail();assert.equal(latest.lighting.local_lights[0].x,3.125);
        assert.equal(latest.lighting.local_lights[20].azimuth,-12.345);assert.deepEqual(latest.lighting.dark_tiles,[{x:1,z:1}]);
        await page.call('Page.navigate',{url:'about:blank'});await page.until("location.href==='about:blank'",'blank reload');
        await page.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});
        await page.until('Boolean(window.enterLocation&&window.isGM)','reloaded');await mount(page);await healthy(page,21);
        const world=await request(api,{name:'Legacy world lighting',world_tile_x:11,world_tile_z:10,grid_width:8,grid_height:8,
            tiles_data:Array.from({length:8},()=>Array.from({length:8},()=>({terrain:'grass',height:0,objects:[]})))},token);
        await page.evaluate('exitLocation();true');await mount(page,world.id);
        const empty=await page.evaluate('L.getLocationStaticLightFieldDiagnostics()');
        assert.equal(empty.enabled,true);assert.equal(empty.lampRoutes.length,0);assert.ok(empty.materialCount>0);
        await page.evaluate('exitLocation();true');await mount(page);await healthy(page,21);
        await pause(300);
        const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
        const screenshot=async(client,label)=>fs.writeFileSync(path.join(os.tmpdir(),'vtt-light-cleanup-'+label+'.png'),
            Buffer.from((await client.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        await screenshot(page,'night-after');
        if(process.env.VTT_LIGHT_BASELINE_DIR){
            const pose=await page.evaluate('({p:localRender.camera.position.toArray(),q:localRender.camera.quaternion.toArray(),projection:localRender.camera.projectionMatrix.toArray()})');
            const pixels=client=>client.evaluate(`(()=>{const {renderer:r,scene:s,camera:original}=localRender,c=original.clone(),old=r.getRenderTarget(),target=new T.WebGLRenderTarget(320,200);
                const pose=${JSON.stringify(pose)};c.position.fromArray(pose.p);c.quaternion.fromArray(pose.q);c.projectionMatrix.fromArray(pose.projection);c.projectionMatrixInverse.copy(c.projectionMatrix).invert();c.updateMatrixWorld(true);
                try{r.setRenderTarget(target);r.render(s,c);const bytes=new Uint8Array(320*200*4);r.readRenderTargetPixels(target,0,0,320,200,bytes);return Array.from(bytes)}finally{r.setRenderTarget(old);target.dispose()}})()`);
            const after=await pixels(page),target=await page.call('Target.createTarget',{url:'about:blank'});
            const targets=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
            const before=await connect(targets.find(p=>p.id===target.targetId).webSocketDebuggerUrl);
            try{
                process.env.VTT_WATER_BASELINE_DIR=process.env.VTT_LIGHT_BASELINE_DIR;
                await before.call('Page.enable');await before.call('Runtime.enable');
                await before.call('Emulation.setDeviceMetricsOverride',await page.evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio,mobile:false})'));
                await before.call('Fetch.enable',{patterns:[{urlPattern:'*/static/js/*.js',requestStage:'Request'}]});
                await before.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});
                await before.until('Boolean(window.enterLocation&&window.isGM)','baseline startup');await mount(before);
                await before.until('L.getLocationStaticLightFieldDiagnostics().enabled','baseline field enabled');
                assert.equal(await before.evaluate('typeof L.setLocationStaticLightFieldEnabled'),'function','comparison uses the original switchable renderer');
                await pause(300);const expected=await pixels(before);await screenshot(before,'night-before');
                let total=0,bad=0,max=0;
                for(let i=0;i<after.length;i++){const d=Math.abs(after[i]-expected[i]);total+=d;max=Math.max(max,d);if(d>4)bad++}
                const result={meanDifference:total/after.length,badChannelShare:bad/after.length,max};
                console.log('NIGHT BEFORE/AFTER GPU',result);
                assert.ok(result.badChannelShare<.01&&result.meanDifference<.5,'local light appearance changed');
            }finally{before.close();await page.call('Target.closeTarget',{targetId:target.targetId});await page.call('Page.bringToFront');}
        }
        console.log('PASS LIGHT CLEANUP: no toggle/API, legacy manual/world saves, point/spot/fire/electric light, darkness, roofs/floors, edits, peer, reload and scene transitions');
    }finally{peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId});}
};
