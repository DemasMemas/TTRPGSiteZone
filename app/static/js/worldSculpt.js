import { sculptHeightChanges } from './locationSculpt.js';
import { chunksMap, renderer, worldPointOnObjectPlane, updateTileInChunk, updateWorldSculptHighlight } from './lobby3d.js';
import { Server } from './api.js';
import { showNotification } from './utils.js';
import { isTypingTarget } from './cameraPan.js';
import { bindNumericInput } from './worldNumericInputs.js';

let bindings;
export function initWorldSculpt(lobbyId, state, selectTool) {
    bindings?.abort();
    bindings = new AbortController();
    const signal=bindings.signal;
    let stroke=null, saving=false, pointer=null;
    const history=window.worldEditorHistory;
    const getTile=(x,z)=>x<0||z<0?null:chunksMap.get(`${Math.floor(x/32)},${Math.floor(z/32)}`)?.tilesData[z%32]?.[x%32];
    const ref=(x,z)=>({chunk_x:Math.floor(x/32),chunk_y:Math.floor(z/32),tile_x:x%32,tile_y:z%32});
    const apply=(cell,height)=>updateTileInChunk(cell.chunk_x,cell.chunk_y,cell.tile_x,cell.tile_y,{height});
    const settings={strength:.5,softness:.7};
    const available=()=>state.isGM&&state.editMode&&!window.isLocationActive&&window.worldEditorTool==='sculpt';
    window.getWorldSculptState=()=>({active:Boolean(stroke),saving,...history.state(),cells:stroke?.cells.size||0});
    function tick(now=performance.now(),final=false){
        if(!stroke)return;
        if(!available()){window.cancelWorldBrushStroke?.();return;}
        const seconds=(now-stroke.time)/1000;
        if(!final&&seconds<1/30)return;
        stroke.time=now;
        const rect=renderer.domElement.getBoundingClientRect();
        const inside=pointer&&pointer.x>=rect.left&&pointer.x<=rect.right&&pointer.y>=rect.top&&pointer.y<=rect.bottom;
        const p=inside&&worldPointOnObjectPlane(pointer.x,pointer.y,stroke.plane);
        if(!p){stroke.previous=null;return;}
        const to={x:p.x,z:p.z},from=stroke.previous||to;stroke.previous=to;
        const radius=stroke.settings.radius,halo=radius+2;
        const minX=Math.max(0,Math.floor(Math.min(from.x,to.x)-halo)),minZ=Math.max(0,Math.floor(Math.min(from.z,to.z)-halo));
        const maxX=Math.min(window.MAP_CHUNKS_WIDTH*32-1,Math.ceil(Math.max(from.x,to.x)+halo));
        const maxZ=Math.min(window.MAP_CHUNKS_HEIGHT*32-1,Math.ceil(Math.max(from.z,to.z)+halo));
        if(maxX<minX||maxZ<minZ)return;
        const tiles=Array.from({length:maxZ-minZ+1},(_,dz)=>Array.from({length:maxX-minX+1},(_,dx)=>{
            const tile=getTile(minX+dx,minZ+dz);return tile?{terrain:tile.terrain,height:tile.height??1}:{terrain:'water',height:1};
        }));
        const steps=Math.max(1,Math.min(60,Math.ceil(seconds*60))),changed=new Map();
        for(let i=0;i<steps;i++){
            const a={x:from.x+(to.x-from.x)*i/steps-minX,z:from.z+(to.z-from.z)*i/steps-minZ};
            const b={x:from.x+(to.x-from.x)*(i+1)/steps-minX,z:from.z+(to.z-from.z)*(i+1)/steps-minZ};
            for(const cell of sculptHeightChanges(tiles,a,b,Math.max(0,seconds)/steps,stroke.settings)){
                const x=cell.x+minX,z=cell.z+minZ,key=`${x},${z}`,tile=getTile(x,z);
                if(!stroke.cells.has(key))stroke.cells.set(key,{...ref(x,z),before:tile.height??1,after:tile.height??1,terrain:tile.terrain});
                stroke.cells.get(key).after=cell.height;
                tiles[cell.z][cell.x].height=cell.height;
                changed.set(key,{...ref(x,z),height:cell.height});
            }
        }
        for(const cell of changed.values())apply(cell,cell.height);
        updateWorldSculptHighlight(to.x,to.z,radius);
        const tile=getTile(Math.floor(to.x),Math.floor(to.z)),info=document.getElementById('tile-info-content');
        if(tile&&info)info.innerHTML=`<b>(${Math.floor(to.x)}, ${Math.floor(to.z)})</b><br>Высота: ${Number(Number(tile.height).toFixed(3))}<br>Радиация: ${tile.radiation??0}`;
    }
    window.updateWorldSculpt=tick;
    window.beginWorldSculptStroke=(event,tile)=>{
        if(!available()||saving||history.state().busy||!tile)return false;
        const point=worldPointOnObjectPlane(event.clientX,event.clientY,tile.tileData.height??1);
        pointer={x:event.clientX,y:event.clientY};
        stroke={time:performance.now(),plane:tile.tileData.height??1,previous:point?{x:point.x,z:point.z}:null,cells:new Map(),settings:{...settings,mode:document.getElementById('world-sculpt-mode').value,radius:state.brushRadius,minHeight:.5,maxHeight:3}};
        if(!window.beginWorldEditorStroke('sculpt')){stroke=null;return false;}return true;
    };
    const packet=change=>change.cells.map(c=>({...ref(c.chunk_x*32+c.tile_x,c.chunk_y*32+c.tile_y),expected_height:c.before,expected_terrain:c.terrain,updates:{height:c.after}}));
    window.endWorldSculptStroke=async(cancel=false)=>{
        if(!stroke)return;
        if(!cancel&&available())tick(performance.now(),true);
        const context=stroke;stroke=null;
        const cells=[...context.cells.values()].filter(c=>c.before!==c.after);
        const rollback=()=>{for(const cell of cells)apply(cell,cell.before);};
        saving=true;
        try{
            if(cancel){rollback();return;}
            if(!cells.length)return;
            const change={objects:[],tiles:[],cells};
            await Server.batchUpdateTiles(lobbyId,packet(change));
        }catch(error){rollback();showNotification(error.message||'Не удалось сохранить рельеф','error');}
        finally{saving=false;await window.endWorldEditorStroke(cancel);}
    };
    const mode=document.getElementById('world-sculpt-mode');mode.dataset.canvasEditorControl='';
    mode.onchange=()=>{selectTool('height',{autoExpand:false});mode.blur();};
    for(const [id,key] of [['world-sculpt-strength','strength'],['world-sculpt-softness','softness']]){
        const input=document.getElementById(id);input.dataset.canvasEditorControl='';
        bindNumericInput(input,{blurOnCommit:true,onCommit:value=>{if(stroke)return false;settings[key]=value;return true;}});
    }
    window.addEventListener('pointermove',event=>{pointer=event.target===renderer.domElement||stroke?{x:event.clientX,y:event.clientY}:null;},{signal,capture:true});
    document.addEventListener('keydown',event=>{
        if(window.isLocationActive||!state.isGM||!state.editMode||isTypingTarget(event.target)||event.target.closest?.('.modal'))return;
        if(event.code==='Escape'&&stroke){event.preventDefault();window.cancelWorldBrushStroke?.();return;}

    },{signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&stroke)window.cancelWorldBrushStroke?.();},{signal});
}
