// VTT_NETWORK=1 [VTT_NETWORK_NORMAL=1] node tests/world_object_editor.browser.cjs
// Real game pages and TCP sockets. Polling cannot pass the WebSocket assertions.
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function closeProbe(base) {
    const net=require('node:net'),crypto=require('node:crypto'),url=new URL(base);
    return new Promise((resolve,reject)=>{
        const chunks=[],socket=net.connect(+url.port,url.hostname);
        const timer=setTimeout(()=>{socket.destroy();resolve(Buffer.concat(chunks).toString('latin1'))},2500);
        socket.on('error',reject);socket.on('data',b=>chunks.push(b));
        socket.on('connect',()=>socket.write(`GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\n\r\n`));
        let sent=false;
        socket.on('data',()=>{if(sent)return;sent=true;
            const frame=s=>Buffer.from([0x81,0x80|s.length,1,2,3,4,...Buffer.from(s).map((b,i)=>b^[1,2,3,4][i%4])]);
            setTimeout(()=>socket.write(frame('40')),100);
            setTimeout(()=>socket.write(frame('41')),300);
            setTimeout(()=>socket.write(frame('1')),400);
            setTimeout(()=>socket.write(Buffer.from([0x88,0x80,1,2,3,4])),600);
        });
        socket.on('end',()=>{clearTimeout(timer);resolve(Buffer.concat(chunks).toString('latin1'))});
    });
}
module.exports = async ({page, request, token, lobby, base, connect, debugPort}) => {
    console.log('NETWORK URL', base, 'LAUNCH', process.env.VTT_NETWORK_NORMAL === '1' ? 'run.py / development' : 'testing / ordinary server selection');
    const api = `/lobbies/${lobby.id}`;
    const transport = async client => {
        await client.until(`window.socket?.connected && socket.io.engine.transport.name === 'websocket'`, 'WebSocket required');
        const result = await client.evaluate(`new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(Error('ping timeout')),5000);
            socket.emit('network_ping',{},reply=>{clearTimeout(timer);resolve({browser:socket.io.engine.transport.name,server:reply.transport})})})`);
        assert.deepEqual(result, {browser:'websocket',server:'websocket'});
        return result;
    };
    await transport(page);
    const wire=await closeProbe(base);
    console.log('CLOSE PROBE',JSON.stringify({upgrade101:wire.startsWith('HTTP/1.1 101'),httpAfterUpgrade:wire.slice(wire.indexOf('\r\n\r\n')+4).match(/HTTP\/1\.1[^\r]+/g)}));
    assert.ok(wire.startsWith('HTTP/1.1 101'),'real HTTP upgrade');
    assert.doesNotMatch(wire.slice(wire.indexOf('\r\n\r\n')+4),/HTTP\/1\.1/,'no HTTP response inside WebSocket stream');
    if(process.env.VTT_NETWORK_PROBE_ONLY==='1')return;
    const handshakes = await page.evaluate(`(async()=>{
        const counts={upgrade:0,direct:0};
        for(const direct of [false,true])for(let i=0;i<12;i++)await new Promise((resolve,reject)=>{
            const s=io({forceNew:true,reconnection:false,...(direct?{transports:['websocket']}:{})});
            if(!direct&&s.io.engine.transport.name!=='polling')throw Error('upgrade test did not start with polling');
            let authenticated=false;
            const timer=setTimeout(()=>{s.disconnect();reject(Error('handshake timeout'))},8000);
            const done=()=>{if(!authenticated||s.io.engine.transport.name!=='websocket')return;
                clearTimeout(timer);counts[direct?'direct':'upgrade']++;s.disconnect();resolve()};
            s.on('connect',()=>{s.emit('authenticate',{token:localStorage.getItem('access_token'),lobby_id:${lobby.id}});done()});
            s.on('authenticated',()=>{authenticated=true;done()});
            s.io.engine.on('upgrade',done);
            s.io.engine.on('upgradeError',e=>{clearTimeout(timer);s.disconnect();reject(Error(String(e)))});
            s.on('connect_error',e=>{clearTimeout(timer);s.disconnect();reject(Error(String(e)))})
        });return counts})()`);
    console.log('HANDSHAKES', handshakes);
    assert.deepEqual(handshakes,{upgrade:12,direct:12});
    const tiles=Array.from({length:18},()=>Array.from({length:18},()=>({terrain:'bare_dirt',height:1,objects:[]})));
    const loc=await request(`${api}/locations`,{name:'Network transport audit',world_tile_x:12,world_tile_z:12,grid_width:18,grid_height:18,tiles_data:tiles},token);
    const add=(type,x,z,level,w,d,h,extra={})=>request(`${api}/locations/${loc.id}/objects`,{
        name:type,type,tile_x:x,tile_y:z,properties:{building_id:'network',level,dimensions:{width:w,depth:d,height:h},...extra}},token);
    for(const level of [-1,0,1])await add('floor',8,8,level,10,10,.12,{roof_enabled:false});
    const ladder=await add('ladder',6,7,-1,.9,.9,2.4);
    const hatch=await add('hatch',6,7,0,1,1,.08,{is_open:false});
    const actor=await request(`${api}/characters`,{name:'Network climber',data:{}},token);
    await request(`${api}/locations/${loc.id}/spawn_character`,{character_id:actor.id,tile_x:6,tile_y:6},token);
    const target=await page.call('Target.createTarget',{url:`${base}/lobbies/${lobby.id}/page`,background:true});
    const tabs=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const peer=await connect(tabs.find(t=>t.id===target.targetId).webSocketDebuggerUrl);
    const clients=[page,peer];
    try {
        for(const client of clients){
            await client.call('Page.bringToFront');
            await client.call('Runtime.enable');await client.call('Log.enable');
            await client.until(`Boolean(window.enterLocation&&window.socket?.connected)&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'game ready');
            await transport(client);
            await client.evaluate(`(async()=>{
                window.netEvents={};window.netDisconnects=[];
                for(const name of ['character_moved','movement_rejected','location_object_updated','location_tiles_updated','location_state','authenticated'])
                    socket.on(name,d=>(netEvents[name]??=[]).push(d));
                socket.on('disconnect',reason=>netDisconnects.push(reason));
                const T=await import('three'),old=T.Scene.prototype.add;
                T.Scene.prototype.add=function(...roots){window.netScene=this;return old.apply(this,roots)};
                window.netLocation=await import('/static/js/locationScene.js');
                await window.enterLocation(${loc.id});netLocation.setLocationEditMode(false);
            })()`);
            await client.until(`isLocationActive&&netScene.children.some(m=>m.userData.characterId===${actor.id})`,'rendered character');
        }
        const finish=async(x,y,level)=>{
            for(const client of clients)await client.until(`netEvents.character_moved?.at(-1)?.x===${x}&&netEvents.character_moved.at(-1).y===${y}&&netEvents.character_moved.at(-1).floor_level===${level}`,'movement delivery to both clients');
            const update=await page.evaluate('netEvents.character_moved.at(-1)');
            await pause((update.path?.length||1)*180+350);
            for(const client of clients)await client.until(`(()=>{const m=netScene.children.find(m=>m.userData.characterId===${actor.id});return Math.abs(m?.position.y-(${update.height}))<.001})()`,'rendered physical height');
        };
        const move=async(x,y,level)=>{
            await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:${x},y:${y},floor_level:${level}});true`);
            await finish(x,y,level);
        };
        await move(6,7,0);
        await page.evaluate(`socket.emit('move_in_location',{token:localStorage.getItem('access_token'),location_id:${loc.id},character_id:${actor.id},x:6,y:7,floor_level:-1});true`);
        await page.until('netEvents.movement_rejected?.length===1','closed hatch blocks descent');
        await request(`${api}/locations/objects/${hatch.id}`,{properties:{is_open:true}},token,'PATCH');
        for(const client of clients)await client.until(`netScene.children.some(m=>m.userData.locationObjectId===${hatch.id}&&m.userData.locationObject.properties.is_open)`,'open hatch on both clients');
        assert.equal(await page.evaluate(`netLocation.useLocationVerticalAccess(${ladder.id},'down',${actor.id})`),true);
        await finish(6,7,-1);
        assert.equal(await page.evaluate(`netLocation.useLocationVerticalAccess(${ladder.id},'up',${actor.id})`),true);
        await finish(6,7,0);
        await request(`${api}/locations/objects/${hatch.id}`,{properties:{color:'#cc8844'}},token,'PATCH');
        for(const client of clients)await client.until(`netScene.children.some(m=>m.userData.locationObjectId===${hatch.id}&&m.userData.locationObject.properties.color==='#cc8844')`,'object edit on both clients');
        await page.evaluate(`socket.emit('update_location_tiles',{token:localStorage.getItem('access_token'),location_id:${loc.id},updates:[{x:1,z:1,terrain:'sand',height:1.25}]});true`);
        await peer.until(`netEvents.location_tiles_updated?.some(d=>d.updates.some(t=>t.x===1&&t.z===1&&t.terrain==='sand'&&t.height===1.25))`,'socket terrain edit');
        tiles[2][1]={terrain:'sand',height:1.5,objects:[]};tiles[1][1]={terrain:'sand',height:1.25,objects:[]};
        await request(`${api}/locations/${loc.id}`,{tiles_data:tiles},token,'PUT');
        for(const client of clients)await client.until(`netEvents.location_tiles_updated?.some(d=>d.updates.some(t=>t.x===1&&t.z===2&&t.height===1.5))`,'REST terrain edit');
        const benchmark=await page.evaluate(`(async()=>{
            const result={};
            for(const name of ['websocket','polling']){
                const sockets=[0,1].map(()=>io({forceNew:true,transports:[name],upgrade:false,reconnection:false}));
                try{
                    await Promise.all(sockets.map(s=>new Promise((resolve,reject)=>{s.on('connect',()=>s.emit('authenticate',{token:localStorage.getItem('access_token'),lobby_id:${lobby.id}}));s.once('authenticated',resolve);s.once('connect_error',reject)})));
                    const rtt=[],delivery=[],received=[];
                    sockets[1].on('new_message',d=>received.push(d.message));
                    for(let i=0;i<30;i++){
                        let start=performance.now();
                        const reply=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('ping lost')),5000);sockets[0].emit('network_ping',{},d=>{clearTimeout(t);resolve(d)})});
                        if(reply.transport!==name)throw Error('server transport mismatch');rtt.push(performance.now()-start);
                        const message='net-audit-'+name+'-'+i;
                        await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('event lost')),5000);
                            const handler=d=>{if(d.message!==message)return;clearTimeout(t);sockets[1].off('new_message',handler);delivery.push(performance.now()-start);resolve()};
                            sockets[1].on('new_message',handler);start=performance.now();
                            sockets[0].emit('send_message',{token:localStorage.getItem('access_token'),lobby_id:${lobby.id},message})});
                    }
                    const stats=a=>({n:a.length,median_ms:+a.sort((a,b)=>a-b)[Math.floor(a.length/2)].toFixed(2),p95_ms:+a[Math.ceil(a.length*.95)-1].toFixed(2)});
                    const expected=Array.from({length:30},(_,i)=>'net-audit-'+name+'-'+i);
                    if(JSON.stringify(received)!==JSON.stringify(expected))throw Error('lost, duplicated or reordered events');
                    result[name]={rtt:stats(rtt),delivery:stats(delivery),ordered_events:received.length};
                }finally{sockets.forEach(s=>s.disconnect())}
            }return result
        })()`);
        console.log('LATENCY',JSON.stringify(benchmark));
        await peer.evaluate(`window.currentLocationCharacterId=${actor.id};window.netSavedCamera=locationControls.object.position.toArray();netLocation.setLocationViewLevel(-1);true`);
        await peer.evaluate(`socket.io.engine.close();true`);
        await peer.until('netEvents.authenticated?.length===1&&netEvents.location_state?.length>=2','automatic reconnect and location snapshot');
        await transport(peer);
        await peer.until(`netLocation.getLocationViewLevel()===-1&&currentLocationCharacterId===${actor.id}&&locationControls.object.position.toArray().every((v,i)=>Math.abs(v-netSavedCamera[i])<1e-6)`,'restore camera, floor and selected character');
        await move(7,7,0);
        const moves=await Promise.all(clients.map(c=>c.evaluate('netEvents.character_moved')));
        assert.equal(moves[0].length,4,'one event per successful movement');
        assert.deepEqual(moves[0],moves[1],'identical ordered movement events on both clients');
        await peer.evaluate('socket.disconnect();true');
        await request(`${api}/locations/objects/${hatch.id}`,{properties:{color:'#44aa66'}},token,'PATCH');
        await request(`${api}/chunks/0/0/tile/2/2`,{terrain:'sand',height:1.7},token,'PATCH');
        await peer.evaluate('socket.connect();true');
        await transport(peer);
        await peer.until(`netScene.children.some(m=>m.userData.locationObjectId===${hatch.id}&&m.userData.locationObject.properties.color==='#44aa66')`,'recover object edit missed while offline');
        await peer.evaluate(`(async()=>{window.netWorld=await import('/static/js/lobby3d.js');await window.exitLocation()})()`);
        await peer.until(`netWorld.chunksMap.get('0,0')?.tilesData[2][2].height===1.7`,'recover missed world terrain edit');
        await peer.evaluate('window.netReloadMarker=true');
        await peer.call('Page.reload',{ignoreCache:true});
        await peer.call('Page.bringToFront');
        await peer.until(`!window.netReloadMarker&&Boolean(window.enterLocation&&window.isGM&&window.socket?.connected)&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`,'repeat entry');
        await transport(peer);
        await peer.evaluate(`(async()=>{const T=await import('three'),old=T.Scene.prototype.add;T.Scene.prototype.add=function(...roots){window.netScene=this;return old.apply(this,roots)};await window.enterLocation(${loc.id})})()`);
        await peer.until(`isLocationActive&&netScene.children.some(m=>m.userData.characterId===${actor.id}&&Math.abs(m.position.y-1.035)<.001)&&netScene.children.some(m=>m.userData.locationObjectId===${hatch.id}&&m.userData.locationObject.properties.is_open&&m.userData.locationObject.properties.color==='#44aa66')`,'saved character and object state');
        for(const client of clients)await transport(client);
        const saved=await request(`${api}/locations/${loc.id}`,null,token,'GET');
        assert.equal(saved.tiles_data[1][1].height,1.25);
        assert.equal(saved.tiles_data[2][1].height,1.5);
        const errors=clients.flatMap(c=>c.networkEvents.filter(e=>e.method==='Network.webSocketFrameError'));
        assert.deepEqual(errors,[],'no WebSocket frame errors');
        assert.deepEqual(await page.evaluate('netDisconnects'),[],'primary game never disconnected');
        assert.deepEqual(clients.flatMap(c=>c.networkEvents.filter(e=>e.method==='Runtime.exceptionThrown')),[],'no browser exceptions');
        console.log('GAME NETWORK PASS',JSON.stringify({clients:2,handshakes,movement:true,floors:true,hatch:true,objectEdit:true,terrainEdit:true,reconnect:true,reentry:true,frameErrors:errors.length,transport:await transport(page)}));
    }finally{peer.close();await page.call('Target.closeTarget',{targetId:target.targetId})}
};
