// Optional native-input regression: node tests/world_numeric_drag.browser.cjs
// Uses the real template controls, binding module and brush setters in Chrome.
// This verifies DOM input, not the WebGL game scene.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    const keepAlive = setInterval(() => {}, 1000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vtt-slider-'));
    const browser = process.env.BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const child = spawn(browser, [
        '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    let socket;
    try {
        let port;
        for (let i = 0; i < 100; i++) {
            try {
                port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
                break;
            } catch { await pause(100); }
        }
        assert.ok(port, 'Chrome did not start');
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let nextId = 0;
        const waiting = new Map();
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id) { waiting.get(message.id)?.(message); waiting.delete(message.id); }
        };
        const call = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++nextId;
            waiting.set(id, message => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
            socket.send(JSON.stringify({ id, method, params }));
        });
        const evaluate = async expression => {
            const result = await call('Runtime.evaluate', { expression, returnByValue: true });
            assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        const html = read('app/templates/lobby.html');
        const ids = ['tile-height', 'world-brush-radiation', 'tile-edit-height', 'tile-edit-radiation'];
        const tag = id => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))[0];
        const controls = ids.map(id => tag(id) + tag(`${id}-number`) + `<output id="${id}-value"></output>`).join('<br>');
        const source = read('app/static/js/mapEdit.js');
        const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
            .replace('export function', 'function');
        const setters = extract('export function setTileHeightFromInput(', 'export function setEraserModeFromInput(')
            + extract('export function setWorldBrushRadiation(', 'export function updateTileEditHeight(');
        const binding = read('app/static/js/worldNumericInputs.js').replaceAll('export function', 'function');
        await call('Page.enable');
        const tree = await call('Page.getFrameTree');
        await call('Page.setDocumentContent', {
            frameId: tree.frameTree.frame.id,
            html: '<style>input[type=range]{width:400px}</style>' + controls,
        });
        await evaluate(`window.AppState={setTileHeight(v){this.tileHeight=v;window.tileHeight=v}};
            window.updateTileEditHeight=()=>{};window.updateTileEditRadiation=()=>{};
            ${binding}\n${setters}\ninitWorldNumericInputs();window.samples=[];
            for(const id of ${JSON.stringify(ids)})document.getElementById(id).addEventListener('input',e=>
                samples.push([id,e.target.value,document.getElementById(id+'-number').value]));`);
        for (const id of ids) {
            const rect = await evaluate(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();
                return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
            for (let round = 0; round < 2; round++) {
                // Start on the current thumb, then drag it in both directions.
                const value = await evaluate(`Number(document.getElementById('${id}').value)`);
                const bounds = await evaluate(`(()=>{const r=document.getElementById('${id}');return [+r.min,+r.max]})()`);
                const startX = rect.x + 8 + (rect.w - 16) * (value - bounds[0]) / (bounds[1] - bounds[0]);
                const y = rect.y + rect.h / 2;
                await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX, y });
                await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y, button: 'left', buttons: 1, clickCount: 1 });
                for (let i = 0; i < 30; i++) {
                    const dx = round ? 385 - i * 12 : 20 + i * 12;
                    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + dx, y, button: 'left', buttons: 1 });
                    await pause(20);
                }
                await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 30, y, button: 'left', buttons: 0, clickCount: 1 });
            }
            const step = id.includes('height') ? 0.1 : 0.5;
            const samples = await evaluate(`samples.filter(sample=>sample[0]==='${id}')`);
            assert.ok(samples.length > 10, `${id}: only ${samples.length} drag events`);
            for (const [, range, number] of samples) {
                assert.equal(range, number);
                assert.ok(Math.abs(Number(range) / step - Math.round(Number(range) / step)) < 1e-9, `${id}: ${range}`);
            }
            assert.equal(await evaluate(`document.getElementById('${id}').step`), String(step));
            await evaluate(`(()=>{const n=document.getElementById('${id}-number');n.focus();n.value='1.234567';
                n.dispatchEvent(new Event('input',{bubbles:true}));n.blur()})()`);
            assert.equal(await evaluate(`getWorldNumericValue('${id}')`), 1.234567);
            if (id === 'tile-height') assert.equal(await evaluate('AppState.tileHeight'), 1.234567);
            if (id === 'world-brush-radiation') assert.equal(await evaluate('window.worldBrushRadiation'), 1.234567);
            console.log(`${id}: ${samples.length} native drag events on grid; exact typed value preserved`);
        }
        await call('Browser.close');
    } finally {
        socket?.close();
        child.kill();
        clearInterval(keepAlive);
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
