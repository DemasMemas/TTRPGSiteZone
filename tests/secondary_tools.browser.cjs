const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/secondary-tools');fs.mkdirSync(output,{recursive:true});
    const prepare=async client=>{
        await client.evaluate(`(async()=>{window.sceneModule=await import('/static/js/lobby3d.js');window.threeModule=await import('three');
            sceneModule.controls.target.set(32,1,12);sceneModule.camera.position.set(35,10,23);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld(true);
            for(const id of ['panel-common-tools','panel-tools']){const p=document.getElementById(id);Object.assign(p.style,{left:'15px',top:'auto',bottom:'15px',right:'auto',transform:'none',width:'300px'});}
        })()`);
    };
    const point=async(client,x,z,y=1,local=false)=>client.evaluate(`(()=>{const c=${local?'window.locationControls.object':'sceneModule.camera'},canvas=${local?"document.querySelector('#location-container canvas')":"sceneModule.renderer.domElement"};
        c.updateMatrixWorld(true);const p=new threeModule.Vector3(${x},${y},${z}).project(c),r=canvas.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const move=async(client,p)=>{await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});};
    const click=async(client,p)=>{await move(client,p);await client.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...p});await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...p});};
    const right=async(client,p,drag=false,long=false)=>{
        await move(client,p);const timestamp=Date.now()/1000;
        await client.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',buttons:2,...p,timestamp});
        if(drag)await client.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'right',buttons:2,x:p.x+65,y:p.y+12,timestamp:timestamp+.2});
        if(long)await pause(450);
        await client.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',buttons:0,x:p.x+(drag?65:0),y:p.y+(drag?12:0),timestamp:timestamp+(long?.5:.05)});
    };
    const shot=async(client,name)=>fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await client.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    console.log('Secondary tools: world placement');await prepare(page);
    await page.evaluate(`(async()=>{window.editor=await import('/static/js/mapEdit.js');if(document.getElementById('gm-only-controls').style.display==='none')window.toggleEditMode();
        editor.selectWorldEditorTool('objects');editor.selectWorldObject('house')})()`);
    let p=await point(page,30,14);
    const camera=await page.evaluate('sceneModule.camera.position.toArray()');
    await right(page,p,true);
    assert.notDeepEqual(await page.evaluate('sceneModule.camera.position.toArray()'),camera);
    assert.equal(await page.evaluate("document.querySelector('[data-world-object=house]').getAttribute('aria-pressed')"),'true');
    await right(page,p,false,true);
    assert.equal(await page.evaluate("document.querySelector('[data-world-object=house]').getAttribute('aria-pressed')"),'true');
    await right(page,p);assert.equal(await page.evaluate("document.querySelector('[data-world-object=house]').getAttribute('aria-pressed')"),'false');
    console.log('Secondary tools: world selection');await prepare(page);await page.evaluate("editor.selectWorldEditorTool('select')");
    await click(page,await point(page,32.1,10.1,1.5));
    await page.until('window.getDirectWorldObjectSelection().length===1','select house');
    await right(page,await point(page,30,14),true);
    assert.equal(await page.evaluate('window.getDirectWorldObjectSelection().length'),1);
    await right(page,await point(page,30,14));assert.equal(await page.evaluate('window.getDirectWorldObjectSelection().length'),0);
    // A real player in an isolated browser context sees and owns rulers too.
    console.log('Secondary tools: player connection');await request('/auth/register',{username:'secondary-player',email:'secondary@example.test',password:'browser-test-password'});
    const login=await request('/auth/login',{username:'secondary-player',password:'browser-test-password'});
    await request(`/lobbies/${lobby.id}/join`,{},login.access_token);
    const version=await(await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json(),protocol=await connect(version.webSocketDebuggerUrl);
    const ctx=await protocol.call('Target.createBrowserContext');
    const target=await protocol.call('Target.createTarget',{url:base,browserContextId:ctx.browserContextId});
    const pages=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json(),peer=await connect(pages.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    try{
        await peer.call('Runtime.enable');await peer.call('Page.enable');await peer.until(`location.origin===${JSON.stringify(base)}`,'player origin');
        await peer.call('Page.addScriptToEvaluateOnNewDocument',{source:"Object.defineProperty(window,'devicePixelRatio',{get:()=>.5})"});
        await peer.evaluate(`localStorage.setItem('access_token',${JSON.stringify(login.access_token)});localStorage.setItem('user_id',${JSON.stringify(String(login.user_id))})`);
        await peer.call('Page.navigate',{url:`${base}/lobbies/${lobby.id}/page`});
        await peer.call('Page.bringToFront');
        await peer.until("window.isGM===false&&document.getElementById('panel-common-tools').dataset.initialized==='true'&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'player startup');
        console.log('Secondary tools: player ready');await prepare(peer);
        for(const client of [page,peer]){
            console.log('Secondary tools: shared ruler',client===page?'GM':'player');
            await client.call('Page.bringToFront');await prepare(client);
            await client.evaluate("if(document.getElementById('panel-common-tools').hidden)document.getElementById('common-tools-toggle').click();document.querySelector('[data-common-map-tool=measure]').click()");
            const from=await point(client,28,14),to=await point(client,33,17);
            await click(client,from);await move(client,to);
            const other=client===page?peer:page;
            await other.until("sceneModule.scene.children.some(m=>m.userData.sharedMapMeasure&&!m.userData.sharedMapMeasure.final)",'shared live preview');
            await right(client,to,true);
            assert.equal(await client.evaluate("document.querySelector('[data-common-map-tool=measure]').getAttribute('aria-pressed')"),'true');
            // Camera moved: project the endpoint again before installing the ruler.
            await click(client,await point(client,33,17));
            await other.until("sceneModule.scene.children.some(m=>m.userData.sharedMapMeasure?.final&&m.children[0]?.isSprite)",'shared installed ruler with label');
            await shot(other,client===page?'player-sees-gm-ruler':'gm-sees-player-ruler');
            await right(client,await point(client,30,15));
            await other.until("!sceneModule.scene.children.some(m=>m.userData.sharedMapMeasure)",'short click clears remote ruler');
            await client.evaluate("document.querySelector('[data-common-map-tool=marker]').click()");
            await right(client,await point(client,30,15),true);
            assert.equal(await client.evaluate("document.querySelector('[data-common-map-tool=marker]').getAttribute('aria-pressed')"),'true');
            await right(client,await point(client,30,15));
            assert.equal(await client.evaluate("document.querySelector('[data-common-map-tool=marker]').getAttribute('aria-pressed')"),'false');
        }
        console.log('Secondary tools: local scene');await page.call('Page.bringToFront');
        const loc=await request(`/lobbies/${lobby.id}/locations`,{name:'Secondary click local test',world_tile_x:32,world_tile_z:12,grid_width:16,grid_height:16,
            tiles_data:Array.from({length:16},()=>Array.from({length:16},()=>({terrain:'concrete',height:1,objects:[]})))},token);
        await page.evaluate(`void window.enterLocation(${loc.id})`);await page.until('window.isLocationActive&&window.locationControls','local scene');
        await page.evaluate(`(async()=>{window.localScene=await import('/static/js/locationScene.js');localScene.setLocationEditMode(true);window.selectLocationEditorTool('decor')})()`);
        p=await point(page,8,8,1,true);const tool=await page.evaluate('window.locationEditorTool');
        await right(page,p,true);assert.equal(await page.evaluate('window.locationEditorTool'),tool);
        await right(page,p,false,true);assert.equal(await page.evaluate('window.locationEditorTool'),tool);
        await shot(page,'local-tool-after-camera-rotation');
        fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({worldPlacement:true,worldSelection:true,longHold:true,cameraActuallyRotated:true,gmAndPlayerMarker:true,gmAndPlayerRulerPreview:true,gmAndPlayerRulerFinal:true,remoteClear:true,localPlacementPreserved:true},null,2)+'\n');
        console.log('PASS: short vs held/dragged RMB; global selection and placement, both roles marker and shared ruler preview/final, local editor tool');
    }finally{peer.close();await protocol.call('Target.disposeBrowserContext',{browserContextId:ctx.browserContextId});protocol.close();}
};
