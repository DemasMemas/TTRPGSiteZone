import { createLocationEditorHistory, copy, equal } from './locationEditorHistory.js';
import { chunksMap, updateTileInChunk } from './lobby3d.js';
import { Server } from './api.js';
import { showNotification } from './utils.js';
import { isTypingTarget } from './cameraPan.js';

const sessions = new Map();
let bindings;
export const worldCellKey = c => `${c.chunk_x},${c.chunk_y},${c.tile_x},${c.tile_y}`;
export const worldField = (tile,key) => ({present:Object.hasOwn(tile,key),...(Object.hasOwn(tile,key)?{value:copy(tile[key])}:{})});
export function mergeWorldCommands(commands) {
    const cells=new Map();
    for(const command of commands)for(const c of command?.cells||[]){
        const key=worldCellKey(c),cell=cells.get(key)||{...c,before:{},after:{}};
        for(const field of Object.keys(c.before)){
            if(!Object.hasOwn(cell.before,field))cell.before[field]=copy(c.before[field]);
            cell.after[field]=copy(c.after[field]);
        }
        cells.set(key,cell);
    }
    return {objects:[],tiles:[],cells:[...cells.values()].flatMap(c=>{
        const keys=Object.keys(c.before).filter(key=>!equal(c.before[key],c.after[key]));
        return keys.length?[{...c,before:Object.fromEntries(keys.map(k=>[k,c.before[k]])),after:Object.fromEntries(keys.map(k=>[k,c.after[k]]))}]:[];
    })};
}

export function initWorldEditorHistory(lobbyId,state) {
    bindings?.abort();bindings=new AbortController();const signal=bindings.signal;
    const history=sessions.get(lobbyId)||createLocationEditorHistory(()=>sync());sessions.set(lobbyId,history);
    let context=null,applying=false,deferred=[];
    const tile=c=>chunksMap.get(`${c.chunk_x},${c.chunk_y}`)?.tilesData[c.tile_y]?.[c.tile_x];
    const apply=item=>updateTileInChunk(item.chunk_x,item.chunk_y,item.tile_x,item.tile_y,item.state?{__editorState:item.state}:item.updates);
    function sync(){const h=history.state(),preview=window.isWorldClipboardActive?.();for(const [name,disabled]of [['undo',h.busy||preview||!h.undo],['redo',h.busy||preview||!h.redo]]){const b=document.querySelector(`[data-world-${name}]`);if(b)b.disabled=disabled;}}
    function drain(){const events=deferred;deferred=[];for(const item of events)apply(item);}
    function applyFields(command,reverse=false){
        applying=true;
        try{for(const c of command.cells){const next=copy(tile(c));if(!next)continue;
            for(const [key,value]of Object.entries(reverse?c.before:c.after)){if(value.present)next[key]=copy(value.value);else delete next[key];}
            apply({...c,state:next});
        }}finally{applying=false;}
    }
    function begin(kind){if(context||history.state().busy)return false;context={kind,commands:[],local:new Map(),pending:[]};history.setBusy(true);return true;}
    function finish(){context=null;history.setBusy(false);drain();sync();}
    function localCommand(ctx){return {objects:[],tiles:[],cells:[...ctx.local.values()].flatMap(c=>{
        const current=tile(c),keys=[...new Set([...Object.keys(c.original),...Object.keys(current)])].filter(k=>!equal(worldField(c.original,k),worldField(current,k)));
        return keys.length?[{chunk_x:c.chunk_x,chunk_y:c.chunk_y,tile_x:c.tile_x,tile_y:c.tile_y,
            before:Object.fromEntries(keys.map(k=>[k,worldField(c.original,k)])),after:Object.fromEntries(keys.map(k=>[k,worldField(current,k)]))}]:[];
    })};}
    async function send(command,clearSelection=false){
        if(!command.cells.length)return {command,updates:[]};
        const result=await Server.applyWorldEditorChange(lobbyId,command);
        if(clearSelection)window.clearDirectWorldObjectSelection?.();
        applying=true;try{for(const item of result.updates)apply(item);}finally{applying=false;}
        return result;
    }
    window.worldEditorHistory=history;
    window.refreshWorldEditorHistoryControls=sync;
    window.getWorldEditorHistoryState=()=>({...history.state(),kind:context?.kind,localCells:context?.local.size||0});
    window.applyWorldEditorUpdate=apply;
    window.deferWorldEditorUpdate=item=>{if(context||history.state().busy){deferred.push(copy(item));return true;}return false;};
    window.touchWorldEditorCell=(cx,cy,x,z)=>{
        if(applying||context?.kind!=='brush')return;
        const c={chunk_x:cx,chunk_y:cy,tile_x:x,tile_y:z},key=worldCellKey(c);
        if(!context.local.has(key))context.local.set(key,{...c,original:copy(tile(c))});
    };
    window.runWorldEditorRequest=(id,request)=>{
        if(Number(id)!==Number(lobbyId))return request();
        const own=!context;
        if(own&&!begin('request'))return Promise.reject(Error('Дождитесь сохранения текущего действия'));
        if(!own&&!['brush','sculpt'].includes(context.kind))return Promise.reject(Error('Дождитесь сохранения текущего действия'));
        const ctx=context;
        const pending=(async()=>{
            try{const result=await request();if(result?.command)ctx.commands.push(result.command);return result;}
            finally{if(own){history.push(mergeWorldCommands(ctx.commands));finish();}}
        })();
        ctx.pending.push(pending);return pending;
    };
    window.beginWorldEditorStroke=kind=>begin(kind);
    window.endWorldEditorStroke=async(cancel=false)=>{
        if(!context||!['brush','sculpt'].includes(context.kind))return;
        const ctx=context,kind=ctx.kind;ctx.kind='finishing';
        window.clearPendingWorldBrushUpdates?.();
        await Promise.allSettled(ctx.pending);
        const local=kind==='brush'?localCommand(ctx):{cells:[]};
        try{
            let saved=mergeWorldCommands(ctx.commands);
            if(cancel){
                applyFields(local,true);
                if(saved.cells.length)await send({...saved,cells:saved.cells.map(c=>({...c,before:c.after,after:c.before}))});
                return;
            }
            const stored=new Map(saved.cells.map(c=>[worldCellKey(c),c]));
            const pending={objects:[],tiles:[],cells:local.cells.flatMap(c=>{
                const before=Object.fromEntries(Object.keys(c.before).map(k=>[k,stored.get(worldCellKey(c))?.after[k]??c.before[k]]));
                const keys=Object.keys(before).filter(k=>!equal(before[k],c.after[k]));
                return keys.length?[{...c,before:Object.fromEntries(keys.map(k=>[k,before[k]])),after:Object.fromEntries(keys.map(k=>[k,c.after[k]]))}]:[];
            })};
            if(pending.cells.length){const result=await send(pending);ctx.commands.push(result.command);}
            history.push(mergeWorldCommands(ctx.commands));
        }catch(error){applyFields(local,true);showNotification(error.message,'error');}
        finally{finish();}
    };
    window.commitWorldEditorCommand=async command=>{
        if(!begin('command'))throw Error('Дождитесь сохранения текущего действия');
        try{const result=await send(command);history.push(result.command);return result;}
        finally{finish();}
    };
    async function replay(forward){
        if(context||!state.isGM||!state.editMode||window.isLocationActive||window.isWorldClipboardActive?.())return;
        try{await history.replay(forward,async command=>(await send(command,true)).command);}
        catch(error){showNotification(error.message,'error');}
        finally{drain();sync();}
    }
    window.replayWorldEditorHistory=replay;
    for(const [name,forward]of [['undo',false],['redo',true]]){const b=document.querySelector(`[data-world-${name}]`);if(b){b.onclick=()=>replay(forward);b.title=forward?'Повтор (Ctrl+Y / Ctrl+Shift+Z)':'Отмена (Ctrl+Z)';}}
    document.addEventListener('keydown',event=>{
        if(!state.isGM||!state.editMode||window.isLocationActive||isTypingTarget(event.target)||event.target.closest?.('.modal'))return;
        if(event.code==='Escape'&&context?.kind==='brush'){event.preventDefault();window.cancelWorldBrushStroke?.();return;}
        if(event.ctrlKey&&!event.altKey&&!event.metaKey&&['KeyZ','KeyY'].includes(event.code)){event.preventDefault();if(!event.repeat)void replay(event.code==='KeyY'||event.shiftKey);}
    },{signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&context?.kind==='brush')window.cancelWorldBrushStroke?.();},{signal});
    sync();return history;
}
