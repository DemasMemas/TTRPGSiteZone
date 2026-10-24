const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({page, request, lobby, base, connect, debugPort}) => {
    const output = path.resolve(__dirname, '../docs/license-previews');
    fs.mkdirSync(output, {recursive: true});
    const link = 'document.querySelector(".credits-menu-link")';
    assert.equal(await page.evaluate(`${link}.getAttribute('href')`), '/licenses');
    await request('/auth/register', {username:'credits-player',email:'credits-player@example.test',password:'browser-test-password'});
    const player = await request('/auth/login', {username:'credits-player',password:'browser-test-password'});
    await request(`/lobbies/${lobby.id}/join`, {}, player.access_token);
    await page.evaluate(`localStorage.setItem('access_token',${JSON.stringify(player.access_token)});localStorage.setItem('user_id',${JSON.stringify(String(player.user_id))})`);
    await page.call('Page.reload');
    await page.until(`window.isGM===false&&document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'ordinary player lobby');
    await new Promise(r=>setTimeout(r,700));
    assert.ok(await page.evaluate(`${link}.getBoundingClientRect().height>=32`));
    assert.equal(await page.evaluate(`${link}.target`), '_blank');
    fs.writeFileSync(path.join(output, 'player-menu.png'), Buffer.from((await page.call('Page.captureScreenshot', {format:'png'})).data,'base64'));
    const position = await page.evaluate(`(()=>{const a=${link};a.scrollIntoView({block:'nearest'});const b=a.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
    await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...position,button:'left',clickCount:1});
    await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...position,button:'left',clickCount:1});
    let target;
    for(let i=0;i<50&&!target;i++) {
        target=(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(t=>t.url===base+'/licenses');
        if(!target) await new Promise(r=>setTimeout(r,100));
    }
    assert.ok(target, 'credits opened from player menu in a separate tab');
    const credits = await connect(target.webSocketDebuggerUrl);
    try {
        await credits.call('Page.enable');await credits.call('Runtime.enable');
        await credits.until('Boolean(document.getElementById("modular_road_bridge"))', 'credits card');
        assert.equal(await credits.evaluate('document.querySelector("#used-assets article")'), null);
        assert.ok((await credits.evaluate('document.querySelector("#planned-assets").textContent')).includes('Запланирован к интеграции'));
        assert.ok(await credits.evaluate('document.querySelector("#modular_road_bridge").textContent.includes("CC BY 4.0")'));
        const links=await credits.evaluate('[...document.querySelectorAll("#modular_road_bridge a")].map(a=>({href:a.href,rel:a.rel}))');
        assert.equal(links.length, 2);
        assert.ok(links.every(a=>a.rel.includes('noopener')&&a.href.startsWith('https://')));
        for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844]]) {
            await credits.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
            await credits.evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(r)))');
            assert.ok(await credits.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),name+' fits viewport');
            fs.writeFileSync(path.join(output, name+'.png'), Buffer.from((await credits.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})).data,'base64'));
        }
        await credits.call('Page.navigate',{url:base});
        await credits.until('Boolean(document.querySelector(".credits-link"))','home navigation');
        await credits.evaluate('document.querySelector(".credits-link").click()');
        await credits.until('Boolean(document.getElementById("modular_road_bridge"))','credits via homepage');
        assert.ok(await page.evaluate('Boolean(document.querySelector("#canvas-container canvas"))&&!window.isGM'), 'player scene preserved');
        console.log('PASS: public credits, ordinary-player menu, separate tab preserves scene, desktop/mobile layout, home navigation; links:',JSON.stringify(links));
    } finally { credits.close(); }
};
