const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async ({page, request, token, lobby, base}) => {
    const api = `/lobbies/${lobby.id}`;
    await request('/auth/register', {username:'layout-player',email:'layout@example.test',password:'layout-password'});
    const player = await request('/auth/login', {username:'layout-player',password:'layout-password'});
    await request(api+'/join', {}, player.access_token);
    const actor = await request(api+'/characters', {name:'Layout player',data:{}}, player.access_token);
    const other = await request(api+'/characters', {name:'Layout observer',data:{}}, token);
    await request(`/lobbies/characters/${other.id}`, {visible_to:[player.user_id],editable_to:[]},token,'PUT');
    const loc = await request(api+'/locations', {name:'UI layout',world_tile_x:8,world_tile_z:8,grid_width:16,grid_height:16,
        tiles_data:Array.from({length:16},()=>Array.from({length:16},()=>({terrain:'concrete',height:1,objects:[]})))},token);
    const url = api+'/locations/'+loc.id;
    for (const [ch,x] of [[actor,8],[other,10]]) await request(url+'/spawn_character', {character_id:ch.id,tile_x:x,tile_y:x,assign_to_user_id:ch.id===actor.id?player.user_id:1},token);
    const rect = id => page.evaluate(`(()=>{const e=document.getElementById('${id}'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,visible:!!e.getClientRects().length}})()`);
    const overlaps = (a,b) => a.x < b.right-1 && a.right > b.x+1 && a.y < b.bottom-1 && a.bottom > b.y+1;
    const dragCharacters = async () => {
        const before = await rect('panel-characters');
        const dx = before.x >= 100 ? -80 : 80;
        const dy = before.bottom + 30 <= await page.evaluate('innerHeight') ? 30 : -30;
        const start = await page.evaluate(`(()=>{const panel=document.getElementById('panel-characters'),r=panel.getBoundingClientRect();return [.8,.2,.5].map(f=>({x:r.left+r.width*f,y:r.top+18})).find(p=>document.elementFromPoint(p.x,p.y)?.closest('.panel-header')?.parentElement===panel)})()`);
        assert.ok(start,'character header remains reachable');
        for(const [type,x,y,buttons] of [['mousePressed',0,0,1],['mouseMoved',dx,dy,1],['mouseReleased',dx,dy,0]])
            await page.call('Input.dispatchMouseEvent',{type,x:start.x+x,y:start.y+y,button:'left',buttons,clickCount:1});
        const after = await rect('panel-characters');
        console.log('CHARACTER_PANEL_DRAG '+JSON.stringify({before,after}));
        assert.ok(Math.abs(after.x-(before.x+dx))<2,'characters follow horizontal drag while chat is open');
        assert.ok(Math.abs(after.y-(before.y+dy))<2,'characters follow vertical drag while chat is open');
        return after;
    };
    const screenshot = async label => fs.writeFileSync(path.join(os.tmpdir(),'vtt-ui-layout-'+label+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const menu = async (x = 8.5, z = 8.5) => {
        await page.evaluate('document.body.click()');
        await page.evaluate(`(()=>{locationControls.object.updateMatrixWorld(true);const p=new T.Vector3(${x},1.8,${z}).project(locationControls.object),c=document.querySelector('#location-canvas canvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('secondaryclick',{bubbles:true,clientX:r.left+(p.x+1)*r.width/2,clientY:r.top+(1-p.y)*r.height/2}))})()`);
        await page.until(`document.getElementById('combat-action-menu')?.style.display==='block'`, 'radial menu');
        const result = await page.evaluate(`(()=>{const m=document.getElementById('combat-action-menu');return [...m.querySelectorAll('button')].map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),disabled:e.disabled||e.getAttribute('aria-disabled')==='true',cost:e.dataset.cost,reason:e.dataset.unavailableReason,text:e.innerText,x:r.x,y:r.y,right:r.right,bottom:r.bottom}})})()`);
        for(let i=0;i<result.length;i++) {
            assert.ok(result[i].x>=0 && result[i].y>=0 && result[i].right<=await page.evaluate('innerWidth') && result[i].bottom<=await page.evaluate('innerHeight'), 'menu outside viewport');
            for(let j=i+1;j<result.length;j++) assert.ok(!overlaps(result[i],result[j]), `overlap: ${result[i].label}/${result[j].label}`);
        }
        return result;
    };
    const metrics=[];
    for(const role of ['gm','player']) {
        const loginToken=role==='gm'?token:player.access_token;
        await page.call('Page.navigate',{url:base});
        await page.until(`location.pathname==='/'`, 'home');
        await page.evaluate(`localStorage.setItem('access_token',${JSON.stringify(loginToken)});localStorage.setItem('user_id',${JSON.stringify(String(role==='gm'?1:player.user_id))});localStorage.removeItem('combatHudCollapsed')`);
        await page.call('Page.navigate',{url:base+api+'/page'});
        await page.until(`typeof enterLocation==='function'&&window.isGM===${role==='gm'}`, 'role ready');
        await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.T=await import('three');window.UI=await import('/static/js/ui_interactions.js');await enterLocation(${loc.id})})()`);
        await page.until(`window.locationControls&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'location ready');
        await page.evaluate(`L.setLocationEditMode(false);UI.expandMapToolsPanel()`);
        for(const [width,height] of [[1366,768],[1920,1080]]) {
            await page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
            await pause(350);
            for(const id of ['chat-toggle','common-tools-toggle']) assert.equal((await rect(id)).visible,true,id+' visible');
            if(role==='gm') {const r=await rect('panel-tools');assert.ok(r.width<=252&&r.height<140, JSON.stringify(r));}
            await page.evaluate(`if(document.getElementById('panel-chat').hidden)document.getElementById('chat-toggle').click();if(document.getElementById('panel-chat').dataset.chatDocked!=='true')document.getElementById('chat-pin').click()`);
            await pause(350);
            assert.ok(!overlaps(await rect('panel-chat'),await rect('panel-characters')),'docked chat/characters');
            await dragCharacters();
            await screenshot(`${role}-${width}-docked-panels`);
            await page.evaluate(`document.querySelector('#panel-chat .toggle-btn').click()`);
            await pause(350);
            assert.ok(!overlaps(await rect('panel-chat'),await rect('panel-characters')),'collapsed chat/characters');
            await dragCharacters();
            await page.evaluate(`document.querySelector('#panel-chat .toggle-btn').click();document.getElementById('chat-pin').click()`);
            await dragCharacters();
            await page.evaluate(`document.querySelector('#panel-chat .toggle-btn').click()`);
            const manuallyPlaced = await dragCharacters();
            await page.evaluate(`document.getElementById('chat-close').click()`);
            await pause(100);
            assert.equal((await rect('panel-characters')).x,manuallyPlaced.x,'closing chat preserves manual position');
            await dragCharacters();
            const preferred = await rect('panel-characters');
            await page.evaluate(`document.getElementById('chat-toggle').click();document.getElementById('chat-pin').click()`);
            await pause(100);
            assert.equal((await rect('panel-characters')).x,preferred.x,'opening docked chat preserves a non-overlapping manual position');
            // Return the chat to its expanded state before the existing checks.
            await page.evaluate(`document.querySelector('#panel-chat .toggle-btn').click()`);
            await page.evaluate(`document.querySelector('#panel-chat .toggle-btn').click();document.getElementById('chat-close').click();if(document.getElementById('panel-common-tools').hidden)document.getElementById('common-tools-toggle').click();document.querySelector('[data-common-map-tool="dice"]').click()`);
            assert.equal(await page.evaluate(`document.getElementById('common-dice-form').hidden`),false);
            await page.evaluate(`document.querySelector('[data-dice-sides="6"]').click()`);
            await page.until(`!document.getElementById('panel-chat').hidden`, 'dice open chat');
            await page.evaluate(`document.getElementById('chat-close').click();document.getElementById('common-tools-toggle').click()`);
            const outside = await menu();
            if(role==='gm')assert.ok(outside.find(e=>e.label==='Начать бой'&&!e.disabled));
            assert.ok(!outside.some(e=>['Другое','Ближний бой','Помощь','Получить ОП'].includes(e.label)), 'combat-only actions omitted');
            await screenshot(`${role}-${width}-idle-menu`);
            await page.evaluate(`document.body.click()`);
            const state = await request(url+'/combat',null,token,'GET');
            await request(url+'/combat/start',{location_character_ids:state.characters.map(c=>c.location_character_id),initiator_location_character_id:state.characters.find(c=>c.character_id===actor.id).location_character_id,initiator_first:true},token);
            await page.until(`L.getCombatState()?.status==='active'`, 'combat started');
            await page.evaluate(`(()=>{const c=document.querySelector('.combat-hud-collapse-btn');if(c.getAttribute('aria-expanded')==='false')c.click()})()`);
            await pause(350);
            assert.ok(!overlaps(await rect('combat-status-panel'),await rect('panel-participants')),'HUD/participants');
            const active = await menu();
            assert.ok(active.find(e=>e.label==='Другое'&&!e.disabled));
            assert.ok(active.find(e=>e.label==='Ближний бой'&&!e.disabled));
            assert.ok(active.find(e=>e.label==='Медицина').text.includes('Медицина'));
            assert.ok(active.find(e=>e.label==='Помощь').text.includes('Помощь'));
            assert.equal(active.find(e=>e.label==='Получить ОП').cost,'1 СД');
            await screenshot(`${role}-${width}-combat-menu`);
            // Compare displayed conversion prices to actual server resource deductions.
            for(const price of ['1 СД','2 ОД','2 ОД']) {
                const before=await page.evaluate('structuredClone(L.getCombatState().current_character)');
                const opened=await menu();
                assert.equal(opened.find(e=>e.label==='Получить ОП').cost,price);
                await page.evaluate(`document.querySelector('#combat-action-menu [aria-label="Получить ОП"]').click()`);
                const field=price==='1 СД'?'free_actions_current':'action_points_current',amount=price==='1 СД'?1:2;
                await page.until(`L.getCombatState().current_character.${field}===${before[field]-amount}`, 'displayed price charged');
                const after=await page.evaluate('L.getCombatState().current_character');
                assert.equal(after[price==='1 СД'?'action_points_current':'free_actions_current'],before[price==='1 СД'?'action_points_current':'free_actions_current']);
            }
            const poor=await menu();
            assert.ok(poor.find(e=>e.label==='Получить ОП'&&e.disabled&&e.reason.includes('Недостаточно ресурсов')));
            assert.ok(poor.find(e=>e.label==='Утешить'&&e.disabled&&e.cost==='3 ОД'));
            await page.evaluate(`document.querySelector('#combat-action-menu [aria-label="Получить ОП"]').focus();document.querySelector('#combat-action-menu [aria-label="Получить ОП"]').click()`);
            assert.equal(await page.evaluate(`document.getElementById('combat-menu-tooltip').hidden`),false);
            const unpaid=await request(url+'/combat',null,token,'GET');
            assert.equal(unpaid.current_character.action_points_current,1,'disabled click spends no OD');
            assert.equal(unpaid.current_character.free_actions_current,0,'disabled click spends no SD');
            await screenshot(`${role}-${width}-unavailable`);
            await page.evaluate(`(()=>{window.layoutPoorSnapshot=structuredClone(L.getCombatState());const s=structuredClone(layoutPoorSnapshot);s.characters.find(c=>c.character_id===${actor.id}).action_points_current=2;s.current_character.action_points_current=2;L.setCombatState(s)})()`);
            assert.equal(await page.evaluate(`document.querySelector('#combat-action-menu [aria-label="Получить ОП"]').getAttribute('aria-disabled')`),'false','open menu refreshes after resource update');
            await page.evaluate('L.setCombatState(layoutPoorSnapshot)');
            assert.equal(await page.evaluate(`document.querySelector('#combat-action-menu [aria-label="Получить ОП"]').getAttribute('aria-disabled')`),'true');
            // Exercise UI-only state variants without changing health or resources on the server.
            await page.evaluate('window.layoutCombatSnapshot=structuredClone(L.getCombatState())');
            for (const condition of ['pain_shock','critical','dead']) {
                // A blocked current GM turn would automatically advance on the real server.
                await page.evaluate(`(()=>{const s=structuredClone(layoutCombatSnapshot),a=s.characters.find(c=>c.character_id===${actor.id});a.condition={state:'${condition}',label:'${condition}',can_recover:true};s.current_character='${condition}'==='pain_shock'?a:s.characters.find(c=>c.character_id===${other.id});L.setCombatState(s)})()`);
                await menu();
            }
            await page.evaluate(`(()=>{const s=structuredClone(layoutCombatSnapshot);s.current_character=s.characters.find(c=>c.character_id===${other.id});L.setCombatState(s)})()`);
            const offTurn=await menu();
            assert.ok(offTurn.find(e=>e.label==='Другое'&&e.disabled),'off-turn action disabled');
            await page.evaluate('L.setCombatState(structuredClone(layoutCombatSnapshot))');
            if(role==='player') {
                const unowned=await menu(10.5,10.5);
                assert.ok(unowned.find(e=>e.label==='Движение'&&e.disabled),'uncontrolled character action disabled: '+JSON.stringify(unowned));
            }
            await page.evaluate(`document.body.click();document.querySelector('.combat-hud-collapse-btn').click()`);
            assert.ok((await rect('combat-status-panel')).height<90,'compact HUD');
            const before=await rect('combat-status-panel');
            for(const [type,x,y,buttons] of [['mousePressed',before.x+45,before.y+15,1],['mouseMoved',before.x+65,before.y+25,1],['mouseReleased',before.x+65,before.y+25,0]])
                await page.call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
            assert.ok((await rect('combat-status-panel')).x>before.x+10,'HUD remains draggable');
            // Return it to its previous place before the next viewport/role.
            for(const [type,x,y,buttons] of [['mousePressed',before.x+65,before.y+25,1],['mouseMoved',before.x+45,before.y+15,1],['mouseReleased',before.x+45,before.y+15,0]])
                await page.call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
            await request(url+'/combat/end',{},token);
            await page.until(`L.getCombatState()?.status!=='active'`, 'combat ended');
            metrics.push({role,width,outside:outside.length,active:active.length});
            if(role==='gm') {
                await page.evaluate(`L.setLocationEditMode(true);UI.expandMapToolsPanel();selectLocationEditorTool('building')`);
                await pause(350);
                assert.ok((await rect('panel-tools')).width>700,'editor restored');
                await page.evaluate(`L.setLocationEditMode(false)`);
            }
        }
        await page.evaluate(`if(!document.getElementById('panel-chat').hidden)document.getElementById('chat-close').click()`);
        const edge = await rect('panel-characters');
        const viewport = await page.evaluate('({width:innerWidth,height:innerHeight})');
        for(const [type,x,y,buttons] of [['mousePressed',edge.x+70,edge.y+18,1],
            ['mouseMoved',viewport.width-1,viewport.height-1,1],['mouseReleased',viewport.width-1,viewport.height-1,0]])
            await page.call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
        const bounded = await rect('panel-characters');
        assert.ok(bounded.x>=0&&bounded.y>=0&&bounded.right<=viewport.width&&bounded.bottom<=viewport.height,'drag remains within viewport: '+JSON.stringify(bounded));
        await page.call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
        await pause(150);
        const recovered = await rect('panel-characters');
        assert.ok(recovered.x>=0&&recovered.y>=0&&recovered.right<=1366&&recovered.bottom<=768,'resize recovers visible position');
        const preferred = await dragCharacters();
        const saved = await page.evaluate(`JSON.parse(localStorage.getItem('panelStates'))['panel-characters'].position`);
        assert.equal(saved.left,preferred.x);assert.equal(saved.top,preferred.y);
        await page.call('Page.navigate',{url:base+api+'/page'});
        await page.until(`typeof enterLocation==='function'&&window.isGM===${role==='gm'}`,'reload role ready');
        await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');await enterLocation(${loc.id})})()`);
        await page.until(`window.locationControls&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'reload location');
        const restored = await rect('panel-characters');
        assert.ok(Math.abs(restored.x-saved.left)<2&&Math.abs(restored.y-saved.top)<2,'reload restores manual position');
        console.log('CHARACTER_PANEL_STATE '+JSON.stringify({role,bounded,recovered,saved,restored}));
    }
    console.log('UI_LAYOUT '+JSON.stringify(metrics));
};
