import * as THREE from 'three';
import { scene, renderer, worldPointOnTerrain, getTileHeightAt } from './lobby3d.js';
import { openCreateMarkerModal } from './markers.js';
import { isTypingTarget } from './cameraPan.js';
import { showNotification } from './utils.js';

export function mapDistance(from, to) {
    return Math.hypot(to.x - from.x, to.z - from.z);
}

export function diceCount(value) {
    return Math.max(1, Math.min(100, Math.floor(Number(value)) || 1));
}

export function initCommonMapTools(socket) {
    const panel = document.getElementById('panel-common-tools');
    if (!panel || panel.dataset.initialized === 'true') return;
    panel.dataset.initialized = 'true';
    const output = document.getElementById('common-map-result');
    const dice = document.getElementById('common-dice-form');
    const count = document.getElementById('common-dice-count');
    let mode = null, start = null, line = null, frame = null, lastPointer = null;
    let suppressClickUntil = 0;
    let consumedPointer = null;
    const pings = new Map();
    const measurements=new Map();
    let sharedMeasure=null, measureTimer=null, pendingMeasure=null, lastMeasureAt=-Infinity;
    const sendMeasure=payload=>{
        if(!socket.connected)return;
        socket.emit('map_measure',payload,result=>{if(result&&!result.ok)showNotification(result.error,'error');});
    };
    const publishMeasure=(from,to,final)=>{
        sharedMeasure={from:{x:from.x,y:from.y,z:from.z},to:{x:to.x,y:to.y,z:to.z},final};
        pendingMeasure=sharedMeasure;
        if(final){clearTimeout(measureTimer);measureTimer=null;lastMeasureAt=performance.now();sendMeasure(pendingMeasure);pendingMeasure=null;}
        else if(measureTimer===null)measureTimer=setTimeout(()=>{
            measureTimer=null;lastMeasureAt=performance.now();if(pendingMeasure)sendMeasure(pendingMeasure);pendingMeasure=null;
        },Math.max(0,100-(performance.now()-lastMeasureAt)));
    };
    const disposeMeasure=mesh=>{
        scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();
        for(const child of mesh.children){child.material.map?.dispose();child.material.dispose();}
    };
    const sync = () => {
        panel.querySelectorAll('[data-common-map-tool]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.commonMapTool === mode));
        });
    };
    const cancel = () => {
        mode = null; start = null;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        if (line) { disposeMeasure(line); line = null; }
        clearTimeout(measureTimer);measureTimer=null;pendingMeasure=null;
        if(sharedMeasure)sendMeasure({clear:true});sharedMeasure=null;
        dice.hidden = true;
        output.textContent = ''; sync();
    };
    window.cancelCommonMapTool = cancel;
    const available = () => !window.isLocationActive && mode;
    const makeMeasure = (color='#f1d878') => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
            const mesh = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, fog: false }));
            mesh.frustumCulled = false; mesh.renderOrder = 1000; mesh.userData.commonMapMeasure = true;
            const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=48;
            const texture=new THREE.CanvasTexture(labelCanvas);
            const label=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,fog:false,sizeAttenuation:false}));
            label.scale.set(.12,.023,1);label.renderOrder=1001;mesh.add(label);scene.add(mesh);return mesh;
    };
    const updateMeasure=(mesh,from,point)=>{
        const positions = mesh.geometry.getAttribute('position');
        positions.setXYZ(0, from.x, from.y + 0.15, from.z);
        positions.setXYZ(1, point.x, point.y + 0.15, point.z); positions.needsUpdate = true;
        const distance=mapDistance(from,point).toFixed(2),label=mesh.children[0],canvas=label.material.map.image,ctx=canvas.getContext('2d');
        if(mesh.userData.distance!==distance){ctx.clearRect(0,0,256,48);ctx.fillStyle='#151b16';ctx.fillRect(0,0,256,48);ctx.fillStyle='#f1d878';ctx.font='bold 26px sans-serif';ctx.textAlign='center';ctx.fillText(distance+' кл.',128,33);label.material.map.needsUpdate=true;mesh.userData.distance=distance;}
        label.position.set((from.x+point.x)/2,(from.y+point.y)/2+.35,(from.z+point.z)/2);
    };
    const drawMeasure = (point,final=false) => {
        if(!line)line=makeMeasure();
        updateMeasure(line,start,point);publishMeasure(start,point,final);
        output.textContent = `${mapDistance(start, point).toFixed(2)} кл. по прямой`;
    };
    panel.addEventListener('click', event => {
        const button = event.target.closest('[data-common-map-tool]');
        if (!button) return;
        const next = button.dataset.commonMapTool;
        const previous = mode;
        cancel();
        if (previous === next) return;
        window.clearDirectWorldObjectSelection?.();
        window.cancelWorldTravelSelection?.();
        mode = next; sync();
        if (next === 'dice') { dice.hidden = false; return; }
        output.textContent = next === 'measure' ? 'Две точки — расстояние. Следующий клик — новое измерение. ПКМ/Esc — выход.' : 'Укажите клетку на карте. ПКМ/Esc — выход.';
    });
    count.addEventListener('change', () => { count.value = diceCount(count.value); });
    dice.addEventListener('click', event => {
        const adjust = event.target.closest('[data-dice-count]');
        if (adjust) { count.value = diceCount(diceCount(count.value) + Number(adjust.dataset.diceCount)); return; }
        const button = event.target.closest('[data-dice-sides]');
        if (!button) return;
        count.value = diceCount(count.value);
        const expression = `${count.value}d${button.dataset.diceSides}`;
        const chat = document.getElementById('panel-chat');
        if (chat.hidden) document.getElementById('chat-toggle').click();
        if (chat.classList.contains('collapsed')) chat.querySelector('.toggle-btn').click();
        socket.emit('send_message', { token: localStorage.getItem('access_token'), lobby_id: window.currentLobbyId, message: `/roll ${expression}` });
    });
    const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener('pointerdown', event => {
        if (!available() || mode === 'dice' || event.target !== renderer.domElement || event.button!==0) return;
        consume(event); consumedPointer = event.pointerId; suppressClickUntil = performance.now() + 500;
        const point = worldPointOnTerrain(event.clientX, event.clientY);
        if (!point) return;
        if (mode === 'measure') {
            if (!start) { start = point.clone(); drawMeasure(point); }
            else { drawMeasure(point,true); start = null; }
        } else if (mode === 'marker') {
            openCreateMarkerModal({ x: point.x, y: point.y + 0.8, z: point.z });
        } else if (mode === 'ping') {
            const payload = { lobby_id: window.currentLobbyId, tile_x: Math.floor(point.x), tile_y: Math.floor(point.z), user_id: Number(localStorage.getItem('user_id')) };
            showPing(payload);
            const timeout = setTimeout(() => showNotification('Сервер не ответил на пинг. Перезапустите Flask и обновите страницу.', 'error'), 4000);
            socket.emit('map_ping', { tile_x: payload.tile_x, tile_y: payload.tile_y }, result => {
                clearTimeout(timeout);
                if (result && !result.ok) showNotification(result.error, 'error');
            });
        }
    }, { capture: true });
    window.addEventListener('pointermove', event => {
        if (!available() || !start || event.target !== renderer.domElement || (event.buttons&2)) return;
        lastPointer = { x: event.clientX, y: event.clientY };
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
            frame = null;
            if (!start || !available()) return;
            const point = worldPointOnTerrain(lastPointer.x, lastPointer.y);
            if (point) drawMeasure(point);
        });
    }, { capture: true });
    window.addEventListener('pointerup', event => {
        if (event.pointerId !== consumedPointer) return;
        consumedPointer = null; suppressClickUntil = performance.now() + 350; consume(event);
    }, { capture: true });
    window.addEventListener('pointercancel', () => { consumedPointer = null; cancel(); }, { capture: true });
    window.addEventListener('blur', () => { consumedPointer = null; cancel(); });
    for (const type of ['click', 'dblclick']) {
        window.addEventListener(type, event => {
            if (event.target === renderer.domElement && performance.now() < suppressClickUntil) consume(event);
        }, { capture: true });
    }
    window.addEventListener('contextmenu', event => {
        if (event.target === renderer.domElement && performance.now() < suppressClickUntil) consume(event);
    }, { capture: true });
    window.addEventListener('secondaryclick',event=>{
        if(available()&&mode!=='dice'&&event.target===renderer.domElement){consume(event);cancel();}
    },{capture:true});
    window.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || isTypingTarget(event.target) || (!mode && !line)) return;
        consume(event); cancel();
    }, { capture: true });
    // A screen-sized sprite stays visible from the normal world overview camera,
    // independently of terrain fog, perspective and zoom.
    const showPing = payload => {
        if (Number(payload.lobby_id) !== Number(window.currentLobbyId)) return;
        const old = pings.get(payload.user_id);
        if (old) { clearTimeout(old.timer); scene.remove(old.mesh); old.mesh.material.map.dispose(); old.mesh.material.dispose(); }
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
        const context = canvas.getContext('2d');
        context.strokeStyle = '#171b10'; context.lineWidth = 14;
        context.beginPath(); context.arc(64, 64, 39, 0, Math.PI * 2); context.stroke();
        context.strokeStyle = '#ffe27c'; context.lineWidth = 6; context.stroke();
        context.beginPath(); context.moveTo(64, 6); context.lineTo(64, 42); context.moveTo(64, 86); context.lineTo(64, 122);
        context.moveTo(6, 64); context.lineTo(42, 64); context.moveTo(86, 64); context.lineTo(122, 64); context.stroke();
        const texture = new THREE.CanvasTexture(canvas);
        const mesh = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false }));
        mesh.scale.set(0.055, 0.055, 1);
        mesh.position.set(payload.tile_x + 0.5, getTileHeightAt(payload.tile_x + 0.5, payload.tile_y + 0.5) + 0.16, payload.tile_y + 0.5);
        mesh.renderOrder = 1001; mesh.userData.commonMapPing = payload; scene.add(mesh);
        const timer = setTimeout(() => { scene.remove(mesh); mesh.material.map.dispose(); mesh.material.dispose(); pings.delete(payload.user_id); }, 3500);
        pings.set(payload.user_id, { mesh, timer });
    };
    socket.on('map_ping', showPing);
    const showSharedMeasure=payload=>{
        if(Number(payload.lobby_id)!==Number(window.currentLobbyId)||payload.id===socket.id)return;
        let mesh=measurements.get(payload.id);
        if(payload.clear){if(mesh){disposeMeasure(mesh);measurements.delete(payload.id);}return;}
        if(!mesh){mesh=makeMeasure('#8cdef0');measurements.set(payload.id,mesh);}
        mesh.userData.sharedMapMeasure=payload;updateMeasure(mesh,payload.from,payload.to);
    };
    socket.on('map_measure',showSharedMeasure);
    socket.on('map_measure_snapshot',items=>{for(const item of items)showSharedMeasure(item);});
    socket.on('disconnect',()=>{for(const mesh of measurements.values())disposeMeasure(mesh);measurements.clear();});
    socket.on('authenticated',()=>{if(sharedMeasure)sendMeasure(sharedMeasure);});
}
