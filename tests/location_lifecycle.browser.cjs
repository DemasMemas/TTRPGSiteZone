// Run through VTT_FURNITURE=1 VTT_BLD_TRANSITIONS=30 in the shared browser harness.
const assert=require('node:assert/strict');
module.exports=async({page,peer,request,token,lobby})=>{
    const diagnostic=process.env.VTT_BLD_LIFECYCLE_DIAGNOSTIC==='1';
    const count=Number(process.env.VTT_BLD_TRANSITIONS||30);
    assert.ok(Number.isInteger(count)&&count>=4);
    const locations=[];
    for(const p of [page,peer])await p.until("socket.io.engine.transport.name==='websocket'",'lifecycle uses WebSocket transport');
    for(let i=0;i<2;i++)locations.push(await request(`/lobbies/${lobby.id}/locations`,{
        name:`Lifecycle ${i}`,world_tile_x:20+i,world_tile_z:20,grid_width:8,grid_height:8,
        tiles_data:Array.from({length:8},()=>Array.from({length:8},()=>({terrain:'bare_dirt',height:1,objects:[]})))
    },token));
    const snapshot=async p=>{
        await p.call('HeapProfiler.collectGarbage');
        const heap=await p.call('Runtime.getHeapUsage'),dom=await p.call('Memory.getDOMCounters');
        const result=await p.call('Runtime.evaluate',{objectGroup:'lifecycle-listeners',includeCommandLineAPI:true,returnByValue:true,expression:`(()=>{
            const listeners={};for(const [target,name] of [[window,'window'],[document,'document'],[document.querySelector('#location-canvas canvas'),'canvas']]){
                if(!target)continue;for(const [type,entries] of Object.entries(getEventListeners(target)))for(const entry of entries){
                    const key=name+':'+type+':'+entry.useCapture+':'+entry.listener.toString();listeners[key]=(listeners[key]||0)+1;
                }
            }
            return {listeners,sockets:Object.fromEntries(Object.entries(socket._callbacks).map(([key,value])=>[key,value.length]))};
        })()`});
        await p.call('Runtime.releaseObjectGroup',{objectGroup:'lifecycle-listeners'});
        assert.equal(result.exceptionDetails,undefined);
        return {...result.result.value,usedBytes:heap.usedSize,...dom};
    };
    const baselines=[{},{}],samples=[];
    for(let cycle=0;cycle<count;cycle++){
        const loc=locations[cycle%2];
        for(const [client,p] of [page,peer].entries()){
            await p.call('Page.bringToFront');
            await p.evaluate(`(async()=>{if(isLocationActive)exitLocation();furnitureJoined=null;await enterLocation(${loc.id});return true})()`);
            await p.until(`furnitureJoined?.location_id===${loc.id}&&L.getCurrentLocationId()===${loc.id}`,'lifecycle joined current room');
            await p.evaluate('L.setLocationEditMode(true);selectLocationEditorTool("assets");true');
            if(cycle>=2){
                await p.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
                await p.evaluate('furnitureEvents.length=0;performance.clearMeasures();performance.clearResourceTimings();true');
                const active=await snapshot(p);
                const dispatched=await p.call('Runtime.evaluate',{includeCommandLineAPI:true,returnByValue:true,expression:`(()=>{
                    const entries=(getEventListeners(window).pointermove||[]).filter(e=>
                        ['onPointerMoveProfiled','onPointerMoveWithDrag'].includes(e.listener.name));
                    const counts={};const wrapped=entries.map(e=>({e,fn:event=>{counts[e.listener.name]=(counts[e.listener.name]||0)+1;e.listener.call(window,event)}}));
                    try{for(const {e,fn} of wrapped){window.removeEventListener('pointermove',e.listener,e.useCapture);window.addEventListener('pointermove',fn,e.useCapture)}
                        window.dispatchEvent(new PointerEvent('pointermove',{clientX:0,clientY:0,buttons:0}));
                    }finally{for(const {e,fn} of wrapped){window.removeEventListener('pointermove',fn,e.useCapture);window.addEventListener('pointermove',e.listener,e.useCapture)}}
                    return counts;
                })()`});
                assert.equal(dispatched.exceptionDetails,undefined);
                if(!diagnostic)assert.deepEqual(dispatched.result.value,{onPointerMoveProfiled:1,onPointerMoveWithDrag:1},'one pointer event invokes each editor handler once');
                await p.evaluate(`window.retiredLocationRefs=[new WeakRef(furnitureRender.s),new WeakRef(locationControls.object),new WeakRef(document.querySelector('#location-canvas canvas'))];exitLocation();window.furnitureRender=null;true`);
                // Context loss is delivered asynchronously by the browser.
                await new Promise(resolve=>setTimeout(resolve,80));
                const exited=await snapshot(p);
                const retained=await p.evaluate("retiredLocationRefs.map((ref,i)=>ref.deref()===undefined?null:['scene','camera','canvas'][i]).filter(Boolean)");
                if(!diagnostic)assert.deepEqual(retained,[],'exited scene, camera and canvas are collectible');
                if(cycle===2)baselines[client]={active,exited};
                else for(const [state,value] of Object.entries({active,exited})){
                    const initial=baselines[client][state];
                    const changes=Object.entries(value.listeners).filter(([key,n])=>n!==(initial.listeners[key]||0)).map(([key,n])=>({key,n,initial:initial.listeners[key]||0}));
                    if(changes.length||cycle===count-1)console.log('LIFECYCLE LISTENER CHANGES',JSON.stringify({client,state,changes}));
                    if(!diagnostic){
                        assert.deepEqual(value.listeners,initial.listeners,`${state}: listener registrations stay constant`);
                        assert.deepEqual(value.sockets,initial.sockets,'socket subscriptions stay constant');
                        assert.ok(value.usedBytes-initial.usedBytes<8*1024*1024,'retained heap growth stays below 8 MiB');
                    }
                }
                if(cycle===2||cycle===9||cycle===19||cycle===count-1)samples.push({cycle:cycle+1,client,active:{...active,listeners:undefined,sockets:undefined},exited:{...exited,listeners:undefined,sockets:undefined}});
            }
        }
    }
    for(const p of [page,peer])await p.evaluate('if(isLocationActive)exitLocation();true');
    console.log('LOCATION LIFECYCLE PASS',JSON.stringify({transitions:count,diagnostic,samples}));
};
