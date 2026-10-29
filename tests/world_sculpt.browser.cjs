const assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const api=`/lobbies/${lobby.id}`;
    const chunks=()=>request(api+'/chunks?min_chunk_x=0&max_chunk_x=1&min_chunk_y=0&max_chunk_y=1',null,token,'GET');
    const route={waypoints:[[28,12],[35,12]],allow_bridges:false,settings:{scale:1,color:'#756f61'}};
    const preview=await request(api+'/world-roads/preview',route,token);
    await request(api+'/world-roads/build',{...route,signature:preview.signature},token);
    await request(api+'/chunks/0/0/tile/31/14',{objects:[{type:'fence',scale:1,rotation:90,x:0,z:0,color:'#777777'}]},token,'PATCH');
    await page.until("sceneModule.chunksMap.get('0,0').tilesData[12][30].objects.some(o=>o.type==='road')",'road ready');
    await page.evaluate(`(async()=>{window.E=await import('/static/js/mapEdit.js');window.UI=await import('/static/js/ui_interactions.js');window.T=await import('three');
        if(document.getElementById('gm-only-controls').style.display==='none')window.toggleEditMode();
        sceneModule.controls.target.set(32,1,12);sceneModule.camera.position.set(32,22,34);sceneModule.controls.update();
        document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();UI.collapseMapToolsPanel();window.sculptPackets=[];
        const send=window.fetch;window.fetch=function(url,o){if(String(url).endsWith('/chunks/batch')&&o?.body)sculptPackets.push(JSON.parse(o.body));return send.apply(this,arguments)};})()`);
    const height=(x,z)=>page.evaluate(`sceneModule.chunksMap.get('${Math.floor(x/32)},0').tilesData[${z}][${x%32}].height`);
    const data=()=>page.evaluate(`Object.fromEntries([...sceneModule.chunksMap].map(([k,c])=>[k,c.tilesData]))`);
    const initial=await data();
    const configure=async(mode,strength=.5,radius=3)=>page.evaluate(`(()=>{document.querySelector('[data-world-tool="height"]').click();window.setBrushRadiusFromInput(${radius});const e=document.getElementById('world-sculpt-mode');e.value='${mode}';e.dispatchEvent(new Event('change',{bubbles:true}));const n=document.getElementById('world-sculpt-strength');n.value='${strength}';n.dispatchEvent(new Event('change',{bubbles:true}));n.blur();UI.collapseMapToolsPanel()})()`);
    let p;
    const move=async(x,z,y=1,buttons=1)=>{
        p=await page.evaluate(`(()=>{sceneModule.camera.updateMatrixWorld(true);const v=new T.Vector3(${x},${y},${z}).project(sceneModule.camera),r=sceneModule.renderer.domElement.getBoundingClientRect();return{x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p,buttons,button:buttons?'left':'none'});
    };
    const press=async(x,z,y=1)=>{await move(x,z,y,0);await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1});};
    const idle=()=>page.until('!getWorldSculptState().busy&&!getWorldSculptState().saving','saved world stroke');
    const release=async()=>{await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1});await idle();};
    const key=async(code,modifiers=0)=>{for(const type of ['keyDown','keyUp'])await page.call('Input.dispatchKeyEvent',{type,code,key:code==='Escape'?'Escape':code.slice(3).toLowerCase(),modifiers});await idle();};
    const sample=()=>page.evaluate(`(async()=>{const frames=[];let last=performance.now(),end=last+700;await new Promise(resolve=>requestAnimationFrame(function next(t){frames.push(t-last);last=t;if(t<end)requestAnimationFrame(next);else resolve()}));frames.sort((a,b)=>a-b);return{fps:frames.length*1000/frames.reduce((a,b)=>a+b,0),p95:frames[Math.floor(frames.length*.95)]}})()`);
    await page.evaluate("document.querySelector('[data-world-tool=height]').click()");
    assert.deepEqual(await page.evaluate("({mode:document.getElementById('world-sculpt-mode').value,tool:worldEditorTool,exact:!document.getElementById('world-exact-height-controls').hidden,sculpt:!document.getElementById('world-sculpt-controls').hidden,separate:Boolean(document.querySelector('[data-world-tool=sculpt]'))})"),{mode:'exact',tool:'height',exact:true,sculpt:false,separate:false});
    await page.evaluate('setBrushRadiusFromInput(0);setTileHeightFromInput(1.4);UI.collapseMapToolsPanel()');
    await press(29.5,8.5);await release();assert.equal(await height(29,8),1.4);await key('KeyZ',2);assert.deepEqual(await data(),initial);
    await configure('smooth');
    assert.equal(await page.evaluate("document.querySelector('[data-world-tool=height]').getAttribute('aria-pressed')"),'true');
    await page.evaluate("E.selectWorldEditorTool('terrain');document.querySelector('[data-world-tool=height]').click()");
    assert.equal(await page.evaluate("worldEditorTool==='sculpt'&&document.getElementById('world-sculpt-mode').value==='smooth'"),true,'return remembers height mode');
    if(process.env.VTT_WORLD_HEIGHT_VIEW==='1')console.log('WORLD_HEIGHT_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:65})).data);
    await configure('exact');assert.equal(await page.evaluate('worldEditorTool'),'height');
    await pause(600);
    const baseline=await sample();await configure('raise');await press(31.5,10.5);
    const holding=await sample();
    assert.equal(await page.evaluate('getWorldSculptState().active'),true);
    assert.ok(await height(31,10)>1.2,'height changes before release');
    assert.equal(await page.evaluate('sculptPackets.length'),0,'no partial requests');
    if(process.env.VTT_WORLD_SCULPT_VIEW==='1')console.log('WORLD_SCULPT_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:65})).data);
    await release();const hill=await data();
    assert.ok(hill['1,0'][10][0].height>1.1,'brush crosses chunk boundary');
    assert.equal(await page.evaluate('getWorldSculptState().undo'),1);
    assert.equal(await page.evaluate('sculptPackets.length'),1);
    assert.deepEqual(hill['0,0'][10][31].objects,initial['0,0'][10][31].objects);
    const factoryY=await page.evaluate(`(()=>{const c=sceneModule.chunksMap.get('0,0'),i=c.landmarkIndices.factory[10*32+31][0],m=new T.Matrix4();c.landmarks.factory.getMatrixAt(i,m);return m.elements[13]})()`);
    assert.ok(factoryY>hill['0,0'][10][31].height,'factory keeps its base offset above raised terrain');
    assert.deepEqual(hill['0,0'][12][30].objects,initial['0,0'][12][30].objects);
    await key('KeyZ',2);assert.deepEqual(await data(),initial);
    await key('KeyY',2);assert.deepEqual(await data(),hill);
    await configure('lower',1,3);await press(26.5,16.5);await pause(650);await release();assert.ok(await height(26,16)<.8);
    await configure('raise',1.5,3);await press(25.5,20.5);
    await page.evaluate('window.movingFrames=[];window.recordMoving=true;window.lastMoving=performance.now();requestAnimationFrame(function next(t){movingFrames.push(t-lastMoving);lastMoving=t;if(recordMoving)requestAnimationFrame(next)})');
    for(let x=26;x<=39;x+=.5){await move(x,20.5);await pause(45);}
    const moving=await page.evaluate('(()=>{recordMoving=false;return{fps:movingFrames.length*1000/movingFrames.reduce((a,b)=>a+b,0),max:Math.max(...movingFrames)}})()');
    await release();const bank=await data();
    for(let x=26;x<=38;x++)assert.ok(bank[`${Math.floor(x/32)},0`][20][x%32].height>1.01);
    await configure('smooth',3,3);const peak=await height(31,10);await press(31.5,10.5,peak);await pause(600);await release();assert.ok(await height(31,10)<peak);
    await configure('raise',.7,3);await press(31.5,14.5);await pause(450);await release();
    const fence=await data();assert.deepEqual(fence['0,0'][14][31].objects,initial['0,0'][14][31].objects);
    assert.ok(await page.evaluate('sceneModule.getWorldFenceDiagnostics().geometryReady'));
    await page.evaluate('sceneModule.controls.target.set(32,1,30);sceneModule.camera.position.set(32,22,52);sceneModule.controls.update()');
    await configure('raise',.8,3);await press(31.5,31.5);await pause(400);await release();
    const corner=await data();assert.ok(corner['1,1'][0][0].height>1.1,'four-chunk corner is edited');
    await page.evaluate('sceneModule.controls.target.set(32,1,12);sceneModule.camera.position.set(32,22,34);sceneModule.controls.update()');
    const beforeCancel=await data(),undo=await page.evaluate('getWorldSculptState().undo');
    await configure('raise');await press(30.5,10.5,await height(30,10));await pause(200);await key('Escape');await release();assert.deepEqual(await data(),beforeCancel);assert.equal(await page.evaluate('getWorldSculptState().undo'),undo);
    console.log('WORLD SCULPT shapes/history',JSON.stringify({baseline,holding,moving}));
    const target=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json(),peer=await connect(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    try{
        await peer.call('Page.bringToFront');await peer.until('window.toggleEditMode&&window.isGM','peer ready');
        await peer.evaluate(`(async()=>{window.W=await import('/static/js/lobby3d.js')})()`);await peer.until('W.chunksMap.size===4','peer chunks');await page.call('Page.bringToFront');
        const old=await height(31,10);await configure('raise');await press(31.5,10.5,old);await pause(300);await release();const changed=await height(31,10);
        await peer.until(`Math.abs(W.chunksMap.get('0,0').tilesData[10][31].height-${changed})<1e-8`,'peer sees sculpt');
        await key('KeyZ',2);await peer.until(`Math.abs(W.chunksMap.get('0,0').tilesData[10][31].height-${old})<1e-8`,'peer sees undo');await key('KeyY',2);
        assert.equal(await peer.evaluate('socket.io.engine.transport.name'),'websocket');
        // A foreign edit during a held stroke rejects the complete commit.
        const state=await data(),count=await page.evaluate('getWorldSculptState().undo');
        await configure('raise');await press(31.5,10.5,changed);await pause(250);
        await request(api+'/chunks/1/0/tile/0/10',{height:1.2345},token,'PATCH');await release();
        await page.until("sceneModule.chunksMap.get('1,0').tilesData[10][0].height===1.2345",'foreign height restored');
        assert.equal(await height(31,10),state['0,0'][10][31].height);assert.equal(await page.evaluate('getWorldSculptState().undo'),count);
    }finally{peer.close();await page.call('Target.closeTarget',{targetId:target.targetId});await page.call('Page.bringToFront');}
    await pause(200);
    const final=await data();await chunks();
    await page.evaluate("E.selectWorldEditorTool('sculpt');UI.expandMapToolsPanel()");
    for(const [width,height]of [[1366,768],[640,720]]){
        await page.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
        const metrics=await page.evaluate(`(()=>{const p=document.querySelector('#panel-tools .panel-content');return{width:p.clientWidth,scroll:p.scrollWidth}})()`);
        assert.ok(metrics.scroll<=metrics.width+1,JSON.stringify({width,metrics}));
    }
    await page.call('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});
    if(process.env.VTT_WORLD_SCULPT_VIEW==='1'){
        await page.evaluate("E.selectWorldEditorTool('select');UI.collapseMapToolsPanel();sceneModule.controls.target.set(32,1,15);sceneModule.camera.position.set(42,13,29);sceneModule.controls.update()");await pause(3200);
        for(const angle of [0,1]){
            if(angle)await page.evaluate('sceneModule.camera.position.set(22,10,27);sceneModule.controls.update()');
            await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:8,y:8,button:'none',buttons:0});
            await pause(250);console.log('WORLD_SCULPT_VIEW '+(await page.call('Page.captureScreenshot',{format:'jpeg',quality:65})).data);
        }
    }
    await page.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});await page.until('window.toggleEditMode&&window.isGM','reload');await page.evaluate(`(async()=>{window.sceneModule=await import('/static/js/lobby3d.js')})()`);await page.until('sceneModule.chunksMap.size===4','reloaded chunks');
    assert.deepEqual(await data(),final);
    console.log('WORLD SCULPT PASS: shapes, two chunks, single transaction, history, peer, conflicts, reload');
};
