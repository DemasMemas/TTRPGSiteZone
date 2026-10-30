const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({page, request, token, lobby, base, connect, debugPort}) => {
    const baseline = process.env.VTT_UI_BASELINE === '1';
    const api = `/lobbies/${lobby.id}`;
    await request('/auth/register',{username:'regression-player',email:'regression@example.test',password:'regression-password'});
    const player=await request('/auth/login',{username:'regression-player',password:'regression-password'});
    await request(api+'/join',{},player.access_token);
    const actor = await request(api+'/characters', {name:'Regression actor',data:{}},player.access_token);
    const loc = await request(api+'/locations', {name:'UI regression',world_tile_x:8,world_tile_z:8,
        grid_width:32,grid_height:32,tiles_data:Array.from({length:32},()=>Array.from({length:32},()=>({terrain:'concrete',height:1,objects:[]})))},token);
    const url=api+'/locations/'+loc.id;
    await request(url+'/spawn_character',{character_id:actor.id,tile_x:16,tile_y:16,assign_to_user_id:player.user_id},token);
    await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.T=await import('three');await enterLocation(${loc.id})})()`);
    await page.until(`window.locationControls&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'location ready');
    await page.evaluate('L.setLocationEditMode(false)');
    await page.evaluate(`window.uiUnhandled=[];window.addEventListener('unhandledrejection',e=>uiUnhandled.push(String(e.reason)))`);
    const point = (x,z) => page.evaluate(`(()=>{locationControls.object.updateMatrixWorld(true);const p=new T.Vector3(${x},1.1,${z}).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const p=await point(16.5,16.5), target=await point(19.5,16.5);
    const menu=()=>page.evaluate(`L.showCombatActionMenu(${p.x},${p.y},${actor.id})`);
    const results={exported:await page.evaluate(`typeof L.applyCharacterFacingVisual==='function'`)};
    await menu();
    results.doubleTooltip=await page.evaluate(`!!document.querySelector('#combat-action-menu button[title][aria-describedby]')`);
    results.contextPrevented=await page.evaluate(`(()=>{const c=document.querySelector('#location-canvas canvas'),e=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:${p.x},clientY:${p.y}});c.dispatchEvent(e);return e.defaultPrevented})()`);
    // Time synchronous work in the same scene, camera, and pointer positions.
    results.startMs=await page.evaluate(`(()=>{const t=performance.now();L.showFacingMenu(${actor.id});return performance.now()-t})()`);
    results.previewMs=await page.evaluate(`(()=>{const samples=[];for(let i=0;i<8;i++){const t=performance.now();L.updateFacingPreview(${target.x},${target.y});samples.push(performance.now()-t)}return samples})()`);
    if(!baseline) await page.until('L.previewComplete()','facing cells ready');
    results.highlightedCells=await page.evaluate(`L.facingPreviewCount()`);
    await page.evaluate('L.closeFacingMenu()');
    // A floor on level 1 makes navigation authoritative even for a ground route.
    await request(url+'/objects',{name:'Upper floor',type:'floor',tile_x:4,tile_y:4,properties:{level:1,dimensions:{width:3,depth:3,height:.12}}},token);
    await page.until(`L.hasStoreyNavigation()`,'navigation object synchronized');
    const route=await request(url+'/movement-preview',{character_id:actor.id,x:19,y:16,floor_level:0},token);
    results.serverRoute=!!route.route;
    results.pendingRoute=await page.evaluate(`L.findMovementPath(16,16,19,16,${actor.id},0)`);
    await page.until(`L.navigationPreviewSettled(16,16,19,16,${actor.id},0)`,'preview response');
    results.loadedRoute=!!await page.evaluate(`L.findMovementPath(16,16,19,16,${actor.id},0)`);
    const combat=await request(url+'/combat',null,token,'GET');
    await request(url+'/combat/start',{location_character_ids:combat.characters.map(c=>c.location_character_id),initiator_location_character_id:combat.characters[0].location_character_id,initiator_first:true},token);
    await page.until(`L.getCombatState()?.status==='active'`,'combat');
    results.syncMs=await page.evaluate(`(()=>{const s=structuredClone(L.getCombatState()),t=performance.now();L.setCombatState(s);return performance.now()-t})()`);
    await menu();
    results.mustLabel=await page.evaluate(`document.querySelector('#combat-action-menu [aria-label^="Должен"]')?.getAttribute('aria-label')`);
    // The weapon index is valid: expose the existing action without executing it.
    await page.evaluate(`(()=>{const s=structuredClone(L.getCombatState());s.characters[0].drawn_weapon_index=0;s.current_character.drawn_weapon_index=0;L.setCombatState(s)})()`);
    await menu();
    results.gunpointLabel=await page.evaluate(`document.querySelector('#combat-action-menu [aria-label="Приставить ствол"]')?.getAttribute('aria-label')||null`);
    console.log('UI_REGRESSION '+JSON.stringify(results));
    const out=path.resolve('tmp/ui-regression');fs.mkdirSync(out,{recursive:true});
    fs.writeFileSync(path.join(out,baseline?'before.json':'after.json'),JSON.stringify(results,null,2));
    fs.writeFileSync(path.join(out,baseline?'before.png':'after.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    if(!baseline){
        assert.equal(results.exported,true);assert.equal(results.doubleTooltip,false);assert.equal(results.contextPrevented,true);
        assert.equal(results.serverRoute,true);assert.equal(results.loadedRoute,true);
        assert.ok(results.highlightedCells>0);assert.match(results.mustLabel,/Должен это сделать/);assert.equal(results.gunpointLabel,'Приставить ствол');
        const authoritative=await request(url+'/combat',null,token,'GET');
        await page.evaluate(`L.setCombatState(${JSON.stringify(authoritative)});L.showFacingMenu(${actor.id});L.resolveFacingCell(${target.x},${target.y})`);
        await page.until(`[...document.querySelectorAll('button')].some(b=>b.textContent==='1 СД'&&b.getClientRects().length)`,'turn payment');
        await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='1 СД'&&b.getClientRects().length).click()`);
        await page.until(`L.getCombatState().current_character.facing_x>0&&L.getCombatState().current_character.free_actions_current===0`,'combat turn confirmed');
        assert.equal(await page.evaluate(`L.getCombatState().current_character.action_points_current`),authoritative.current_character.action_points_current);
        await request(url+'/combat/end',{},token);
        await page.until(`L.getCombatState()?.status!=='active'`,'combat ended');
        console.log('UI_REGRESSION connecting player');
        const info=await(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
        const protocol=await connect(info.webSocketDebuggerUrl);
        const isolation=await protocol.call('Target.createBrowserContext');
        const tab=await protocol.call('Target.createTarget',{url:base,browserContextId:isolation.browserContextId});
        const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        const peer=await connect(tabs.find(t=>t.id===tab.targetId).webSocketDebuggerUrl);
        try {
            console.log('UI_REGRESSION player tab connected');
            await peer.call('Page.enable');await peer.call('Runtime.enable');
            await peer.call('Fetch.enable',{patterns:[{urlPattern:'*/static/js/*',requestStage:'Request'}]});
            await peer.evaluate(`localStorage.setItem('access_token',${JSON.stringify(player.access_token)});localStorage.setItem('user_id',${JSON.stringify(String(player.user_id))})`);
            await peer.call('Page.navigate',{url:base+api+'/page'});
            await peer.until(`typeof enterLocation==='function'&&!window.isGM`,'player ready');
            await peer.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.T=await import('three');await enterLocation(${loc.id})})()`);
            await peer.until(`window.locationControls&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'player location');
            console.log('UI_REGRESSION player location loaded');
            for(const client of [page,peer]) {
                await client.call('Page.bringToFront');
                const position=await client.evaluate(`(()=>{locationControls.object.updateMatrixWorld(true);const p=new T.Vector3(16.5,1.8,16.5).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
                for(const type of ['mousePressed','mouseReleased'])await client.call('Input.dispatchMouseEvent',{type,...position,button:'right',buttons:type==='mousePressed'?2:0,clickCount:1});
                await client.until(`document.getElementById('combat-action-menu')?.style.display==='block'`,'real right click');
                assert.equal(await client.evaluate(`document.querySelector('#combat-action-menu [aria-label="Разворот"]').getAttribute('aria-disabled')`),'false');
                await client.evaluate(`document.querySelector('#combat-action-menu [aria-label="Разворот"]').click()`);
                // Use the actual selection handler and persist the direction.
                const turnTarget=await client.evaluate(`(()=>{const p=new T.Vector3(${client===page?19.5:13.5},1,16.5).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
                await client.evaluate(`L.resolveFacingCell(${turnTarget.x},${turnTarget.y})`);
                const sign=client===page?1:-1;
                await page.until(`Math.sign(L.characterPose(${actor.id}).fx)===${sign}`,'GM facing sync');
                await peer.until(`Math.sign(L.characterPose(${actor.id}).fx)===${sign}`,'player facing sync');
                console.log('UI_REGRESSION facing synchronized');
            }
            await peer.evaluate(`L.beginCharacterMoveMode(${actor.id})`);
            const moveTarget=await peer.evaluate(`(()=>{locationControls.object.updateMatrixWorld(true);const p=new T.Vector3(19.5,1,16.5).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
            // Hold the route response: waiting must not be reported as collision.
            await peer.evaluate(`(()=>{const original=fetch;window.restorePreviewFetch=()=>window.fetch=original;window.fetch=async(...args)=>{const preview=String(args[0]).includes('/movement-preview');if(preview){window.previewPayload=JSON.parse(args[1].body);await new Promise(r=>window.releasePreview=r)}const response=await original(...args);if(preview)window.previewResponse=await response.clone().json();return response};L.updateMovementPreview(${moveTarget.x},${moveTarget.y})})()`);
            await peer.until(`!!window.releasePreview`,'preview held');
            console.log('UI_REGRESSION preview held '+JSON.stringify(await peer.evaluate('previewPayload')));
            assert.match(await peer.evaluate(`document.body.innerText`),/Расчёт маршрута/);
            assert.deepEqual(await peer.evaluate(`({x:previewPayload.x,y:previewPayload.y})`),{x:19,y:16});
            await peer.evaluate('releasePreview();restorePreviewFetch()');
            await peer.until(`window.previewResponse!==undefined`,'preview response received');
            console.log('UI_REGRESSION preview response '+JSON.stringify(await peer.evaluate('previewResponse')));
            await peer.until(`L.navigationPreviewSettled(16,16,19,16,${actor.id},0)`,'preview ready');
            assert.equal(await peer.evaluate('L.movementHintText()'),'Движение: 3 м');
            await peer.evaluate(`L.commitMovementPreview(${moveTarget.x},${moveTarget.y})`);
            await page.until(`L.characterPose(${actor.id}).x===19`,'GM movement sync');
            await peer.until(`L.characterPose(${actor.id}).x===19`,'player movement sync');
            const saved=await request(url+'/combat',null,token,'GET');
            assert.equal(saved.characters.find(c=>c.character_id===actor.id).x,19);
            assert.deepEqual(await page.evaluate('uiUnhandled'),[]);
            console.log('UI_REGRESSION_TWO_CLIENTS turn, native right click, waiting preview, movement, persistence: passed');
        } finally {peer.close();await protocol.call('Target.disposeBrowserContext',{browserContextId:isolation.browserContextId});protocol.close();}
    }
};
