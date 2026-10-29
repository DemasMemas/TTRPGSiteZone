// VTT_WORLD_HISTORY=1 VTT_BROWSER_GPU=1 node tests/world_object_editor.browser.cjs
const assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const api=`/lobbies/${lobby.id}`;
    const pair=[{type:'house',name:'Copy house',scale:.8,rotation:12.345,x:.125,z:-.125,color:'#827362'},
        {type:'house',name:'Copy camp',scale:.65,rotation:21.125,x:-.2,z:.125,color:'#677456'}];
    for(let i=0;i<2;i++)await request(`${api}/chunks/${i}/0/tile/${i?0:31}/12`,{objects:[pair[i]]},token,'PATCH');
    await page.evaluate(`(async()=>{window.E=await import('/static/js/mapEdit.js');window.T=await import('three');window.UI=await import('/static/js/ui_interactions.js');
        if(document.getElementById('gm-only-controls').style.display==='none')toggleEditMode();E.selectWorldEditorTool('select');
        sceneModule.controls.target.set(34,1,15);sceneModule.camera.position.set(34,20,34);sceneModule.controls.update();
        document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();UI.collapseMapToolsPanel();
        window.selectionNotices=[];new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.matches?.('.notification'))selectionNotices.push(node.textContent)}).observe(document.body,{childList:true,subtree:true});
        window.historyRequests=[];const send=window.fetch;window.fetch=function(url,o){if(o?.method==='POST'&&['world-editor/changes','chunks/batch','world-objects/edit'].some(s=>String(url).includes(s)))historyRequests.push({url:String(url),body:JSON.parse(o.body)});return send.apply(this,arguments)};})()`);
    await page.until("sceneModule.chunksMap.get('1,0').tilesData[12][0].objects[0].name==='Copy camp'",'test objects');
    await page.until("sceneModule.chunksMap.get('0,0').houses&&sceneModule.chunksMap.get('1,0').houses&&!sceneModule.chunksMap.get('0,0').pendingRebuild&&!sceneModule.chunksMap.get('1,0').pendingRebuild",'object meshes');
    const data=()=>page.evaluate("Object.fromEntries([...sceneModule.chunksMap].map(([k,c])=>[k,c.tilesData]))");
    const history=()=>page.evaluate('getWorldEditorHistoryState()');
    const idle=()=>page.until('!getWorldEditorHistoryState().busy','history saved');
    const performanceSample=()=>page.evaluate(`(async()=>{const start=performance.now();let frames=0;while(performance.now()-start<700){await new Promise(requestAnimationFrame);frames++;}return{fps:Math.round(frames*1000/(performance.now()-start)),calls:sceneModule.renderer.info.render.calls,geometries:sceneModule.renderer.info.memory.geometries}})()`);
    const key=async(code,modifiers=0)=>{await page.evaluate('document.activeElement.blur()');for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key:code.startsWith('Key')?code.slice(3).toLowerCase():code,modifiers});await idle();};
    const point=async(x,z,y=1)=>page.evaluate(`(()=>{sceneModule.camera.updateMatrixWorld(true);const v=new T.Vector3(${x},${y},${z}).project(sceneModule.camera),r=sceneModule.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
    let pointer;
    const mouse=async(type,p=pointer,modifiers=0)=>{pointer=p;await page.call('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:1,modifiers});};
    const click=async(p,shift=false)=>{for(const type of ['mouseMoved','mousePressed','mouseReleased'])await mouse(type,p,shift?8:0);await idle();};
    const objectPoint=async(x,z,type)=>page.evaluate(`(()=>{sceneModule.camera.updateMatrixWorld(true);sceneModule.scene.updateMatrixWorld(true);
        const c=sceneModule.chunksMap.get('${Math.floor(x/32)},${Math.floor(z/32)}'),tile=c.tilesData[${z%32}][${x%32}],o=tile.objects[0],d=sceneModule.getObjectDimensions(o.type,o.anomalyType,o.scale??1),r=sceneModule.renderer.domElement.getBoundingClientRect();
        for(const dy of [0,-.2,.2])for(const dx of [0,-.2,.2])for(const dz of [0,-.2,.2]){const v=new T.Vector3(${x}+.5+(o.x||0)+dx*d.width,Number(tile.height)+sceneModule.getObjectHeightOffset(o.type,o.anomalyType)*(o.scale??1)+dy*d.height,${z}+.5+(o.z||0)+dz*d.depth).project(sceneModule.camera),p={x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2},hit=sceneModule.pickWorldObject(p.x,p.y);if(hit?.chunkX===${Math.floor(x/32)}&&hit?.tileX===${x%32}&&hit?.tileY===${z%32})return p;}
        throw Error('No visible pixel for ${type}');})()`);
    await click(await objectPoint(31,12,'house'));const campPoint=await objectPoint(32,12,'house');
    await click(campPoint,true);
    assert.equal(await page.evaluate('getDirectWorldObjectSelection().length'),2,'real Shift selection');
    const initial=await data();await key('KeyC',2);assert.equal(await page.evaluate('getWorldClipboardState().count'),2);
    const baseline=await performanceSample();
    await key('KeyV',2);await mouse('mouseMoved',await point(38.5,16.5));await page.until('getWorldClipboardState().preview&&getWorldClipboardState().valid','group preview');
    assert.deepEqual(await data(),initial);assert.equal((await history()).undo,0);
    await key('Escape');assert.equal(await page.evaluate('getWorldClipboardState().preview'),false);
    await key('KeyV',2);await mouse('mouseMoved',await point(38.5,16.5));await page.until('getWorldClipboardState().valid','second preview');
    const previewPerformance=await performanceSample();
    if(process.env.VTT_WORLD_HISTORY_VIEW==='1')console.log('WORLD_HISTORY_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:65})).data);
    await click(pointer);await page.until('!getWorldClipboardState().preview&&!getWorldEditorHistoryState().busy','paste saved');
    const pasted=await data();assert.equal((await history()).undo,1);assert.equal(await page.evaluate('getDirectWorldObjectSelection().length'),2);
    assert.deepEqual(pasted['0,0'][12][31].objects,initial['0,0'][12][31].objects);
    await key('KeyZ',2);assert.deepEqual(await data(),initial);
    await key('KeyZ',10);assert.deepEqual(await data(),pasted,'Ctrl+Shift+Z redo');
    // Existing G/T/R gestures remain available for pasted groups.
    await page.evaluate('selectDirectWorldObjects([{chunkX:1,chunkY:0,tileX:6,tileY:16,index:0},{chunkX:1,chunkY:0,tileX:7,tileY:16,index:0}])');
    for(const code of ['KeyG','KeyT','KeyR']){await key(code);assert.equal(await page.evaluate('isDirectWorldObjectTransformActive()'),true);await key('Escape');}
    await key('KeyG');const movedPoint=await point(40.5,18.5);await mouse('mouseMoved',movedPoint);await click(movedPoint);await page.until('getWorldEditorHistoryState().undo===2&&!getWorldEditorHistoryState().busy','group move recorded');
    const moved=await data();await key('KeyZ',2);assert.deepEqual(await data(),pasted);await key('KeyY',2);assert.deepEqual(await data(),moved);
    const selectCopies=()=>page.evaluate(`selectDirectWorldObjects([...sceneModule.chunksMap.values()].flatMap(c=>c.tilesData.flatMap((row,z)=>row.flatMap((tile,x)=>(tile.objects||[]).flatMap((o,index)=>c.chunkX*32+x>35&&o.name?.startsWith('Copy ')?[{chunkX:c.chunkX,chunkY:c.chunkY,tileX:x,tileY:z,index}]:[])))))`);
    for(const code of ['KeyT','KeyR']){
        await selectCopies();const before=await data(),count=(await history()).undo;
        await key(code);const p={x:pointer.x+45,y:pointer.y};await mouse('mouseMoved',p);await click(p);
        await page.until(`getWorldEditorHistoryState().undo===${count+1}&&!getWorldEditorHistoryState().busy`,'transform saved');
        const after=await data();assert.notDeepEqual(after,before);await key('KeyZ',2);assert.deepEqual(await data(),before);await key('KeyY',2);assert.deepEqual(await data(),after);
    }
    await selectCopies();const beforeDelete=await data(),deleteCount=(await history()).undo;await key('Delete');
    await page.until(`getWorldEditorHistoryState().undo===${deleteCount+1}&&!getWorldEditorHistoryState().busy`,'delete saved');
    const deleted=await data();assert.notDeepEqual(deleted,beforeDelete);await key('KeyZ',2);assert.deepEqual(await data(),beforeDelete);await key('KeyY',2);assert.deepEqual(await data(),deleted);
    await page.evaluate("E.selectWorldEditorTool('objects');document.querySelector('[data-world-object=house]').click();UI.collapseMapToolsPanel()");
    const beforePlace=await data(),placeCount=(await history()).undo;await click(await point(27.5,18.5));
    await page.until(`getWorldEditorHistoryState().undo===${placeCount+1}&&!getWorldEditorHistoryState().busy`,'placement saved');
    const placed=await data();assert.notDeepEqual(placed,beforePlace);await key('KeyZ',2);assert.deepEqual(await data(),beforePlace);await key('KeyY',2);assert.deepEqual(await data(),placed);
    console.log('WORLD HISTORY objects: Shift, copy/paste, preview cancel, one command, G/T/R, move, undo/redo');
    const foreignWarnings=()=>page.evaluate("selectionNotices.filter(text=>text.includes('Объект изменён другим участником')).length");
    assert.equal(await foreignWarnings(),0,'own undo/redo must not report a foreign object change');
    await page.evaluate('selectDirectWorldObjects([{chunkX:0,chunkY:0,tileX:31,tileY:12,index:0}])');
    await request(api+'/chunks/0/0/tile/31/12',{objects:[{...pair[0],name:'Foreign object change'}]},token,'PATCH');
    await page.until('getDirectWorldObjectSelection().length===0','foreign edit invalidates selection');
    assert.equal(await foreignWarnings(),1,'genuine foreign changes still warn');
    // One held paint stroke, including repeated cells and a chunk boundary.
    await page.evaluate("E.selectWorldEditorTool('terrain');document.getElementById('tile-type-select').value='sand';document.getElementById('tile-type-select').dispatchEvent(new Event('change',{bubbles:true}));setBrushRadiusFromInput(1);UI.collapseMapToolsPanel()");
    const beforeBrush=await data(),beforeCount=(await history()).undo,beforeRequests=await page.evaluate('historyRequests.length');
    await mouse('mouseMoved',await point(28.5,22.5));await mouse('mousePressed');await pause(650);
    const heldPerformance=await performanceSample();
    for(const x of [30.5,33.5,30.5]){const p=await point(x,22.5);await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p,button:'left',buttons:1});pointer=p;}
    assert.equal(await page.evaluate('historyRequests.length'),beforeRequests,'held brush has no partial server writes');
    await mouse('mouseReleased');await idle();assert.equal((await history()).undo,beforeCount+1);
    const painted=await data();assert.equal(painted['1,0'][22][0].terrain,'sand');
    await key('KeyZ',2);assert.deepEqual(await data(),beforeBrush);await key('KeyY',2);assert.deepEqual(await data(),painted);
    // Read-only rectangular selection copies terrain, exact heights and objects.
    const patch=[];for(let z=20;z<=21;z++)for(let x=30;x<=33;x++)patch.push({chunk_x:Math.floor(x/32),chunk_y:0,tile_x:x%32,tile_y:z,updates:{terrain:'rock',height:1.234567,radiation:.125,objects:x===31&&z===20?[{type:'tree',scale:.7,rotation:17.125}]:[]}});
    await request(api+'/chunks/batch',patch,token);await page.until("sceneModule.chunksMap.get('0,0').tilesData[20][31].height===1.234567",'area data');
    await page.evaluate("E.selectWorldEditorTool('select');document.getElementById('world-select-area').click();UI.collapseMapToolsPanel()");
    const start=await point(30.5,20.5,await page.evaluate('sceneModule.sampleWorldGroundHeight(30.5,20.5)'));
    await mouse('mouseMoved',start);const plane=await page.evaluate(`sceneModule.worldPointOnTerrain(${start.x},${start.y}).y`);await mouse('mousePressed');
    const end=await point(33.5,21.5,plane);await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1});pointer=end;await mouse('mouseReleased');
    assert.deepEqual(await page.evaluate('getWorldClipboardState().area'),{minX:30,maxX:33,minZ:20,maxZ:21});
    await key('KeyC',2);assert.equal(await page.evaluate('getWorldClipboardState().kind'),'area');
    const beforeArea=await data(),areaCount=(await history()).undo;
    await mouse('mouseMoved',await point(44.5,22.5));await key('KeyV',2);await page.until('getWorldClipboardState().valid','area preview');
    assert.deepEqual(await data(),beforeArea);await click(pointer);await page.until('!getWorldClipboardState().preview','area committed');await idle();assert.equal((await history()).undo,areaCount+1);
    const areaPasted=await data();assert.deepEqual(areaPasted['1,0'][22][12],beforeArea['0,0'][20][30]);assert.deepEqual(areaPasted['1,0'][22][13],beforeArea['0,0'][20][31]);
    await key('KeyZ',2);assert.deepEqual(await data(),beforeArea);await key('KeyY',2);assert.deepEqual(await data(),areaPasted);
    console.log('WORLD HISTORY brush/area: held stroke, boundaries, repeated cells, exact snapshots, rectangular copy, terrain/objects preview and undo/redo');
    console.log('WORLD HISTORY performance',JSON.stringify({baseline,preview:previewPerformance,held:heldPerformance}));
    const target=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json(),peer=await connect(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    try{
        await peer.call('Page.bringToFront');await peer.until('window.toggleEditMode&&window.isGM','peer ready');
        await peer.evaluate("(async()=>{window.W=await import('/static/js/lobby3d.js')})()");await peer.until('W.chunksMap.size===2','peer chunks');await page.call('Page.bringToFront');
        for(const [type,z]of [['road',9.5],['fence',16]]){
            await page.evaluate(`E.selectWorldEditorTool('objects');document.querySelector('[data-world-object="${type}"]').click();UI.collapseMapToolsPanel()`);
            const before=await data(),count=(await history()).undo;
            await click(await point(28.5,z));await mouse('mouseMoved',await point(35.5,z));await pause(450);await click(pointer);
            await page.until(`getWorldEditorHistoryState().undo===${count+1}&&!getWorldEditorHistoryState().busy`,'line recorded');
            await key('Escape');const built=await data();
            assert.notDeepEqual(built,before);await peer.until(`W.chunksMap.get('1,0').tilesData[${Math.floor(z)}][0].objects.some(o=>o.type==='${type}')`,'peer sees line');
            assert.deepEqual(await peer.evaluate("W.chunksMap.get('1,0').tilesData"),built['1,0']);
            await key('KeyZ',2);assert.deepEqual(await data(),before);await peer.until(`!W.chunksMap.get('1,0').tilesData[${Math.floor(z)}][0].objects.some(o=>o.type==='${type}')`,'peer sees undo');
            assert.deepEqual(await peer.evaluate("W.chunksMap.get('1,0').tilesData"),before['1,0']);
            await key('KeyY',2);assert.deepEqual(await data(),built);
        }
        // A foreign change to the same object array prevents the entire undo.
        const beforeConflict=await data(),count=(await history()).undo,foreign=[...beforeConflict['0,0'][16][31].objects,{type:'tree',name:'Foreign'}];
        await request(api+'/chunks/0/0/tile/31/16',{objects:foreign},token,'PATCH');
        await page.until("sceneModule.chunksMap.get('0,0').tilesData[16][31].objects.some(o=>o.name==='Foreign')",'foreign change');
        const conflicted=await data();await key('KeyZ',2);assert.deepEqual(await data(),conflicted);assert.equal((await history()).undo,count);
        await request(api+'/chunks/0/0/tile/31/16',{objects:beforeConflict['0,0'][16][31].objects},token,'PATCH');
        await page.until("!sceneModule.chunksMap.get('0,0').tilesData[16][31].objects.some(o=>o.name==='Foreign')",'conflict resolved');
        await key('KeyZ',2);assert.equal((await history()).undo,count-1);await key('KeyY',2);assert.deepEqual(await data(),beforeConflict);
        assert.equal(await peer.evaluate('socket.io.engine.transport.name'),'websocket');
        console.log('WORLD HISTORY network: real road/fence gestures, one command, peer synchronization, atomic conflict rejection');
    }finally{peer.close();await page.call('Target.closeTarget',{targetId:target.targetId});await page.call('Page.bringToFront');}
    // An area preview guards the snapshots actually displayed before confirming.
    await page.evaluate("E.selectWorldEditorTool('select');UI.collapseMapToolsPanel()");
    await mouse('mouseMoved',await point(48.5,24.5));await key('KeyV',2);await page.until('getWorldClipboardState().valid','guarded preview');
    const pasteCount=(await history()).undo;
    await request(api+'/chunks/1/0/tile/16/24',{height:1.345678},token,'PATCH');
    await page.until("sceneModule.chunksMap.get('1,0').tilesData[24][16].height===1.345678",'foreign preview destination');
    await click(pointer);assert.equal((await history()).undo,pasteCount);assert.equal(await page.evaluate('getWorldClipboardState().preview'),true);
    assert.equal((await data())['1,0'][24][16].height,1.345678);await key('Escape');
    // Native text clipboard must remain native.
    await page.evaluate("window.nativeKeys=[];const e=document.createElement('textarea');e.id='native-world-clipboard';document.body.append(e);e.focus();e.value='text';e.select();e.addEventListener('keydown',event=>nativeKeys.push(event.defaultPrevented))");
    for(const code of ['KeyC','KeyV'])for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key:code.slice(3).toLowerCase(),modifiers:2});
    assert.deepEqual(await page.evaluate('nativeKeys'),[false,false]);await page.evaluate("document.getElementById('native-world-clipboard').remove()");
    await page.evaluate("E.selectWorldEditorTool('select');UI.expandMapToolsPanel()");
    for(const [width,height]of [[1366,768],[640,720]]){
        await page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        assert.equal(await page.evaluate("(()=>{const p=document.querySelector('#panel-tools .panel-content');return p.scrollWidth<=p.clientWidth+1})()"),true,'clipboard controls fit viewport');
    }
    await page.call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
    const worldBeforeLocation=await data(),historyBeforeLocation=await history();
    const loc=await request(api+'/locations',{name:'Separate history',world_tile_x:12,world_tile_z:12,grid_width:8,grid_height:8,
        tiles_data:Array.from({length:8},()=>Array.from({length:8},()=>({terrain:'concrete',height:1,objects:[]})))},token);
    await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');await enterLocation(${loc.id})})()`);
    await page.until('window.isLocationActive','entered sublocation');await key('KeyZ',2);
    assert.deepEqual(await history(),historyBeforeLocation);assert.deepEqual(await data(),worldBeforeLocation);
    await page.evaluate('exitLocation()');await page.until('!window.isLocationActive','returned to world');
    const final=await data();await page.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});await page.until('window.toggleEditMode&&window.isGM','reload');await page.evaluate("(async()=>{window.sceneModule=await import('/static/js/lobby3d.js')})()");await page.until('sceneModule.chunksMap.size===2','reloaded world');assert.deepEqual(await data(),final);
    console.log('WORLD HISTORY PASS: objects, group transforms, one brush command, area clipboard, native shortcuts and reload');
};
