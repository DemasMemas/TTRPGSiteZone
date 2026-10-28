// VTT_LOC_LIBRARY=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
module.exports = async ({page, request, token, lobby}) => {
    const audit = process.env.VTT_LOC_LIBRARY_AUDIT === '1';
    const loc = await request(`/lobbies/${lobby.id}/locations`, {
        name:'Library acceptance', world_tile_x:10, world_tile_z:10, grid_width:16, grid_height:16,
        tiles_data:Array.from({length:16},()=>Array.from({length:16},()=>({terrain:'concrete',height:1,objects:[]}))),
    }, token);
    await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.UI=await import('/static/js/ui_interactions.js');window.T=await import('three');
        const add=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){if(roots.some(r=>r.userData.locationObject))window.libraryScene=this;return add.apply(this,roots)};
        await enterLocation(${loc.id})})()`);
    await page.until("window.selectLocationEditorTool&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'location ready');
    await page.evaluate("L.setLocationEditMode(true);selectLocationEditorTool('assets');UI.expandMapToolsPanel()");
    const search = async value => page.evaluate(`(()=>{const e=document.querySelector('.location-asset-search');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    const tab = async name => page.evaluate(`[...document.querySelectorAll('.location-asset-tabs button')].find(e=>e.textContent===${JSON.stringify(name)}).click()`);
    const reports=[];
    for(const [width,height] of [[1366,768],[640,720]]) {
        await page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        await page.evaluate('cancelLocationAssetPlacement()');
        await search('');
        const groups=await page.evaluate("[...document.querySelectorAll('.location-asset-tabs button')].map(e=>e.textContent)");
        const counts=[];
        for(const group of groups){await tab(group);counts.push([group,await page.evaluate("document.querySelectorAll('.location-asset-card').length")]);}
        const largest=counts.toSorted((a,b)=>b[1]-a[1])[0];await tab(largest[0]);
        const scroll=await page.evaluate(`(()=>{const g=document.querySelector('.location-asset-grid');g.scrollTop=g.scrollHeight;const before=g.scrollTop;g.lastElementChild.click();return {before,after:g.scrollTop,name:document.querySelector('[data-placement-name]').textContent,selected:g.querySelectorAll('[aria-pressed=true]').length}})()`);
        const layout=await page.evaluate(`(()=>{const p=document.querySelector('#panel-tools'),c=p.querySelector('.panel-content');return {width:c.clientWidth,scroll:c.scrollWidth}})()`);
        const timing=await page.evaluate(`(()=>{const e=document.querySelector('.location-asset-search'),times=[];for(const value of ['а','стол','лампа','НЕСУЩЕСТВУЮЩИЙ']){const t=performance.now();e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));times.push(performance.now()-t)}return times})()`);
        await search('СтОл');const names=await page.evaluate("[...document.querySelectorAll('.location-asset-card')].map(e=>e.textContent)");
        assert.ok(names.length&&names.every(n=>n.toLowerCase().includes('стол')));
        await tab('Свет');const categorySearch=await page.evaluate("({value:document.querySelector('.location-asset-search').value,names:[...document.querySelectorAll('.location-asset-card')].map(e=>e.textContent)})");
        reports.push({width,counts,scroll,layout,timing,categorySearch});
        if(!audit){assert.ok(scroll.before>0);assert.equal(scroll.after,scroll.before,'selection keeps catalogue scroll');assert.equal(scroll.selected,1);assert.ok(layout.scroll<=layout.width+1);assert.equal(categorySearch.value,'','category switches back from global search');}
        await search('несуществующий ассет');
        assert.equal(await page.evaluate("document.querySelectorAll('.location-asset-card').length"),0);
        if(!audit)assert.equal(await page.evaluate("document.querySelector('.location-asset-empty').hidden"),false);
        await search('');
    }
    console.log('LIBRARY AUDIT',JSON.stringify(reports));
    if(audit)return;
    await search('Стол');
    await page.evaluate(`document.querySelector('.location-asset-card').click();locationControls.target.set(8,1,8);locationControls.object.position.set(8,12,17);locationControls.update();document.activeElement.blur();UI.collapseMapToolsPanel()`);
    const point=await page.evaluate(`(()=>{locationControls.object.updateMatrixWorld(true);const v=new T.Vector3(8.5,1,8.5).project(locationControls.object),r=document.querySelector('#location-canvas canvas').getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
    const mouse=async(type,button='left')=>page.call('Input.dispatchMouseEvent',{type,...point,button:type==='mouseMoved'?'none':button,buttons:type==='mousePressed'?(button==='right'?2:1):0,clickCount:1});
    await mouse('mouseMoved');
    await page.until('!!window.libraryScene','real placement preview');
    const preview=()=>page.evaluate(`(()=>{const m=libraryScene.children.find(r=>r.userData.locationObject&&!r.userData.locationObjectId);return m?{rotation:m.rotation.y,dimensions:m.userData.locationObject?.properties?.dimensions}:null})()`);
    assert.ok(await preview(),'placement has a real mesh');
    await page.evaluate(`UI.expandMapToolsPanel();const e=document.querySelector('[data-placement-dimension="width"]');e.focus();e.value='1.7';e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.blur();UI.collapseMapToolsPanel()`);
    await mouse('mouseMoved');
    assert.equal((await preview()).dimensions.width,1.7);
    const before=(await preview()).rotation;
    for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code:'KeyQ',key:'q'});
    assert.notEqual((await preview()).rotation,before,'Q rotates placement preview');
    await mouse('mousePressed','right');await mouse('mouseReleased','right');
    await page.until("document.querySelector('.location-asset-placement').hidden",'right click cancels placement');
    await page.evaluate("UI.expandMapToolsPanel();document.querySelector('.location-asset-card').click();document.activeElement.blur();UI.collapseMapToolsPanel()");
    await mouse('mouseMoved');await mouse('mousePressed');await mouse('mouseReleased');
    const detail=()=>request(`/lobbies/${lobby.id}/locations/${loc.id}`,null,token,'GET');
    await page.until('L.getLocationEditorHistoryState().undo===1&&!L.getLocationEditorHistoryState().busy','placement committed');
    assert.equal((await detail()).objects.length,1);
    await page.evaluate("UI.expandMapToolsPanel();selectLocationEditorTool('light')");
    assert.equal(await page.evaluate("document.querySelector('.location-asset-library').hidden"),true);
    if(process.env.VTT_LOC_LIBRARY_VIEW==='1'){
        await page.evaluate("selectLocationEditorTool('assets')");
        for(const [width,height] of [[1366,768],[640,720]]){
            await page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
            await new Promise(resolve=>setTimeout(resolve,200));
            console.log('LIBRARY_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:55})).data);
        }
        await page.call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
        await page.evaluate('UI.collapseMapToolsPanel()');
        await new Promise(resolve=>setTimeout(resolve,200));
        console.log('LIBRARY_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:55})).data);
    }
    console.log('LIBRARY PASS: catalogue, layouts, search, selection, preview, cancellation, placement');
};
