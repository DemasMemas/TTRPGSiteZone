const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const output=path.resolve(__dirname,'../docs/material-previews/fence-line');fs.mkdirSync(output,{recursive:true});
    await page.evaluate(`(async()=>{
        window.editor=await import('/static/js/mapEdit.js');window.fenceMath=await import('/static/js/worldFenceLine.js');
        window.fencePackets=[];const send=window.fetch;window.fetch=function(url,options){if(String(url).includes('/chunks/batch'))fencePackets.push(JSON.parse(options.body));return send.apply(this,arguments)};
        if(document.getElementById('gm-only-controls').style.display==='none')window.toggleEditMode();
        editor.selectWorldEditorTool('objects');document.querySelector('[data-world-object="fence"]').click();
        const panel=document.getElementById('panel-tools');Object.assign(panel.style,{width:'320px',minWidth:'320px',maxWidth:'320px',left:'15px',bottom:'15px',top:'auto',right:'auto',transform:'none'});
        Object.assign(panel.querySelector('.panel-content').style,{maxHeight:'220px',overflow:'auto'});
        window.fenceCount=()=>[...sceneModule.chunksMap.values()].reduce((n,c)=>n+c.tilesData.flat().reduce((n,t)=>n+(t.objects||[]).filter(o=>o.type==='fence').length,0),0);
        window.fenceLook=(x,y,z,tx,ty,tz)=>{sceneModule.controls.target.set(tx,ty,tz);sceneModule.camera.position.set(x,y,z);sceneModule.controls.update();sceneModule.camera.updateMatrixWorld(true)};
        fenceLook(33,15,25,32,1,12);
    })()`);
    await page.until('sceneModule.getWorldFenceDiagnostics().geometryReady && sceneModule.getWorldFenceDiagnostics().textureReady','fence asset');
    const move=async(x,z,y=1)=>{
        const point=await page.evaluate(`(()=>{sceneModule.camera.updateMatrixWorld(true);const p=new threeModule.Vector3(${x},${y},${z}).project(sceneModule.camera),r=sceneModule.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await pause(350);return point;
    };
    const click=async(x,z,y=1)=>{
        const point=await move(x,z,y);
        await page.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});
        await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});await pause(300);
    };
    const screenshot=async name=>{
        if(name.includes('preview'))await page.evaluate("document.getElementById('world-fence-line-status').scrollIntoView({block:'nearest'})");
        await pause(500);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    };
    assert.equal(await page.evaluate('fenceCount()'),0);
    await click(29.5,12);
    await move(36.5,12);
    await page.until("sceneModule.scene.children.some(n=>n.userData.fenceLinePreview && n.visible && n.count===9)",'line preview with real pointer');
    assert.equal(await page.evaluate('fencePackets.length'),0);
    await screenshot('preview');
    await click(36.5,12);
    await page.until('fenceCount()===9 && fencePackets.length===1','one saved line');
    const first=await page.evaluate('fencePackets[0]');assert.ok(first.some(p=>p.chunk_x===0)&&first.some(p=>p.chunk_x===1));
    await move(36.5,16.5);await screenshot('corner-preview');
    await click(36.5,16.5);await page.until('fenceCount()>9 && fencePackets.length===2','continued corner');
    const total=await page.evaluate('fenceCount()');
    await page.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await page.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    assert.equal(await page.evaluate('sceneModule.scene.children.some(n=>n.userData.fenceLinePreview)'),false);
    await page.evaluate('fenceLook(40,7,23,33,1.1,13)');await screenshot('placed');
    // A fresh gesture cancelled with RMB performs no write and restores orbit controls.
    await click(29,17);await move(32,17);
    const p=await move(32,17);
    await page.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',buttons:2,...p});
    await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',buttons:0,...p});
    assert.equal(await page.evaluate('fencePackets.length'),2);assert.equal(await page.evaluate('sceneModule.controls.enabled'),true);
    assert.equal(await page.evaluate("sceneModule.scene.children.some(n=>n.userData.previewType==='fence'||n.userData.fenceLinePreview)"),false);
    if(process.env.VTT_FENCE_LINE_UI_ONLY==='1'){
        await page.evaluate("editor.selectWorldObject('tree')");
        assert.equal(await page.evaluate("getComputedStyle(document.getElementById('world-fence-options')).display"),'none');
        await page.evaluate("editor.selectWorldObject('fence');document.getElementById('world-fence-line-enabled').checked=false;document.getElementById('world-fence-line-enabled').dispatchEvent(new Event('change',{bubbles:true}));fenceLook(33,15,25,32,1,12)");
        assert.notEqual(await page.evaluate("getComputedStyle(document.getElementById('world-object-rotation-option')).display"),'none');
        await click(29,17);
        await page.until(`fenceCount()===${total+1}`,'single section mode');
        fs.writeFileSync(path.join(output,'ui-checks.json'),JSON.stringify({pointerLine:true,corner:true,escape:true,rightClick:true,noResidualPreview:true,contextualControls:true,singleSection:true},null,2)+'\n');
        console.log('PASS: fence line pointer UI, cancellation, single section and contextual controls');return;
    }
    // Prove the saved ID and transforms reload on both clients.
    const target=await(await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`${base}/lobbies/${lobby.id}/page`)}`,{method:'PUT'})).json();
    const peer=await connect(target.webSocketDebuggerUrl);
    try{
        await peer.call('Runtime.enable');await peer.call('Page.enable');await peer.until('window.isGM','peer');
        await peer.evaluate("(async()=>{window.peerWorld=await import('/static/js/lobby3d.js')})()");
        await peer.until(`peerWorld.chunksMap.size===2 && [...peerWorld.chunksMap.values()].reduce((n,c)=>n+c.tilesData.flat().reduce((n,t)=>n+(t.objects||[]).filter(o=>o.type==='fence').length,0),0)===${total}`,'peer saved line');
        await page.call('Page.bringToFront');
        // Connected selection reuses the existing atomic multi-object editor.
        await page.evaluate(`(()=>{editor.selectWorldEditorTool('select');const c=sceneModule.chunksMap.get('0,0');
            let reference;for(let y=0;y<32&&!reference;y++)for(let x=0;x<32&&!reference;x++){const index=(c.tilesData[y][x].objects||[]).findIndex(o=>o.type==='fence');if(index>=0)reference={chunkX:0,chunkY:0,tileX:x,tileY:y,index}}
            window.fenceFirst=reference;
        })()`);
        const pick=await page.evaluate(`(()=>{const r=fenceFirst,o=sceneModule.chunksMap.get('0,0').tilesData[r.tileY][r.tileX].objects[r.index];return {x:r.tileX+.5+o.x,z:r.tileY+.5+o.z}})()`);
        await click(pick.x,pick.z,1.25);
        await page.until('window.getDirectWorldObjectSelection().length===1','select actual instance');
        await page.evaluate("document.getElementById('world-selection-fence-run').click()");
        await page.until(`window.getDirectWorldObjectSelection().length===${total}`,'select connected section through corner and chunk');
        await page.evaluate("document.getElementById('world-selection-scale-number').value='1.1';document.getElementById('world-selection-scale-number').dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('world-selection-scale-number').dispatchEvent(new Event('change',{bubbles:true}))");
        await peer.until("[...peerWorld.chunksMap.values()].some(c=>c.tilesData.flat().some(t=>(t.objects||[]).some(o=>o.type==='fence'&&Math.abs(o.scale-1.1)<.0001)))",'peer group scale');
        await page.evaluate("document.getElementById('world-selection-delete').click()");
        await page.until('fenceCount()===0','whole connected line delete');
        await peer.until("[...peerWorld.chunksMap.values()].every(c=>c.tilesData.flat().every(t=>!(t.objects||[]).some(o=>o.type==='fence')))",'peer group delete');
    }finally{peer.close()}
    // Real height geometry, not a flat synthetic plane: install a gentle slope.
    const terrain=[];for(let z=22;z<=26;z++)for(let x=26;x<=40;x++)terrain.push({chunk_x:x>>5,chunk_y:0,tile_x:x%32,tile_y:z,updates:{height:1+(x-26)*.14}});
    await request(`/lobbies/${lobby.id}/chunks/batch`,terrain,token);
    await page.until("sceneModule.chunksMap.get('1,0').tilesData[24][4].height>2",'slope terrain sync');
    await page.evaluate("editor.selectWorldEditorTool('objects');editor.selectWorldObject('fence');fenceLook(35,7,34,32,2.2,24.5)");
    await click(28.5,24.5,1.28);await move(36.5,24.5,2.4);
    await page.until("sceneModule.scene.children.some(n=>n.userData.fenceLinePreview && n.visible && n.count>0)",'slope preview');
    await screenshot('slope-preview');
    await click(36.5,24.5,2.4);await page.until('fenceCount()>0','slope saved');
    await page.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await page.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await screenshot('slope');
    const slope=await page.evaluate(`(()=>{const e=sceneModule.chunksMap.get('0,0'),i=e.objectIndices.fences.findIndex(a=>a.length);const matrix=new threeModule.Matrix4();e.fences.getMatrixAt(e.objectIndices.fences[i][0],matrix);return {tile:i,matrix:matrix.toArray()}})()`);
    await request(`/lobbies/${lobby.id}/chunks/0/0/tile/${slope.tile%32}/${Math.floor(slope.tile/32)}`,{height:1.8},token,'PATCH');
    await page.until(`(()=>{const e=sceneModule.chunksMap.get('0,0'),m=new threeModule.Matrix4();e.fences.getMatrixAt(e.objectIndices.fences[${slope.tile}][0],m);return Math.abs(m.elements[13]-${slope.matrix[13]})>.01})()`,'fence follows edited height');
    await screenshot('height-edited');
    const beforeReload=await page.evaluate('fenceCount()');
    await page.call('Page.reload');await page.until("window.isGM && document.getElementById('scene-loading-screen').classList.contains('is-hidden')",'reload');
    await page.evaluate("(async()=>{window.sceneModule=await import('/static/js/lobby3d.js');window.editor=await import('/static/js/mapEdit.js');window.threeModule=await import('three')})()");
    await page.until(`sceneModule.chunksMap.size===2 && [...sceneModule.chunksMap.values()].reduce((n,c)=>n+c.tilesData.flat().reduce((n,t)=>n+(t.objects||[]).filter(o=>o.type==='fence').length,0),0)===${beforeReload}`,'reload saved slope fence');
    await page.until('sceneModule.getWorldTerrainMaterialDiagnostics().ready','production terrain resources');
    await page.evaluate('sceneModule.controls.target.set(32,1.5,12);sceneModule.camera.position.set(42,15,30);sceneModule.controls.update()');
    await pause(600);
    const stats=await page.evaluate(`(async()=>{
        const math=await import('/static/js/worldFenceLine.js');const start=performance.now();
        const plan=math.planFenceLine({start:{x:1,z:2},end:{x:63,z:2},settings:{scale:.2,color:'#ffffff'},width:64,height:32,getTile:()=>({terrain:'grass'}),sampleHeight:sceneModule.sampleWorldGroundHeight});
        const plannedMs=performance.now()-start,t0=performance.now();sceneModule.showFenceLinePreview(plan.sections);const previewMs=performance.now()-t0;
        sceneModule.renderer.render(sceneModule.scene,sceneModule.camera);
        const first=sceneModule.scene.children.find(n=>n.userData.fenceLinePreview),geometry=first.geometry,material=first.material;
        sceneModule.showFenceLinePreview(plan.sections.slice(0,-1));
        const second=sceneModule.scene.children.find(n=>n.userData.fenceLinePreview);
        const result={sections:plan.sections.length,plannedMs,previewMs,sharedGeometry:first.geometry===sceneModule.chunksMap.get('0,0').fences.geometry,reusedPreview:first===second&&geometry===second.geometry&&material===second.material,
            calls:sceneModule.renderer.info.render.calls,triangles:sceneModule.renderer.info.render.triangles,textures:sceneModule.renderer.info.memory.textures,asset:sceneModule.getWorldFenceDiagnostics(),shaderErrors:sceneModule.renderer.info.programs.filter(p=>p.diagnostics&&!p.diagnostics.runnable).length};
        window.fencePerfSections=plan.sections;sceneModule.removeFenceLinePreview();return result;
    })()`);
    await page.evaluate(`(()=>{
        const r=sceneModule.renderer,render=r.render.bind(r);r.render=()=>{};
        window.fenceMeasure=async visible=>{
            if(visible)sceneModule.showFenceLinePreview(fencePerfSections);else sceneModule.removeFenceLinePreview();
            const gl=r.getContext(),pixel=new Uint8Array(4),times=[];
            for(let n=0;n<6;n++){const t=performance.now();render(sceneModule.scene,sceneModule.camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(n>=2)times.push(performance.now()-t);await new Promise(resolve=>setTimeout(resolve,0))}
            times.sort((a,b)=>a-b);return {medianFrameMs:(times[1]+times[2])/2,calls:r.info.render.calls,triangles:r.info.render.triangles,textures:r.info.memory.textures};
        };
        window.fenceFinish=()=>{sceneModule.removeFenceLinePreview();r.render=render};
    })()`);
    stats.withoutPreview=await page.evaluate('fenceMeasure(false)');
    stats.withPreview=await page.evaluate('fenceMeasure(true)');
    await page.evaluate('fenceFinish()');
    assert.ok(stats.sharedGeometry&&stats.reusedPreview);assert.equal(stats.shaderErrors,0);
    stats.checks={pointerClicks:true,previewNoWrites:true,batchAcrossChunks:true,continuedCorner:true,escape:true,rightClick:true,peerSync:true,groupScale:true,groupDelete:true,heightEdit:true,reload:true};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(stats,null,2)+'\n');
    console.log('PASS: world fence line',JSON.stringify(stats));
};
