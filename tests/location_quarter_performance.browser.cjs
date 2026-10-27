// Read-only benchmark of saved Trava3 location 24, using real GPU Chrome.
// Runs without vsync/FPS limit. VTT_PERF_COMPARE=1 selects comparable camera views.
// VTT_PERF_SOURCE can supply an earlier locationScene.js for before/after runs.
// VTT_PERF_SNAPSHOT freezes one server response for comparisons during editing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');

async function connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0;
    const waiting = new Map();
    const events = new Map();
    const networkEvents = [];
    socket.onclose = () => {
        for (const callback of waiting.values()) callback({ closed: true, result: {} });
        waiting.clear();
    };
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if(message.method==='Fetch.requestPaused'){
            const p=message.params,name=new URL(p.request.url).pathname.split('/').pop(),dir=process.env.VTT_WATER_BASELINE_DIR;
            const file=dir&&path.join(dir,name);
            (file&&fs.existsSync(file)?call('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/javascript'}],body:fs.readFileSync(file).toString('base64')}):call('Fetch.continueRequest',{requestId:p.requestId})).catch(console.error);
        }
        if (message.method) events.set(message.method, message.params);
        if (process.env.VTT_NETWORK === '1' && /^(Network\.webSocket|Runtime\.exceptionThrown|Log\.entryAdded)/.test(message.method || '')) networkEvents.push(message);
        if (message.method === 'Runtime.exceptionThrown') console.error('Browser exception:', JSON.stringify(message.params.exceptionDetails));
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            console.error('Browser console:', message.params.args.map(arg => arg.description || arg.value).join(' '));
        }
        if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') console.error('Browser log:', message.params.entry.url, message.params.entry.text);
        if (message.id) { waiting.get(message.id)?.(message); waiting.delete(message.id); }
    };
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Timed out: ${method}`)); }, process.env.VTT_WATER_FINAL==='1'||process.env.VTT_WATER_GEOMETRY==='1'||process.env.VTT_SECONDARY_TOOLS==='1'||process.env.VTT_ROAD_TERRAIN==='1'||process.env.VTT_BRIDGE_BANK==='1'?90000:30000);
        waiting.set(id, message => {
            clearTimeout(timer);
            if (message.closed && method !== 'Browser.close') reject(new Error(`Browser connection closed: ${method}`));
            else message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
        });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
        const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const until = async (expression, label) => {
        for (let i = 0; i < 120; i++) {
            if (await evaluate(expression)) return;
            await pause(250);
        }
        console.error(await evaluate(`JSON.stringify({url:location.href,gm:window.isGM,token:Boolean(localStorage.getItem('access_token')),body:document.body.innerText.slice(0,500)})`));
        throw new Error(`Timed out: ${label}`);
    };
    if (process.env.VTT_NETWORK === '1') await call('Network.enable');
    return { call, evaluate, until, events, networkEvents, close: () => socket.close() };
}

(async()=>{
 const {spawnSync}=require('node:child_process'),python=path.join(root,'.venv/Scripts/python.exe');
 const auth=spawnSync(python,['-c',`import json
from app import create_app
from app.models import Lobby,Location
from flask_jwt_extended import create_access_token
with create_app('development').app_context():
 l=Lobby.query.get(19)
 loc=Location.query.get(24)
 print(json.dumps(dict(token=create_access_token(identity=str(l.gm_id)),user=l.gm_id,count=len(loc.objects))))
`],{cwd:root,encoding:'utf8',windowsHide:true});
 if(auth.status)throw Error(auth.stderr);
 const data=JSON.parse(auth.stdout.trim()),base='http://127.0.0.1:5049';
 const server=spawn(python,['-u','-c',`from app.config import DevelopmentConfig
DevelopmentConfig.SOCKETIO_ASYNC_MODE='threading'
from app import create_app,socketio
app=create_app('development')
socketio.run(app,host='127.0.0.1',port=5049,debug=False,use_reloader=False,allow_unsafe_werkzeug=True)
`],{cwd:root,windowsHide:true,stdio:'ignore'});
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'vtt-pripyat-perf-'));
 const override=fs.mkdtempSync(path.join(os.tmpdir(),'vtt-perf-source-'));
 let source=fs.readFileSync(path.join(root,'app/static/js/locationScene.js'),'utf8');
 if(process.env.VTT_PERF_SOURCE)source=fs.readFileSync(process.env.VTT_PERF_SOURCE,'utf8');
 fs.writeFileSync(path.join(override,'locationScene.js'),source+`
window.__quarterPerf={get scene(){return scene},get renderer(){return renderer},get sun(){return locationDirectionalLight},get grass(){return grassDetailGroup},get roots(){return locationObjectMeshes},get roofs(){return roofMeshes},stats:locationBuildingProfileStats};
const originalRoofUpdate=updateRoofVisibility;
updateRoofVisibility=function(...args){const start=performance.now();const value=originalRoofUpdate(...args);if(window.__perfActive)window.__perfRoofs.push(performance.now()-start);return value};
`);
 process.env.VTT_WATER_BASELINE_DIR=override;
 let browser,page;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)break;}catch{}await pause(100);}
  const snapshotFile=process.env.VTT_PERF_SNAPSHOT;
  const snapshot=snapshotFile&&fs.existsSync(snapshotFile)?JSON.parse(fs.readFileSync(snapshotFile,'utf8')):
      await(await fetch(base+'/lobbies/19/locations/24',{headers:{Authorization:'Bearer '+data.token}})).json();
  assert.ok(Array.isArray(snapshot.objects));data.count=snapshot.objects.length;
  if(snapshotFile&&!fs.existsSync(snapshotFile))fs.writeFileSync(snapshotFile,JSON.stringify(snapshot));
  browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--no-first-run','--ignore-certificate-errors','--disable-frame-rate-limit','--disable-gpu-vsync','--window-size=1440,900','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=+fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{}await pause(100);}
  if(!port)throw Error('Chrome unavailable');
  const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
  page=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await page.call('Page.enable');await page.call('Runtime.enable');await page.call('Log.enable');
  await page.call('Fetch.enable',{patterns:[{urlPattern:'*/static/js/locationScene.js',requestStage:'Request'}]});
  await page.call('Page.navigate',{url:base});await page.until(`location.origin===${JSON.stringify(base)}`,'origin');
  await page.evaluate(`localStorage.setItem('access_token',${JSON.stringify(data.token)});localStorage.setItem('user_id','${data.user}');true`);
  await page.call('Page.navigate',{url:base+'/lobbies/19/page'});
  await page.until('window.enterLocation&&window.socket?.connected&&window.isGM','game startup');
  await page.evaluate(`window.__quarterSnapshot=${JSON.stringify(snapshot)};true`);
  await page.evaluate(`(async()=>{window.L=await import('/static/js/locationScene.js');const {Server}=await import('/static/js/api.js');
      const original=Server.getLocationDetail;Server.getLocationDetail=async(lobby,id)=>id===24?structuredClone(__quarterSnapshot):original.call(Server,lobby,id);
      await enterLocation(24);socket.disconnect();L.loadLocation(structuredClone(__quarterSnapshot));return true})()`);
  await page.until(`window.locationControls&&__quarterPerf.roots.length===${data.count}`,'quarter render');
  console.log('GPU',await page.evaluate(`(()=>{const gl=__quarterPerf.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return gl.getParameter(ext?.UNMASKED_RENDERER_WEBGL||gl.RENDERER)})()`));
  await page.evaluate(`(()=>{const p=__quarterPerf,r=p.renderer,render=r.render.bind(r);window.__perfRender=[];window.__perfRoofs=[];window.__perfCalls=[];window.__perfTriangles=[];
      r.render=function(...args){const start=performance.now();const value=render(...args);if(window.__perfActive){__perfRender.push(performance.now()-start);__perfCalls.push(r.info.render.calls);__perfTriangles.push(r.info.render.triangles);}return value};
      document.querySelector('#panel-tools:not(.collapsed) .toggle-btn')?.click();document.querySelector('#panel-characters:not(.collapsed) .toggle-btn')?.click();return true})()`);
  const results=[];
  const phases=process.env.VTT_PERF_COMPARE==='1'?['overview','near','motion']:['overview','no-grass','no-shadows','no-buildings','near','motion'];
  for(const phase of phases){
   await page.evaluate(`(()=>{const p=__quarterPerf;window.__perfSaved=p.roots.map(m=>[m,m.visible]);window.__perfGrass=p.grass?.visible;
    const near=${phase==='near'},x=near?29:35,z=near?43:32,h=near?18:75;
    locationControls.target.set(x,1,z);locationControls.object.position.set(x+h*.45,h,z+h*.7);locationControls.update();
    if(${phase==='no-grass'}&&p.grass)p.grass.visible=false;
    if(${phase==='no-shadows'})p.renderer.shadowMap.enabled=false;
    if(${phase==='no-buildings'})p.roots.forEach(m=>m.visible=false);
    return true})()`);
   await pause(1500);
   if(phase==='overview'){
    const screenshot=path.join(os.tmpdir(),'vtt-pripyat-perf-'+(process.env.VTT_PERF_LABEL||'baseline')+'-overview.png');
    fs.writeFileSync(screenshot,Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
   }
   const result=await page.evaluate(`new Promise(resolve=>{window.__perfRender=[];window.__perfRoofs=[];window.__perfCalls=[];window.__perfTriangles=[];window.__perfActive=true;
    const values=[],start=performance.now();let previous=start;
    const step=now=>{values.push(now-previous);previous=now;
      if(${phase==='motion'}){const x=35+Math.sin((now-start)*.001)*3;locationControls.target.x=x;locationControls.object.position.x=x+75*.45;}
      if(now-start<3500){requestAnimationFrame(step);return;}
      window.__perfActive=false;const mean=a=>a.reduce((s,n)=>s+n,0)/Math.max(1,a.length),p95=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length*.95)];
      resolve({phase:${JSON.stringify(phase)},fps:1000/mean(values.slice(1)),frameMs:mean(values.slice(1)),p95Ms:p95(values.slice(1)),renderMs:mean(__perfRender),roofsMs:mean(__perfRoofs),calls:Math.round(mean(__perfCalls)),triangles:Math.round(mean(__perfTriangles)),stats:__quarterPerf.stats()});};requestAnimationFrame(step)})`);
   results.push(result);console.log('PERF',JSON.stringify(result));
   await page.evaluate(`(()=>{const p=__quarterPerf;if(p.grass)p.grass.visible=window.__perfGrass;p.renderer.shadowMap.enabled=true;p.renderer.shadowMap.needsUpdate=true;window.__perfSaved.forEach(([m,v])=>m.visible=v);return true})()`);
  }
  const filename=path.join(os.tmpdir(),'vtt-pripyat-perf-'+(process.env.VTT_PERF_LABEL||'baseline')+'.json');fs.writeFileSync(filename,JSON.stringify(results,null,2));console.log('RESULT',filename);
  const shadowCheck=await page.evaluate(`(async()=>{const p=__quarterPerf,r=p.renderer;
    const wait=()=>new Promise(resolve=>setTimeout(resolve,150));await wait();
    const hash=()=>{const target=p.sun.shadow.map;if(!target)throw Error('No sun shadow map');const pixels=new Uint8Array(target.width*target.height*4);r.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);let h=2166136261;for(const n of pixels)h=Math.imul(h^n,16777619);return h>>>0};
    const before=hash(),tower=p.roots.find(m=>m.userData.locationObject.type==='household_power_tower');if(!tower)throw Error('Missing tower');
    const x=tower.position.x;tower.position.x+=4;await wait();const moved=hash();tower.position.x=x;await wait();const restored=hash();
    const level=L.getLocationViewLevel();
    document.getElementById('location-roof-btn').click();await wait();const cutaway=hash();
    document.getElementById('location-roof-btn').click();L.setLocationViewLevel(1);await wait();const upper=hash();
    L.setLocationViewLevel(level);await wait();const floorRestored=hash();
    return{before,moved,restored,cutaway,upper,floorRestored};})()`);
  assert.notEqual(shadowCheck.before,shadowCheck.moved,'moving an object must refresh the real sun shadow map');
  assert.equal(shadowCheck.before,shadowCheck.restored,'restoring the object must restore its shadow');console.log('SHADOW GPU PASS',shadowCheck);
  assert.equal(shadowCheck.before,shadowCheck.cutaway,'hiding roofs must retain physical shadows');
  assert.equal(shadowCheck.before,shadowCheck.upper,'switching the viewed floor must retain physical shadows');
  assert.equal(shadowCheck.before,shadowCheck.floorRestored);
  const screenshot=path.join(os.tmpdir(),'vtt-pripyat-perf-'+(process.env.VTT_PERF_LABEL||'baseline')+'.png');fs.writeFileSync(screenshot,Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }finally{if(page){await page.call('Browser.close').catch(()=>{});page.close();}browser?.kill();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});

