// static/js/main.js
import { initSocket } from './socketHandlers.js';
import { initCharacters, initMutantForm, loadLobbyCharacters, showCreateCharacterForm, showCreateMutantForm } from './characters.js';
import { initLobbyData, loadLobbyInfo, loadAllChunks } from './lobbyData.js';
import { setCurrentLobbyId, toggleParticipants, toggleSettings, showSettingsTab, closeVisibilityModal,
saveVisibility, unbanUserHandler, closeSettings, openSettings, updateParticipantsList } from './ui.js';
import { initMapEdit, setEditMode, setBrushRadius, toggleEraserMode, applyBrush, openTileEditModal, closeTileEditModal,
 applyTerrainChange, applyHeightChange, addObjectToTile, clearObjectsFromTile, removeObjectFromTile, highlightObject,
 getEditMode, setBrushRadiusFromInput, setTileHeightFromInput, setEraserModeFromInput, updateTileEditHeight,
 updateObjectOffsetX, updateObjectOffsetZ, updateObjectScale, updateObjectRotation,
 applyNameChange, applyRadiationChange, updateTileEditRadiation, applyAnomalyFieldChange,
 updateAnomalyFieldRankOptions} from './mapEdit.js';
import { hideObjectHighlight, camera, getHoveredTile } from './lobby3d.js';
import { hideGlobalCanvas, showGlobalCanvas, controls as globalControls } from './lobby3d.js';
import { showNotification, getErrorMessage } from './utils.js';
import { Server } from './api.js';
import AppState, { initDraggablePanels, initHotkeys } from './ui_interactions.js';
import { initWeather, applyWeather } from './weather.js';
import { initMarkers, setupMarkerInteraction, closeMarkerEditModal, saveMarkerEdit, submitCreateMarker,
openCreateMarkerModal, openCreateMarkerModalAtCenter, fillCenterCoordinates, deleteMarker,
fillEditCenterCoordinates, pickTileForMarker } from './markers.js';
import { openCharacterSheet, closeCharacterSheet, exportCharacter, importCharacter } from './characterSheet.js';
import { setCurrentLobbyId as setCharLobbyId } from './characterSheet.js';
import {
    initLocationScene, loadLocation, updateCharacterPosition, setCurrentLocationId, getCurrentLocationId,
    addDeleteLocationButton, setDeleteButtonVisible, addEditLocationButton, setEditButtonVisible, destroyLocationScene,
    setLocationBrushRadius, setLocationBrushHeight, setLocationBrushTerrain, setLocationEraserMode, setLocationEditMode,
    getLocationEditMode, getHoveredTileCoords, updateHighlightByCoords, setLocationBrushRadiation, setLocationBrushObjectMode,
    setLocationBrushObjectType, setLocationBrushObjectColor, setLocationBrushObjectOffsetX, setLocationBrushObjectOffsetZ,
    setLocationBrushObjectScale, setLocationBrushObjectRotation, setLocationBuildMode, setLocationStructurePreset,
    setLocationStructureWidth, setLocationStructureDepth, setLocationStructureHeight, setLocationStructureColor,
        setLocationStructureRotation
} from './locationScene.js';
import { getUserColorHex, updateMyColor } from './colors.js';
import { openLobbyRestModal, closeLobbyRestModal, saveLobbyTimeActivity, startLobbyRest } from './rest.js';
import {
    beginWorldGroupCreation,
    beginWorldMapEventCreation,
    closeWorldTravelModal,
    initWorldTravel,
    openWorldTravelModal,
} from './worldTravel.js';
import * as THREE from 'three';

initWeather();

const token = localStorage.getItem('access_token');
const pathParts = window.location.pathname.split('/').filter(p => p !== '');
let currentLobbyId = null;

if (pathParts.length >= 2 && pathParts[0] === 'lobbies') {
    currentLobbyId = pathParts[1];
    window.currentLobbyId = currentLobbyId;
}

const savedCharacterId = parseInt(localStorage.getItem('currentCharacterId') || '0', 10);
if (savedCharacterId > 0) {
    window.currentCharacterId = savedCharacterId;
}
const savedLocationCharacterId = parseInt(localStorage.getItem('selectedLocationCharacterId') || '0', 10);
if (savedLocationCharacterId > 0) {
    window.currentLocationCharacterId = savedLocationCharacterId;
}

if (!token) {
    showNotification('Вы не авторизованы');
    window.location.href = '/';
}
if (!currentLobbyId) {
    showNotification('Некорректный URL комнаты');
    window.location.href = '/';
}

// Инициализация модулей
setCurrentLobbyId(currentLobbyId);
setCharLobbyId(currentLobbyId);
initLobbyData(currentLobbyId);
initCharacters(currentLobbyId, token);
initMutantForm();
initMapEdit(currentLobbyId, token);
const socket = initSocket(currentLobbyId, token);

// Инициализация маркеров
initMarkers(currentLobbyId, token, socket);
setupMarkerInteraction();

// ========== Глобальные флаги ==========
window.isLocationActive = false; // флаг активной локации
window.socket = socket;
window.currentLocationId = null;
window.currentLocationCharacterId = window.currentLocationCharacterId || null;

// ========== Перенаправление UI-вызовов в зависимости от активного режима ==========

// Сохраняем оригинальные функции из глобальной карты
const originalSetBrushRadiusFromInput = window.setBrushRadiusFromInput || setBrushRadiusFromInput;
const originalSetTileHeightFromInput = window.setTileHeightFromInput || setTileHeightFromInput;
const originalSetEraserModeFromInput = window.setEraserModeFromInput || setEraserModeFromInput;
const originalToggleEditMode = window.toggleEditMode || (() => setEditMode(!getEditMode()));

// Переопределяем глобальные функции для UI
window.setBrushRadiusFromInput = function(value) {
    if (window.isLocationActive) {
        setLocationBrushRadius(parseInt(value));
        const radiusSpan = document.getElementById('brush-radius-value');
        const radiusSlider = document.getElementById('brush-radius');
        if (radiusSpan) radiusSpan.textContent = value;
        if (radiusSlider) radiusSlider.value = value;
    } else {
        originalSetBrushRadiusFromInput(value);
    }
};

window.setTileHeightFromInput = function(value) {
    if (window.isLocationActive) {
        setLocationBrushHeight(parseFloat(value));
        const heightSpan = document.getElementById('tile-height-value');
        const heightSlider = document.getElementById('tile-height');
        if (heightSpan) heightSpan.textContent = parseFloat(value).toFixed(1);
        if (heightSlider) heightSlider.value = value;
    } else {
        originalSetTileHeightFromInput(value);
    }
};

window.setEraserModeFromInput = function(checked) {
    if (window.isLocationActive) {
        setLocationEraserMode(checked);
    } else {
        originalSetEraserModeFromInput(checked);
    }
};

window.toggleEditMode = function() {
    if (window.isLocationActive) {
        const newMode = !getLocationEditMode();
        setLocationEditMode(newMode);
        const btn = document.getElementById('edit-toggle');
        if (btn) btn.style.background = newMode ? '#4a6fa5' : '';
    } else {
        originalToggleEditMode();
    }
};

// Также перенаправляем функции applyBrush, если они вызываются из UI (но для локации они не используются)
// Оставим как есть, так как applyBrush в локации не нужна.

// ========== Функции для работы с локацией ==========
let currentLocationData = null;

window.enterLocation = async function(locationId) {
    if (window._locationEventCleanup) {
        window._locationEventCleanup();
        window._locationEventCleanup = null;
    }
    try {
        if (typeof window.resetHoveredMarker === 'function') {
            window.resetHoveredMarker();
        }
        // Устанавливаем флаг, что мы в локации
        window.isLocationActive = true;
        window.currentLocationId = locationId;

        // Скрываем глобальную информационную панель
        const globalTileInfo = document.getElementById('tile-info');
        if (globalTileInfo) globalTileInfo.style.display = 'none';

        const data = await Server.getLocationDetail(currentLobbyId, locationId);
        currentLocationData = data;
        setCurrentLocationId(locationId);

        // Скрываем глобальную 3D-сцену
        document.getElementById('canvas-container').style.display = 'none';
        document.getElementById('location-container').style.display = 'block';
        hideGlobalCanvas();

        // Инициализируем сцену локации
        destroyLocationScene();
        initLocationScene('location-canvas');
        loadLocation(data);

        setLocationBrushRadius(window.brushRadius);
        setLocationBrushHeight(window.tileHeight);
        setLocationBrushTerrain(window.currentTileType);

        if (socket) {
            window.currentLocationCharacterId = null;
            socket.emit('join_location', {
                token,
                location_id: locationId,
                character_id: null,
            });
        }

        if (window.isGM) {
            // Кнопки удаления и редактирования параметров
            addDeleteLocationButton(async () => { await deleteCurrentLocation(locationId); });
            setDeleteButtonVisible(true);
            addEditLocationButton(() => openLocationEditModal(currentLocationData));
            setEditButtonVisible(true);

            const toolsPanel = document.getElementById('panel-tools');
            if (toolsPanel) {
                if (!window._originalToolsContent) {
                    window._originalToolsContent = toolsPanel.querySelector('.panel-content').innerHTML;
                }
                const panelContent = toolsPanel.querySelector('.panel-content');
                panelContent.innerHTML = `
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 5px;">
                            <input type="checkbox" id="loc-edit-toggle-checkbox"> Режим редактирования
                        </label>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>Инструмент:</span>
                            <select id="loc-build-mode" class="form-control" style="width: auto;">
                                <option value="terrain">Ландшафт и декор</option>
                                <option value="structure">Строительство</option>
                            </select>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>Тип:</span>
                            <select id="loc-edit-terrain" class="form-control" style="width: auto;">
                                <option value="grass">🌿 Трава</option>
                                <option value="sand">🏜️ Песок</option>
                                <option value="rock">⛰️ Камень</option>
                                <option value="swamp">💧 Болото</option>
                                <option value="water">🌊 Вода</option>
                            </select>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>Радиус:</span>
                            <input type="range" id="loc-edit-radius" min="0" max="5" value="0">
                            <span id="loc-radius-value">0</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>Высота:</span>
                            <input type="range" id="loc-edit-height" min="0.5" max="3.0" step="0.1" value="1.0">
                            <span id="loc-height-value">1.0</span>
                        </div>
                        <label style="display: flex; align-items: center; gap: 5px;">
                            <input type="checkbox" id="loc-eraser"> Ластик
                        </label>
                        <hr style="width:100%; margin:5px 0;">
                        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                            <strong>Конструкция</strong>
                            <select id="loc-structure-preset" class="form-control" style="width: auto;">
                                <option value="wall">Стена</option>
                                <option value="floor">Пол</option>
                                <option value="door">Дверь</option>
                                <option value="table">Стол</option>
                                <option value="chair">Стул</option>
                                <option value="shelf">Стеллаж</option>
                                <option value="chest">Сундук</option>
                                <option value="fence">Забор</option>
                            </select>
                            <label id="loc-structure-width-field">Ширина <input id="loc-structure-width" type="number" min="0.2" max="30" step="0.1" value="3" style="width:58px;"></label>
                            <label id="loc-structure-depth-field">Глубина <input id="loc-structure-depth" type="number" min="0.1" max="30" step="0.1" value="0.2" style="width:58px;"></label>
                            <label id="loc-structure-height-field">Высота <input id="loc-structure-height" type="number" min="0.1" max="20" step="0.1" value="2.4" style="width:58px;"></label>
                            <label id="loc-structure-rotation-field">Поворот <select id="loc-structure-rotation" class="form-control" style="width:auto;"><option value="0">0°</option><option value="1.5707963267948966">90°</option><option value="3.141592653589793">180°</option><option value="4.71238898038469">270°</option></select></label>
                            <label>Класс укрытия <select id="loc-structure-cover-class" class="form-control" style="width:auto;">
                                <option value="conditional">Условное</option>
                                <option value="flimsy">Хлипкое</option>
                                <option value="medium" selected>Средней прочности</option>
                                <option value="strong">Прочное</option>
                                <option value="very_strong">Очень прочное</option>
                                <option value="titanium">Титановое</option>
                                <option value="special">Особое</option>
                            </select></label>
                            <label>Цвет <input id="loc-structure-color" type="color" value="#8b6b4f"></label>
                            <span style="font-size:12px; opacity:.8;">Выберите структуру и кликните по тайлу</span>
                        </div>
                        <label style="display: flex; align-items: center; gap: 5px;">
                            <input type="checkbox" id="loc-obj-mode"> Режим объектов
                        </label>
                        <label style="display: flex; align-items: center; gap: 5px;">
                            <input type="checkbox" id="loc-rad-mode"> Режим радиации
                        </label>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>Радиация:</span>
                            <input type="range" id="loc-edit-radiation" min="0" max="10" step="0.1" value="0">
                            <span id="loc-radiation-value">0.0</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <select id="loc-obj-type" class="form-control" style="width: auto;">
                                <option value="tree">🌲 Дерево</option>
                                <option value="anomaly_electric">⚡ Электрическая аномалия</option>
                                <option value="anomaly_fire">🔥 Огненная аномалия</option>
                                <option value="anomaly_acid">🧪 Кислотная лужа</option>
                                <option value="anomaly_void">🌀 Искажение</option>
                            </select>
                            <input type="color" id="loc-obj-color" value="#2d5a27">
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>X:</span>
                            <input type="range" id="loc-obj-offset-x" min="-0.5" max="0.5" step="0.01" value="0">
                            <span id="loc-obj-offset-x-value">0.00</span>
                            <span>Z:</span>
                            <input type="range" id="loc-obj-offset-z" min="-0.5" max="0.5" step="0.01" value="0">
                            <span id="loc-obj-offset-z-value">0.00</span>
                            <span>Масштаб:</span>
                            <input type="range" id="loc-obj-scale" min="0.2" max="2.0" step="0.05" value="1.0">
                            <span id="loc-obj-scale-value">1.00</span>
                            <span>Поворот:</span>
                            <input type="range" id="loc-obj-rotation" min="0" max="359" step="1" value="0">
                            <span id="loc-obj-rotation-value">0°</span>
                        </div>
                    </div>
                `;

                const toolsRoot = panelContent.firstElementChild;
                toolsRoot.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:10px; align-items:start;';
                const createToolSection = (title, elements) => {
                    const section = document.createElement('section');
                    section.style.cssText = 'display:flex; flex-direction:column; gap:8px; padding:10px; border:1px solid rgba(130, 100, 60, .45); border-radius:8px; background:rgba(25, 22, 18, .32);';
                    const heading = document.createElement('strong');
                    heading.textContent = title;
                    heading.style.cssText = 'font-size:13px; color:#e0c08a;';
                    section.appendChild(heading);
                    elements.forEach(element => {
                        const node = document.getElementById(element);
                        if (!node) return;
                        const block = node.closest('label, div') || node;
                        block.style.display = 'flex';
                        block.style.flexWrap = 'wrap';
                        block.style.alignItems = 'center';
                        block.style.gap = '6px';
                        section.appendChild(block);
                    });
                    toolsRoot.appendChild(section);
                };
                createToolSection('Режим', ['loc-edit-toggle-checkbox', 'loc-build-mode', 'loc-eraser']);
                createToolSection('Ландшафт', ['loc-edit-terrain', 'loc-edit-radius', 'loc-edit-height']);
                createToolSection('Строительство', ['loc-structure-preset']);
                createToolSection('Декор', ['loc-obj-mode', 'loc-obj-type', 'loc-obj-offset-x']);
                createToolSection('Эффекты', ['loc-rad-mode', 'loc-edit-radiation']);
                toolsRoot.querySelectorAll('hr').forEach(element => element.remove());

                // Получаем элементы
                const editCheckbox = document.getElementById('loc-edit-toggle-checkbox');
                const terrainSelect = document.getElementById('loc-edit-terrain');
                const radiusSlider = document.getElementById('loc-edit-radius');
                const heightSlider = document.getElementById('loc-edit-height');
                const eraserCheck = document.getElementById('loc-eraser');
                const radiationSlider = document.getElementById('loc-edit-radiation');
                const radiationSpan = document.getElementById('loc-radiation-value');
                if (radiationSlider) {
                    radiationSlider.oninput = (e) => {
                        const val = parseFloat(e.target.value);
                        setLocationBrushRadiation(val);
                    };
                    setLocationBrushRadiation(0);
                }

                // Инициализация начальных значений из глобальных переменных
                radiusSlider.value = window.brushRadius;
                document.getElementById('loc-radius-value').textContent = window.brushRadius;
                setLocationBrushRadius(window.brushRadius);

                heightSlider.value = window.tileHeight;
                document.getElementById('loc-height-value').textContent = window.tileHeight.toFixed(1);
                setLocationBrushHeight(window.tileHeight);

                terrainSelect.value = window.currentTileType;
                setLocationBrushTerrain(window.currentTileType);

                const objModeCheck = document.getElementById('loc-obj-mode');
                const objTypeSelect = document.getElementById('loc-obj-type');
                const objColorInput = document.getElementById('loc-obj-color');
                const objOffsetX = document.getElementById('loc-obj-offset-x');
                const objOffsetZ = document.getElementById('loc-obj-offset-z');
                const objScale = document.getElementById('loc-obj-scale');
                const objRotation = document.getElementById('loc-obj-rotation');
                const buildModeSelect = document.getElementById('loc-build-mode');
                const structurePreset = document.getElementById('loc-structure-preset');
                const structureWidth = document.getElementById('loc-structure-width');
                const structureDepth = document.getElementById('loc-structure-depth');
                const structureHeight = document.getElementById('loc-structure-height');
                const structureRotation = document.getElementById('loc-structure-rotation');
                const structureColor = document.getElementById('loc-structure-color');
                const structureWidthField = document.getElementById('loc-structure-width-field');
                const structureDepthField = document.getElementById('loc-structure-depth-field');
                const structureHeightField = document.getElementById('loc-structure-height-field');
                const structureRotationField = document.getElementById('loc-structure-rotation-field');
                const structureDefaults = {
                    wall: { width: 3, depth: 0.2, height: 2.4 },
                    floor: { width: 1, depth: 1, height: 0.12 },
                    door: { width: 0.9, depth: 0.18, height: 2 },
                    table: { width: 1.4, depth: 0.8, height: 1 },
                    chair: { width: 0.55, depth: 0.55, height: 1 },
                    shelf: { width: 1.2, depth: 0.4, height: 2 },
                    chest: { width: 0.9, depth: 0.6, height: 0.7 },
                    fence: { width: 2, depth: 0.15, height: 1.2 }
                };
                const applyStructurePreset = (preset) => {
                    const values = structureDefaults[preset];
                    if (!values) return;
                    structureWidth.value = values.width;
                    structureDepth.value = values.depth;
                    structureHeight.value = values.height;
                    setLocationStructurePreset(preset);
                    setLocationStructureWidth(values.width);
                    setLocationStructureDepth(values.depth);
                    setLocationStructureHeight(values.height);
                    const isFloor = preset === 'floor';
                    structureWidthField.firstChild.textContent = isFloor ? 'Размер ' : 'Ширина ';
                    structureWidth.type = isFloor ? 'range' : 'number';
                    structureWidth.min = isFloor ? '1' : '0.2';
                    structureWidth.max = isFloor ? '10' : '30';
                    structureWidth.step = isFloor ? '1' : '0.1';
                    structureDepthField.style.display = isFloor ? 'none' : '';
                    structureHeightField.style.display = isFloor ? 'none' : '';
                    structureRotationField.style.display = isFloor ? 'none' : '';
                };

                if (objModeCheck) objModeCheck.onchange = (e) => setLocationBrushObjectMode(e.target.checked);
                if (objTypeSelect) objTypeSelect.onchange = (e) => setLocationBrushObjectType(e.target.value);
                if (objColorInput) objColorInput.oninput = (e) => setLocationBrushObjectColor(e.target.value);
                if (objOffsetX) objOffsetX.oninput = (e) => setLocationBrushObjectOffsetX(e.target.value);
                if (objOffsetZ) objOffsetZ.oninput = (e) => setLocationBrushObjectOffsetZ(e.target.value);
                if (objScale) objScale.oninput = (e) => setLocationBrushObjectScale(e.target.value);
                if (objRotation) objRotation.oninput = (e) => setLocationBrushObjectRotation(e.target.value);
                if (buildModeSelect) buildModeSelect.onchange = (e) => setLocationBuildMode(e.target.value);
                if (structurePreset) structurePreset.onchange = (e) => applyStructurePreset(e.target.value);
                if (structureWidth) structureWidth.oninput = (e) => setLocationStructureWidth(e.target.value);
                if (structureDepth) structureDepth.oninput = (e) => setLocationStructureDepth(e.target.value);
                if (structureHeight) structureHeight.oninput = (e) => setLocationStructureHeight(e.target.value);
                if (structureRotation) structureRotation.onchange = (e) => setLocationStructureRotation(e.target.value);
                if (structureColor) structureColor.oninput = (e) => setLocationStructureColor(e.target.value);
                applyStructurePreset(structurePreset.value);


                editCheckbox.checked = getLocationEditMode();

                // Обработчики
                editCheckbox.onchange = (e) => setLocationEditMode(e.target.checked);

                terrainSelect.onchange = (e) => setLocationBrushTerrain(e.target.value);

                radiusSlider.oninput = (e) => {
                    const val = parseInt(e.target.value);
                    setLocationBrushRadius(val);
                    document.getElementById('loc-radius-value').textContent = val;
                };

                heightSlider.oninput = (e) => {
                    const val = parseFloat(e.target.value);
                    setLocationBrushHeight(val);
                    document.getElementById('loc-height-value').textContent = val.toFixed(1);
                };

                eraserCheck.onchange = (e) => setLocationEraserMode(e.target.checked);
            }
        } else {
            // Обычные игроки: скрываем панель инструментов
            const toolsPanel = document.getElementById('panel-tools');
            if (toolsPanel) toolsPanel.style.display = 'none';
        }
    } catch (err) {
        showNotification(err.message);
    }
};

async function deleteCurrentLocation(locationId) {
    try {
        await Server.deleteLocation(currentLobbyId, locationId);
        showNotification('Локация удалена', 'success');
        exitLocation();
        if (socket) socket.emit('get_markers', { token, lobby_id: currentLobbyId });
    } catch (err) {
        showNotification(err.message);
    }
}

window.exitLocation = function() {
    // Очищаем события локации, если они были установлены
    if (window._locationEventCleanup) {
        window._locationEventCleanup();
        window._locationEventCleanup = null;
    }
    const locationId = getCurrentLocationId();
    const characterId = window.currentLocationCharacterId;
    if (socket && characterId) {
        socket.emit('leave_location', {
            token: localStorage.getItem('access_token'),
            location_id: locationId,
            character_id: characterId
        });
    }
    // Сбрасываем флаг локации
    window.isLocationActive = false;
    window.currentLocationId = null;
    window.currentLocationCharacterId = null;

    document.getElementById('location-container').style.display = 'none';
    document.getElementById('canvas-container').style.display = 'block';
    showGlobalCanvas();

    setCurrentLocationId(null);
    currentLocationData = null;
    destroyLocationScene();

    // Удаляем кнопки удаления/редактирования
    const delBtn = document.getElementById('delete-location-btn');
    if (delBtn) delBtn.remove();
    const editBtn = document.getElementById('edit-location-btn');
    if (editBtn) editBtn.remove();

    // Восстанавливаем оригинальную панель инструментов (для глобальной карты)
    if (window.isGM && window._originalToolsContent) {
        const toolsPanel = document.getElementById('panel-tools');
        if (toolsPanel) {
            toolsPanel.querySelector('.panel-content').innerHTML = window._originalToolsContent;
        }
    } else {
        const toolsPanel = document.getElementById('panel-tools');
        if (toolsPanel) toolsPanel.style.display = 'flex';
    }

    // Принудительно обновляем глобальную карту
    if (typeof loadAllChunks === 'function') loadAllChunks();
};

// Вспомогательная функция – генерация локации
window.generateLocationTiles = function(terrainType, width, height, generateObjects = true) {
    const terrainMap = {
        'grass': 'grass',
        'forest': 'grass',
        'rock': 'rock',
        'swamp': 'swamp',
        'water': 'water',
        'desert': 'sand',
        'urban': 'grass',
        'camp': 'grass'
    };
    const baseTerrain = terrainMap[terrainType] || 'grass';
    const tiles = [];
    for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) {
            let heightVal = 1.0 + (Math.random() - 0.5) * 0.2;
            heightVal = Math.round(heightVal * 10) / 10;
            const tile = {
                terrain: baseTerrain,
                height: heightVal,
                objects: []
            };
            if (generateObjects) {
                if (terrainType === 'forest' && Math.random() < 0.3) {
                    tile.objects.push({ type: 'tree' });
                } else if (terrainType === 'rock' && Math.random() < 0.2) {
                    tile.objects.push({ type: 'rock' });
                } else if (terrainType === 'urban' && Math.random() < 0.15) {
                    tile.objects.push({ type: 'house' });
                } else if (terrainType === 'camp') {
                    if (Math.random() < 0.2) tile.objects.push({ type: 'tent' });
                    else if (Math.random() < 0.1) tile.objects.push({ type: 'campfire' });
                }
            }
            row.push(tile);
        }
        tiles.push(row);
    }
    return tiles;
};

let selectedTileForLocation = null;
function openLocationCreateModal(tile) {
    selectedTileForLocation = tile;
    const modal = document.getElementById('location-create-modal');
    if (!modal) {
        showNotification('Ошибка: окно создания локации не найдено');
        return;
    }
    const globalTerrain = tile.tileData.terrain || 'grass';
    let suggestedTerrainOption = 'grass';
    switch(globalTerrain) {
        case 'grass': suggestedTerrainOption = 'grass'; break;
        case 'sand': suggestedTerrainOption = 'desert'; break;
        case 'rock': suggestedTerrainOption = 'rock'; break;
        case 'swamp': suggestedTerrainOption = 'swamp'; break;
        case 'water': suggestedTerrainOption = 'water'; break;
        default: suggestedTerrainOption = 'grass';
    }
    document.getElementById('new-loc-name').value = '';
    document.getElementById('new-loc-terrain').value = suggestedTerrainOption;
    document.getElementById('new-loc-width').value = 30;
    document.getElementById('new-loc-height').value = 30;
    document.getElementById('new-loc-gen-objects').checked = true;
    modal.style.display = 'flex';
}

async function createLocationFromModal() {
    const name = document.getElementById('new-loc-name').value.trim();
    if (!name) {
        showNotification('Введите название локации');
        return;
    }
    const terrainType = document.getElementById('new-loc-terrain').value;
    let width = parseInt(document.getElementById('new-loc-width').value);
    let height = parseInt(document.getElementById('new-loc-height').value);
    const genObjects = document.getElementById('new-loc-gen-objects').checked;
    if (isNaN(width) || width < 5) width = 30;
    if (isNaN(height) || height < 5) height = 30;
    width = Math.min(100, Math.max(10, width));
    height = Math.min(100, Math.max(10, height));

    if (!selectedTileForLocation) {
        showNotification('Не выбран тайл для локации');
        return;
    }
    const worldX = selectedTileForLocation.chunk.chunkX * 32 + selectedTileForLocation.tileX;
    const worldZ = selectedTileForLocation.chunk.chunkY * 32 + selectedTileForLocation.tileY;
    const tilesData = generateLocationTiles(terrainType, width, height, genObjects);

    try {
        await Server.createLocation(currentLobbyId, {
            name: name,
            type: 'exploration',
            world_tile_x: worldX,
            world_tile_z: worldZ,
            grid_width: width,
            grid_height: height,
            tiles_data: tilesData
        });
        showNotification('Локация создана', 'success');
        document.getElementById('location-create-modal').style.display = 'none';
        if (socket) socket.emit('get_markers', { token, lobby_id: currentLobbyId });
    } catch (err) {
        showNotification(err.message);
    }
}

function openLocationEditModal(locationData) {
    let dominantTerrain = 'grass';
    let terrainCount = {};
    let hasObjects = false;
    if (locationData.tiles_data && locationData.tiles_data.length) {
        for (let row of locationData.tiles_data) {
            for (let tile of row) {
                const t = tile.terrain || 'grass';
                terrainCount[t] = (terrainCount[t] || 0) + 1;
                if (tile.objects && tile.objects.length) hasObjects = true;
            }
        }
        let maxCount = 0;
        for (let [t, count] of Object.entries(terrainCount)) {
            if (count > maxCount) {
                maxCount = count;
                dominantTerrain = t;
            }
        }
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 500px;">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Редактирование локации</h3>
            <div class="form-group">
                <label>Название</label>
                <input type="text" id="edit-loc-name" value="${escapeHtml(locationData.name)}" class="form-control">
            </div>
            <div class="form-group">
                <label>Ширина (тайлов)</label>
                <input type="number" id="edit-loc-width" value="${locationData.grid_width}" min="10" max="100" class="form-control">
            </div>
            <div class="form-group">
                <label>Высота (тайлов)</label>
                <input type="number" id="edit-loc-height" value="${locationData.grid_height}" min="10" max="100" class="form-control">
            </div>
            <div class="form-group">
                <label>Тип ландшафта</label>
                <select id="edit-loc-terrain" class="form-control">
                    <option value="grass" ${dominantTerrain === 'grass' ? 'selected' : ''}>🌿 Поле / Трава</option>
                    <option value="forest" ${dominantTerrain === 'forest' ? 'selected' : ''}>🌲 Лес</option>
                    <option value="rock" ${dominantTerrain === 'rock' ? 'selected' : ''}>⛰️ Горы / Камни</option>
                    <option value="swamp" ${dominantTerrain === 'swamp' ? 'selected' : ''}>💧 Болото</option>
                    <option value="water" ${dominantTerrain === 'water' ? 'selected' : ''}>🌊 Вода</option>
                    <option value="desert" ${dominantTerrain === 'sand' ? 'selected' : ''}>🏜️ Пустыня</option>
                    <option value="urban" ${dominantTerrain === 'urban' ? 'selected' : ''}>🏙️ Город / Руины</option>
                    <option value="camp" ${dominantTerrain === 'camp' ? 'selected' : ''}>🔥 Лагерь</option>
                </select>
            </div>
            <div class="form-group">
                <label><input type="checkbox" id="edit-loc-gen-objects" ${hasObjects ? 'checked' : ''}> Генерировать декоративные объекты</label>
            </div>
            <div class="form-group">
                <button id="regenerate-loc-btn" class="btn btn-secondary">🔄 Перегенерировать ландшафт</button>
            </div>
            <div class="form-actions">
                <button id="save-loc-changes" class="btn btn-primary">Сохранить</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';

    let tempTiles = null;
    document.getElementById('regenerate-loc-btn').onclick = () => {
        const newWidth = parseInt(document.getElementById('edit-loc-width').value);
        const newHeight = parseInt(document.getElementById('edit-loc-height').value);
        const terrainType = document.getElementById('edit-loc-terrain').value;
        const genObjects = document.getElementById('edit-loc-gen-objects').checked;
        if (isNaN(newWidth) || isNaN(newHeight)) return;
        tempTiles = generateLocationTiles(terrainType, newWidth, newHeight, genObjects);
        showNotification('Ландшафт перегенерирован. Не забудьте сохранить.', 'success');
    };
    document.getElementById('save-loc-changes').onclick = async () => {
        const newName = document.getElementById('edit-loc-name').value;
        let newWidth = parseInt(document.getElementById('edit-loc-width').value);
        let newHeight = parseInt(document.getElementById('edit-loc-height').value);
        let finalTiles = tempTiles;
        if (!finalTiles) finalTiles = locationData.tiles_data;
        if (newWidth !== locationData.grid_width || newHeight !== locationData.grid_height) {
            finalTiles = resizeTilesData(finalTiles, newWidth, newHeight);
        }
        try {
            await Server.updateLocation(currentLobbyId, locationData.id, {
                name: newName,
                grid_width: newWidth,
                grid_height: newHeight,
                tiles_data: finalTiles
            });
            showNotification('Локация обновлена', 'success');
            modal.remove();
            window.enterLocation(locationData.id);
        } catch (err) {
            showNotification(err.message);
        }
    };
}

function resizeTilesData(oldTiles, newWidth, newHeight) {
    const newTiles = [];
    for (let y = 0; y < newHeight; y++) {
        const row = [];
        for (let x = 0; x < newWidth; x++) {
            if (y < oldTiles.length && x < oldTiles[0].length) {
                row.push({ ...oldTiles[y][x] });
            } else {
                row.push({ terrain: 'grass', height: 1.0, objects: [] });
            }
        }
        newTiles.push(row);
    }
    return newTiles;
}

function startLocationPick() {
    window.awaitingLocationPick = true;
    showNotification('Кликните по тайлу на карте для создания локации', 'system');
    window.locationPickCallback = (tile) => {
        window.awaitingLocationPick = false;
        openLocationCreateModal(tile);
    };
}

document.getElementById('create-location-btn')?.addEventListener('click', startLocationPick);
document.getElementById('confirm-create-location')?.addEventListener('click', createLocationFromModal);
document.getElementById('exit-location-btn')?.addEventListener('click', exitLocation);

// ========== Обработчики сокетов для локации ==========
if (socket) {
    socket.on('joined_location', (data) => {
        console.log('Joined location', data);
        if (data.character_id) {
            window.currentLocationCharacterId = data.character_id;
            localStorage.setItem('selectedLocationCharacterId', String(data.character_id));
        }
        updateCharacterPosition(data.character_id, data.x, data.y);
    });
    socket.on('location_state', (state) => {
        state.forEach(s => {
            import('./locationScene.js').then(module => {
                module.addCharacterToLocation(
                    s.character_id,
                    s.name,
                    Number(s.owner_id),
                    s.owner_username,
                    s.x,
                    s.y,
                    s.hp_zones,
                    s.effects,
                    Number(s.controlled_by),
                    s.team_name,
                    s.team_color,
                    s.facing_x,
                    s.facing_y,
                );
            });
        });
    });
    socket.on('character_moved', (data) => {
        updateCharacterPosition(data.character_id, data.x, data.y);
    });
    socket.on('movement_rejected', (data) => {
        if (Number.isFinite(Number(data.x)) && Number.isFinite(Number(data.y))) {
            updateCharacterPosition(data.character_id, Number(data.x), Number(data.y));
        }
        showNotification(`Ошибка: ${data.message || 'Перемещение недоступно'}`, 'error');
    });
    socket.on('location_tiles_updated', (data) => {
        if (data.location_id === getCurrentLocationId()) {
            import('./locationScene.js').then(module => {
                module.applyLocationTilesUpdate(data.location_id, data.updates);
            });
        }
    });
    socket.on('location_object_created', (data) => {
        if (data.location_id === getCurrentLocationId()) {
            import('./locationScene.js').then(module => module.addLocationObject(data.object));
        }
    });
    socket.on('location_object_deleted', (data) => {
        if (data.location_id === getCurrentLocationId()) {
            import('./locationScene.js').then(module => module.removeLocationObject(data.object_id));
        }
    });
    socket.on('location_object_updated', (data) => {
        if (data.location_id === getCurrentLocationId()) {
            import('./locationScene.js').then(module => module.updateLocationObject(data.object));
        }
    });
    socket.on('character_spawned', (data) => {
        const locId = getCurrentLocationId();
        if (!locId) return;
        import('./locationScene.js').then(module => {
            module.addCharacterToLocation(
                data.character.id,
                data.character.name,
                Number(data.character.owner_id),
                data.character.owner_username,
                data.character.pos_x,
                data.character.pos_y,
                data.character.hp_zones,
                data.character.effects,
                Number(data.character.controlled_by),
                data.character.team_name,
                data.character.team_color,
                data.character.facing_x,
                data.character.facing_y,
            );
        });
    });
    socket.on('location_character_removed', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => {
            module.removeCharacterFromLocation(data.character_id);
        });
    });
    socket.on('location_character_posture_updated', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => {
            module.applyCharacterPostureVisual(data.character_id, data.posture);
        });
    });
    socket.on('location_character_facing_updated', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => {
            module.applyCharacterFacingVisual(data.character_id, data.facing_x, data.facing_y);
        });
    });
    socket.on('location_teams_updated', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => module.refreshLocationTeams());
    });

    const syncCombatState = (state) => {
        import('./locationScene.js').then(module => {
            module.setCombatState(state);
        });
    };

    socket.on('combat_state', syncCombatState);
    socket.on('combat_state_updated', syncCombatState);
    socket.on('combat_explosion', (data) => {
        if (Number(data?.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => module.showCombatExplosion(data));
    });
    socket.on('character_interaction_requested', (data) => {
        import('./locationScene.js').then(module => module.handleCharacterInteractionRequest(data));
    });
    socket.on('character_interaction_resolved', (data) => {
        import('./locationScene.js').then(module => module.handleCharacterInteractionResolved(data));
    });
}

// ========== Глобальные функции из других модулей ==========
window.sendMessage = () => {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message) return;
    socket.emit('send_message', { token, lobby_id: currentLobbyId, message });
    input.value = '';
};

window.exitLobbyToList = () => {
    if (!confirm('Выйти из комнаты в список комнат?')) return;
    socket.disconnect();
    window.location.href = '/';
};

window.toggleParticipants = toggleParticipants;
window.toggleSettings = toggleSettings;
window.showSettingsTab = showSettingsTab;
window.closeSettings = closeSettings;
window.openSettings = openSettings;
window.closeVisibilityModal = closeVisibilityModal;
window.saveVisibility = saveVisibility;
window.unbanUserHandler = unbanUserHandler;

// Функции для модального окна редактирования тайла
window.openTileEditModal = openTileEditModal;
window.closeTileEditModal = closeTileEditModal;
window.applyTerrainChange = applyTerrainChange;
window.applyHeightChange = applyHeightChange;
window.applyNameChange = applyNameChange;
window.applyRadiationChange = applyRadiationChange;
window.applyAnomalyFieldChange = applyAnomalyFieldChange;
window.updateAnomalyFieldRankOptions = updateAnomalyFieldRankOptions;
window.addObjectToTile = addObjectToTile;
window.clearObjectsFromTile = clearObjectsFromTile;
window.removeObjectFromTile = removeObjectFromTile;
window.updateTileEditHeight = updateTileEditHeight;
window.updateTileEditRadiation = updateTileEditRadiation;
window.updateObjectOffsetX = updateObjectOffsetX;
window.updateObjectOffsetZ = updateObjectOffsetZ;
window.updateObjectScale = updateObjectScale;
window.updateObjectRotation = updateObjectRotation;

window.openCharacterSheet = openCharacterSheet;
window.closeCharacterSheet = closeCharacterSheet;
window.exportCharacter = exportCharacter;
window.importCharacter = importCharacter;

window.showCreateCharacterForm = showCreateCharacterForm;
window.showCreateMutantForm = showCreateMutantForm;
window.openLobbyRestModal = openLobbyRestModal;
window.closeLobbyRestModal = closeLobbyRestModal;
window.saveLobbyTimeActivity = saveLobbyTimeActivity;
window.startLobbyRest = startLobbyRest;
window.openWorldTravelModal = openWorldTravelModal;
window.closeWorldTravelModal = closeWorldTravelModal;
window.beginWorldGroupCreation = beginWorldGroupCreation;
window.beginWorldMapEventCreation = beginWorldMapEventCreation;

// Маркеры
window.closeMarkerEditModal = closeMarkerEditModal;
window.saveMarkerEdit = saveMarkerEdit;
window.submitCreateMarker = submitCreateMarker;
window.openCreateMarkerModal = openCreateMarkerModal;
window.openCreateMarkerModalAtCenter = openCreateMarkerModalAtCenter;
window.fillCenterCoordinates = fillCenterCoordinates;
window.deleteMarker = deleteMarker;
window.fillEditCenterCoordinates = fillEditCenterCoordinates;
window.pickTileForMarker = pickTileForMarker;

// Экспорт карты
window.exportMap = async () => {
    try {
        const blob = await Server.exportMap(currentLobbyId);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        showNotification(error.message);
    }
};

window.toggleTheme = () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = isLight ? '🌑' : '🌓';
};

window.applyWeatherSettings = () => {
    const settings = {
        fog: {
            enabled: document.getElementById('weather-fog').checked,
            intensity: parseFloat(document.getElementById('weather-fog-intensity').value)
        },
        rain: {
            enabled: document.getElementById('weather-rain').checked,
            intensity: parseFloat(document.getElementById('weather-rain-intensity').value)
        },
        sun: {
            enabled: document.getElementById('weather-sun').checked,
            intensity: parseFloat(document.getElementById('weather-sun-intensity').value)
        },
        emission: {
            enabled: document.getElementById('weather-emission').checked,
            intensity: parseFloat(document.getElementById('weather-emission-intensity').value)
        }
    };
    fetch(`/lobbies/${currentLobbyId}/weather`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
    }).then(res => {
        if (!res.ok) throw new Error('Failed to update weather');
        showNotification('Погода обновлена', 'success');
    }).catch(err => showNotification(err.message));
};

window.loadWeatherSettings = (settings) => {
    const updateControl = (id, enabled, intensity) => {
        const cb = document.getElementById(id);
        const range = document.getElementById(id + '-intensity');
        const valueSpan = document.getElementById(id + '-value');
        if (cb) cb.checked = enabled;
        if (range) {
            range.value = intensity;
            range.disabled = !enabled;
        }
        if (valueSpan) valueSpan.textContent = intensity.toFixed(1);
    };
    updateControl('weather-fog', settings.fog?.enabled || false, settings.fog?.intensity || 0.5);
    updateControl('weather-rain', settings.rain?.enabled || false, settings.rain?.intensity || 0.5);
    updateControl('weather-sun', settings.sun?.enabled || false, settings.sun?.intensity || 0.5);
    updateControl('weather-emission', settings.emission?.enabled || false, settings.emission?.intensity || 0.5);
};

window.updateWeatherValue = (id, value) => {
    const span = document.getElementById(id + '-value');
    if (span) span.textContent = parseFloat(value).toFixed(1);
};

function bindWeatherSliders() {
    const sliderIds = ['weather-fog-intensity', 'weather-rain-intensity', 'weather-sun-intensity', 'weather-emission-intensity'];
    sliderIds.forEach(id => {
        const slider = document.getElementById(id);
        if (slider) {
            slider.addEventListener('input', (e) => {
                window.updateWeatherValue(id.replace('-intensity', ''), e.target.value);
            });
        }
    });
}
bindWeatherSliders();

window.setCurrentTileTypeFromUI = function(value) {
    if (window.isLocationActive) {
        setLocationBrushTerrain(value);
    } else {
        const select = document.getElementById('tile-type-select');
        if (select) {
            select.value = value;
            AppState.setCurrentTileType(value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }
};

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Загружаем данные при старте
(async function init() {
    await loadLobbyInfo();
    await loadLobbyCharacters();
    await loadAllChunks();
    await initWorldTravel(currentLobbyId, socket);
    initHotkeys();

    // ===== Настройка кнопки выбора цвета =====
    const colorPickerContainer = document.getElementById('color-picker-container');
    if (colorPickerContainer) {
        colorPickerContainer.style.display = window.isGM ? 'none' : 'inline-block';
    }

    const colorPickerBtn = document.getElementById('color-picker-btn');
    if (colorPickerBtn) {
        colorPickerBtn.addEventListener('click', () => {
            const currentColor = getUserColorHex(parseInt(localStorage.getItem('user_id')));
            const input = document.createElement('input');
            input.type = 'color';
            input.value = currentColor;
            input.addEventListener('input', async (e) => {
                try {
                    await updateMyColor(e.target.value);
                    showNotification('Цвет обновлён', 'success');
                    updateParticipantsList();
                    if (window.isLocationActive) {
                        const locId = getCurrentLocationId();
                        if (locId) {
                            window.enterLocation(locId);
                        }
                    }
                } catch (err) {
                    showNotification(err.message);
                }
            });
            input.click();
        });
    }
})();

setTimeout(() => {
    initDraggablePanels();
}, 100);
