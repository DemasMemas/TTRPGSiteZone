const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ page, request, token, lobby, login, profile, base, connect, debugPort }) => {
    const template = await request(`/lobbies/${lobby.id}/templates`, { name: 'Widget pistol', category: 'weapon',
        subcategory: 'Пистолет', weight: 1, volume: 1, attributes: { fixedMagazine: true, magazine_size: 6, caliber: '9x19', damage: 25 } }, token);
    const medicine = await request(`/lobbies/${lobby.id}/templates`, { name: 'Проверочный препарат', category: 'consumable',
        weight: .1, volume: .1, attributes: { notes: 'Описание проверочного предмета', consumable: { direct: { pain: -1 } } } }, token);
    const character = await request(`/lobbies/${lobby.id}/characters`, { name: 'Виджеты — первый', data: {
        basic: { name: 'Виджеты — первый' }, health: { current: 100, max: 100, painLevel: 1,
            organs: { heart: { current: 1, max: 100 } }, effects: [{ id: 'widget-effect', type: 'custom', name: 'Проверочный эффект', value: 2, remaining: 3 }] },
        skills: { physical: { will: { base: 10, bonus: 0, xp: 0 }, strength: { base: 10, bonus: 0, xp: 0 } } },
        equipment: { armor: { id: 'widget-armor', name: 'Widget armor', durability: 40, currentStageDurability: 20 }, backpack: { id: 'bag', name: 'Рюкзак', attributes: { capacity: 20 } } },
        weapons: [{ id: 'widget-pistol', name: 'Widget pistol', templateId: template.id + 1000000,
            type: 'firearm', ammo: 3, durability: 40, currentStageDurability: 20, fixedAmmo: [{ quantity: 3, name: '9x19', templateId: 999001 }] },
            { id: 'widget-knife', name: 'Нож', category: 'melee_weapon', attributes: { damage: 10, allowed_attacks: ['Колющий'], weight_class: 'Лёгкое' } }],
        inventory: { backpack: [], pockets: [{ id: 'widget-ammo', templateId: 999001, name: '9x19',
            category: 'ammo', quantity: 6, volume: .02, attributes: { caliber: '9x19', damage: 25 } },
            { id: 'widget-medicine', templateId: medicine.id + 1000000, name: 'Проверочный препарат', category: 'consumable', quantity: 3, volume: .1, contents: [],
                attributes: { consumable: { direct: { pain: -1 } } } }] },
    } }, token);
    const other = await request(`/lobbies/${lobby.id}/characters`, { name: 'Виджеты — второй', data: {
        health: { current: 100, max: 100, painLevel: 2, effects: [] },
    } }, token);
    const key = `character-widgets:${lobby.id}:${login.user_id}`;
    const prefs = () => page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})||'[]')`);
    const pinBlock = async (block, scope = '') => {
        const selector = `${scope || '#sheet-content'} .sheet-pin[data-pin-blocks~="${block}"]`;
        await page.until(`document.querySelector(${JSON.stringify(selector)})`, `pin affordance ${block}`);
        await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        await page.evaluate(`document.querySelector('.sheet-pin-menu [data-pin-block="${block}"]')?.click()`);
    };
    const pinField = field => pinBlock(field === 'health.painLevel' ? 'health-status' : 'equipment:armor');
    const pinAction = text => pinBlock('skill:physical.will');
    const panelFor = async (id, kind, prop, value) => {
        const block = kind === 'field' ? value === 'health.painLevel' ? 'health-status' : 'equipment:armor'
            : value === 'rollSkill' ? 'skill:physical.will' : 'weapon';
        const pin = (await prefs()).find(pin => pin.characterId === id && pin.references[0]?.block === block);
        assert.ok(pin, `pin ${block}`); return '#character-widget-' + pin.id;
    };
    await page.evaluate(`window.openCharacterSheet(${character.id})`);
    await page.until(`document.body.classList.contains('character-sheet-open') && document.querySelectorAll('#sheet-content .sheet-pin').length>10`, 'sheet pin controls');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.lobby-menu')).visibility==='hidden' && getComputedStyle(document.getElementById('panel-participants')).visibility==='hidden' && getComputedStyle(document.getElementById('panel-common-tools')).visibility==='hidden'`), true);
    const agreed = await page.evaluate(`[...document.querySelectorAll('#sheet-content .sheet-pin')].flatMap(b=>b.dataset.pinBlocks.split(' '))`);
    for (const block of ['health-pool', 'health-status', 'blood-check', 'infection', 'needs', 'organs', 'health-summary', 'effects', 'effect', 'addictions', 'zone:head',
        'weapon-mastery', 'equipment:helmet', 'equipment:gasMask', 'equipment:armor', 'protection:armor', 'coverage:armor', 'modifications:armor',
        'equipment:detector', 'cosmetic:headphones', 'cosmetic:glasses', 'cosmetic:gloves', 'cosmetic:jewelry', 'equipment:pda', 'inventory-weight', 'pockets', 'backpack', 'inventory-item', 'money', 'notes']) {
        assert.ok(agreed.includes(block), `agreed block ${block}`);
    }
    assert.equal(agreed.includes('loadout'), false);
    assert.equal(agreed.includes('inventory-actions'), false);
    assert.equal(agreed.includes('inventory-container'), false);
    assert.equal(agreed.includes('inventory-magazine'), false);
    assert.equal(await page.evaluate(`document.querySelector('[data-path="inventory,pockets,1"] .sheet-pin').dataset.pinBlocks`), 'inventory-item');
    assert.equal(await page.evaluate(`document.querySelectorAll('[name^="basic."] + .sheet-pin,[name^="health.organs."] + .sheet-pin,[name="skills.skillPoints"] + .sheet-pin').length`), 0);
    // Exercise the blocks which previously could not be pinned, then remove them
    // to keep the later layout/permissions regression compact.
    await pinBlock('organs'); await pinBlock('effect');
    await pinBlock('inventory-item', '[data-path="inventory,pockets,1"]');
    await pinBlock('weapon', '[data-weapon-index="1"]');
    const extraPrefs = await prefs();
    const extra = block => '#character-widget-' + extraPrefs.find(pin => pin.references[0].block === block).id;
    await page.evaluate('window.closeCharacterSheet()');
    await page.until(`document.querySelector('${extra('effect')} [data-widget-control="field:$item.value"]') && document.querySelector('${extra('organs')} .zone-item-vertical')`, 'effect and damaged organs projected');
    assert.equal(await page.evaluate(`document.querySelectorAll('${extra('organs')} .zone-item-vertical').length`), 1);
    assert.ok(await page.evaluate(`document.querySelector('${extra('weapon')}').textContent.includes('Колющий')`));
    await page.evaluate(`(()=>{const i=document.querySelector('${extra('effect')} [data-widget-control="field:$item.value"]');i.value=4;i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await page.until(`document.querySelector('${extra('effect')} [data-widget-control="field:$item.value"]')?.value==='4' && !document.querySelector('${extra('effect')} input').disabled`, 'individual effect saved');
    assert.equal((await request(`/lobbies/characters/${character.id}`, null, token, 'GET')).data.health.effects.find(e => e.id === 'widget-effect').value, 4);
    const itemPanel = extra('inventory-item');
    assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${itemPanel} .widget-inventory-field > span')].map(e=>e.textContent)`), ['Вес, кг','Объём','Количество']);
    assert.ok(await page.evaluate(`document.querySelector('${itemPanel}').getBoundingClientRect().width >= 600`));
    assert.equal(await page.evaluate(`(()=>{const p=document.querySelector('${itemPanel} .panel-content');return p.scrollWidth<=p.clientWidth+1})()`), true);
    fs.writeFileSync(path.join(profile, 'inventory-widget-fields.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await page.evaluate(`document.querySelector('${itemPanel} [data-widget-control$=":quantity-up"]').click()`);
    await page.until(`document.querySelector('${itemPanel} [data-widget-control$=":quantity"]')?.value==='4' && !document.querySelector('${itemPanel} input').disabled`, 'inventory quantity through original closure');
    const movedItem = await request(`/lobbies/characters/${character.id}`, null, token, 'GET');
    movedItem.data.inventory.backpack.push(movedItem.data.inventory.pockets.splice(1,1)[0]);
    await request(`/lobbies/characters/${character.id}`, { data: movedItem.data }, token, 'PUT');
    await page.evaluate(`document.querySelector('${itemPanel} [data-widget-control$=":quantity-up"]').click()`);
    await page.until(`document.querySelector('${itemPanel} [data-widget-control$=":quantity"]')?.value==='5' && !document.querySelector('${itemPanel} input').disabled`, 'pinned item follows transfer to backpack');
    assert.equal((await request(`/lobbies/characters/${character.id}`, null, token, 'GET')).data.inventory.backpack[0].quantity, 5);
    await page.evaluate(`window.openCharacterSheet(${character.id})`);
    await page.until(`document.body.classList.contains('character-sheet-open')`, 'sheet to pin backpack');
    await pinBlock('backpack');
    const backpackPin = (await prefs()).find(pin => pin.references[0].block === 'backpack');
    await page.evaluate('window.closeCharacterSheet()');
    await page.until(`document.querySelectorAll('#character-widget-${backpackPin.id} .widget-inventory-field').length===3`, 'backpack contains labeled item fields');
    assert.equal(await page.evaluate(`(()=>{const p=document.querySelector('#character-widget-${backpackPin.id} .panel-content');return p.scrollWidth<=p.clientWidth+1})()`), true);
    fs.writeFileSync(path.join(profile, 'backpack-widget-fields.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await page.evaluate(`document.querySelector('#character-widget-${backpackPin.id} .panel-header button').click()`);
    for (const pin of extraPrefs) await page.evaluate(`document.querySelector('#character-widget-${pin.id} .panel-header button').click()`);
    await page.evaluate(`window.openCharacterSheet(${character.id})`);
    await page.until(`document.body.classList.contains('character-sheet-open')`, 'sheet for tooltip checks');
    const hover = async (selector, expected) => {
        await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
        await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const point = await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        await page.until(`(()=>{const t=document.getElementById('delayed-item-tooltip');return t && getComputedStyle(t).display!=='none' && getComputedStyle(t).visibility==='visible' && t.textContent.includes(${JSON.stringify(expected)})})()`, 'visible hover tooltip');
    };
    await page.evaluate(`document.querySelector('[data-tab="equipment"]').click()`);
    const collisions = await page.evaluate(`(()=>{
        const failures=[];
        for(const key of ['gasMask','armor']){
            document.querySelector('[data-equipment-panel="'+key+'"]').open=true;
            const names=['equipment:'+key,'protection:'+key,...(key==='armor'?['coverage:'+key]:[])];
            const rects=names.map(name=>document.querySelector('.sheet-pin[data-pin-block="'+name+'"]').getBoundingClientRect());
            for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
                const a=rects[i],b=rects[j];if(Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)) failures.push(names[i]+' / '+names[j]);
            }
        }return failures;
    })()`);
    assert.deepEqual(collisions, [], 'equipment, protection and coverage pin buttons do not overlap');
    await hover('#sheet-content .loadout-slot[data-equipment-open="weapon-0"]', 'Widget pistol');
    await page.evaluate(`document.querySelector('[data-tab="inventory"]').click()`);
    await hover('#sheet-tab-inventory [data-item-template-id="' + (medicine.id + 1000000) + '"] strong', 'Описание проверочного предмета');
    fs.writeFileSync(path.join(profile, 'inventory-hover-tooltip.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log('PASS: agreed block catalogue, damaged organs only, melee, effect edit, inventory quantity/transfer and visible equipment/item hover tooltips');
    await pinField('health.painLevel');
    await pinField('equipment.armor.currentStageDurability');
    await pinAction("window.rollSkill('physical.will', 'Воля')");
    await pinBlock('weapon', '[data-weapon-index="0"]');
    const attackText = await page.evaluate(`[...document.querySelectorAll('[data-weapon-index="0"] [onclick]')].find(b=>b.getAttribute('onclick').startsWith("useWeaponFromEquipment(0, 'unaimed'"))?.getAttribute('onclick')`);
    assert.ok(attackText);
    await pinBlock('needs');
    await pinBlock('health-pool');
    await pinBlock('weapon-mastery');
    await pinBlock('notes');
    const savedCount = (await prefs()).length;
    assert.ok(savedCount >= 7);
    console.log('PASS: scalar, armor, skill, reload, attack and block pin references created');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.character-widget')).visibility`), 'hidden');
    await page.evaluate(`window.closeCharacterSheet()`);
    await page.until(`document.querySelectorAll('.character-widget .widget-character-name').length===${savedCount}`, 'authorized widget values');
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.lobby-menu')).visibility`), 'visible');
    const masteryPin = (await prefs()).find(pin => pin.references[0].block === 'weapon-mastery');
    const masteryPanel = '#character-widget-' + masteryPin.id;
    await page.until(`document.querySelector('${masteryPanel} [data-widget-control*="addWeaponXp"]')`, 'weapon mastery projected');
    await page.evaluate(`document.querySelector('${masteryPanel} [data-widget-control*="addWeaponXp"]').click()`);
    await page.until(`document.querySelector('${masteryPanel}').textContent.includes('Прогресс: 1/5') && !document.querySelector('${masteryPanel} button[data-widget-control]').disabled`, 'weapon mastery progress saved');
    assert.equal((await request(`/lobbies/characters/${character.id}`, null, token, 'GET')).data.skills.specialized.pistols.xp, 1);
    const notePin = (await prefs()).find(pin => pin.references[0].block === 'notes');
    await page.evaluate(`(()=>{const t=document.querySelector('#character-widget-${notePin.id} textarea');t.value='Проверочная заметка';t.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await page.until(`document.querySelector('#character-widget-${notePin.id} textarea')?.value==='Проверочная заметка' && !document.querySelector('#character-widget-${notePin.id} textarea').disabled`, 'note saved');
    assert.equal((await request(`/lobbies/characters/${character.id}`, null, token, 'GET')).data.notes, 'Проверочная заметка');
    const painPanel = await panelFor(character.id, 'field', 'path', 'health.painLevel');
    await page.evaluate(`(()=>{const i=document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]');i.value='3';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await page.until(`document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]')?.value==='3' && !document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]').disabled`, 'widget field saved through sheet');
    assert.equal((await request(`/lobbies/characters/${character.id}`, null, token, 'GET')).data.health.painLevel, 3);
    const skillPanel = await panelFor(character.id, 'action', 'name', 'rollSkill');
    await page.evaluate(`document.querySelector('${skillPanel} [data-widget-control^="click:window.rollSkill"]').click()`);
    await page.until(`[...document.querySelectorAll('#chat .message')].some(m=>m.textContent.includes('Воля: бросок'))`, 'skill uses existing roll and chat');
    const reloadPanel = await panelFor(character.id, 'action', 'name', 'reloadFixedMagazine');
    await page.evaluate(`document.querySelector('${reloadPanel} [data-widget-control*="reloadFixedMagazine"]').click()`);
    await page.until(`document.getElementById('fixed-reload-modal')?.getClientRects().length>0`, 'reload uses existing ammunition dialog');
    await page.evaluate(`document.getElementById('fixed-reload-modal').remove()`);
    await page.evaluate(`window.openCharacterSheet(${other.id})`);
    await page.until(`document.body.classList.contains('character-sheet-open') && document.getElementById('character-sheet-name').textContent==='Виджеты — второй'`, 'second character sheet');
    await pinField('health.painLevel');
    await page.evaluate(`window.closeCharacterSheet()`);
    const secondPanel = await panelFor(other.id, 'field', 'path', 'health.painLevel');
    await page.until(`document.querySelector('${secondPanel} [data-widget-control="field:health.painLevel"]') && !document.querySelector('${secondPanel} [data-widget-control="field:health.painLevel"]').disabled`, 'second widget loaded');
    await page.evaluate(`(()=>{const i=document.querySelector('${secondPanel} [data-widget-control="field:health.painLevel"]');i.value='5';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await page.until(`document.querySelector('${secondPanel} [data-widget-control="field:health.painLevel"]')?.value==='5' && !document.querySelector('${secondPanel} [data-widget-control="field:health.painLevel"]').disabled`, 'second character save');
    assert.equal((await request(`/lobbies/characters/${other.id}`, null, token, 'GET')).data.health.painLevel, 5);
    const updated = await request(`/lobbies/characters/${character.id}`, null, token, 'GET');
    updated.data.health.painLevel = 7;
    await request(`/lobbies/characters/${character.id}`, { data: updated.data }, token, 'PUT');
    await page.until(`document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]')?.value==='7'`, 'remote update of another pinned character');
    const reordered = await request(`/lobbies/characters/${character.id}`, null, token, 'GET');
    reordered.data.weapons.unshift({ id: 'other-pistol', name: 'Other pistol', templateId: template.id + 1000000, type: 'firearm', ammo: 1 });
    await request(`/lobbies/characters/${character.id}`, { data: reordered.data }, token, 'PUT');
    const armorPanel = await panelFor(character.id, 'field', 'path', 'equipment.armor.currentStageDurability');
    await page.evaluate(`(()=>{const i=document.querySelector('${armorPanel} [data-widget-control="field:$item.currentStageDurability"]');i.value='17';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await page.until(`document.querySelector('${armorPanel} [data-widget-control="field:$item.currentStageDurability"]')?.value==='17' && !document.querySelector('${armorPanel} [data-widget-control="field:$item.currentStageDurability"]').disabled`, 'armor uses existing field persistence');
    assert.equal((await request(`/lobbies/characters/${character.id}`, null, token, 'GET')).data.equipment.armor.currentStageDurability, 17);
    // A stored reload reference follows its weapon after a list reorder.
    await page.evaluate(`document.querySelector('${reloadPanel} [data-widget-control*="reloadFixedMagazine"]').click()`);
    await page.until(`document.getElementById('fixed-reload-modal')?.getClientRects().length>0`, 'reload follows weapon identity after reorder');
    await page.evaluate(`document.getElementById('fixed-reload-modal').remove()`);
    const attackPanel = await panelFor(character.id, 'action', 'name', 'useWeaponFromEquipment');
    await page.evaluate(`document.querySelector('${attackPanel} [data-widget-control*="useWeaponFromEquipment"]').click()`);
    await page.until(`document.querySelector('${attackPanel} [data-widget-control*="useWeaponFromEquipment"]')?.disabled===false`, 'existing weapon action completed');
    const afterShot = await request(`/lobbies/characters/${character.id}`, null, token, 'GET');
    assert.equal(afterShot.data.weapons.find(weapon => weapon.id === 'widget-pistol').ammo, 2);
    assert.equal(afterShot.data.weapons.find(weapon => weapon.id === 'other-pistol').ammo, 1);
    // Native drag and folding use the same panel position store as other room UI.
    const header = await page.evaluate(`(()=>{const r=document.querySelector('${painPanel} .panel-header').getBoundingClientRect();return {x:r.left+25,y:r.top+15}})()`);
    await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...header,button:'left',buttons:1,clickCount:1});
    await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:header.x+40,y:header.y+20,button:'left',buttons:1});
    await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:header.x+40,y:header.y+20,button:'left',buttons:0,clickCount:1});
    const position = await page.evaluate(`(()=>{const r=document.querySelector('${painPanel}').getBoundingClientRect();return {left:r.left,top:r.top}})()`);
    await page.evaluate(`document.querySelector('${painPanel} .toggle-btn').click();window.widgetsBeforeReload=true`);
    await page.call('Page.reload');
    await page.until(`!window.widgetsBeforeReload && document.querySelector('${painPanel} .widget-character-name') && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'pin preferences after reload');
    assert.equal(await page.evaluate(`document.querySelector('${painPanel}').classList.contains('collapsed')`), true);
    assert.deepEqual(await page.evaluate(`(()=>{const r=document.querySelector('${painPanel}').getBoundingClientRect();return {left:r.left,top:r.top}})()`), position);
    assert.equal((await prefs()).length, savedCount + 1);
    await page.evaluate(`document.querySelector('${painPanel} .toggle-btn').click();window.openCharacterSheet(${character.id})`);
    await page.until(`document.body.classList.contains('character-sheet-open')`, 'sheet reopened over widgets');
    assert.equal(await page.evaluate(`document.querySelector('[name="health.painLevel"]').value`), '7');
    const screenshot = path.join(profile, 'character-sheet-pins.png');
    fs.writeFileSync(screenshot, Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    console.log('Sheet pins screenshot:', screenshot);
    await page.evaluate(`window.closeCharacterSheet();(async()=>{window.sceneModule=await import('/static/js/lobby3d.js');sceneModule.controls.target.set(31.5,1,10.5);sceneModule.camera.position.set(35,9,19);sceneModule.controls.update()})()`);
    await page.evaluate(`new Promise(resolve=>setTimeout(resolve,1000))`);
    const mapScreenshot = path.join(profile, 'character-map-widgets.png');
    fs.writeFileSync(mapScreenshot, Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    console.log('Map widgets screenshot:', mapScreenshot);
    const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const protocol = await connect(version.webSocketDebuggerUrl);
    let player;
    try {
        await request('/auth/register', { username: 'widgets-viewer', email: 'widgets-viewer@example.test', password: 'widget-test-password' });
        const viewer = await request('/auth/login', { username: 'widgets-viewer', password: 'widget-test-password' });
        await request(`/lobbies/${lobby.id}/join`, {}, viewer.access_token);
        await request(`/lobbies/characters/${character.id}`, { visible_to: [viewer.user_id], editable_to: [] }, token, 'PUT');
        const context = await protocol.call('Target.createBrowserContext');
        const target = await protocol.call('Target.createTarget', { url: base, browserContextId: context.browserContextId });
        const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        player = await connect(pages.find(item => item.id === target.targetId).webSocketDebuggerUrl);
        await player.call('Page.enable'); await player.call('Runtime.enable');
        await player.until(`location.origin===${JSON.stringify(base)}`, 'viewer origin');
        await player.evaluate(`localStorage.setItem('access_token',${JSON.stringify(viewer.access_token)});localStorage.setItem('user_id',${JSON.stringify(String(viewer.user_id))})`);
        await player.call('Page.navigate', { url: `${base}/lobbies/${lobby.id}/page` });
        await player.until(`window.isGM===false && document.getElementById('character-widgets') && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'viewer room');
        assert.equal(await player.evaluate(`document.querySelectorAll('.character-widget').length`), 0, 'pins are personal');
        await player.evaluate(`window.openCharacterSheet(${character.id})`);
        await player.until(`document.querySelector('.sheet-pin[data-pin-block="health-status"]')`, 'read-only sheet pin');
        await player.evaluate(`document.querySelector('.sheet-pin[data-pin-block="health-status"]').click();window.closeCharacterSheet()`);
        await player.until(`document.querySelector('.character-widget [data-widget-control="field:health.painLevel"]')?.disabled===true`, 'read-only widget respects edit permissions');
        const gmPinCount = (await prefs()).length;
        await request(`/lobbies/characters/${character.id}`, { editable_to: [viewer.user_id] }, token, 'PUT');
        await player.until(`document.querySelector('.character-widget [data-widget-control="field:health.painLevel"]')?.disabled===false`, 'granted editor permission revalidated');
        await player.evaluate(`(()=>{const i=document.querySelector('.character-widget [data-widget-control="field:health.painLevel"]');i.value='9';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await player.until(`document.querySelector('.character-widget [data-widget-control="field:health.painLevel"]')?.value==='9' && !document.querySelector('.character-widget [data-widget-control="field:health.painLevel"]').disabled`, 'player widget edit saved');
        await page.until(`document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]')?.value==='9'`, 'player widget change reaches GM');
        assert.equal((await prefs()).length, gmPinCount, 'player pins do not modify GM preferences');
        await request(`/lobbies/characters/${character.id}`, { visible_to: [], editable_to: [] }, token, 'PUT');
        await player.evaluate(`window.dispatchEvent(new Event('focus'))`);
        await player.until(`!document.querySelector('.character-widget [data-widget-control="field:health.painLevel"]') && document.querySelector('.character-widget .panel-content').textContent.includes('недоступен')`, 'revoked access clears widget values');
        await protocol.call('Target.closeTarget', { targetId: target.targetId });
        await protocol.call('Target.disposeBrowserContext', { browserContextId: context.browserContextId });
        console.log('PASS: real player has personal pins, read-only access, granted edits and revoked access; updates reach GM');
    } finally { player?.close(); protocol.close(); }
    const location = await request(`/lobbies/${lobby.id}/locations`, { name: 'Widget scene', type: 'battle',
        grid_width: 5, grid_height: 5, world_tile_x: 10, world_tile_z: 10,
        tiles_data: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'grass', height: 1 }))) }, token);
    await page.call('Page.bringToFront');
    await page.evaluate(`window.enterLocation(${location.id})`);
    await page.until(`window.isLocationActive && document.getElementById('scene-loading-screen').classList.contains('is-hidden')`, 'real local scene ready');
    await page.evaluate(`window.openCharacterSheet(${character.id})`);
    await page.until(`document.body.classList.contains('character-sheet-open')`, 'sheet over local scene');
    assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('exit-location-btn')).visibility==='hidden' && [...document.querySelectorAll('.scene-fps-counter')].every(e=>getComputedStyle(e).visibility==='hidden')`), true);
    assert.equal(await page.evaluate(`[...document.querySelectorAll('.draggable-panel,#combat-status-panel,#character-widgets')].every(e=>getComputedStyle(e).visibility==='hidden')`), true);
    await page.evaluate(`window.closeCharacterSheet()`);
    assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('exit-location-btn')).visibility`), 'visible');
    await page.evaluate(`(()=>{const i=document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]');i.value='10';i.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await page.until(`document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]')?.value==='10' && !document.querySelector('${painPanel} [data-widget-control="field:health.painLevel"]').disabled`, 'widget works on local scene');
    assert.equal((await request(`/lobbies/characters/${character.id}`, null, token, 'GET')).data.health.painLevel, 10);
    const localScreenshot = path.join(profile, 'character-widgets-local-scene.png');
    fs.writeFileSync(localScreenshot, Buffer.from((await page.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    console.log('Local widgets screenshot:', localScreenshot);
    await page.evaluate(`document.querySelector('${secondPanel} .panel-header button').click()`);
    assert.equal(await page.evaluate(`!!document.querySelector('${secondPanel}')`), false);
    assert.equal((await prefs()).length, savedCount);
    console.log('PASS: same widgets work in real local scene; sheet masks local controls/FPS and restores them');
    console.log('PASS: individual fields/actions, weapon/status blocks, hidden room UI, multi-character saves, existing skill roll and reload dialog, realtime updates, personal preferences, drag/collapse/reload');
};
