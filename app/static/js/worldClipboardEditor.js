import * as T from 'three';
import { scene, renderer, controls, chunksMap, worldPointOnTerrain, worldPointOnObjectPlane,
    createWorldObjectPreviewMesh, getObjectHeightOffset, sampleWorldGroundHeight } from './lobby3d.js';
import { captureWorldObjects, captureWorldArea, planWorldPaste, MAX_WORLD_CLIPBOARD_CELLS } from './worldClipboard.js';
import { fenceMatrixElements } from './worldFenceLine.js';
import { createTerrainHeightSampler } from './locationTerrain.js';
import { isTypingTarget } from './cameraPan.js';
import { showNotification } from './utils.js';

let bindings;
export function initWorldClipboardEditor(state,selectTool) {
    bindings?.abort();bindings=new AbortController();const signal=bindings.signal;
    let clipboard=null,area=null,areaMode=false,drawing=null,pasting=false,plan=null,ghosts=null,outline=null,pointer=null,frame=null,lastPose=null,error='';
    const canvas=renderer.domElement,status=document.getElementById('world-clipboard-status'),button=document.getElementById('world-select-area');
    const available=()=>state.isGM&&state.editMode&&!window.isLocationActive;
    const getTile=(x,z)=>x<0||z<0?null:chunksMap.get(`${Math.floor(x/32)},${Math.floor(z/32)}`)?.tilesData[z%32]?.[x%32];
    // Dispose only owned buffers/materials, never the source asset geometry.
    function disposeGhosts(){if(!ghosts)return;scene.remove(ghosts);for(const m of ghosts.children){if(m.isInstancedMesh)m.dispose?.();if(m.userData.privateGeometry)m.geometry.dispose();m.material.dispose();}ghosts=null;}
    function clearOutline(){if(outline){scene.remove(outline);outline.geometry.dispose();outline.material.dispose();outline=null;}}
    function showBounds(bounds,color=0x8be2cb){
        clearOutline();
        const points=[];const a=bounds.minX,b=bounds.maxX+1,c=bounds.minZ,d=bounds.maxZ+1;
        const add=(x,z)=>points.push(new T.Vector3(x,sampleWorldGroundHeight(Math.max(0,Math.min(window.MAP_CHUNKS_WIDTH*32-.00001,x)),Math.max(0,Math.min(window.MAP_CHUNKS_HEIGHT*32-.00001,z)))+.06,z));
        for(let i=0;i<=32;i++)add(a+(b-a)*i/32,c);for(let i=1;i<=32;i++)add(b,c+(d-c)*i/32);
        for(let i=1;i<=32;i++)add(b-(b-a)*i/32,d);for(let i=1;i<=32;i++)add(a,d-(d-c)*i/32);
        outline=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.9}));
        outline.renderOrder=110;outline.raycast=()=>{};outline.userData.worldClipboardPreview=true;scene.add(outline);
    }
    function cancel(){pasting=false;areaMode=false;plan=null;lastPose=null;error='';
        if(drawing){controls.enabled=drawing.controls;const id=drawing.id;drawing=null;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
        if(frame!==null)cancelAnimationFrame(frame);frame=null;disposeGhosts();clearOutline();area=null;button.setAttribute('aria-pressed','false');status.textContent='';window.refreshWorldEditorHistoryControls?.();}
    window.cancelWorldClipboard=cancel;
    window.isWorldClipboardActive=()=>pasting||areaMode||Boolean(drawing);
    window.getWorldClipboardState=()=>({kind:clipboard?.kind,count:clipboard?.kind==='area'?clipboard.cells.length:clipboard?.entries.length||0,preview:pasting,valid:Boolean(plan),area:area?{...area}:null,error});
    function pointAt(){if(!pointer)return null;return worldPointOnTerrain(pointer.x,pointer.y);}
    function renderPlan(next){
        disposeGhosts();ghosts=new T.Group();ghosts.userData.worldClipboardPreview=true;
        const proposed=new Map(next.cells.map(c=>[`${c.x},${c.z}`,c.state])),samplers=new Map();
        const sample=(x,z)=>{
            if(clipboard.kind!=='area')return sampleWorldGroundHeight(x,z);
            const tx=Math.floor(x),tz=Math.floor(z),key=`${tx},${tz}`;
            if(!samplers.has(key)){
                const tiles=Array.from({length:3},(_,b)=>Array.from({length:3},(_,a)=>proposed.get(`${tx+a-1},${tz+b-1}`)||getTile(tx+a-1,tz+b-1)||null));
                samplers.set(key,createTerrainHeightSampler(tiles,1,1));
            }
            return samplers.get(key)(1+x-tx,1+z-tz);
        };
        if(clipboard.kind==='area'){
            const mesh=new T.InstancedMesh(new T.BoxGeometry(1,.025,1),new T.MeshBasicMaterial({color:0x77d7c1,transparent:true,opacity:.25,depthWrite:false}),next.cells.length);
            const m=new T.Matrix4();next.cells.forEach((c,i)=>{m.makeTranslation(c.x+.5,Number(c.state.height??1)+.03,c.z+.5);mesh.setMatrixAt(i,m);});
            mesh.userData.privateGeometry=true;mesh.raycast=()=>{};ghosts.add(mesh);
        }
        const groups=new Map();for(const item of next.objects){const key=`${item.object.type}:${item.object.anomalyType||''}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
        const dummy=new T.Object3D();
        for(const items of groups.values()){
            const first=items[0],o=first.object;
            const template=createWorldObjectPreviewMesh({chunkX:Math.floor(first.x/32),chunkY:Math.floor(first.z/32),tileX:first.x%32,tileY:first.z%32,tileData:first.tile},
                {...o,offsetX:o.x||0,offsetZ:o.z||0,scale:o.scale??1,rotation:o.rotation??0,color:'#ffffff'});
            const batch=new T.InstancedMesh(template.geometry,template.material,items.length);batch.userData.privateGeometry=template.userData.privateGeometry;
            batch.raycast=()=>{};batch.frustumCulled=false;
            items.forEach((item,i)=>{const object=item.object,s=object.scale??1,x=item.x+.5+(object.x||0),z=item.z+.5+(object.z||0);
                if(object.type==='fence')dummy.matrix.fromArray(fenceMatrixElements(object,x,z,sample));
                else{dummy.position.set(x,object.type==='road'&&Number.isFinite(object.bridge_height)?object.bridge_height:Number(item.tile.height??1)+getObjectHeightOffset(object.type,object.anomalyType)*s,z);dummy.rotation.set(0,T.MathUtils.degToRad(object.rotation||0),0);dummy.scale.setScalar(s);dummy.updateMatrix();}
                batch.setMatrixAt(i,dummy.matrix);batch.setColorAt(i,new T.Color(object.color||'#88cdbb'));
            });ghosts.add(batch);
        }
        scene.add(ghosts);
    }
    function updatePaste(force=false){
        if(!pasting)return;if(!available()){cancel();return;}
        const p=pointAt();if(!p){plan=null;lastPose=null;disposeGhosts();clearOutline();error='Наведите указатель на загруженную карту.';status.textContent=error;return;}
        const pose=clipboard.kind==='area'?`${Math.floor(p.x)},${Math.floor(p.z)}`:`${p.x.toFixed(3)},${p.z.toFixed(3)}`;
        if(!force&&pose===lastPose)return;lastPose=pose;
        try{plan=planWorldPaste(clipboard,p,{getTile,width:window.MAP_CHUNKS_WIDTH*32,height:window.MAP_CHUNKS_HEIGHT*32});error='';renderPlan(plan);
            const xs=plan.cells.map(c=>c.x),zs=plan.cells.map(c=>c.z);showBounds({minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)});
            status.textContent=clipboard.kind==='area'?`Участок ${clipboard.width}×${clipboard.height}: клик заменит поверхность и объекты. Esc — отмена.`:`Объектов: ${clipboard.entries.length}. Клик — вставить, Esc — отмена.`;
        }catch(e){plan=null;error=e.message;disposeGhosts();status.textContent=error;showBounds({minX:Math.floor(p.x),maxX:Math.floor(p.x)+(clipboard.width||1)-1,minZ:Math.floor(p.z),maxZ:Math.floor(p.z)+(clipboard.height||1)-1},0xff6655);}
    }
    function schedule(){if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;updatePaste();});}
    function capture(){
        if(window.getWorldEditorHistoryState().busy)throw Error('Дождитесь сохранения текущего действия.');
        clipboard=area?captureWorldArea(area,getTile):captureWorldObjects(window.getDirectWorldObjectSelection?.()||[],getTile);
        status.textContent=clipboard.kind==='area'?`Скопирован участок ${clipboard.width}×${clipboard.height}. Ctrl+V — предпросмотр.`:`Скопировано объектов: ${clipboard.entries.length}. Ctrl+V — предпросмотр.`;
    }
    function paste(){
        if(!clipboard)throw Error('Сначала скопируйте объекты или выделенный участок.');
        if(window.getWorldEditorHistoryState().busy)throw Error('Дождитесь сохранения текущего действия.');
        cancel();selectTool('select');pasting=true;
        window.refreshWorldEditorHistoryControls?.();
        if(!pointer){const r=canvas.getBoundingClientRect();pointer={x:r.left+r.width/2,y:r.top+r.height/2};}
        updatePaste(true);
    }
    async function commit(){
        // Keep the destination snapshots shown by the preview. A foreign edit
        // at the same pointer position must conflict rather than be overwritten.
        updatePaste();if(!plan){showNotification(error,'error');return;}
        const next=plan;
        try{await window.commitWorldEditorCommand(next.command);cancel();window.selectDirectWorldObjects?.(next.references);}
        catch(e){showNotification(e.message,'error');updatePaste(true);}
    }
    button.onclick=()=>{const active=areaMode||drawing;cancel();if(active)return;selectTool('select');window.clearDirectWorldObjectSelection?.();areaMode=true;window.refreshWorldEditorHistoryControls?.();button.setAttribute('aria-pressed','true');status.textContent=`Потяните ЛКМ по участку (до ${MAX_WORLD_CLIPBOARD_CELLS} клеток), затем Ctrl+C.`;};
    window.handleWorldClipboardPointerDown=event=>{
        if(!available()||event.target!==canvas)return false;
        if(event.button===2&&(pasting||drawing||areaMode)){event.preventDefault();event.stopImmediatePropagation();cancel();return true;}
        if(event.button!==0)return false;
        pointer={x:event.clientX,y:event.clientY};
        if(pasting){event.preventDefault();event.stopImmediatePropagation();void commit();return true;}
        if(areaMode){
            const p=pointAt();if(!p)return true;
            const x=Math.floor(p.x),z=Math.floor(p.z);if(!getTile(x,z))return true;
            event.preventDefault();event.stopImmediatePropagation();drawing={x,z,id:event.pointerId,plane:p.y,controls:controls.enabled};controls.enabled=false;canvas.setPointerCapture(event.pointerId);area={minX:x,maxX:x,minZ:z,maxZ:z};showBounds(area);return true;
        }
        if(area){area=null;clearOutline();status.textContent='';}
        return false;
    };
    window.addEventListener('pointermove',event=>{
        if(event.target===canvas||drawing)pointer={x:event.clientX,y:event.clientY};
        if(drawing){const p=worldPointOnObjectPlane(event.clientX,event.clientY,drawing.plane);if(!p)return;
            const x=Math.max(0,Math.min(window.MAP_CHUNKS_WIDTH*32-1,Math.floor(p.x))),z=Math.max(0,Math.min(window.MAP_CHUNKS_HEIGHT*32-1,Math.floor(p.z)));
            area={minX:Math.min(drawing.x,x),maxX:Math.max(drawing.x,x),minZ:Math.min(drawing.z,z),maxZ:Math.max(drawing.z,z)};showBounds(area);
            status.textContent=`Участок ${area.maxX-area.minX+1}×${area.maxZ-area.minZ+1}. Ctrl+C — копировать поверхность и объекты.`;
        }else if(pasting&&event.target===canvas)schedule();
    },{signal,capture:true});
    window.addEventListener('pointerup',event=>{if(!drawing||event.pointerId!==drawing.id)return;controls.enabled=drawing.controls;const id=drawing.id;drawing=null;areaMode=false;button.setAttribute('aria-pressed','false');if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);window.refreshWorldEditorHistoryControls?.();},{signal,capture:true});
    window.addEventListener('blur',()=>{if(pasting||drawing||areaMode)cancel();},{signal});
    canvas.addEventListener('pointercancel',cancel,{signal});
    canvas.addEventListener('lostpointercapture',()=>{if(drawing)cancel();},{signal});
    window.addEventListener('keydown',event=>{
        if(!available()||isTypingTarget(event.target)||event.target.closest?.('.modal'))return;
        if(event.code==='Escape'&&(pasting||drawing||areaMode||area)){event.preventDefault();event.stopImmediatePropagation();cancel();return;}
        if(!event.ctrlKey||event.altKey||event.metaKey||!['KeyC','KeyV'].includes(event.code))return;
        event.preventDefault();event.stopImmediatePropagation();if(event.repeat)return;
        try{if(event.code==='KeyC')capture();else paste();}catch(e){showNotification(e.message,'error');}
    },{signal,capture:true});
    window.updateWorldClipboard=()=>{if((pasting||drawing||areaMode)&&!available())cancel();};
}
