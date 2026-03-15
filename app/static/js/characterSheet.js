// static/js/characterSheet.js
import { getCharacter, updateCharacter } from './api.js';
import { showNotification } from './utils.js';
import { lobbyParticipants } from './ui.js';
import { getSocket } from './socketHandlers.js';

let currentCharacterId = null;
let currentCharacterData = null;
let autoSaveTimer = null;
const AUTO_SAVE_DELAY = 1500;

// Кеш шаблонов для текущей комнаты
let templatesCache = {};
let currentLobbyId = null;
let cachedBackpackTemplates = [];

// Экспортируем функцию для установки lobbyId
export function setCurrentLobbyId(id) {
    currentLobbyId = id;
}

// Вспомогательная функция для загрузки шаблонов
async function loadTemplatesForLobby(type) {
    if (!currentLobbyId) throw new Error('Lobby ID not set');
    const cacheKey = `${currentLobbyId}_${type}`;
    if (templatesCache[cacheKey]) return templatesCache[cacheKey];

    const token = localStorage.getItem('access_token');
    const response = await fetch(`/lobbies/${currentLobbyId}/templates/${type}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to load templates');
    }
    const data = await response.json();
    const all = [
        ...data.global.map(t => ({ ...t, source: 'global' })),
        ...data.local.map(t => ({ ...t, source: 'local' }))
    ];
    templatesCache[cacheKey] = all;
    return all;
}

// Очистка кеша (полезна при создании/удалении шаблона)
function clearTemplatesCache(type) {
    if (type) {
        delete templatesCache[`${currentLobbyId}_${type}`];
    } else {
        Object.keys(templatesCache).forEach(key => {
            if (key.startsWith(currentLobbyId + '_')) {
                delete templatesCache[key];
            }
        });
    }
}

// Вспомогательные функции
function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function setValueByPath(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const index = parseInt(part, 10);
        if (!isNaN(index) && part === index.toString()) {
            if (!Array.isArray(current)) current = [];
            if (typeof current[index] !== 'object' || current[index] === null) {
                current[index] = {};
            }
            current = current[index];
        } else {
            if (typeof current[part] !== 'object' || current[part] === null) {
                current[part] = {};
            }
            current = current[part];
        }
    }
    const lastPart = parts[parts.length - 1];
    const lastIndex = parseInt(lastPart, 10);
    if (!isNaN(lastIndex) && lastPart === lastIndex.toString()) {
        if (!Array.isArray(current)) current = [];
        current[lastIndex] = value;
    } else {
        current[lastPart] = value;
    }
}

function updateDataFromFields() {
    if (!currentCharacterData) currentCharacterData = {};
    const form = document.getElementById('character-sheet-form');
    if (!form) return;

    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        const name = input.getAttribute('name');
        if (!name) return;
        let value;
        if (input.type === 'checkbox') {
            value = input.checked;
        } else if (input.type === 'number') {
            value = input.value === '' ? null : parseFloat(input.value);
        } else {
            value = input.value;
        }
        setValueByPath(currentCharacterData, name, value);
    });
}

function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        if (currentCharacterId) {
            updateDataFromFields();
            const socket = getSocket();
            if (socket) {
                socket.emit('update_character_data', {
                    token: localStorage.getItem('access_token'),
                    character_id: currentCharacterId,
                    updates: { data: currentCharacterData }
                });
            } else {
                updateCharacter(currentCharacterId, { data: currentCharacterData })
                    .then(() => console.log('Auto-saved via HTTP'))
                    .catch(err => showNotification('Ошибка автосохранения: ' + err.message));
            }
        }
    }, AUTO_SAVE_DELAY);
}

async function renderCharacterSheet(characterName, data) {
    document.getElementById('character-sheet-name').textContent = characterName;
    const tabsContainer = document.getElementById('sheet-tabs');
    const contentContainer = document.getElementById('sheet-content');
    tabsContainer.innerHTML = '';
    contentContainer.innerHTML = '';

    const tabs = [
        { id: 'basic', title: 'Основное' },
        { id: 'skills', title: 'Навыки' },
        { id: 'equipment', title: 'Экипировка' },
        { id: 'inventory', title: 'Инвентарь' },
        { id: 'settings', title: 'Настройки' },
        { id: 'notes', title: 'Заметки' }
    ];

    tabs.forEach((tab, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tab-btn ${index === 0 ? 'active' : ''}`;
        btn.dataset.tab = tab.id;
        btn.textContent = tab.title;
        btn.onclick = () => switchSheetTab(tab.id);
        tabsContainer.appendChild(btn);

        const contentDiv = document.createElement('div');
        contentDiv.id = `sheet-tab-${tab.id}`;
        contentDiv.className = `sheet-tab-content ${index === 0 ? 'active' : ''}`;
        contentContainer.appendChild(contentDiv);
    });

    await renderBasicTab(data);
    renderSkillsTab(data);
    await renderEquipmentTab(data);
    await renderInventoryTab(data);
    renderNotesTab(data);
    renderSettingsTab(data);

    const form = document.getElementById('character-sheet-form');
    if (form) {
        form.addEventListener('input', scheduleAutoSave);
        form.addEventListener('change', scheduleAutoSave);
    }
}

function switchSheetTab(tabId) {
    document.querySelectorAll('#sheet-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.sheet-tab-content').forEach(div => {
        div.classList.toggle('active', div.id === `sheet-tab-${tabId}`);
    });
}

// ---------- Вкладка Основное ----------
async function renderBasicTab(data) {
    const container = document.getElementById('sheet-tab-basic');
    const basic = data.basic || {};
    const bg = basic.background || {};
    const inv = data.inventory || {};

    // Загружаем шаблоны детекторов и контейнеров
    let detectorTemplates = [];
    let containerTemplates = [];
    try {
        detectorTemplates = await loadTemplatesForLobby('detectors');
        containerTemplates = await loadTemplatesForLobby('containers');
    } catch (e) {
        console.error('Failed to load templates', e);
    }

    const backgroundOptions = [
        'Одиночка', 'Ученый', 'Военный', 'Медик', 'Бандит', 'Наемник', 'Бродяга', 'Другой'
    ];
    const bgSelect = backgroundOptions.map(opt =>
        `<option value="${opt}" ${bg.name === opt ? 'selected' : ''}>${opt}</option>`
    ).join('');

    const skillCategories = [
        { label: 'Сила', path: 'physical.strength' },
        { label: 'Ловкость', path: 'physical.agility' },
        { label: 'Воля', path: 'physical.will' },
        { label: 'Метание', path: 'physical.throwing' },
        { label: 'Внимательность', path: 'physical.awareness' },
        { label: 'Ближний бой', path: 'physical.melee' },
        { label: 'Стрельба', path: 'physical.shooting' },
        { label: 'Харизма', path: 'social.charisma' },
        { label: 'Бартер', path: 'social.barter' },
        { label: 'Убеждение', path: 'social.persuasion' },
        { label: 'Обман', path: 'social.deception' },
        { label: 'Устрашение', path: 'social.intimidation' },
        { label: 'Медицина', path: 'other.medicine' },
        { label: 'Инженерия', path: 'other.engineering' },
        { label: 'Скрытность', path: 'other.stealth' },
        { label: 'Тактика', path: 'other.tactics' },
        { label: 'Выживание', path: 'other.survival' }
    ];

    const skillBonuses = Array.isArray(bg.skillBonuses) ? bg.skillBonuses : [];
    let skillBonusesHtml = '';
    skillBonuses.forEach((bonus, index) => {
        skillBonusesHtml += `
            <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 5px;">
                <select name="basic.background.skillBonuses.${index}.skill" class="form-control" style="flex:2;">
                    ${skillCategories.map(cat => `<option value="${cat.path}" ${bonus.skill === cat.path ? 'selected' : ''}>${cat.label}</option>`).join('')}
                </select>
                <input type="number" class="form-control number-input" name="basic.background.skillBonuses.${index}.bonus" value="${bonus.bonus || 0}" style="width: 60px;" placeholder="Бонус">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeBackgroundSkillBonus(${index})">✕</button>
            </div>
        `;
    });

    // Левая колонка
    let leftHtml = `
        <div style="display: flex; gap: 20px; flex-wrap: wrap; align-items: center; margin-bottom: 15px;">
            <div style="flex: 2; min-width: 200px;">
                <label>Имя</label>
                <input type="text" class="form-control" name="basic.name" value="${escapeHtml(basic.name || '')}" style="width:100%;">
            </div>
            <div style="width: 100px;">
                <label>Возраст</label>
                <input type="number" class="form-control number-input" name="basic.age" value="${basic.age !== undefined ? basic.age : ''}" style="width:100%;">
            </div>
            <div style="min-width: 200px;">
                <label>Организация</label>
                <input type="text" class="form-control" name="basic.organization" value="${escapeHtml(basic.organization || '')}" style="width:100%;">
            </div>
        </div>

        <hr>
        <h4>Предыстория</h4>
        <div style="margin-bottom: 10px;">
            <label>Название</label>
            <select name="basic.background.name" class="form-control" style="width:100%;" onchange="toggleCustomBackground(this)">
                ${bgSelect}
                <option value="custom" ${bg.name && !backgroundOptions.includes(bg.name) ? 'selected' : ''}>Свой вариант</option>
            </select>
            <input type="text" id="custom-background" class="form-control" style="width:100%; margin-top:5px; ${bg.name && !backgroundOptions.includes(bg.name) ? '' : 'display:none;'}" placeholder="Введите свою предысторию" value="${bg.name && !backgroundOptions.includes(bg.name) ? escapeHtml(bg.name) : ''}">
        </div>
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
            <div style="flex: 1;">
                <label>Плюсы</label>
                <textarea class="form-control" name="basic.background.pluses" rows="5" style="min-height: auto;">${escapeHtml(bg.pluses || '')}</textarea>
            </div>
            <div style="flex: 1;">
                <label>Минусы</label>
                <textarea class="form-control" name="basic.background.minuses" rows="5" style="min-height: auto;">${escapeHtml(bg.minuses || '')}</textarea>
            </div>
        </div>
        <div>
            <label>Бонусы к навыкам</label>
            <div id="background-skill-bonuses">
                ${skillBonusesHtml}
            </div>
            <button type="button" class="btn btn-sm" onclick="addBackgroundSkillBonus()">+ Добавить бонус навыка</button>
        </div>

        <hr>
        <h4>Снаряжение</h4>
        <div style="display: flex; gap: 20px; margin-bottom: 15px; flex-wrap: wrap;">
            <div>
                <label class="money-label">Деньги</label>
                <input type="number" class="form-control number-input" name="inventory.money" value="${inv.money || 0}" style="width: 100px;">
            </div>
            <div style="display: flex; flex-direction: column;">
                <label>Детектор аномалий</label>
                <select name="inventory.detectors.anomaly.templateId" class="form-control" style="width: 150px;">
                    <option value="">-- Выберите --</option>
                    ${detectorTemplates.filter(t => t.type === 'anomaly').map(t =>
                        `<option value="${t.id}" ${inv.detectors?.anomaly?.templateId === t.id ? 'selected' : ''}>${t.name}</option>`
                    ).join('')}
                </select>
                <input type="number" class="form-control number-input" name="inventory.detectors.anomaly.bonus" value="${inv.detectors?.anomaly?.bonus || 0}" placeholder="Бонус" style="width: 70px; margin-top: 5px;">
            </div>
            <div style="display: flex; flex-direction: column;">
                <label>Детектор артефактов</label>
                <select name="inventory.detectors.artifact.templateId" class="form-control" style="width: 150px;">
                    <option value="">-- Выберите --</option>
                    ${detectorTemplates.filter(t => t.type === 'artifact').map(t =>
                        `<option value="${t.id}" ${inv.detectors?.artifact?.templateId === t.id ? 'selected' : ''}>${t.name}</option>`
                    ).join('')}
                </select>
                <input type="number" class="form-control number-input" name="inventory.detectors.artifact.bonus" value="${inv.detectors?.artifact?.bonus || 0}" placeholder="Бонус" style="width: 70px; margin-top: 5px;">
            </div>
        </div>
        <button type="button" class="btn btn-sm btn-secondary" onclick="addContainer()" style="margin-top: 10px; margin-bottom: 10px;">+ Добавить контейнер</button>
        <h4>Контейнеры на броне</h4>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${Array.isArray(inv.containers) ? inv.containers.map((cont, idx) => {
                const selectedTemplate = containerTemplates.find(t => t.id === cont.templateId);
                const options = containerTemplates.map(t =>
                    `<option value="${t.id}" ${cont.templateId === t.id ? 'selected' : ''}>${t.name}</option>`
                ).join('');
                return `
                    <div style="position: relative;">
                        <select name="inventory.containers.${idx}.templateId" class="form-control" style="width: 150px;">
                            <option value="">-- Выберите --</option>
                            ${options}
                        </select>
                        <input type="text" class="form-control" name="inventory.containers.${idx}.effect" value="${escapeHtml(cont.effect || selectedTemplate?.effect || '')}" placeholder="Содержимое" style="width: 150px; margin-top: 5px;">
                        <button type="button" class="btn btn-sm btn-danger" onclick="removeContainer(${idx})" style="position: absolute; top: 0; right: -30px;">✕</button>
                    </div>
                `;
            }).join('') : ''}
        </div>
    `;

    // Правая колонка со здоровьем
    let rightHtml = `<div id="health-right-column"></div>`;

    // Общий HTML с двумя колонками
    let html = `
        <div style="display: flex; gap: 20px;">
            <div style="flex: 1;">${leftHtml}</div>
            <div style="flex: 1;">${rightHtml}</div>
        </div>
    `;
    container.innerHTML = html;

    const healthContainer = document.getElementById('health-right-column');
    renderHealthTab(data, healthContainer);

    window.toggleCustomBackground = function(select) {
        const customInput = document.getElementById('custom-background');
        if (select.value === 'custom') {
            customInput.style.display = 'block';
        } else {
            customInput.style.display = 'none';
        }
    };
}

window.addContainer = function() {
    updateDataFromFields();
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!Array.isArray(currentCharacterData.inventory.containers)) {
        currentCharacterData.inventory.containers = [];
    }
    currentCharacterData.inventory.containers.push({});
    renderBasicTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeContainer = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.inventory?.containers) return;
    currentCharacterData.inventory.containers.splice(index, 1);
    renderBasicTab(currentCharacterData);
    scheduleAutoSave();
};

window.addBackgroundSkillBonus = function() {
    updateDataFromFields();
    if (!currentCharacterData.basic) currentCharacterData.basic = {};
    if (!currentCharacterData.basic.background) currentCharacterData.basic.background = {};
    if (!Array.isArray(currentCharacterData.basic.background.skillBonuses)) {
        currentCharacterData.basic.background.skillBonuses = [];
    }
    currentCharacterData.basic.background.skillBonuses.push({ skill: 'physical.strength', bonus: 0 });
    renderBasicTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeBackgroundSkillBonus = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.basic?.background?.skillBonuses) return;
    currentCharacterData.basic.background.skillBonuses.splice(index, 1);
    renderBasicTab(currentCharacterData);
    scheduleAutoSave();
};

// ---------- Вкладка Здоровье ----------
function renderHealthTab(data, container = null) {
    const targetContainer = container || document.getElementById('sheet-tab-health');
    if (!targetContainer) return;

    const health = data.health || {};
    const zones = health.zones || {};

    const bloodOptions = [
        { value: 'normal', label: 'Нормально' },
        { value: 'light', label: 'Легкая кровопотеря' },
        { value: 'medium', label: 'Средняя кровопотеря' },
        { value: 'severe', label: 'Сильная кровопотеря' },
        { value: 'critical', label: 'Критическая кровопотеря' }
    ];
    const bloodSelect = bloodOptions.map(opt =>
        `<option value="${opt.value}" ${health.blood === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');

    let html = `
        <div class="health-tab">
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 15px;">
                <div style="width: 180px;">
                    <label>Кровь</label>
                    <select class="form-control" name="health.blood" style="width:100%;">${bloodSelect}</select>
                </div>
                <div style="width: 80px;">
                    <label>Стресс</label>
                    <input type="number" class="form-control" name="health.stress" value="${health.stress || 0}">
                </div>
                <div style="width: 80px;">
                    <label>Ур. боли</label>
                    <input type="number" class="form-control" name="health.painLevel" value="${health.painLevel || 0}">
                </div>
                <div style="width: 80px;">
                    <label>Истощение</label>
                    <input type="number" class="form-control" name="health.exhaustion" value="${health.exhaustion || 0}">
                </div>
                <div style="width: 80px;">
                    <label>Радиация</label>
                    <input type="number" class="form-control" name="health.radiation" value="${health.radiation || 0}">
                </div>
            </div>
            <hr>
            <h4>Зоны тела</h4>
            <div class="zone-grid-vertical">
    `;

    const zoneOrder = [
        { key: 'head', label: 'Голова' },
        { key: 'chest', label: 'Грудь' },
        { key: 'abdomen', label: 'Живот' },
        { key: 'leftArm', label: 'Левая рука' },
        { key: 'rightArm', label: 'Правая рука' },
        { key: 'leftLeg', label: 'Левая нога' },
        { key: 'rightLeg', label: 'Правая нога' }
    ];

    zoneOrder.forEach(({ key, label }) => {
        const zone = zones[key] || { current: 100, max: 100 };
        html += `
            <div class="zone-item-vertical">
                <div class="zone-label">${label}</div>
                <div class="zone-fields">
                    <input type="number" class="number-input" name="health.zones.${key}.current" value="${zone.current || 0}" placeholder="Тек">
                    <span class="slash">/</span>
                    <input type="number" class="number-input" name="health.zones.${key}.max" value="${zone.max || 100}" placeholder="Макс">
                </div>
            </div>
        `;
    });
    html += `</div><hr>`;

    const effects = Array.isArray(health.effects) ? health.effects : [];
    let effectsHtml = '';
    effects.forEach((effect, index) => {
        const name = effect.name || '';
        const value = effect.value || 0;
        effectsHtml += `
            <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                <input list="effect-names" class="form-control" name="health.effects.${index}.name" value="${escapeHtml(name)}" placeholder="Название эффекта" style="flex:2;">
                <datalist id="effect-names">
                    <option value="Отравление">
                    <option value="Кровотечение">
                    <option value="Перелом">
                    <option value="Слабость">
                    <option value="Тошнота">
                    <option value="Головокружение">
                </datalist>
                <input type="number" class="form-control number-input" name="health.effects.${index}.value" value="${value}" placeholder="Знач" style="width:80px;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeEffect(${index})">✕</button>
            </div>
        `;
    });

    html += `
        <h4>Эффекты</h4>
        <div id="effects-container">
            ${effectsHtml}
        </div>
        <button type="button" class="btn btn-sm" onclick="addEffect()">+ Добавить эффект</button>
        </div>
    `;

    targetContainer.innerHTML = html;
}

window.addEffect = function() {
    updateDataFromFields();
    if (!currentCharacterData.health) currentCharacterData.health = {};
    if (!Array.isArray(currentCharacterData.health.effects)) {
        currentCharacterData.health.effects = [];
    }
    currentCharacterData.health.effects.push({ name: '', value: 0 });
    const healthContainer = document.getElementById('health-right-column');
    if (healthContainer) {
        renderHealthTab(currentCharacterData, healthContainer);
    } else {
        renderHealthTab(currentCharacterData);
    }
    scheduleAutoSave();
};

window.removeEffect = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.health?.effects) return;
    currentCharacterData.health.effects.splice(index, 1);
    const healthContainer = document.getElementById('health-right-column');
    if (healthContainer) {
        renderHealthTab(currentCharacterData, healthContainer);
    } else {
        renderHealthTab(currentCharacterData);
    }
    scheduleAutoSave();
};

// ---------- Вкладка Навыки ----------
async function renderSkillsTab(data) {
    const container = document.getElementById('sheet-tab-skills');
    const skills = data.skills || {};
    const physical = skills.physical || {};
    const social = skills.social || {};
    const other = skills.other || {};
    const specialized = skills.specialized || {};

    // Загружаем шаблоны особых черт
    let specialTraitTemplates = [];
    try {
        specialTraitTemplates = await loadTemplatesForLobby('special_traits');
    } catch (e) {
        console.error('Failed to load special trait templates', e);
    }

    const physicalSkills = [
        { key: 'strength', label: 'Сила' },
        { key: 'agility', label: 'Ловкость' },
        { key: 'will', label: 'Воля' },
        { key: 'throwing', label: 'Метание' },
        { key: 'awareness', label: 'Внимательность' },
        { key: 'melee', label: 'Ближний бой' },
        { key: 'shooting', label: 'Стрельба' }
    ];
    const socialSkills = [
        { key: 'charisma', label: 'Харизма' },
        { key: 'barter', label: 'Бартер' },
        { key: 'persuasion', label: 'Убеждение' },
        { key: 'deception', label: 'Обман' },
        { key: 'intimidation', label: 'Устрашение' }
    ];
    const otherSkills = [
        { key: 'medicine', label: 'Медицина' },
        { key: 'engineering', label: 'Инженерия' },
        { key: 'stealth', label: 'Скрытность' },
        { key: 'tactics', label: 'Тактика' },
        { key: 'survival', label: 'Выживание' }
    ];

    function renderSkillRow(label, base, bonus, path) {
        return `
            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 5px;">
                <span style="min-width: 120px; white-space: normal; word-break: break-word; cursor: pointer;" onclick="window.rollSkill('${path}', '${label}')">${label}</span>
                <input type="number" class="form-control number-input" name="skills.${path}.base" value="${base}" style="width: 60px;">
                <span>+</span>
                <input type="number" class="form-control number-input" name="skills.${path}.bonus" value="${bonus}" style="width: 60px;">
                <span style="cursor: pointer; font-size: 1.2em;" onclick="window.rollSkill('${path}', '${label}')">🎲</span>
            </div>
        `;
    }

    let html = '';
    html += `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 20px;">`;

    // Колонка 1: Физические навыки
    html += `<div>`;
    html += `<h4>Физические</h4>`;
    physicalSkills.forEach(s => {
        const skillObj = physical[s.key] || { base: 5, bonus: 0 };
        html += renderSkillRow(s.label, skillObj.base, skillObj.bonus, `physical.${s.key}`);
    });
    html += `</div>`;

    // Колонка 2: Социальные навыки
    html += `<div>`;
    html += `<h4>Социальные</h4>`;
    socialSkills.forEach(s => {
        const skillObj = social[s.key] || { base: 5, bonus: 0 };
        html += renderSkillRow(s.label, skillObj.base, skillObj.bonus, `social.${s.key}`);
    });
    html += `</div>`;

    // Колонка 3: Прочие навыки
    html += `<div>`;
    html += `<h4>Прочие</h4>`;
    otherSkills.forEach(s => {
        const skillObj = other[s.key] || { base: 5, bonus: 0 };
        html += renderSkillRow(s.label, skillObj.base, skillObj.bonus, `other.${s.key}`);
    });
    html += `</div>`;

    // Колонка 4: Владение оружием
    html += `<div>`;
    html += `<h4>Владение оружием</h4>`;
    const levelOptions = [
        { value: 'unfamiliar', label: 'Не знаком' },
        { value: 'familiar', label: 'Знаком' },
        { value: 'professional', label: 'Профессионал' }
    ];
    const specLabels = {
        pistols: 'Пистолеты', shotguns: 'Дробовики', smgs: 'ПП',
        assaultRifles: 'Штурмовые', sniperRifles: 'Снайперские',
        grenadeLaunchers: 'Гранатометы', machineGuns: 'Пулеметы'
    };
    for (const [key, label] of Object.entries(specLabels)) {
        const level = specialized[key]?.level || 'unfamiliar';
        const select = levelOptions.map(opt =>
            `<option value="${opt.value}" ${level === opt.value ? 'selected' : ''}>${opt.label}</option>`
        ).join('');
        html += `
            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 5px;">
                <span style="min-width: 110px; white-space: normal; word-break: break-word;">${label}</span>
                <select name="skills.specialized.${key}.level" class="form-control" style="width: 100px;">${select}</select>
            </div>
        `;
    }
    html += `</div>`;
    html += `</div>`;

    html += `
        <hr>
        <div style="display: flex; gap: 15px;">
            <div><label>Очки навыков</label><input type="number" class="form-control number-input" name="skills.skillPoints" value="${skills.skillPoints || 30}"></div>
            <div><label>Специализации</label><input type="number" class="form-control number-input" name="skills.specializations" value="${skills.specializations || 10}"></div>
        </div>
        <h4>Особые черты</h4>
        <div id="special-traits-container"></div>
        <button type="button" class="btn btn-sm" onclick="addSpecialTrait()">+ Добавить</button>
        ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateSpecialTraitTemplateModal()">➕ Создать кастом</button>` : ''}
    `;

    container.innerHTML = html;
    renderSpecialTraits(data.features?.specialTraits || [], specialTraitTemplates);
}

// static/js/characterSheet.js — обновлённая функция renderSpecialTraits без поля "Название"

function renderSpecialTraits(traits, templates) {
    const container = document.getElementById('special-traits-container');
    if (!container) return;
    container.innerHTML = '';

    traits.forEach((trait, index) => {
        const selectedTemplateId = trait.templateId ? parseInt(trait.templateId, 10) : null;
        const optionsHtml = templates.map(t =>
            `<option value="${t.id}" ${selectedTemplateId === t.id ? 'selected' : ''}>${t.name}</option>`
        ).join('');

        const div = document.createElement('div');
        div.className = 'trait-item';
        div.innerHTML = `
            <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-bottom: 5px;">
                <select name="features.specialTraits.${index}.templateId" class="form-control" style="min-width:150px; flex: 1;" onchange="fillTraitFromTemplate(this, ${index})">
                    <option value="">-- Выберите особую черту --</option>
                    ${optionsHtml}
                </select>
                <input type="text" class="form-control" name="features.specialTraits.${index}.effect" value="${escapeHtml(trait.effect || '')}" placeholder="Эффект" style="flex: 2;">
                <input type="number" class="form-control number-input" name="features.specialTraits.${index}.cost" value="${trait.cost || 0}" placeholder="Стоимость" style="width: 70px;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeSpecialTrait(${index})">✕</button>
            </div>
        `;
        container.appendChild(div);
    });

    window.fillTraitFromTemplate = async function(select, index) {
        const selectedId = parseInt(select.value, 10);
        if (isNaN(selectedId)) {
            // Пустой выбор — очищаем поля и удаляем привязку к шаблону
            const effectInput = document.querySelector(`[name="features.specialTraits.${index}.effect"]`);
            const costInput = document.querySelector(`[name="features.specialTraits.${index}.cost"]`);
            if (effectInput) effectInput.value = '';
            if (costInput) costInput.value = 0;
            if (currentCharacterData.features?.specialTraits?.[index]) {
                delete currentCharacterData.features.specialTraits[index].templateId;
                delete currentCharacterData.features.specialTraits[index].name;
                currentCharacterData.features.specialTraits[index].effect = '';
                currentCharacterData.features.specialTraits[index].cost = 0;
            }
            scheduleAutoSave();
            return;
        }

        const templates = await loadTemplatesForLobby('special_traits');
        const template = templates.find(t => t.id === selectedId);
        if (!template) return;

        // Обновляем отображаемые поля
        const effectInput = document.querySelector(`[name="features.specialTraits.${index}.effect"]`);
        const costInput = document.querySelector(`[name="features.specialTraits.${index}.cost"]`);
        if (effectInput) effectInput.value = template.effect;
        if (costInput) costInput.value = template.cost;

        // Сохраняем данные (название только в данных)
        if (!currentCharacterData.features) currentCharacterData.features = {};
        if (!currentCharacterData.features.specialTraits) currentCharacterData.features.specialTraits = [];
        const trait = currentCharacterData.features.specialTraits[index];
        trait.name = template.name;
        trait.effect = template.effect;
        trait.cost = template.cost;
        trait.templateId = template.id;

        scheduleAutoSave();
    };
}

// Функция добавления новой особой черты (без шаблона)
window.addSpecialTrait = function() {
    updateDataFromFields();
    if (!currentCharacterData.features) currentCharacterData.features = {};
    if (!Array.isArray(currentCharacterData.features.specialTraits)) {
        currentCharacterData.features.specialTraits = [];
    }
    currentCharacterData.features.specialTraits.push({ name: '', effect: '', cost: 0 });
    // Перерисовываем вкладку навыков, чтобы обновился список
    renderSkillsTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeSpecialTrait = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.features?.specialTraits) return;
    currentCharacterData.features.specialTraits.splice(index, 1);
    renderSkillsTab(currentCharacterData);
    scheduleAutoSave();
};

// Модальное окно для создания кастомной особой черты (GM)
window.openCreateSpecialTraitTemplateModal = function() {
    let modal = document.getElementById('create-special-trait-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-special-trait-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-special-trait-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный шаблон особой черты</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="special-trait-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Эффект</label>
                    <input type="text" id="special-trait-effect" class="form-control">
                </div>
                <div class="form-group">
                    <label>Стоимость</label>
                    <input type="number" id="special-trait-cost" class="form-control number-input" value="0">
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveSpecialTraitTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-special-trait-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
};

window.saveSpecialTraitTemplate = async function() {
    const data = {
        name: document.getElementById('special-trait-name').value,
        effect: document.getElementById('special-trait-effect').value,
        cost: parseInt(document.getElementById('special-trait-cost').value) || 0
    };

    const response = await fetch(`/lobbies/${currentLobbyId}/templates/special_traits`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        clearTemplatesCache('special_traits');
        await renderSkillsTab(currentCharacterData);
        document.getElementById('create-special-trait-template-modal').style.display = 'none';
        showNotification('Шаблон особой черты создан', 'success');
    } else {
        const err = await response.json();
        showNotification(err.message);
    }
};

// ---------- Вкладка Экипировка ----------
async function renderEquipmentTab(data) {
    const container = document.getElementById('sheet-tab-equipment');
    const eq = data.equipment || {};
    const helmet = eq.helmet || {};
    const gasMask = eq.gasMask || {};
    const armor = eq.armor || {};
    const weapons = data.weapons || [];

    if (!helmet.modifications) helmet.modifications = [];
    if (!gasMask.modifications) gasMask.modifications = [];
    if (!armor.modifications) armor.modifications = [];

    const materialOptions = ['Текстиль', 'Композит', 'Кевлар', 'Плита'];
    const conditionOptions = [
        '1. Целая',
        '2. Немного повреждена',
        '3. Повреждена',
        '4. Сильно повреждена',
        '5. Поломана'
    ];

    function protectionGrid(prefix, prot) {
        prot = prot || {};
        return `
            <div class="protection-grid">
                <div>Физ</div><div>Хим</div><div>Терм</div><div>Элек</div><div>Рад</div>
                <input type="number" class="number-input form-control" name="${prefix}.protection.physical" value="${prot.physical || 0}">
                <input type="number" class="number-input form-control" name="${prefix}.protection.chemical" value="${prot.chemical || 0}">
                <input type="number" class="number-input form-control" name="${prefix}.protection.thermal" value="${prot.thermal || 0}">
                <input type="number" class="number-input form-control" name="${prefix}.protection.electric" value="${prot.electric || 0}">
                <input type="number" class="number-input form-control" name="${prefix}.protection.radiation" value="${prot.radiation || 0}">
            </div>
        `;
    }

    let weaponTemplates = [], helmetTemplates = [], gasMaskTemplates = [], armorTemplates = [];
    let modificationTemplates = [], containerTemplates = [], vestTemplates = [], pouchTemplates = [];
    try {
        weaponTemplates = await loadTemplatesForLobby('weapons');
        helmetTemplates = await loadTemplatesForLobby('helmets');
        gasMaskTemplates = await loadTemplatesForLobby('gas_masks');
        armorTemplates = await loadTemplatesForLobby('armor');
        modificationTemplates = await loadTemplatesForLobby('modifications');
        containerTemplates = await loadTemplatesForLobby('containers');
    } catch (e) {
        console.error('Failed to load templates', e);
    }

    const helmetModTemplates = modificationTemplates.filter(t => t.type === 'helmet');
    const gasMaskModTemplates = modificationTemplates.filter(t => t.type === 'gas_mask');
    const armorModTemplates = modificationTemplates.filter(t => t.type === 'armor');
    const pdaModTemplates = modificationTemplates.filter(t => t.type === 'pda');
    const weaponModuleTemplates = modificationTemplates.filter(t => t.type === 'weapon_module' || t.category === 'module');
    const weaponModTemplates = modificationTemplates.filter(t => t.type === 'weapon_modification' || t.category === 'modification');

    function groupByCategory(templates) {
        const grouped = {};
        templates.forEach(t => {
            const cat = t.category || 'Прочее';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(t);
        });
        return grouped;
    }

    const groupedHelmetMods = groupByCategory(helmetModTemplates);
    const groupedGasMaskMods = groupByCategory(gasMaskModTemplates);
    const groupedArmorMods = groupByCategory(armorModTemplates);
    const groupedPdaMods = groupByCategory(pdaModTemplates);

    let html = `
        <!-- Шлем -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Шлем</h4>
                ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateHelmetTemplateModal()">➕ Создать кастом</button>` : ''}
                <span class="protection-header">Защита</span>
            </div>
            <div class="equipment-row">
                <div class="fields-container">
                    <div class="field-group field-name">
                        <label style="text-align: center; width: 100%;">Название</label>
                        <select name="equipment.helmet.templateId" class="form-control" onchange="fillHelmetFromPreset(this)">
                            <option value="">-- Выберите --</option>
                            ${helmetTemplates.map(t => `<option value="${t.id}" ${helmet.templateId === t.id ? 'selected' : ''}>${t.name} ${t.source === 'local' ? '(кастом)' : ''}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Прочность (макс)</label>
                        <input type="number" class="number-input form-control" name="equipment.helmet.maxDurability" value="${helmet.maxDurability || 1}" placeholder="Макс">
                    </div>
                    <div class="field-group field-select">
                        <label style="text-align: center; width: 100%;">Состояние</label>
                        <select name="equipment.helmet.condition" class="form-control">
                            ${conditionOptions.map(opt => `<option value="${opt}" ${helmet.condition === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Стадия</label>
                        <input type="number" class="number-input form-control" name="equipment.helmet.currentDurability" value="${helmet.currentDurability || 1}" placeholder="Тек">
                    </div>
                    <div class="field-group field-select">
                        <label style="text-align: center; width: 100%;">Материал</label>
                        <select name="equipment.helmet.material" class="form-control">
                            ${materialOptions.map(opt => `<option value="${opt}" ${helmet.material === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Точность</label>
                        <input type="number" class="number-input form-control" name="equipment.helmet.accuracyPenalty" value="${helmet.accuracyPenalty || 0}">
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Эргономика</label>
                        <input type="number" class="number-input form-control" name="equipment.helmet.ergonomicsPenalty" value="${helmet.ergonomicsPenalty || 0}">
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Харизма</label>
                        <input type="number" class="number-input form-control" name="equipment.helmet.charismaBonus" value="${helmet.charismaBonus || 0}">
                    </div>
                </div>
                <div class="protection-wrapper">
                    ${protectionGrid('equipment.helmet', helmet.protection)}
                </div>
            </div>
            <div style="margin-top: 15px;">
                <h5>Модификации шлема</h5>
                <div id="helmet-modifications-container">
                    ${renderHelmetModifications(helmet.modifications, groupedHelmetMods)}
                </div>
                <button type="button" class="btn btn-sm btn-secondary" onclick="addHelmetModification()">+ Добавить модификацию</button>
            </div>
        </div>

        <!-- Противогаз -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Противогаз</h4>
                ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateGasMaskTemplateModal()">➕ Создать кастом</button>` : ''}
                <span class="protection-header">Защита</span>
            </div>
            <div class="equipment-row">
                <div class="fields-container">
                    <div class="field-group field-name">
                        <label style="text-align: center; width: 100%;">Название</label>
                        <select name="equipment.gasMask.templateId" class="form-control" onchange="fillGasMaskFromPreset(this)">
                            <option value="">-- Выберите --</option>
                            ${gasMaskTemplates.map(t => `<option value="${t.id}" ${gasMask.templateId === t.id ? 'selected' : ''}>${t.name} ${t.source === 'local' ? '(кастом)' : ''}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-checkbox">
                        <label style="text-align: center; width: 100%;">Надет</label>
                        <input type="checkbox" name="equipment.gasMask.isWorn" ${gasMask.isWorn ? 'checked' : ''}>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Прочность (макс)</label>
                        <input type="number" class="number-input form-control" name="equipment.gasMask.maxDurability" value="${gasMask.maxDurability || 1}" placeholder="Макс">
                    </div>
                    <div class="field-group field-select">
                        <label style="text-align: center; width: 100%;">Состояние</label>
                        <select name="equipment.gasMask.condition" class="form-control">
                            ${conditionOptions.map(opt => `<option value="${opt}" ${gasMask.condition === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Стадия</label>
                        <input type="number" class="number-input form-control" name="equipment.gasMask.currentDurability" value="${gasMask.currentDurability || 1}" placeholder="Тек">
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Фильтр</label>
                        <input type="number" class="number-input form-control" name="equipment.gasMask.filterRemaining" value="${gasMask.filterRemaining || 0}">
                    </div>
                    <div class="field-group field-select">
                        <label style="text-align: center; width: 100%;">Материал</label>
                        <select name="equipment.gasMask.material" class="form-control">
                            ${materialOptions.map(opt => `<option value="${opt}" ${gasMask.material === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Точность</label>
                        <input type="number" class="number-input form-control" name="equipment.gasMask.accuracyPenalty" value="${gasMask.accuracyPenalty || 0}">
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Эргономика</label>
                        <input type="number" class="number-input form-control" name="equipment.gasMask.ergonomicsPenalty" value="${gasMask.ergonomicsPenalty || 0}">
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Харизма</label>
                        <input type="number" class="number-input form-control" name="equipment.gasMask.charismaBonus" value="${gasMask.charismaBonus || 0}">
                    </div>
                </div>
                <div class="protection-wrapper">
                    ${protectionGrid('equipment.gasMask', gasMask.protection)}
                </div>
            </div>
            <div style="margin-top: 15px;">
                <h5>Модификации противогаза</h5>
                <div id="gasMask-modifications-container">
                    ${renderGasMaskModifications(gasMask.modifications, groupedGasMaskMods)}
                </div>
                <button type="button" class="btn btn-sm btn-secondary" onclick="addGasMaskModification()">+ Добавить модификацию</button>
            </div>
        </div>

        <!-- Броня -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Броня</h4>
                ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateArmorTemplateModal()">➕ Создать кастом</button>` : ''}
                <span class="protection-header">Защита</span>
            </div>
            <div class="equipment-row">
                <div class="fields-container">
                    <div class="field-group field-name">
                        <label style="text-align: center; width: 100%;">Название</label>
                        <select name="equipment.armor.templateId" class="form-control" onchange="fillArmorFromPreset(this)">
                            <option value="">-- Выберите --</option>
                            ${armorTemplates.map(t => `<option value="${t.id}" ${armor.templateId === t.id ? 'selected' : ''}>${t.name} ${t.source === 'local' ? '(кастом)' : ''}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Прочность (макс)</label>
                        <input type="number" class="number-input form-control" name="equipment.armor.maxDurability" value="${armor.maxDurability || 1}" placeholder="Макс">
                    </div>
                    <div class="field-group field-select">
                        <label style="text-align: center; width: 100%;">Состояние</label>
                        <select name="equipment.armor.condition" class="form-control">
                            ${conditionOptions.map(opt => `<option value="${opt}" ${armor.condition === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Стадия</label>
                        <input type="number" class="number-input form-control" name="equipment.armor.currentDurability" value="${armor.currentDurability || 1}" placeholder="Тек">
                    </div>
                    <div class="field-group field-select">
                        <label style="text-align: center; width: 100%;">Материал</label>
                        <select name="equipment.armor.material" class="form-control">
                            ${materialOptions.map(opt => `<option value="${opt}" ${armor.material === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Перемещение</label>
                        <input type="number" class="number-input form-control" name="equipment.armor.movementPenalty" value="${armor.movementPenalty || 0}">
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Контейнеры</label>
                        <input type="number" class="number-input form-control" name="equipment.armor.containerSlots" value="${armor.containerSlots || 0}">
                    </div>
                </div>
                <div class="protection-wrapper">
                    ${protectionGrid('equipment.armor', armor.protection)}
                </div>
            </div>
            <div style="margin-top: 15px;">
                <h5>Модификации брони</h5>
                <div id="armor-modifications-container">
                    ${renderArmorModifications(armor.modifications, groupedArmorMods)}
                </div>
                <button type="button" class="btn btn-sm btn-secondary" onclick="addArmorModification()">+ Добавить модификацию</button>
            </div>
        </div>

        <!-- Пояс -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Пояс</h4>
            </div>
            <div style="margin-bottom: 10px;">
                <label>Предмет на поясе</label>
                <select name="equipment.belt.storedItem" class="form-control">
                    <option value="">-- Нет --</option>
                    <optgroup label="Шлемы">
                        ${helmetTemplates.map(t => `<option value="helmet:${t.id}" ${eq.belt?.storedItem === `helmet:${t.id}` ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </optgroup>
                    <optgroup label="Противогазы">
                        ${gasMaskTemplates.map(t => `<option value="gasMask:${t.id}" ${eq.belt?.storedItem === `gasMask:${t.id}` ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </optgroup>
                </select>
            </div>
            <h5>Подсумки</h5>
            <div id="belt-pouches-container">
                ${renderBeltPouches(eq.belt?.pouches || [], pouchTemplates)}
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addBeltPouch()">+ Добавить подсумок</button>
            <h5 style="margin-top: 15px;">Модификации пояса</h5>
            <div id="belt-modifications-container">
                ${renderBeltModifications(eq.belt?.modifications || [], modificationTemplates.filter(t => t.type === 'belt'))}
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addBeltModification()">+ Добавить модификацию</button>
        </div>

        <!-- Разгрузка -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Разгрузка</h4>
                ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateVestTemplateModal()">➕ Создать кастом</button>` : ''}
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 10px; align-items: center;">
                <div style="flex: 1;">
                    <label>Модель</label>
                    <select name="equipment.vest.model" class="form-control" onchange="onVestModelChange(this)">
                        <option value="">-- Выберите модель --</option>
                        <option value="custom" ${eq.vest?.model === 'custom' ? 'selected' : ''}>Своя (база)</option>
                        ${vestTemplates.map(t => `<option value="${t.id}" ${eq.vest?.model === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            ${eq.vest?.model === 'custom' ? `
                <div style="margin-bottom: 10px;">
                    <label>Общий объём</label>
                    <input type="number" class="form-control number-input" name="equipment.vest.totalCapacity" value="${eq.vest?.totalCapacity || 0}" placeholder="Объём">
                </div>
            ` : ''}
            <h5>Подсумки</h5>
            <div id="vest-pouches-container">
                ${renderVestPouches(eq.vest?.pouches || [], pouchTemplates, eq.vest?.model === 'custom', eq.vest?.totalCapacity)}
            </div>
            ${eq.vest?.model === 'custom' ? `<button type="button" class="btn btn-sm btn-secondary" onclick="addVestPouch()">+ Добавить подсумок</button>` : ''}
        </div>

        <!-- Оружие -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Оружие</h4>
                <span class="protection-header"></span>
            </div>
            <div class="equipment-row" style="flex-direction: column; align-items: stretch;">
                <div id="weapons-container"></div>
                <button type="button" class="btn btn-sm" onclick="addWeapon()" style="align-self: flex-start; margin-top: 10px;">+ Добавить оружие</button>
            </div>
        </div>

        <!-- Модификации КПК -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Модификации КПК</h4>
            </div>
            <div id="pda-modifications-container">
                ${renderPdaModifications(data.modifications?.pda?.items || [], groupedPdaMods)}
            </div>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addPdaItem()">+ Добавить модификацию КПК</button>
        </div>
    `;
    container.innerHTML = html;
    await renderWeapons(weapons, weaponTemplates, weaponModuleTemplates, weaponModTemplates);
}

function renderBeltPouches(pouches, pouchTemplates) {
    if (!pouches || pouches.length === 0) return '<p>Нет подсумков</p>';
    let html = '';
    pouches.forEach((pouch, index) => {
        const options = pouchTemplates.map(t =>
            `<option value="${t.id}" ${pouch.type === t.id ? 'selected' : ''}>${t.name} (объём ${t.volume || 0})</option>`
        ).join('');
        html += `
            <div style="display: flex; gap: 10px; margin-bottom: 5px; align-items: center; flex-wrap: wrap;">
                <select name="equipment.belt.pouches.${index}.type" class="form-control" style="width: 150px;">
                    <option value="">-- Выберите подсумок --</option>
                    ${options}
                </select>
                <input type="number" class="form-control number-input" name="equipment.belt.pouches.${index}.capacity" value="${pouch.capacity || 0}" placeholder="Объём" style="width: 80px;">
                <input type="text" class="form-control" name="equipment.belt.pouches.${index}.contents" value="${escapeHtml(pouch.contents || '')}" placeholder="Содержимое" style="flex:1;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeBeltPouch(${index})">✕</button>
            </div>
        `;
    });
    return html;
}

function renderVestPouches(pouches, pouchTemplates, isBase, totalCapacity) {
    if (!pouches || pouches.length === 0) return '<p>Нет подсумков</p>';
    let usedCapacity = 0;
    let html = '';
    pouches.forEach((pouch, index) => {
        const pouchTemplate = pouchTemplates.find(t => t.id === pouch.type);
        const pouchVolume = pouchTemplate?.volume || pouch.capacity || 0;
        usedCapacity += pouchVolume;
        const options = pouchTemplates.map(t =>
            `<option value="${t.id}" ${pouch.type === t.id ? 'selected' : ''}>${t.name} (объём ${t.volume || 0})</option>`
        ).join('');
        html += `
            <div style="display: flex; gap: 10px; margin-bottom: 5px; align-items: center; flex-wrap: wrap;">
                <select name="equipment.vest.pouches.${index}.type" class="form-control" style="width: 150px;" ${!isBase ? 'disabled' : ''}>
                    <option value="">-- Выберите подсумок --</option>
                    ${options}
                </select>
                <input type="number" class="form-control number-input" name="equipment.vest.pouches.${index}.capacity" value="${pouch.capacity || pouchVolume}" placeholder="Объём" style="width: 80px;" ${!isBase ? 'disabled' : ''}>
                <input type="text" class="form-control" name="equipment.vest.pouches.${index}.contents" value="${escapeHtml(pouch.contents || '')}" placeholder="Содержимое" style="flex:1;" ${!isBase ? 'disabled' : ''}>
                ${isBase ? `<button type="button" class="btn btn-sm btn-danger" onclick="removeVestPouch(${index})">✕</button>` : ''}
            </div>
        `;
    });
    if (isBase) {
        const remaining = totalCapacity - usedCapacity;
        const remainingColor = remaining < 0 ? 'red' : 'inherit';
        html += `<div style="margin-top: 5px; color: ${remainingColor};">Использовано: ${usedCapacity} / ${totalCapacity} (осталось: ${remaining})</div>`;
    }
    return html;
}

function renderBeltModifications(mods, modTemplates) {
    if (!mods || mods.length === 0) return '<p>Нет модификаций</p>';
    let html = '';
    mods.forEach((mod, index) => {
        const options = modTemplates.map(t =>
            `<option value="${t.id}" ${mod.name === t.name ? 'selected' : ''}>${t.name}</option>`
        ).join('');
        html += `
            <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                <select name="equipment.belt.modifications.${index}.name" class="form-control" style="width: 200px;">
                    <option value="">-- Выберите модификацию --</option>
                    ${options}
                </select>
                <input type="text" class="form-control" name="equipment.belt.modifications.${index}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeBeltModification(${index})">✕</button>
            </div>
        `;
    });
    return html;
}

function renderHelmetModifications(mods, groupedTemplates) {
    if (!mods || mods.length === 0) return '';
    let html = '';
    mods.forEach((mod, index) => {
        const options = Object.entries(groupedTemplates).map(([cat, items]) => `
            <optgroup label="${cat}">
                ${items.map(t => `<option value="${t.id}" ${mod.name === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
            </optgroup>
        `).join('');
        html += `
            <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                <select name="equipment.helmet.modifications.${index}.name" class="form-control" style="width: 200px;">
                    <option value="">-- Выберите модификацию --</option>
                    ${options}
                </select>
                <input type="text" class="form-control" name="equipment.helmet.modifications.${index}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeHelmetModification(${index})">✕</button>
            </div>
        `;
    });
    return html;
}

function renderGasMaskModifications(mods, groupedTemplates) {
    if (!mods || mods.length === 0) return '';
    let html = '';
    mods.forEach((mod, index) => {
        const options = Object.entries(groupedTemplates).map(([cat, items]) => `
            <optgroup label="${cat}">
                ${items.map(t => `<option value="${t.id}" ${mod.name === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
            </optgroup>
        `).join('');
        html += `
            <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                <select name="equipment.gasMask.modifications.${index}.name" class="form-control" style="width: 200px;">
                    <option value="">-- Выберите модификацию --</option>
                    ${options}
                </select>
                <input type="text" class="form-control" name="equipment.gasMask.modifications.${index}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeGasMaskModification(${index})">✕</button>
            </div>
        `;
    });
    return html;
}

function renderArmorModifications(mods, groupedTemplates) {
    if (!mods || mods.length === 0) return '';
    let html = '';
    mods.forEach((mod, index) => {
        const options = Object.entries(groupedTemplates).map(([cat, items]) => `
            <optgroup label="${cat}">
                ${items.map(t => `<option value="${t.id}" ${mod.name === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
            </optgroup>
        `).join('');
        html += `
            <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                <select name="equipment.armor.modifications.${index}.name" class="form-control" style="width: 200px;">
                    <option value="">-- Выберите модификацию --</option>
                    ${options}
                </select>
                <input type="text" class="form-control" name="equipment.armor.modifications.${index}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeArmorModification(${index})">✕</button>
            </div>
        `;
    });
    return html;
}

function renderPdaModifications(items, groupedTemplates) {
    if (!items || items.length === 0) return '';
    let html = '';
    items.forEach((item, index) => {
        const options = Object.entries(groupedTemplates).map(([cat, items]) => `
            <optgroup label="${cat}">
                ${items.map(t => `<option value="${t.id}" ${item.name === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
            </optgroup>
        `).join('');
        html += `
            <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                <select name="modifications.pda.items.${index}.name" class="form-control" style="width: 200px;">
                    <option value="">-- Выберите модификацию --</option>
                    ${options}
                </select>
                <input type="text" class="form-control" name="modifications.pda.items.${index}.effect" value="${escapeHtml(item.effect || '')}" placeholder="Эффект" style="flex:1;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removePdaItem(${index})">✕</button>
            </div>
        `;
    });
    return html;
}

// Рендер оружия (без изменений, как в предыдущей версии)
async function renderWeapons(weapons, weaponTemplates, moduleTemplates, weaponModTemplates) {
    const container = document.getElementById('weapons-container');
    if (!container) return;

    const groupedWeapons = {};
    weaponTemplates.forEach(t => {
        const cat = t.category || 'Прочее';
        if (!groupedWeapons[cat]) groupedWeapons[cat] = [];
        groupedWeapons[cat].push(t);
    });

    const groupedModules = {};
    moduleTemplates.forEach(t => {
        const cat = t.category || 'Прочее';
        if (!groupedModules[cat]) groupedModules[cat] = [];
        groupedModules[cat].push(t);
    });

    const groupedMods = {};
    weaponModTemplates.forEach(t => {
        const cat = t.category || 'Прочее';
        if (!groupedMods[cat]) groupedMods[cat] = [];
        groupedMods[cat].push(t);
    });

    const columns = [
        { key: 'name', label: 'Название', width: 200, type: 'text' },
        { key: 'magazine', label: 'Магазин', width: 60, type: 'text' },
        { key: 'accuracy', label: 'Точность', width: 60, type: 'number' },
        { key: 'noise', label: 'Шум', width: 40, type: 'number' },
        { key: 'ammo', label: 'Патроны', width: 75, type: 'text' },
        { key: 'range', label: 'Дальность', width: 60, type: 'number' },
        { key: 'ergonomics', label: 'Эргономика', width: 70, type: 'number' },
        { key: 'burst', label: 'Очередь', width: 75, type: 'text' },
        { key: 'damage', label: 'Урон', width: 50, type: 'number' },
        { key: 'durability', label: 'Прочность', width: 60, type: 'number' },
        { key: 'fireRate', label: 'Скорострельность', width: 105, type: 'number' },
        { key: 'weight', label: 'Вес', width: 50, type: 'number' }
    ];

    const weaponsHtml = [];
    for (let index = 0; index < weapons.length; index++) {
        const weapon = weapons[index];
        const modules = Array.isArray(weapon.modules) ? weapon.modules : [];
        const modifications = Array.isArray(weapon.modifications) ? weapon.modifications : [];

        let fieldsHtml = '<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">';
        columns.forEach(col => {
            const value = weapon[col.key] !== undefined ? weapon[col.key] : (col.type === 'number' ? 0 : '');
            fieldsHtml += `
                <div style="width: ${col.width}px;">
                    <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;">${col.label}</div>
                    ${col.type === 'number'
                        ? `<input type="number" class="form-control number-input" name="weapons.${index}.${col.key}" value="${value}" style="width: 100%;">`
                        : `<input type="text" class="form-control" name="weapons.${index}.${col.key}" value="${escapeHtml(value)}" placeholder="${col.label}" style="width: 100%;">`
                    }
                </div>
            `;
        });
        fieldsHtml += '</div>';

        let modelBlock = '';
        if (!weapon.model) {
            const options = Object.entries(groupedWeapons).map(([cat, items]) => `
                <optgroup label="${cat}">
                    ${items.map(t => `<option value="${t.id}">${t.name} ${t.source === 'local' ? '(кастом)' : ''}</option>`).join('')}
                </optgroup>
            `).join('');
            modelBlock = `
                <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
                    <select id="weapon-model-select-${index}" class="form-control" style="width: 200px;">
                        <option value="">-- Выберите модель --</option>
                        ${options}
                    </select>
                    <button type="button" class="btn btn-sm btn-primary" onclick="selectWeaponModel(${index})">Выбрать</button>
                    ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateWeaponTemplateModal(${index})">➕ Создать кастом</button>` : ''}
                </div>
            `;
        }

        let modulesHtml = '';
        modules.forEach((mod, mi) => {
            const moduleOptions = Object.entries(groupedModules).map(([cat, items]) => `
                <optgroup label="${cat}">
                    ${items.map(t => `<option value="${t.id}" ${mod.name === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
                </optgroup>
            `).join('');
            modulesHtml += `
                <div style="display: flex; gap: 5px; margin-bottom: 3px; align-items: center;">
                    <select name="weapons.${index}.modules.${mi}.name" class="form-control" style="width: 150px;">
                        <option value="">-- Выберите модуль --</option>
                        ${moduleOptions}
                    </select>
                    <input type="text" class="form-control" name="weapons.${index}.modules.${mi}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                    <button type="button" class="btn btn-sm btn-danger" onclick="removeWeaponModule(${index}, ${mi})">✕</button>
                </div>
            `;
        });

        let modificationsHtml = '';
        modifications.forEach((mod, mi) => {
            const modOptions = Object.entries(groupedMods).map(([cat, items]) => `
                <optgroup label="${cat}">
                    ${items.map(t => `<option value="${t.id}" ${mod.name === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
                </optgroup>
            `).join('');
            modificationsHtml += `
                <div style="display: flex; gap: 5px; margin-bottom: 3px; align-items: center;">
                    <select name="weapons.${index}.modifications.${mi}.name" class="form-control" style="width: 150px;">
                        <option value="">-- Выберите модификацию --</option>
                        ${modOptions}
                    </select>
                    <input type="text" class="form-control" name="weapons.${index}.modifications.${mi}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                    <button type="button" class="btn btn-sm btn-danger" onclick="removeWeaponModification(${index}, ${mi})">✕</button>
                </div>
            `;
        });

        weaponsHtml.push(`
            <div style="border:1px solid var(--panel-border); padding:10px; margin-bottom:10px;">
                ${modelBlock}
                ${fieldsHtml}
                <div style="margin-top:10px;">
                    <label>Модули</label>
                    <div id="modules-${index}">${modulesHtml}</div>
                    <button type="button" class="btn btn-sm" onclick="addWeaponModule(${index})">+ Модуль</button>
                </div>
                <div style="margin-top:10px;">
                    <label>Модификации</label>
                    <div id="modifications-${index}">${modificationsHtml}</div>
                    <button type="button" class="btn btn-sm" onclick="addWeaponModification(${index})">+ Модификация</button>
                </div>
                <button type="button" class="btn btn-sm btn-danger" onclick="removeWeapon(${index})" style="margin-top:10px;">Удалить оружие</button>
            </div>
        `);
    }
    container.innerHTML = weaponsHtml.join('');
}

// Глобальные функции выбора модели оружия
window.selectWeaponModel = async function(index) {
    const select = document.getElementById(`weapon-model-select-${index}`);
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) return;

    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    const weapon = currentCharacterData.weapons[index];

    const templates = await loadTemplatesForLobby('weapons');
    const template = templates.find(t => t.id === selectedId);
    if (template) {
        weapon.magazine = template.magazine_size || '';
        weapon.accuracy = template.accuracy;
        weapon.noise = template.noise;
        weapon.ammo = template.ammo;
        weapon.range = template.range;
        weapon.ergonomics = template.ergonomics;
        weapon.burst = template.burst;
        weapon.damage = template.damage;
        weapon.durability = template.durability;
        weapon.fireRate = template.fire_rate;
        weapon.weight = template.weight;
        weapon.name = template.name;
        weapon.model = template.name;
        weapon.source = template.source;
    } else {
        weapon.model = 'selected';
    }

    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

// Функции заполнения пресетов (теперь используют templateId)
window.fillHelmetFromPreset = async function(select) {
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) return;

    const templates = await loadTemplatesForLobby('helmets');
    const template = templates.find(t => t.id === selectedId);
    if (!template) return;

    const helmet = currentCharacterData.equipment?.helmet || {};
    helmet.templateId = template.id;
    helmet.maxDurability = template.max_durability;
    helmet.material = template.material;
    helmet.accuracyPenalty = template.accuracy_penalty;
    helmet.ergonomicsPenalty = template.ergonomics_penalty;
    helmet.charismaBonus = template.charisma_bonus;
    helmet.protection = template.protection;
    helmet.name = template.name;
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.helmet = helmet;
    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.fillGasMaskFromPreset = async function(select) {
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) return;

    const templates = await loadTemplatesForLobby('gas_masks');
    const template = templates.find(t => t.id === selectedId);
    if (!template) return;

    const gasMask = currentCharacterData.equipment?.gasMask || {};
    gasMask.templateId = template.id;
    gasMask.maxDurability = template.max_durability;
    gasMask.filterRemaining = template.filter_capacity;
    gasMask.material = template.material;
    gasMask.accuracyPenalty = template.accuracy_penalty;
    gasMask.ergonomicsPenalty = template.ergonomics_penalty;
    gasMask.charismaBonus = template.charisma_bonus;
    gasMask.protection = template.protection;
    gasMask.name = template.name;
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.gasMask = gasMask;
    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.fillArmorFromPreset = async function(select) {
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) return;

    const templates = await loadTemplatesForLobby('armor');
    const template = templates.find(t => t.id === selectedId);
    if (!template) return;

    const armor = currentCharacterData.equipment?.armor || {};
    armor.templateId = template.id;
    armor.maxDurability = template.max_durability;
    armor.material = template.material;
    armor.movementPenalty = template.movement_penalty;
    armor.containerSlots = template.container_slots;
    armor.protection = template.protection;
    armor.name = template.name;
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.armor = armor;
    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

// Функции добавления/удаления модификаций
window.addHelmetModification = function() {
    updateDataFromFields();
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.helmet) currentCharacterData.equipment.helmet = {};
    if (!Array.isArray(currentCharacterData.equipment.helmet.modifications)) {
        currentCharacterData.equipment.helmet.modifications = [];
    }
    currentCharacterData.equipment.helmet.modifications.push({ name: '', description: '' });
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeHelmetModification = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.helmet?.modifications) return;
    currentCharacterData.equipment.helmet.modifications.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.addGasMaskModification = function() {
    updateDataFromFields();
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.gasMask) currentCharacterData.equipment.gasMask = {};
    if (!Array.isArray(currentCharacterData.equipment.gasMask.modifications)) {
        currentCharacterData.equipment.gasMask.modifications = [];
    }
    currentCharacterData.equipment.gasMask.modifications.push({ name: '', description: '' });
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeGasMaskModification = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.gasMask?.modifications) return;
    currentCharacterData.equipment.gasMask.modifications.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.addArmorModification = function() {
    updateDataFromFields();
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.armor) currentCharacterData.equipment.armor = {};
    if (!Array.isArray(currentCharacterData.equipment.armor.modifications)) {
        currentCharacterData.equipment.armor.modifications = [];
    }
    currentCharacterData.equipment.armor.modifications.push({ name: '', description: '' });
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeArmorModification = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.armor?.modifications) return;
    currentCharacterData.equipment.armor.modifications.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

// Функции для подсумков
window.addBeltPouch = function() {
    updateDataFromFields();
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.belt) currentCharacterData.equipment.belt = {};
    if (!Array.isArray(currentCharacterData.equipment.belt.pouches)) {
        currentCharacterData.equipment.belt.pouches = [];
    }
    currentCharacterData.equipment.belt.pouches.push({});
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeBeltPouch = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.belt?.pouches) return;
    currentCharacterData.equipment.belt.pouches.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.addBeltModification = function() {
    updateDataFromFields();
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.belt) currentCharacterData.equipment.belt = {};
    if (!Array.isArray(currentCharacterData.equipment.belt.modifications)) {
        currentCharacterData.equipment.belt.modifications = [];
    }
    currentCharacterData.equipment.belt.modifications.push({ name: '', description: '' });
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeBeltModification = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.belt?.modifications) return;
    currentCharacterData.equipment.belt.modifications.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.addVestPouch = function() {
    updateDataFromFields();
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.vest) {
        currentCharacterData.equipment.vest = { model: 'custom', pouches: [], totalCapacity: 0 };
    }
    if (!Array.isArray(currentCharacterData.equipment.vest.pouches)) {
        currentCharacterData.equipment.vest.pouches = [];
    }
    currentCharacterData.equipment.vest.pouches.push({});
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeVestPouch = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.vest?.pouches) return;
    currentCharacterData.equipment.vest.pouches.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.onVestModelChange = async function(select) {
    const selectedValue = select.value;
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.vest) currentCharacterData.equipment.vest = {};

    if (selectedValue === 'custom') {
        currentCharacterData.equipment.vest.model = 'custom';
        currentCharacterData.equipment.vest.pouches = currentCharacterData.equipment.vest.pouches || [];
        currentCharacterData.equipment.vest.totalCapacity = currentCharacterData.equipment.vest.totalCapacity || 0;
    } else if (selectedValue) {
        const templates = await loadTemplatesForLobby('vests');
        const template = templates.find(t => t.id == selectedValue);
        if (template) {
            currentCharacterData.equipment.vest = {
                model: selectedValue,
                pouches: template.pouches ? template.pouches.map(p => ({ ...p })) : [],
                totalCapacity: template.total_capacity
            };
        }
    } else {
        delete currentCharacterData.equipment.vest;
    }
    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

// Функции создания кастомных шаблонов
window.openCreateHelmetTemplateModal = function() {
    let modal = document.getElementById('create-helmet-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-helmet-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-helmet-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный шаблон шлема</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="helmet-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Материал</label>
                    <input type="text" id="helmet-material" class="form-control" placeholder="например, Текстиль">
                </div>
                <div class="form-group">
                    <label>Прочность (макс)</label>
                    <input type="number" id="helmet-maxDurability" class="form-control number-input" value="1">
                </div>
                <div class="form-group">
                    <label>Точность (штраф)</label>
                    <input type="number" id="helmet-accuracyPenalty" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Эргономика (штраф)</label>
                    <input type="number" id="helmet-ergonomicsPenalty" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Харизма (бонус)</label>
                    <input type="number" id="helmet-charismaBonus" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Защита (JSON)</label>
                    <textarea id="helmet-protection" class="form-control" rows="3">{"physical":0,"chemical":0,"thermal":0,"electric":0,"radiation":0}</textarea>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveHelmetTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-helmet-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
};

window.saveHelmetTemplate = async function() {
    const data = {
        name: document.getElementById('helmet-name').value,
        material: document.getElementById('helmet-material').value,
        max_durability: parseInt(document.getElementById('helmet-maxDurability').value) || 1,
        accuracy_penalty: parseInt(document.getElementById('helmet-accuracyPenalty').value) || 0,
        ergonomics_penalty: parseInt(document.getElementById('helmet-ergonomicsPenalty').value) || 0,
        charisma_bonus: parseInt(document.getElementById('helmet-charismaBonus').value) || 0,
        protection: JSON.parse(document.getElementById('helmet-protection').value || '{}')
    };

    const response = await fetch(`/lobbies/${currentLobbyId}/templates/helmets`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        clearTemplatesCache('helmets');
        await renderEquipmentTab(currentCharacterData);
        document.getElementById('create-helmet-template-modal').style.display = 'none';
        showNotification('Шаблон шлема создан', 'success');
    } else {
        const err = await response.json();
        showNotification(err.message);
    }
};

window.openCreateGasMaskTemplateModal = function() {
    let modal = document.getElementById('create-gasMask-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-gasMask-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-gasMask-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный шаблон противогаза</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="gasMask-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Материал</label>
                    <input type="text" id="gasMask-material" class="form-control" placeholder="например, Резина">
                </div>
                <div class="form-group">
                    <label>Прочность (макс)</label>
                    <input type="number" id="gasMask-maxDurability" class="form-control number-input" value="1">
                </div>
                <div class="form-group">
                    <label>Ёмкость фильтра</label>
                    <input type="number" id="gasMask-filterCapacity" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Точность (штраф)</label>
                    <input type="number" id="gasMask-accuracyPenalty" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Эргономика (штраф)</label>
                    <input type="number" id="gasMask-ergonomicsPenalty" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Харизма (бонус)</label>
                    <input type="number" id="gasMask-charismaBonus" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Защита (JSON)</label>
                    <textarea id="gasMask-protection" class="form-control" rows="3">{"physical":0,"chemical":0,"thermal":0,"electric":0,"radiation":0}</textarea>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveGasMaskTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-gasMask-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
};

window.saveGasMaskTemplate = async function() {
    const data = {
        name: document.getElementById('gasMask-name').value,
        material: document.getElementById('gasMask-material').value,
        max_durability: parseInt(document.getElementById('gasMask-maxDurability').value) || 1,
        filter_capacity: parseInt(document.getElementById('gasMask-filterCapacity').value) || 0,
        accuracy_penalty: parseInt(document.getElementById('gasMask-accuracyPenalty').value) || 0,
        ergonomics_penalty: parseInt(document.getElementById('gasMask-ergonomicsPenalty').value) || 0,
        charisma_bonus: parseInt(document.getElementById('gasMask-charismaBonus').value) || 0,
        protection: JSON.parse(document.getElementById('gasMask-protection').value || '{}')
    };

    const response = await fetch(`/lobbies/${currentLobbyId}/templates/gas_masks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        clearTemplatesCache('gas_masks');
        await renderEquipmentTab(currentCharacterData);
        document.getElementById('create-gasMask-template-modal').style.display = 'none';
        showNotification('Шаблон противогаза создан', 'success');
    } else {
        const err = await response.json();
        showNotification(err.message);
    }
};

window.openCreateArmorTemplateModal = function() {
    let modal = document.getElementById('create-armor-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-armor-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-armor-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный шаблон брони</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="armor-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Материал</label>
                    <input type="text" id="armor-material" class="form-control" placeholder="например, Кевлар">
                </div>
                <div class="form-group">
                    <label>Прочность (макс)</label>
                    <input type="number" id="armor-maxDurability" class="form-control number-input" value="1">
                </div>
                <div class="form-group">
                    <label>Штраф перемещения</label>
                    <input type="number" id="armor-movementPenalty" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Количество слотов под контейнеры</label>
                    <input type="number" id="armor-containerSlots" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Защита (JSON)</label>
                    <textarea id="armor-protection" class="form-control" rows="3">{"physical":0,"chemical":0,"thermal":0,"electric":0,"radiation":0}</textarea>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveArmorTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-armor-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
};

window.saveArmorTemplate = async function() {
    const data = {
        name: document.getElementById('armor-name').value,
        material: document.getElementById('armor-material').value,
        max_durability: parseInt(document.getElementById('armor-maxDurability').value) || 1,
        movement_penalty: parseInt(document.getElementById('armor-movementPenalty').value) || 0,
        container_slots: parseInt(document.getElementById('armor-containerSlots').value) || 0,
        protection: JSON.parse(document.getElementById('armor-protection').value || '{}')
    };

    const response = await fetch(`/lobbies/${currentLobbyId}/templates/armor`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        clearTemplatesCache('armor');
        await renderEquipmentTab(currentCharacterData);
        document.getElementById('create-armor-template-modal').style.display = 'none';
        showNotification('Шаблон брони создан', 'success');
    } else {
        const err = await response.json();
        showNotification(err.message);
    }
};

window.openCreateWeaponTemplateModal = function(weaponIndex) {
    let modal = document.getElementById('create-weapon-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-weapon-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-weapon-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный шаблон оружия</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="template-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Категория</label>
                    <input type="text" id="template-category" class="form-control" placeholder="например, пистолеты">
                </div>
                <div class="form-group">
                    <label>Точность</label>
                    <input type="number" id="template-accuracy" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Шум</label>
                    <input type="number" id="template-noise" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Патроны</label>
                    <input type="text" id="template-ammo" class="form-control">
                </div>
                <div class="form-group">
                    <label>Дальность</label>
                    <input type="number" id="template-range" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Эргономика</label>
                    <input type="number" id="template-ergonomics" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Очередь</label>
                    <input type="text" id="template-burst" class="form-control">
                </div>
                <div class="form-group">
                    <label>Урон</label>
                    <input type="number" id="template-damage" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Прочность</label>
                    <input type="number" id="template-durability" class="form-control number-input" value="100">
                </div>
                <div class="form-group">
                    <label>Скорострельность</label>
                    <input type="number" id="template-fireRate" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Вес</label>
                    <input type="number" id="template-weight" class="form-control number-input" value="0" step="0.1">
                </div>
                <div class="form-group">
                    <label>Калибр</label>
                    <input type="text" id="template-caliber" class="form-control">
                </div>
                <div class="form-group">
                    <label>Размер магазина</label>
                    <input type="number" id="template-magazineSize" class="form-control number-input" value="0">
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveWeaponTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-weapon-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
};

window.saveWeaponTemplate = async function() {
    const data = {
        name: document.getElementById('template-name').value,
        category: document.getElementById('template-category').value,
        accuracy: parseInt(document.getElementById('template-accuracy').value) || 0,
        noise: parseInt(document.getElementById('template-noise').value) || 0,
        ammo: document.getElementById('template-ammo').value,
        range: parseInt(document.getElementById('template-range').value) || 0,
        ergonomics: parseInt(document.getElementById('template-ergonomics').value) || 0,
        burst: document.getElementById('template-burst').value,
        damage: parseInt(document.getElementById('template-damage').value) || 0,
        durability: parseInt(document.getElementById('template-durability').value) || 100,
        fire_rate: parseInt(document.getElementById('template-fireRate').value) || 0,
        weight: parseFloat(document.getElementById('template-weight').value) || 0,
        caliber: document.getElementById('template-caliber').value,
        magazine_size: parseInt(document.getElementById('template-magazineSize').value) || 0
    };

    const response = await fetch(`/lobbies/${currentLobbyId}/templates/weapons`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        clearTemplatesCache('weapons');
        await renderEquipmentTab(currentCharacterData);
        document.getElementById('create-weapon-template-modal').style.display = 'none';
        showNotification('Шаблон создан', 'success');
    } else {
        const err = await response.json();
        showNotification(err.message);
    }
};

window.openCreateVestTemplateModal = function() {
    let modal = document.getElementById('create-vest-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-vest-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-vest-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный шаблон разгрузки</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="vest-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Общий объём</label>
                    <input type="number" id="vest-totalCapacity" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Подсумки (JSON-массив объектов с полями type и capacity)</label>
                    <textarea id="vest-pouches" class="form-control" rows="5">[]</textarea>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveVestTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-vest-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
};

window.saveVestTemplate = async function() {
    const data = {
        name: document.getElementById('vest-name').value,
        total_capacity: parseInt(document.getElementById('vest-totalCapacity').value) || 0,
        pouches: JSON.parse(document.getElementById('vest-pouches').value || '[]')
    };

    const response = await fetch(`/lobbies/${currentLobbyId}/templates/vests`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        clearTemplatesCache('vests');
        await renderEquipmentTab(currentCharacterData);
        document.getElementById('create-vest-template-modal').style.display = 'none';
        showNotification('Шаблон разгрузки создан', 'success');
    } else {
        const err = await response.json();
        showNotification(err.message);
    }
};

// ---------- Вкладка Инвентарь ----------
async function renderInventoryTab(data) {
    const container = document.getElementById('sheet-tab-inventory');
    const inv = data.inventory || {};
    const pockets = Array.isArray(inv.pockets) ? inv.pockets : [];
    const backpack = Array.isArray(inv.backpack) ? inv.backpack : [];
    const money = inv.money || 0;
    const pocketMaxVolume = inv.pocketMaxVolume || 10;
    const pocketFill = pockets.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);

    // Загружаем шаблоны предметов и рюкзаков
    let consumableTemplates = [];
    let materialTemplates = [];
    let artifactTemplates = [];
    let backpackTemplates = [];
    try {
        consumableTemplates = await loadTemplatesForLobby('consumables');
        materialTemplates = await loadTemplatesForLobby('crafting_materials');
        artifactTemplates = await loadTemplatesForLobby('artifacts');
        backpackTemplates = await loadTemplatesForLobby('backpacks');
        cachedBackpackTemplates = backpackTemplates;
    } catch (e) {
        console.error('Failed to load inventory templates', e);
    }

    // Объединяем все типы предметов для выбора в карманах/рюкзаке
    const allItemTemplates = [
        ...consumableTemplates.map(t => ({ ...t, category: 'Расходники' })),
        ...materialTemplates.map(t => ({ ...t, category: 'Материалы' })),
        ...artifactTemplates.map(t => ({ ...t, category: 'Артефакты' }))
    ];
    const groupedItems = {};
    allItemTemplates.forEach(t => {
        const cat = t.category || 'Прочее';
        if (!groupedItems[cat]) groupedItems[cat] = [];
        groupedItems[cat].push(t);
    });

    // Определяем текущий выбранный рюкзак
    const selectedBackpackId = inv.backpackModel ? parseInt(inv.backpackModel, 10) : null;
    const selectedBackpack = backpackTemplates.find(t => t.id === selectedBackpackId);
    const backpackLimit = selectedBackpack ? selectedBackpack.limit : 0;
    const backpackWeightReduction = selectedBackpack ? selectedBackpack.weight_reduction || 0 : 0;
    const backpackFill = backpack.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);

    const rawTotalWeight = pockets.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0) +
                           backpack.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0);
    // Штраф от веса: 1 за каждые 5 кг
    const movePenaltyFromWeight = Math.floor(rawTotalWeight / 5);
    // Итоговый штраф с учётом снижения от рюкзака
    const movePenalty = Math.max(0, movePenaltyFromWeight - backpackWeightReduction);

    let html = `
        <!-- Вес и штраф -->
        <div style="display: flex; gap: 20px; margin-bottom: 15px;">
            <div><strong>Общий вес:</strong> <span id="total-weight-display">${rawTotalWeight}</span></div>
            <div><strong>Штраф перемещения:</strong> <span id="move-penalty-display">${movePenalty}</span></div>
        </div>
        <hr>

        <!-- Карманы -->
        <h4>Карманы <span style="font-weight:normal;">(заполнено: <span id="pocket-fill-display">${pocketFill}</span> / <input type="number" class="form-control number-input" name="inventory.pocketMaxVolume" value="${pocketMaxVolume}" style="width:70px; display:inline;">)</span></h4>
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 5px; font-weight: bold; margin-bottom: 5px; align-items: center;">
            <div>Название</div><div>Вес</div><div>Объём</div><div>Кол-во</div><div></div>
        </div>
        <div id="pockets-container"></div>
        <button type="button" class="btn btn-sm btn-primary" onclick="addPocketItem()">+ Добавить в карманы</button>

        <!-- Рюкзак -->
        <h4 style="margin-top:20px;">Рюкзак</h4>
        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
            <label>Модель:</label>
            <select name="inventory.backpackModel" class="form-control" onchange="onBackpackModelChange(this)" style="width: 200px;">
                <option value="">-- Без рюкзака --</option>
                ${backpackTemplates.map(t => `<option value="${t.id}" ${selectedBackpackId === t.id ? 'selected' : ''}>${t.name} (лимит ${t.limit}, снижение веса ${t.weight_reduction || 0})</option>`).join('')}
            </select>
            ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateBackpackTemplateModal()">➕ Создать кастом</button>` : ''}
            <span id="backpack-fill-display">Заполнено: ${backpackFill} / ${backpackLimit}</span>
        </div>
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 5px; font-weight: bold; margin-bottom: 5px; align-items: center;">
            <div>Название</div><div>Вес</div><div>Объём</div><div>Кол-во</div><div></div>
        </div>
        <div id="backpack-container"></div>
        <button type="button" class="btn btn-sm btn-primary" onclick="addBackpackItem()">+ Добавить в рюкзак</button>
    `;

    container.innerHTML = html;
    renderPockets(pockets, groupedItems);
    renderBackpack(backpack, groupedItems);

    // Обработчик изменений для автосохранения и пересчёта
    container.addEventListener('input', (e) => {
        const target = e.target;
        if (target.matches('input[name*="weight"], input[name*="volume"], input[name*="quantity"]')) {
            updateDataFromFields();
            recalculateInventoryTotals(); // использует кешированные шаблоны
            scheduleAutoSave();
        }
    });
}

function recalculateInventoryTotals() {
    const inv = currentCharacterData.inventory || {};
    const pockets = inv.pockets || [];
    const backpack = inv.backpack || [];
    const selectedBackpackId = inv.backpackModel ? parseInt(inv.backpackModel, 10) : null;
    const selectedBackpack = cachedBackpackTemplates.find(t => t.id === selectedBackpackId);
    const backpackWeightReduction = selectedBackpack ? selectedBackpack.weight_reduction || 0 : 0;

    // Заполненность карманов
    const pocketFill = pockets.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);
    const pocketFillSpan = document.querySelector('#pocket-fill-display');
    if (pocketFillSpan) pocketFillSpan.textContent = pocketFill;

    // Заполненность рюкзака
    const backpackFill = backpack.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);
    const backpackLimit = selectedBackpack ? selectedBackpack.limit : 0;
    const backpackFillSpan = document.querySelector('#backpack-fill-display');
    if (backpackFillSpan) {
        backpackFillSpan.textContent = `Заполнено: ${backpackFill} / ${backpackLimit}`;
    }

    // Общий вес (без учёта снижения)
    const rawTotalWeight = pockets.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0) +
                           backpack.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0);
    const totalWeightSpan = document.querySelector('#total-weight-display');
    if (totalWeightSpan) totalWeightSpan.textContent = rawTotalWeight;

    // Штраф от веса
    const movePenaltyFromWeight = Math.floor(rawTotalWeight / 5);
    const movePenalty = Math.max(0, movePenaltyFromWeight - backpackWeightReduction);
    const movePenaltySpan = document.querySelector('#move-penalty-display');
    if (movePenaltySpan) movePenaltySpan.textContent = movePenalty;
}

// Обработчик изменения модели рюкзака
window.onBackpackModelChange = async function(select) {
    updateDataFromFields();
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    currentCharacterData.inventory.backpackModel = select.value;
    // Обновляем кеш, если вдруг изменился
    cachedBackpackTemplates = await loadTemplatesForLobby('backpacks');
    recalculateInventoryTotals();
    scheduleAutoSave();
};

function renderPockets(pockets, groupedItems) {
    const container = document.getElementById('pockets-container');
    if (!container) return;
    container.innerHTML = '';

    pockets.forEach((item, index) => {
        const hasTemplate = !!item.templateId;

        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr auto';
        row.style.gap = '5px';
        row.style.marginBottom = '5px';
        row.style.alignItems = 'center';

        let nameCell;
        if (!hasTemplate) {
            const options = Object.entries(groupedItems).map(([cat, items]) => `
                <optgroup label="${cat}">
                    ${items.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                </optgroup>
            `).join('');
            nameCell = `
                <select class="form-control" onchange="selectPocketItem(${index}, this.value)" style="width: 100%;">
                    <option value="">-- Выберите предмет --</option>
                    ${options}
                </select>
            `;
        } else {
            nameCell = `<input type="text" class="form-control" name="inventory.pockets.${index}.name" value="${escapeHtml(item.name || '')}" placeholder="Название">`;
        }

        row.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px;">
                ${nameCell}
            </div>
            <input type="number" class="form-control number-input" name="inventory.pockets.${index}.weight" value="${item.weight || 0}" placeholder="Вес">
            <input type="number" class="form-control number-input" name="inventory.pockets.${index}.volume" value="${item.volume || 0}" placeholder="Объём">
            <input type="number" class="form-control number-input" name="inventory.pockets.${index}.quantity" value="${item.quantity || 1}" placeholder="Кол-во">
            <button type="button" class="btn btn-sm btn-danger" onclick="removePocketItem(${index})">✕</button>
        `;
        container.appendChild(row);
    });
}

function renderBackpack(backpack, groupedItems) {
    const container = document.getElementById('backpack-container');
    if (!container) return;
    container.innerHTML = '';

    backpack.forEach((item, index) => {
        const hasTemplate = !!item.templateId;

        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr auto';
        row.style.gap = '5px';
        row.style.marginBottom = '5px';
        row.style.alignItems = 'center';

        let nameCell;
        if (!hasTemplate) {
            const options = Object.entries(groupedItems).map(([cat, items]) => `
                <optgroup label="${cat}">
                    ${items.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                </optgroup>
            `).join('');
            nameCell = `
                <select class="form-control" onchange="selectBackpackItem(${index}, this.value)" style="width: 100%;">
                    <option value="">-- Выберите предмет --</option>
                    ${options}
                </select>
            `;
        } else {
            nameCell = `<input type="text" class="form-control" name="inventory.backpack.${index}.name" value="${escapeHtml(item.name || '')}" placeholder="Название">`;
        }

        row.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px;">
                ${nameCell}
            </div>
            <input type="number" class="form-control number-input" name="inventory.backpack.${index}.weight" value="${item.weight || 0}" placeholder="Вес">
            <input type="number" class="form-control number-input" name="inventory.backpack.${index}.volume" value="${item.volume || 0}" placeholder="Объём">
            <input type="number" class="form-control number-input" name="inventory.backpack.${index}.quantity" value="${item.quantity || 1}" placeholder="Кол-во">
            <button type="button" class="btn btn-sm btn-danger" onclick="removeBackpackItem(${index})">✕</button>
        `;
        container.appendChild(row);
    });
}

// Функции выбора предмета из шаблона
window.selectPocketItem = async function(index, selectedId) {
    const id = parseInt(selectedId, 10);
    if (isNaN(id)) return;

    const consumables = await loadTemplatesForLobby('consumables');
    const materials = await loadTemplatesForLobby('crafting_materials');
    const artifacts = await loadTemplatesForLobby('artifacts');
    const all = [...consumables, ...materials, ...artifacts];
    const template = all.find(t => t.id === id);
    if (!template) return;

    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.pockets) currentCharacterData.inventory.pockets = [];
    const item = currentCharacterData.inventory.pockets[index];
    item.name = template.name;
    item.weight = template.weight || 0;
    item.volume = template.volume || 0;
    item.templateId = template.id;
    // Количество оставляем без изменений (не трогаем item.quantity)

    await renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.selectBackpackItem = async function(index, selectedId) {
    const id = parseInt(selectedId, 10);
    if (isNaN(id)) return;

    const consumables = await loadTemplatesForLobby('consumables');
    const materials = await loadTemplatesForLobby('crafting_materials');
    const artifacts = await loadTemplatesForLobby('artifacts');
    const all = [...consumables, ...materials, ...artifacts];
    const template = all.find(t => t.id === id);
    if (!template) return;

    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    const item = currentCharacterData.inventory.backpack[index];
    item.name = template.name;
    item.weight = template.weight || 0;
    item.volume = template.volume || 0;
    item.templateId = template.id;
    // Количество не трогаем

    await renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.openCreateBackpackTemplateModal = function() {
    let modal = document.getElementById('create-backpack-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-backpack-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-backpack-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный шаблон рюкзака</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="backpack-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Объём (лимит)</label>
                    <input type="number" id="backpack-limit" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Снижение штрафа веса</label>
                    <input type="number" id="backpack-weightReduction" class="form-control number-input" value="0">
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveBackpackTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-backpack-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
};

window.saveBackpackTemplate = async function() {
    const data = {
        name: document.getElementById('backpack-name').value,
        limit: parseInt(document.getElementById('backpack-limit').value) || 0,
        weight_reduction: parseInt(document.getElementById('backpack-weightReduction').value) || 0
    };

    const response = await fetch(`/lobbies/${currentLobbyId}/templates/backpacks`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify(data)
    });
    if (response.ok) {
        clearTemplatesCache('backpacks');
        await renderInventoryTab(currentCharacterData);
        document.getElementById('create-backpack-template-modal').style.display = 'none';
        showNotification('Шаблон рюкзака создан', 'success');
    } else {
        const err = await response.json();
        showNotification(err.message);
    }
};

// ---------- Вкладка Заметки ----------
function renderNotesTab(data) {
    const container = document.getElementById('sheet-tab-notes');
    container.innerHTML = `
        <div class="form-group">
            <label>Журнал заметок</label>
            <textarea class="form-control" name="notes" rows="20" style="width:100%;">${escapeHtml(data.notes || '')}</textarea>
        </div>
    `;
}

// ---------- Вкладка Настройки ----------
function renderSettingsTab(data) {
    const container = document.getElementById('sheet-tab-settings');
    if (!container) return;

    const ownerUsername = currentCharacterData.ownerUsername || 'Неизвестно';
    const visibleTo = currentCharacterData.visible_to || [];
    const currentUserId = parseInt(localStorage.getItem('user_id'));
    const isOwner = currentCharacterData.ownerId === currentUserId;

    let html = `
        <h4>Владелец: ${escapeHtml(ownerUsername)}</h4>
        <hr>
        <h4>Видимость</h4>
        <div id="visibility-settings-container"></div>
    `;

    if (isOwner) {
        html += `
            <button type="button" class="btn btn-sm" onclick="applyVisibilityFromSheet()">Применить видимость</button>
            <hr>
            <button type="button" class="btn btn-sm btn-danger" onclick="deleteCharacterFromSheet()">Удалить персонажа</button>
        `;
    }

    container.innerHTML = html;

    const visContainer = document.getElementById('visibility-settings-container');
    if (visContainer && lobbyParticipants && lobbyParticipants.length) {
        visContainer.innerHTML = '';
        lobbyParticipants.forEach(p => {
            const div = document.createElement('div');
            div.className = 'visibility-participant';
            div.innerHTML = `
                <input type="checkbox" value="${p.user_id}" ${visibleTo.includes(p.user_id) ? 'checked' : ''} ${!isOwner ? 'disabled' : ''}>
                <label>${p.username}</label>
            `;
            visContainer.appendChild(div);
        });
    }
}

window.applyVisibilityFromSheet = function() {
    const checkboxes = document.querySelectorAll('#visibility-settings-container input:checked');
    const visibleTo = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
    import('./api.js').then(({ setCharacterVisibility }) => {
        setCharacterVisibility(currentCharacterId, visibleTo)
            .then(() => showNotification('Видимость обновлена', 'success'))
            .catch(err => showNotification(err.message));
    });
};

window.deleteCharacterFromSheet = function() {
    if (!confirm('Удалить персонажа?')) return;
    import('./api.js').then(({ deleteCharacter }) => {
        deleteCharacter(currentCharacterId)
            .then(() => {
                showNotification('Персонаж удалён', 'success');
                closeCharacterSheet();
                import('./characters.js').then(module => module.loadLobbyCharacters());
            })
            .catch(err => showNotification(err.message));
    });
};

// ---------- Публичные функции ----------
export async function openCharacterSheet(characterId) {
    currentCharacterId = characterId;
    try {
        const character = await getCharacter(characterId);
        currentCharacterData = character.data || {};
        currentCharacterData.ownerId = character.owner_id;
        currentCharacterData.ownerUsername = character.owner_username;
        currentCharacterData.visible_to = character.visible_to || [];
        await renderCharacterSheet(character.name, currentCharacterData);
        document.getElementById('character-sheet-modal').style.display = 'flex';

        const socket = getSocket();
        if (socket) {
            socket.emit('join_character', { token: localStorage.getItem('access_token'), character_id: characterId });

            socket.off('character_data_updated');
            socket.on('character_data_updated', (data) => {
                if (data.character_id === currentCharacterId && data.updated_by !== parseInt(localStorage.getItem('user_id'))) {
                    if (data.updates.data) {
                        currentCharacterData = data.updates.data;
                    } else {
                        Object.assign(currentCharacterData, data.updates);
                    }
                    const activeTab = document.querySelector('#sheet-tabs .tab-btn.active')?.dataset.tab;
                    if (activeTab) {
                        switch (activeTab) {
                            case 'basic': renderBasicTab(currentCharacterData); break;
                            case 'skills': renderSkillsTab(currentCharacterData); break;
                            case 'equipment': renderEquipmentTab(currentCharacterData); break;
                            case 'inventory': renderInventoryTab(currentCharacterData); break;
                            case 'settings': renderSettingsTab(currentCharacterData); break;
                            case 'notes': renderNotesTab(currentCharacterData); break;
                        }
                    } else {
                        const nameEl = document.getElementById('character-sheet-name').textContent;
                        renderCharacterSheet(nameEl, currentCharacterData);
                    }
                    showNotification('Данные персонажа обновлены', 'system', 'bottom-left');
                }
            });
        }
    } catch (error) {
        showNotification(error.message);
    }
}

export function closeCharacterSheet() {
    const socket = getSocket();
    if (socket && currentCharacterId) {
        socket.emit('leave_character', { token: localStorage.getItem('access_token'), character_id: currentCharacterId });
    }
    document.getElementById('character-sheet-modal').style.display = 'none';
    currentCharacterId = null;
    currentCharacterData = null;
}

export function exportCharacter() {
    const dataStr = JSON.stringify(currentCharacterData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `character_${currentCharacterId}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export function importCharacter(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            currentCharacterData = importedData;
            const nameEl = document.getElementById('character-sheet-name');
            if (nameEl) {
                renderCharacterSheet(nameEl.textContent, currentCharacterData);
            }
            showNotification('Данные импортированы', 'system');
        } catch (err) {
            showNotification('Ошибка парсинга JSON');
        }
    };
    reader.readAsText(file);
}

window.rollSkill = function(skillPath, skillLabel) {
    if (!currentCharacterData) return;

    // Получаем объект навыка по пути
    const parts = skillPath.split('.');
    let skillObj = currentCharacterData.skills;
    for (const part of parts) {
        if (!skillObj) break;
        skillObj = skillObj[part];
    }
    if (!skillObj) return;

    // Модификатор от собственной базы навыка (для всех)
    const base = skillObj.base;
    const selfMod = typeof base === 'number' ? Math.floor((base - 10) / 2) : 0;

    // Модификатор харизмы (только для социальных навыков, кроме самой харизмы)
    let charismaMod = 0;
    if (skillPath.startsWith('social.') && skillPath !== 'social.charisma') {
        const charisma = currentCharacterData.skills?.social?.charisma;
        const charismaBase = charisma?.base;
        charismaMod = typeof charismaBase === 'number' ? Math.floor((charismaBase - 10) / 2) : 0;
    }

    // Ручной бонус навыка
    const bonus = skillObj.bonus || 0;

    // Бросок d20
    const dice = Math.floor(Math.random() * 20) + 1;
    const total = dice + selfMod + charismaMod + bonus;

    // Формируем строку для вывода
    let modStr = `модификатор навыка = ${selfMod}`;
    if (charismaMod !== 0) modStr += ` + харизма = ${charismaMod}`;
    if (bonus !== 0) modStr += ` + бонус = ${bonus}`;

    // Уведомление для игрока
    showNotification(`🎲 ${skillLabel}: бросок d20 = ${dice}, ${modStr}, итог = ${total}`, 'system');

    // Отправка в чат
    const socket = getSocket();
    if (socket && currentLobbyId) {
        const message = `🎲 ${skillLabel}: бросок d20 = ${dice}, ${modStr}, итог = **${total}**`;
        socket.emit('send_message', {
            token: localStorage.getItem('access_token'),
            lobby_id: currentLobbyId,
            message: message
        });
    }
};

// Функции добавления/удаления оружия и предметов
window.addWeapon = function() {
    updateDataFromFields();
    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    currentCharacterData.weapons.push({});
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeWeapon = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.weapons) return;
    currentCharacterData.weapons.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.addWeaponModule = function(weaponIndex) {
    updateDataFromFields();
    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    if (!currentCharacterData.weapons[weaponIndex]) currentCharacterData.weapons[weaponIndex] = {};
    if (!Array.isArray(currentCharacterData.weapons[weaponIndex].modules)) {
        currentCharacterData.weapons[weaponIndex].modules = [];
    }
    currentCharacterData.weapons[weaponIndex].modules.push({ name: '', description: '' });
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeWeaponModule = function(weaponIndex, moduleIndex) {
    updateDataFromFields();
    if (!currentCharacterData.weapons?.[weaponIndex]?.modules) return;
    currentCharacterData.weapons[weaponIndex].modules.splice(moduleIndex, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.addWeaponModification = function(weaponIndex) {
    updateDataFromFields();
    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    if (!currentCharacterData.weapons[weaponIndex]) currentCharacterData.weapons[weaponIndex] = {};
    if (!Array.isArray(currentCharacterData.weapons[weaponIndex].modifications)) {
        currentCharacterData.weapons[weaponIndex].modifications = [];
    }
    currentCharacterData.weapons[weaponIndex].modifications.push({ name: '', description: '' });
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeWeaponModification = function(weaponIndex, modIndex) {
    updateDataFromFields();
    if (!currentCharacterData.weapons?.[weaponIndex]?.modifications) return;
    currentCharacterData.weapons[weaponIndex].modifications.splice(modIndex, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.addPocketItem = function() {
    updateDataFromFields();
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!Array.isArray(currentCharacterData.inventory.pockets)) {
        currentCharacterData.inventory.pockets = [];
    }
    currentCharacterData.inventory.pockets.push({ name: '', weight: 0, volume: 0, quantity: 1 });
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.removePocketItem = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.inventory?.pockets) return;
    currentCharacterData.inventory.pockets.splice(index, 1);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.addBackpackItem = function() {
    updateDataFromFields();
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!Array.isArray(currentCharacterData.inventory.backpack)) {
        currentCharacterData.inventory.backpack = [];
    }
    currentCharacterData.inventory.backpack.push({ name: '', weight: 0, volume: 0, quantity: 1 });
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeBackpackItem = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.inventory?.backpack) return;
    currentCharacterData.inventory.backpack.splice(index, 1);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.addPdaItem = function() {
    updateDataFromFields();
    if (!currentCharacterData.modifications) currentCharacterData.modifications = {};
    if (!currentCharacterData.modifications.pda) currentCharacterData.modifications.pda = {};
    if (!Array.isArray(currentCharacterData.modifications.pda.items)) {
        currentCharacterData.modifications.pda.items = [];
    }
    currentCharacterData.modifications.pda.items.push({ name: '', effect: '' });
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.removePdaItem = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.modifications?.pda?.items) return;
    currentCharacterData.modifications.pda.items.splice(index, 1);
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};