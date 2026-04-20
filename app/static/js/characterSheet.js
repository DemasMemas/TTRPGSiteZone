// static/js/characterSheet.js
/*
 * ===================================================================
 *                    ЛИСТ ПЕРСОНАЖА (characterSheet.js)
 * ===================================================================
 *
 * ОГЛАВЛЕНИЕ:
 * 1. Состояние и утилиты (переменные, escapeHtml, setValueByPath, scheduleAutoSave)
 * 2. Рендеринг листа и переключение вкладок (renderCharacterSheet, switchSheetTab)
 * 3. Вкладка "Основное" (renderBasicTab) + предыстория, контейнеры
 * 4. Вкладка "Навыки" (renderSkillsTab) + особые черты
 * 5. Вкладка "Экипировка" (renderEquipmentTab) + оружие, броня, шлем, противогаз
 * 6. Вкладка "Инвентарь" (renderInventoryTab) + карманы, пояс, разгрузка, рюкзак
 * 7. Вкладка "Заметки" (renderNotesTab)
 * 8. Вкладка "Настройки" (renderSettingsTab) + видимость, удаление
 * 9. Публичные функции (openCharacterSheet, closeCharacterSheet, export/import)
 * 10. Вспомогательные функции для UI (добавление/удаление предметов, оружия, модификаций)
 * 11. Модальные окна создания кастомных шаблонов (сохранение в БД)
 * 12. Вкладка "Здоровье" (renderHealthTab)
 */

import { Server } from './api.js';
import { showNotification } from './utils.js';
import { lobbyParticipants } from './ui.js';
import { getSocket } from './socketHandlers.js';

// ========== 1. СОСТОЯНИЕ И УТИЛИТЫ ==========
let currentCharacterId = null;
let currentCharacterData = null;
let autoSaveTimer = null;
const AUTO_SAVE_DELAY = 500;

let vestTemplateEditorPouches = [];

// Кеш шаблонов для текущей комнаты
let templatesCache = {};
let currentLobbyId = null;
let cachedBackpackTemplates = [];
export function setCurrentLobbyId(id) {
    currentLobbyId = id;
}

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
const MATERIAL_OPTIONS = [
    'Текстиль',
    'Композит',
    'Кевлар',
    'Плита'
];
const MATERIAL_COEFFICIENTS = {
    'Текстиль': 0.5,
    'Композит': 1,
    'Кевлар': 1.5,
    'Плита': 2
};

// Универсальная загрузка шаблонов по категории
async function loadTemplatesForLobby(category, subcategory = null) {
    if (!currentLobbyId) throw new Error('Lobby ID not set');
    const cacheKey = `${currentLobbyId}_${category}_${subcategory || ''}`;
    if (templatesCache[cacheKey]) return templatesCache[cacheKey];

    const data = await Server.getLobbyTemplates(currentLobbyId, category, subcategory);
    const all = [
        ...data.global.map(t => ({ ...t, source: 'global' })),
        ...data.local.map(t => ({ ...t, id: t.id + 1_000_000, source: 'local' }))
    ];
    templatesCache[cacheKey] = all;
    return all;
}

function clearTemplatesCache(category) {
    if (category) {
        const keyPattern = `${currentLobbyId}_${category}`;
        Object.keys(templatesCache).forEach(key => {
            if (key.startsWith(keyPattern)) delete templatesCache[key];
        });
    } else {
        Object.keys(templatesCache).forEach(key => {
            if (key.startsWith(currentLobbyId + '_')) delete templatesCache[key];
        });
    }
}

let allTemplatesCache = null;

function getCategoryDisplay(cat) {
    const map = {
        'weapon': 'Оружие',
        'melee_weapon': 'Оружие ближнего боя',
        'armor': 'Броня',
        'helmet': 'Шлемы',
        'gas_mask': 'Противогазы',
        'detector': 'Детекторы',
        'container': 'Контейнеры',
        'consumable': 'Расходники',
        'crafting_material': 'Материалы',
        'artifact': 'Артефакты',
        'backpack': 'Рюкзаки',
        'vest': 'Разгрузки',
        'pouch': 'Подсумки',
        'weapon_module': 'Оружейные модули',
        'magazine': 'Магазины',
        'ammo': 'Патроны',
        'gas_mask_module': 'Фильтры противогазов',
        'helmet_module': 'Модули шлемов',
        'visor': 'Забрала',
        'belt': 'Пояс',
        'grenade': 'Гранаты',
        'device': 'Приборы',
        'armor_plate': 'Бронеплиты',
    };
    return map[cat] || cat;
}

async function getAllItemTemplates(forceRefresh = false) {
    if (!forceRefresh && allTemplatesCache) return allTemplatesCache;

    const categories = [
        'weapon', 'armor', 'helmet', 'gas_mask', 'detector', 'container',
        'consumable', 'crafting_material', 'artifact', 'backpack', 'vest', 'pouch',
        'weapon_module', 'magazine', 'ammo', 'gas_mask_module', 'helmet_module', 'visor', 'belt',
        'grenade', 'device', 'armor_plate', 'melee_weapon'
    ];

    let all = [];
    for (const cat of categories) {
        try {
            const templates = await loadTemplatesForLobby(cat);
            all = all.concat(templates.map(t => ({
                ...t,
                categoryDisplay: getCategoryDisplay(cat),
                // Для удобства: вытаскиваем вес и объём из attributes или корня
                effectiveWeight: t.attributes?.weight !== undefined ? t.attributes.weight : (t.weight || 0),
                effectiveVolume: t.attributes?.volume !== undefined ? t.attributes.volume : (t.volume || 0)
            })));
        } catch (e) {
            console.warn(`Failed to load ${cat} templates`, e);
        }
    }
    allTemplatesCache = all;
    return all;
}

function clearAllTemplatesCache() {
    allTemplatesCache = null;
    const categories = ['weapon', 'armor', 'helmet', 'gas_mask', 'detector', 'container',
                        'consumable', 'crafting_material', 'artifact', 'modification', 'backpack', 'vest', 'pouch',
                        'weapon_module'];
    categories.forEach(cat => clearTemplatesCache(cat));
}

function getRequiredXp(level) {
    return level < 11 ? 1 : level - 10;
}

function getSkillByPath(path) {
    const parts = path.split('.');
    let skill = currentCharacterData.skills;
    for (const part of parts) {
        if (!skill) return null;
        skill = skill[part];
    }
    return skill;
}

function checkAndLevelUpSkill(skill, skillPath) {
    while (true) {
        const required = getRequiredXp(skill.base);
        if (skill.xp >= required) {
            skill.xp -= required;
            skill.base += 1;
            showNotification(`Навык ${skillPath.split('.').pop()} повышен до ${skill.base}!`, 'system');
        } else {
            break;
        }
    }
}

window.addSkillXpFromPoints = function(skillPath) {
    if (!currentCharacterData.skills) currentCharacterData.skills = {};
    let skill = getSkillByPath(skillPath);
    if (!skill) return;

    let freePoints = currentCharacterData.skills.skillPoints ?? 30;
    if (freePoints <= 0) {
        showNotification('Нет свободных очков навыков');
        return;
    }

    currentCharacterData.skills.skillPoints = freePoints - 1;

    skill.xp = (skill.xp || 0) + 1;

    checkAndLevelUpSkill(skill, skillPath);

    renderSkillsTab(currentCharacterData);
    scheduleAutoSave();
};

window.addSkillXpFromUse = function(skillPath) {
    let skill = getSkillByPath(skillPath);
    if (!skill) return;

    skill.xp = (skill.xp || 0) + 1;
    checkAndLevelUpSkill(skill, skillPath);

    renderSkillsTab(currentCharacterData);
    scheduleAutoSave();
};

window.addWeaponXp = function(weaponKey) {
    if (!currentCharacterData.skills) currentCharacterData.skills = {};
    if (!currentCharacterData.skills.specialized) currentCharacterData.skills.specialized = {};

    let weapon = currentCharacterData.skills.specialized[weaponKey];
    if (!weapon) {
        weapon = { level: 'unfamiliar', xp: 0 };
        currentCharacterData.skills.specialized[weaponKey] = weapon;
    }

    if (weapon.level === 'professional') {
        showNotification('Уже профессионал, дальше не развивается');
        return;
    }

    const required = weapon.level === 'unfamiliar' ? 5 : 25;
    weapon.xp = (weapon.xp || 0) + 1;

    // Проверка на повышение (возможно, сразу несколько)
    while (true) {
        const currentLevel = weapon.level;
        const need = currentLevel === 'unfamiliar' ? 5 : (currentLevel === 'familiar' ? 25 : 0);
        if (need === 0) break;
        if (weapon.xp >= need) {
            weapon.xp -= need;
            if (currentLevel === 'unfamiliar') {
                weapon.level = 'familiar';
                showNotification(`Владение ${weaponKey} повышено до Знаком!`, 'system');
            } else if (currentLevel === 'familiar') {
                weapon.level = 'professional';
                showNotification(`Владение ${weaponKey} повышено до Профессионал!`, 'system');
            }
        } else {
            break;
        }
    }

    renderSkillsTab(currentCharacterData);
    scheduleAutoSave();
};

window.setWeaponLevel = function(weaponKey, newLevel) {
    if (!currentCharacterData.skills) currentCharacterData.skills = {};
    if (!currentCharacterData.skills.specialized) currentCharacterData.skills.specialized = {};

    let weapon = currentCharacterData.skills.specialized[weaponKey];
    if (!weapon) weapon = {};

    weapon.level = newLevel;
    weapon.xp = 0; // при ручной смене уровня сбрасываем накопленный прогресс

    currentCharacterData.skills.specialized[weaponKey] = weapon;
    renderSkillsTab(currentCharacterData);
    scheduleAutoSave();
};

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
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
        // Преобразование для templateId и подобных полей
        if (name.endsWith('templateId') || name.endsWith('Id')) {
            value = value === '' ? null : Number(value);
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
                Server.updateCharacter(currentCharacterId, { data: currentCharacterData })
                    .then(() => console.log('Auto-saved via HTTP'))
                    .catch(err => showNotification('Ошибка автосохранения: ' + err.message));
            }
        }
    }, AUTO_SAVE_DELAY);
}

function forceSyncCharacter() {
    const socket = getSocket();
    if (socket && currentCharacterId) {
        socket.emit('update_character_data', {
            token: localStorage.getItem('access_token'),
            character_id: currentCharacterId,
            updates: { data: currentCharacterData }
        });
    }
}

// ========== УНИВЕРСАЛЬНАЯ МОДЕЛЬ ПРЕДМЕТА ==========
function generateItemId() {
    return 'item_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ========== УНИВЕРСАЛЬНЫЕ ФУНКЦИИ РАБОТЫ СО СЛОТАМИ ==========

// Получить доступные слоты предмета на основе его шаблона.
function getItemSlots(item) {
    const templateId = item.templateId || item.type; // подсумки используют type
    if (!templateId) return [];
    const templates = allTemplatesCache || [];
    const template = templates.find(t => t.id === templateId);
    return template?.attributes?.slots || [];
}

function getEffectiveTorsoProtection() {
    const eq = currentCharacterData.equipment || {};
    const vest = eq.vest;
    console.log('Vest:', vest);
    if (!vest || !vest.pouches) return null;

    const allTemplates = allTemplatesCache || [];
    const platePouches = vest.pouches.filter(pouch => {
        if (!pouch.type) return false;
        const template = allTemplates.find(t => t.id === pouch.type);
        const hasSlot = template?.attributes?.slots?.some(s => s.type === 'armor_plate');
        console.log('Pouch type:', pouch.type, 'has armor_plate slot:', hasSlot);
        return hasSlot;
    });

    console.log('Plate pouches found:', platePouches.length);

    if (platePouches.length === 0) return null;

    const frontPouch = platePouches[0];
    const backPouch = platePouches[1] || null;

    const getPlateProtection = (pouch) => {
        if (!pouch) return null;
        const installedPlate = (pouch.installedModules || []).find(m => m.slotType === 'armor_plate');
        if (!installedPlate) return null;
        return getPlateEffectiveProtection(installedPlate);
    };

    const front = getPlateProtection(frontPouch);
    const back = getPlateProtection(backPouch);
    console.log('Front protection:', front, 'Back protection:', back);

    return { front, back };
}

function getPlateEffectiveProtection(plate) {
    if (!plate || plate.durability <= 0) return 0;
    let protection = plate.attributes?.protection?.physical || 0;
    const stage = plate.stage || 1;
    if (stage >= 3) protection = Math.floor(protection * 0.9);
    if (stage >= 4) protection = Math.floor(protection * 0.9); // от текущего значения
    if (stage >= 5) protection = Math.floor(protection * 0.75);
    return protection;
}

// Восстановить предмет по сохранённому пути.
function restoreItemToPath(item, path) {
    let parent = currentCharacterData;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (Array.isArray(parent) && typeof key === 'number') parent = parent[key];
        else if (typeof parent === 'object' && key in parent) parent = parent[key];
        else return false;
    }
    const lastKey = path[path.length - 1];
    if (Array.isArray(parent)) {
        parent.splice(lastKey, 0, item);
        return true;
    }
    return false;
}

// Добавить предмет в рюкзак (fallback).
function addToBackpack(item) {
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(item);
}

// Универсальная установка модуля в слот.
function universalInstallModule(targetItem, targetPath, moduleItem, modulePath, slotType) {
    if (!targetItem.installedModules) targetItem.installedModules = [];

    // Обработка стопки
    if (moduleItem.quantity > 1) {
        // Создаём копию с quantity = 1
        moduleItem = { ...moduleItem, quantity: 1 };
        // Уменьшаем количество в исходной стопке
        const originalItem = getItemByPath(modulePath);
        if (originalItem) {
            originalItem.quantity -= 1;
            if (originalItem.category === 'ammo') updateAmmoWeight(originalItem);
        }
    } else {
        // Удаляем модуль из инвентаря
        if (!removeItemByPath(modulePath)) {
            return false;
        }
    }

    // Замена старого модуля
    const existingIndex = targetItem.installedModules.findIndex(m => m.slotType === slotType);
    if (existingIndex !== -1) {
        const oldMod = targetItem.installedModules[existingIndex];
        targetItem.installedModules.splice(existingIndex, 1);
        if (!restoreItemToPath(oldMod, modulePath)) {
            addToBackpack(oldMod);
        }
    }

    moduleItem.sourcePath = modulePath;
    moduleItem.slotType = slotType;
    targetItem.installedModules.push(moduleItem);
    return true;
}

/**
 * Создаёт экземпляр предмета из шаблона
 * @param {Object} template - шаблон предмета из getLobbyTemplates
 * @param {number} quantity - количество (для стакающихся)
 * @returns {Object} экземпляр Item
 */
function createItemFromTemplate(template, quantity = 1) {
    const item = {
        id: generateItemId(),
        templateId: template.id,
        name: template.name,
        category: template.category,
        subcategory: template.subcategory,
        quantity: quantity,
        weight: template.weight || 0,
        volume: template.volume || 0,
        price: template.price || 0,
        attributes: { ...template.attributes },
        durability: template.attributes?.durability || null,
        maxDurability: template.attributes?.max_durability || null,
        installedModules: [],
        contents: [],
        isContainer: template.category === 'container' || template.category === 'backpack' || template.category === 'pouch',
        isEquippable: ['weapon', 'armor', 'helmet', 'gas_mask'].includes(template.category),
        isStackable: ['consumable', 'crafting_material', 'artifact', 'ammo'].includes(template.category)
    };

    if (template.category === 'magazine') {
        item.emptyWeight = template.attributes?.emptyWeight || 0;
        item.loadedWeight = template.attributes?.loadedWeight || 0;
        item.ammo = [];
        Object.defineProperty(item, 'currentAmmo', {
            get() { return this.ammo.reduce((sum, a) => sum + a.quantity, 0); },
            enumerable: true
        });
        item.weight = item.emptyWeight;
        item.isLoader = template.attributes?.isLoader || false;
    }

    if (template.category === 'ammo') {
        // Начальный вес пачки патронов
        const qty = item.quantity;
        if (qty === 0) {
            item.weight = 0;
        } else {
            const singleVolume = item.volume || 0.02;
            const occupiedVolume = singleVolume * qty;
            item.weight = (occupiedVolume < 0.5) ? 0.1 : 0.25;
        }
    }

    if (template.category === 'armor_plate') {
        initArmorStagedDurability(item, template);
    }

    return item;
}

function migrateOldItemToNew(oldItem) {
    if (oldItem.id) return oldItem;

    return {
        id: generateItemId(),
        templateId: oldItem.templateId || null,
        name: oldItem.name,
        category: oldItem.category || 'misc',
        quantity: oldItem.quantity || 1,
        weight: oldItem.weight || 0,
        volume: oldItem.volume || 0,
        price: oldItem.price || 0,
        attributes: oldItem.attributes || {},
        durability: oldItem.durability,
        maxDurability: oldItem.maxDurability,
        installedModules: [],
        contents: oldItem.contents || [], // <-- важно
        isContainer: oldItem.category === 'container' || oldItem.category === 'backpack' || oldItem.category === 'pouch',
        isEquippable: ['weapon', 'armor', 'helmet', 'gas_mask'].includes(oldItem.category),
        isStackable: ['consumable', 'crafting_material', 'artifact'].includes(oldItem.category)
    };
}

function migratePouchesToNewFormat() {
    const eq = currentCharacterData.equipment;
    if (!eq) return;

    // Пояс
    if (eq.belt?.pouches && Array.isArray(eq.belt.pouches)) {
        eq.belt.pouches = eq.belt.pouches.map(pouch => {
            // Если содержимое — строка, превращаем в пустой массив
            if (typeof pouch.contents === 'string') {
                return {
                    ...pouch,
                    contents: [],
                    isContainer: true,
                    capacity: pouch.capacity || 0
                };
            }
            // Уже массив или отсутствует
            return {
                ...pouch,
                contents: pouch.contents || [],
                isContainer: true
            };
        });
    }

    // Разгрузка (пока не трогаем, но для будущего)
    if (eq.vest?.pouches && Array.isArray(eq.vest.pouches)) {
        eq.vest.pouches = eq.vest.pouches.map(pouch => {
            if (typeof pouch.contents === 'string') {
                return {
                    ...pouch,
                    contents: [],
                    isContainer: true,
                    capacity: pouch.capacity || 0
                };
            }
            return {
                ...pouch,
                contents: pouch.contents || [],
                isContainer: true
            };
        });
    }
}

// Рекурсивно вычисляет общий вес предмета с учётом содержимого
function getTotalWeight(item) {
    let baseWeight = item.weight || 0;
    if (item.category === 'magazine') {
        const currentAmmo = item.currentAmmo || 0;
        baseWeight = (currentAmmo > 0) ? (item.loadedWeight || 0) : (item.emptyWeight || 0);
    } else if (item.category === 'ammo') {
        const qty = item.quantity || 0;
        if (qty === 0) return 0;
        const singleVolume = item.volume || 0.02;
        const occupiedVolume = singleVolume * qty;
        return (occupiedVolume < 0.5) ? 0.1 : 0.25;
    }
    let total = baseWeight * (item.quantity || 1);
    if (item.contents && Array.isArray(item.contents)) {
        total += item.contents.reduce((sum, sub) => sum + getTotalWeight(sub), 0);
    }
    if (item.installedModules && Array.isArray(item.installedModules)) {
        total += item.installedModules.reduce((sum, mod) => sum + getTotalWeight(mod), 0);
    }
    return total;
}

function applyModifier(base, mod) {
    if (mod === undefined || mod === null || mod === '') return base;
    const str = String(mod).trim();
    if (str.startsWith('=')) {
        return parseInt(str.substring(1)) || 0;
    }
    return base + (parseInt(str) || 0);
}

function getEffectiveWeaponStats(weapon) {
    const base = {
        accuracy: weapon.accuracy || 0,
        noise: weapon.noise || 0,
        range: weapon.range || 0,
        ergonomics: weapon.ergonomics || 0
    };
    if (!weapon.installedModules) return base;
    weapon.installedModules.forEach(mod => {
        const m = mod.modifiers || {};
        base.accuracy = applyModifier(base.accuracy, m.accuracy);
        base.noise = applyModifier(base.noise, m.noise);
        base.range = applyModifier(base.range, m.range);
        base.ergonomics = applyModifier(base.ergonomics, m.ergonomics);
    });
    return base;
}

//Рекурсивно вычисляет общий объём предмета с учётом содержимого
function getTotalVolume(item) {
    let total = item.volume * item.quantity;
    if (item.contents && item.contents.length) {
        total += item.contents.reduce((sum, subItem) => sum + getTotalVolume(subItem), 0);
    }
    return total;
}

function calculateBackpackTotals(items) {
    let totalWeight = 0;
    let totalVolume = 0;
    items.forEach(item => {
        totalWeight += getTotalWeight(item);
        totalVolume += getTotalVolume(item);
    });
    return { totalWeight, totalVolume };
}

function calculatePouchUsedVolume(pouch) {
    if (!pouch.contents) return 0;
    return pouch.contents.reduce((sum, item) => sum + getTotalVolume(item), 0);
}

window.updatePouchField = function(pathStr, field, value) {
    const path = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    let obj = currentCharacterData;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    const pouch = obj[path[path.length - 1]];
    if (!pouch) return;
    pouch[field] = value;
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.removePouchItem = function(pathStr) {
    const path = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    let obj = currentCharacterData;
    for (let i = 0; i < path.length - 2; i++) obj = obj[path[i]];
    const parentArray = obj[path[path.length - 2]];
    const index = path[path.length - 1];
    if (Array.isArray(parentArray)) {
        parentArray.splice(index, 1);
    }
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

// ========== 2. РЕНДЕРИНГ ЛИСТА И ВКЛАДКИ ==========
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

// ========== УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ЗАПОЛНЕНИЯ ОБЪЕКТА ИЗ ШАБЛОНА ==========
function applyTemplateToObject(obj, template, mapping) {
    // mapping: { 'путь.в.obj': 'путь.в.attributes' }
    for (const [targetPath, sourcePath] of Object.entries(mapping)) {
        const value = sourcePath.split('.').reduce((o, p) => o?.[p], template.attributes);
        if (value !== undefined) {
            setValueByPath(obj, targetPath, value);
        }
    }
    // Копируем базовые поля
    if (template.name) obj.name = template.name;
    if (template.price !== undefined) obj.price = template.price;
    if (template.weight !== undefined) obj.weight = template.weight;
    if (template.volume !== undefined) obj.volume = template.volume;
    obj.templateId = template.id;
}

// ========== 3. ВКЛАДКА "ОСНОВНОЕ" ==========
async function renderBasicTab(data) {
    const container = document.getElementById('sheet-tab-basic');
    const basic = data.basic || {};
    const bg = basic.background || {};
    const inv = data.inventory || {};

    // Загружаем шаблоны детекторов, контейнеров и предысторий
    let detectorTemplates = [];
    let containerTemplates = [];
    let backgroundTemplates = [];
    try {
        detectorTemplates = await loadTemplatesForLobby('detector');
        containerTemplates = await loadTemplatesForLobby('container');
        backgroundTemplates = await loadTemplatesForLobby('background');
    } catch (e) {
        console.error('Failed to load templates', e);
    }

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
            <select name="basic.background.templateId" class="form-control" style="width:100%;" onchange="fillBackgroundFromTemplate(this)">
                <option value="">-- Выберите предысторию --</option>
                ${backgroundTemplates.map(t => `<option value="${t.id}" ${bg.templateId == t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
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
        ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateBackgroundTemplateModal()" style="margin-top:10px;">➕ Создать кастомную предысторию</button>` : ''}

        <hr>
        <h4>Снаряжение</h4>
        <div style="display: grid; grid-template-columns: 120px 1fr 1fr; gap: 20px; margin-bottom: 15px; align-items: start;">
            <!-- Деньги -->
            <div style="display: flex; flex-direction: column; gap: 5px;">
                <label class="money-label">Деньги</label>
                <input type="number" class="form-control number-input" name="inventory.money" value="${inv.money || 0}" style="width: 100px;">
            </div>

            <!-- Детектор аномалий -->
            <div style="display: grid; grid-template-columns: 1fr auto; gap: 10px;">
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    <span>Детектор аномалий</span>
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <select name="inventory.detectors.anomaly.templateId" class="form-control" style="width: 100%; height: 38px;">
                            <option value="">-- Выберите --</option>
                            ${detectorTemplates.filter(t => t.attributes?.type === 'anomaly').map(t =>
                                `<option value="${t.id}" ${inv.detectors?.anomaly?.templateId == t.id ? 'selected' : ''}>${t.name}</option>`
                            ).join('')}
                        </select>
                        ${inv.detectors?.anomaly?.templateId ?
                            `<button type="button" class="btn btn-sm btn-danger" onclick="unequipDetector()" style="padding: 2px 8px; white-space: nowrap;">Снять</button>` : ''}
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 5px;">
                    <span>Бонус</span>
                    <input type="number" class="form-control number-input" name="inventory.detectors.anomaly.bonus" value="${inv.detectors?.anomaly?.bonus || 0}" placeholder="0" style="width: 70px; height: 38px;">
                </div>
            </div>
        </div>
        <div style="display: flex; align-items: center; margin-top: 10px; margin-bottom: 10px;">
            <h4 style="margin: 0;">Контейнеры на броне</h4>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addContainer()" style="padding: 2px 8px;">➕</button>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
            ${Array.isArray(inv.containers) ? inv.containers.map((cont, idx) => {
                const selectedTemplate = containerTemplates.find(t => t.id === cont.templateId);
                const options = containerTemplates.map(t =>
                    `<option value="${t.id}" ${cont.templateId == t.id ? 'selected' : ''}>${t.name}</option>`
                ).join('');
                return `
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <select name="inventory.containers.${idx}.templateId" class="form-control" style="width: 150px;">
                            <option value="">-- Выберите --</option>
                            ${options}
                        </select>
                        <input type="text" class="form-control" name="inventory.containers.${idx}.effect" value="${escapeHtml(cont.effect || selectedTemplate?.attributes?.effect || '')}" placeholder="Содержимое" style="flex: 1;">
                        <button type="button" class="btn btn-sm btn-danger" onclick="removeContainer(${idx})">✕</button>
                    </div>
                `;
            }).join('') : ''}
        </div>
    `;

    // Правая колонка со здоровьем
    let rightHtml = `<div id="health-right-column"></div>`;

    let html = `
        <div style="display: flex; gap: 20px;">
            <div style="flex: 1;">${leftHtml}</div>
            <div style="flex: 1;">${rightHtml}</div>
        </div>
    `;
    container.innerHTML = html;

    const healthContainer = document.getElementById('health-right-column');
    renderHealthTab(data, healthContainer);
}

window.fillBackgroundFromTemplate = async function(select) {
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) {
        // Пустой выбор — очищаем поля
        const plusesInput = document.querySelector('textarea[name="basic.background.pluses"]');
        const minusesInput = document.querySelector('textarea[name="basic.background.minuses"]');
        if (plusesInput) plusesInput.value = '';
        if (minusesInput) minusesInput.value = '';
        document.getElementById('background-skill-bonuses').innerHTML = '';
        if (currentCharacterData.basic?.background) {
            delete currentCharacterData.basic.background.templateId;
            delete currentCharacterData.basic.background.name;
            delete currentCharacterData.basic.background.pluses;
            delete currentCharacterData.basic.background.minuses;
            delete currentCharacterData.basic.background.skillBonuses;
        }
        scheduleAutoSave();
        return;
    }

    const templates = await loadTemplatesForLobby('background');
    const template = templates.find(t => t.id === selectedId);
    if (!template) return;

    // Заполняем поля
    const plusesInput = document.querySelector('textarea[name="basic.background.pluses"]');
    const minusesInput = document.querySelector('textarea[name="basic.background.minuses"]');
    if (plusesInput) plusesInput.value = template.attributes?.pluses || '';
    if (minusesInput) minusesInput.value = template.attributes?.minuses || '';

    // Обновляем бонусы к навыкам
    const skillBonuses = template.attributes?.skillBonuses || [];
    const container = document.getElementById('background-skill-bonuses');
    container.innerHTML = '';
    skillBonuses.forEach((bonus, index) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.gap = '5px';
        div.style.alignItems = 'center';
        div.style.marginBottom = '5px';
        div.innerHTML = `
            <select name="basic.background.skillBonuses.${index}.skill" class="form-control" style="flex:2;">
                ${skillCategories.map(cat => `<option value="${cat.path}" ${bonus.skill === cat.path ? 'selected' : ''}>${cat.label}</option>`).join('')}
            </select>
            <input type="number" class="form-control number-input" name="basic.background.skillBonuses.${index}.bonus" value="${bonus.bonus || 0}" style="width: 60px;" placeholder="Бонус">
            <button type="button" class="btn btn-sm btn-danger" onclick="removeBackgroundSkillBonus(${index})">✕</button>
        `;
        container.appendChild(div);
    });

    // Сохраняем в данные
    if (!currentCharacterData.basic) currentCharacterData.basic = {};
    if (!currentCharacterData.basic.background) currentCharacterData.basic.background = {};
    currentCharacterData.basic.background.templateId = template.id;
    currentCharacterData.basic.background.name = template.name;
    currentCharacterData.basic.background.pluses = template.attributes?.pluses || '';
    currentCharacterData.basic.background.minuses = template.attributes?.minuses || '';
    currentCharacterData.basic.background.skillBonuses = skillBonuses;

    scheduleAutoSave();
};

// ========== 11. МОДАЛЬНЫЕ ОКНА ШАБЛОНОВ ==========
window.openCreateBackgroundTemplateModal = function() {
    let modal = document.getElementById('create-background-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-background-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-background-template-modal').style.display='none'">&times;</span>
                <h3>Создать кастомную предысторию</h3>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="background-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Плюсы</label>
                    <textarea id="background-pluses" class="form-control" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label>Минусы</label>
                    <textarea id="background-minuses" class="form-control" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label>Бонусы к навыкам</label>
                    <div id="background-skill-bonuses-container"></div>
                    <button type="button" class="btn btn-sm btn-primary" onclick="addBackgroundSkillBonusToModal()">+ Добавить бонус</button>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveBackgroundTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-background-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    // Очищаем список бонусов при открытии
    const container = document.getElementById('background-skill-bonuses-container');
    if (container) container.innerHTML = '';
    modal.style.display = 'flex';
};

window.addBackgroundSkillBonusToModal = function() {
    const container = document.getElementById('background-skill-bonuses-container');
    const div = document.createElement('div');
    div.className = 'skill-bonus-item';
    div.style.display = 'flex';
    div.style.gap = '5px';
    div.style.marginBottom = '5px';
    div.innerHTML = `
        <select class="form-control skill-select" style="flex:2;">
            ${skillCategories.map(cat => `<option value="${cat.path}">${cat.label}</option>`).join('')}
        </select>
        <input type="number" class="form-control number-input bonus-input" placeholder="Бонус" value="0" style="width: 80px;">
        <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);
};

window.saveBackgroundTemplate = async function() {
    const name = document.getElementById('background-name').value;
    const pluses = document.getElementById('background-pluses').value;
    const minuses = document.getElementById('background-minuses').value;

    const skillBonuses = [];
    const items = document.querySelectorAll('#background-skill-bonuses-container .skill-bonus-item');
    items.forEach(item => {
        const skillSelect = item.querySelector('.skill-select');
        const bonusInput = item.querySelector('.bonus-input');
        if (skillSelect && bonusInput) {
            const skill = skillSelect.value;
            const bonus = parseInt(bonusInput.value) || 0;
            if (skill && bonus !== 0) {
                skillBonuses.push({ skill, bonus });
            }
        }
    });

    const attributes = { pluses, minuses, skillBonuses };
    const data = {
        name: name,
        category: 'background',
        subcategory: null,
        price: 0,
        weight: 0,
        volume: 0,
        attributes: attributes
    };

    try {
        await Server.createLobbyTemplate(currentLobbyId, data);
        clearTemplatesCache('background');
        clearAllTemplatesCache();
        await renderBasicTab(currentCharacterData);
        document.getElementById('create-background-template-modal').style.display = 'none';
        showNotification('Шаблон предыстории создан', 'success');
    } catch (err) {
        showNotification(err.message);
    }
};

// Функции для контейнеров (без изменений)
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

window.openCreateModuleTemplateModal = function(template = null) {
    let modal = document.getElementById('create-module-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-module-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-module-template-modal').style.display='none'">&times;</span>
                <h3>${template ? 'Редактировать' : 'Создать'} модуль</h3>
                <input type="hidden" id="module-template-id">
                <div class="form-group"><label>Название</label><input type="text" id="module-name" class="form-control"></div>
                <div class="form-group"><label>Тип слота</label><select id="module-slot-type" class="form-control"><option value="scope">Прицел</option><option value="barrel">Ствол</option><option value="handguard">Цевье</option></select></div>
                <div class="form-group" id="module-caliber-group"><label>Калибр</label><input type="text" id="module-caliber" class="form-control"></div>
                <h4>Модификаторы</h4>
                <div class="form-group"><label>Эргономика</label><input type="text" id="module-ergonomics" class="form-control" value="0"></div>
                <div class="form-group"><label>Точность</label><input type="text" id="module-accuracy" class="form-control" value="0"></div>
                <div class="form-group"><label>Дальность</label><input type="text" id="module-range" class="form-control" value="0"></div>
                <div class="form-group"><label>Шум</label><input type="text" id="module-noise" class="form-control" value="0"></div>
                <div class="form-group"><label>Объём</label><input type="number" id="module-volume" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Вес</label><input type="number" id="module-weight" class="form-control number-input" value="0.5" step="0.1"></div>
                <div class="form-group"><label>Цена</label><input type="number" id="module-price" class="form-control number-input" value="0"></div>
                <div class="form-actions"><button class="btn btn-primary" onclick="saveModuleTemplate()">Сохранить</button><button class="btn btn-secondary" onclick="document.getElementById('create-module-template-modal').style.display='none'">Отмена</button></div>
            </div>`;
        document.body.appendChild(modal);
    }
    const caliberGroup = document.getElementById('module-caliber-group');
    const slotSelect = document.getElementById('module-slot-type');
    slotSelect.onchange = () => caliberGroup.style.display = slotSelect.value === 'barrel' ? 'block' : 'none';
    if (template) {
        document.getElementById('module-template-id').value = template.id;
        document.getElementById('module-name').value = template.name || '';
        document.getElementById('module-slot-type').value = template.attributes?.slot_type || 'scope';
        caliberGroup.style.display = template.attributes?.slot_type === 'barrel' ? 'block' : 'none';
        document.getElementById('module-caliber').value = template.attributes?.caliber || '';
        document.getElementById('module-ergonomics').value = template.attributes?.modifiers?.ergonomics || '0';
        document.getElementById('module-accuracy').value = template.attributes?.modifiers?.accuracy || '0';
        document.getElementById('module-range').value = template.attributes?.modifiers?.range || '0';
        document.getElementById('module-noise').value = template.attributes?.modifiers?.noise || '0';
        document.getElementById('module-volume').value = template.volume || 0;
        document.getElementById('module-weight').value = template.weight || 0.5;
        document.getElementById('module-price').value = template.price || 0;
    } else {
        document.getElementById('module-template-id').value = '';
    }
    modal.style.display = 'flex';
};

window.saveModuleTemplate = async function() {
    const id = document.getElementById('module-template-id').value;
    const name = document.getElementById('module-name').value.trim();
    if (!name) { showNotification('Введите название'); return; }
    const slotType = document.getElementById('module-slot-type').value;
    const caliber = slotType === 'barrel' ? document.getElementById('module-caliber').value.trim() : null;
    const modifiers = {
        ergonomics: document.getElementById('module-ergonomics').value.trim(),
        accuracy: document.getElementById('module-accuracy').value.trim(),
        range: document.getElementById('module-range').value.trim(),
        noise: document.getElementById('module-noise').value.trim()
    };
    const data = {
        name, category: 'weapon_module', subcategory: slotType,
        price: parseInt(document.getElementById('module-price').value) || 0,
        weight: parseFloat(document.getElementById('module-weight').value) || 0.5,
        volume: parseFloat(document.getElementById('module-volume').value) || 0,
        attributes: { slot_type: slotType, caliber, modifiers }
    };
    try {
        if (id) await Server.updateLobbyTemplate(currentLobbyId, id, data);
        else await Server.createLobbyTemplate(currentLobbyId, data);
        clearTemplatesCache('weapon_module'); clearAllTemplatesCache();
        document.getElementById('create-module-template-modal').style.display = 'none';
        showNotification(id ? 'Модуль обновлён' : 'Модуль создан', 'success');
        await populateBackpackTemplateSelect();
        populatePocketsTemplateSelect();
        if (typeof loadTemplatesForManager === 'function') {
            const active = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (active === 'weapon_module') loadTemplatesForManager('weapon_module');
        }
    } catch (e) { showNotification(e.message); }
};

window.openCreateMagazineTemplateModal = function(template = null) {
    let modal = document.getElementById('create-magazine-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-magazine-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-magazine-template-modal').style.display='none'">&times;</span>
                <h3>${template ? 'Редактировать' : 'Создать'} магазин</h3>
                <input type="hidden" id="magazine-template-id">
                <div class="form-group"><label>Название</label><input type="text" id="magazine-name" class="form-control"></div>
                <div class="form-group"><label>Калибр</label><input type="text" id="magazine-caliber" class="form-control" placeholder="например, 5.45x39"></div>
                <div class="form-group"><label>Ёмкость</label><input type="number" id="magazine-capacity" class="form-control number-input" value="30"></div>
                <div class="form-group"><label>Вес пустого</label><input type="number" id="magazine-empty-weight" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Вес снаряжённого</label><input type="number" id="magazine-loaded-weight" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Объём</label><input type="number" id="magazine-volume" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Цена</label><input type="number" id="magazine-price" class="form-control number-input" value="0"></div>
                <div class="form-group"><label><input type="checkbox" id="magazine-is-loader"> Это спидлоадер / лента</label></div>
                <div class="form-group">
                    <label>Совместимые ID оружия (через запятую)</label>
                    <input type="text" id="magazine-compatible-weapons" class="form-control" placeholder="Например: 100,102">
                </div>
                <div class="form-actions"><button class="btn btn-primary" onclick="saveMagazineTemplate()">Сохранить</button><button class="btn btn-secondary" onclick="document.getElementById('create-magazine-template-modal').style.display='none'">Отмена</button></div>
            </div>`;
        document.body.appendChild(modal);
    }
    if (template) {
        document.getElementById('magazine-template-id').value = template.id;
        document.getElementById('magazine-name').value = template.name || '';
        document.getElementById('magazine-caliber').value = template.attributes?.caliber || '';
        document.getElementById('magazine-capacity').value = template.attributes?.capacity || 30;
        document.getElementById('magazine-empty-weight').value = template.attributes?.emptyWeight || 0;
        document.getElementById('magazine-loaded-weight').value = template.attributes?.loadedWeight || 0;
        document.getElementById('magazine-volume').value = template.volume || 0;
        document.getElementById('magazine-price').value = template.price || 0;
        document.getElementById('magazine-is-loader').checked = template.attributes?.isLoader || false;
        const compatible = template.attributes?.compatible_weapons || [];
        document.getElementById('magazine-compatible-weapons').value = compatible.join(',');
    } else {
        document.getElementById('magazine-template-id').value = '';
    }
    modal.style.display = 'flex';
};

window.saveMagazineTemplate = async function() {
    const id = document.getElementById('magazine-template-id').value;
    const name = document.getElementById('magazine-name').value.trim();
    if (!name) { showNotification('Введите название'); return; }

    const compatibleStr = document.getElementById('magazine-compatible-weapons').value.trim();
    const compatible_weapons = compatibleStr ? compatibleStr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];

    const data = {
        name, category: 'magazine', subcategory: null,
        price: parseInt(document.getElementById('magazine-price').value) || 0,
        volume: parseFloat(document.getElementById('magazine-volume').value) || 0,
        weight: 0,
        attributes: {
            caliber: document.getElementById('magazine-caliber').value.trim(),
            capacity: parseInt(document.getElementById('magazine-capacity').value) || 30,
            emptyWeight: parseFloat(document.getElementById('magazine-empty-weight').value) || 0,
            loadedWeight: parseFloat(document.getElementById('magazine-loaded-weight').value) || 0,
            isLoader: document.getElementById('magazine-is-loader').checked,
            compatible_weapons: compatible_weapons
        }
    };
    try {
        if (id) await Server.updateLobbyTemplate(currentLobbyId, id, data);
        else await Server.createLobbyTemplate(currentLobbyId, data);
        clearTemplatesCache('magazine'); clearAllTemplatesCache();
        document.getElementById('create-magazine-template-modal').style.display = 'none';
        showNotification(id ? 'Магазин обновлён' : 'Магазин создан', 'success');
        if (typeof loadTemplatesForManager === 'function') {
            const active = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (active === 'magazine') loadTemplatesForManager('magazine');
        }
        await populateBackpackTemplateSelect();
        populatePocketsTemplateSelect();
    } catch (e) { showNotification(e.message); }
};

// ----- МЕНЕДЖЕР ШАБЛОНОВ -----
window.openTemplatesManager = function() {
    document.getElementById('templates-modal').style.display = 'flex';
    loadTemplatesForManager('weapon');

    // Обработчики вкладок
    document.querySelectorAll('#templates-modal .tab-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('#templates-modal .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadTemplatesForManager(btn.dataset.cat);
        };
    });
};

window.closeTemplatesManager = function() {
    document.getElementById('templates-modal').style.display = 'none';
};

async function loadTemplatesForManager(category) {
    const container = document.getElementById('templates-list');
    container.innerHTML = 'Загрузка...';
    try {
        const data = await Server.getLobbyTemplates(currentLobbyId, category);
        const templates = data.local;
        if (!templates.length) {
            container.innerHTML = '<p>Нет кастомных шаблонов</p>';
            return;
        }
        let html = '<table style="width:100%"><tr><th>ID</th><th>Название</th><th>Подкатегория</th><th></th></tr>';
        templates.forEach(t => {
            html += `<tr><td>${t.id}</td><td>${escapeHtml(t.name)}</td><td>${t.subcategory || ''}</td>
            <td>
                <button class="btn-sm btn-primary" onclick="editTemplate(${t.id}, '${category}')">✏️</button>
                <button class="btn-sm btn-danger" onclick="deleteTemplate(${t.id}, '${category}')">🗑️</button>
            </td></tr>`;
        });
        html += '</table>';
        container.innerHTML = html;
    } catch(e) {
        container.innerHTML = '<p class="error">Ошибка загрузки</p>';
    }
}

window.deleteTemplate = async function(id, category) {
    if (!confirm('Удалить шаблон?')) return;
    try {
        await Server.deleteLobbyTemplate(currentLobbyId, id);
        clearTemplatesCache(category);
        clearAllTemplatesCache();
        showNotification('Шаблон удалён', 'success');
        loadTemplatesForManager(category);
    } catch(e) {
        showNotification(e.message);
    }
};

window.editTemplate = async function(templateId, category) {
    // Загружаем шаблоны напрямую с сервера, минуя кеш с миллионом
    const data = await Server.getLobbyTemplates(currentLobbyId, category);
    const template = data.local.find(t => t.id === templateId);
    if (!template) { showNotification('Шаблон не найден'); return; }

    switch (category) {
        case 'weapon': openCreateWeaponTemplateModal(null, template); break;
        case 'armor': openCreateArmorTemplateModal(template); break;
        case 'helmet': openCreateHelmetTemplateModal(template); break;
        case 'gas_mask': openCreateGasMaskTemplateModal(template); break;
        case 'backpack': openCreateBackpackTemplateModal(template); break;
        case 'vest': openCreateVestTemplateModal(template); break;
        case 'weapon_module': openCreateModuleTemplateModal(template); break;
        case 'magazine': openCreateMagazineTemplateModal(template); break;
        case 'melee_weapon': openCreateMeleeWeaponTemplateModal(template); break; // если будет модалка
        default: showNotification('Редактирование не поддерживается');
    }
};

// ========== 12. ВКЛАДКА "ЗДОРОВЬЕ" ==========
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
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                <div></div>
                <div class="zone-item-vertical">
                    <div class="zone-label">Голова</div>
                    <div class="zone-fields">
                        <input type="number" class="number-input" name="health.zones.head.current" value="${(zones.head || {}).current || 0}" placeholder="Тек">
                        <span class="slash">/</span>
                        <input type="number" class="number-input" name="health.zones.head.max" value="${(zones.head || {}).max || 100}" placeholder="Макс">
                    </div>
                </div>
                <div></div>

                <div class="zone-item-vertical">
                    <div class="zone-label">Правая рука</div>
                    <div class="zone-fields">
                        <input type="number" class="number-input" name="health.zones.rightArm.current" value="${(zones.rightArm || {}).current || 0}">
                        <span class="slash">/</span>
                        <input type="number" class="number-input" name="health.zones.rightArm.max" value="${(zones.rightArm || {}).max || 100}">
                    </div>
                </div>
                <div class="zone-item-vertical">
                    <div class="zone-label">Грудь</div>
                    <div class="zone-fields">
                        <input type="number" class="number-input" name="health.zones.chest.current" value="${(zones.chest || {}).current || 0}">
                        <span class="slash">/</span>
                        <input type="number" class="number-input" name="health.zones.chest.max" value="${(zones.chest || {}).max || 100}">
                    </div>
                </div>
                <div class="zone-item-vertical">
                    <div class="zone-label">Левая рука</div>
                    <div class="zone-fields">
                        <input type="number" class="number-input" name="health.zones.leftArm.current" value="${(zones.leftArm || {}).current || 0}">
                        <span class="slash">/</span>
                        <input type="number" class="number-input" name="health.zones.leftArm.max" value="${(zones.leftArm || {}).max || 100}">
                    </div>
                </div>

                <div class="zone-item-vertical">
                    <div class="zone-label">Правая нога</div>
                    <div class="zone-fields">
                        <input type="number" class="number-input" name="health.zones.rightLeg.current" value="${(zones.rightLeg || {}).current || 0}">
                        <span class="slash">/</span>
                        <input type="number" class="number-input" name="health.zones.rightLeg.max" value="${(zones.rightLeg || {}).max || 100}">
                    </div>
                </div>
                <div class="zone-item-vertical">
                    <div class="zone-label">Живот</div>
                    <div class="zone-fields">
                        <input type="number" class="number-input" name="health.zones.abdomen.current" value="${(zones.abdomen || {}).current || 0}">
                        <span class="slash">/</span>
                        <input type="number" class="number-input" name="health.zones.abdomen.max" value="${(zones.abdomen || {}).max || 100}">
                    </div>
                </div>
                <div class="zone-item-vertical">
                    <div class="zone-label">Левая нога</div>
                    <div class="zone-fields">
                        <input type="number" class="number-input" name="health.zones.leftLeg.current" value="${(zones.leftLeg || {}).current || 0}">
                        <span class="slash">/</span>
                        <input type="number" class="number-input" name="health.zones.leftLeg.max" value="${(zones.leftLeg || {}).max || 100}">
                    </div>
                </div>
            </div>
    `;

    const effects = Array.isArray(health.effects) ? health.effects : [];
    let effectsHtml = '';
    effects.forEach((effect, index) => {
        const name = effect.name || '';
        const value = effect.value || 0;
        effectsHtml += `
            <div style="display: flex; gap: 5px; margin-bottom: 5px; align-items: center;">
                <input list="effect-names" class="form-control" name="health.effects.${index}.name" value="${escapeHtml(name)}" placeholder="Название эффекта" style="flex:2;">
                <datalist id="effect-names">
                    <option value="Слабое Внешнее Кровотечение">
                    <option value="Среднее Внешнее Кровотечение">
                    <option value="Сильное Внешнее Кровотечение">
                    <option value="Экстремальное Внешнее Кровотечение">
                    <option value="Слабое Внутреннее Кровотечение">
                    <option value="Среднее Внутреннее Кровотечение">
                    <option value="Сильное Внутреннее Кровотечение">
                    <option value="Экстремальное Внутреннее Кровотечение">
                    <option value="Перелом">
                    <option value="Опьянение">
                    <option value="Зависимость от препарата">
                    <option value="Неделя ломки">
                    <option value="Температура тела">
                    <option value="Заражение крови">
                    <option value="Критический уровень">
                    <option value="Оглушение">
                    <option value="Слепота">
                    <option value="Контузия">
                    <option value="Пси-состояние">
                    <option value="Болевой шок">
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

// ========== 4. ВКЛАДКА "НАВЫКИ" ==========
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
        specialTraitTemplates = await loadTemplatesForLobby('special_trait');
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

    function renderSkillRow(label, base, bonus, xp, path) {
        const required = getRequiredXp(base);
        return `
            <div style="display: flex; align-items: center; gap: 3px; margin-bottom: 5px; flex-wrap: wrap;">
                <span style="width: 125px; word-break: break-word; line-height: 1.3;" onclick="window.rollSkill('${path}', '${label}')" title="${label}">${label}</span>
                <input type="number" class="form-control number-input" name="skills.${path}.base" value="${base}" style="width: 55px;">
                <span>+</span>
                <input type="number" class="form-control number-input" name="skills.${path}.bonus" value="${bonus}" style="width: 55px;">
                <span style="font-size: 0.7rem;">Опыт: ${xp}/${required}</span>
                <button type="button" class="btn btn-sm btn-secondary" onclick="addSkillXpFromPoints('${path}')" style="padding: 2px 4px; font-size: 0.7rem;" title="Взять 1 свободное очко навыка">➕</button>
                <button type="button" class="btn btn-sm btn-secondary" onclick="addSkillXpFromUse('${path}')" style="padding: 2px 4px; font-size: 0.7rem;" title="Добавить опыт за использование">💡</button>
                <span style="cursor: pointer; font-size: 1.1em;" onclick="window.rollSkill('${path}', '${label}')">🎲</span>
            </div>
        `;
    }

    let html = `
        <div style="display: grid; grid-template-columns: repeat(4, minmax(320px, 1fr)); gap: 20px; margin-bottom: 20px;">
            <div>
                <h4>Физические</h4>
                ${physicalSkills.map(s => {
                    const skillObj = physical[s.key] || { base: 5, bonus: 0 };
                    return renderSkillRow(s.label, skillObj.base, skillObj.bonus, skillObj.xp || 0, `physical.${s.key}`);
                }).join('')}
            </div>
            <div>
                <h4>Социальные</h4>
                ${socialSkills.map(s => {
                    const skillObj = social[s.key] || { base: 5, bonus: 0 };
                    return renderSkillRow(s.label, skillObj.base, skillObj.bonus, skillObj.xp || 0, `social.${s.key}`);
                }).join('')}
            </div>
            <div>
                <h4>Прочие</h4>
                ${otherSkills.map(s => {
                    const skillObj = other[s.key] || { base: 5, bonus: 0 };
                    return renderSkillRow(s.label, skillObj.base, skillObj.bonus, skillObj.xp || 0, `other.${s.key}`);
                }).join('')}
            </div>
            <div>
                <h4>Владение оружием</h4>
                ${(() => {
                    const levelOptions = [
                        { value: 'unfamiliar', label: 'Не знаком' },
                        { value: 'familiar', label: 'Знаком' },
                        { value: 'professional', label: 'Профессионал' }
                    ];
                    const specLabels = {
                        pistols: 'Пистолеты',
                        shotguns: 'Дробовики',
                        smgs: 'ПП',
                        assaultRifles: 'Штурмовые',
                        sniperRifles: 'Снайперские',
                        grenadeLaunchers: 'Гранатометы',
                        machineGuns: 'Пулеметы'
                    };

                    function getRequiredXpForWeapon(level) {
                        if (level === 'unfamiliar') return 5;
                        if (level === 'familiar') return 25;
                        return 0; // professional
                    }

                    let specHtml = '';
                    for (const [key, label] of Object.entries(specLabels)) {
                        const current = specialized[key] || { level: 'unfamiliar', xp: 0 };
                        const level = current.level;
                        const xp = current.xp || 0;
                        const required = getRequiredXpForWeapon(level);
                        const progressDisplay = required > 0 ? `${xp}/${required}` : 'максимум';
                        const canAdd = level !== 'professional';
                        specHtml += `
                            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 5px; flex-wrap: wrap;">
                                <span style="width: 115px;">${label}</span>
                                <select name="skills.specialized.${key}.level" class="form-control" style="width: 100px;" onchange="setWeaponLevel('${key}', this.value)">
                                    ${levelOptions.map(opt => `<option value="${opt.value}" ${level === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
                                </select>
                                <span style="font-size: 0.7rem;">Прогресс: ${progressDisplay}</span>
                                ${canAdd ? `<button type="button" class="btn btn-sm btn-secondary" onclick="addWeaponXp('${key}')" style="padding: 2px 4px; font-size: 0.7rem;" title="Добавить прогресс за сражение">➕</button>` : ''}
                            </div>
                        `;
                    }
                    return specHtml;
                })()}
            </div>
        </div>
        <hr>
        <div style="display: flex; gap: 15px;">
            <div><label>Очки навыков</label><input type="number" class="form-control number-input" name="skills.skillPoints" value="${skills.skillPoints ?? 30}"></div>
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
            // Пустой выбор — очищаем поля
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

        const templates = await loadTemplatesForLobby('special_trait');
        const template = templates.find(t => t.id === selectedId);
        if (!template) return;

        const effectInput = document.querySelector(`[name="features.specialTraits.${index}.effect"]`);
        const costInput = document.querySelector(`[name="features.specialTraits.${index}.cost"]`);
        if (effectInput) effectInput.value = template.attributes?.effect || '';
        if (costInput) costInput.value = template.attributes?.cost || 0;

        if (!currentCharacterData.features) currentCharacterData.features = {};
        if (!currentCharacterData.features.specialTraits) currentCharacterData.features.specialTraits = [];
        const trait = currentCharacterData.features.specialTraits[index];
        trait.name = template.name;
        trait.effect = template.attributes?.effect || '';
        trait.cost = template.attributes?.cost || 0;
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
    const attributes = {
        effect: document.getElementById('special-trait-effect').value,
        cost: parseInt(document.getElementById('special-trait-cost').value) || 0
    };
    const data = {
        name: document.getElementById('special-trait-name').value,
        category: 'special_trait',
        subcategory: null,
        price: 0,
        weight: 0,
        volume: 0,
        attributes: attributes
    };

    try {
        await Server.createLobbyTemplate(currentLobbyId, data);
        clearTemplatesCache('special_trait');
        await renderSkillsTab(currentCharacterData);
        document.getElementById('create-special-trait-template-modal').style.display = 'none';
        showNotification('Шаблон особой черты создан', 'success');
    } catch (err) {
        showNotification(err.message);
    }
};

// ========== 5. ВКЛАДКА "ЭКИПИРОВКА" ==========
async function renderEquipmentTab(data) {
    const container = document.getElementById('sheet-tab-equipment');
    if (!container) return;

    const eq = data.equipment || {};
    const helmet = eq.helmet || {};
    const gasMask = eq.gasMask || {};
    const armor = eq.armor || {};
    const weapons = data.weapons || [];

    if (!helmet.modifications) helmet.modifications = [];
    if (!gasMask.modifications) gasMask.modifications = [];
    if (!armor.modifications) armor.modifications = [];

    const materialOptions = ['Текстиль', 'Композит', 'Кевлар', 'Плита'];
    const conditionOptions = ['1. Целая', '2. Немного повреждена', '3. Повреждена', '4. Сильно повреждена', '5. Поломана'];

    let weaponTemplates = [], helmetTemplates = [], gasMaskTemplates = [], armorTemplates = [];
    let modificationTemplates = [], containerTemplates = [];
    try {
        weaponTemplates = await loadTemplatesForLobby('weapon');
        helmetTemplates = await loadTemplatesForLobby('helmet');
        gasMaskTemplates = await loadTemplatesForLobby('gas_mask');
        armorTemplates = await loadTemplatesForLobby('armor');
        modificationTemplates = await loadTemplatesForLobby('modification');
        containerTemplates = await loadTemplatesForLobby('container');
    } catch (e) {
        console.error('Failed to load templates', e);
    }

    const helmetModTemplates = modificationTemplates.filter(t => t.attributes?.type === 'helmet');
    const gasMaskModTemplates = modificationTemplates.filter(t => t.attributes?.type === 'gas_mask');
    const armorModTemplates = modificationTemplates.filter(t => t.attributes?.type === 'armor');
    const pdaModTemplates = modificationTemplates.filter(t => t.attributes?.type === 'pda');
    const weaponModuleTemplates = modificationTemplates.filter(t => t.attributes?.type === 'weapon_module' || t.attributes?.category === 'module');
    const weaponModTemplates = modificationTemplates.filter(t => t.attributes?.type === 'weapon_modification' || t.attributes?.category === 'modification');

    function groupByCategory(templates) {
        const grouped = {};
        templates.forEach(t => {
            const cat = t.subcategory || 'Прочее';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(t);
        });
        return grouped;
    }

    const groupedHelmetMods = groupByCategory(helmetModTemplates);
    const groupedGasMaskMods = groupByCategory(gasMaskModTemplates);
    const groupedArmorMods = groupByCategory(armorModTemplates);
    const groupedPdaMods = groupByCategory(pdaModTemplates);

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
            <div class="equipment-header"><h4>Оружие</h4></div>
            <div class="equipment-row" style="flex-direction:column;">
                <div id="weapons-container"></div>
                <button type="button" class="btn btn-sm" onclick="addWeapon()" style="align-self:flex-start;margin-top:10px;">+ Добавить оружие</button>
            </div>
        </div>

        <!-- Шлем -->
        <div class="equipment-group">
            <div class="equipment-row" style="display: flex; gap: 10px;">
                <div class="equipment-main-block" style="flex: 2;">
                    <div class="block-header">
                        <h4>Шлем</h4>
                        <div style="display: flex; gap: 10px;">
                            ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateHelmetTemplateModal()">➕ Создать кастом</button>` : ''}
                            ${helmet.templateId ? `<button type="button" class="btn btn-sm btn-danger" onclick="unequipHelmet()">Снять</button>` : ''}
                        </div>
                    </div>
                    <div class="fields-container">
                        <div class="field-group field-name">
                            <label>Название</label>
                            <select name="equipment.helmet.templateId" class="form-control" onchange="fillHelmetFromPreset(this)">
                                <option value="">-- Выберите --</option>
                                ${helmetTemplates.map(t => `<option value="${t.id}" ${helmet.templateId == t.id ? 'selected' : ''}>${t.name} ${t.source === 'local' ? '(кастом)' : ''}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number">
                            <label>Прочность</label>
                            <input type="number" class="number-input form-control" name="equipment.helmet.durability" value="${helmet.durability || 0}">
                        </div>
                        <div class="field-group field-select">
                            <label>Стадия</label>
                            <select name="equipment.helmet.stage" class="form-control" onchange="updateArmorStageFromSelect(this, 'helmet')">
                                ${['1. Целая', '2. Немного повреждена', '3. Повреждена', '4. Сильно повреждена', '5. Поломана'].map((name, idx) =>
                                    `<option value="${idx+1}" ${helmet.stage == (idx+1) ? 'selected' : ''}>${name}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number" style="min-width: 100px;">
                            <label>Прочность стадии</label>
                            <input type="number" class="number-input form-control" name="equipment.helmet.currentStageDurability" value="${helmet.currentStageDurability ?? helmet.stageDurability ?? 0}" step="1" min="0">
                        </div>
                        <div class="field-group field-number" style="min-width: 130px;">
                            <label>Макс. прочность стадии</label>
                            <input type="number" class="number-input form-control" value="${calculateStageDurability(helmet.durability || 0, helmet.material || 'Текстиль')}" readonly disabled>
                        </div>
                        <div class="field-group field-select">
                            <label>Материал</label>
                            <select name="equipment.helmet.material" class="form-control">
                                ${materialOptions.map(opt => `<option value="${opt}" ${helmet.material === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number"><label>Точность</label><input type="number" class="number-input form-control" name="equipment.helmet.accuracyPenalty" value="${helmet.accuracyPenalty || 0}"></div>
                        <div class="field-group field-number"><label>Эргономика</label><input type="number" class="number-input form-control" name="equipment.helmet.ergonomicsPenalty" value="${helmet.ergonomicsPenalty || 0}"></div>
                        <div class="field-group field-number"><label>Харизма</label><input type="number" class="number-input form-control" name="equipment.helmet.charismaBonus" value="${helmet.charismaBonus || 0}"></div>
                    </div>
                </div>
                <div class="equipment-protection-block" style="flex: 1;">
                    <div class="block-header"><h5>Защита</h5></div>
                    ${protectionGrid('equipment.helmet', helmet.protection)}
                </div>
                <div class="equipment-zones-block" style="flex: 1;">
                    <div class="block-header"><h5>Зоны защиты</h5></div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 5px; text-align: center;">
                        ${(() => {
                            const template = helmetTemplates.find(t => t.id == helmet.templateId);
                            if (!template?.attributes?.protection_zones?.length) return '<span style="color:#aaa; grid-column: span 2;">Не указаны</span>';
                            const zoneNames = { crown: 'Темя', back: 'Затылок', ears: 'Уши', face: 'Забрало' };
                            return template.attributes.protection_zones.map(z => `<div>${zoneNames[z] || z}</div>`).join('');
                        })()}
                    </div>
                </div>
            </div>
            ${renderSlotsUniversal(helmet, ['equipment', 'helmet']) ? `
                <div style="margin-top:10px; padding:8px; background:rgba(0,0,0,0.1); border-radius:4px;">
                    ${renderSlotsUniversal(helmet, ['equipment', 'helmet'])}
                </div>
            ` : ''}
            <div class="modifications-block">
                <div style="display:flex; align-items:center;">
                    <h5 style="margin:0;">Модификации шлема</h5>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="addHelmetModification()" style="padding:2px 8px;">➕</button>
                </div>
                <div id="helmet-modifications-container">${renderHelmetModifications(helmet.modifications, groupedHelmetMods)}</div>
            </div>
        </div>

        <!-- Противогаз -->
        <div class="equipment-group">
            <div class="equipment-row">
                <div class="equipment-main-block">
                    <div class="block-header">
                        <h4>Противогаз</h4>
                        <div style="display: flex; gap: 10px;">
                            ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateGasMaskTemplateModal()">➕ Создать кастом</button>` : ''}
                            ${gasMask.templateId ? `<button type="button" class="btn btn-sm btn-danger" onclick="unequipGasMask()">Снять</button>` : ''}
                        </div>
                    </div>
                    <div class="fields-container">
                        <div class="field-group field-name">
                            <label>Название</label>
                            <select name="equipment.gasMask.templateId" class="form-control" onchange="fillGasMaskFromPreset(this)">
                                <option value="">-- Выберите --</option>
                                ${gasMaskTemplates.map(t => `<option value="${t.id}" ${gasMask.templateId == t.id ? 'selected' : ''}>${t.name} ${t.source === 'local' ? '(кастом)' : ''}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-group field-checkbox"><label>Надет</label><input type="checkbox" name="equipment.gasMask.isWorn" ${gasMask.isWorn ? 'checked' : ''}></div>
                        <div class="field-group field-number">
                            <label>Прочность</label>
                            <input type="number" class="number-input form-control" name="equipment.gasMask.durability" value="${gasMask.durability || 0}">
                        </div>
                        <div class="field-group field-select">
                            <label>Стадия</label>
                            <select name="equipment.gasMask.stage" class="form-control" onchange="updateArmorStageFromSelect(this, 'gasMask')">
                                ${['1. Целая', '2. Немного повреждена', '3. Повреждена', '4. Сильно повреждена', '5. Поломана'].map((name, idx) =>
                                    `<option value="${idx+1}" ${gasMask.stage == (idx+1) ? 'selected' : ''}>${name}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number" style="min-width: 100px;">
                            <label>Прочность стадии</label>
                            <input type="number" class="number-input form-control" name="equipment.gasMask.currentStageDurability" value="${gasMask.currentStageDurability ?? gasMask.stageDurability ?? 0}" step="1" min="0">
                        </div>
                        <div class="field-group field-number" style="min-width: 130px;">
                            <label>Макс. прочность стадии</label>
                            <input type="number" class="number-input form-control" value="${calculateStageDurability(gasMask.durability || 0, gasMask.material || 'Текстиль')}" readonly disabled>
                        </div>
                        <div class="field-group field-select">
                            <label>Материал</label>
                            <select name="equipment.gasMask.material" class="form-control">
                                ${materialOptions.map(opt => `<option value="${opt}" ${gasMask.material === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number"><label>Точность</label><input type="number" class="number-input form-control" name="equipment.gasMask.accuracyPenalty" value="${gasMask.accuracyPenalty || 0}"></div>
                        <div class="field-group field-number"><label>Эргономика</label><input type="number" class="number-input form-control" name="equipment.gasMask.ergonomicsPenalty" value="${gasMask.ergonomicsPenalty || 0}"></div>
                        <div class="field-group field-number"><label>Харизма</label><input type="number" class="number-input form-control" name="equipment.gasMask.charismaBonus" value="${gasMask.charismaBonus || 0}"></div>
                    </div>
                </div>
                <div class="equipment-protection-block">
                    <div class="block-header"><h5>Защита</h5></div>
                    ${protectionGrid('equipment.gasMask', gasMask.protection)}
                </div>
            </div>
            ${renderSlotsUniversal(gasMask, ['equipment', 'gasMask']) ? `
                <div style="margin-top:10px; padding:8px; background:rgba(0,0,0,0.1); border-radius:4px;">
                    ${renderSlotsUniversal(gasMask, ['equipment', 'gasMask'])}
                </div>
            ` : ''}
            <div class="modifications-block">
                <div style="display:flex; align-items:center;">
                    <h5 style="margin:0;">Модификации противогаза</h5>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="addGasMaskModification()" style="padding:2px 8px;">➕</button>
                </div>
                <div id="gasMask-modifications-container">${renderGasMaskModifications(gasMask.modifications, groupedGasMaskMods)}</div>
            </div>
        </div>

        <!-- Броня -->
        <div class="equipment-group">
            <div class="equipment-row" style="display: flex; gap: 10px;">
                <div class="equipment-main-block" style="flex: 2;">
                    <div class="block-header">
                        <h4>Броня</h4>
                        <div style="display: flex; gap: 10px;">
                            ${window.isGM ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openCreateArmorTemplateModal()">➕ Создать кастом</button>` : ''}
                            ${armor.templateId ? `<button type="button" class="btn btn-sm btn-danger" onclick="unequipArmor()">Снять</button>` : ''}
                        </div>
                    </div>
                    <div class="fields-container">
                        <div class="field-group field-name">
                            <label>Название</label>
                            <select name="equipment.armor.templateId" class="form-control" onchange="fillArmorFromPreset(this)">
                                <option value="">-- Выберите --</option>
                                ${armorTemplates.map(t => `<option value="${t.id}" ${armor.templateId == t.id ? 'selected' : ''}>${t.name} ${t.source === 'local' ? '(кастом)' : ''}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number">
                            <label>Прочность</label>
                            <input type="number" class="number-input form-control" name="equipment.armor.durability" value="${armor.durability || 0}">
                        </div>
                        <div class="field-group field-select">
                            <label>Стадия</label>
                            <select name="equipment.armor.stage" class="form-control" onchange="updateArmorStageFromSelect(this, 'armor')">
                                ${['1. Целая', '2. Немного повреждена', '3. Повреждена', '4. Сильно повреждена', '5. Поломана'].map((name, idx) =>
                                    `<option value="${idx+1}" ${armor.stage == (idx+1) ? 'selected' : ''}>${name}</option>`
                                ).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number" style="min-width: 100px;">
                            <label>Прочность стадии</label>
                            <input type="number" class="number-input form-control" name="equipment.armor.currentStageDurability" value="${armor.currentStageDurability ?? armor.stageDurability ?? 0}" step="1" min="0">
                        </div>
                        <div class="field-group field-number" style="min-width: 130px;">
                            <label>Макс. прочность стадии</label>
                            <input type="number" class="number-input form-control" value="${calculateStageDurability(armor.durability || 0, armor.material || 'Текстиль')}" readonly disabled>
                        </div>
                        <div class="field-group field-select">
                            <label>Материал</label>
                            <select name="equipment.armor.material" class="form-control">
                                ${materialOptions.map(opt => `<option value="${opt}" ${armor.material === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                            </select>
                        </div>
                        <div class="field-group field-number"><label>Перемещение</label><input type="number" class="number-input form-control" name="equipment.armor.movementPenalty" value="${armor.movementPenalty || 0}"></div>
                        <div class="field-group field-number"><label>Контейнеры</label><input type="number" class="number-input form-control" name="equipment.armor.containerSlots" value="${armor.containerSlots || 0}"></div>
                    </div>
                </div>
                <div class="equipment-protection-block" style="flex: 1;">
                    <div class="block-header"><h5>Защита</h5></div>
                    ${protectionGrid('equipment.armor', armor.protection)}
                </div>
                <div class="equipment-zones-block" style="flex: 1;">
                    <div class="block-header"><h5>Зоны защиты</h5></div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 5px; text-align: center;">
                        ${(() => {
                            const template = armorTemplates.find(t => t.id == armor.templateId);
                            if (!template?.attributes?.protection_zones?.length) return '<span style="color:#aaa; grid-column: span 2;">Не указаны</span>';
                            const zoneNames = { torso: 'Торс', arms: 'Руки', legs: 'Ноги', head: 'Голова' };
                            return template.attributes.protection_zones.map(z => `<div>${zoneNames[z] || z}</div>`).join('');
                        })()}
                    </div>
                </div>
            </div>
            <div class="modifications-block">
                <div style="display:flex; align-items:center;">
                    <h5 style="margin:0;">Модификации брони</h5>
                    <button type="button" class="btn btn-sm btn-secondary" onclick="addArmorModification()" style="padding:2px 8px;">➕</button>
                </div>
                <div id="armor-modifications-container">${renderArmorModifications(armor.modifications, groupedArmorMods)}</div>
            </div>
        </div>

        <div class="equipment-group">
            <div style="display:flex; align-items:center;">
                <h4 style="margin:0;">Модификации КПК</h4>
                <button type="button" class="btn btn-sm btn-danger" onclick="addPdaItem()" style="padding:2px 8px;">➕</button>
            </div>
            <div id="pda-modifications-container">${renderPdaModifications(data.modifications?.pda?.items || [], groupedPdaMods)}</div>
        </div>
    `;

    container.innerHTML = html;
    await renderWeapons(weapons, weaponTemplates, weaponModuleTemplates, weaponModTemplates);
}

/**
 * Рекурсивно отрендерить слоты предмета и установленные модули.
 * @param {Object} item - предмет
 * @param {Array} itemPath - путь к предмету в данных (массив, например ['equipment','helmet'])
 * @param {number} depth - уровень вложенности (для отступов)
 * @returns {string} HTML
 */
function renderSlotsUniversal(item, itemPath, depth = 0) {
    const slots = getItemSlots(item);
    if (!slots.length) return '';

    const allTemplates = allTemplatesCache || [];
    const indent = depth * 20;

    let html = '';
    for (const slot of slots) {
        const pathJson = JSON.stringify(itemPath).replace(/'/g, "\\'");
        const installed = (item.installedModules || []).find(m => m.slotType === slot.type);
        let slotContent = '';

        if (installed) {
            let info = escapeHtml(installed.name);
            if (slot.type === 'filter') {
                const dur = installed.durability || 0;
                const maxDur = installed.maxDurability || 0;
                info = `${info} (прочность ${dur}/${maxDur})`;
            } else if (slot.type === 'nvg') {
                const acc = installed.attributes?.accuracy_penalty ?? installed.accuracy_penalty ?? 0;
                const aware = installed.attributes?.awareness_penalty ?? installed.awareness_penalty ?? 0;
                info = `${info} (точность ${acc}, вним. ${aware}`;
                const battery = (installed.installedModules || []).find(m => m.slotType === 'battery');
                if (battery) {
                    info += `, заряд ${battery.attributes?.power ?? '?'}%`;
                }
                info += `)`;
            } else if (slot.type === 'visor') {
                const acc = installed.attributes?.accuracy_penalty ?? installed.accuracy_penalty ?? 0;
                const erg = installed.attributes?.ergonomics_penalty ?? installed.ergonomics_penalty ?? 0;
                const cha = installed.attributes?.charisma_penalty ?? installed.charisma_penalty ?? 0;
                const prot = installed.protection?.physical ?? 0;
                const dur = installed.durability ?? 0;
                const maxDur = installed.maxDurability ?? 0;
                info = `${info} (точность ${acc}, эргон. ${erg}, харизма ${cha}, прочность ${dur}/${maxDur}, физ. защита ${prot})`;
            } else if (slot.type === 'battery') {
                const power = installed.attributes?.power;
                info = `${info} (заряд ${power !== undefined ? power : '?'}%)`;
            } else if (slot.type === 'armor_plate') {
                const prot = installed.attributes?.protection?.physical ?? installed.protection?.physical ?? 0;
                const dur = installed.durability ?? 0;
                const maxDur = installed.maxDurability ?? 0;
                const stage = installed.stage || 1;
                const stageNames = ['1. Целая','2. Немного повреждена','3. Повреждена','4. Сильно повреждена','5. Поломана'];
                const stageText = stageNames[stage-1] || stage;
                const currentStageDur = installed.currentStageDurability ?? installed.stageDurability ?? 0;
                const maxStageDur = installed.stageDurability ?? 0;
                info = `${info} (Физ. защита ${prot}%. Стадия ${stageText}. Прочность стадии ${currentStageDur}/${maxStageDur})`;
            }

            const uninstallBtn = `<button type="button" class="btn btn-sm btn-danger" onclick="window.uninstallModuleFromSlot('${JSON.stringify(itemPath).replace(/"/g, '&quot;')}', '${slot.type}')">Снять</button>`;
            const configBtn = (slot.type === 'visor') ? `<button type="button" class="btn btn-sm btn-secondary" onclick="openVisorModificationsModal('${JSON.stringify(itemPath).replace(/"/g, '&quot;')}', '${slot.type}')">⚙️</button>` : '';

            slotContent = `
                <div style="margin-left:${indent}px; display:flex; align-items:center; gap:10px; margin-top:5px;">
                    <span style="width:100px;">${slot.label}:</span>
                    <span style="flex:1;">${info}</span>
                    ${configBtn}
                    ${uninstallBtn}
                </div>
            `;

            // Рекурсивно отображаем слоты установленного модуля
            const installedIndex = (item.installedModules || []).findIndex(m => m.slotType === slot.type);
            const subPath = itemPath.concat(['installedModules', installedIndex]);
            slotContent += renderSlotsUniversal(installed, subPath, depth + 1);
        } else {
            const installBtn = `<button type="button" class="btn btn-sm btn-primary" onclick="window.installModuleFromSlot('${JSON.stringify(itemPath).replace(/"/g, '&quot;')}', '${slot.type}')">Установить</button>`;
            slotContent = `
                <div style="margin-left:${indent}px; display:flex; align-items:center; gap:10px; margin-top:5px;">
                    <span style="width:100px;">${slot.label}:</span>
                    ${installBtn}
                </div>
            `;
        }

        html += slotContent;
    }
    return html;
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

async function renderWeapons(weapons, weaponTemplates, moduleTemplates, weaponModTemplates) {
    const container = document.getElementById('weapons-container');
    if (!container) return;

    const groupedWeapons = {};
    weaponTemplates.forEach(t => {
        const cat = t.subcategory || 'Прочее';
        if (!groupedWeapons[cat]) groupedWeapons[cat] = [];
        groupedWeapons[cat].push(t);
    });

    const groupedModules = {};
    moduleTemplates.forEach(t => {
        const cat = t.subcategory || 'Прочее';
        if (!groupedModules[cat]) groupedModules[cat] = [];
        groupedModules[cat].push(t);
    });

    const groupedMods = {};
    weaponModTemplates.forEach(t => {
        const cat = t.subcategory || 'Прочее';
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
        const modifications = Array.isArray(weapon.modifications) ? weapon.modifications : [];

        const template = weapon.templateId ? (weaponTemplates.find(t => t.id == weapon.templateId) || (allTemplatesCache || []).find(t => t.id == weapon.templateId)) : null;
        const isMelee = template?.category === 'melee_weapon';

        let fieldsHtml = '';
        if (isMelee) {
            const attrs = template.attributes || {};
            fieldsHtml = `
                <div style="font-weight: bold; margin-bottom: 5px;">${escapeHtml(weapon.name)}</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 10px; background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px;">
                    <div><strong>Урон:</strong> ${attrs.damage || 0}</div>
                    <div><strong>Точность:</strong> ${attrs.accuracy || 0}</div>
                    <div><strong>Бронебойность:</strong> ${attrs.armor_piercing || 0}%</div>
                    <div><strong>Кровотечение:</strong> ${attrs.bleeding || 'Нет'}</div>
                    <div><strong>Класс веса:</strong> ${attrs.weight_class || '—'}</div>
                    <div><strong>Размер:</strong> ${attrs.size || '—'}</div>
                    <div><strong>Вес:</strong> ${weapon.weight || template.weight || 0} кг</div>
                    <div><strong>Прочность:</strong> ${weapon.durability || template.attributes?.durability || 100}</div>
                </div>
            `;
        } else {
            fieldsHtml = '<div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px;">';
            const effectiveStats = (weapon.installedModules && weapon.installedModules.length > 0)
                ? getEffectiveWeaponStats(weapon)
                : null;

            columns.forEach(col => {
                const baseValue = weapon[col.key] !== undefined ? weapon[col.key] : (col.type === 'number' ? 0 : '');
                let effectiveValue = null;
                if (effectiveStats && (col.key === 'accuracy' || col.key === 'noise' || col.key === 'range' || col.key === 'ergonomics')) {
                    effectiveValue = effectiveStats[col.key];
                }

                fieldsHtml += `
                    <div style="width: ${col.width}px;">
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;">${col.label}</div>
                        ${col.type === 'number'
                            ? `<input type="number" class="form-control number-input" name="weapons.${index}.${col.key}" value="${baseValue}" style="width: 100%;">`
                            : `<input type="text" class="form-control" name="weapons.${index}.${col.key}" value="${escapeHtml(baseValue)}" placeholder="${col.label}" style="width: 100%;">`
                        }
                        ${effectiveValue !== null && effectiveValue !== baseValue ?
                            `<div style="font-size: 0.7rem; color: #4caf50; text-align: center;">${effectiveValue}</div>` : ''}
                    </div>
                `;
            });
            fieldsHtml += '</div>';
        }

        let modelBlock = '';
        if (!weapon.model && !isMelee) {
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

        let slotsHtml = '';
        if (!isMelee && weapon.templateId) {
            const weaponTemplate = weaponTemplates.find(t => t.id == weapon.templateId);
            if (weaponTemplate && weaponTemplate.attributes && weaponTemplate.attributes.slots) {
                const slots = weaponTemplate.attributes.slots;
                const installed = Array.isArray(weapon.installedModules) ? weapon.installedModules : [];
                slotsHtml = `<div style="margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.1); border-radius: 4px;"><strong>Слоты:</strong>`;
                slots.forEach(slot => {
                    const installedMod = installed.find(mod => mod.slotType === slot.type);
                    slotsHtml += `<div style="margin-left: 15px; display: flex; align-items: center; gap: 10px; margin-top: 5px;">`;
                    slotsHtml += `<span style="width: 100px;">${slot.label}:</span>`;
                    if (installedMod) {
                        slotsHtml += `<span style="flex:1;">${escapeHtml(installedMod.name)}</span>`;
                        slotsHtml += `<button type="button" class="btn btn-sm btn-danger" onclick="unequipModuleFromWeapon(${index}, '${slot.type}')">Снять</button>`;
                    } else {
                        slotsHtml += `<button type="button" class="btn btn-sm btn-primary" onclick="equipModuleToWeapon(${index}, '${slot.type}')">Установить</button>`;
                    }
                    slotsHtml += `</div>`;
                });
                slotsHtml += `</div>`;
            }
        }

        let magazineHtml = '';
        if (!isMelee && weapon.templateId) {
            const weaponTemplate = weaponTemplates.find(t => t.id == weapon.templateId);
            const hasFixedMagazine = weaponTemplate?.attributes?.fixedMagazine || false;

            if (hasFixedMagazine) {
                const maxAmmo = weaponTemplate.attributes?.magazine_size || 0;
                magazineHtml = `<div style="margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.1); border-radius: 4px;">
                    <strong>Патроны (несъёмный магазин):</strong>
                    <div style="margin-left: 15px; display: flex; align-items: center; gap: 10px; margin-top: 5px;">
                        <input type="number" class="form-control number-input" style="width:80px;"
                               name="weapons.${index}.ammo" value="${weapon.ammo || 0}"> / ${maxAmmo}
                        <button type="button" class="btn btn-sm btn-primary" onclick="reloadFixedMagazine(${index})">Зарядить</button>
                    </div>
                </div>`;
            } else {
                const installedMag = weapon.installedMagazine;
                magazineHtml = `<div style="margin-top: 10px; padding: 8px; background: rgba(0,0,0,0.1); border-radius: 4px;">
                    <strong>Магазин:</strong>
                    <div style="margin-left: 15px; display: flex; align-items: center; gap: 10px; margin-top: 5px;">`;
                if (installedMag) {
                    const totalAmmo = installedMag.ammo ? installedMag.ammo.reduce((sum, a) => sum + a.quantity, 0) : 0;
                    let ammoBreakdown = '';
                    if (installedMag.ammo && installedMag.ammo.length > 0) {
                        const nextAmmo = installedMag.ammo[installedMag.ammo.length - 1];
                        ammoBreakdown = `<br><small>Состав: ${installedMag.ammo.map(a => `${a.name} (${a.quantity})`).join(', ')}`;
                        if (nextAmmo) ammoBreakdown += `<br>▶ Следующий: ${nextAmmo.name}`;
                        ammoBreakdown += '</small>';
                    }
                    magazineHtml += `<span>${escapeHtml(installedMag.name)} (${totalAmmo}/${installedMag.capacity || 30})${ammoBreakdown}</span>`;
                    magazineHtml += `<button type="button" class="btn btn-sm btn-danger" onclick="unequipMagazineFromWeapon(${index})">Снять</button>`;
                } else {
                    magazineHtml += `<button type="button" class="btn btn-sm btn-primary" onclick="equipMagazineToWeapon(${index})">Установить магазин</button>`;
                }
                magazineHtml += `</div></div>`;
            }
        }

        let attackButtonsHtml = '';
        if (isMelee) {
            const allowedAttacks = template?.attributes?.allowed_attacks || [];
            attackButtonsHtml = allowedAttacks.map(attackType =>
                `<button type="button" class="btn btn-sm btn-primary" onclick="useMeleeAttack(${index}, '${attackType}')">${attackType}</button>`
            ).join('');
        } else {
            attackButtonsHtml = `<button type="button" class="btn btn-sm btn-success" onclick="useWeaponFromEquipment(${index})" style="margin-left: 5px;" title="Выстрелить">🔫 Выстрел</button>`;
        }

        let grenadeLauncherHtml = '';
        if (!isMelee) {
            const launcher = weapon.installedModules?.find(m => m.slotType === 'handguard' && m.attributes?.type === 'grenade_launcher');
            if (launcher) {
                const isLoaded = launcher.loaded || false;
                if (isLoaded) {
                    grenadeLauncherHtml = `<button type="button" class="btn btn-sm btn-warning" onclick="fireGrenadeLauncher(${index})" style="margin-left: 5px;" title="Выстрел из подствольника">💣 Выстрел ГП</button>`;
                } else {
                    grenadeLauncherHtml = `<button type="button" class="btn btn-sm btn-secondary" onclick="reloadGrenadeLauncher(${index})" style="margin-left: 5px;" title="Зарядить подствольник">➕ Зарядить ГП</button>`;
                }
            }
        }

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
                ${slotsHtml}
                ${magazineHtml}
                <div style="margin-top:10px; display: flex; gap: 5px; align-items: center; flex-wrap: wrap;">
                    ${attackButtonsHtml}
                    ${grenadeLauncherHtml}
                    <button type="button" class="btn btn-sm btn-danger" onclick="unequipWeapon(${index})" style="margin-left: auto;">Снять</button>
                </div>
                ${!isMelee ? `
                <div style="margin-top:10px;">
                    <div style="display: flex; align-items: center;">
                        <label style="margin: 0;">Модификации</label>
                        <button type="button" class="btn btn-sm" onclick="addWeaponModification(${index})" title="Добавить модификацию" style="padding: 2px 8px;">➕</button>
                    </div>
                    <div id="modifications-${index}">${modificationsHtml}</div>
                </div>
                ` : ''}
                <button type="button" class="btn btn-sm btn-danger" onclick="removeWeapon(${index})" style="margin-top:10px;">Удалить оружие</button>
            </div>
        `);
    }
    container.innerHTML = weaponsHtml.join('');
}

window.equipModuleToWeapon = async function(weaponIndex, slotType) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) return;
    if (!weapon.templateId) {
        showNotification('Оружие должно быть основано на шаблоне');
        return;
    }

    const weaponTemplates = await loadTemplatesForLobby('weapon');
    const weaponTemplate = weaponTemplates.find(t => t.id == weapon.templateId);
    const weaponCaliber = weaponTemplate?.attributes?.caliber;

    const inventoryModules = [];
    const collectModules = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, idx) => {
            if (item.category === 'weapon_module' && item.attributes?.slot_type === slotType) {
                // Проверка калибра для слота "Ствол"
                if (slotType === 'barrel' && weaponCaliber) {
                    const moduleCaliber = item.attributes?.caliber;
                    if (moduleCaliber && moduleCaliber !== weaponCaliber) return;
                }
                inventoryModules.push({ item, path: path.concat(idx) });
            }
            if (item.contents) collectModules(item.contents, path.concat(idx, 'contents'));
        });
    };

    collectModules(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collectModules(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collectModules(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collectModules(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (inventoryModules.length === 0) {
        showNotification('Нет подходящих модулей в инвентаре');
        return;
    }

    let modal = document.getElementById('module-select-modal');
    if (modal) modal.remove();
    modal = document.createElement('div');
    modal.id = 'module-select-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="document.getElementById('module-select-modal').remove()">&times;</span>
            <h3>Выберите модуль</h3>
            <select id="module-select" class="form-control"></select>
            <div class="form-actions" style="margin-top:15px;">
                <button class="btn btn-primary" id="confirm-module-btn">Установить</button>
                <button class="btn btn-secondary" onclick="document.getElementById('module-select-modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const select = document.getElementById('module-select');
    inventoryModules.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${entry.item.name} (${entry.item.weight} кг, ${entry.item.volume} л)`;
        select.appendChild(opt);
    });

    modal.querySelector('#confirm-module-btn').onclick = () => {
        const idx = select.value;
        if (idx === '') return;
        const selected = inventoryModules[idx];
        modal.remove();

        // Проверка совместимости для подствольного гранатомёта
        if (slotType === 'handguard' && selected.item.attributes?.type === 'grenade_launcher') {
            const allowedCategories = selected.item.attributes?.compatible_weapon_categories;
            if (allowedCategories && allowedCategories.length > 0) {
                const weaponSubcategory = weaponTemplate?.subcategory;
                if (!weaponSubcategory || !allowedCategories.includes(weaponSubcategory)) {
                    showNotification('Этот подствольник можно установить только на штурмовые винтовки');
                    return;
                }
            }
        }

        if (!removeItemByPath(selected.path)) {
            showNotification('Не удалось найти модуль в инвентаре');
            return;
        }

        if (!weapon.installedModules) weapon.installedModules = [];
        weapon.installedModules.push({
            id: selected.item.id,
            templateId: selected.item.templateId,
            name: selected.item.name,
            slotType: slotType,
            modifiers: selected.item.attributes?.modifiers || {},
            attributes: selected.item.attributes
        });

        renderEquipmentTab(currentCharacterData);
        renderInventoryTab(currentCharacterData);
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification('Модуль установлен', 'success');
    };

    modal.style.display = 'flex';
};

window.confirmEquipModule = function(weaponIndex, slotType) {
    const modal = document.getElementById('module-select-modal');
    const select = document.getElementById('module-select');
    const selected = modal._moduleList[select.value];
    if (!selected) return;

    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon.installedModules) weapon.installedModules = [];

    // Удаляем модуль из инвентаря по пути
    if (!removeItemByPath(selected.path)) {
        showNotification('Не удалось найти модуль в инвентаре');
        return;
    }

    // Добавляем в установленные
    weapon.installedModules.push({
        id: selected.item.id,
        templateId: selected.item.templateId,
        name: selected.item.name,
        slotType: slotType,
        modifiers: selected.item.attributes?.modifiers || {}
    });

    modal.style.display = 'none';
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Модуль установлен', 'success');
};

window.unequipModuleFromWeapon = async function(weaponIndex, slotType) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon || !weapon.installedModules) return;

    const modIndex = weapon.installedModules.findIndex(m => m.slotType === slotType);
    if (modIndex === -1) return;

    const installedMod = weapon.installedModules[modIndex];
    weapon.installedModules.splice(modIndex, 1);

    let restoredItem;
    if (installedMod.templateId) {
        const templates = await loadTemplatesForLobby('weapon_module');
        const template = templates.find(t => t.id === installedMod.templateId);
        if (template) {
            restoredItem = createItemFromTemplate(template);
        } else {
            restoredItem = {
                id: installedMod.id || generateItemId(),
                templateId: installedMod.templateId,
                name: installedMod.name,
                category: 'weapon_module',
                weight: installedMod.weight || 0.5,
                volume: installedMod.volume || 0.2,
                quantity: 1,
                attributes: {
                    slot_type: slotType,
                    modifiers: installedMod.modifiers,
                    caliber: installedMod.caliber
                }
            };
        }
    } else {
        restoredItem = {
            id: installedMod.id || generateItemId(),
            name: installedMod.name,
            category: 'weapon_module',
            weight: installedMod.weight || 0.5,
            volume: installedMod.volume || 0.2,
            quantity: 1,
            attributes: {
                slot_type: slotType,
                modifiers: installedMod.modifiers
            }
        };
    }

    const path = installedMod.sourcePath;
    let restored = false;
    if (path) restored = restoreItemToPath(restoredItem, path);
    if (!restored) {
        if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
        if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
        currentCharacterData.inventory.backpack.push(restoredItem);
    }

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Модуль снят', 'success');
};

window.equipMagazineToWeapon = async function(weaponIndex) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) return;
    if (!weapon.templateId) { showNotification('Оружие должно быть основано на шаблоне'); return; }

    const weaponTemplates = await loadTemplatesForLobby('weapon');
    const weaponTemplate = weaponTemplates.find(t => t.id == weapon.templateId);
    const weaponCaliber = weaponTemplate?.attributes?.caliber;

    const inventoryMagazines = [];

    const collectMagazines = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, idx) => {
            if (item.category === 'magazine') {
                // Проверка калибра
                if (weaponCaliber && item.attributes?.caliber && item.attributes.caliber !== weaponCaliber) return;
                // Проверка совместимости по списку оружий (если список не пуст)
                const compatible = item.attributes?.compatible_weapons;
                if (compatible && compatible.length > 0 && !compatible.includes(weapon.templateId)) return;
                inventoryMagazines.push({ item, path: path.concat(idx) });
            }
            if (item.contents) collectMagazines(item.contents, path.concat(idx, 'contents'));
        });
    };

    collectMagazines(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collectMagazines(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collectMagazines(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collectMagazines(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (inventoryMagazines.length === 0) {
        showNotification('Нет подходящих магазинов в инвентаре');
        return;
    }

    // Всегда удаляем старое модальное окно, если оно есть
    const oldModal = document.getElementById('magazine-select-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'magazine-select-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="document.getElementById('magazine-select-modal').remove()">&times;</span>
            <h3>Выберите магазин</h3>
            <select id="magazine-select" class="form-control"></select>
            <div class="form-actions">
                <button class="btn btn-primary" id="confirm-magazine-btn">Установить</button>
                <button class="btn btn-secondary" onclick="document.getElementById('magazine-select-modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const select = modal.querySelector('#magazine-select');
    inventoryMagazines.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${entry.item.name} (${entry.item.ammo?.reduce((s,a)=>s+a.quantity,0) || 0} патр.)`;
        select.appendChild(opt);
    });

    // Кнопка подтверждения использует актуальный weaponIndex и список
    modal.querySelector('#confirm-magazine-btn').onclick = () => {
        const idx = select.value;
        if (idx === '') return;
        const selected = inventoryMagazines[idx];
        modal.remove();
        confirmEquipMagazineDirect(weaponIndex, selected);
    };

    modal.style.display = 'flex';
};

function confirmEquipMagazineDirect(weaponIndex, selected) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) return;

    // Проверка совместимости по списку оружий
    const compatible = selected.item.attributes?.compatible_weapons;
    if (compatible && compatible.length > 0) {
        const weaponTemplateId = Number(weapon.templateId);
        if (!compatible.includes(weaponTemplateId)) {
            showNotification('Этот магазин не подходит к данному оружию');
            return;
        }
    }

    const oldMag = weapon.installedMagazine;

    // Удаляем новый магазин из инвентаря
    if (!removeItemByPath(selected.path)) {
        showNotification('Не удалось найти магазин в инвентаре');
        return;
    }

    // Если был старый магазин, возвращаем его на место нового
    if (oldMag) {
        const oldItem = {
            id: oldMag.id,
            templateId: oldMag.templateId,
            name: oldMag.name,
            category: 'magazine',
            weight: 0,
            volume: 0.2,
            quantity: 1,
            ammo: oldMag.ammo ? oldMag.ammo.map(a => ({ ...a })) : [],
            emptyWeight: oldMag.emptyWeight || 0,
            loadedWeight: oldMag.loadedWeight || 0,
            attributes: {
                caliber: oldMag.caliber,
                capacity: oldMag.capacity,
                emptyWeight: oldMag.emptyWeight,
                loadedWeight: oldMag.loadedWeight
            }
        };
        Object.defineProperty(oldItem, 'currentAmmo', {
            get() { return this.ammo.reduce((sum, a) => sum + a.quantity, 0); },
            enumerable: true
        });
        updateMagazineWeight(oldItem);
        restoreItemToPath(oldItem, selected.path);
    }

    // Устанавливаем новый магазин
    weapon.installedMagazine = {
        id: selected.item.id,
        templateId: selected.item.templateId,
        name: selected.item.name,
        caliber: selected.item.attributes?.caliber,
        capacity: selected.item.attributes?.capacity || 30,
        emptyWeight: selected.item.emptyWeight || 0,
        loadedWeight: selected.item.loadedWeight || 0,
        ammo: selected.item.ammo ? selected.item.ammo.map(a => ({ ...a })) : [],
        sourcePath: selected.path
    };
    weapon.ammo = weapon.installedMagazine.ammo.reduce((sum, a) => sum + a.quantity, 0);

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Магазин установлен', 'success');
}

window.unequipMagazineFromWeapon = function(weaponIndex) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon || !weapon.installedMagazine) return;

    const mag = weapon.installedMagazine;
    weapon.installedMagazine = null;

    const restoredItem = {
        id: mag.id,
        templateId: mag.templateId,
        name: mag.name,
        category: 'magazine',
        weight: mag.weight || 0,
        volume: mag.volume || 0.2,
        quantity: 1,
        ammo: mag.ammo ? mag.ammo.map(a => ({ ...a })) : [],
        emptyWeight: mag.emptyWeight || 0,
        loadedWeight: mag.loadedWeight || 0,
        attributes: {
            caliber: mag.caliber,
            capacity: mag.capacity,
            emptyWeight: mag.emptyWeight,
            loadedWeight: mag.loadedWeight
        }
    };
    Object.defineProperty(restoredItem, 'currentAmmo', {
        get() { return this.ammo.reduce((sum, a) => sum + a.quantity, 0); },
        enumerable: true
    });
    updateMagazineWeight(restoredItem);

    const path = mag.sourcePath;
    let restored = false;
    if (path) restored = restoreItemToPath(restoredItem, path);
    if (!restored) {
        if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
        if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
        currentCharacterData.inventory.backpack.push(restoredItem);
    }

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Магазин снят', 'success');
};

window.reloadFixedMagazine = async function(weaponIndex) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) return;

    const weaponTemplates = await loadTemplatesForLobby('weapon');
    const weaponTemplate = weaponTemplates.find(t => t.id == weapon.templateId);
    if (!weaponTemplate || !weaponTemplate.attributes?.fixedMagazine) {
        showNotification('Это оружие использует сменные магазины');
        return;
    }

    const caliber = weaponTemplate.attributes?.caliber;
    const maxAmmo = weaponTemplate.attributes?.magazine_size || 0;
    const currentAmmo = weapon.ammo || 0;
    const needed = maxAmmo - currentAmmo;
    if (needed <= 0) {
        showNotification('Магазин полон');
        return;
    }

    // 1. Собираем спидлоадеры
    const loaderItems = [];
    const collectLoaders = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, idx) => {
            if (item.category === 'magazine' && item.isLoader && item.attributes?.caliber === caliber) {
                const total = item.ammo ? item.ammo.reduce((sum, a) => sum + a.quantity, 0) : 0;
                if (total > 0) {
                    loaderItems.push({ item, path: path.concat(idx) });
                }
            }
            if (item.contents) collectLoaders(item.contents, path.concat(idx, 'contents'));
        });
    };
    collectLoaders(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collectLoaders(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collectLoaders(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collectLoaders(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    // 2. Собираем обычные патроны
    const ammoItems = [];
    const collectAmmo = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, idx) => {
            if (item.category === 'ammo' && item.attributes?.caliber === caliber && item.quantity > 0) {
                ammoItems.push({ item, path: path.concat(idx) });
            }
            if (item.contents) collectAmmo(item.contents, path.concat(idx, 'contents'));
        });
    };
    collectAmmo(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collectAmmo(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    beltPouches.forEach((pouch, i) => collectAmmo(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    vestPouches.forEach((pouch, i) => collectAmmo(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (loaderItems.length === 0 && ammoItems.length === 0) {
        showNotification(`Нет подходящих спидлоадеров или патронов калибра ${caliber}`);
        return;
    }

    // Создаём модальное окно с двумя секциями
    let modal = document.getElementById('fixed-reload-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'fixed-reload-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
            <span class="close" onclick="document.getElementById('fixed-reload-modal').remove()">&times;</span>
            <h3>Выберите способ зарядки</h3>
            <div id="loader-section" style="margin-bottom:15px;">
                <h4>Спидлоадеры/ленты</h4>
                <select id="loader-select" class="form-control" size="3"></select>
            </div>
            <div id="ammo-section">
                <h4>Патроны</h4>
                <select id="fixed-ammo-select" class="form-control" size="5"></select>
            </div>
            <div class="form-actions" style="margin-top:15px;">
                <button class="btn btn-primary" id="confirm-fixed-reload-btn">Зарядить</button>
                <button class="btn btn-secondary" onclick="document.getElementById('fixed-reload-modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const loaderSelect = modal.querySelector('#loader-select');
    const loaderSection = modal.querySelector('#loader-section');
    loaderSelect.innerHTML = '';
    if (loaderItems.length > 0) {
        loaderItems.forEach((entry, idx) => {
            const total = entry.item.ammo.reduce((sum, a) => sum + a.quantity, 0);
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = `${entry.item.name} (${total} патр.)`;
            loaderSelect.appendChild(opt);
        });
        loaderSection.style.display = 'block';
    } else {
        loaderSection.style.display = 'none';
    }

    const ammoSelect = modal.querySelector('#fixed-ammo-select');
    ammoSelect.innerHTML = '';
    ammoItems.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${entry.item.name} (${entry.item.quantity} шт.)`;
        ammoSelect.appendChild(opt);
    });

    // Кнопка подтверждения с замыканием нужных данных
    modal.querySelector('#confirm-fixed-reload-btn').onclick = async () => {
        const selectedLoaderIdx = loaderSelect.value;
        const selectedAmmoIdx = ammoSelect.value;

        const maxAmmo = weaponTemplate.attributes?.magazine_size || 0;
        const currentAmmo = weapon.ammo || 0;
        const needed = maxAmmo - currentAmmo;
        if (needed <= 0) {
            showNotification('Магазин уже полон');
            modal.remove();
            return;
        }

        // Приоритет: спидлоадер
        if (selectedLoaderIdx !== '' && loaderItems.length > 0) {
            const selected = loaderItems[selectedLoaderIdx];
            const loader = selected.item;
            const totalInLoader = loader.ammo.reduce((sum, a) => sum + a.quantity, 0);
            const toTake = Math.min(needed, totalInLoader);

            // Уменьшаем патроны в спидлоадере
            let remaining = toTake;
            for (let i = loader.ammo.length - 1; i >= 0 && remaining > 0; i--) {
                const ammoEntry = loader.ammo[i];
                const takeFromThis = Math.min(ammoEntry.quantity, remaining);
                ammoEntry.quantity -= takeFromThis;
                remaining -= takeFromThis;
                if (ammoEntry.quantity <= 0) {
                    loader.ammo.splice(i, 1);
                }
            }
            weapon.ammo = currentAmmo + toTake;
            updateMagazineWeight(loader);

            modal.remove();
            renderEquipmentTab(currentCharacterData);
            renderInventoryTab(currentCharacterData);
            scheduleAutoSave();
            forceSyncCharacter();
            showNotification(`Заряжено ${toTake} патронов из спидлоадера`, 'success');
            return;
        }

        // Иначе патроны
        if (selectedAmmoIdx !== '' && ammoItems.length > 0) {
            const selected = ammoItems[selectedAmmoIdx];
            const ammoItem = selected.item;
            const available = ammoItem.quantity || 1;
            const toTake = Math.min(needed, available);

            weapon.ammo = currentAmmo + toTake;
            ammoItem.quantity -= toTake;
            if (ammoItem.quantity <= 0) {
                removeItemByPath(selected.path);
            } else {
                updateAmmoWeight(ammoItem);
            }

            modal.remove();
            renderEquipmentTab(currentCharacterData);
            renderInventoryTab(currentCharacterData);
            scheduleAutoSave();
            forceSyncCharacter();
            showNotification(`Заряжено ${toTake} патронов (${ammoItem.name})`, 'success');
            return;
        }

        showNotification('Выберите спидлоадер или патроны');
    };

    modal.style.display = 'flex';
};

window.confirmFixedReload = async function(weaponIndex) {
    const modal = document.getElementById('fixed-reload-modal');
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) return;

    // Получаем шаблон оружия для максимальной ёмкости
    const weaponTemplates = await loadTemplatesForLobby('weapon');
    const weaponTemplate = weaponTemplates.find(t => t.id == weapon.templateId);
    const maxAmmo = weaponTemplate?.attributes?.magazine_size || 0;
    const currentAmmo = weapon.ammo || 0;
    const needed = maxAmmo - currentAmmo;
    if (needed <= 0) {
        showNotification('Магазин уже полон');
        modal.style.display = 'none';
        return;
    }

    const loaderSelect = document.getElementById('loader-select');
    const ammoSelect = document.getElementById('fixed-ammo-select');
    const selectedLoaderIdx = loaderSelect.value;
    const selectedAmmoIdx = ammoSelect.value;

    // Приоритет: спидлоадер
    if (selectedLoaderIdx !== '' && modal._loaderList && modal._loaderList.length > 0) {
        const selected = modal._loaderList[selectedLoaderIdx];
        const loader = selected.item;
        const roundsInLoader = loader.currentAmmo || 0;
        const toTake = Math.min(needed, roundsInLoader);

        weapon.ammo = currentAmmo + toTake;
        loader.currentAmmo = roundsInLoader - toTake;
        updateMagazineWeight(loader);

        modal.style.display = 'none';
        renderEquipmentTab(currentCharacterData);
        renderInventoryTab(currentCharacterData);
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification(`Заряжено ${toTake} патронов из спидлоадера`, 'success');
        return;
    }

    // Иначе патроны
    if (selectedAmmoIdx !== '' && modal._ammoList && modal._ammoList.length > 0) {
        const selected = modal._ammoList[selectedAmmoIdx];
        const ammoItem = selected.item;
        const available = ammoItem.quantity || 1;
        const toTake = Math.min(needed, available);

        weapon.ammo = currentAmmo + toTake;
        ammoItem.quantity -= toTake;
        if (ammoItem.quantity <= 0) {
            removeItemByPath(selected.path);
        } else {
            updateAmmoWeight(ammoItem);
        }

        modal.style.display = 'none';
        renderEquipmentTab(currentCharacterData);
        renderInventoryTab(currentCharacterData);
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification(`Заряжено ${toTake} патронов (${ammoItem.name})`, 'success');
        return;
    }

    showNotification('Выберите спидлоадер или патроны');
};

function updateAmmoWeight(ammoItem) {
    const qty = ammoItem.quantity || 0;
    if (qty === 0) {
        ammoItem.weight = 0;
    } else {
        const singleVolume = ammoItem.volume || 0.02;
        const occupiedVolume = singleVolume * qty;
        ammoItem.weight = (occupiedVolume < 0.5) ? 0.1 : 0.25;
    }
}

window.changeMagazineAmmo = async function(pathStr, delta) {
    const path = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    const mag = getItemByPath(path);
    if (!mag || mag.category !== 'magazine') return;

    const cap = mag.attributes?.capacity || 30;
    const totalAmmo = mag.ammo ? mag.ammo.reduce((sum, a) => sum + a.quantity, 0) : 0;

    // Определяем родительский контейнер
    const parentPath = path.slice(0, -1);
    const parent = parentPath.length === 0 ? currentCharacterData : getItemByPath(parentPath);
    let targetArray;
    if (Array.isArray(parent)) targetArray = parent;
    else if (parent?.contents) targetArray = parent.contents;
    else if (parent?.backpack) targetArray = parent.backpack;
    else targetArray = currentCharacterData.inventory.backpack;

    if (delta > 0) {
        // +1: взять один патрон из инвентаря
        if (totalAmmo >= cap) { showNotification('Магазин полон'); return; }
        const caliber = mag.attributes?.caliber;
        if (!caliber) { showNotification('Неизвестный калибр'); return; }

        // Ищем патроны
        const ammoItems = [];
        const collectAmmo = (items, path) => {
            if (!Array.isArray(items)) return;
            items.forEach((item, idx) => {
                if (item.category === 'ammo' && item.attributes?.caliber === caliber && item.quantity > 0) {
                    ammoItems.push({ item, path: path.concat(idx) });
                }
                if (item.contents) collectAmmo(item.contents, path.concat(idx, 'contents'));
            });
        };
        collectAmmo(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
        collectAmmo(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
        const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
        beltPouches.forEach((pouch, i) => collectAmmo(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
        const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
        vestPouches.forEach((pouch, i) => collectAmmo(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

        if (ammoItems.length === 0) { showNotification(`Нет патронов ${caliber}`); return; }

        const selected = ammoItems[0];
        const ammoItem = selected.item;
        ammoItem.quantity -= 1;
        if (ammoItem.quantity <= 0) removeItemByPath(selected.path);
        else updateAmmoWeight(ammoItem);

        addAmmoToMagazine(mag, ammoItem, 1);
        showNotification(`+1 патрон (${ammoItem.name})`, 'success', 'bottom-left');
    } else if (delta < 0) {
        // -1: извлечь один патрон из магазина
        if (totalAmmo <= 0) { showNotification('Магазин пуст'); return; }
        if (!mag.ammo || mag.ammo.length === 0) { showNotification('Нет данных о патронах'); return; }

        // Извлекаем последний добавленный тип (LIFO)
        const last = mag.ammo[mag.ammo.length - 1];
        const templateId = last.templateId;
        const allTemplates = await getAllItemTemplates();
        const ammoTemplate = allTemplates.find(t => t.id === templateId);
        if (!ammoTemplate) { showNotification('Шаблон патронов не найден'); return; }

        // Уменьшаем количество в магазине
        last.quantity -= 1;
        if (last.quantity <= 0) mag.ammo.pop();

        // Ищем существующую пачку такого же типа в том же контейнере
        const existing = targetArray.find(item => item.category === 'ammo' && item.templateId === templateId);
        if (existing) {
            existing.quantity += 1;
            updateAmmoWeight(existing);
        } else {
            const newAmmo = createItemFromTemplate(ammoTemplate);
            newAmmo.quantity = 1;
            updateAmmoWeight(newAmmo);
            targetArray.push(newAmmo);
        }

        updateMagazineWeight(mag);
        showNotification(`-1 патрон (${last.name})`, 'system', 'bottom-left');
    }

    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
};

window.reloadMagazineFromInventory = async function(pathStr) {
    const path = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    const mag = getItemByPath(path);
    if (!mag || mag.category !== 'magazine') return;

    const cap = mag.attributes?.capacity || 30;
    const cur = mag.currentAmmo !== undefined ? mag.currentAmmo : cap;
    const needed = cap - cur;
    if (needed <= 0) { showNotification('Магазин полон'); return; }

    const caliber = mag.attributes?.caliber;
    if (!caliber) { showNotification('У магазина не указан калибр'); return; }

    // Собираем ВСЕ подходящие патроны (включая разные типы)
    const ammoItems = [];
    const collectAmmo = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, idx) => {
            if (item.category === 'ammo' && item.attributes?.caliber === caliber && item.quantity > 0) {
                ammoItems.push({ item, path: path.concat(idx) });
            }
            if (item.contents) collectAmmo(item.contents, path.concat(idx, 'contents'));
        });
    };
    collectAmmo(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collectAmmo(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collectAmmo(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collectAmmo(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (ammoItems.length === 0) {
        showNotification(`Нет патронов калибра ${caliber}`);
        return;
    }

    // Создаём модальное окно выбора
    let modal = document.getElementById('ammo-select-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'ammo-select-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <span class="close" onclick="document.getElementById('ammo-select-modal').style.display='none'">&times;</span>
                <h3>Выберите патроны</h3>
                <select id="ammo-select" class="form-control" size="5"></select>
                <div class="form-actions" style="margin-top:15px;">
                    <button class="btn btn-primary" onclick="confirmReloadMagazine('${pathStr}')">Зарядить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('ammo-select-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    const select = document.getElementById('ammo-select');
    select.innerHTML = '';
    ammoItems.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${entry.item.name} (${entry.item.quantity} шт.)`;
        select.appendChild(opt);
    });
    modal._ammoList = ammoItems;
    modal._magPath = pathStr;
    modal.style.display = 'flex';
};

window.confirmReloadMagazine = function(pathStr) {
    const modal = document.getElementById('ammo-select-modal');
    const select = document.getElementById('ammo-select');
    const selected = modal._ammoList[select.value];
    if (!selected) return;

    const mag = getItemByPath(modal._magPath.split(',').map(p => isNaN(p) ? p : parseInt(p)));
    if (!mag) return;

    const cap = mag.attributes?.capacity || 30;
    const totalAmmo = mag.ammo ? mag.ammo.reduce((sum, a) => sum + a.quantity, 0) : 0;
    const needed = cap - totalAmmo;
    const ammoItem = selected.item;
    const available = ammoItem.quantity || 1;
    const toTake = Math.min(needed, available);

    addAmmoToMagazine(mag, ammoItem, toTake);
    ammoItem.quantity -= toTake;
    if (ammoItem.quantity <= 0) {
        removeItemByPath(selected.path);
    } else {
        updateAmmoWeight(ammoItem);
    }
    updateMagazineWeight(mag);

    modal.style.display = 'none';
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification(`Заряжено ${toTake} патронов (${ammoItem.name})`, 'success');
};

window.unloadMagazineToInventory = async function(pathStr) {
    const path = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    const mag = getItemByPath(path);
    if (!mag || mag.category !== 'magazine') return;
    if (!mag.ammo || mag.ammo.length === 0) { showNotification('Магазин пуст'); return; }

    const parentPath = path.slice(0, -1);
    const parent = parentPath.length === 0 ? currentCharacterData : getItemByPath(parentPath);
    let targetArray;
    if (Array.isArray(parent)) targetArray = parent;
    else if (parent?.contents) targetArray = parent.contents;
    else if (parent?.backpack) targetArray = parent.backpack;
    else targetArray = currentCharacterData.inventory.backpack;

    const allTemplates = await getAllItemTemplates();

    for (const ammoEntry of mag.ammo) {
        const template = allTemplates.find(t => t.id === ammoEntry.templateId);
        if (!template) continue;
        const existing = targetArray.find(item => item.category === 'ammo' && item.templateId === ammoEntry.templateId);
        if (existing) {
            existing.quantity += ammoEntry.quantity;
            updateAmmoWeight(existing);
        } else {
            const newAmmo = createItemFromTemplate(template);
            newAmmo.quantity = ammoEntry.quantity;
            updateAmmoWeight(newAmmo);
            targetArray.push(newAmmo);
        }
    }

    mag.ammo = [];
    updateMagazineWeight(mag);

    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    showNotification('Магазин разряжен', 'success');
};

function updateMagazineWeight(mag) {
    const totalAmmo = mag.ammo ? mag.ammo.reduce((sum, a) => sum + a.quantity, 0) : 0;
    mag.weight = (totalAmmo > 0) ? (mag.loadedWeight || 0.25) : (mag.emptyWeight || 0);
};

function addAmmoToMagazine(mag, ammoItem, count) {
    if (!mag.ammo) mag.ammo = [];
    const existing = mag.ammo.find(a => a.templateId === ammoItem.templateId);
    if (existing) {
        existing.quantity += count;
    } else {
        mag.ammo.push({
            templateId: ammoItem.templateId,
            name: ammoItem.name,
            quantity: count
        });
    }
    updateMagazineWeight(mag);
};

window.openVisorModificationsModal = async function(itemPathStr, slotType) {
    const targetPath = JSON.parse(itemPathStr);
    const helmet = getItemByPath(targetPath);
    if (!helmet || !helmet.installedModules) {
        showNotification('Шлем или забрало не найдены');
        return;
    }
    const visor = helmet.installedModules.find(m => m.slotType === slotType);
    if (!visor) {
        showNotification('Забрало не установлено');
        return;
    }

    const modTemplates = await loadTemplatesForLobby('modification');

    const oldModal = document.getElementById('visor-modifications-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'visor-modifications-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Модификации забрала</h3>
            <div id="installed-mods-list"></div>
            <hr>
            <h4>Добавить модификацию</h4>
            <select id="visor-mod-select" class="form-control">
                <option value="">-- Выберите --</option>
                ${modTemplates.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
            </select>
            <div class="form-actions" style="margin-top:15px;">
                <button class="btn btn-primary" id="add-mod-btn">Добавить</button>
                <button class="btn btn-secondary" id="close-modal-btn">Закрыть</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const installedList = modal.querySelector('#installed-mods-list');
    const select = modal.querySelector('#visor-mod-select');
    const addBtn = modal.querySelector('#add-mod-btn');
    const closeBtn = modal.querySelector('#close-modal-btn');

    function renderInstalled() {
        const installed = visor.modifications || [];
        installedList.innerHTML = installed.length ? installed.map((mod, idx) => `
            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 5px;">
                <span style="flex:1;">${escapeHtml(mod.name)}</span>
                <button type="button" class="btn btn-sm btn-danger" data-mod-index="${idx}">✕</button>
            </div>
        `).join('') : '<p>Нет установленных модификаций</p>';

        installedList.querySelectorAll('[data-mod-index]').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.modIndex, 10);
                visor.modifications.splice(idx, 1);
                renderInstalled(); // обновляем список
                scheduleAutoSave();
                forceSyncCharacter();
                showNotification('Модификация удалена', 'success');
            };
        });
    }

    renderInstalled();

    addBtn.onclick = async () => {
        const templateId = select.value;
        if (!templateId) return;

        const template = modTemplates.find(t => t.id == templateId);
        if (!template) return;

        if (!visor.modifications) visor.modifications = [];
        visor.modifications.push({
            id: generateItemId(),
            templateId: template.id,
            name: template.name,
            attributes: { ...template.attributes }
        });

        renderInstalled(); // обновляем список
        select.value = '';  // сбрасываем выбор
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification(`Модификация "${template.name}" добавлена`, 'success');
    };

    closeBtn.onclick = () => modal.remove();
    modal.querySelector('.close').onclick = () => modal.remove();

    modal.style.display = 'flex';
};

window.selectWeaponModel = async function(index) {
    const select = document.getElementById(`weapon-model-select-${index}`);
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) return;

    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    const weapon = currentCharacterData.weapons[index];

    const templates = await loadTemplatesForLobby('weapon');
    const template = templates.find(t => t.id === selectedId);
    if (!template) return;

    const mapping = {
        'magazine': 'magazine_size',
        'accuracy': 'accuracy',
        'noise': 'noise',
        'ammo': 'ammo',
        'range': 'range',
        'ergonomics': 'ergonomics',
        'burst': 'burst',
        'damage': 'damage',
        'durability': 'durability',
        'fireRate': 'fire_rate',
        'weight': 'weight'
    };
    applyTemplateToObject(weapon, template, mapping);
    weapon.model = template.name;

    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.fillHelmetFromPreset = async function(select) {
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) return;

    const templates = await loadTemplatesForLobby('helmet');
    const template = templates.find(t => t.id === selectedId);
    if (!template) return;

    const helmet = currentCharacterData.equipment?.helmet || {};
    const mapping = {
        'accuracyPenalty': 'accuracy_penalty',
        'ergonomicsPenalty': 'ergonomics_penalty',
        'charismaBonus': 'charisma_bonus',
        'protection': 'protection'
    };
    applyTemplateToObject(helmet, template, mapping);
    helmet.templateId = template.id;
    helmet.name = template.name;
    helmet.weight = template.weight;
    helmet.volume = template.volume;

    initArmorStagedDurability(helmet, template);

    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.helmet = helmet;
    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.fillGasMaskFromPreset = async function(select) {
    const selectedId = parseInt(select.value, 10);
    if (isNaN(selectedId)) return;

    const templates = await loadTemplatesForLobby('gas_mask');
    const template = templates.find(t => t.id === selectedId);
    if (!template) return;

    const gasMask = currentCharacterData.equipment?.gasMask || {};
    const mapping = {
        'accuracyPenalty': 'accuracy_penalty',
        'ergonomicsPenalty': 'ergonomics_penalty',
        'charismaBonus': 'charisma_bonus',
        'protection': 'protection'
    };
    applyTemplateToObject(gasMask, template, mapping);
    gasMask.templateId = template.id;
    gasMask.name = template.name;
    gasMask.weight = template.weight;
    gasMask.volume = template.volume;
    gasMask.isWorn = gasMask.isWorn || false;

    initArmorStagedDurability(gasMask, template);

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
    const mapping = {
        'movementPenalty': 'movement_penalty',
        'containerSlots': 'container_slots',
        'protection': 'protection'
    };
    applyTemplateToObject(armor, template, mapping);
    armor.templateId = template.id;
    armor.name = template.name;
    armor.weight = template.weight;
    armor.volume = template.volume;

    initArmorStagedDurability(armor, template);

    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.armor = armor;
    await renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.updateArmorStageFromSelect = function(select, type) {
    const newStage = parseInt(select.value, 10);
    const item = currentCharacterData.equipment[type];
    if (!item) return;
    item.stage = newStage;
    const stageNames = ['1. Целая', '2. Немного повреждена', '3. Повреждена', '4. Сильно повреждена', '5. Поломана'];
    item.condition = stageNames[newStage - 1];
    item.stageDurability = calculateStageDurability(item.durability || 0, item.material || 'Текстиль');
    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
};

window.equipArmorFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'armor') {
        showNotification('Этот предмет нельзя надеть как броню');
        return;
    }
    const templates = await loadTemplatesForLobby('armor');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон брони не найден');
        return;
    }
    const armorToEquip = {
        templateId: template.id,
        name: template.name,
        weight: template.weight,
        volume: template.volume,
        material: item.material || template.attributes?.material || 'Текстиль',
        protection: item.protection || { ...template.attributes?.protection },
        movementPenalty: item.movementPenalty || template.attributes?.movement_penalty || 0,
        containerSlots: item.containerSlots || template.attributes?.container_slots || 0,
        modifications: item.modifications || [],
        installedModules: item.installedModules ? [...item.installedModules] : []
    };
    initArmorStagedDurability(armorToEquip, template);
    if (item.durability !== undefined) {
        armorToEquip.durability = item.durability;
        armorToEquip.maxDurability = item.maxDurability || template.attributes?.max_durability || 100;
        armorToEquip.stage = item.stage || 1;
        armorToEquip.condition = item.condition || '1. Целая';
        armorToEquip.currentStageDurability = item.currentStageDurability ?? armorToEquip.stageDurability;
    }
    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти предмет в инвентаре');
        return;
    }
    const oldArmor = currentCharacterData.equipment?.armor;
    if (oldArmor && oldArmor.templateId) {
        const oldTemplates = await loadTemplatesForLobby('armor');
        const oldTemplate = oldTemplates.find(t => t.id === oldArmor.templateId);
        if (oldTemplate) {
            const oldItem = createItemFromTemplate(oldTemplate);
            oldItem.durability = oldArmor.durability;
            oldItem.maxDurability = oldArmor.maxDurability;
            oldItem.material = oldArmor.material;
            oldItem.stage = oldArmor.stage;
            oldItem.condition = oldArmor.condition;
            oldItem.currentStageDurability = oldArmor.currentStageDurability;
            oldItem.protection = { ...oldArmor.protection };
            oldItem.modifications = oldArmor.modifications || [];
            restoreItemToPath(oldItem, itemPath);
        }
    }
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.armor = armorToEquip;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Броня надета', 'success');
};

window.equipHelmetFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'helmet') {
        showNotification('Этот предмет нельзя надеть как шлем');
        return;
    }
    const templates = await loadTemplatesForLobby('helmet');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон шлема не найден');
        return;
    }
    const helmetToEquip = {
        templateId: template.id,
        name: template.name,
        weight: template.weight,
        volume: template.volume,
        material: item.material || template.attributes?.material || 'Текстиль',
        protection: item.protection || { ...template.attributes?.protection },
        accuracyPenalty: item.accuracyPenalty || template.attributes?.accuracy_penalty || 0,
        ergonomicsPenalty: item.ergonomicsPenalty || template.attributes?.ergonomics_penalty || 0,
        charismaBonus: item.charismaBonus || template.attributes?.charisma_bonus || 0,
        modifications: item.modifications || [],
        installedModules: item.installedModules ? [...item.installedModules] : []
    };
    initArmorStagedDurability(helmetToEquip, template);
    if (item.durability !== undefined) {
        helmetToEquip.durability = item.durability;
        helmetToEquip.maxDurability = item.maxDurability || template.attributes?.max_durability || 100;
        helmetToEquip.stage = item.stage || 1;
        helmetToEquip.condition = item.condition || '1. Целая';
        helmetToEquip.currentStageDurability = item.currentStageDurability ?? helmetToEquip.stageDurability;
    }
    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти предмет в инвентаре');
        return;
    }
    const oldHelmet = currentCharacterData.equipment?.helmet;
    if (oldHelmet && oldHelmet.templateId) {
        const oldTemplates = await loadTemplatesForLobby('helmet');
        const oldTemplate = oldTemplates.find(t => t.id === oldHelmet.templateId);
        if (oldTemplate) {
            const oldItem = createItemFromTemplate(oldTemplate);
            oldItem.durability = oldHelmet.durability;
            oldItem.maxDurability = oldHelmet.maxDurability;
            oldItem.material = oldHelmet.material;
            oldItem.stage = oldHelmet.stage;
            oldItem.condition = oldHelmet.condition;
            oldItem.currentStageDurability = oldHelmet.currentStageDurability;
            oldItem.protection = { ...oldHelmet.protection };
            oldItem.modifications = oldHelmet.modifications || [];
            oldItem.installedModules = oldHelmet.installedModules || [];
            restoreItemToPath(oldItem, itemPath);
        }
    }
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.helmet = helmetToEquip;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Шлем надет', 'success');
};

window.equipGasMaskFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'gas_mask') {
        showNotification('Этот предмет нельзя надеть как противогаз');
        return;
    }
    const templates = await loadTemplatesForLobby('gas_mask');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон противогаза не найден');
        return;
    }
    const gasMaskToEquip = {
        templateId: template.id,
        name: template.name,
        weight: template.weight,
        volume: template.volume,
        material: item.material || template.attributes?.material || 'Текстиль',
        protection: item.protection || { ...template.attributes?.protection },
        accuracyPenalty: item.accuracyPenalty || template.attributes?.accuracy_penalty || 0,
        ergonomicsPenalty: item.ergonomicsPenalty || template.attributes?.ergonomics_penalty || 0,
        charismaBonus: item.charismaBonus || template.attributes?.charisma_bonus || 0,
        modifications: item.modifications || [],
        installedModules: item.installedModules ? [...item.installedModules] : [],
        isWorn: item.isWorn || false
    };
    initArmorStagedDurability(gasMaskToEquip, template);
    if (item.durability !== undefined) {
        gasMaskToEquip.durability = item.durability;
        gasMaskToEquip.maxDurability = item.maxDurability || template.attributes?.max_durability || 100;
        gasMaskToEquip.stage = item.stage || 1;
        gasMaskToEquip.condition = item.condition || '1. Целая';
        gasMaskToEquip.currentStageDurability = item.currentStageDurability ?? gasMaskToEquip.stageDurability;
    }
    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти предмет в инвентаре');
        return;
    }
    const oldGasMask = currentCharacterData.equipment?.gasMask;
    if (oldGasMask && oldGasMask.templateId) {
        const oldTemplates = await loadTemplatesForLobby('gas_mask');
        const oldTemplate = oldTemplates.find(t => t.id === oldGasMask.templateId);
        if (oldTemplate) {
            const oldItem = createItemFromTemplate(oldTemplate);
            oldItem.durability = oldGasMask.durability;
            oldItem.maxDurability = oldGasMask.maxDurability;
            oldItem.material = oldGasMask.material;
            oldItem.stage = oldGasMask.stage;
            oldItem.condition = oldGasMask.condition;
            oldItem.currentStageDurability = oldGasMask.currentStageDurability;
            oldItem.protection = { ...oldGasMask.protection };
            oldItem.modifications = oldGasMask.modifications || [];
            oldItem.installedModules = oldGasMask.installedModules || [];
            restoreItemToPath(oldItem, itemPath);
        }
    }
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.gasMask = gasMaskToEquip;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Противогаз надет', 'success');
};

window.equipWeaponFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'weapon') {
        showNotification('Этот предмет нельзя экипировать как оружие');
        return;
    }

    const templates = await loadTemplatesForLobby('weapon');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон оружия не найден');
        return;
    }

    // Создаём объект оружия для экипировки
    const weaponToEquip = {
        templateId: template.id,
        name: template.name,
        model: template.name,
        weight: template.weight,
        volume: template.volume,
        accuracy: item.accuracy || template.attributes?.accuracy || 0,
        noise: item.noise || template.attributes?.noise || 0,
        range: item.range || template.attributes?.range || 0,
        ergonomics: item.ergonomics || template.attributes?.ergonomics || 0,
        burst: item.burst || template.attributes?.burst || '',
        damage: item.damage || template.attributes?.damage || 0,
        durability: item.durability || template.attributes?.durability || 100,
        maxDurability: item.maxDurability || template.attributes?.max_durability || 100,
        fireRate: item.fireRate || template.attributes?.fire_rate || 0,
        caliber: item.caliber || template.attributes?.caliber,
        magazine_size: item.magazine_size || template.attributes?.magazine_size || 0,
        modifications: item.modifications || [],
        installedModules: item.installedModules ? [...item.installedModules] : [],
        installedMagazine: item.installedMagazine || null,
        ammo: item.ammo || 0
    };

    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти оружие в инвентаре');
        return;
    }

    // Добавляем в массив оружия
    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    currentCharacterData.weapons.push(weaponToEquip);

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Оружие экипировано', 'success');
};

window.equipMeleeWeaponFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'melee_weapon') {
        showNotification('Этот предмет нельзя экипировать как оружие ближнего боя');
        return;
    }
    const templates = await loadTemplatesForLobby('melee_weapon');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон оружия не найден');
        return;
    }

    const weaponToEquip = {
        templateId: item.templateId || template.id,
        name: template.name,
        category: 'melee_weapon',
        weight: template.weight,
        volume: template.volume,
        // Состояние
        durability: item.durability ?? template.attributes?.durability ?? 100,
        maxDurability: item.maxDurability ?? template.attributes?.max_durability ?? 100,
        stage: item.stage ?? 1,
        condition: item.condition ?? '1. Целая',
        material: item.material ?? template.attributes?.material ?? 'Текстиль',
        stageDurability: item.stageDurability ?? calculateStageDurability(
            item.durability ?? template.attributes?.durability ?? 100,
            item.material ?? template.attributes?.material ?? 'Текстиль'
        ),
        currentStageDurability: item.currentStageDurability ?? item.stageDurability ?? 0,
        // Характеристики
        damage: item.damage ?? template.attributes?.damage ?? 0,
        accuracy: item.accuracy ?? template.attributes?.accuracy ?? 0,
        armorPiercing: item.armorPiercing ?? template.attributes?.armor_piercing ?? 0,
        bleeding: item.bleeding ?? template.attributes?.bleeding ?? 'Нет',
        weightClass: item.weightClass ?? template.attributes?.weight_class ?? 'Легкое',
        size: item.size ?? template.attributes?.size ?? 1,
        modifications: item.modifications || [],
        installedModules: item.installedModules ? [...item.installedModules] : []
    };

    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти оружие в инвентаре');
        return;
    }

    if (!currentCharacterData.weapons) currentCharacterData.weapons = [];
    currentCharacterData.weapons.push(weaponToEquip);

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Оружие ближнего боя экипировано', 'success');
};

window.equipBeltFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'belt') {
        showNotification('Этот предмет нельзя надеть как пояс');
        return;
    }

    const templates = await loadTemplatesForLobby('belt');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон пояса не найден');
        return;
    }

    const beltToEquip = {
        templateId: template.id,
        name: template.name,
        weight: template.weight,
        volume: template.volume,
        pouches: item.pouches || template.attributes?.pouches || [],
        modifications: item.modifications || [],
        storedItem: item.storedItem || null
    };

    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти предмет в инвентаре');
        return;
    }

    const oldBelt = currentCharacterData.equipment?.belt;
    if (oldBelt && oldBelt.templateId) {
        const oldTemplates = await loadTemplatesForLobby('belt');
        const oldTemplate = oldTemplates.find(t => t.id === oldBelt.templateId);
        if (oldTemplate) {
            const oldItem = createItemFromTemplate(oldTemplate);
            oldItem.pouches = oldBelt.pouches || [];
            oldItem.modifications = oldBelt.modifications || [];
            oldItem.storedItem = oldBelt.storedItem || null;
            restoreItemToPath(oldItem, itemPath);
        }
    }

    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.belt = beltToEquip;

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Пояс надет', 'success');
};

window.equipVestFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'vest') {
        showNotification('Этот предмет нельзя надеть как разгрузку');
        return;
    }

    const templates = await loadTemplatesForLobby('vest');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон разгрузки не найден');
        return;
    }

    const vestToEquip = {
        templateId: template.id,
        name: template.name,
        weight: template.weight,
        volume: template.volume,
        model: template.id ? String(template.id) : (item.model || 'custom'),
        totalCapacity: item.totalCapacity || template.attributes?.total_capacity || 0,
        pouches: item.pouches || template.attributes?.pouches || [],
        modifications: item.modifications || []
    };

    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти предмет в инвентаре');
        return;
    }

    const oldVest = currentCharacterData.equipment?.vest;
    if (oldVest && oldVest.templateId) {
        const oldTemplates = await loadTemplatesForLobby('vest');
        const oldTemplate = oldTemplates.find(t => t.id === oldVest.templateId);
        if (oldTemplate) {
            const oldItem = createItemFromTemplate(oldTemplate);
            oldItem.model = oldVest.model;
            oldItem.totalCapacity = oldVest.totalCapacity;
            oldItem.pouches = oldVest.pouches || [];
            oldItem.modifications = oldVest.modifications || [];
            restoreItemToPath(oldItem, itemPath);
        }
    }

    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    currentCharacterData.equipment.vest = vestToEquip;

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Разгрузка надета', 'success');
};

window.equipDetectorFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || item.category !== 'detector') {
        showNotification('Этот предмет нельзя надеть как детектор');
        return;
    }
    // Проверяем, что это детектор аномалий
    if (item.attributes?.type !== 'anomaly') {
        showNotification('Можно надеть только детектор аномалий');
        return;
    }

    const templates = await loadTemplatesForLobby('detector');
    const template = templates.find(t => t.id === item.templateId);
    if (!template) {
        showNotification('Шаблон детектора не найден');
        return;
    }

    const detectorToEquip = {
        templateId: template.id,
        name: template.name,
        type: 'anomaly',
        bonus: item.bonus || 0
    };

    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти предмет в инвентаре');
        return;
    }

    // Возвращаем старый детектор, если есть
    const oldDetector = currentCharacterData.inventory?.detectors?.anomaly;
    if (oldDetector && oldDetector.templateId) {
        const oldTemplates = await loadTemplatesForLobby('detector');
        const oldTemplate = oldTemplates.find(t => t.id === oldDetector.templateId);
        if (oldTemplate) {
            const oldItem = createItemFromTemplate(oldTemplate);
            oldItem.bonus = oldDetector.bonus || 0;
            restoreItemToPath(oldItem, itemPath);
        }
    }

    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.detectors) currentCharacterData.inventory.detectors = {};
    currentCharacterData.inventory.detectors.anomaly = detectorToEquip;

    renderBasicTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Детектор аномалий надет', 'success');
};

window.equipToBeltFromInventory = async function(itemPath) {
    const item = getItemByPath(itemPath);
    if (!item || (item.category !== 'helmet' && item.category !== 'gas_mask')) {
        showNotification('На пояс можно повесить только шлем или противогаз');
        return;
    }

    // Проверяем, надет ли пояс
    const belt = currentCharacterData.equipment?.belt;
    if (!belt || !belt.templateId) {
        showNotification('Сначала наденьте пояс');
        return;
    }

    // Удаляем предмет из инвентаря
    if (!removeItemByPath(itemPath)) {
        showNotification('Не удалось найти предмет в инвентаре');
        return;
    }

    // Если на поясе уже что-то висело, возвращаем в инвентарь
    const oldStored = belt.storedItem;
    if (oldStored) {
        const oldTemplates = await loadTemplatesForLobby(oldStored.type);
        const oldTemplate = oldTemplates.find(t => t.id === oldStored.templateId);
        if (oldTemplate) {
            const oldItem = createItemFromTemplate(oldTemplate);
            // Копируем сохранённые характеристики (если были)
            Object.assign(oldItem, oldStored.savedAttributes || {});
            restoreItemToPath(oldItem, itemPath);
        }
    }

    // Сохраняем предмет на пояс
    belt.storedItem = {
        type: item.category,
        templateId: item.templateId,
        name: item.name,
        savedAttributes: {
            durability: item.durability,
            maxDurability: item.maxDurability,
            modifications: item.modifications,
            installedModules: item.installedModules
            // добавьте другие важные поля при необходимости
        },
        sourcePath: itemPath
    };

    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification(`${item.name} помещён на пояс`, 'success');
};

window.unequipFromBelt = async function() {
    const belt = currentCharacterData.equipment?.belt;
    if (!belt || !belt.storedItem) {
        showNotification('На поясе ничего нет');
        return;
    }

    const stored = belt.storedItem;
    const templates = await loadTemplatesForLobby(stored.type);
    const template = templates.find(t => t.id === stored.templateId);
    if (!template) {
        showNotification('Шаблон предмета не найден');
        return;
    }

    const restoredItem = createItemFromTemplate(template);
    Object.assign(restoredItem, stored.savedAttributes || {});

    // Пытаемся вернуть в исходный контейнер (если путь сохранён), иначе в рюкзак
    const path = stored.sourcePath;
    let restored = false;
    if (path) {
        restored = restoreItemToPath(restoredItem, path);
    }
    if (!restored) {
        if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
        if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
        currentCharacterData.inventory.backpack.push(restoredItem);
    }

    delete belt.storedItem;

    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Предмет снят с пояса', 'success');
};

window.unequipArmor = async function() {
    const armor = currentCharacterData.equipment?.armor;
    if (!armor || !armor.templateId) {
        showNotification('Броня не надета');
        return;
    }
    const templates = await loadTemplatesForLobby('armor');
    const template = templates.find(t => t.id === armor.templateId);
    if (!template) {
        showNotification('Шаблон брони не найден');
        return;
    }
    const restoredItem = createItemFromTemplate(template);
    restoredItem.durability = armor.durability;
    restoredItem.maxDurability = armor.maxDurability;
    restoredItem.material = armor.material;
    restoredItem.stage = armor.stage;
    restoredItem.condition = armor.condition;
    restoredItem.currentStageDurability = armor.currentStageDurability;
    restoredItem.protection = { ...armor.protection };
    restoredItem.modifications = armor.modifications || [];
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(restoredItem);
    delete currentCharacterData.equipment.armor;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Броня снята', 'success');
};

window.unequipHelmet = async function() {
    const helmet = currentCharacterData.equipment?.helmet;
    if (!helmet || !helmet.templateId) {
        showNotification('Шлем не надет');
        return;
    }
    const templates = await loadTemplatesForLobby('helmet');
    const template = templates.find(t => t.id === helmet.templateId);
    if (!template) {
        showNotification('Шаблон шлема не найден');
        return;
    }
    const restoredItem = createItemFromTemplate(template);
    restoredItem.durability = helmet.durability;
    restoredItem.maxDurability = helmet.maxDurability;
    restoredItem.material = helmet.material;
    restoredItem.stage = helmet.stage;
    restoredItem.condition = helmet.condition;
    restoredItem.currentStageDurability = helmet.currentStageDurability;
    restoredItem.protection = { ...helmet.protection };
    restoredItem.modifications = helmet.modifications || [];
    restoredItem.installedModules = helmet.installedModules || [];
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(restoredItem);
    delete currentCharacterData.equipment.helmet;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Шлем снят', 'success');
};

window.unequipGasMask = async function() {
    const gasMask = currentCharacterData.equipment?.gasMask;
    if (!gasMask || !gasMask.templateId) {
        showNotification('Противогаз не надет');
        return;
    }
    const templates = await loadTemplatesForLobby('gas_mask');
    const template = templates.find(t => t.id === gasMask.templateId);
    if (!template) {
        showNotification('Шаблон противогаза не найден');
        return;
    }
    const restoredItem = createItemFromTemplate(template);
    restoredItem.durability = gasMask.durability;
    restoredItem.maxDurability = gasMask.maxDurability;
    restoredItem.material = gasMask.material;
    restoredItem.stage = gasMask.stage;
    restoredItem.condition = gasMask.condition;
    restoredItem.currentStageDurability = gasMask.currentStageDurability;
    restoredItem.protection = { ...gasMask.protection };
    restoredItem.modifications = gasMask.modifications || [];
    restoredItem.installedModules = gasMask.installedModules || [];
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(restoredItem);
    delete currentCharacterData.equipment.gasMask;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Противогаз снят', 'success');
};

window.unequipWeapon = async function(weaponIndex) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) {
        showNotification('Оружие не найдено');
        return;
    }
    if (!weapon.templateId) {
        showNotification('Оружие должно быть основано на шаблоне');
        return;
    }

    const category = weapon.category === 'melee_weapon' ? 'melee_weapon' : 'weapon';
    const templates = await loadTemplatesForLobby(category);
    const template = templates.find(t => t.id == weapon.templateId);
    if (!template) {
        showNotification('Шаблон оружия не найден');
        return;
    }

    const restoredItem = createItemFromTemplate(template);
    // Копируем текущие характеристики
    restoredItem.durability = weapon.durability || template.attributes?.durability || 100;
    restoredItem.maxDurability = weapon.maxDurability || template.attributes?.max_durability || 100;

    if (category === 'weapon') {
        restoredItem.ammo = weapon.ammo;
        restoredItem.installedMagazine = weapon.installedMagazine ? { ...weapon.installedMagazine } : null;
    } else {
        // Для ближнего боя дополнительно копируем специфичные поля (если они менялись)
        restoredItem.damage = weapon.damage;
        restoredItem.accuracy = weapon.accuracy;
        restoredItem.armorPiercing = weapon.armorPiercing;
        restoredItem.bleeding = weapon.bleeding;
        restoredItem.weightClass = weapon.weightClass;
        restoredItem.size = weapon.size;
    }

    restoredItem.modifications = weapon.modifications || [];
    restoredItem.installedModules = weapon.installedModules || [];

    // Добавляем в рюкзак
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(restoredItem);

    // Удаляем оружие из экипировки
    currentCharacterData.weapons.splice(weaponIndex, 1);

    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Оружие снято', 'success');
};

window.unequipBelt = async function() {
    const belt = currentCharacterData.equipment?.belt;
    if (!belt || !belt.templateId) {
        showNotification('Пояс не надет');
        return;
    }
    const templates = await loadTemplatesForLobby('belt');
    const template = templates.find(t => t.id === belt.templateId);
    if (!template) {
        showNotification('Шаблон пояса не найден');
        return;
    }
    const restoredItem = createItemFromTemplate(template);
    restoredItem.pouches = belt.pouches || [];
    restoredItem.modifications = belt.modifications || [];
    restoredItem.storedItem = belt.storedItem || null;
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(restoredItem);
    delete currentCharacterData.equipment.belt;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Пояс снят', 'success');
};

window.unequipVest = async function() {
    const vest = currentCharacterData.equipment?.vest;
    if (!vest || !vest.templateId) {
        showNotification('Разгрузка не надета');
        return;
    }
    const templates = await loadTemplatesForLobby('vest');
    const template = templates.find(t => t.id === vest.templateId);
    if (!template) {
        showNotification('Шаблон разгрузки не найден');
        return;
    }
    const restoredItem = createItemFromTemplate(template);
    restoredItem.model = vest.model;
    restoredItem.totalCapacity = vest.totalCapacity;
    restoredItem.pouches = vest.pouches || [];
    restoredItem.modifications = vest.modifications || [];
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(restoredItem);
    delete currentCharacterData.equipment.vest;
    renderEquipmentTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Разгрузка снята', 'success');
};

window.unequipDetector = async function() {
    const detector = currentCharacterData.inventory?.detectors?.anomaly;
    if (!detector || !detector.templateId) {
        showNotification('Детектор аномалий не надет');
        return;
    }
    const templates = await loadTemplatesForLobby('detector');
    const template = templates.find(t => t.id === detector.templateId);
    if (!template) {
        showNotification('Шаблон детектора не найден');
        return;
    }
    const restoredItem = createItemFromTemplate(template);
    restoredItem.bonus = detector.bonus || 0;
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!currentCharacterData.inventory.backpack) currentCharacterData.inventory.backpack = [];
    currentCharacterData.inventory.backpack.push(restoredItem);
    delete currentCharacterData.inventory.detectors.anomaly;
    renderBasicTab(currentCharacterData);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Детектор аномалий снят', 'success');
};

window.useWeaponFromEquipment = function(weaponIndex) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) return;

    // Проверяем тип магазина
    const weaponTemplateId = weapon.templateId;
    let hasFixedMagazine = false;
    if (weaponTemplateId) {
        // Можно загрузить шаблон, но проще проверить weapon.installedMagazine
        hasFixedMagazine = !weapon.installedMagazine && weapon.attributes?.fixedMagazine;
    }

    if (hasFixedMagazine) {
        // Несъёмный магазин
        if (weapon.ammo <= 0) {
            showNotification('Нет патронов');
            return;
        }
        weapon.ammo -= 1;
        showNotification(`Выстрел из ${weapon.name}. Осталось патронов: ${weapon.ammo}`, 'system');
    } else {
        // Съёмный магазин
        const mag = weapon.installedMagazine;
        if (!mag || !mag.ammo || mag.ammo.length === 0) {
            showNotification('Нет магазина или патронов');
            return;
        }
        // Уменьшаем последний тип патронов (LIFO)
        const last = mag.ammo[mag.ammo.length - 1];
        last.quantity -= 1;
        if (last.quantity <= 0) {
            mag.ammo.pop();
        }
        weapon.ammo = mag.ammo.reduce((sum, a) => sum + a.quantity, 0);
        updateMagazineWeight(mag);
        showNotification(`Выстрел из ${weapon.name}. Осталось патронов: ${weapon.ammo}`, 'system');
    }

    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
};

window.useMeleeAttack = function(weaponIndex, attackType) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    if (!weapon) return;
    const template = (allTemplatesCache || []).find(t => t.id == weapon.templateId);
    const attrs = template?.attributes || {};
    const baseDamage = attrs.damage || 0;
    const baseAP = attrs.armor_piercing || 0;
    const modifiers = getMeleeAttackModifiers(attackType, baseDamage, baseAP);
    showNotification(`⚔️ Атака "${attackType}" оружием ${weapon.name}. Урон: ${modifiers.damage}, Бронебойность: ${modifiers.ap}%`, 'system');
};

function getMeleeAttackModifiers(attackType, baseDamage, baseAP) {
    switch(attackType) {
        case 'Колющий':
            return { damage: Math.floor(baseDamage * 1.25), ap: baseAP + 10 };
        case 'Режущий':
            return { damage: Math.floor(baseDamage * 0.75), ap: Math.max(0, baseAP - 10) };
        case 'Вспарывающий':
            return { damage: Math.floor(baseDamage * 1.35), ap: baseAP + 10 };
        case 'Круговой':
            return { damage: baseDamage, ap: Math.max(0, baseAP - 10) };
        default:
            return { damage: baseDamage, ap: baseAP };
    }
}

window.fireGrenadeLauncher = async function(weaponIndex) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    const launcher = weapon.installedModules?.find(m => m.attributes?.type === 'grenade_launcher');
    if (!launcher) {
        showNotification('Подствольный гранатомёт не установлен');
        return;
    }

    if (!launcher.loaded || !launcher.loadedGrenade) {
        showNotification('Подствольник не заряжен');
        return;
    }

    const grenade = launcher.loadedGrenade;
    showNotification(`Выстрел из подствольного гранатомёта (${launcher.name}). Эффект: ${grenade.attributes?.effect || 'взрыв'}`, 'system');

    // Сбрасываем состояние
    launcher.loaded = false;
    launcher.loadedGrenade = null;

    renderEquipmentTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
};

window.reloadGrenadeLauncher = async function(weaponIndex) {
    const weapon = currentCharacterData.weapons[weaponIndex];
    const launcher = weapon.installedModules?.find(m => m.attributes?.type === 'grenade_launcher');
    if (!launcher) {
        showNotification('Подствольный гранатомёт не установлен');
        return;
    }

    const caliber = launcher.attributes?.caliber;
    if (!caliber) {
        showNotification('Неизвестный калибр гранатомёта');
        return;
    }

    // Ищем гранату подходящего калибра
    const grenadeItems = [];
    const collectGrenades = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((item, idx) => {
            if (item.category === 'grenade' && item.attributes?.caliber === caliber && item.quantity > 0) {
                grenadeItems.push({ item, path: path.concat(idx) });
            }
            if (item.contents) collectGrenades(item.contents, path.concat(idx, 'contents'));
        });
    };
    collectGrenades(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collectGrenades(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collectGrenades(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collectGrenades(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (grenadeItems.length === 0) {
        showNotification(`Нет гранат калибра ${caliber}`);
        return;
    }

    // Модальное окно выбора гранаты
    const oldModal = document.getElementById('grenade-select-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'grenade-select-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Выберите гранату</h3>
            <select id="grenade-select" class="form-control"></select>
            <div class="form-actions">
                <button class="btn btn-primary" id="confirm-grenade-btn">Зарядить</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const select = modal.querySelector('#grenade-select');
    grenadeItems.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${entry.item.name} (${entry.item.quantity} шт.)`;
        select.appendChild(opt);
    });

    modal.querySelector('#confirm-grenade-btn').onclick = () => {
        const idx = select.value;
        if (idx === '') return;
        const selected = grenadeItems[idx];
        const grenade = selected.item;
        modal.remove();

        // Обработка стопки: если гранат больше 1, создаём копию и уменьшаем исходную
        let grenadeToUse;
        if (grenade.quantity > 1) {
            grenade.quantity -= 1;
            grenadeToUse = { ...grenade, quantity: 1 };
        } else {
            grenadeToUse = grenade;
            if (!removeItemByPath(selected.path)) {
                showNotification('Не удалось найти гранату в инвентаре');
                return;
            }
        }

        // Сохраняем гранату в состоянии гранатомёта
        launcher.loaded = true;
        launcher.loadedGrenade = {
            id: grenadeToUse.id,
            templateId: grenadeToUse.templateId,
            name: grenadeToUse.name,
            attributes: grenadeToUse.attributes
        };

        // Обновляем UI: перерисовываем только инвентарь, так как изменилось количество
        renderInventoryTab(currentCharacterData);
        // Также обновляем экипировку, чтобы кнопка сменилась на "Выстрел ГП"
        renderEquipmentTab(currentCharacterData);
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification('Подствольник заряжен', 'success');
    };

    modal.style.display = 'flex';
};

// Использование предмета из инвентаря (для расходников, гранат и т.д.)
async function useItem(item, itemPath) {
    if (item.category === 'consumable') {
        await useConsumable(item, itemPath);
    } else if (item.category === 'grenade') {
        await useGrenade(item, itemPath);
    } else if (item.category === 'device') {
        // Если устройство имеет батарею и разряжено, предложить зарядить
        if (item.attributes?.power !== undefined && item.attributes.power < 100) {
            await rechargeDevice(item, itemPath);
        } else {
            toggleDevice(item, itemPath);
        }
    } else {
        showNotification('Невозможно использовать этот предмет');
    }
}

async function useConsumable(item, itemPath) {
    const effects = item.attributes?.effects || [];
    if (effects.length === 0) {
        showNotification('Предмет не имеет эффектов');
        return;
    }
    effects.forEach(eff => applyEffect(eff));
    item.quantity -= 1;
    if (item.quantity <= 0) {
        removeItemByPath(itemPath);
    }
    showNotification(`${item.name} использован`, 'success');
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
}

async function useGrenade(item, itemPath) {
    if (item.attributes?.caliber) {
        showNotification('Эту гранату нельзя метнуть вручную — она для гранатомёта');
        return;
    }

    showNotification(`Вы метнули ${item.name}. Эффект: ${item.attributes?.effect || 'взрыв'}`, 'system');
    item.quantity -= 1;
    if (item.quantity <= 0) {
        removeItemByPath(itemPath);
    }
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    forceSyncCharacter();
}

function toggleDevice(item, itemPath) {
    if (item.attributes?.isActive === undefined) item.attributes.isActive = false;

    if (!item.attributes.isActive) {
        const battery = (item.installedModules || []).find(m => m.slotType === 'battery');
        if (!battery) {
            showNotification('Нет батарейки');
            return;
        }
        const currentCharge = battery.attributes?.power ?? 0;
        if (currentCharge <= 0) {
            showNotification('Батарейка разряжена');
            return;
        }
        battery.attributes.power = Math.max(0, currentCharge - 1);
    }

    item.attributes.isActive = !item.attributes.isActive;

    const itemDiv = document.querySelector(`[data-path="${itemPath.join(',')}"]`);
    if (itemDiv) {
        const useBtn = itemDiv.querySelector('button.btn-success');
        if (useBtn) {
            useBtn.textContent = item.attributes.isActive ? '⏹' : '▶';
            useBtn.title = item.attributes.isActive ? 'Выключить' : 'Включить';
        }
        const slotDiv = itemDiv.querySelector('div[style*="background: rgba(0,0,0,0.1)"]');
        if (slotDiv) {
            const infoSpan = slotDiv.querySelector('span[style*="flex: 1"]');
            if (infoSpan) {
                const battery = (item.installedModules || []).find(m => m.slotType === 'battery');
                if (battery) {
                    infoSpan.textContent = `${battery.name} (заряд ${battery.attributes.power}%)`;
                }
            }
        }
    }

    showNotification(`${item.name} ${item.attributes.isActive ? 'включен' : 'выключен'}`, 'success');
    scheduleAutoSave();
    forceSyncCharacter();
}

async function rechargeDevice(item, itemPath) {
    if (item.attributes?.power === undefined) {
        showNotification('Это устройство не имеет батареи');
        return;
    }
    if (item.attributes.power >= 100) {
        showNotification('Батарея уже полностью заряжена');
        return;
    }

    // Ищем батарейки в инвентаре
    const batteryItems = [];
    const collectBatteries = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((it, idx) => {
            if (it.category === 'device' && it.subcategory === 'battery' && it.quantity > 0) {
                batteryItems.push({ item: it, path: path.concat(idx) });
            }
            if (it.contents) collectBatteries(it.contents, path.concat(idx, 'contents'));
        });
    };
    collectBatteries(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collectBatteries(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collectBatteries(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collectBatteries(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (batteryItems.length === 0) {
        showNotification('Нет батареек в инвентаре');
        return;
    }

    // Создаём модальное окно выбора
    const oldModal = document.getElementById('recharge-battery-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'recharge-battery-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Выберите батарейку для зарядки</h3>
            <select id="recharge-battery-select" class="form-control" size="5"></select>
            <div class="form-actions" style="margin-top:15px;">
                <button class="btn btn-primary" id="confirm-recharge-battery">Зарядить</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const select = modal.querySelector('#recharge-battery-select');
    batteryItems.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${entry.item.name} (заряд ${entry.item.attributes?.power ?? '?'}%, ${entry.item.quantity} шт.)`;
        select.appendChild(opt);
    });

    modal.querySelector('#confirm-recharge-battery').onclick = () => {
        const idx = select.value;
        if (idx === '') return;
        const selected = batteryItems[idx];
        const battery = selected.item;
        modal.remove();

        // Заряжаем устройство
        item.attributes.power = 100;

        // Расходуем одну батарейку
        battery.quantity -= 1;
        const batteryPath = selected.path;
        if (battery.quantity <= 0) {
            removeItemByPath(batteryPath);
        }

        // Обновляем UI точечно
        // 1. Слоты устройства
        const deviceDiv = document.querySelector(`[data-path="${itemPath.join(',')}"]`);
        if (deviceDiv) {
            const slotsContainer = deviceDiv.querySelector('.item-slots-container');
            const newSlotsHtml = renderSlotsUniversal(item, itemPath, 1);
            if (slotsContainer) {
                slotsContainer.outerHTML = newSlotsHtml;
            } else if (newSlotsHtml) {
                deviceDiv.insertAdjacentHTML('beforeend', newSlotsHtml);
            }
        }

        // 2. Стопка батареек
        if (battery.quantity > 0) {
            const batteryDiv = document.querySelector(`[data-path="${batteryPath.join(',')}"]`);
            if (batteryDiv) {
                const qtyInput = batteryDiv.querySelector('input[placeholder="Кол-во"]');
                if (qtyInput) qtyInput.value = battery.quantity;
            }
        } else {
            const batteryDiv = document.querySelector(`[data-path="${batteryPath.join(',')}"]`);
            if (batteryDiv) {
                const parent = batteryDiv.parentNode;
                batteryDiv.remove();
                const remaining = Array.from(parent.children).filter(el => el.hasAttribute('data-path'));
                remaining.forEach((el, idx) => {
                    const newPath = batteryPath.slice(0, -1).concat(idx).join(',');
                    el.dataset.path = newPath;
                    updateHandlersInElement(el, batteryPath.slice(0, -1), idx);
                });
                if (parent.classList.contains('container-contents')) {
                    updatePouchVolumeFromContentsDiv(parent);
                }
            }
        }

        recalculateInventoryTotals();
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification(`${item.name} заряжен`, 'success');
    };

    modal.style.display = 'flex';
}

window.equipDeviceModule = async function(device, devicePath, slotType) {
    // Ищем батарейки в инвентаре
    const batteries = [];
    const collect = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((it, idx) => {
            if (it.category === 'device' && it.subcategory === 'battery' && it.quantity > 0) {
                batteries.push({ item: it, path: path.concat(idx) });
            }
            if (it.contents) collect(it.contents, path.concat(idx, 'contents'));
        });
    };
    collect(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collect(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collect(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collect(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (batteries.length === 0) {
        showNotification('Нет батареек в инвентаре');
        return;
    }

    const oldModal = document.getElementById('equip-battery-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'equip-battery-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Выберите батарейку</h3>
            <select id="battery-select" class="form-control" size="5"></select>
            <div class="form-actions">
                <button class="btn btn-primary" id="confirm-battery">Установить</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const select = modal.querySelector('#battery-select');
    batteries.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = `${entry.item.name} (заряд ${entry.item.attributes?.power ?? '?'}%, ${entry.item.quantity} шт.)`;
        select.appendChild(opt);
    });

    modal.querySelector('#confirm-battery').onclick = () => {
        const idx = select.value;
        if (idx === '') return;
        const selected = batteries[idx];
        const battery = selected.item;
        modal.remove();

        // Уменьшаем количество в стопке
        battery.quantity -= 1;
        const batteryPath = selected.path;
        let batteryRemoved = false;
        if (battery.quantity <= 0) {
            removeItemByPath(batteryPath);
            batteryRemoved = true;
        }

        // Создаём копию батарейки с quantity = 1 для установки
        const batteryToInstall = {
            ...battery,
            quantity: 1,
            id: generateItemId(), // новый ID
            attributes: { ...battery.attributes } // копируем атрибуты
        };

        // Если в слоте уже есть батарейка, снимаем её (возвращаем в инвентарь)
        if (!device.installedModules) device.installedModules = [];
        const existingIdx = device.installedModules.findIndex(m => m.slotType === slotType);
        if (existingIdx !== -1) {
            const old = device.installedModules[existingIdx];
            device.installedModules.splice(existingIdx, 1);
            // Возвращаем старую батарейку в то же место, откуда взяли новую
            restoreItemToPath(old, batteryPath);
        }

        device.installedModules.push({
            ...batteryToInstall,
            slotType: slotType,
            sourcePath: batteryPath // сохраняем путь для возврата
        });

        // Обновляем DOM: контейнер слотов устройства
        const deviceDiv = document.querySelector(`[data-path="${devicePath.join(',')}"]`);
        if (deviceDiv) {
            const slotsContainer = deviceDiv.querySelector('.item-slots-container');
            if (slotsContainer) {
                const newSlotsHtml = renderSlotsUniversal(device, devicePath, 1);
                slotsContainer.outerHTML = newSlotsHtml || '';
            }
        }

        const batteryDiv = document.querySelector(`[data-path="${selected.path.join(',')}"]`);
        if (batteryDiv) {
            const qtyInput = batteryDiv.querySelector('input[data-field="quantity"]');
            if (qtyInput) {
                qtyInput.value = battery.quantity;
            }
            if (battery.quantity === 0) {
                batteryDiv.remove();
            }
        }

        recalculateInventoryTotals();
        updatePlateProtectionDisplay();
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification('Батарейка установлена', 'success');
    };

    modal.style.display = 'flex';
};

window.unequipDeviceModule = function(device, devicePath, slotType) {
    const idx = (device.installedModules || []).findIndex(m => m.slotType === slotType);
    if (idx === -1) return;
    const mod = device.installedModules[idx];
    device.installedModules.splice(idx, 1);

    // Восстанавливаем батарейку
    let restoredItem;
    const templateId = mod.templateId;
    if (templateId) {
        const allTemplates = allTemplatesCache || [];
        const template = allTemplates.find(t => t.id === templateId);
        if (template) {
            restoredItem = createItemFromTemplate(template);
            restoredItem.durability = mod.durability;
            restoredItem.maxDurability = mod.maxDurability;
            restoredItem.installedModules = mod.installedModules || [];
            restoredItem.attributes = { ...mod.attributes };
        } else {
            restoredItem = { ...mod, quantity: 1 };
        }
    } else {
        restoredItem = { ...mod, quantity: 1 };
    }

    const sourcePath = mod.sourcePath;
    let restored = false;
    if (sourcePath) {
        restored = restoreItemToPath(restoredItem, sourcePath);
    }
    if (!restored) {
        addToBackpack(restoredItem);
    }

    // Обновляем DOM: контейнер слотов устройства
    const deviceDiv = document.querySelector(`[data-path="${devicePath.join(',')}"]`);
    if (deviceDiv) {
        const slotsContainer = deviceDiv.querySelector('.item-slots-container');
        if (slotsContainer) {
            const newSlotsHtml = renderSlotsUniversal(device, devicePath, 1);
            slotsContainer.outerHTML = newSlotsHtml || '';
        }
    }

    if (sourcePath) {
        const containerPath = sourcePath.slice(0, -1);
        const index = sourcePath[sourcePath.length - 1];
        const containerData = getItemByPath(containerPath);
        if (Array.isArray(containerData)) {
            const containerDiv = document.querySelector(`[data-path="${containerPath.join(',')}"]`);
            if (containerDiv) {
                const parentForItems = containerDiv.classList.contains('container-contents')
                    ? containerDiv
                    : containerDiv.querySelector('.container-contents') || containerDiv;
                const allTemplates = allTemplatesCache || [];
                // Вставляем батарейку на нужную позицию
                const existingItems = Array.from(parentForItems.children).filter(el => el.hasAttribute('data-path'));
                if (index < existingItems.length) {
                    const refNode = existingItems[index];
                    const newItemDiv = document.createElement('div');
                    renderBackpackItem(restoredItem, index, containerPath, newItemDiv, allTemplates);
                    parentForItems.insertBefore(newItemDiv.firstChild, refNode);
                } else {
                    renderBackpackItem(restoredItem, index, containerPath, parentForItems, allTemplates);
                }
            }
        }
    } else {
        // fallback: если путь не сохранён, добавляем в конец рюкзака
        const backpackContainer = document.getElementById('backpack-container');
        if (backpackContainer) {
            const allTemplates = allTemplatesCache || [];
            const backpackItems = currentCharacterData.inventory?.backpack || [];
            const index = backpackItems.length - 1;
            renderBackpackItem(restoredItem, index, ['inventory', 'backpack'], backpackContainer, allTemplates);
        }
    }


    recalculateInventoryTotals();
    updatePlateProtectionDisplay();
    scheduleAutoSave();
    forceSyncCharacter();
    showNotification('Батарейка снята', 'success');
};

function applyEffect(effect) {
    const health = currentCharacterData.health || {};
    if (effect.type === 'heal') {
        health.current = (health.current || 0) + parseInt(effect.value);
        if (health.current > health.max) health.current = health.max;
    } else if (effect.type === 'radiation') {
        health.radiation = (health.radiation || 0) - parseInt(effect.value);
        if (health.radiation < 0) health.radiation = 0;
    }
    currentCharacterData.health = health;
}

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
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.belt) currentCharacterData.equipment.belt = {};
    if (!Array.isArray(currentCharacterData.equipment.belt.pouches)) {
        currentCharacterData.equipment.belt.pouches = [];
    }
    currentCharacterData.equipment.belt.pouches.push({
        type: null,
        capacity: 0,
        contents: [],
        isContainer: true
    });
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeBeltPouch = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.belt?.pouches) return;
    currentCharacterData.equipment.belt.pouches.splice(index, 1);
    renderInventoryTab(currentCharacterData)
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
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeBeltModification = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.belt?.modifications) return;
    currentCharacterData.equipment.belt.modifications.splice(index, 1);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.addVestPouch = function() {
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};
    if (!currentCharacterData.equipment.vest) {
        currentCharacterData.equipment.vest = { model: 'custom', pouches: [], totalCapacity: 0 };
    }
    if (!Array.isArray(currentCharacterData.equipment.vest.pouches)) {
        currentCharacterData.equipment.vest.pouches = [];
    }
    currentCharacterData.equipment.vest.pouches.push({
        type: null,
        capacity: 0,
        contents: [],
        isContainer: true
    });
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeVestPouch = function(index) {
    updateDataFromFields();
    if (!currentCharacterData.equipment?.vest?.pouches) return;
    currentCharacterData.equipment.vest.pouches.splice(index, 1);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.onVestModelChange = async function(select) {
    const selectedValue = select.value;
    if (!currentCharacterData.equipment) currentCharacterData.equipment = {};

    if (selectedValue === 'custom') {
        currentCharacterData.equipment.vest = {
            model: 'custom',
            pouches: currentCharacterData.equipment.vest?.pouches || [],
            totalCapacity: currentCharacterData.equipment.vest?.totalCapacity || 0
        };
    } else if (selectedValue) {
        const templates = await loadTemplatesForLobby('vest'); // <-- исправлено: 'vest', не 'vests'
        const template = templates.find(t => t.id == selectedValue);
        if (template) {
            // Убедимся, что у каждого подсумка есть internalVolume
            const pouches = (template.attributes?.pouches || []).map(p => ({
                ...p,
                internalVolume: p.internalVolume || template.volume || 0,
                contents: p.contents || []
            }));
            currentCharacterData.equipment.vest = {
                model: selectedValue,
                pouches: pouches,
                totalCapacity: template.attributes?.total_capacity || 0
            };
        } else {
            showNotification('Шаблон разгрузки не найден');
            return;
        }
    } else {
        delete currentCharacterData.equipment.vest;
    }

    await renderInventoryTab(currentCharacterData);
    const selectElement = document.querySelector('select[name="equipment.vest.model"]');
    if (selectElement) {
        selectElement.value = currentCharacterData.equipment.vest?.model || '';
    }
    scheduleAutoSave();
};

// Функции создания кастомных шаблонов
window.openCreateHelmetTemplateModal = function(template = null) {
    let modal = document.getElementById('create-helmet-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-helmet-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-helmet-template-modal').style.display='none'">&times;</span>
                <h3>${template ? 'Редактировать' : 'Создать'} шаблон шлема</h3>
                <input type="hidden" id="helmet-template-id">
                <div class="form-group"><label>Название</label><input type="text" id="helmet-name" class="form-control"></div>
                <div class="form-group"><label>Материал</label><select id="helmet-material" class="form-control">${MATERIAL_OPTIONS.map(opt => `<option value="${opt}">${opt}</option>`).join('')}</select></div>
                <div class="form-group"><label>Прочность</label><input type="number" id="helmet-maxDurability" class="form-control number-input" value="1"></div>
                <div class="form-group"><label>Точность (штраф)</label><input type="number" id="helmet-accuracyPenalty" class="form-control number-input" value="0"></div>
                <div class="form-group"><label>Эргономика (штраф)</label><input type="number" id="helmet-ergonomicsPenalty" class="form-control number-input" value="0"></div>
                <div class="form-group"><label>Харизма (бонус)</label><input type="number" id="helmet-charismaBonus" class="form-control number-input" value="0"></div>
                <div class="form-group"><label>Вес</label><input type="number" id="helmet-weight" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Объём</label><input type="number" id="helmet-volume" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Защита</label>
                    <div style="display: grid; grid-template-columns: repeat(5,1fr); gap:5px;">
                        <div><label>Физ</label><input type="number" id="helmet-physical" class="form-control number-input" value="0"></div>
                        <div><label>Хим</label><input type="number" id="helmet-chemical" class="form-control number-input" value="0"></div>
                        <div><label>Терм</label><input type="number" id="helmet-thermal" class="form-control number-input" value="0"></div>
                        <div><label>Элек</label><input type="number" id="helmet-electric" class="form-control number-input" value="0"></div>
                        <div><label>Рад</label><input type="number" id="helmet-radiation" class="form-control number-input" value="0"></div>
                    </div>
                </div>
                <hr>
                <h4>Зоны защиты</h4>
                <div class="form-group">
                    <label><input type="checkbox" id="helmet-zone-crown"> Теменная часть</label><br>
                    <label><input type="checkbox" id="helmet-zone-back"> Затылок</label><br>
                    <label><input type="checkbox" id="helmet-zone-ears"> Уши</label><br>
                    <label><input type="checkbox" id="helmet-zone-face"> Забрало / Лицо</label>
                </div>
                <hr>
                <h4>Слоты</h4>
                <div class="form-group">
                    <label><input type="checkbox" id="helmet-has-nvg-slot"> Крепление для ПНВ</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="helmet-has-filter-slot"> Слот для фильтра (противогазо-шлем)</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="helmet-has-visor-slot"> Слот для забрала</label>
                </div>
                <div class="form-actions"><button class="btn btn-primary" onclick="saveHelmetTemplate()">Сохранить</button><button class="btn btn-secondary" onclick="document.getElementById('create-helmet-template-modal').style.display='none'">Отмена</button></div>
            </div>`;
        document.body.appendChild(modal);
    }
    if (template) {
        document.getElementById('helmet-template-id').value = template.id;
        document.getElementById('helmet-name').value = template.name || '';
        document.getElementById('helmet-material').value = template.attributes?.material || 'Текстиль';
        document.getElementById('helmet-maxDurability').value = template.attributes?.max_durability || 1;
        document.getElementById('helmet-accuracyPenalty').value = template.attributes?.accuracy_penalty || 0;
        document.getElementById('helmet-ergonomicsPenalty').value = template.attributes?.ergonomics_penalty || 0;
        document.getElementById('helmet-charismaBonus').value = template.attributes?.charisma_bonus || 0;
        document.getElementById('helmet-weight').value = template.weight || 0;
        document.getElementById('helmet-volume').value = template.volume || 0;
        const prot = template.attributes?.protection || {};
        document.getElementById('helmet-physical').value = prot.physical || 0;
        document.getElementById('helmet-chemical').value = prot.chemical || 0;
        document.getElementById('helmet-thermal').value = prot.thermal || 0;
        document.getElementById('helmet-electric').value = prot.electric || 0;
        document.getElementById('helmet-radiation').value = prot.radiation || 0;
        const zones = template.attributes?.protection_zones || [];
        document.getElementById('helmet-zone-crown').checked = zones.includes('crown');
        document.getElementById('helmet-zone-back').checked = zones.includes('back');
        document.getElementById('helmet-zone-ears').checked = zones.includes('ears');
        document.getElementById('helmet-zone-face').checked = zones.includes('face');
        const slots = template.attributes?.slots || [];
        document.getElementById('helmet-has-nvg-slot').checked = slots.some(s => s.type === 'nvg');
        document.getElementById('helmet-has-filter-slot').checked = slots.some(s => s.type === 'filter');
        document.getElementById('helmet-has-visor-slot').checked = slots.some(s => s.type === 'visor');
    } else {
        document.getElementById('helmet-template-id').value = '';
    }
    modal.style.display = 'flex';
};

window.saveHelmetTemplate = async function() {
    const id = document.getElementById('helmet-template-id').value;
    const name = document.getElementById('helmet-name').value.trim();
    if (!name) { showNotification('Введите название'); return; }

    const slots = [];
    if (document.getElementById('helmet-has-nvg-slot').checked) slots.push({ type: 'nvg', label: 'ПНВ', maxItems: 1 });
    if (document.getElementById('helmet-has-filter-slot').checked) slots.push({ type: 'filter', label: 'Фильтр', maxItems: 1 });
    if (document.getElementById('helmet-has-visor-slot').checked) slots.push({ type: 'visor', label: 'Забрало', maxItems: 1 });

    const protectionZones = [];
    if (document.getElementById('helmet-zone-crown').checked) protectionZones.push('crown');
    if (document.getElementById('helmet-zone-back').checked) protectionZones.push('back');
    if (document.getElementById('helmet-zone-ears').checked) protectionZones.push('ears');
    if (document.getElementById('helmet-zone-face').checked) protectionZones.push('face');

    const attributes = {
        material: document.getElementById('helmet-material').value,
        max_durability: parseInt(document.getElementById('helmet-maxDurability').value) || 1,
        accuracy_penalty: parseInt(document.getElementById('helmet-accuracyPenalty').value) || 0,
        ergonomics_penalty: parseInt(document.getElementById('helmet-ergonomicsPenalty').value) || 0,
        charisma_bonus: parseInt(document.getElementById('helmet-charismaBonus').value) || 0,
        protection: {
            physical: parseInt(document.getElementById('helmet-physical').value) || 0,
            chemical: parseInt(document.getElementById('helmet-chemical').value) || 0,
            thermal: parseInt(document.getElementById('helmet-thermal').value) || 0,
            electric: parseInt(document.getElementById('helmet-electric').value) || 0,
            radiation: parseInt(document.getElementById('helmet-radiation').value) || 0
        },
        protection_zones: protectionZones,
        slots: slots
    };
    const data = {
        name, category: 'helmet', subcategory: null, price: 0,
        weight: parseFloat(document.getElementById('helmet-weight').value) || 0,
        volume: parseFloat(document.getElementById('helmet-volume').value) || 0,
        attributes
    };
    try {
        if (id) await Server.updateLobbyTemplate(currentLobbyId, id, data);
        else await Server.createLobbyTemplate(currentLobbyId, data);
        clearTemplatesCache('helmet'); clearAllTemplatesCache();
        document.getElementById('create-helmet-template-modal').style.display = 'none';
        showNotification(id ? 'Шаблон обновлён' : 'Шаблон создан', 'success');
        if (currentCharacterData) await renderEquipmentTab(currentCharacterData);
        if (typeof loadTemplatesForManager === 'function') {
            const active = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (active === 'helmet') loadTemplatesForManager('helmet');
        }
    } catch (e) { showNotification(e.message); }
};

window.openCreateGasMaskTemplateModal = function(template = null) {
    let modal = document.getElementById('create-gasMask-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-gasMask-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-gasMask-template-modal').style.display='none'">&times;</span>
                <h3>${template ? 'Редактировать' : 'Создать'} шаблон противогаза</h3>
                <input type="hidden" id="gasMask-template-id">
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="gasMask-name" class="form-control">
                </div>
                <div class="form-group">
                    <label>Материал</label>
                    <select id="gasMask-material" class="form-control">
                        ${MATERIAL_OPTIONS.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Прочность</label>
                    <input type="number" id="gasMask-maxDurability" class="form-control number-input" value="1">
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
                    <label>Вес</label>
                    <input type="number" id="gasMask-weight" class="form-control number-input" value="0" step="0.1">
                </div>
                <div class="form-group">
                    <label>Объём</label>
                    <input type="number" id="gasMask-volume" class="form-control number-input" value="0" step="0.1">
                </div>
                <div class="form-group">
                    <label>Защита</label>
                    <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px;">
                        <div><label>Физ</label><input type="number" id="gasMask-physical" class="form-control number-input" value="0"></div>
                        <div><label>Хим</label><input type="number" id="gasMask-chemical" class="form-control number-input" value="0"></div>
                        <div><label>Терм</label><input type="number" id="gasMask-thermal" class="form-control number-input" value="0"></div>
                        <div><label>Элек</label><input type="number" id="gasMask-electric" class="form-control number-input" value="0"></div>
                        <div><label>Рад</label><input type="number" id="gasMask-radiation" class="form-control number-input" value="0"></div>
                    </div>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveGasMaskTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-gasMask-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    if (template) {
        document.getElementById('gasMask-template-id').value = template.id;
        document.getElementById('gasMask-name').value = template.name || '';
        document.getElementById('gasMask-material').value = template.attributes?.material || 'Текстиль';
        document.getElementById('gasMask-maxDurability').value = template.attributes?.max_durability || 1;
        document.getElementById('gasMask-accuracyPenalty').value = template.attributes?.accuracy_penalty || 0;
        document.getElementById('gasMask-ergonomicsPenalty').value = template.attributes?.ergonomics_penalty || 0;
        document.getElementById('gasMask-charismaBonus').value = template.attributes?.charisma_bonus || 0;
        document.getElementById('gasMask-weight').value = template.weight || 0;
        document.getElementById('gasMask-volume').value = template.volume || 0;
        const prot = template.attributes?.protection || {};
        document.getElementById('gasMask-physical').value = prot.physical || 0;
        document.getElementById('gasMask-chemical').value = prot.chemical || 0;
        document.getElementById('gasMask-thermal').value = prot.thermal || 0;
        document.getElementById('gasMask-electric').value = prot.electric || 0;
        document.getElementById('gasMask-radiation').value = prot.radiation || 0;
    } else {
        document.getElementById('gasMask-template-id').value = '';
    }

    modal.style.display = 'flex';
};

window.saveGasMaskTemplate = async function() {
    const id = document.getElementById('gasMask-template-id').value;
    const name = document.getElementById('gasMask-name').value.trim();
    if (!name) { showNotification('Введите название'); return; }

    const attributes = {
        material: document.getElementById('gasMask-material').value,
        max_durability: parseInt(document.getElementById('gasMask-maxDurability').value) || 1,
        accuracy_penalty: parseInt(document.getElementById('gasMask-accuracyPenalty').value) || 0,
        ergonomics_penalty: parseInt(document.getElementById('gasMask-ergonomicsPenalty').value) || 0,
        charisma_bonus: parseInt(document.getElementById('gasMask-charismaBonus').value) || 0,
        protection: {
            physical: parseInt(document.getElementById('gasMask-physical').value) || 0,
            chemical: parseInt(document.getElementById('gasMask-chemical').value) || 0,
            thermal: parseInt(document.getElementById('gasMask-thermal').value) || 0,
            electric: parseInt(document.getElementById('gasMask-electric').value) || 0,
            radiation: parseInt(document.getElementById('gasMask-radiation').value) || 0
        },
        slots: [{ type: 'filter', label: 'Фильтр', maxItems: 1 }]   // ← слот всегда есть
    };

    const data = {
        name: name,
        category: 'gas_mask',
        subcategory: null,
        price: 0,
        weight: parseFloat(document.getElementById('gasMask-weight').value) || 0,
        volume: parseFloat(document.getElementById('gasMask-volume').value) || 0,
        attributes: attributes
    };

    try {
        if (id) {
            await Server.updateLobbyTemplate(currentLobbyId, id, data);
        } else {
            await Server.createLobbyTemplate(currentLobbyId, data);
        }
        clearTemplatesCache('gas_mask');
        clearAllTemplatesCache();
        document.getElementById('create-gasMask-template-modal').style.display = 'none';
        showNotification(id ? 'Шаблон обновлён' : 'Шаблон создан', 'success');

        if (currentCharacterData) {
            await renderEquipmentTab(currentCharacterData);
        }

        if (typeof loadTemplatesForManager === 'function') {
            const active = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (active === 'gas_mask') loadTemplatesForManager('gas_mask');
        }
    } catch (e) {
        showNotification(e.message);
    }
};

window.openCreateArmorTemplateModal = function(template = null) {
    let modal = document.getElementById('create-armor-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-armor-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-armor-template-modal').style.display='none'">&times;</span>
                <h3>${template ? 'Редактировать' : 'Создать'} шаблон брони</h3>
                <input type="hidden" id="armor-template-id">
                <div class="form-group"><label>Название</label><input type="text" id="armor-name" class="form-control"></div>
                <div class="form-group"><label>Материал</label><select id="armor-material" class="form-control">${MATERIAL_OPTIONS.map(opt => `<option value="${opt}">${opt}</option>`).join('')}</select></div>
                <div class="form-group"><label>Прочность</label><input type="number" id="armor-maxDurability" class="form-control number-input" value="1"></div>
                <div class="form-group"><label>Штраф перемещения</label><input type="number" id="armor-movementPenalty" class="form-control number-input" value="0"></div>
                <div class="form-group"><label>Слоты под контейнеры</label><input type="number" id="armor-containerSlots" class="form-control number-input" value="0"></div>
                <div class="form-group"><label>Вес</label><input type="number" id="armor-weight" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Объём</label><input type="number" id="armor-volume" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Защита</label>
                    <div style="display: grid; grid-template-columns: repeat(5,1fr); gap:5px;">
                        <div><label>Физ</label><input type="number" id="armor-physical" class="form-control number-input" value="0"></div>
                        <div><label>Хим</label><input type="number" id="armor-chemical" class="form-control number-input" value="0"></div>
                        <div><label>Терм</label><input type="number" id="armor-thermal" class="form-control number-input" value="0"></div>
                        <div><label>Элек</label><input type="number" id="armor-electric" class="form-control number-input" value="0"></div>
                        <div><label>Рад</label><input type="number" id="armor-radiation" class="form-control number-input" value="0"></div>
                    </div>
                </div>
                <hr>
                <h4>Зоны защиты</h4>
                <div class="form-group">
                    <label><input type="checkbox" id="armor-zone-torso"> Торс</label><br>
                    <label><input type="checkbox" id="armor-zone-arms"> Руки</label><br>
                    <label><input type="checkbox" id="armor-zone-legs"> Ноги</label><br>
                    <label><input type="checkbox" id="armor-zone-head"> Голова</label>
                </div>
                <div class="form-actions"><button class="btn btn-primary" onclick="saveArmorTemplate()">Сохранить</button><button class="btn btn-secondary" onclick="document.getElementById('create-armor-template-modal').style.display='none'">Отмена</button></div>
            </div>`;
        document.body.appendChild(modal);
    }
    if (template) {
        document.getElementById('armor-template-id').value = template.id;
        document.getElementById('armor-name').value = template.name || '';
        document.getElementById('armor-material').value = template.attributes?.material || 'Текстиль';
        document.getElementById('armor-maxDurability').value = template.attributes?.max_durability || 1;
        document.getElementById('armor-movementPenalty').value = template.attributes?.movement_penalty || 0;
        document.getElementById('armor-containerSlots').value = template.attributes?.container_slots || 0;
        document.getElementById('armor-weight').value = template.weight || 0;
        document.getElementById('armor-volume').value = template.volume || 0;
        const prot = template.attributes?.protection || {};
        document.getElementById('armor-physical').value = prot.physical || 0;
        document.getElementById('armor-chemical').value = prot.chemical || 0;
        document.getElementById('armor-thermal').value = prot.thermal || 0;
        document.getElementById('armor-electric').value = prot.electric || 0;
        document.getElementById('armor-radiation').value = prot.radiation || 0;
        const zones = template.attributes?.protection_zones || [];
        document.getElementById('armor-zone-torso').checked = zones.includes('torso');
        document.getElementById('armor-zone-arms').checked = zones.includes('arms');
        document.getElementById('armor-zone-legs').checked = zones.includes('legs');
        document.getElementById('armor-zone-head').checked = zones.includes('head');
    } else {
        document.getElementById('armor-template-id').value = '';
    }
    modal.style.display = 'flex';
};

window.saveArmorTemplate = async function() {
    const id = document.getElementById('armor-template-id').value;
    const name = document.getElementById('armor-name').value.trim();
    if (!name) { showNotification('Введите название'); return; }
    const protectionZones = [];
    if (document.getElementById('armor-zone-torso').checked) protectionZones.push('torso');
    if (document.getElementById('armor-zone-arms').checked) protectionZones.push('arms');
    if (document.getElementById('armor-zone-legs').checked) protectionZones.push('legs');
    if (document.getElementById('armor-zone-head').checked) protectionZones.push('head');
    const attributes = {
        material: document.getElementById('armor-material').value,
        max_durability: parseInt(document.getElementById('armor-maxDurability').value) || 1,
        movement_penalty: parseInt(document.getElementById('armor-movementPenalty').value) || 0,
        container_slots: parseInt(document.getElementById('armor-containerSlots').value) || 0,
        protection: {
            physical: parseInt(document.getElementById('armor-physical').value) || 0,
            chemical: parseInt(document.getElementById('armor-chemical').value) || 0,
            thermal: parseInt(document.getElementById('armor-thermal').value) || 0,
            electric: parseInt(document.getElementById('armor-electric').value) || 0,
            radiation: parseInt(document.getElementById('armor-radiation').value) || 0
        },
        protection_zones: protectionZones
    };
    const data = {
        name, category: 'armor', subcategory: null, price: 0,
        weight: parseFloat(document.getElementById('armor-weight').value) || 0,
        volume: parseFloat(document.getElementById('armor-volume').value) || 0,
        attributes
    };
    try {
        if (id) await Server.updateLobbyTemplate(currentLobbyId, id, data);
        else await Server.createLobbyTemplate(currentLobbyId, data);
        clearTemplatesCache('armor'); clearAllTemplatesCache();
        document.getElementById('create-armor-template-modal').style.display = 'none';
        showNotification(id ? 'Шаблон обновлён' : 'Шаблон создан', 'success');
        if (typeof loadTemplatesForManager === 'function') {
            const active = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (active === 'armor') loadTemplatesForManager('armor');
        }
        if (currentCharacterData && typeof renderEquipmentTab === 'function') {
            await renderEquipmentTab(currentCharacterData);
        }
    } catch (e) { showNotification(e.message); }
};

window.openCreateWeaponTemplateModal = function(weaponIndex, template = null) {
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
                    <label>Категория (подтип)</label>
                    <input type="text" id="template-category" class="form-control" placeholder="например, пистолеты">
                </div>
                <div class="form-group">
                    <label>Калибр</label>
                    <input type="text" id="template-caliber" class="form-control" placeholder="например, 5.45x39">
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
                    <label>Дальность</label>
                    <input type="number" id="template-range" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Эргономика</label>
                    <input type="number" id="template-ergonomics" class="form-control number-input" value="0">
                </div>
                <div class="form-group">
                    <label>Очередь</label>
                    <input type="text" id="template-burst" class="form-control" placeholder="например, 3, -/2/3">
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
                    <label>Объём</label>
                    <input type="number" id="template-volume" class="form-control number-input" value="0" step="0.1">
                </div>
                <div class="form-group">
                    <label>Размер магазина</label>
                    <input type="number" id="template-magazineSize" class="form-control number-input" value="0">
                </div>
                <hr>
                <h4>Слоты для модулей</h4>
                <div class="form-group">
                    <label><input type="checkbox" id="template-slot-scope" checked> Прицел</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="template-slot-barrel" checked> Ствол</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="template-slot-handguard" checked> Цевье</label>
                </div>
                <div class="form-group">
                    <label><input type="checkbox" id="template-fixed-magazine"> Несъёмный магазин</label>
                </div>
                <input type="hidden" id="weapon-template-id">
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="window.saveWeaponTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-weapon-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    if (template) {
        document.getElementById('weapon-template-id').value = template.id;
        document.getElementById('template-name').value = template.name || '';
        document.getElementById('template-category').value = template.subcategory || '';
        document.getElementById('template-caliber').value = template.attributes?.caliber || '';
        document.getElementById('template-accuracy').value = template.attributes?.accuracy || 0;
        document.getElementById('template-noise').value = template.attributes?.noise || 0;
        document.getElementById('template-range').value = template.attributes?.range || 0;
        document.getElementById('template-ergonomics').value = template.attributes?.ergonomics || 0;
        document.getElementById('template-burst').value = template.attributes?.burst || '';
        document.getElementById('template-damage').value = template.attributes?.damage || 0;
        document.getElementById('template-durability').value = template.attributes?.durability || 100;
        document.getElementById('template-fireRate').value = template.attributes?.fire_rate || 0;
        document.getElementById('template-weight').value = template.weight || 0;
        document.getElementById('template-volume').value = template.volume || 0;
        document.getElementById('template-magazineSize').value = template.attributes?.magazine_size || 0;
        // Слоты
        const slots = template.attributes?.slots || [];
        document.getElementById('template-slot-scope').checked = slots.some(s => s.type === 'scope');
        document.getElementById('template-slot-barrel').checked = slots.some(s => s.type === 'barrel');
        document.getElementById('template-slot-handguard').checked = slots.some(s => s.type === 'handguard');
    } else {
        document.getElementById('weapon-template-id').value = '';
    }

    modal.style.display = 'flex';
};

window.saveWeaponTemplate = async function() {
    const id = document.getElementById('weapon-template-id').value;
    const name = document.getElementById('template-name').value.trim();
    if (!name) { showNotification('Введите название'); return; }

    const caliber = document.getElementById('template-caliber').value.trim();
    const slots = [];
    if (document.getElementById('template-slot-scope').checked) slots.push({ type: 'scope', label: 'Прицел', maxItems: 1 });
    if (document.getElementById('template-slot-barrel').checked) slots.push({ type: 'barrel', label: 'Ствол', maxItems: 1 });
    if (document.getElementById('template-slot-handguard').checked) slots.push({ type: 'handguard', label: 'Цевье', maxItems: 1 });

    const attributes = {
        accuracy: parseInt(document.getElementById('template-accuracy').value) || 0,
        noise: parseInt(document.getElementById('template-noise').value) || 0,
        range: parseInt(document.getElementById('template-range').value) || 0,
        ergonomics: parseInt(document.getElementById('template-ergonomics').value) || 0,
        burst: document.getElementById('template-burst').value,
        damage: parseInt(document.getElementById('template-damage').value) || 0,
        durability: parseInt(document.getElementById('template-durability').value) || 100,
        fire_rate: parseInt(document.getElementById('template-fireRate').value) || 0,
        caliber: caliber,
        magazine_size: parseInt(document.getElementById('template-magazineSize').value) || 0,
        slots: slots,
        fixedMagazine: document.getElementById('template-fixed-magazine').checked
    };

    const weight = parseFloat(document.getElementById('template-weight').value) || 0;
    const volume = parseFloat(document.getElementById('template-volume').value) || 0;

    const data = {
        name: name,
        category: 'weapon',
        subcategory: document.getElementById('template-category').value || null,
        price: 0,
        weight: weight,
        volume: volume,
        attributes: attributes
    };

    try {
        if (id) {
            await Server.updateLobbyTemplate(currentLobbyId, id, data);
        } else {
            await Server.createLobbyTemplate(currentLobbyId, data);
        }
        clearTemplatesCache('weapon');
        clearAllTemplatesCache();
        document.getElementById('create-weapon-template-modal').style.display = 'none';
        showNotification(id ? 'Шаблон обновлён' : 'Шаблон создан', 'success');

        // Обновляем список в менеджере, если он открыт
        if (typeof loadTemplatesForManager === 'function' && document.getElementById('templates-modal').style.display === 'flex') {
            const activeCat = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (activeCat === 'weapon') loadTemplatesForManager('weapon');
        }

        if (currentCharacterData && typeof renderEquipmentTab === 'function') {
            await renderEquipmentTab(currentCharacterData);
        }
    } catch (err) {
        showNotification(err.message);
    }
};

window.openCreateVestTemplateModal = function(template = null) {
    let modal = document.getElementById('create-vest-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-vest-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 85vh; width: 700px; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-vest-template-modal').style.display='none'">&times;</span>
                <h3>${template ? 'Редактировать' : 'Создать'} шаблон разгрузки</h3>
                <input type="hidden" id="vest-template-id">
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="vest-template-name" class="form-control" placeholder="Например: Разгрузка сталкера">
                </div>
                <div class="form-group">
                    <label>Общий объём (литры)</label>
                    <input type="number" id="vest-template-total-capacity" class="form-control number-input" value="0" min="0" step="1">
                </div>
                <div class="form-group">
                    <label>Вес</label>
                    <input type="number" id="vest-template-weight" class="form-control number-input" value="0" step="0.1">
                </div>
                <hr>
                <h4>Подсумки</h4>
                <div id="vest-pouches-editor" style="margin-bottom: 10px;">
                    <table style="width:100%; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid #555;">
                                <th style="padding:5px; text-align:left;">Тип подсумка</th>
                                <th style="padding:5px; text-align:left;">Объём</th>
                                <th style="width:40px;"></th>
                            </tr>
                        </thead>
                        <tbody id="vest-pouches-tbody">
                            <!-- строки будут добавляться динамически -->
                        </tbody>
                    </table>
                </div>
                <button type="button" class="btn btn-sm btn-secondary" onclick="window.addVestPouchRow()">➕ Добавить подсумок</button>
                <hr>
                <div class="form-actions" style="margin-top:15px;">
                    <button class="btn btn-primary" onclick="window.saveVestTemplateFromEditor()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-vest-template-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const tbody = document.getElementById('vest-pouches-tbody');
    tbody.innerHTML = '';

    if (template) {
        document.getElementById('vest-template-id').value = template.id;
        document.getElementById('vest-template-name').value = template.name || '';
        document.getElementById('vest-template-total-capacity').value = template.attributes?.total_capacity || 0;
        document.getElementById('vest-template-weight').value = template.weight || 0;

        const pouches = template.attributes?.pouches || [];
        pouches.forEach(p => window.addVestPouchRow(p));
    } else {
        document.getElementById('vest-template-id').value = '';
        window.addVestPouchRow(); // одна пустая строка
    }

    modal.style.display = 'flex';
};

async function loadPouchTemplatesForSelect() {
    try {
        return await loadTemplatesForLobby('pouch');
    } catch (e) {
        console.warn('Не удалось загрузить шаблоны подсумков', e);
        return [];
    }
}

window.addVestPouchRow = async function(pouchData = null) {
    const tbody = document.getElementById('vest-pouches-tbody');
    if (!tbody) return;

    const pouchTemplates = await loadTemplatesForLobby('pouch');

    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #444';

    // Ячейка выбора шаблона
    const tdType = document.createElement('td');
    tdType.style.padding = '5px';
    const select = document.createElement('select');
    select.className = 'form-control';
    select.style.width = '100%';
    select.innerHTML = '<option value="">-- Выберите --</option>';
    pouchTemplates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name;
        select.appendChild(option);
    });
    tdType.appendChild(select);

    // Ячейка объёма
    const tdVolume = document.createElement('td');
    tdVolume.style.padding = '5px';
    const volumeInput = document.createElement('input');
    volumeInput.type = 'number';
    volumeInput.className = 'form-control number-input pouch-volume';
    volumeInput.value = 0;
    volumeInput.min = 0;
    volumeInput.step = 1;
    tdVolume.appendChild(volumeInput);

    // Ячейка удаления
    const tdDel = document.createElement('td');
    tdDel.style.padding = '5px';
    tdDel.style.textAlign = 'center';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = '✕';
    delBtn.onclick = () => tr.remove();
    tdDel.appendChild(delBtn);

    tr.appendChild(tdType);
    tr.appendChild(tdVolume);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);

    // Если переданы начальные данные, заполняем
    if (pouchData) {
        select.value = pouchData.type;
        volumeInput.value = pouchData.capacity;
    }

    // При выборе шаблона подставляем его объём
    select.onchange = (e) => {
        const templateId = e.target.value;
        const template = pouchTemplates.find(t => t.id == templateId);
        if (template) {
            volumeInput.value = template.volume || 0;
        }
    };
};

window.saveVestTemplateFromEditor = async function() {
    const id = document.getElementById('vest-template-id').value;
    const name = document.getElementById('vest-template-name').value.trim();
    if (!name) {
        showNotification('Введите название');
        return;
    }

    const totalCapacity = parseInt(document.getElementById('vest-template-total-capacity').value) || 0;
    const weight = parseFloat(document.getElementById('vest-template-weight').value) || 0;

    const pouchTemplates = await loadTemplatesForLobby('pouch');

    const pouches = [];
    const rows = document.querySelectorAll('#vest-pouches-tbody tr');
    for (let row of rows) {
        const select = row.querySelector('select');
        const volumeInput = row.querySelector('.pouch-volume');
        if (!select || !volumeInput) continue;

        const typeId = select.value;
        const capacity = parseInt(volumeInput.value) || 0;
        if (!typeId) continue;

        const template = pouchTemplates.find(t => t.id == typeId);
        pouches.push({
            type: parseInt(typeId, 10),
            capacity: capacity,
            internalVolume: template ? template.volume : 0
        });
    }

    const attributes = {
        total_capacity: totalCapacity,
        pouches: pouches
    };

    const data = {
        name: name,
        category: 'vest',
        subcategory: null,
        price: 0,
        weight: weight,
        volume: 0,
        attributes: attributes
    };

    try {
        if (id) {
            await Server.updateLobbyTemplate(currentLobbyId, id, data);
        } else {
            await Server.createLobbyTemplate(currentLobbyId, data);
        }
        clearTemplatesCache('vest');
        allTemplatesCache = null;

        document.getElementById('create-vest-template-modal').style.display = 'none';
        showNotification(id ? 'Шаблон обновлён' : 'Шаблон создан', 'success');

        if (currentCharacterData) {
            await renderEquipmentTab(currentCharacterData);
            await refreshVestModelSelect();
        }

        if (typeof loadTemplatesForManager === 'function') {
            const active = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (active === 'vest') loadTemplatesForManager('vest');
        }
    } catch (err) {
        showNotification(err.message);
    }
};

async function refreshVestModelSelect() {
    const select = document.querySelector('select[name="equipment.vest.model"]');
    if (!select) return;
    const currentValue = select.value;
    const vestTemplates = await loadTemplatesForLobby('vest');
    select.innerHTML = '<option value="">-- Выберите модель --</option><option value="custom">Своя (база)</option>';
    vestTemplates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name;
        select.appendChild(option);
    });
    select.value = currentValue;
}

window.addPouchToVestTemplateEditor = function() {
    vestTemplateEditorPouches.push({
        type: null,
        capacity: 0
    });
    renderVestTemplatePouches();
};

async function renderVestTemplatePouches() {
    const container = document.getElementById('vest-pouches-editor');
    if (!container) return;
    container.innerHTML = '';

    // Загружаем шаблоны подсумков
    let pouchTemplates = [];
    try {
        pouchTemplates = await loadTemplatesForLobby('pouch');
    } catch (e) {
        console.error('Failed to load pouch templates', e);
    }

    vestTemplateEditorPouches.forEach((pouch, index) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.alignItems = 'center';
        row.style.marginBottom = '5px';

        const select = document.createElement('select');
        select.className = 'form-control';
        select.style.flex = '2';
        select.innerHTML = '<option value="">-- Выберите подсумок --</option>';
        pouchTemplates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.name;
            if (pouch.type == t.id) option.selected = true;
            select.appendChild(option);
        });
        select.onchange = (e) => {
            const templateId = e.target.value;
            const template = pouchTemplates.find(t => t.id == templateId);
            if (template) {
                pouch.type = template.id;
                pouch.capacity = template.volume || 0;
                renderVestTemplatePouches(); // обновить отображение объёма
            }
        };

        const volumeSpan = document.createElement('span');
        volumeSpan.style.width = '80px';
        volumeSpan.textContent = `${pouch.capacity} л`;

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-danger';
        delBtn.textContent = '✕';
        delBtn.onclick = () => {
            vestTemplateEditorPouches.splice(index, 1);
            renderVestTemplatePouches();
        };

        row.appendChild(select);
        row.appendChild(volumeSpan);
        row.appendChild(delBtn);
        container.appendChild(row);
    });
}

// ========== 6. ВКЛАДКА "ИНВЕНТАРЬ" ==========
async function renderInventoryTab(data) {
    const container = document.getElementById('sheet-tab-inventory');
    const inv = data.inventory || {};
    const eq = data.equipment || {};
    const pockets = Array.isArray(inv.pockets) ? inv.pockets : [];
    const backpack = Array.isArray(inv.backpack) ? inv.backpack : [];
    const pocketMaxVolume = inv.pocketMaxVolume || 10;
    const pocketFill = pockets.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);

    // Загружаем шаблоны рюкзаков
    let backpackTemplates = [];
    try {
        backpackTemplates = await loadTemplatesForLobby('backpack');
        cachedBackpackTemplates = backpackTemplates;
    } catch (e) {
        console.error('Failed to load backpack templates', e);
    }

    // Загружаем все возможные шаблоны предметов
    const allTemplates = await getAllItemTemplates();

    // Фильтруем нужные категории из allTemplates
    const helmetTemplates = allTemplates.filter(t => t.category === 'helmet');
    const gasMaskTemplates = allTemplates.filter(t => t.category === 'gas_mask');
    const pouchTemplates = allTemplates.filter(t => t.category === 'pouch');
    const modificationTemplates = allTemplates.filter(t => t.category === 'modification');
    const vestTemplates = allTemplates.filter(t => t.category === 'vest');

    // Группируем для селекторов в карманах/рюкзаке
    const groupedByCategory = {};
    allTemplates.forEach(t => {
        const group = t.categoryDisplay || 'Прочее';
        if (!groupedByCategory[group]) groupedByCategory[group] = [];
        groupedByCategory[group].push(t);
    });

    const selectedBackpackId = inv.backpackModel ? parseInt(inv.backpackModel, 10) : null;
    const selectedBackpack = backpackTemplates.find(t => t.id === selectedBackpackId);
    const backpackLimit = selectedBackpack ? selectedBackpack.attributes?.limit || 0 : 0;
    const backpackWeightReduction = selectedBackpack ? selectedBackpack.attributes?.weight_reduction || 0 : 0;
    const backpackFill = backpack.reduce((sum, item) => sum + (item.volume || 0) * (item.quantity || 1), 0);

    const rawTotalWeight = pockets.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0) +
                           backpack.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0);
    const movePenaltyFromWeight = Math.floor(rawTotalWeight / 5);
    const movePenalty = Math.max(0, movePenaltyFromWeight - backpackWeightReduction);

    let html = `
        <div style="display: flex; gap: 20px; margin-bottom: 15px;">
            <div><strong>Общий вес:</strong> <span id="total-weight-display">${rawTotalWeight}</span></div>
            <div><strong>Штраф перемещения:</strong> <span id="move-penalty-display">${movePenalty}</span></div>
        </div>
        ${window.isGM ? `<div style="margin-bottom: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm btn-primary" onclick="openCreateInventoryItemModal()">➕ Создать предмет</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="openCreateBackpackTemplateModal()">➕ Создать рюкзак</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="openCreateVestTemplateModal()">➕ Создать разгрузку</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="openCreateModuleTemplateModal()">➕ Создать модуль</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="openCreateMagazineTemplateModal()">➕ Создать магазин</button>
        </div>` : ''}
        <hr>
        <h4>Карманы <span style="font-weight:normal;">(заполнено: <span id="pocket-fill-display">${pocketFill}</span> / <input type="number" class="form-control number-input" name="inventory.pocketMaxVolume" value="${pocketMaxVolume}" style="width:70px; display:inline;">)</span></h4>
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 5px; font-weight: bold; margin-bottom: 5px; align-items: center;">
            <div>Название</div><div>Вес</div><div>Объём</div><div>Кол-во</div><div></div>
        </div>
        <div id="pockets-container"></div>
        <select id="pockets-add-template" class="form-control" style="margin-top:10px;" onchange="addPocketItemFromTemplate(this.value)">
            <option value="">-- Добавить предмет (выберите) --</option>
        </select>
        <button type="button" class="btn btn-sm btn-secondary" onclick="addPocketItemManual()">📝 Свой предмет</button>

        <!-- Пояс -->
        ${eq.belt?.templateId ? `
        <div class="equipment-group" style="margin-top: 20px;">
            <div class="equipment-header" style="display: flex; align-items: center; justify-content: space-between;">
                <h4>Пояс</h4>
                <button type="button" class="btn btn-sm btn-danger" onclick="unequipBelt()">Снять</button>
            </div>
            <div style="margin-bottom: 10px;">
                <label>Предмет на поясе</label>
                <div style="display: flex; align-items: center; gap: 10px; margin-top: 5px;">
                    <span style="flex: 1;">
                        ${eq.belt?.storedItem ?
                            `${escapeHtml(eq.belt.storedItem.name)} (${eq.belt.storedItem.type === 'helmet' ? 'Шлем' : 'Противогаз'})` :
                            '<span style="color: #aaa;">Пусто</span>'}
                    </span>
                    ${eq.belt?.storedItem ?
                        `<button type="button" class="btn btn-sm btn-danger" onclick="unequipFromBelt()">Снять</button>` : ''}
                </div>
            </div>
            <div style="display: flex; align-items: center;">
                <h5 style="margin: 0;">Подсумки</h5>
                <button type="button" class="btn btn-sm btn-secondary" onclick="addBeltPouch()" style="padding: 2px 8px;">➕</button>
            </div>
            <div id="belt-pouches-container"></div>
            <div style="display: flex; align-items: center; margin-top: 15px;">
                <h5 style="margin: 0;">Модификации пояса</h5>
                <button type="button" class="btn btn-sm btn-secondary" onclick="addBeltModification()" title="Добавить модификацию" style="padding: 2px 8px;">➕</button>
            </div>
            <div id="belt-modifications-container">
                ${renderBeltModifications(eq.belt?.modifications || [], modificationTemplates.filter(t => t.attributes?.type === 'belt'))}
            </div>
        </div>
        ` : ''}

        <!-- Разгрузка -->
        ${eq.vest?.templateId ? `
        <div class="equipment-group" style="margin-top: 20px;">
            <div class="equipment-header" style="display: flex; align-items: center; justify-content: space-between;">
                <h4>Разгрузка</h4>
                <button type="button" class="btn btn-sm btn-danger" onclick="unequipVest()">Снять</button>
            </div>
            <div style="display: flex; gap: 10px; margin-bottom: 10px; align-items: flex-end;">
                <div style="flex: 1;">
                    <label>Модель</label>
                    <select name="equipment.vest.model" class="form-control" onchange="onVestModelChange(this)" style="margin-bottom: 0;">
                        <option value="">-- Выберите модель --</option>
                        <option value="custom" ${eq.vest?.model === 'custom' ? 'selected' : ''}>Своя (база)</option>
                        ${vestTemplates.map(t => `<option value="${t.id}" ${eq.vest?.model == t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            ${eq.vest?.model === 'custom' ? `
                <div style="margin-bottom: 10px;">
                    <label>Общий объём</label>
                    <input type="number" class="form-control number-input" name="equipment.vest.totalCapacity" value="${eq.vest?.totalCapacity || 0}" placeholder="Объём">
                </div>
            ` : ''}
            <div style="display: flex; align-items: center;">
                <h5 style="margin: 0;">Подсумки</h5>
                ${eq.vest?.model === 'custom' ? `<button type="button" class="btn btn-sm btn-secondary" onclick="addVestPouch()" style="padding: 2px 8px;">➕</button>` : ''}
            </div>
            <div id="vest-pouches-container"></div>
        </div>
        ${(() => {
            const plateInfo = getEffectiveTorsoProtection();
            if (!plateInfo) return '';
            const frontText = plateInfo.front !== null ? `${plateInfo.front}%` : 'нет';
            const backText = plateInfo.back !== null ? `${plateInfo.back}%` : 'нет';
            return `<div data-vest-protection style="margin: 10px 0; padding: 8px; background: rgba(0,100,0,0.1); border-radius: 4px;">
                <strong>Бронеплиты:</strong> перед ${frontText}, спина ${backText}
            </div>`;
        })()}
        ` : ''}

        <h4 style="margin-top:20px;">Рюкзак</h4>
        <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
            <label>Модель:</label>
            <select name="inventory.backpackModel" class="form-control" onchange="onBackpackModelChange(this)" style="width: 200px;">
                <option value="">-- Без рюкзака --</option>
                ${backpackTemplates.map(t => `<option value="${t.id}" ${selectedBackpackId === t.id ? 'selected' : ''}>${t.name} (лимит ${t.attributes?.limit || 0}, снижение веса ${t.attributes?.weight_reduction || 0})</option>`).join('')}
            </select>
            <span id="backpack-fill-display">Заполнено: ${backpackFill} / ${backpackLimit}</span>
        </div>
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 1fr auto; gap: 5px; font-weight: bold; margin-bottom: 5px; align-items: center;">
            <div>Название</div><div>Вес</div><div>Объём</div><div>Кол-во</div><div></div>
        </div>
        <div id="backpack-container"></div>
        <select id="backpack-add-template" class="form-control" style="margin-top:10px;" onchange="addBackpackItemFromTemplate(this.value)">
            <option value="">-- Добавить предмет (выберите) --</option>
        </select>
        <button type="button" class="btn btn-sm btn-secondary" onclick="addBackpackItemManual()">📝 Свой предмет</button>
    `;

    container.innerHTML = html;
    if (eq.belt?.templateId) {
        renderBeltPouchesNew(eq.belt.pouches || [], pouchTemplates, allTemplates);
    }
    if (eq.vest?.templateId) {
        renderVestPouchesNew(eq.vest.pouches || [], pouchTemplates, eq.vest.model === 'custom', eq.vest.totalCapacity, allTemplates);
    }
    const pocketsContainer = document.getElementById('pockets-container');
    if (pocketsContainer) {
        pocketsContainer.innerHTML = '';
        pockets.forEach((item, index) => {
            renderBackpackItem(migrateOldItemToNew(item), index, ['inventory', 'pockets'], pocketsContainer, allTemplates);
        });
    }
    const backpackItems = Array.isArray(inv.backpack)
        ? inv.backpack.map(item => migrateOldItemToNew(item))
        : [];
    renderBackpackNew(backpackItems, groupedByCategory, allTemplates);
    populateBackpackTemplateSelect();
    populatePocketsTemplateSelect();
    recalculateInventoryTotals();

    container.addEventListener('input', (e) => {
        const target = e.target;
        if (target.matches('input[name*="weight"], input[name*="volume"], input[name*="quantity"]')) {
            updateDataFromFields();
            recalculateInventoryTotals();
            scheduleAutoSave();
        }
    });
}

function getItemByPath(pathArray) {
    let current = currentCharacterData;
    for (let i = 0; i < pathArray.length; i++) {
        const key = pathArray[i];
        if (current === null || current === undefined) return null;

        if (Array.isArray(current) && typeof key === 'number') {
            current = current[key];
        } else if (typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return null;
        }
    }
    return current;
}

function removeItemByPath(path) {
    let parent = currentCharacterData;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (Array.isArray(parent) && typeof key === 'number') parent = parent[key];
        else if (typeof parent === 'object' && key in parent) parent = parent[key];
        else return false;
    }
    const lastKey = path[path.length - 1];
    if (Array.isArray(parent) && typeof lastKey === 'number') {
        parent.splice(lastKey, 1);
        return true;
    }
    return false;
}

// Обновить поле предмета по пути
window.updateBackpackItemAtPath = function(pathStr, field, value) {
    const path = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    const item = getItemByPath(path);
    if (!item) return;

    if (field === 'quantity') {
        item.quantity = parseInt(value) || 1;
        if (item.category === 'ammo') {
            updateAmmoWeight(item);
        }
    } else if (field === 'name') {
        item.name = value;
    } else {
        item[field] = parseFloat(value) || 0;
    }

    recalculateInventoryTotals();
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.removeBackpackItemAtPath = function(pathStr) {
    const path = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    if (path.length === 0) return;

    // 1. Удаление из данных
    let parentData = currentCharacterData;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (Array.isArray(parentData) && typeof key === 'number') {
            parentData = parentData[key];
        } else if (typeof parentData === 'object' && key in parentData) {
            parentData = parentData[key];
        } else {
            return;
        }
    }
    const index = path[path.length - 1];
    if (!Array.isArray(parentData)) return;
    parentData.splice(index, 1);

    // 2. Удаление из DOM и обновление путей
    const itemDiv = document.querySelector(`[data-path="${pathStr}"]`);
    if (!itemDiv) {
        renderInventoryTab(currentCharacterData);
        recalculateInventoryTotals();
        scheduleAutoSave();
        forceSyncCharacter();
        return;
    }

    const containerDiv = itemDiv.parentNode;
    const containerPath = path.slice(0, -1);
    itemDiv.remove();

    // Обновляем data-path у оставшихся элементов в контейнере
    const remainingItems = Array.from(containerDiv.children).filter(el => el.hasAttribute('data-path'));
    remainingItems.forEach((el, idx) => {
        const newPath = containerPath.concat(idx).join(',');
        el.dataset.path = newPath;
        updateHandlersInElement(el, containerPath, idx);
    });

    if (containerDiv.classList.contains('container-contents')) {
        updatePouchVolumeFromContentsDiv(containerDiv);
    }

    recalculateInventoryTotals();
    scheduleAutoSave();
    forceSyncCharacter();
};

async function addItemToContainerDirect(containerItem, contentsDiv, containerPath) {
    const existingSelect = contentsDiv.querySelector('.inline-template-select');
    if (existingSelect) existingSelect.remove();

    const select = document.createElement('select');
    select.className = 'form-control inline-template-select';
    select.style.marginTop = '5px';
    select.style.width = '100%';
    select.innerHTML = '<option value="">-- Выберите предмет --</option>';

    const allTemplates = await getAllItemTemplates();
    const categories = {};
    allTemplates.forEach(t => {
        if (!categories[t.category]) categories[t.category] = [];
        categories[t.category].push(t);
    });

    for (const [cat, templates] of Object.entries(categories)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = getCategoryDisplay(cat);
        templates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = `${t.name} (${t.effectiveWeight || t.weight} кг, ${t.effectiveVolume || t.volume} л)`;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    }

    select.onchange = async (e) => {
        const templateId = e.target.value;
        if (!templateId) { select.remove(); return; }
        const template = allTemplates.find(t => t.id == templateId);
        if (!template) { select.remove(); return; }

        const newItem = createItemFromTemplate(template);
        if (!Array.isArray(containerItem.contents)) containerItem.contents = [];
        containerItem.contents.push(newItem);

        const children = Array.from(contentsDiv.children);
        for (let child of children) {
            if (!child.classList.contains('inline-template-select') && !child.matches('button')) {
                child.remove();
            }
        }

        // При перерисовке используем загруженные allTemplates
        containerItem.contents.forEach((subItem, subIndex) => {
            renderBackpackItem(subItem, subIndex, containerPath, contentsDiv, allTemplates);
        });

        const addBtn = contentsDiv.querySelector('button');
        if (addBtn && contentsDiv.lastChild !== addBtn) {
            contentsDiv.appendChild(addBtn);
        }

        select.remove();
        recalculateInventoryTotals();

        if (containerPath.length >= 2) {
            const pouchParentPath = containerPath.slice(0, -1);
            const pouchDiv = document.querySelector(`[data-path="${pouchParentPath.join(',')}"]`);
            if (pouchDiv) {
                const infoSpan = pouchDiv.querySelector('span[data-volume-info]');
                if (infoSpan) {
                    const pouch = getItemByPath(pouchParentPath);
                    if (pouch) {
                        const used = calculatePouchUsedVolume(pouch);
                        const internalLimit = pouch.internalVolume || pouch.capacity;
                        infoSpan.textContent = `📦 ${used} / ${internalLimit} л`;
                    }
                }
            }
        }

        scheduleAutoSave();
    };

    const addButton = contentsDiv.querySelector('button');
    if (addButton && addButton.parentNode === contentsDiv) {
        contentsDiv.insertBefore(select, addButton);
    } else {
        contentsDiv.appendChild(select);
    }
}

function updateHandlersInElement(element, basePath, index) {
    const newPath = basePath.concat(index).join(',');
    // Кнопка удаления (крестик)
    const delBtn = element.querySelector('.btn-danger');
    if (delBtn) {
        delBtn.onclick = () => removeBackpackItemAtPath(newPath);
    }
    // Поля ввода (вес, объём, количество, название)
    element.querySelectorAll('input').forEach(input => {
        const placeholder = input.placeholder;
        let field = null;
        if (placeholder === 'Вес') field = 'weight';
        else if (placeholder === 'Объём') field = 'volume';
        else if (placeholder === 'Кол-во') field = 'quantity';
        else if (input.type === 'text') field = 'name';

        if (field) {
            input.onchange = (e) => updateBackpackItemAtPath(newPath, field, e.target.value);
        }
    });
    // Кнопки сворачивания и добавления внутрь используют замыкания с путём, их трогать не нужно — они продолжат работать,
    // так как ссылаются на объект item, а не на путь в виде строки.
}

function renderBeltPouchesNew(pouches, pouchTemplates, allTemplates) {
    const container = document.getElementById('belt-pouches-container');
    if (!container) return;
    container.innerHTML = '';
    if (!pouches || pouches.length === 0) {
        container.innerHTML = '<p>Нет подсумков</p>';
        return;
    }
    pouches.forEach((pouch, index) => {
        renderPouchItem(pouch, index, ['equipment', 'belt', 'pouches', index], container, pouchTemplates, allTemplates);
    });
}

function renderVestPouchesNew(pouches, pouchTemplates, isCustom, totalCapacity, allTemplates) {
    const container = document.getElementById('vest-pouches-container');
    if (!container) return;
    container.innerHTML = '';
    if (!pouches || pouches.length === 0) {
        container.innerHTML = '<p>Нет подсумков</p>';
        return;
    }
    pouches.forEach((pouch, index) => {
        renderVestPouchItem(pouch, index, ['equipment', 'vest', 'pouches', index], container, pouchTemplates, isCustom, allTemplates);
    });
}

function renderPouchItem(pouch, index, path, parentContainer, pouchTemplates, allTemplates) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'container-item';
    itemDiv.style.marginBottom = '8px';
    itemDiv.style.padding = '8px';
    itemDiv.style.border = '1px solid #666';
    itemDiv.style.borderRadius = '4px';
    itemDiv.style.backgroundColor = 'rgba(0,0,0,0.2)';
    itemDiv.dataset.path = path.join(',');

    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '2fr 1fr auto';
    row.style.gap = '10px';
    row.style.alignItems = 'center';

    // Иконка сворачивания + селект
    const leftWrapper = document.createElement('div');
    leftWrapper.style.display = 'flex';
    leftWrapper.style.alignItems = 'center';
    leftWrapper.style.gap = '5px';

    const toggleIcon = document.createElement('span');
    toggleIcon.textContent = '▶';
    toggleIcon.style.cursor = 'pointer';
    toggleIcon.style.userSelect = 'none';
    leftWrapper.appendChild(toggleIcon);

    const select = document.createElement('select');
    select.className = 'form-control';
    select.innerHTML = '<option value="">-- Выберите подсумок --</option>';
    pouchTemplates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name;
        if (pouch.type == t.id) option.selected = true;
        select.appendChild(option);
    });
    select.onchange = () => {
        const template = pouchTemplates.find(t => t.id == select.value);
        if (template) {
            pouch.type = template.id;
            pouch.capacity = template.volume || 0;
            pouch.name = template.name;
            renderInventoryTab(currentCharacterData);
            scheduleAutoSave();
        }
    };
    leftWrapper.appendChild(select);
    row.appendChild(leftWrapper);

    const infoSpan = document.createElement('span');
    infoSpan.dataset.volumeInfo = '';
    const used = calculatePouchUsedVolume(pouch);
    const internalLimit = pouch.internalVolume || pouch.capacity;
    infoSpan.textContent = `📦 ${used} / ${internalLimit} л`;
    row.appendChild(infoSpan);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = '✕';
    delBtn.onclick = () => {
        const parentArray = currentCharacterData.equipment.belt.pouches;
        parentArray.splice(index, 1);
        renderInventoryTab(currentCharacterData);
        scheduleAutoSave();
    };
    row.appendChild(delBtn);
    itemDiv.appendChild(row);

    // Содержимое
    const contentsDiv = document.createElement('div');
    contentsDiv.className = 'container-contents';
    contentsDiv.style.marginLeft = '20px';
    contentsDiv.style.marginTop = '10px';
    contentsDiv.style.paddingLeft = '10px';
    contentsDiv.style.borderLeft = '2px dashed #666';
    contentsDiv.style.display = 'none';

    if (pouch.contents && pouch.contents.length > 0) {
        pouch.contents.forEach((subItem, subIndex) => {
            renderBackpackItem(subItem, subIndex, path.concat('contents'), contentsDiv, allTemplates);
        });
    }

    const pouchTemplate = pouchTemplates.find(t => t.id == pouch.type);
    const hasArmorPlateSlot = pouchTemplate?.attributes?.slots?.some(s => s.type === 'armor_plate');

    if (!hasArmorPlateSlot) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-sm btn-secondary';
        addBtn.textContent = '➕ Добавить внутрь';
        addBtn.onclick = () => addItemToContainerDirect(pouch, contentsDiv, path.concat('contents'));
        contentsDiv.appendChild(addBtn);
    }

    itemDiv.appendChild(contentsDiv);

    toggleIcon.onclick = () => {
        if (contentsDiv.style.display === 'none') {
            contentsDiv.style.display = 'block';
            toggleIcon.textContent = '▼';
        } else {
            contentsDiv.style.display = 'none';
            toggleIcon.textContent = '▶';
        }
    };

    // Универсальное отображение слотов предмета
    if (getItemSlots(pouch).length > 0) {
        const slotsHtml = renderSlotsUniversal(pouch, path, 1);
        if (slotsHtml) {
            const slotsDiv = document.createElement('div');
            slotsDiv.className = 'item-slots-container';
            slotsDiv.style.marginTop = '8px';
            slotsDiv.style.marginLeft = '20px';
            slotsDiv.innerHTML = slotsHtml;
            itemDiv.appendChild(slotsDiv);
        }
    }

    parentContainer.appendChild(itemDiv);
}

function renderVestPouchItem(pouch, index, path, parentContainer, pouchTemplates, isCustom, allTemplates) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'container-item';
    itemDiv.style.marginBottom = '8px';
    itemDiv.style.padding = '8px';
    itemDiv.style.border = '1px solid #666';
    itemDiv.style.borderRadius = '4px';
    itemDiv.style.backgroundColor = 'rgba(0,0,0,0.2)';
    itemDiv.dataset.path = path.join(',');

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';

    // Левая часть с иконкой и селектом
    const leftWrapper = document.createElement('div');
    leftWrapper.style.display = 'flex';
    leftWrapper.style.alignItems = 'center';
    leftWrapper.style.gap = '5px';
    leftWrapper.style.flex = '1';

    const toggleIcon = document.createElement('span');
    toggleIcon.textContent = '▶';
    toggleIcon.style.cursor = 'pointer';
    toggleIcon.style.userSelect = 'none';
    leftWrapper.appendChild(toggleIcon);

    const select = document.createElement('select');
    select.className = 'form-control';
    select.disabled = !isCustom;
    select.style.flex = '1';
    select.innerHTML = '<option value="">-- Выберите подсумок --</option>';
    pouchTemplates.forEach(t => {
        const option = document.createElement('option');
        option.value = t.id;
        option.textContent = t.name;
        if (pouch.type == t.id) option.selected = true;
        select.appendChild(option);
    });
    select.onchange = () => {
        if (!isCustom) return;
        const template = pouchTemplates.find(t => t.id == select.value);
        if (template) {
            pouch.type = template.id;
            pouch.capacity = template.volume || 0;
            pouch.name = template.name;
            renderInventoryTab(currentCharacterData);
            scheduleAutoSave();
        }
    };
    leftWrapper.appendChild(select);
    row.appendChild(leftWrapper);

    const infoSpan = document.createElement('span');
    infoSpan.dataset.volumeInfo = '';
    const used = calculatePouchUsedVolume(pouch);
    const internalLimit = pouch.internalVolume || pouch.capacity;
    infoSpan.textContent = `📦 ${used} / ${internalLimit} л`;
    infoSpan.style.whiteSpace = 'nowrap';
    row.appendChild(infoSpan);

    // Кнопка удаления ТОЛЬКО для кастомной разгрузки
    if (isCustom) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-sm btn-danger';
        delBtn.textContent = '✕';
        delBtn.style.flexShrink = '0';
        delBtn.onclick = () => {
            const parentArray = currentCharacterData.equipment.vest.pouches;
            parentArray.splice(index, 1);
            renderInventoryTab(currentCharacterData);
            scheduleAutoSave();
        };
        row.appendChild(delBtn);
    }
    itemDiv.appendChild(row);

    // Содержимое
    const contentsDiv = document.createElement('div');
    contentsDiv.className = 'container-contents';
    contentsDiv.style.marginLeft = '20px';
    contentsDiv.style.marginTop = '10px';
    contentsDiv.style.paddingLeft = '10px';
    contentsDiv.style.borderLeft = '2px dashed #666';
    contentsDiv.style.display = 'none';

    if (pouch.contents && pouch.contents.length > 0) {
        pouch.contents.forEach((subItem, subIndex) => {
            renderBackpackItem(subItem, subIndex, path.concat('contents'), contentsDiv, allTemplates);
        });
    }

    const pouchTemplate = pouchTemplates.find(t => t.id == pouch.type);
    const hasArmorPlateSlot = pouchTemplate?.attributes?.slots?.some(s => s.type === 'armor_plate');

    if (!hasArmorPlateSlot) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'btn btn-sm btn-secondary';
        addBtn.textContent = '➕ Добавить внутрь';
        addBtn.onclick = () => addItemToContainerDirect(pouch, contentsDiv, path.concat('contents'));
        contentsDiv.appendChild(addBtn);
    }

    itemDiv.appendChild(contentsDiv);

    toggleIcon.onclick = () => {
        if (contentsDiv.style.display === 'none') {
            contentsDiv.style.display = 'block';
            toggleIcon.textContent = '▼';
        } else {
            contentsDiv.style.display = 'none';
            toggleIcon.textContent = '▶';
        }
    };

    if (getItemSlots(pouch).length > 0) {
        const slotsHtml = renderSlotsUniversal(pouch, path, 1);
        if (slotsHtml) {
            const slotsDiv = document.createElement('div');
            slotsDiv.className = 'item-slots-container';
            slotsDiv.style.marginTop = '8px';
            slotsDiv.style.marginLeft = '20px';
            slotsDiv.innerHTML = slotsHtml;
            itemDiv.appendChild(slotsDiv);
        }
    }

    parentContainer.appendChild(itemDiv);
}

function updatePouchVolumeFromContentsDiv(contentsDiv) {
    const pouchDiv = contentsDiv.closest('.container-item');
    if (!pouchDiv) return;
    const infoSpan = pouchDiv.querySelector('span[data-volume-info]');
    if (!infoSpan) return;

    // Получаем путь из data-path
    const pathStr = pouchDiv.dataset.path;
    if (!pathStr) return;
    const containerPath = pathStr.split(',').map(p => isNaN(p) ? p : parseInt(p));
    const pouch = getItemByPath(containerPath);
    if (!pouch) return;

    const used = calculatePouchUsedVolume(pouch);
    const internalLimit = pouch.internalVolume || pouch.capacity;
    infoSpan.textContent = `📦 ${used} / ${internalLimit} л`;
}

// ========== МОДАЛЬНОЕ ОКНО ДЛЯ СОЗДАНИЯ ПРЕДМЕТА В ИНВЕНТАРЕ ==========
let currentItemCategory = 'consumable'; // по умолчанию

function showItemCategoryFields() {
    document.getElementById('consumable-fields').style.display = 'none';
    document.getElementById('material-fields').style.display = 'none';
    document.getElementById('artifact-fields').style.display = 'none';

    if (currentItemCategory === 'consumable') {
        document.getElementById('consumable-fields').style.display = 'block';
    } else if (currentItemCategory === 'material') {
        document.getElementById('material-fields').style.display = 'block';
    } else if (currentItemCategory === 'artifact') {
        document.getElementById('artifact-fields').style.display = 'block';
    }
}

window.openCreateInventoryItemModal = function() {
    let modal = document.getElementById('create-inventory-item-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-inventory-item-modal';
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-inventory-item-modal').style.display='none'">&times;</span>
                <h3>Создать кастомный предмет</h3>
                <div class="form-group">
                    <label>Категория</label>
                    <select id="item-category-select" class="form-control" onchange="window.itemCategoryChanged(this)">
                        <option value="consumable">Расходник</option>
                        <option value="material">Материал</option>
                        <option value="artifact">Артефакт</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Название</label>
                    <input type="text" id="item-name" class="form-control">
                </div>

                <!-- Поля для расходника -->
                <div id="consumable-fields" style="display: block;">
                    <div class="form-group">
                        <label>Вес</label>
                        <input type="number" id="consumable-weight" class="form-control number-input" value="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label>Объём</label>
                        <input type="number" id="consumable-volume" class="form-control number-input" value="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label>Количество использований</label>
                        <input type="number" id="consumable-uses" class="form-control number-input" value="1">
                    </div>
                    <div class="form-group">
                        <label>Эффекты</label>
                        <div id="consumable-effects-container"></div>
                        <button type="button" class="btn btn-sm btn-primary" onclick="addEffectToModal('consumable')">+ Добавить эффект</button>
                    </div>
                </div>

                <!-- Поля для материала -->
                <div id="material-fields" style="display: none;">
                    <div class="form-group">
                        <label>Вес</label>
                        <input type="number" id="material-weight" class="form-control number-input" value="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label>Объём</label>
                        <input type="number" id="material-volume" class="form-control number-input" value="0" step="0.1">
                    </div>
                </div>

                <div id="artifact-fields" style="display: none;">
                    <div class="form-group">
                        <label>Вес</label>
                        <input type="number" id="artifact-weight" class="form-control number-input" value="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label>Объём</label>
                        <input type="number" id="artifact-volume" class="form-control number-input" value="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label>Эффекты</label>
                        <div id="artifact-effects-container"></div>
                        <button type="button" class="btn btn-sm btn-primary" onclick="addEffectToModal('artifact')">+ Добавить эффект</button>
                    </div>
                </div>

                <div class="form-actions">
                    <button class="btn btn-primary" onclick="saveInventoryItemTemplate()">Сохранить</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('create-inventory-item-modal').style.display='none'">Отмена</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    // Сброс на категорию по умолчанию
    document.getElementById('item-category-select').value = 'consumable';
    window.itemCategoryChanged(document.getElementById('item-category-select'));
    const consumableContainer = document.getElementById('consumable-effects-container');
    if (consumableContainer) consumableContainer.innerHTML = '';
    const artifactContainer = document.getElementById('artifact-effects-container');
    if (artifactContainer) artifactContainer.innerHTML = '';
    modal.style.display = 'flex';
};

window.addEffectToModal = function(type) {
    const container = document.getElementById(`${type}-effects-container`);
    const div = document.createElement('div');
    div.className = 'effect-item';
    div.style.display = 'flex';
    div.style.gap = '8px';
    div.style.marginBottom = '8px';
    div.style.alignItems = 'center';

    div.innerHTML = `
        <select class="form-control effect-category" style="width: 160px;">
            <optgroup label="Основные эффекты">
                <option value="Исцеление">Исцеление</option>
                <option value="Урон">Урон</option>
                <option value="Защита">Защита</option>
                <option value="Характеристика">Характеристика</option>
                <option value="Радиация">Радиация</option>
                <option value="Статус">Статус</option>
            </optgroup>
            <optgroup label="Другое">
                <option value="__custom__">✨ Свой</option>
            </optgroup>
        </select>
        <input type="text" class="form-control effect-value" placeholder="Значение (например, +5 HP)" style="flex: 2;">
        <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(div);

    const categorySelect = div.querySelector('.effect-category');
    const valueInput = div.querySelector('.effect-value');

    categorySelect.addEventListener('change', function() {
        if (this.value === '__custom__') {
            const customInput = document.createElement('input');
            customInput.type = 'text';
            customInput.className = 'form-control effect-custom-category';
            customInput.placeholder = 'Введите тип эффекта';
            customInput.style.width = '160px';
            customInput.style.marginRight = '8px';
            this.parentNode.insertBefore(customInput, this);
            this.style.display = 'none';
        }
    });
};

window.itemCategoryChanged = function(select) {
    currentItemCategory = select.value;
    showItemCategoryFields();
};

window.saveInventoryItemTemplate = async function() {
    const name = document.getElementById('item-name').value;
    if (!name) {
        showNotification('Введите название');
        return;
    }

    let category, attributes;
    if (currentItemCategory === 'consumable') {
        category = 'consumable';
        const effects = [];
        const items = document.querySelectorAll('#consumable-effects-container .effect-item');
        items.forEach(item => {
            let type = '';
            const categorySelect = item.querySelector('.effect-category');
            const customInput = item.querySelector('.effect-custom-category');
            if (customInput && customInput.value) {
                type = customInput.value;
            } else if (categorySelect && categorySelect.value !== '__custom__') {
                type = categorySelect.value;
            }
            const value = item.querySelector('.effect-value').value;
            if (type && value) {
                effects.push({ type, value });
            }
        });
        attributes = {
            weight: parseFloat(document.getElementById('consumable-weight').value) || 0,
            volume: parseFloat(document.getElementById('consumable-volume').value) || 0,
            uses: parseInt(document.getElementById('consumable-uses').value) || 1,
            effects: effects
        };
    } else if (currentItemCategory === 'material') {
        category = 'crafting_material';
        attributes = {
            weight: parseFloat(document.getElementById('material-weight').value) || 0,
            volume: parseFloat(document.getElementById('material-volume').value) || 0
        };
    } else if (currentItemCategory === 'artifact') {
        category = 'artifact';
        const effects = [];
        const items = document.querySelectorAll('#artifact-effects-container .effect-item');
        items.forEach(item => {
            let type = '';
            const categorySelect = item.querySelector('.effect-category');
            const customInput = item.querySelector('.effect-custom-category');
            if (customInput && customInput.value) {
                type = customInput.value;
            } else if (categorySelect && categorySelect.value !== '__custom__') {
                type = categorySelect.value;
            }
            const value = item.querySelector('.effect-value').value;
            if (type && value) {
                effects.push({ type, value });
            }
        });
        attributes = {
            weight: parseFloat(document.getElementById('artifact-weight').value) || 0,
            volume: parseFloat(document.getElementById('artifact-volume').value) || 0,
            effects: effects
        };
    }

    const data = {
        name: name,
        category: category,
        subcategory: null,
        price: 0,
        weight: attributes.weight || 0,
        volume: attributes.volume || 0,
        attributes: attributes
    };

    try {
        await Server.createLobbyTemplate(currentLobbyId, data);
        clearAllTemplatesCache();
        await renderInventoryTab(currentCharacterData);
        document.getElementById('create-inventory-item-modal').style.display = 'none';
        showNotification('Предмет создан', 'success');
    } catch (err) {
        showNotification(err.message);
    }
};

function recalculateInventoryTotals() {
    const inv = currentCharacterData.inventory || {};
    const eq = currentCharacterData.equipment || {};

    // Рюкзак – только его собственное содержимое
    const backpackItems = Array.isArray(inv.backpack) ? inv.backpack.map(item => migrateOldItemToNew(item)) : [];
    const selectedBackpackId = inv.backpackModel ? parseInt(inv.backpackModel, 10) : null;
    const selectedBackpack = cachedBackpackTemplates.find(t => t.id === selectedBackpackId);
    const backpackLimit = selectedBackpack ? selectedBackpack.attributes?.limit || 0 : 0;
    const backpackWeightReduction = selectedBackpack ? selectedBackpack.attributes?.weight_reduction || 0 : 0;

    let totalWeight = 0;
    let totalVolume = 0;

    // Вес и объём из рюкзака (с учётом вложенности)
    backpackItems.forEach(item => {
        totalWeight += getTotalWeight(item);
        totalVolume += getTotalVolume(item);
    });

    // Карманы – отдельно, не прибавляем к рюкзаку
    const pockets = Array.isArray(inv.pockets) ? inv.pockets.map(item => migrateOldItemToNew(item)) : [];
    pockets.forEach(item => {
        totalWeight += getTotalWeight(item);
        totalVolume += getTotalVolume(item);
    });

    // Подсумки пояса и разгрузки – их содержимое добавляем к общему весу/объёму,
    const beltPouches = eq.belt?.pouches || [];
    const vestPouches = eq.vest?.pouches || [];
    [...beltPouches, ...vestPouches].forEach(pouch => {
        if (pouch.contents) {
            pouch.contents.forEach(item => {
                totalWeight += getTotalWeight(item);
                totalVolume += getTotalVolume(item);
            });
        }
    });

    // Экипированное оружие (огнестрельное и ближнего боя)
    const weapons = currentCharacterData.weapons || [];
    weapons.forEach(weapon => {
        totalWeight += getTotalWeight(weapon);
        totalVolume += getTotalVolume(weapon);
    });

    // Обновляем отображение общего веса и объёма
    const totalWeightSpan = document.getElementById('total-weight-display');
    if (totalWeightSpan) totalWeightSpan.textContent = totalWeight.toFixed(1);

    // Обновляем заполненность рюкзака (только из его содержимого)
    const backpackFillSpan = document.getElementById('backpack-fill-display');
    if (backpackFillSpan) {
        const backpackVolume = backpackItems.reduce((sum, item) => {
            const vol = getTotalVolume(item);
            return sum + (isNaN(vol) ? 0 : vol);
        }, 0);
        backpackFillSpan.textContent = `Заполнено: ${backpackVolume.toFixed(1)} / ${backpackLimit}`;
    }

    const movePenaltyFromWeight = Math.floor(totalWeight / 5);
    const movePenalty = Math.max(0, movePenaltyFromWeight - backpackWeightReduction);
    const movePenaltySpan = document.getElementById('move-penalty-display');
    if (movePenaltySpan) movePenaltySpan.textContent = movePenalty;

    // Заполненность карманов
    const pocketMaxVolume = inv.pocketMaxVolume || 10;
    const pocketFill = pockets.reduce((sum, item) => {
        const vol = getTotalVolume(item);
        return sum + (isNaN(vol) ? 0 : vol);
    }, 0);
    const pocketFillSpan = document.getElementById('pocket-fill-display');
    if (pocketFillSpan) pocketFillSpan.textContent = pocketFill.toFixed(1);
}

window.onBackpackModelChange = async function(select) {
    updateDataFromFields();
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    currentCharacterData.inventory.backpackModel = select.value;
    cachedBackpackTemplates = await loadTemplatesForLobby('backpack');
    recalculateInventoryTotals();
    scheduleAutoSave();
};

window.selectPocketItem = async function(index, selectedId) {
    const id = parseInt(selectedId, 10);
    if (isNaN(id)) return;

    const allTemplates = await getAllItemTemplates();
    const template = allTemplates.find(t => t.id === id);
    if (!template) return;

    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!Array.isArray(currentCharacterData.inventory.pockets)) {
        currentCharacterData.inventory.pockets = [];
    }

    const newItem = createItemFromTemplate(template);
    currentCharacterData.inventory.pockets[index] = newItem;

    await renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

window.openCreateBackpackTemplateModal = function(template = null) {
    let modal = document.getElementById('create-backpack-template-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'create-backpack-template-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-height: 80vh; overflow-y: auto;">
                <span class="close" onclick="document.getElementById('create-backpack-template-modal').style.display='none'">&times;</span>
                <h3>${template ? 'Редактировать' : 'Создать'} шаблон рюкзака</h3>
                <input type="hidden" id="backpack-template-id">
                <div class="form-group"><label>Название</label><input type="text" id="backpack-name" class="form-control"></div>
                <div class="form-group"><label>Объём (лимит)</label><input type="number" id="backpack-limit" class="form-control number-input" value="0"></div>
                <div class="form-group"><label>Снижение штрафа веса</label><input type="number" id="backpack-weightReduction" class="form-control number-input" value="0"></div>
                <div class="form-group"><label>Собственный вес</label><input type="number" id="backpack-self-weight" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-group"><label>Собственный объём</label><input type="number" id="backpack-self-volume" class="form-control number-input" value="0" step="0.1"></div>
                <div class="form-actions"><button class="btn btn-primary" onclick="saveBackpackTemplate()">Сохранить</button><button class="btn btn-secondary" onclick="document.getElementById('create-backpack-template-modal').style.display='none'">Отмена</button></div>
            </div>`;
        document.body.appendChild(modal);
    }
    if (template) {
        document.getElementById('backpack-template-id').value = template.id;
        document.getElementById('backpack-name').value = template.name || '';
        document.getElementById('backpack-limit').value = template.attributes?.limit || 0;
        document.getElementById('backpack-weightReduction').value = template.attributes?.weight_reduction || 0;
        document.getElementById('backpack-self-weight').value = template.weight || 0;
        document.getElementById('backpack-self-volume').value = template.volume || 0;
    } else {
        document.getElementById('backpack-template-id').value = '';
    }
    modal.style.display = 'flex';
};

window.saveBackpackTemplate = async function() {
    const id = document.getElementById('backpack-template-id').value;
    const name = document.getElementById('backpack-name').value.trim();
    if (!name) { showNotification('Введите название'); return; }
    const attributes = {
        limit: parseInt(document.getElementById('backpack-limit').value) || 0,
        weight_reduction: parseInt(document.getElementById('backpack-weightReduction').value) || 0
    };
    const data = {
        name, category: 'backpack', subcategory: null, price: 0,
        weight: parseFloat(document.getElementById('backpack-self-weight').value) || 0,
        volume: parseFloat(document.getElementById('backpack-self-volume').value) || 0,
        attributes
    };
    try {
        if (id) await Server.updateLobbyTemplate(currentLobbyId, id, data);
        else await Server.createLobbyTemplate(currentLobbyId, data);
        clearAllTemplatesCache();
        document.getElementById('create-backpack-template-modal').style.display = 'none';
        showNotification(id ? 'Шаблон обновлён' : 'Шаблон создан', 'success');
        if (currentCharacterData) await renderInventoryTab(currentCharacterData);
        if (typeof loadTemplatesForManager === 'function') {
            const active = document.querySelector('#templates-modal .tab-btn.active')?.dataset.cat;
            if (active === 'backpack') loadTemplatesForManager('backpack');
        }
    } catch (e) { showNotification(e.message); }
};

function renderBackpackNew(items, groupedByCategory, allTemplates) {
    const container = document.getElementById('backpack-container');
    if (!container) return;
    container.innerHTML = '';

    items.forEach((item, index) => {
        renderBackpackItem(item, index, ['inventory', 'backpack'], container, allTemplates);
    });
}

function renderBackpackItem(item, index, parentPath, parentContainer, allTemplates) {
    const itemDiv = document.createElement('div');
    itemDiv.style.marginBottom = '5px';
    itemDiv.style.padding = '5px';
    itemDiv.style.border = '1px solid #444';
    itemDiv.style.borderRadius = '4px';
    itemDiv.style.backgroundColor = 'rgba(0,0,0,0.2)';

    const itemPath = parentPath.concat(index);
    itemDiv.dataset.path = itemPath.join(',');

    const row = document.createElement('div');
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '2fr 1fr 1fr 1fr auto';
    row.style.gap = '5px';
    row.style.alignItems = 'center';

    // Ячейка названия
    let nameCell;
    if (item.templateId) {
        nameCell = document.createElement('strong');
        nameCell.textContent = item.name;
    } else {
        nameCell = document.createElement('input');
        nameCell.type = 'text';
        nameCell.className = 'form-control';
        nameCell.value = item.name || '';
        nameCell.placeholder = 'Название';
        nameCell.onchange = (e) => updateBackpackItemAtPath(itemPath.join(','), 'name', e.target.value);
    }

    const nameWrapper = document.createElement('div');
    nameWrapper.style.display = 'flex';
    nameWrapper.style.alignItems = 'center';

    if (item.isContainer) {
        const toggleIcon = document.createElement('span');
        toggleIcon.textContent = '▶';
        toggleIcon.style.cursor = 'pointer';
        toggleIcon.style.marginRight = '5px';
        toggleIcon.style.userSelect = 'none';
        nameWrapper.appendChild(toggleIcon);
        itemDiv._toggleIcon = toggleIcon;
    }
    nameWrapper.appendChild(nameCell);

    // Кнопка свойств (ⓘ)
    const hasProt = item.durability !== null && item.durability !== undefined;
    const hasMods = item.modifications && item.modifications.length > 0;
    const hasEffects = item.attributes?.effects && item.attributes.effects.length > 0;
    const hasMagazineDetails = item.category === 'magazine' && item.ammo?.length;
    if (hasProt || hasMods || hasEffects || hasMagazineDetails) {
        const infoBtn = document.createElement('button');
        infoBtn.type = 'button';
        infoBtn.className = 'btn btn-sm btn-secondary';
        infoBtn.textContent = 'ⓘ';
        infoBtn.title = 'Свойства';
        infoBtn.style.marginLeft = '5px';
        infoBtn.style.padding = '2px 6px';
        infoBtn.style.fontSize = '0.8rem';
        infoBtn.onclick = (e) => {
            e.stopPropagation();
            showItemDetailsModal(item);
        };
        nameWrapper.appendChild(infoBtn);
    }

    // Поля ввода
    const weightInput = document.createElement('input');
    weightInput.type = 'number';
    weightInput.className = 'form-control number-input';
    weightInput.value = item.weight || 0;
    weightInput.onchange = (e) => updateBackpackItemAtPath(itemPath.join(','), 'weight', e.target.value);

    const volumeInput = document.createElement('input');
    volumeInput.type = 'number';
    volumeInput.className = 'form-control number-input';
    volumeInput.value = item.volume || 0;
    volumeInput.onchange = (e) => updateBackpackItemAtPath(itemPath.join(','), 'volume', e.target.value);

    const qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.className = 'form-control number-input';
    qtyInput.value = item.quantity || 1;
    qtyInput.setAttribute('data-field', 'quantity');
    qtyInput.onchange = (e) => updateBackpackItemAtPath(itemPath.join(','), 'quantity', e.target.value);

    // Контейнер для кнопок действий
    const actionsDiv = document.createElement('div');
    actionsDiv.style.display = 'flex';
    actionsDiv.style.gap = '5px';
    actionsDiv.style.alignItems = 'center';
    actionsDiv.style.justifyContent = 'flex-end';

    // Кнопка удаления
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = '✕';
    delBtn.style.width = '28px';
    delBtn.style.height = '28px';
    delBtn.style.padding = '0';
    delBtn.style.fontSize = '14px';
    delBtn.style.lineHeight = '1';
    delBtn.onclick = () => removeBackpackItemAtPath(itemPath.join(','));
    actionsDiv.appendChild(delBtn);

    // Кнопка "Надеть"
    const equippableCategories = ['armor', 'helmet', 'gas_mask', 'weapon', 'melee_weapon', 'belt', 'vest', 'detector'];
    if (item.isEquippable || equippableCategories.includes(item.category)) {
        const equipBtn = document.createElement('button');
        equipBtn.type = 'button';
        equipBtn.className = 'btn btn-sm btn-primary';
        equipBtn.textContent = '↑';
        equipBtn.title = 'Надеть';
        equipBtn.style.width = '28px';
        equipBtn.style.height = '28px';
        equipBtn.style.padding = '0';
        equipBtn.style.fontSize = '14px';
        equipBtn.style.lineHeight = '1';
        equipBtn.onclick = (e) => {
            e.stopPropagation();
            const category = item.category;
            if (category === 'armor') {
                equipArmorFromInventory(itemPath);
            } else if (category === 'helmet') {
                equipHelmetFromInventory(itemPath);
            } else if (category === 'gas_mask') {
                equipGasMaskFromInventory(itemPath);
            } else if (category === 'weapon') {
                equipWeaponFromInventory(itemPath);
            } else if (category === 'belt') {
                equipBeltFromInventory(itemPath);
            } else if (category === 'vest') {
                equipVestFromInventory(itemPath);
            } else if (category === 'detector') {
                equipDetectorFromInventory(itemPath);
            } else if (category === 'melee_weapon') {
                equipMeleeWeaponFromInventory(itemPath);
            }
        }
        actionsDiv.appendChild(equipBtn);
    }

    // Кнопка "На пояс"
    if (item.category === 'helmet' || item.category === 'gas_mask') {
        const beltBtn = document.createElement('button');
        beltBtn.type = 'button';
        beltBtn.className = 'btn btn-sm btn-secondary';
        beltBtn.textContent = '↓';
        beltBtn.title = 'Поместить на пояс';
        beltBtn.style.width = '28px';
        beltBtn.style.height = '28px';
        beltBtn.style.padding = '0';
        beltBtn.style.fontSize = '14px';
        beltBtn.style.lineHeight = '1';
        beltBtn.onclick = (e) => {
            e.stopPropagation();
            equipToBeltFromInventory(itemPath);
        };
        actionsDiv.appendChild(beltBtn);
    }

    // Кнопка "Использовать" (кроме батареек)
    const usableCategories = ['consumable', 'grenade', 'device'];
    const isBattery = (item.category === 'device' && item.subcategory === 'battery');
    if ((usableCategories.includes(item.category) || item.attributes?.usable) && !isBattery) {
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'btn btn-sm btn-success';
        useBtn.textContent = '▶';
        useBtn.title = 'Использовать';
        useBtn.style.width = '28px';
        useBtn.style.height = '28px';
        useBtn.style.padding = '0';
        useBtn.style.fontSize = '14px';
        useBtn.style.lineHeight = '1';
        useBtn.onclick = (e) => {
            e.stopPropagation();
            useItem(item, itemPath);
        };
        actionsDiv.appendChild(useBtn);
    }

    // Собираем строку
    row.appendChild(nameWrapper);
    row.appendChild(weightInput);
    row.appendChild(volumeInput);
    row.appendChild(qtyInput);
    row.appendChild(actionsDiv);
    itemDiv.appendChild(row);

    // Универсальное отображение слотов предмета (батарейки, бронеплиты и т.д.)
    if (getItemSlots(item).length > 0) {
        const slotsHtml = renderSlotsUniversal(item, itemPath, 1);
        if (slotsHtml) {
            const slotsDiv = document.createElement('div');
            slotsDiv.className = 'item-slots-container';
            slotsDiv.style.marginTop = '8px';
            slotsDiv.style.marginLeft = '20px';
            slotsDiv.innerHTML = slotsHtml;
            itemDiv.appendChild(slotsDiv);
        }
    }

    // Магазин: отображение патронов
    if (item.category === 'magazine') {
        const cap = item.attributes?.capacity || 30;
        const total = item.ammo ? item.ammo.reduce((sum, a) => sum + a.quantity, 0) : 0;
        let ammoText = `Патроны: ${total}/${cap}`;
        if (item.ammo && item.ammo.length > 0) {
            ammoText += ` (${item.ammo.map(a => a.name).join(', ')})`;
        }
        const ammoControls = document.createElement('div');
        ammoControls.style.display = 'flex';
        ammoControls.style.alignItems = 'center';
        ammoControls.style.gap = '5px';
        ammoControls.style.marginTop = '5px';
        ammoControls.innerHTML = `
            <span style="min-width: 120px;">${ammoText}</span>
            <button type="button" class="btn btn-sm btn-secondary" onclick="changeMagazineAmmo('${itemPath.join(',')}', 1)">+1</button>
            <button type="button" class="btn btn-sm btn-secondary" onclick="changeMagazineAmmo('${itemPath.join(',')}', -1)">-1</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="reloadMagazineFromInventory('${itemPath.join(',')}')">Зарядить</button>
            <button type="button" class="btn btn-sm btn-danger" onclick="unloadMagazineToInventory('${itemPath.join(',')}')">Разрядить</button>
        `;
        itemDiv.appendChild(ammoControls);
    }

    // Контейнер (содержимое) – показывается для обычных контейнеров
    if (item.isContainer) {
        // Для подсумков с бронеплитами не показываем кнопку "Добавить внутрь" и содержимое
        const template = allTemplates?.find(t => t.id === item.templateId);
        const hasArmorPlateSlot = template?.attributes?.slots?.some(s => s.type === 'armor_plate');

        if (!hasArmorPlateSlot) {
            const contentsDiv = document.createElement('div');
            contentsDiv.className = 'container-contents';
            contentsDiv.style.marginLeft = '25px';
            contentsDiv.style.marginTop = '8px';
            contentsDiv.style.paddingLeft = '10px';
            contentsDiv.style.borderLeft = '2px dashed #666';
            contentsDiv.style.display = 'none';

            if (item.contents && item.contents.length > 0) {
                item.contents.forEach((subItem, subIndex) => {
                    renderBackpackItem(subItem, subIndex, itemPath.concat('contents'), contentsDiv, allTemplates);
                });
            }

            const addBtn = document.createElement('button');
            addBtn.type = 'button';
            addBtn.className = 'btn btn-sm btn-secondary';
            addBtn.textContent = '➕ Добавить внутрь';
            addBtn.onclick = () => addItemToContainerDirect(item, contentsDiv, itemPath.concat('contents'));
            contentsDiv.appendChild(addBtn);

            itemDiv.appendChild(contentsDiv);
            itemDiv._contentsDiv = contentsDiv;

            const toggleIcon = itemDiv._toggleIcon;
            if (toggleIcon) {
                toggleIcon.onclick = () => {
                    if (contentsDiv.style.display === 'none') {
                        contentsDiv.style.display = 'block';
                        toggleIcon.textContent = '▼';
                    } else {
                        contentsDiv.style.display = 'none';
                        toggleIcon.textContent = '▶';
                    }
                };
            }
        }
    }

    parentContainer.appendChild(itemDiv);
}

// Универсальное окно свойств предмета
function showItemDetailsModal(item) {
    if (!item) {
        console.warn('showItemDetailsModal: item is undefined');
        return;
    }

    let html = `<h3>${escapeHtml(item.name)}</h3>`;
    html += '<hr>';

    // Прочность
    if (item.durability != null && item.maxDurability != null) {
        html += `<p><strong>Прочность:</strong> ${item.durability} / ${item.maxDurability}</p>`;
    }

    // Защита
    if (item.protection) {
        const prot = item.protection;
        html += '<p><strong>Защита:</strong> ';
        html += `Физ: ${prot.physical || 0}, Хим: ${prot.chemical || 0}, Терм: ${prot.thermal || 0}, Элек: ${prot.electric || 0}, Рад: ${prot.radiation || 0}`;
        html += '</p>';
    }

    // Эффекты (если есть)
    if (item.attributes?.effects && Array.isArray(item.attributes.effects)) {
        html += '<p><strong>Эффекты:</strong><ul>';
        item.attributes.effects.forEach(eff => {
            html += `<li>${escapeHtml(eff.type)}: ${escapeHtml(eff.value)}</li>`;
        });
        html += '</ul></p>';
    }

    // Модификации
    if (item.modifications && item.modifications.length > 0) {
        html += '<p><strong>Модификации:</strong><ul>';
        item.modifications.forEach(mod => {
            html += `<li>${escapeHtml(mod.name)}</li>`;
        });
        html += '</ul></p>';
    }

    // Для магазина покажем патроны
    if (item.category === 'magazine' && item.ammo) {
        const total = item.ammo.reduce((sum, a) => sum + a.quantity, 0);
        const cap = item.attributes?.capacity || 0;
        html += `<p><strong>Патроны:</strong> ${total} / ${cap}`;
        if (item.ammo.length > 0) {
            html += '<ul>';
            item.ammo.forEach(a => {
                html += `<li>${escapeHtml(a.name)}: ${a.quantity}</li>`;
            });
            html += '</ul>';
        }
        html += '</p>';
    }

    // Закрываем старое окно, если есть
    const oldModal = document.getElementById('item-details-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'item-details-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            ${html}
            <div class="form-actions" style="margin-top:15px;">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Закрыть</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
}

async function populateBackpackTemplateSelect() {
    const select = document.getElementById('backpack-add-template');
    if (!select) return;

    const allTemplates = await getAllItemTemplates();
    select.innerHTML = '<option value="">-- Добавить предмет (выберите) --</option>';

    const categories = {};
    allTemplates.forEach(t => {
        if (!categories[t.category]) categories[t.category] = [];
        categories[t.category].push(t);
    });

    for (const [cat, templates] of Object.entries(categories)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = getCategoryDisplay(cat);
        templates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.name;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    }
}

window.updateBackpackItemField = function(index, field, value) {
    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    let items = currentCharacterData.inventory.backpack;
    if (!Array.isArray(items)) items = [];
    if (index >= items.length) return;

    const item = migrateOldItemToNew(items[index]);
    if (field === 'quantity') {
        item.quantity = parseInt(value) || 1;
    } else if (field === 'name') {
        item.name = value;
    } else {
        item[field] = parseFloat(value) || 0;
    }
    items[index] = item;
    recalculateInventoryTotals();
    scheduleAutoSave();
};

window.removeBackpackItemNew = function(index) {
    if (!currentCharacterData.inventory?.backpack) return;
    currentCharacterData.inventory.backpack.splice(index, 1);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

function removeItemFromInventory(itemId) {
    // Поиск по ID в рюкзаке (с вложенностью)
    const backpack = currentCharacterData.inventory?.backpack;
    if (Array.isArray(backpack)) {
        for (let i = 0; i < backpack.length; i++) {
            if (backpack[i].id === itemId) {
                backpack.splice(i, 1);
                return true;
            }
            if (backpack[i].contents && removeFromArrayById(backpack[i].contents, itemId)) {
                return true;
            }
        }
    }

    // Поиск в карманах (старый формат без id, ищем по templateId?)
    const pockets = currentCharacterData.inventory?.pockets;
    if (Array.isArray(pockets)) {
        for (let i = 0; i < pockets.length; i++) {
            const pocketItem = pockets[i];
            // Если у предмета есть id и он совпадает
            if (pocketItem.id === itemId) {
                pockets.splice(i, 1);
                return true;
            }
            // Для старых предметов без id — проверяем templateId?
            // Но нам нужно удалить конкретный экземпляр, поэтому будем полагаться на id.
            // Если id нет, значит предмет не мигрирован. Пропускаем.
        }
    }

    // Поиск в подсумках пояса
    const beltPouches = currentCharacterData.equipment?.belt?.pouches;
    if (Array.isArray(beltPouches)) {
        for (const pouch of beltPouches) {
            if (pouch.contents && removeFromArrayById(pouch.contents, itemId)) return true;
        }
    }

    // Поиск в подсумках разгрузки
    const vestPouches = currentCharacterData.equipment?.vest?.pouches;
    if (Array.isArray(vestPouches)) {
        for (const pouch of vestPouches) {
            if (pouch.contents && removeFromArrayById(pouch.contents, itemId)) return true;
        }
    }

    return false;
}

function removeFromArrayById(arr, id) {
    for (let i = 0; i < arr.length; i++) {
        if (arr[i].id === id) {
            arr.splice(i, 1);
            return true;
        }
        if (arr[i].contents && removeFromArrayById(arr[i].contents, id)) return true;
    }
    return false;
}

async function populatePocketsTemplateSelect() {
    const select = document.getElementById('pockets-add-template');
    if (!select) return;

    const allTemplates = await getAllItemTemplates();
    select.innerHTML = '<option value="">-- Добавить предмет (выберите) --</option>';

    const categories = {};
    allTemplates.forEach(t => {
        if (!categories[t.category]) categories[t.category] = [];
        categories[t.category].push(t);
    });

    for (const [cat, templates] of Object.entries(categories)) {
        const optgroup = document.createElement('optgroup');
        optgroup.label = getCategoryDisplay(cat);
        templates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.name;
            optgroup.appendChild(option);
        });
        select.appendChild(optgroup);
    }
}

window.addPocketItemFromTemplate = async function(templateId) {
    if (!templateId) return;
    const allTemplates = await getAllItemTemplates();
    const template = allTemplates.find(t => t.id == templateId);
    if (!template) return;

    const newItem = createItemFromTemplate(template);

    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!Array.isArray(currentCharacterData.inventory.pockets)) {
        currentCharacterData.inventory.pockets = [];
    }
    currentCharacterData.inventory.pockets.push(newItem);

    await renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    document.getElementById('pockets-add-template').value = '';
};

window.addPocketItemManual = function() {
    const newItem = {
        id: generateItemId(),
        templateId: null,
        name: 'Новый предмет',
        category: 'misc',
        quantity: 1,
        weight: 0,
        volume: 0,
        price: 0,
        attributes: {},
        installedModules: [],
        contents: [],
        isContainer: false,
        isEquippable: false,
        isStackable: false
    };

    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!Array.isArray(currentCharacterData.inventory.pockets)) {
        currentCharacterData.inventory.pockets = [];
    }
    currentCharacterData.inventory.pockets.push(newItem);
    renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
};

function calculateStageDurability(baseDurability, material) {
    const coefficient = MATERIAL_COEFFICIENTS[material] || 1;
    return Math.floor(10 * coefficient * baseDurability);
}

function initArmorStagedDurability(armor, template) {
    const baseDur = template.attributes?.max_durability || 100;
    armor.durability = baseDur;
    armor.maxDurability = baseDur;
    armor.material = template.attributes?.material || 'Текстиль';
    armor.stage = 1;
    armor.stageDurability = calculateStageDurability(armor.durability, armor.material);
    armor.currentStageDurability = armor.stageDurability;   // <-- инициализируем

    const stageNames = ['1. Целая', '2. Немного повреждена', '3. Повреждена', '4. Сильно повреждена', '5. Поломана'];
    armor.condition = stageNames[armor.stage - 1];
}

// ========== 7. ВКЛАДКА "ЗАМЕТКИ" ==========
function renderNotesTab(data) {
    const container = document.getElementById('sheet-tab-notes');
    container.innerHTML = `
        <div class="form-group">
            <label>Журнал заметок</label>
            <textarea class="form-control" name="notes" rows="20" style="width:100%;">${escapeHtml(data.notes || '')}</textarea>
        </div>
    `;
}

// ========== 8. ВКЛАДКА "НАСТРОЙКИ" ==========
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
    Server.setCharacterVisibility(currentCharacterId, visibleTo)
        .then(() => showNotification('Видимость обновлена', 'success'))
        .catch(err => showNotification(err.message));
};

window.deleteCharacterFromSheet = function() {
    if (!confirm('Удалить персонажа?')) return;
    Server.deleteCharacter(currentCharacterId)
        .then(() => {
            showNotification('Персонаж удалён', 'success');
            closeCharacterSheet();
            import('./characters.js').then(module => module.loadLobbyCharacters());
        })
        .catch(err => showNotification(err.message));
};

// ========== 9. ПУБЛИЧНЫЕ ФУНКЦИИ ==========
export async function openCharacterSheet(characterId) {
    currentCharacterId = characterId;
    try {
        const character = await Server.getCharacter(characterId);
        currentCharacterData = character.data || {};

        migratePouchesToNewFormat();

        function ensureSkillXp(data) {
            if (!data.skills) data.skills = {};
            const skills = data.skills;
            const categories = ['physical', 'social', 'other'];
            for (const cat of categories) {
                if (!skills[cat]) skills[cat] = {};
                for (const skill of Object.values(skills[cat])) {
                    if (skill.xp === undefined) skill.xp = 0;
                }
            }
            if (skills.skillPoints === undefined) skills.skillPoints = 30;

            const weaponKeys = ['pistols', 'shotguns', 'smgs', 'assaultRifles', 'sniperRifles', 'grenadeLaunchers', 'machineGuns'];
            if (!skills.specialized) skills.specialized = {};
            for (const key of weaponKeys) {
                if (!skills.specialized[key]) skills.specialized[key] = { level: 'unfamiliar', xp: 0 };
                if (skills.specialized[key].xp === undefined) skills.specialized[key].xp = 0;
            }
        }
        ensureSkillXp(currentCharacterData);

        currentCharacterData.ownerId = character.owner_id;
        currentCharacterData.ownerUsername = character.owner_username;
        currentCharacterData.visible_to = character.visible_to || [];
        await getAllItemTemplates();
        await renderCharacterSheet(character.name, currentCharacterData);
        document.getElementById('character-sheet-modal').style.display = 'flex';

        const socket = getSocket();
        if (socket) {
            socket.emit('join_character', { token: localStorage.getItem('access_token'), character_id: characterId });
            socket.off('character_data_updated');
            socket.on('character_data_updated', (data) => {
                if (data.character_id === currentCharacterId && data.updated_by !== parseInt(localStorage.getItem('user_id'))) {
                    currentCharacterData = data.updates.data || currentCharacterData;

                    // Принудительно обновляем инвентарь и экипировку (они всегда в DOM)
                    renderInventoryTab(currentCharacterData);
                    renderEquipmentTab(currentCharacterData);

                    // Обновляем активную вкладку для немедленного отображения
                    const activeTab = document.querySelector('#sheet-tabs .tab-btn.active')?.dataset.tab;
                    if (activeTab === 'basic') renderBasicTab(currentCharacterData);
                    else if (activeTab === 'skills') renderSkillsTab(currentCharacterData);
                    else if (activeTab === 'settings') renderSettingsTab(currentCharacterData);
                    else if (activeTab === 'notes') renderNotesTab(currentCharacterData);

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
    const parts = skillPath.split('.');
    let skillObj = currentCharacterData.skills;
    for (const part of parts) {
        if (!skillObj) break;
        skillObj = skillObj[part];
    }
    if (!skillObj) return;
    const base = skillObj.base;
    const selfMod = typeof base === 'number' ? Math.floor((base - 10) / 2) : 0;
    let charismaMod = 0;
    if (skillPath.startsWith('social.') && skillPath !== 'social.charisma') {
        const charisma = currentCharacterData.skills?.social?.charisma;
        const charismaBase = charisma?.base;
        charismaMod = typeof charismaBase === 'number' ? Math.floor((charismaBase - 10) / 2) : 0;
    }
    const bonus = skillObj.bonus || 0;
    const dice = Math.floor(Math.random() * 20) + 1;
    const total = dice + selfMod + charismaMod + bonus;
    let modStr = `модификатор навыка = ${selfMod}`;
    if (charismaMod !== 0) modStr += ` + харизма = ${charismaMod}`;
    if (bonus !== 0) modStr += ` + бонус = ${bonus}`;
    showNotification(`🎲 ${skillLabel}: бросок к20 = ${dice}, ${modStr}, итог = ${total}`, 'system');
    const socket = getSocket();
    if (socket && currentLobbyId) {
        const message = `🎲 ${skillLabel}: бросок к20 = ${dice}, ${modStr}, итог = **${total}**`;
        socket.emit('send_message', {
            token: localStorage.getItem('access_token'),
            lobby_id: currentLobbyId,
            message: message
        });
    }
};

// ========== УНИВЕРСАЛЬНЫЕ ОБЁРТКИ ДЛЯ СЛОТОВ ==========

// Запрос на установку модуля в слот – показывает модальное окно выбора.
window.universalInstallModulePrompt = async function(targetPath, slotType) {
    const targetItem = getItemByPath(targetPath);
    if (!targetItem) {
        showNotification('Целевой предмет не найден');
        return;
    }

    // Сбор подходящих модулей из инвентаря (любая категория, важен slot_type)
    const candidateModules = [];
    const collect = (items, path) => {
        if (!Array.isArray(items)) return;
        items.forEach((it, idx) => {
            // Определяем, подходит ли предмет по типу слота
            let matches = false;
            if (slotType === 'battery') {
                // Батарейка: категория device, подкатегория battery
                matches = (it.category === 'device' && it.subcategory === 'battery');
            } else if (slotType === 'filter') {
                // Фильтр: категория gas_mask_module, атрибут slot_type === 'filter'
                matches = (it.category === 'gas_mask_module' && it.attributes?.slot_type === 'filter');
            } else {
                // Остальные модули: проверяем slot_type в корне или в attributes
                matches = (it.slot_type === slotType) || (it.attributes?.slot_type === slotType);
            }
            if (matches) {
                candidateModules.push({ item: it, path: path.concat(idx) });
            }
            if (it.contents) collect(it.contents, path.concat(idx, 'contents'));
        });
    };

    collect(currentCharacterData.inventory?.backpack, ['inventory', 'backpack']);
    collect(currentCharacterData.inventory?.pockets, ['inventory', 'pockets']);
    const beltPouches = currentCharacterData.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, i) => collect(pouch.contents, ['equipment', 'belt', 'pouches', i, 'contents']));
    const vestPouches = currentCharacterData.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, i) => collect(pouch.contents, ['equipment', 'vest', 'pouches', i, 'contents']));

    if (candidateModules.length === 0) {
        showNotification('Нет подходящих модулей в инвентаре');
        return;
    }

    // Создаём модальное окно выбора
    const oldModal = document.getElementById('universal-module-select-modal');
    if (oldModal) oldModal.remove();

    const modal = document.createElement('div');
    modal.id = 'universal-module-select-modal';
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Выберите модуль</h3>
            <select id="universal-module-select" class="form-control" size="5"></select>
            <div class="form-actions" style="margin-top:15px;">
                <button class="btn btn-primary" id="confirm-universal-module">Установить</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const select = modal.querySelector('#universal-module-select');
    candidateModules.forEach((entry, idx) => {
        const opt = document.createElement('option');
        opt.value = idx;
        let desc = entry.item.name;
        if (slotType === 'filter') {
            const dur = entry.item.attributes?.durability || 0;
            const maxDur = entry.item.attributes?.max_durability || 0;
            desc += ` (прочность ${dur}/${maxDur})`;
        } else if (slotType === 'battery') {
            const power = entry.item.attributes?.power;
            desc += ` (заряд ${power !== undefined ? power : '?'}%)`;
        }
        opt.textContent = desc;
        select.appendChild(opt);
    });

    modal.querySelector('#confirm-universal-module').onclick = () => {
        const idx = select.value;
        if (idx === '') return;
        const selected = candidateModules[idx];
        modal.remove();

        if (universalInstallModule(targetItem, targetPath, selected.item, selected.path, slotType)) {
            renderInventoryTab(currentCharacterData);
            renderEquipmentTab(currentCharacterData);
            scheduleAutoSave();
            forceSyncCharacter();
            showNotification('Модуль установлен', 'success');
        } else {
            showNotification('Не удалось установить модуль');
        }
    };

    modal.style.display = 'flex';
};

// Снятие модуля по строковому пути.
window.universalUninstallModuleByPath = function(targetPath, slotType) {
    const targetItem = getItemByPath(targetPath);
    if (!targetItem) {
        showNotification('Предмет не найден');
        return;
    }

    if (universalUninstallModule(targetItem, targetPath, slotType)) {
        renderInventoryTab(currentCharacterData);
        renderEquipmentTab(currentCharacterData);
        scheduleAutoSave();
        forceSyncCharacter();
        showNotification('Модуль снят', 'success');
    } else {
        showNotification('Не удалось снять модуль');
    }
};

function universalUninstallModule(targetItem, targetPath, slotType) {
    if (!targetItem.installedModules) return false;
    const index = targetItem.installedModules.findIndex(m => m.slotType === slotType);
    if (index === -1) return false;

    const moduleItem = targetItem.installedModules[index];
    targetItem.installedModules.splice(index, 1);

    let restoredItem;
    const templateId = moduleItem.templateId;
    if (templateId) {
        const allTemplates = allTemplatesCache || [];
        const template = allTemplates.find(t => t.id === templateId);
        if (template) {
            restoredItem = createItemFromTemplate(template);
            restoredItem.durability = moduleItem.durability;
            restoredItem.maxDurability = moduleItem.maxDurability;
            restoredItem.installedModules = moduleItem.installedModules ? [...moduleItem.installedModules] : [];
            restoredItem.modifications = moduleItem.modifications ? [...moduleItem.modifications] : [];
            if (moduleItem.attributes) {
                restoredItem.attributes = { ...moduleItem.attributes };
            }
            if (moduleItem.attributes?.power !== undefined) {
                restoredItem.attributes.power = moduleItem.attributes.power;
            }
        } else {
            restoredItem = { ...moduleItem };
        }
    } else {
        restoredItem = { ...moduleItem };
    }

    const sourcePath = moduleItem.sourcePath;
    let restored = false;
    if (sourcePath) {
        restored = restoreItemToPath(restoredItem, sourcePath);
    }
    if (!restored) {
        addToBackpack(restoredItem);
    }
    return true;
}

window.installModuleFromSlot = function(jsonPath, slotType) {
    const targetPath = JSON.parse(jsonPath);
    universalInstallModulePrompt(targetPath, slotType);
};

window.uninstallModuleFromSlot = function(jsonPath, slotType) {
    const targetPath = JSON.parse(jsonPath);
    universalUninstallModuleByPath(targetPath, slotType);
};

function updatePlateProtectionDisplay() {
    const plateInfo = getEffectiveTorsoProtection();
    const vestDiv = document.querySelector('[data-vest-protection]');
    if (vestDiv) {
        if (plateInfo) {
            const frontText = plateInfo.front !== null ? `${plateInfo.front}%` : 'нет';
            const backText = plateInfo.back !== null ? `${plateInfo.back}%` : 'нет';
            vestDiv.innerHTML = `<strong>Бронеплиты:</strong> перед ${frontText}, спина ${backText}`;
        } else {
            vestDiv.innerHTML = ''; // или скрыть
        }
    }
}

// ========== 10. UI-ФУНКЦИИ ДОБАВЛЕНИЯ/УДАЛЕНИЯ ==========
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

const originalAdd = window.addBackpackItemFromTemplate;
window.addBackpackItemFromTemplate = async function(templateId) {
    if (!templateId) return;

    const allTemplates = await getAllItemTemplates();
    const template = allTemplates.find(t => t.id == templateId);
    if (!template) return;

    const newItem = createItemFromTemplate(template);

    // Определяем, куда добавлять
    let targetArray;
    if (window._tempContainerPath) {
        const container = getItemByPath(window._tempContainerPath);
        if (container && container.isContainer) {
            if (!Array.isArray(container.contents)) container.contents = [];
            targetArray = container.contents;
        }
        window._tempContainerPath = null;
    } else {
        if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
        if (!Array.isArray(currentCharacterData.inventory.backpack)) {
            currentCharacterData.inventory.backpack = [];
        }
        targetArray = currentCharacterData.inventory.backpack;
    }

    targetArray.push(newItem);
    await renderInventoryTab(currentCharacterData);
    scheduleAutoSave();
    document.getElementById('backpack-add-template').value = '';
};

window.addBackpackItemManual = function() {
    const newItem = {
        id: generateItemId(),
        templateId: null,
        name: 'Новый предмет',
        category: 'misc',
        quantity: 1,
        weight: 0,
        volume: 0,
        price: 0,
        attributes: {},
        installedModules: [],
        contents: [],
        isContainer: false,
        isEquippable: false,
        isStackable: false
    };

    if (!currentCharacterData.inventory) currentCharacterData.inventory = {};
    if (!Array.isArray(currentCharacterData.inventory.backpack)) {
        currentCharacterData.inventory.backpack = [];
    }
    currentCharacterData.inventory.backpack.push(newItem);
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

window.getAllItemTemplates = getAllItemTemplates;