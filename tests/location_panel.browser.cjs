// Uses the existing harness's temporary DB; creates no reports or screenshots on disk.
const assert = require('node:assert/strict');
module.exports = async ({ page, request, token, lobby, base }) => {
    const baseline = process.env.VTT_LOC_PANEL_BASELINE === '1';
    const loc = await request(`/lobbies/${lobby.id}/locations`, {
        name: 'Location panel layout', world_tile_x: 10, world_tile_z: 10,
        grid_width: 16, grid_height: 16,
        tiles_data: Array.from({length:16},()=>Array.from({length:16},()=>({terrain:'concrete',height:1,objects:[]}))),
        lighting: { mode: 'manual', ambient_intensity: 0.55 },
    }, token);
    await page.evaluate(`void enterLocation(${loc.id})`);
    await page.until(`window.selectLocationEditorTool&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'local panel ready');
    await page.evaluate(`(async()=>{window.UI=await import('/static/js/ui_interactions.js');
        window.L=await import('/static/js/locationScene.js');L.setLocationEditMode(true);UI.expandMapToolsPanel()})()`);
    const metrics = {};
    for (const [width,height] of [[1366,768],[900,700],[640,720]]) {
        await page.call('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
        await new Promise(resolve => setTimeout(resolve, 400));
        metrics[width] = {};
        for (const tool of ['select','terrain','height','radiation','erase','assets','building','light']) {
            await page.evaluate(`selectLocationEditorTool('${tool}');UI.expandMapToolsPanel()`);
            const measure = await page.evaluate(`(()=>{
                const p=document.querySelector('#panel-tools'),c=p.querySelector('.panel-content'),r=p.getBoundingClientRect();
                return {height:p.offsetHeight,view:c.clientHeight,scroll:c.scrollHeight,width:c.clientWidth,contentWidth:c.scrollWidth,
                    left:r.left,right:r.right,mode:document.querySelectorAll('#loc-edit-toggle-checkbox').length,
                    shortcuts:[...c.querySelectorAll('.map-editor-shortcuts')].filter(e=>e.getClientRects().length).length,
                    help:c.querySelector('.location-editor-help')?.open??null,
                    radiusGap:(()=>{
                        const next=[...c.querySelectorAll('.location-tool-settings > .map-editor-section')]
                            .filter(e=>e.getClientRects().length)[1];
                        const radius=c.querySelector('#loc-edit-radius-number');
                        return next&&radius.getClientRects().length
                            ? next.getBoundingClientRect().left-radius.getBoundingClientRect().right : null;
                    })(),
                    outside:[...c.querySelectorAll('input,select,button')].filter(e=>e.getClientRects().length).filter(e=>{
                        const x=e.getBoundingClientRect();return x.left<r.left-1||x.right>r.right+1}).map(e=>e.id||e.textContent.slice(0,30))};
            })()`);
            metrics[width][tool] = measure;
            if (!baseline) {
                assert.equal(measure.mode, 1);
                assert.equal(measure.shortcuts, 0);
                assert.equal(measure.help, false);
                if (['height','radiation'].includes(tool)) assert.ok(measure.radiusGap >= 15 && measure.radiusGap <= 17, `${width}/${tool}: unused space after radius (${measure.radiusGap})`);
                assert.ok(measure.contentWidth <= measure.width + 1, `${width}/${tool}: horizontal overflow`);
                assert.deepEqual(measure.outside, [], `${width}/${tool}: clipped controls`);
                assert.ok(measure.left >= 0 && measure.right <= width, `${width}/${tool}: outside viewport`);
                if (['height','radiation','erase'].includes(tool)) assert.ok(measure.height < 310, `${width}/${tool}: tall simple panel`);
            }
            if (process.env.VTT_LOC_PANEL_SHOTS === '1' && ((width === 1366 && tool === 'height') || (width !== 1366 && tool === 'light'))) {
                const shot = await page.call('Page.captureScreenshot', {format:'jpeg',quality:55});
                console.log('SCREEN '+JSON.stringify({label:`${width}x${height} ${tool}`,data:shot.data}));
            }
        }
    }
    console.log('PANEL_METRICS '+JSON.stringify(metrics));
    if (baseline) return;
    await page.evaluate("document.querySelector('.location-editor-help summary').focus()");
    for (const type of ['keyDown','keyUp']) await page.call('Input.dispatchKeyEvent', {type,code:'Enter',key:'Enter',windowsVirtualKeyCode:13});
    await page.until("document.querySelector('.location-editor-help').open", 'keyboard help disclosure');
    assert.equal(await page.evaluate("document.querySelector('.location-editor-help').innerText.includes('8')"), true);
    assert.equal(await page.evaluate("document.querySelector('.location-editor-help').innerText.includes('0,5')"), true);
    await page.evaluate("selectLocationEditorTool('height')");
    assert.equal(await page.evaluate("document.querySelector('.location-editor-help').open"), true);
    await page.evaluate("document.querySelector('.location-editor-help summary').click();document.activeElement.blur()");
    const key=async(code,key)=>{for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key})};
    await page.evaluate("const a=document.querySelector('[data-map-editor-auto-expand]');a.checked=false;a.dispatchEvent(new Event('change',{bubbles:true}));UI.collapseMapToolsPanel()");
    await key('Digit8','8');
    assert.equal(await page.evaluate('window.locationEditorTool'), 'light');
    assert.equal(await page.evaluate("document.querySelector('#panel-tools').classList.contains('collapsed')"), true);
    assert.equal(await page.evaluate("localStorage.getItem('mapEditorAutoExpand')"), 'false');
    await page.evaluate("UI.expandMapToolsPanel();document.querySelector('[data-map-editor-auto-expand]').click();UI.collapseMapToolsPanel()");
    await key('Digit3','3');
    assert.equal(await page.evaluate('window.locationEditorTool'), 'height');
    assert.equal(await page.evaluate("document.querySelector('#panel-tools').classList.contains('collapsed')"), false);
    await page.evaluate('UI.collapseMapToolsPanel()');
    await key('Digit3','3');
    assert.equal(await page.evaluate("document.querySelector('#panel-tools').classList.contains('collapsed')"), true);
    await key('Digit4','4');
    assert.equal(await page.evaluate("document.querySelector('#panel-tools').classList.contains('collapsed')"), false);
    const mode=await page.evaluate('L.getLocationEditMode()');
    await page.evaluate("document.querySelector('#loc-edit-toggle-checkbox').click()");
    assert.equal(await page.evaluate('L.getLocationEditMode()'), !mode);
    await key('KeyE','e');
    assert.equal(await page.evaluate('L.getLocationEditMode()'), mode);
    await page.evaluate("document.querySelector('[data-map-editor-auto-expand]').click();UI.collapseMapToolsPanel()");
    await page.call('Page.navigate',{url:'about:blank'});
    await page.until("location.href==='about:blank'",'blank context');
    await page.call('Page.navigate',{url:base+'/lobbies/'+lobby.id+'/page'});
    await page.until('Boolean(window.enterLocation&&window.isGM)','reloaded game');
    await page.evaluate('void enterLocation('+loc.id+')');
    await page.until("window.selectLocationEditorTool&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'reloaded local panel');
    assert.equal(await page.evaluate("document.querySelector('[data-map-editor-auto-expand]').checked"), false);
    assert.equal(await page.evaluate("document.querySelector('#panel-tools').classList.contains('collapsed')"), true);
    await key('KeyE','e');
    assert.equal(await page.evaluate("document.querySelector('#panel-tools').classList.contains('collapsed')"), false);
    await page.evaluate("document.querySelector('#panel-tools .panel-header .toggle-btn').click()");
    await key('Digit8','8');
    assert.equal(await page.evaluate('window.locationEditorTool'), 'light');
    assert.equal(await page.evaluate("document.querySelector('#panel-tools').classList.contains('collapsed')"), true);
    console.log('PASS LOC-02: three viewport layouts, keyboard help, light 8, edit mode, same-tool collapse, auto-expand preference and reload');
};
