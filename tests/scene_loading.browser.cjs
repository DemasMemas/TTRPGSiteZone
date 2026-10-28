// VTT_SCENE_LOADING=1 node tests/world_object_editor.browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ page, request, token, lobby, base }) => {
    const location = await request(`/lobbies/${lobby.id}/locations`, {
        name: 'Проверка загрузки', world_tile_x: 4, world_tile_z: 4,
        grid_width: 16, grid_height: 16,
        tiles_data: Array.from({ length: 16 }, () => Array.from({ length: 16 },
            () => ({ terrain: 'grass', height: 1, objects: [] }))),
    }, token);
    const hidden = `document.getElementById('scene-loading-screen').classList.contains('is-hidden')`;
    const capture = async name => {
        const result = await page.call('Page.captureScreenshot', { format: 'png' });
        const directory = path.join(__dirname, '../tmp/scene-loading');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, name + '.png'), Buffer.from(result.data, 'base64'));
    };

    // Hold the detail request, cancel it, and deliver its old response afterwards.
    await page.evaluate(`(() => {
        const original = window.fetch;
        window.fetch = async (...args) => {
            if (String(args[0]).endsWith('/locations/${location.id}')) {
                window.detailSignal = args[1]?.signal;
                await new Promise(resolve => window.releaseDetail = resolve);
            }
            return original(...args);
        };
        window.restoreFetch = () => window.fetch = original;
        window.enterLocation(${location.id});
    })()`);
    await page.until('Boolean(window.releaseDetail)', 'location request');
    assert.equal(await page.evaluate(`document.getElementById('scene-loading-cancel').textContent`), 'Отменить и на карту');
    await page.evaluate(`document.getElementById('scene-loading-cancel').click(); releaseDetail(); restoreFetch();`);
    await page.until(`!window.isLocationActive && ${hidden}`, 'cancel to world');
    assert.equal(await page.evaluate('detailSignal.aborted'), true);
    assert.equal(await page.evaluate('window.currentLocationId'), null);

    // Observe real build stages and a fully rendered location through the usual camera.
    await page.evaluate(`(() => {
        const original = window.fetch;
        window.fetch = async (...args) => {
            if (String(args[0]).endsWith('/world-rules')) await new Promise(resolve => window.releaseRules = resolve);
            return original(...args);
        };
        window.restoreFetch = () => window.fetch = original;
        window.loadingSamples = [];
        window.loadingTimer = setInterval(() => loadingSamples.push(Number(document.getElementById('scene-loading-progress').getAttribute('aria-valuenow'))), 5);
        window.enterLocation(${location.id});
    })()`);
    await page.until(`Boolean(window.releaseRules) && document.getElementById('scene-loading-percent').textContent === '90%'`, 'location progress');
    assert.equal(await page.evaluate(`document.getElementById('scene-loading-title').textContent`), 'Проверка загрузки');
    await capture('location-loading');
    await page.evaluate('releaseRules(); restoreFetch()');
    await page.until(`window.isLocationActive && ${hidden}`, 'location loaded');
    await page.evaluate('clearInterval(loadingTimer)');
    const samples = await page.evaluate('loadingSamples');
    assert.ok(samples.some(value => value > 15 && value < 90), JSON.stringify(samples));
    assert.equal(await page.evaluate(`document.getElementById('scene-loading-percent').textContent`), '100%');
    await capture('location-ready');

    // Cancel during the geometry build, then open the same location again.
    await page.evaluate('window.exitLocation()');
    await page.until(hidden, 'world restored');
    await page.evaluate(`(() => {
        const timer = setInterval(() => {
            const value = Number(document.getElementById('scene-loading-progress').getAttribute('aria-valuenow'));
            if (window.isLocationActive && value >= 40 && value < 90) {
                clearInterval(timer);
                document.getElementById('scene-loading-cancel').click();
                window.cancelledBuild = true;
            }
        }, 1);
        window.enterLocation(${location.id});
    })()`);
    await page.until(`window.cancelledBuild && !window.isLocationActive && ${hidden}`, 'cancel partial scene');
    await page.evaluate(`window.enterLocation(${location.id})`);
    await page.until(`window.isLocationActive && ${hidden}`, 'location reopened');

    // Slow world chunk responses so the world loading UI can be inspected and cancelled.
    const preload = await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            if (String(args[0]).includes('/chunks?')) await new Promise(resolve => setTimeout(resolve, 3000));
            return originalFetch(...args);
        };
    ` });
    await page.call('Page.navigate', { url: `${base}/lobbies/${lobby.id}/page` });
    await page.until(`document.getElementById('scene-loading-title')?.textContent === ${JSON.stringify(lobby.name)} && typeof window.cancelSceneLoading === 'function'`, 'lobby name during load');
    assert.equal(await page.evaluate(`document.getElementById('scene-loading-cancel').textContent`), 'Отменить и в меню');
    await capture('world-loading');
    await page.evaluate(`document.getElementById('scene-loading-cancel').click()`);
    await page.until(`location.pathname === '/'`, 'cancel to menu');
    await page.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload.identifier });
    await page.call('Page.navigate', { url: `${base}/lobbies/${lobby.id}/page` });
    await page.until(`window.worldLoadMetrics?.complete && ${hidden}`, 'world loaded again');
    assert.equal(await page.evaluate(`document.getElementById('scene-loading-percent').textContent`), '100%');
    await capture('world-ready');
    console.log('Scene loading browser checks passed:', JSON.stringify({ stages: [...new Set(samples)], screenshots: 'tmp/scene-loading' }));
};
