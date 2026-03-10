// static/js/characterSheet.js
import { getCharacter, updateCharacter } from './api.js';
import { showNotification } from './utils.js';
import { lobbyParticipants } from './ui.js';
import  {getSocket} from './socketHandlers.js';

let currentCharacterId = null;
let currentCharacterData = null;
let autoSaveTimer = null;
const AUTO_SAVE_DELAY = 1500;

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
                console.log('Sending update via socket');
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

function renderCharacterSheet(characterName, data) {
    document.getElementById('character-sheet-name').textContent = characterName;
    const tabsContainer = document.getElementById('sheet-tabs');
    const contentContainer = document.getElementById('sheet-content');
    tabsContainer.innerHTML = '';
    contentContainer.innerHTML = '';

    const tabs = [
        { id: 'basic', title: 'Основное' },
        { id: 'health', title: 'Здоровье' },
        { id: 'skills', title: 'Навыки' },
        { id: 'equipment', title: 'Экипировка' },
        { id: 'inventory', title: 'Инвентарь' },
        { id: 'modifications', title: 'Модификации' },
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

    renderBasicTab(data);
    renderHealthTab(data);
    renderSkillsTab(data);
    renderEquipmentTab(data);
    renderInventoryTab(data);
    renderModificationsTab(data);
    renderNotesTab(data);
    renderSettingsTab(data);

    // Добавляем автосохранение при любом изменении
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
function renderBasicTab(data) {
    const container = document.getElementById('sheet-tab-basic');
    const basic = data.basic || {};
    const bg = basic.background || {};

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
                <select name="basic.background.skillBonuses.${index}.skill" style="flex:2;">
                    ${skillCategories.map(cat => `<option value="${cat.path}" ${bonus.skill === cat.path ? 'selected' : ''}>${cat.label}</option>`).join('')}
                </select>
                <input type="number" class="number-input" name="basic.background.skillBonuses.${index}.bonus" value="${bonus.bonus || 0}" style="width: 60px;" placeholder="Бонус">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeBackgroundSkillBonus(${index})">✕</button>
            </div>
        `;
    });

    let html = `
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
        <div style="display: flex; gap: 10px; margin-bottom: 10px;">
            <div style="flex: 1;">
                <label>Плюсы</label>
                <textarea class="form-control" name="basic.background.pluses" rows="2" style="min-height: auto;">${escapeHtml(bg.pluses || '')}</textarea>
            </div>
            <div style="flex: 1;">
                <label>Минусы</label>
                <textarea class="form-control" name="basic.background.minuses" rows="2" style="min-height: auto;">${escapeHtml(bg.minuses || '')}</textarea>
            </div>
        </div>
        <div>
            <label>Бонусы к навыкам</label>
            <div id="background-skill-bonuses">
                ${skillBonusesHtml}
            </div>
            <button type="button" class="btn btn-sm" onclick="addBackgroundSkillBonus()">+ Добавить бонус навыка</button>
        </div>
    `;
    container.innerHTML = html;

    window.toggleCustomBackground = function(select) {
        const customInput = document.getElementById('custom-background');
        if (select.value === 'custom') {
            customInput.style.display = 'block';
        } else {
            customInput.style.display = 'none';
        }
    };
}

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
function renderHealthTab(data) {
    const container = document.getElementById('sheet-tab-health');
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
    `;
    container.innerHTML = html;
}

window.addEffect = function() {
    updateDataFromFields();
    if (!currentCharacterData.health) currentCharacterData.health = {};
    if (!Array.isArray(currentCharacterData.health.effects)) {
        currentCharacterData.health.effects = [];
    }
    currentCharacterData.health.effects.push({ name: '', value: 0 });
    renderHealthTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeEffect = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.health?.effects) return;
    currentCharacterData.health.effects.splice(index, 1);
    renderHealthTab(currentCharacterData);
    scheduleAutoSave();
};

// ---------- Вкладка Навыки ----------
function renderSkillsTab(data) {
    const container = document.getElementById('sheet-tab-skills');
    const skills = data.skills || {};
    const physical = skills.physical || {};
    const social = skills.social || {};
    const other = skills.other || {};
    const specialized = skills.specialized || {};

    // Списки навыков по категориям
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

    // Унифицированная строка навыка
    function renderSkillRow(label, base, bonus, path) {
        return `
            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 5px;">
                <span style="min-width: 120px; white-space: normal; word-break: break-word; cursor: pointer;" onclick="window.rollSkill('${path}')">${label}</span>
                <input type="number" class="form-control number-input" name="skills.${path}.base" value="${base}" style="width: 60px;">
                <span>+</span>
                <input type="number" class="form-control number-input" name="skills.${path}.bonus" value="${bonus}" style="width: 60px;">
                <span style="cursor: pointer; font-size: 1.2em;" onclick="window.rollSkill('${path}')">🎲</span>
            </div>
        `;
    }

    let html = '';

    // Контейнер для четырёх колонок
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
                <select name="skills.specialized.${key}.level" class="form-control" style="width: 130px;">${select}</select>
            </div>
        `;
    }
    html += `</div>`; // закрываем четвёртую колонку

    html += `</div>`; // закрываем контейнер четырёх колонок

    // Очки навыков и специализации
    html += `
        <hr>
        <div style="display: flex; gap: 15px;">
            <div><label>Очки навыков</label><input type="number" class="form-control number-input" name="skills.skillPoints" value="${skills.skillPoints || 30}"></div>
            <div><label>Специализации</label><input type="number" class="form-control number-input" name="skills.specializations" value="${skills.specializations || 10}"></div>
        </div>
        <h4>Особые черты</h4>
        <div id="special-traits-container"></div>
        <button type="button" class="btn btn-sm" onclick="addSpecialTrait()">+ Добавить</button>
    `;

    container.innerHTML = html;
    renderSpecialTraits(data.features?.specialTraits || []);
}

function renderSpecialTraits(traits) {
    const container = document.getElementById('special-traits-container');
    if (!container) return;
    container.innerHTML = '';

    const predefinedTraits = [
        { name: 'Крепкий орешек', effect: '+10 к здоровью', cost: 2 },
        { name: 'Снайпер', effect: '+1 к стрельбе', cost: 1 },
        { name: 'Нюх на аномалии', effect: 'Обнаружение аномалий на 10м', cost: 3 }
    ];

    traits.forEach((trait, index) => {
        const traitSelect = predefinedTraits.map(pt =>
            `<option value="${pt.name}" ${trait.name === pt.name ? 'selected' : ''}>${pt.name}</option>`
        ).join('');
        const div = document.createElement('div');
        div.className = 'trait-item';
        div.innerHTML = `
            <div style="display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-bottom: 5px;">
                <select name="features.specialTraits.${index}.name" class="form-control" style="min-width:150px; flex: 1;" onchange="fillTraitFromPreset(this, ${index})">
                    <option value="">-- Выберите --</option>
                    ${traitSelect}
                </select>
                <input type="text" class="form-control" name="features.specialTraits.${index}.effect" value="${escapeHtml(trait.effect || '')}" placeholder="Эффект" style="flex: 2;">
                <input type="number" class="form-control number-input" name="features.specialTraits.${index}.cost" value="${trait.cost || 0}" placeholder="Стоимость" style="width: 70px;">
                <button type="button" class="btn btn-sm btn-danger" onclick="removeSpecialTrait(${index})">✕</button>
            </div>
        `;
        container.appendChild(div);
    });

    window.fillTraitFromPreset = function(select, index) {
        const selectedName = select.value;
        const preset = predefinedTraits.find(p => p.name === selectedName);
        if (preset) {
            const effectInput = document.querySelector(`input[name="features.specialTraits.${index}.effect"]`);
            const costInput = document.querySelector(`input[name="features.specialTraits.${index}.cost"]`);
            if (effectInput) effectInput.value = preset.effect;
            if (costInput) costInput.value = preset.cost;
        }
    };
}

window.addSpecialTrait = function() {
    updateDataFromFields();
    if (!currentCharacterData.features) currentCharacterData.features = {};
    if (!Array.isArray(currentCharacterData.features.specialTraits)) {
        currentCharacterData.features.specialTraits = [];
    }
    currentCharacterData.features.specialTraits.push({ name: '', effect: '', cost: 0 });
    renderSpecialTraits(currentCharacterData.features.specialTraits);
    scheduleAutoSave();
};

window.removeSpecialTrait = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.features?.specialTraits) return;
    currentCharacterData.features.specialTraits.splice(index, 1);
    renderSpecialTraits(currentCharacterData.features.specialTraits);
    scheduleAutoSave();
};

// ---------- Вкладка Экипировка ----------
function renderEquipmentTab(data) {
    const container = document.getElementById('sheet-tab-equipment');
    const eq = data.equipment || {};
    const helmet = eq.helmet || {};
    const gasMask = eq.gasMask || {};
    const armor = eq.armor || {};
    const weapons = data.weapons || [];

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

    let html = `
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Шлем</h4>
                <span class="protection-header">Защита</span>
            </div>
            <div class="equipment-row">
                <div class="fields-container">
                    <div class="field-group field-name">
                        <label style="text-align: center; width: 100%;">Название</label>
                        <select name="equipment.helmet.name" class="form-control" onchange="fillHelmetFromPreset(this)">
                            <option value="">-- Выберите --</option>
                            <option value="Легкий шлем" ${helmet.name === 'Легкий шлем' ? 'selected' : ''}>Легкий шлем</option>
                            <option value="Тяжелый шлем" ${helmet.name === 'Тяжелый шлем' ? 'selected' : ''}>Тяжелый шлем</option>
                            <option value="Тактический шлем" ${helmet.name === 'Тактический шлем' ? 'selected' : ''}>Тактический шлем</option>
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Прочность</label>
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
        </div>

        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Противогаз</h4>
                <span class="protection-header">Защита</span>
            </div>
            <div class="equipment-row">
                <div class="fields-container">
                    <div class="field-group field-name">
                        <label style="text-align: center; width: 100%;">Название</label>
                        <select name="equipment.gasMask.name" class="form-control" onchange="fillGasMaskFromPreset(this)">
                            <option value="">-- Выберите --</option>
                            <option value="Противогаз ГП-5" ${gasMask.name === 'Противогаз ГП-5' ? 'selected' : ''}>Противогаз ГП-5</option>
                            <option value="Противогаз ПМК" ${gasMask.name === 'Противогаз ПМК' ? 'selected' : ''}>Противогаз ПМК</option>
                        </select>
                    </div>
                    <div class="field-group field-checkbox">
                        <label style="text-align: center; width: 100%;">Надет</label>
                        <input type="checkbox" name="equipment.gasMask.isWorn" ${gasMask.isWorn ? 'checked' : ''}>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Прочность</label>
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
        </div>

        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Броня</h4>
                <span class="protection-header">Защита</span>
            </div>
            <div class="equipment-row">
                <div class="fields-container">
                    <div class="field-group field-name">
                        <label style="text-align: center; width: 100%;">Название</label>
                        <select name="equipment.armor.name" class="form-control" onchange="fillArmorFromPreset(this)">
                            <option value="">-- Выберите --</option>
                            <option value="Бронежилет 6Б23" ${armor.name === 'Бронежилет 6Б23' ? 'selected' : ''}>Бронежилет 6Б23</option>
                            <option value="Экзоскелет" ${armor.name === 'Экзоскелет' ? 'selected' : ''}>Экзоскелет</option>
                        </select>
                    </div>
                    <div class="field-group field-number">
                        <label style="text-align: center; width: 100%;">Прочность</label>
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
        </div>

        <!-- Блок оружия, обёрнутый в equipment-group для единообразия -->
        <div class="equipment-group">
            <div class="equipment-header">
                <h4>Оружие</h4>
                <!-- Можно оставить пустой span, если не нужна защита, или добавить заглушку -->
                <span class="protection-header"></span>
            </div>
            <div class="equipment-row" style="flex-direction: column; align-items: stretch;">
                <div id="weapons-container"></div>
                <button type="button" class="btn btn-sm" onclick="addWeapon()" style="align-self: flex-start; margin-top: 10px;">+ Добавить оружие</button>
            </div>
        </div>
    `;
    container.innerHTML = html;
    renderWeapons(weapons);
}

function renderWeapons(weapons) {
    const container = document.getElementById('weapons-container');
    if (!container) return;
    container.innerHTML = '';

    const weaponModels = [
        { name: 'АК-74', accuracy: 5, noise: 80, ammo: '5.45x39', range: 500, ergonomics: 50, burst: '3', damage: 15, durability: 100, fireRate: 600, weight: 3.5 },
        { name: 'ПМ', accuracy: 3, noise: 60, ammo: '9x18', range: 50, ergonomics: 70, burst: '-', damage: 8, durability: 80, fireRate: 30, weight: 0.8 },
        { name: 'СВД', accuracy: 8, noise: 90, ammo: '7.62x54', range: 800, ergonomics: 40, burst: '-', damage: 20, durability: 90, fireRate: 30, weight: 4.3 }
    ];
    const moduleOptions = ['Прицел', 'Глушитель', 'ЛЦУ', 'Ремень', 'Магазин'];
    const modOptions = ['Нарезной ствол', 'Утяжеленный затвор', 'Спортивный спуск'];

    // Определяем колонки: каждая имеет путь к данным, метку, ширину, тип (text/number)
    const columns = [
        { key: 'name', label: 'Название', width: 200, type: 'text' },
        { key: 'magazine', label: 'Магазин', width: 70, type: 'text' },
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

    weapons.forEach((weapon, index) => {
        const modules = Array.isArray(weapon.modules) ? weapon.modules : [];
        const modifications = Array.isArray(weapon.modifications) ? weapon.modifications : [];

        // Создаём flex-контейнер для всей строки полей, каждый столбец будет содержать лейбл и поле
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

        // Блок выбора модели (только если модель не выбрана)
        let modelBlock = '';
        if (!weapon.model) {
            modelBlock = `
                <div style="display: flex; gap: 5px; align-items: center; margin-bottom: 10px;">
                    <select id="weapon-model-select-${index}" class="form-control" style="width: 200px;">
                        <option value="">-- Выберите модель --</option>
                        ${weaponModels.map(m => `<option value="${m.name}">${m.name}</option>`).join('')}
                    </select>
                    <button type="button" class="btn btn-sm btn-primary" onclick="selectWeaponModel(${index})">Выбрать</button>
                </div>
            `;
        } else {
            modelBlock = ''; // полностью убираем
        }

        // Модули
        let modulesHtml = '';
        modules.forEach((mod, mi) => {
            modulesHtml += `
                <div style="display: flex; gap: 5px; margin-bottom: 3px; align-items: center;">
                    <select name="weapons.${index}.modules.${mi}.name" class="form-control" style="width: 150px;">
                        <option value="">-- Выберите --</option>
                        ${moduleOptions.map(opt => `<option value="${opt}" ${mod.name === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                    <input type="text" class="form-control" name="weapons.${index}.modules.${mi}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                    <button type="button" class="btn btn-sm btn-danger" onclick="removeWeaponModule(${index}, ${mi})">✕</button>
                </div>
            `;
        });

        // Модификации
        let modificationsHtml = '';
        modifications.forEach((mod, mi) => {
            modificationsHtml += `
                <div style="display: flex; gap: 5px; margin-bottom: 3px; align-items: center;">
                    <select name="weapons.${index}.modifications.${mi}.name" class="form-control" style="width: 150px;">
                        <option value="">-- Выберите --</option>
                        ${modOptions.map(opt => `<option value="${opt}" ${mod.name === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                    <input type="text" class="form-control" name="weapons.${index}.modifications.${mi}.description" value="${escapeHtml(mod.description || '')}" placeholder="Описание" style="flex:1;">
                    <button type="button" class="btn btn-sm btn-danger" onclick="removeWeaponModification(${index}, ${mi})">✕</button>
                </div>
            `;
        });

        const weaponDiv = document.createElement('div');
        weaponDiv.className = 'weapon-item';
        weaponDiv.innerHTML = `
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
        `;
        container.appendChild(weaponDiv);
    });

    // Глобальная функция выбора модели
    window.selectWeaponModel = function(index) {
        const select = document.getElementById(`weapon-model-select-${index}`);
        const modelName = select.value;

        if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
        const weapon = currentCharacterData.weapons[index];

        if (modelName) {
            const preset = weaponModels.find(m => m.name === modelName);
            if (preset) {
                weapon.magazine = '';
                weapon.accuracy = preset.accuracy;
                weapon.noise = preset.noise;
                weapon.ammo = preset.ammo;
                weapon.range = preset.range;
                weapon.ergonomics = preset.ergonomics;
                weapon.burst = preset.burst;
                weapon.damage = preset.damage;
                weapon.durability = preset.durability;
                weapon.fireRate = preset.fireRate;
                weapon.weight = preset.weight;
                weapon.name = preset.name;
            }
        }

        // В любом случае помечаем, что модель "выбрана" — блок выбора больше не покажется
        weapon.model = modelName || 'selected';

        renderWeapons(currentCharacterData.weapons);
        scheduleAutoSave();
    };
}

window.fillHelmetFromPreset = function(select) {
    const name = select.value;
    if (!name) return;
    const presets = {
        'Легкий шлем': { durability: 50, maxDurability: 50, material: 'Текстиль', accuracyPenalty: 0, ergonomicsPenalty: 0, charismaBonus: 0, protection: { physical: 10, chemical: 5, thermal: 5, electric: 5, radiation: 0 } },
        'Тяжелый шлем': { durability: 100, maxDurability: 100, material: 'Плита', accuracyPenalty: -5, ergonomicsPenalty: -5, charismaBonus: 0, protection: { physical: 30, chemical: 10, thermal: 10, electric: 10, radiation: 5 } },
        'Тактический шлем': { durability: 80, maxDurability: 80, material: 'Композит', accuracyPenalty: 0, ergonomicsPenalty: 0, charismaBonus: 2, protection: { physical: 20, chemical: 15, thermal: 15, electric: 15, radiation: 10 } }
    };
    const preset = presets[name];
    if (preset) {
        const helmet = currentCharacterData.equipment.helmet || {};
        helmet.currentDurability = preset.durability;
        helmet.maxDurability = preset.maxDurability;
        helmet.material = preset.material;
        helmet.accuracyPenalty = preset.accuracyPenalty;
        helmet.ergonomicsPenalty = preset.ergonomicsPenalty;
        helmet.charismaBonus = preset.charismaBonus;
        helmet.protection = preset.protection;
        helmet.name = name;
        renderEquipmentTab(currentCharacterData);
        scheduleAutoSave();
    }
};

window.fillGasMaskFromPreset = function(select) {
    const name = select.value;
    if (!name) return;
    const presets = {
        'Противогаз ГП-5': { durability: 40, maxDurability: 40, filterRemaining: 100, material: 'Резина', accuracyPenalty: 0, ergonomicsPenalty: -2, charismaBonus: -1, protection: { physical: 0, chemical: 50, thermal: 20, electric: 0, radiation: 80 } },
        'Противогаз ПМК': { durability: 60, maxDurability: 60, filterRemaining: 150, material: 'Композит', accuracyPenalty: 0, ergonomicsPenalty: 0, charismaBonus: 0, protection: { physical: 5, chemical: 70, thermal: 30, electric: 10, radiation: 90 } }
    };
    const preset = presets[name];
    if (preset) {
        const gasMask = currentCharacterData.equipment.gasMask || {};
        gasMask.currentDurability = preset.durability;
        gasMask.maxDurability = preset.maxDurability;
        gasMask.filterRemaining = preset.filterRemaining;
        gasMask.material = preset.material;
        gasMask.accuracyPenalty = preset.accuracyPenalty;
        gasMask.ergonomicsPenalty = preset.ergonomicsPenalty;
        gasMask.charismaBonus = preset.charismaBonus;
        gasMask.protection = preset.protection;
        gasMask.name = name;
        renderEquipmentTab(currentCharacterData);
        scheduleAutoSave();
    }
};

window.fillArmorFromPreset = function(select) {
    const name = select.value;
    if (!name) return;
    const presets = {
        'Бронежилет 6Б23': { durability: 120, maxDurability: 120, material: 'Кевлар', movementPenalty: -2, containerSlots: 2, protection: { physical: 40, chemical: 20, thermal: 20, electric: 20, radiation: 10 } },
        'Экзоскелет': { durability: 200, maxDurability: 200, material: 'Плита', movementPenalty: -5, containerSlots: 4, protection: { physical: 60, chemical: 30, thermal: 30, electric: 30, radiation: 20 } }
    };
    const preset = presets[name];
    if (preset) {
        const armor = currentCharacterData.equipment.armor || {};
        armor.currentDurability = preset.durability;
        armor.maxDurability = preset.maxDurability;
        armor.material = preset.material;
        armor.movementPenalty = preset.movementPenalty;
        armor.containerSlots = preset.containerSlots;
        armor.protection = preset.protection;
        armor.name = name;
        renderEquipmentTab(currentCharacterData);
        scheduleAutoSave();
    }
};

window.addWeapon = function() {
    updateDataFromFields();
    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    currentCharacterData.weapons.push({});
    renderWeapons(currentCharacterData.weapons);
    scheduleAutoSave();
};

window.removeWeapon = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.weapons) return;
    currentCharacterData.weapons.splice(index, 1);
    renderWeapons(currentCharacterData.weapons);
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
    renderWeapons(currentCharacterData.weapons);
    scheduleAutoSave();
};

window.removeWeaponModule = function(weaponIndex, moduleIndex) {
    updateDataFromFields();
    if (!currentCharacterData.weapons?.[weaponIndex]?.modules) return;
    currentCharacterData.weapons[weaponIndex].modules.splice(moduleIndex, 1);
    renderWeapons(currentCharacterData.weapons);
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
    renderWeapons(currentCharacterData.weapons);
    scheduleAutoSave();
};

window.removeWeaponModification = function(weaponIndex, modIndex) {
    updateDataFromFields();
    if (!currentCharacterData.weapons?.[weaponIndex]?.modifications) return;
    currentCharacterData.weapons[weaponIndex].modifications.splice(modIndex, 1);
    renderWeapons(currentCharacterData.weapons);
    scheduleAutoSave();
};

// ---------- Вкладка Инвентарь ----------
function renderInventoryTab(data) {
    const container = document.getElementById('sheet-tab-inventory');
    const inv = data.inventory || {};
    const pockets = Array.isArray(inv.pockets) ? inv.pockets : [];
    const backpack = Array.isArray(inv.backpack) ? inv.backpack : [];
    const money = inv.money || 0;
    const detectors = inv.detectors || { anomaly: { name: '', bonus: 0 }, artifact: { name: '', bonus: 0 } };
    const containers = Array.isArray(inv.containers) ? inv.containers : [{ name: 'Н/Д', effect: '' }, { name: 'Н/Д', effect: '' }, { name: 'Н/Д', effect: '' }, { name: 'Н/Д', effect: '' }];
    const pocketMaxVolume = inv.pocketMaxVolume || 10;
    const pocketFill = pockets.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);

    const totalWeight = pockets.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0) +
                        backpack.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0);
    const movePenalty = Math.floor(totalWeight / 10);

    const backpackModels = [
        { name: 'Тактический рюкзак', limit: 30 },
        { name: 'Туристический рюкзак', limit: 20 },
        { name: 'Вещмешок', limit: 15 }
    ];
    const selectedBackpack = inv.backpackModel || backpackModels[0].name;
    const backpackLimit = (backpackModels.find(m => m.name === selectedBackpack) || backpackModels[0]).limit;
    const backpackFill = backpack.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);

    let html = `
        <div style="display: flex; gap: 20px; margin-bottom: 15px; flex-wrap: wrap;">
            <div>
                <label class="money-label">Деньги</label>
                <input type="number" class="form-control number-input" name="inventory.money" value="${money}" style="width: 100px;">
            </div>
            <div>
                <label>Детектор аномалий</label>
                <select name="inventory.detectors.anomaly.name" class="form-control" style="width: 150px;">
                    <option value="">-- Выберите --</option>
                    <option value="Эхолокатор" ${detectors.anomaly.name === 'Эхолокатор' ? 'selected' : ''}>Эхолокатор</option>
                    <option value="Термограф" ${detectors.anomaly.name === 'Термограф' ? 'selected' : ''}>Термограф</option>
                </select>
                <input type="number" class="form-control number-input" name="inventory.detectors.anomaly.bonus" value="${detectors.anomaly.bonus || 0}" placeholder="Бонус" style="width: 70px; margin-top: 5px;">
            </div>
            <div>
                <label>Детектор артефактов</label>
                <select name="inventory.detectors.artifact.name" class="form-control" style="width: 150px;">
                    <option value="">-- Выберите --</option>
                    <option value="Сканер" ${detectors.artifact.name === 'Сканер' ? 'selected' : ''}>Сканер</option>
                    <option value="Счетчик Гейгера" ${detectors.artifact.name === 'Счетчик Гейгера' ? 'selected' : ''}>Счетчик Гейгера</option>
                </select>
                <input type="number" class="form-control number-input" name="inventory.detectors.artifact.bonus" value="${detectors.artifact.bonus || 0}" placeholder="Бонус" style="width: 70px; margin-top: 5px;">
            </div>
        </div>
        <div style="display: flex; gap: 20px; margin-bottom: 15px;">
            <div><strong>Общий вес:</strong> <span id="total-weight-display">${totalWeight}</span></div>
            <div><strong>Штраф перемещения:</strong> <span id="move-penalty-display">${movePenalty}</span></div>
        </div>
        <hr>
        <h4>Контейнеры на броне</h4>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${containers.map((cont, idx) => {
                const containerOptions = ['Н/Д', 'Маленький контейнер', 'Средний контейнер', 'Большой контейнер', 'Оружейный контейнер'];
                const options = containerOptions.map(opt => `<option value="${opt}" ${cont.name === opt ? 'selected' : ''}>${opt}</option>`).join('');
                return `
                    <div>
                        <select name="inventory.containers.${idx}.name" class="form-control" style="width: 150px;">
                            <option value="">-- Выберите --</option>
                            ${options}
                        </select>
                        <input type="text" class="form-control" name="inventory.containers.${idx}.effect" value="${escapeHtml(cont.effect)}" placeholder="Эффект" style="width: 150px; margin-top: 5px;">
                    </div>
                `;
            }).join('')}
        </div>
        <hr>
        <h4>Карманы <span style="font-weight:normal;">(заполнено: <span id="pocket-fill-display">${pocketFill}</span> / <input type="number" class="form-control number-input" name="inventory.pocketMaxVolume" value="${pocketMaxVolume}" style="width:70px; display:inline;">)</span></h4>
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 5px; font-weight: bold; margin-bottom: 5px; align-items: center;">
            <div>Название</div><div>Вес</div><div>Объём</div><div>Кол-во</div><div></div>
        </div>
        <div id="pockets-container"></div>
        <button type="button" class="btn btn-sm btn-primary" onclick="addPocketItem()">+ Добавить</button>

        <h4 style="margin-top:20px;">Рюкзак</h4>
        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px;">
            <label>Модель:</label>
            <select name="inventory.backpackModel" class="form-control" onchange="updateBackpackLimit(this)" style="width: 200px;">
                ${backpackModels.map(m => `<option value="${m.name}" ${selectedBackpack === m.name ? 'selected' : ''}>${m.name} (лимит ${m.limit})</option>`).join('')}
            </select>
            <span>Заполнено: ${backpackFill} / ${backpackLimit}</span>
        </div>
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 5px; font-weight: bold; margin-bottom: 5px; align-items: center;">
            <div>Название</div><div>Вес</div><div>Объём</div><div>Кол-во</div><div></div>
        </div>
        <div id="backpack-container"></div>
        <button type="button" class="btn btn-sm btn-primary" onclick="addBackpackItem()">+ Добавить</button>
    `;
    container.innerHTML = html;
    renderPockets(pockets);
    renderBackpack(backpack);

    const inventoryForm = container;
    inventoryForm.addEventListener('input', (e) => {
        const target = e.target;
        if (target.matches('input[name*="weight"], input[name*="volume"], input[name*="quantity"]')) {
            updateDataFromFields();
            recalculateInventoryTotals();
            scheduleAutoSave();
        }
    });

    window.updateBackpackLimit = function(select) {
        const newModel = select.value;
        const model = backpackModels.find(m => m.name === newModel) || backpackModels[0];
        const fill = backpack.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);
        const limit = model.limit;
        const span = select.parentElement.querySelector('span');
        if (span) span.textContent = `Заполнено: ${fill} / ${limit}`;
    };
}

function recalculateInventoryTotals() {
    const inv = currentCharacterData.inventory || {};
    const pockets = inv.pockets || [];
    const backpack = inv.backpack || [];

    // Заполненность карманов
    const pocketFill = pockets.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);
    const pocketMaxVolume = inv.pocketMaxVolume || 10;
    const pocketFillSpan = document.querySelector('#pocket-fill-display');
    if (pocketFillSpan) {
        pocketFillSpan.textContent = pocketFill;
    }

    // Общий вес и штраф
    const totalWeight = pockets.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0) +
                        backpack.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0);
    const movePenalty = Math.floor(totalWeight / 10);
    const totalWeightSpan = document.querySelector('#total-weight-display');
    const movePenaltySpan = document.querySelector('#move-penalty-display');
    if (totalWeightSpan) totalWeightSpan.textContent = totalWeight;
    if (movePenaltySpan) movePenaltySpan.textContent = movePenalty;
}

function renderPockets(pockets) {
    const container = document.getElementById('pockets-container');
    if (!container) return;
    container.innerHTML = '';
    pockets.forEach((item, index) => {
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr auto';
        row.style.gap = '5px';
        row.style.marginBottom = '5px';
        row.style.alignItems = 'center';
        row.innerHTML = `
            <input type="text" class="form-control" name="inventory.pockets.${index}.name" value="${escapeHtml(item.name || '')}" placeholder="Название">
            <input type="number" class="form-control number-input" name="inventory.pockets.${index}.weight" value="${item.weight || 0}" placeholder="Вес">
            <input type="number" class="form-control number-input" name="inventory.pockets.${index}.volume" value="${item.volume || 0}" placeholder="Объём">
            <input type="number" class="form-control number-input" name="inventory.pockets.${index}.quantity" value="${item.quantity || 1}" placeholder="Кол-во">
            <button type="button" class="btn btn-sm btn-danger" onclick="removePocketItem(${index})">✕</button>
        `;
        container.appendChild(row);
    });
}

function renderBackpack(backpack) {
    const container = document.getElementById('backpack-container');
    if (!container) return;
    container.innerHTML = '';
    backpack.forEach((item, index) => {
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr auto';
        row.style.gap = '5px';
        row.style.marginBottom = '5px';
        row.style.alignItems = 'center';
        row.innerHTML = `
            <input type="text" class="form-control" name="inventory.backpack.${index}.name" value="${escapeHtml(item.name || '')}" placeholder="Название">
            <input type="number" class="form-control number-input" name="inventory.backpack.${index}.weight" value="${item.weight || 0}" placeholder="Вес">
            <input type="number" class="form-control number-input" name="inventory.backpack.${index}.volume" value="${item.volume || 0}" placeholder="Объём">
            <input type="number" class="form-control number-input" name="inventory.backpack.${index}.quantity" value="${item.quantity || 1}" placeholder="Кол-во">
            <button type="button" class="btn btn-sm btn-danger" onclick="removeBackpackItem(${index})">✕</button>
        `;
        container.appendChild(row);
    });
}

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

// ---------- Вкладка Модификации ----------
function renderModificationsTab(data) {
    const container = document.getElementById('sheet-tab-modifications');
    const mods = data.modifications || {};

    function renderModGroup(title, groupKey, groupData) {
        if (groupKey === 'pda') {
            const items = Array.isArray(groupData?.items) ? groupData.items : [];
            let itemsHtml = items.map((item, idx) => `
                <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                    <input type="text" class="form-control" name="modifications.pda.items.${idx}.name" value="${escapeHtml(item.name || '')}" placeholder="Название" style="flex:1;">
                    <input type="text" class="form-control" name="modifications.pda.items.${idx}.effect" value="${escapeHtml(item.effect || '')}" placeholder="Эффект" style="flex:2;">
                    <button type="button" class="btn btn-sm btn-danger" onclick="removePdaItem(${idx})">✕</button>
                </div>
            `).join('');
            return `
                <h4>${title}</h4>
                <div id="pda-items-container">
                    ${itemsHtml}
                </div>
                <button type="button" class="btn btn-sm btn-primary" onclick="addPdaItem()">+ Добавить модификацию КПК</button>
            `;
        } else {
            const slots = Array.isArray(groupData?.slots) ? groupData.slots : ['', '', '', ''];
            const effects = Array.isArray(groupData?.effects) ? groupData.effects : ['', '', '', ''];
            let html = `<h4>${title}</h4>`;
            for (let i = 0; i < 4; i++) {
                html += `
                    <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                        <input type="text" class="form-control" name="modifications.${groupKey}.slots.${i}" value="${escapeHtml(slots[i])}" placeholder="Слот ${i+1}" style="flex:1;">
                        <input type="text" class="form-control" name="modifications.${groupKey}.effects.${i}" value="${escapeHtml(effects[i])}" placeholder="Эффект" style="flex:2;">
                    </div>
                `;
            }
            return html;
        }
    }

    let html = '';
    html += renderModGroup('Броня', 'armor', mods.armor);
    html += renderModGroup('Шлем', 'helmet', mods.helmet);
    html += renderModGroup('Противогаз', 'gasMask', mods.gasMask);
    html += renderModGroup('Забрало', 'visor', mods.visor);
    html += renderModGroup('КПК', 'pda', mods.pda);
    container.innerHTML = html;
}

window.addPdaItem = function() {
    updateDataFromFields();
    if (!currentCharacterData.modifications) currentCharacterData.modifications = {};
    if (!currentCharacterData.modifications.pda) currentCharacterData.modifications.pda = {};
    if (!Array.isArray(currentCharacterData.modifications.pda.items)) {
        currentCharacterData.modifications.pda.items = [];
    }
    currentCharacterData.modifications.pda.items.push({ name: '', effect: '' });
    renderModificationsTab(currentCharacterData);
    scheduleAutoSave();
};

window.removePdaItem = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.modifications?.pda?.items) return;
    currentCharacterData.modifications.pda.items.splice(index, 1);
    renderModificationsTab(currentCharacterData);
    scheduleAutoSave();
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

    // Кнопки для владельца
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

// Глобальные функции для вкладки настроек
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
        renderCharacterSheet(character.name, currentCharacterData);
        document.getElementById('character-sheet-modal').style.display = 'flex';

        const socket = getSocket();
        if (socket) {
            socket.emit('join_character', { token: localStorage.getItem('access_token'), character_id: characterId });

            socket.off('character_data_updated');
            socket.on('character_data_updated', (data) => {
                console.log('character_data_updated received', data);
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
                            case 'health': renderHealthTab(currentCharacterData); break;
                            case 'skills': renderSkillsTab(currentCharacterData); break;
                            case 'equipment': renderEquipmentTab(currentCharacterData); break;
                            case 'inventory': renderInventoryTab(currentCharacterData); break;
                            case 'modifications': renderModificationsTab(currentCharacterData); break;
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

window.rollSkill = function(skillPath) {
    if (!currentCharacterData) return;
    const parts = skillPath.split('.');
    let skillObj = currentCharacterData.skills;
    for (const part of parts) {
        if (!skillObj) break;
        skillObj = skillObj[part];
    }
    const base = skillObj?.base || 0;
    const bonus = skillObj?.bonus || 0;
    const total = base + bonus;
    showNotification(`Бросок ${skillPath}: ${total} (база ${base} + бонус ${bonus})`, 'system');
};