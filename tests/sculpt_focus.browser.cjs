// VTT_SCULPT_FOCUS=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby})=>{
    await page.evaluate(`(async()=>{window.E=await import('/static/js/mapEdit.js');window.L=await import('/static/js/locationScene.js');
        if(document.getElementById('gm-only-controls').style.display==='none')toggleEditMode()})()`);
    const key=async(code,key=code.slice(3).toLowerCase())=>{
        for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key});
    };
    for(const local of [false,true]){
        if(local){
            const loc=await request(`/lobbies/${lobby.id}/locations`,{name:'Sculpt focus',world_tile_x:8,world_tile_z:8,grid_width:16,grid_height:16,
                tiles_data:Array.from({length:16},()=>Array.from({length:16},()=>({terrain:'bare_dirt',height:1,objects:[]})))},token);
            await page.evaluate(`enterLocation(${loc.id})`);await page.until('window.isLocationActive&&window.locationControls','location ready');
            await page.evaluate('L.setLocationEditMode(true)');
        }
        const setup=()=>page.evaluate(local?"selectLocationEditorTool('height')":"E.selectWorldEditorTool('sculpt')");
        const mode=local?'loc-height-mode':'world-sculpt-mode',prefix=local?'loc':'world';
        const controls=local?'locationControls':'sceneModule.controls';
        const target=()=>page.evaluate(`${controls}.target.toArray()`);
        const walk=async expected=>{
            await page.evaluate(`${controls}.target.set(${local?8:32},1,16);${controls}.object.position.set(${local?8:32},20,35);${controls}.update()`);
            const before=await target();await page.call('Input.dispatchKeyEvent',{type:'keyDown',code:'KeyW',key:'w'});await pause(160);
            await page.call('Input.dispatchKeyEvent',{type:'keyUp',code:'KeyW',key:'w'});
            const after=await target();assert.equal(after.some((n,i)=>Math.abs(n-before[i])>.001),expected,'WASD movement');
        };
        const hotkey=async()=>{
            await key('KeyR');assert.equal(await page.evaluate(local?"window.locationEditorTool==='erase'":"document.getElementById('eraser-checkbox').checked"),true,'eraser shortcut');
            await key('KeyR');
        };
        await setup();await page.evaluate(`(()=>{const e=document.getElementById('${mode}');e.focus();e.value='smooth';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        assert.notEqual(await page.evaluate('document.activeElement.id'),mode);await walk(true);await hotkey();
        for(const name of ['strength','softness']){
            await setup();const id=`${prefix}-sculpt-${name}`;
            await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.focus();e.select()})()`);
            await page.call('Input.insertText',{text:'.625'});await walk(false);
            await key('Enter','Enter');await page.until(`document.activeElement.id!=='${id}'`,'number releases focus');
            assert.equal(await page.evaluate(`document.getElementById('${id}').value`),'0.625');await walk(true);await hotkey();
        }
        // Native spinner/change commits also release focus; invalid drafts keep it.
        await setup();const id=`${prefix}-sculpt-softness`;
        await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.focus();e.value='.75';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await page.until(`document.activeElement.id!=='${id}'`,'change releases focus');await walk(true);
        await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.focus();e.value='9';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        await key('Enter','Enter');assert.equal(await page.evaluate('document.activeElement.id'),id);await walk(false);
        // Clicking the real canvas commits a valid draft before starting a stroke.
        await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.focus();e.value='.875';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
        const p=await page.evaluate(`(()=>{const r=document.querySelector('${local?'#location-canvas canvas':'#canvas-container canvas'}').getBoundingClientRect();return{x:r.left+r.width*.45,y:r.top+r.height*.3}})()`);
        assert.equal(await page.evaluate(`document.elementFromPoint(${p.x},${p.y}).tagName`),'CANVAS','pointer is outside floating panels');
        for(const type of ['mouseMoved','mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:1});
        await page.until(`document.activeElement.id!=='${id}'`,'canvas releases focus');await walk(true);
        if(local)assert.equal(await page.evaluate('L.getLocationSculptSettings().softness'),.875);
        console.log(`SCULPT FOCUS PASS: ${local?'location':'world'} mode, strength, softness, Enter/change/canvas, WASD, shortcuts and draft protection`);
    }
};
