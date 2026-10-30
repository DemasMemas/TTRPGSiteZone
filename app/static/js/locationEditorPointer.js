export function createSecondaryDragGuard({ threshold = 3, holdMs = 350, clickMs = 350, now = Date.now } = {}) {
    let active = null;
    let suppressUntil = 0;

    return {
        begin(x, y, pointerId = null, timestamp = now()) {
            suppressUntil = 0;
            active = { x, y, pointerId, moved: false, consumed: false, started: timestamp };
        },
        move(x, y, pointerId = null) {
            if (active?.pointerId !== pointerId) return;
            if (active && Math.hypot(x - active.x, y - active.y) >= threshold) active.moved = true;
        },
        end(timestamp = now()) {
            const click = Boolean(active && !active.moved && timestamp-active.started < clickMs);
            if (active && !click && !active.consumed) suppressUntil = now() + holdMs;
            active = null;
            return click;
        },
        shouldSuppressMenu() {
            if (active?.moved) {
                active.consumed = true;
                return true;
            }
            if (suppressUntil && now() <= suppressUntil) {
                suppressUntil = 0;
                return true;
            }
            return false;
        },
        reset() {
            active = null;
            suppressUntil = 0;
        },
    };
}

// Native contextmenu can fire on press, before a camera drag can be identified.
// Dispatch actions only after a short, stationary release. OrbitControls still
// receives the original pointer events, including right down/up.
export function installSecondaryClick(canvas, { contextRoots = () => [canvas] } = {}) {
    const guard=createSecondaryDragGuard();
    let pointer=null;
    const down=e=>{if(e.target===canvas&&e.button===2){pointer=e.pointerId;guard.begin(e.clientX,e.clientY,pointer,e.timeStamp);}};
    const move=e=>{if(e.pointerId===pointer)guard.move(e.clientX,e.clientY,pointer);};
    const up=e=>{
        if(e.button!==2||pointer===null||e.pointerId!==pointer)return;
        pointer=null;
        if(guard.end(e.timeStamp))canvas.dispatchEvent(new MouseEvent('secondaryclick',{
            bubbles:true,cancelable:true,button:2,clientX:e.clientX,clientY:e.clientY,
            ctrlKey:e.ctrlKey,shiftKey:e.shiftKey,altKey:e.altKey,metaKey:e.metaKey,
        }));
    };
    const reset=()=>{pointer=null;guard.reset();};
    const menu=e=>{if(contextRoots().some(root=>root?.contains(e.target)))e.preventDefault();};
    window.addEventListener('pointerdown',down,{capture:true});
    window.addEventListener('pointermove',move,{capture:true});
    window.addEventListener('pointerup',up,{capture:true});
    window.addEventListener('pointercancel',reset,{capture:true});
    window.addEventListener('blur',reset);
    window.addEventListener('contextmenu',menu,{capture:true});
    return ()=>{
        window.removeEventListener('pointerdown',down,{capture:true});window.removeEventListener('pointermove',move,{capture:true});
        window.removeEventListener('pointerup',up,{capture:true});window.removeEventListener('pointercancel',reset,{capture:true});
        window.removeEventListener('blur',reset);window.removeEventListener('contextmenu',menu,{capture:true});reset();
    };
}
