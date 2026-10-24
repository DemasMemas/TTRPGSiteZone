// Interaction only: preview and guarded construction share the server's road search.
export function createWorldRoadTool({request, save, preview, clearPreview, settings, bridges, status, notify,
    continueLine=()=>true, delay=80}) {
    let points=[], cursor=null, revision=0, timer=null, pending=null, flight=null, busy=false;
    let result=null, resultKey=null, scheduledKey=null;
    const same=(a,b)=>a&&b&&a[0]===b[0]&&a[1]===b[1];
    const payload=waypoints=>({waypoints,allow_bridges:bridges(),settings:settings()});
    const pinned=()=>payload(points.map(p=>[...p]));
    const idle=()=>status(points.length
        ? 'Начало задано. Наведите на конец и кликните — построить. Esc / ПКМ — завершить.'
        : 'Кликните начало на суше, затем конец. Дорога продолжится от последнего конца.');
    function show(plan,key) {
        result=plan;resultKey=key;preview(plan,settings());
        status(`Клеток: ${plan.path.length}; существующих: ${plan.reused}; мостовых: ${plan.bridges}. Клик — построить; Esc / ПКМ — завершить.`);
    }
    function invalidate() {
        revision++;clearTimeout(timer);timer=null;pending=null;scheduledKey=null;result=null;resultKey=null;
    }
    async function pump() {
        if(flight||!pending||busy)return;
        const job=pending;pending=null;
        try {
            flight=Promise.resolve().then(()=>request(job.data));
            const plan=await flight;
            // Motion must not starve preview. Keep the latest completed path visible;
            // changes to anchors/settings and cancellation invalidate it.
            if(job.revision===revision&&!busy)show(plan,job.key);
        }catch(error){
            if(job.revision===revision&&!busy&&job.key===scheduledKey){
                result=null;resultKey=null;clearPreview();status(error.message);
            }
        }finally{flight=null;if(pending)pump();}
    }
    function queue() {
        if(busy)return;
        const waypoints=points.map(p=>[...p]);
        if(cursor&&!same(cursor,waypoints.at(-1)))waypoints.push([...cursor]);
        if(!points.length||waypoints.length<2){
            revision++;result=null;resultKey=null;
            clearTimeout(timer);timer=null;pending=null;scheduledKey=null;clearPreview();idle();return;
        }
        const data=payload(waypoints),key=JSON.stringify(data);
        if(key===scheduledKey)return;
        scheduledKey=key;pending={data,key,revision};
        status('Рассчитываем маршрут… Кликните выбранный конец для строительства.');
        // Throttle rather than debounce: movement still submits previews.
        if(!timer)timer=setTimeout(()=>{timer=null;pump();},delay);
    }
    function refresh(){invalidate();queue();}
    function cancel(){const active=points.length>0;invalidate();points=[];cursor=null;clearPreview();idle();return active;}
    async function confirm(end=null) {
        if(busy)return false;
        const data=pinned();
        if(end&&!same(end,data.waypoints.at(-1)))data.waypoints.push([...end]);
        if(data.waypoints.length<2){notify('Укажите конец кликом.');return false;}
        const key=JSON.stringify(data),cached=resultKey===key?result:null;
        invalidate();const ownRevision=revision;busy=true;status('Проверяем и сохраняем дорогу…');
        try {
            const plan=cached||await request(data);
            if(ownRevision!==revision)return false;
            preview(plan,settings());
            await save({...data,signature:plan.signature});
            if(ownRevision!==revision)return true;
            points=continueLine()?[[...data.waypoints.at(-1)]]:[];cursor=null;result=null;resultKey=null;clearPreview();
            status(points.length
                ? 'Участок построен. Наведите и кликните следующий конец; Esc / ПКМ — завершить.'
                : 'Дорога построена. Кликните начало нового маршрута.');
            return true;
        }catch(error){
            if(ownRevision!==revision)return false;
            notify(error.message);clearPreview();
            if(error.status===409){
                try {const plan=await request(data);if(ownRevision===revision){show(plan,key);status('Карта изменилась. Проверьте обновлённый маршрут и повторите клик по концу.');}}
                catch(next){if(ownRevision===revision)status(next.message);}
            }else status(error.message+' Измените конец или параметры и повторите клик.');
            return false;
        }finally{busy=false;}
    }
    return {
        get active(){return points.length>0;},get saving(){return busy;},
        click(point,water=false){
            if(busy||!point)return false;
            if(water){const message='Точки маршрута выбираются на суше. Для перехода через воду разрешите мосты и укажите противоположный берег.';status(message);notify(message);return false;}
            if(same(point,points.at(-1)))return false;
            if(!points.length){invalidate();points.push([...point]);cursor=null;queue();return true;}
            return confirm(point);
        },
        hover(point){if(busy||same(point,cursor)||(!point&&!cursor))return;cursor=point;queue();},
        refresh,
        cancel,
    };
}
