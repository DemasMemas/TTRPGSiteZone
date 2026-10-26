const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports=async({page,request,token,lobby,base,connect,debugPort})=>{
    const dropping=process.env.VTT_DROP_DOWN==='1';
    const out=path.resolve(dropping?'docs/asset-previews/drop-down':'docs/asset-previews/vertical-access');fs.mkdirSync(out,{recursive:true});
    const api=`/lobbies/${lobby.id}`;
    const tiles=Array.from({length:18},()=>Array.from({length:18},()=>({terrain:'bare_dirt',height:1,objects:[]})));
    const loc=await request(`${api}/locations`,{name:'Ladders and hatches',world_tile_x:12,world_tile_z:12,grid_width:18,grid_height:18,tiles_data:tiles},token);
    const add=async(type,x,z,level,w,d,h,extra={})=>request(`${api}/locations/${loc.id}/objects`,{
        name:type,type,tile_x:x,tile_y:z,properties:{building_id:'vertical',level,
            dimensions:{width:w,depth:d,height:h},...extra}},token);
    for(const level of [-1,0,1]){
        await add('floor',8,8,level,10,10,.12,{roof_enabled:false,color:'#776d5d'});
        for(const z of [3,13])await add('wall',8,z,level,10,.2,2.4,{color:'#80786c'});
        for(const x of [3,13])await add('wall',x,8,level,10,.2,2.4,{rotation:Math.PI/2,color:'#80786c'});
    }
    const lower=await add('ladder',6,7,-1,.9,.9,2.4,{color:'#806347'});
    const upper=await add('ladder',10,7,0,.9,.9,2.4,{color:'#806347'});
    const wooden=await add('hatch',6,7,0,1,1,.08,{color:'#806347',is_open:false});
    const bunker=await add('hatch',10,7,1,1,1,.12,{color:'#58604d',visual_asset:'bunker_hatch',is_open:false});
    await page.evaluate(`window.T=threeModule;window.W=sceneModule;const before=T.Scene.prototype.add;
        T.Scene.prototype.add=function(...roots){for(const root of roots)root.traverse(m=>{if(!m.isMesh)return;
            const old=m.onBeforeRender;m.onBeforeRender=function(r,s,c,...args){old.call(this,r,s,c,...args);
                if(window.isLocationActive&&r!==W.renderer)window.localRender={renderer:r,scene:s,camera:c}}});return before.apply(this,roots)};
        window.enterLocation(${loc.id})`);
    await page.until('window.isLocationActive&&!!window.localRender','vertical location');
    await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');window.look=(x,y,z,tx,ty,tz)=>{
        locationControls.target.set(tx,ty,tz);locationControls.object.position.set(x,y,z);locationControls.update();locationControls.object.updateMatrixWorld(true)};
        L.setLocationEditMode(false);look(13,9,15,8.5,1,8.5);
        document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()})()`);
    const aim=(x,y,z)=>page.evaluate(`(()=>{const p=new T.Vector3(${x},${y},${z}).project(localRender.camera),r=localRender.renderer.domElement.getBoundingClientRect();
        return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}})()`);
    const right=async p=>{await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
        for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'right',buttons:type==='mousePressed'?2:0,clickCount:1,...p});await pause(350);};
    const shot=async(name,delay=600)=>{await pause(delay);fs.writeFileSync(path.join(out,name+'.png'),Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
    const actor=await request(`${api}/characters`,{name:'Climber',data:dropping?{skills:{physical:{agility:{base:30,bonus:0}}}}:{}},token);
    await request(`${api}/locations/${loc.id}/spawn_character`,{character_id:actor.id,tile_x:6,tile_y:6},token);
    await page.until(`localRender.scene.children.some(r=>r.userData.characterId===${actor.id})`,'climber model');
    await page.evaluate(`document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();window.currentLocationCharacterId=${actor.id};window.moves=[];window.rejects=[];
        socket.on('character_moved',d=>moves.push(d));socket.on('movement_rejected',d=>rejects.push(d));true`);
    const peerTarget=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===peerTarget.targetId).webSocketDebuggerUrl);
    try{
        await peer.call('Page.bringToFront');
        await peer.until(`Boolean(window.enterLocation&&window.socket?.connected)&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'peer ready');
        await peer.evaluate(`(async()=>{window.peerMoves=[];socket.on('character_moved',d=>peerMoves.push(d));
            const T=await import('three'),old=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){window.peerScene=this;return old.apply(this,roots)};
            await window.enterLocation(${loc.id})})()`);
        await peer.until(`window.isLocationActive&&peerScene.children.some(r=>r.userData.characterId===${actor.id})`,'peer models');
        await page.call('Page.bringToFront');
        const emit=async(x,y,level)=>page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:${x},y:${y},floor_level:${level}});true`);
        const reject=async(x,y,level)=>{const before=await page.evaluate('rejects.length');await emit(x,y,level);await page.until(`rejects.length>${before}`,'closed hatch blocks vertical movement');};
        const finish=async(level,x,y)=>{
            await page.until(`moves.at(-1)?.floor_level===${level}&&moves.at(-1).x===${x}&&moves.at(-1).y===${y}`,'server movement');
            const update=await page.evaluate('moves.at(-1)');
            await pause((update.path?.length||1)*180+350);
            for(const [client,scene] of [[page,'localRender.scene'],[peer,'peerScene']])await client.until(`(()=>{const m=${scene}.children.find(r=>r.userData.characterId===${actor.id});return Math.abs(m?.position.y-(${update.height}))<.001})()`,'physical height on both clients');
        };
        await reject(6,7,-1);
        await pause(5100);await shot('wooden-closed');
        // Open through the ordinary object's context action, with the selected actor.
        await right(await aim(6.5,1.035,7.5));
        await page.until(`Array.from(document.querySelectorAll('button')).some(b=>b.getClientRects().length&&b.textContent==='Открыть люк')`,'wooden hatch action');
        await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&b.textContent==='Открыть люк').click()`);
        await peer.until(`peerScene.children.some(r=>r.userData.locationObjectId===${wooden.id}&&r.userData.locationObject.properties.is_open)`,'peer receives open hatch');
        await page.evaluate('L.setLocationViewLevel(-1);look(15,7,17,7,-.7,8)');
        // The same movement action drives the vertical animation; no teleport API.
        assert.equal(await page.evaluate(`L.useLocationVerticalAccess(${lower.id},'down',${actor.id})`),true);
        await page.until('moves.at(-1)?.floor_level===-1','descent event');
        await pause(600);await shot('ladder-descent',0);await finish(-1,6,7);
        await shot('basement-ladder');
        assert.equal(await page.evaluate(`L.useLocationVerticalAccess(${lower.id},'up',${actor.id})`),true);await finish(0,6,7);
        await emit(10,7,0);await finish(0,10,7);await reject(10,7,1);
        await page.evaluate('L.setLocationViewLevel(1);look(16,14,18,9,3.4,8)');await pause(5100);await shot('bunker-closed');
        await right(await aim(10.5,3.435,7.5));
        await page.until(`Array.from(document.querySelectorAll('button')).some(b=>b.getClientRects().length&&b.textContent==='Открыть люк')`,'bunker hatch action');
        await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&b.textContent==='Открыть люк').click()`);
        await peer.until(`peerScene.children.some(r=>r.userData.locationObjectId===${bunker.id}&&r.userData.locationObject.properties.is_open)`,'peer receives bunker state');
        assert.equal(await page.evaluate(`L.useLocationVerticalAccess(${upper.id},'up',${actor.id})`),true);await finish(1,10,7);await shot('bunker-open');
        if(dropping){
            // Remove the ladder: ordinary movement must not become a downward action.
            for(const id of [lower.id,upper.id]){
                const r=await fetch(`${base}${api}/locations/objects/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${token}`}});assert.equal(r.status,204);
            }
            await emit(9,7,1);await finish(1,9,7);
            await request(`${api}/locations/objects/${bunker.id}`,{properties:{is_open:false}},token,'PATCH');
            const rejected=await page.evaluate('rejects.length');
            await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:10,y:7,special_action:'drop_down',object_id:${bunker.id}});true`);
            await page.until(`rejects.length>${rejected}`,'closed hatch blocks explicit drop');
            await request(`${api}/locations/objects/${bunker.id}`,{properties:{is_open:true}},token,'PATCH');
            await reject(10,7,0);
            assert.equal(await page.evaluate('moves.at(-1).floor_level'),1,'approaching an opening does not drop the character');
            await pause(5100);
            const dropThrough=async(id,x,upper)=>{
                await right(await aim(x+.5,1+upper*2.4+.038,8.055));
                await page.until(`Array.from(document.querySelectorAll('button')).some(b=>b.getClientRects().length&&b.textContent==='\u0421\u043f\u0440\u044b\u0433\u043d\u0443\u0442\u044c \u0432\u043d\u0438\u0437')`,'explicit jump action');
                await shot(upper===1?'hatch-drop-action':'opening-drop-action');
                await page.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.getClientRects().length&&b.textContent==='\u0421\u043f\u0440\u044b\u0433\u043d\u0443\u0442\u044c \u0432\u043d\u0438\u0437').click()`);
                await page.until(`moves.at(-1)?.floor_level===${upper-1}&&!!moves.at(-1).fall`,'fall movement event');
                const fall=await page.evaluate('moves.at(-1).fall');assert.ok(Math.abs(fall.height-2.4)<.001);
                await peer.until(`peerMoves.some(d=>d.character_id===${actor.id}&&d.floor_level===${upper-1}&&Math.abs(d.fall?.height-2.4)<.001)`,'peer receives fall result');
                await page.evaluate(`L.setLocationViewLevel(${upper-1});look(15,${upper===1?9:7},17,8.5,${1+(upper-1)*2.4},8.5)`);
                await pause(450);await shot(upper===1?'hatch-fall':'opening-fall',0);
                await finish(upper-1,x,7);await shot(upper===1?'hatch-landing':'opening-landing');
            };
            await dropThrough(bunker.id,10,1);
            // Place a lidless opening through the ordinary construction tool on level zero.
            await page.evaluate(`L.setLocationEditMode(true);window.selectLocationEditorTool('assets');
                window.dispatchEvent(new CustomEvent('location-editor-active-building',{detail:{buildingId:'vertical',level:0}}));
                L.setLocationAssetPreset('floor_opening');look(13,9,15,8.5,1,8.5);
                document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click()`);
            await pause(800);const target=await aim(8.5,1.035,7.5);
            await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await pause(300);
            for(const type of ['mousePressed','mouseReleased'])await page.call('Input.dispatchMouseEvent',{type,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1,...target});
            await peer.until(`peerScene.children.some(r=>r.userData.locationObject?.type==='floor_opening')`,'peer receives constructed floor opening');
            await page.evaluate('L.clearLocationAssetPreset();L.setLocationEditMode(false)');
            await emit(9,7,0);await finish(0,9,7);
            const detail=await request(`${api}/locations/${loc.id}`,null,token,'GET');
            const opening=detail.objects.find(o=>o.type==='floor_opening');assert.equal(opening.properties.level,0);
            await dropThrough(opening.id,8,0);
            const beforeUp=await page.evaluate('rejects.length');await emit(8,7,0);
            await page.until(`rejects.length>${beforeUp}`,'ascending without ladder is blocked');
        }
        const data=await request(`${api}/locations/${loc.id}`,null,token,'GET');assert.deepEqual(data.tiles_data,tiles);
        assert.ok(data.objects.filter(o=>o.type==='hatch').every(o=>o.properties.is_open));
        assert.equal(await page.evaluate('localRender.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length'),0);
        await page.call('Page.reload');
        await page.until(`!window.L&&Boolean(window.enterLocation)&&window.socket?.connected&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'world after reload');
        await page.evaluate(`(async()=>{const T=await import('three'),old=T.Scene.prototype.add;
            T.Scene.prototype.add=function(...roots){window.restoredScene=this;return old.apply(this,roots)};
            await window.enterLocation(${loc.id});window.L=await import('/static/js/locationScene.js');L.setLocationViewLevel(${dropping?-1:1})})()`);
        await page.until(`window.isLocationActive&&restoredScene.children.some(r=>r.userData.characterId===${actor.id}&&Math.abs(r.position.y-(${dropping?-1.365:3.435}))<.001)`,'restored character floor and height');
        assert.equal(await page.evaluate(`restoredScene.children.filter(r=>r.userData.locationObject?.type==='hatch'&&r.userData.locationObject.properties.is_open).length`),2);
        fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({closedHatchesBlock:true,woodenOpensByAction:true,bunkerOpensByAction:true,
            sameXYVerticalMovement:true,explicitDropWithoutLadder:dropping,lidlessOpening:dropping,reload:true,twoClientPhysicalHeights:true,twoClientHatchState:true,terrainUnchanged:true,shaderErrors:0},null,2));
        console.log(dropping?'DROP DOWN PASS':'VERTICAL ACCESS PASS');
    }catch(error){await shot('failure',0);throw error;}finally{peer.close();await page.call('Target.closeTarget',{targetId:peerTarget.targetId});}
};
