import { waterProfileControls } from './waterProfiles.js';
// static/js/main.js
import { initWorldNumericInputs } from './worldNumericInputs.js';
import { addTerrainMaterialOptions } from './terrainMaterialCatalog.js';
import { initSocket } from './socketHandlers.js';
import { initCharacters, initMutantForm, loadLobbyCharacters, showCreateCharacterForm, showCreateMutantForm } from './characters.js';
import { initCommonMapTools } from './commonMapTools.js';
import { initLobbyData, loadLobbyInfo, loadAllChunks } from './lobbyData.js';
import { setCurrentLobbyId, toggleParticipants, toggleSettings, showSettingsTab, closeVisibilityModal,
saveVisibility, unbanUserHandler, closeSettings, openSettings, updateParticipantsList } from './ui.js';
import { initMapEdit, setEditMode, setBrushRadius, toggleEraserMode, applyBrush, openTileEditModal, closeTileEditModal,
 applyTerrainChange, applyHeightChange, addObjectToTile, clearObjectsFromTile, removeObjectFromTile, highlightObject,
 getEditMode, setBrushRadiusFromInput, setTileHeightFromInput, setEraserModeFromInput, updateTileEditHeight,
 selectWorldEditorTool,
 updateObjectOffsetX, updateObjectOffsetZ, updateObjectScale, updateObjectRotation,
 setWorldBrushRadiation, applyRadiationChange, updateTileEditRadiation, applyAnomalyFieldChange,
 updateAnomalyFieldRankOptions} from './mapEdit.js';
import { hideObjectHighlight, camera, getHoveredTile } from './lobby3d.js';
import { hideGlobalCanvas, showGlobalCanvas, controls as globalControls } from './lobby3d.js';
import { showNotification, getErrorMessage } from './utils.js';
import { Server } from './api.js';
import AppState, {
    collapseMapToolsPanel, expandMapToolsPanel, expandMapToolsPanelOnToolChange, initDraggablePanels, initHotkeys,
    syncMapEditorAutoExpandCheckbox,
} from './ui_interactions.js';
import { initMapEditorQuickMenu, closeMapEditorQuickMenu } from './mapEditorQuickMenu.js';
import { initWeather, applyWeather } from './weather.js';
import { createLocationLightingEditor } from './locationLightingEditor.js';
import { LOCATION_ASSETS } from './locationAssetCatalog.js';
import { assetDimensions, validAssetDimensions } from './locationAssetDimensions.js';
import { clampAssetElevation } from './locationAssetTransforms.js';
import { STOREY_HEIGHT } from './locationArchitecture.js';
import { initMarkers, setupMarkerInteraction, closeMarkerEditModal, saveMarkerEdit, submitCreateMarker,
openCreateMarkerModal, openCreateMarkerModalAtCenter, fillCenterCoordinates, deleteMarker,
fillEditCenterCoordinates, pickTileForMarker } from './markers.js';
import { openCharacterSheet, closeCharacterSheet, exportCharacter, importCharacter } from './characterSheet.js';
import { setCurrentLobbyId as setCharLobbyId } from './characterSheet.js';
import {
    initLocationScene, loadLocation, startLocationLoadDiagnostics,
    updateCharacterPosition, setCurrentLocationId, getCurrentLocationId,
    loadCombatStartRequests, handleCombatStartRequest, handleCombatStartRequestResolved,
    addDeleteLocationButton, setDeleteButtonVisible, addEditLocationButton, setEditButtonVisible,
    addLocationGridButton, addLocationRoofButton, addLocationFloorMenu,
    getLocationViewLevel, setLocationViewLevel, destroyLocationScene,
    setLocationBrushRadius, setLocationBrushHeight, setLocationBrushTerrain, setLocationGrassSubtype,
    setLocationEraserMode, setLocationEditMode,
    getLocationEditMode, getHoveredTileCoords, updateHighlightByCoords, setLocationBrushRadiation, setLocationBrushObjectMode,
    setLocationBrushObjectType, setLocationBrushObjectColor, setLocationBrushObjectOffsetX, setLocationBrushObjectOffsetZ,
    setLocationBrushObjectScale, setLocationBrushObjectRotation, setLocationBuildMode, setLocationStructurePreset,
    setLocationHouseDrawMode,
    refreshLocationBuildPreview,
    setLocationStructureWidth, setLocationStructureDepth, setLocationStructureHeight, setLocationStructureColor,
    setLocationStructureRotation, rotateLocationPlacement, isLocationEditorTransformActive,
    applyLocationLighting, setLocationLightingPreset,
    getLocationLightingPreset, setLocationAssetPreset, clearLocationAssetPreset,
    setLocationAssetElevation,
    setLocationAssetDimensions, getSelectedLocationEditorAsset, getLocationBuildingIds,
    canRestoreGeneratedLocationFloor, restoreGeneratedLocationFloor,
    getSelectedLocationFloorFit, fitSelectedLocationFloorToBuilding,
    addFloorAboveSelectedLocationAsset, beginMoveSelectedLocationAsset,
    beginRotateSelectedLocationAsset, beginResizeSelectedLocationAsset, cancelLocationAssetResize,
    setLocationAssetResizeAxis, getLocationAssetResizeState,
    deleteSelectedLocationAsset, toggleSelectedLocationAssetsHidden, toggleSelectedLocationFire,
    updateSelectedLocationAssetDetails, previewSelectedLocationLamp,
    previewLocationDarkTiles, setLocationDarknessOverlayVisible,
} from './locationScene.js';
import { paintDarkTiles } from './locationDarkness.js';
import { getUserColorHex, updateMyColor } from './colors.js';
import { openLobbyRestModal, closeLobbyRestModal, saveLobbyTimeActivity, startLobbyRest } from './rest.js';
import {
    beginWorldGroupCreation,
    beginWorldMapEventCreation,
    closeWorldTravelModal,
    initWorldTravel,
    refreshWorldTravel,
    openWorldTravelModal,
} from './worldTravel.js';

function buildLocationAnomalyOptions(anomalies) {
    const categoryMeta = {
        gravity: ['Гравитационные', '◌'],
        electric: ['Электрические', '⚡'],
        thermal: ['Термические', '🔥'],
        radiation: ['Радиационные', '☢'],
        chemical: ['Химические', '⌁'],
        psi: ['Псионические', '◉'],
    };
    const groups = new Map();
    (Array.isArray(anomalies) ? anomalies : []).forEach(anomaly => {
        const category = anomaly.category || 'other';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(anomaly);
    });
    return [...groups.entries()].map(([category, entries]) => {
        const [label, icon] = categoryMeta[category] || ['Прочие', '◆'];
        return `<optgroup label="Аномалии: ${label}">${entries.map(anomaly =>
            `<option value="anomaly_${anomaly.key}" data-anomaly-name="${anomaly.name}" data-anomaly-visual="${anomaly.visual || 'void'}">${icon} ${anomaly.name} · ранг ${anomaly.rank}</option>`
        ).join('')}</optgroup>`;
    }).join('');
}
import * as THREE from 'three';

initWeather();

const token = localStorage.getItem('access_token');
const pathParts = window.location.pathname.split('/').filter(p => p !== '');
let currentLobbyId = null;
const locationParam = Number(new URLSearchParams(window.location.search).get('location'));
const directLocationId = Number.isSafeInteger(locationParam) && locationParam > 0 ? locationParam : null;
window.locationDirectOpenPending = Boolean(directLocationId);

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

if (!token || window.authSession?.isExpired()) {
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
initCommonMapTools(socket);

// ========== Глобальные флаги ==========
window.isLocationActive = false; // флаг активной локации
window.socket = socket;
window.currentLocationId = null;
initDraggablePanels();
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
        if (!newMode) collapseMapToolsPanel();
        else expandMapToolsPanel();
    } else {
        originalToggleEditMode();
        if (!getEditMode()) collapseMapToolsPanel();
    }
};
window.rotateLocationPlacement = rotateLocationPlacement;
window.isLocationEditorTransformActive = isLocationEditorTransformActive;

initMapEditorQuickMenu({
    isEnabled: () => Boolean(window.isGM && (window.isLocationActive ? getLocationEditMode() : getEditMode())),
    isLocation: () => Boolean(window.isLocationActive),
    selectTool: tool => {
        if (window.isLocationActive) window.selectLocationEditorTool?.(tool);
        else selectWorldEditorTool(tool);
    },
    locationAction: action => {
        if (action === 'move') return beginMoveSelectedLocationAsset();
        if (action === 'rotate') return beginRotateSelectedLocationAsset();
        if (action === 'resize') {
            if (!getSelectedLocationEditorAsset()) {
                window.selectLocationEditorTool?.('erase');
                return true;
            }
            beginResizeSelectedLocationAsset();
            return true;
        }
        return false;
    },
});

// Также перенаправляем функции applyBrush, если они вызываются из UI (но для локации они не используются)
// Оставим как есть, так как applyBrush в локации не нужна.

// ========== Функции для работы с локацией ==========
let currentLocationData = null;

function resumeWorldMapLoad() {
    const loadingToken = showSceneLoading('world');
    (async () => {
        await loadAllChunks();
        if (window.worldLoadMetrics?.pausedForLocation && !window.isLocationActive) {
            await loadAllChunks();
        }
        if (window.isLocationActive) return;
        if (!window.worldLoadMetrics?.complete) throw new Error('World map load incomplete');
        finishSceneLoading(loadingToken);
        Promise.resolve().then(refreshWorldTravel).catch(error =>
            console.error('World travel refresh failed', error));
    })().catch(error => {
        console.error('World map load failed', error);
        failSceneLoading(loadingToken, 'Не удалось загрузить карту мира.');
    });
}

function setLocationViewActive(active) {
    document.body.classList.toggle('location-view-active', active);
    document.getElementById('canvas-container').style.display = active ? 'none' : 'block';
    document.getElementById('location-container').style.display = active ? 'block' : 'none';
}

window.enterLocation = async function(locationId) {
    window.cancelCommonMapTool?.();
    window.clearDirectWorldObjectSelection?.();
    const loadingToken = showSceneLoading('location');
    closeMapEditorQuickMenu();
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
        window.locationEditorTool = 'select';
        window.currentLocationId = locationId;

        // Скрываем глобальную информационную панель
        const globalTileInfo = document.getElementById('tile-info');
        if (globalTileInfo) globalTileInfo.style.display = 'none';

        const requestStartedAt = performance.now();
        const data = await Server.getLocationDetail(currentLobbyId, locationId);
        if (!isCurrentSceneLoading(loadingToken)) return;
        setSceneLoadingLocationName(loadingToken, data.name);
        const networkMs = performance.now() - requestStartedAt;
        currentLocationData = data;
        setCurrentLocationId(locationId);

        // Скрываем глобальную 3D-сцену
        setLocationViewActive(true);
        hideGlobalCanvas();

        // Инициализируем сцену локации
        const initStartedAt = performance.now();
        initLocationScene('location-canvas');
        startLocationLoadDiagnostics(networkMs, performance.now() - initStartedAt);
        loadLocation(data);
        addLocationRoofButton();
        addLocationGridButton();
        addLocationFloorMenu();

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
        if (window.isGM) loadCombatStartRequests();

        if (window.isGM) {
            const locationWorldRules = await Server.getWorldRules(currentLobbyId).catch(() => ({ anomalies: [] }));
            if (!isCurrentSceneLoading(loadingToken)) return;
            window.locationAnomalyCatalog = locationWorldRules.anomalies || [];
            // Кнопки удаления и редактирования параметров
            addDeleteLocationButton(async () => { await deleteCurrentLocation(locationId); });
            setDeleteButtonVisible(true);
            addEditLocationButton(() => openLocationEditModal(currentLocationData));
            setEditButtonVisible(true);

            const toolsPanel = document.getElementById('panel-tools');
            if (toolsPanel) {
                toolsPanel.style.display = 'flex';
                const editorBuildingId = `building-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
                toolsPanel.classList.add('is-location-editor');
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
                        <label id="loc-grass-subtype-field" style="display: flex; align-items: center; gap: 5px;">
                            Подтип травы:
                            <select id="loc-grass-subtype" class="form-control" style="width: auto;">
                                <option value="plain">Обычная земля</option>
                                <option value="forest">Лесная подстилка</option>
                            </select>
                        </label>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>Радиус:</span>
                            <input type="range" id="loc-edit-radius" min="0" max="5" value="0">
                            <span id="loc-radius-value">0</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <span>Высота:</span>
                            <input type="range" id="loc-edit-height" min="-3.0" max="3.0" step="0.1" value="1.0">
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
                                <option value="box">Ящик</option>
                                <option value="military_crate">Военный ящик</option>
                                <option value="barrel">Бочка</option>
                                <option value="shelf">Стеллаж</option>
                                <option value="fence">Забор</option>
                            </select>
                            <label id="loc-structure-width-field">Ширина <input id="loc-structure-width" type="number" min="0.2" max="30" step="0.1" value="3" style="width:58px;"></label>
                            <label id="loc-structure-depth-field">Глубина <input id="loc-structure-depth" type="number" min="0.1" max="30" step="0.1" value="0.2" style="width:58px;"></label>
                            <label id="loc-structure-height-field">Высота <input id="loc-structure-height" type="number" min="0.1" max="20" step="0.1" value="2.4" style="width:58px;"></label>
                            <label>Здание <select id="loc-structure-building" class="form-control" style="width:auto;"></select></label>
                            <button type="button" id="loc-structure-new-building">Новое здание</button>
                            <button type="button" id="loc-restore-generated-floor" hidden>Восстановить пол дома</button>
                            <input id="loc-structure-building-id" type="hidden" value="${editorBuildingId}">
                            <label>Этаж размещения <select id="loc-structure-level" class="form-control" style="width:auto;"><option value="0">1</option><option value="1">2</option></select></label>
                            <label id="loc-structure-roof-type-field" style="display:none;">Крыша <select id="loc-structure-roof-type" class="form-control" style="width:auto;"><option value="gable">Двускатная</option><option value="flat">Плоская</option></select></label>
                            <label id="loc-structure-rotation-field">Поворот, ° <input id="loc-structure-rotation" class="form-control" type="number" min="0" max="359" step="15" value="0" style="width:72px;" title="Q / E: поворот на 15°"></label>
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
                                <option value="rock">🪨 Камень</option>
                                ${buildLocationAnomalyOptions(locationWorldRules.anomalies)}
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
                toolsRoot.className = 'map-editor map-editor-inspector-grid';
                toolsRoot.style.cssText = '';
                const createToolSection = (title, elements) => {
                    const section = document.createElement('section');
                    section.className = 'map-editor-section';
                    const heading = document.createElement('strong');
                    heading.textContent = title;
                    heading.className = 'map-editor-section-heading';
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
                    return section;
                };
                const sections = {
                    mode: createToolSection('Режим', ['loc-edit-toggle-checkbox']),
                    select: createToolSection('Выбор', []),
                    brush: createToolSection('Кисть', ['loc-edit-radius']),
                    terrain: createToolSection('Ландшафт', ['loc-edit-terrain', 'loc-grass-subtype']),
                    height: createToolSection('Высота', ['loc-edit-height']),
                    radiation: createToolSection('Радиация', ['loc-edit-radiation']),
                };
                const autoExpandLabel = document.createElement('label');
                autoExpandLabel.innerHTML = '<input type="checkbox" data-map-editor-auto-expand> Раскрывать панель при смене инструмента';
                sections.select.appendChild(autoExpandLabel);
                const selectionShortcuts = document.createElement('p');
                selectionShortcuts.className = 'map-editor-shortcuts';
                selectionShortcuts.textContent = 'Shift + клик: выбрать несколько · ПКМ: снять выделение · G: переместить · T: повернуть (Ctrl: вокруг центра группы, Shift: шаг 15°) · + / = / −: масштаб всех осей · H: скрыть / показать · Delete: удалить · R: размер одного объекта · Esc: отменить действие';
                sections.select.appendChild(selectionShortcuts);
                syncMapEditorAutoExpandCheckbox();
                const legacyControls = document.createElement('div');
                legacyControls.hidden = true;
                Array.from(toolsRoot.children)
                    .filter(node => !Object.values(sections).includes(node))
                    .forEach(node => legacyControls.appendChild(node));
                toolsRoot.appendChild(legacyControls);

                const toolbar = document.createElement('div');
                toolbar.className = 'map-editor-toolbar';
                toolbar.setAttribute('role', 'toolbar');
                toolbar.setAttribute('aria-label', 'Инструмент подлокации');
                toolbar.innerHTML = `
                    <button type="button" data-location-tool="select">Выбор</button>
                    <button type="button" data-location-tool="terrain">Ландшафт</button>
                    <button type="button" data-location-tool="height">Высота</button>
                    <button type="button" data-location-tool="radiation">Радиация</button>
                    <button type="button" data-location-tool="erase">Ластик</button>
                    <button type="button" data-location-tool="assets">Ассеты</button>
                    <button type="button" data-location-tool="light">Свет</button>
                `;
                const hint = document.createElement('p');
                hint.className = 'map-editor-hint';
                const shortcuts = document.createElement('p');
                shortcuts.className = 'map-editor-shortcuts';
                shortcuts.textContent = 'Q / 1–7: инструменты · V: выбор · B: ассеты · G: двигать · T: повернуть · E: редактор · R: размер / ластик';
                toolsRoot.prepend(toolbar);
                toolbar.after(hint);
                hint.after(shortcuts);

                const eraseSettings = document.createElement('section');
                eraseSettings.className = 'map-editor-section';
                eraseSettings.innerHTML = '<strong class="map-editor-section-heading">Ластик</strong><label><input type="checkbox" id="loc-erase-structures"> Также удалять постройки</label>';
                eraseSettings.hidden = true;
                toolsRoot.appendChild(eraseSettings);

                const waterSettings=waterProfileControls('loc');waterSettings.hidden=true;sections.terrain.appendChild(waterSettings);
                let activeAsset = null;
                let assetSection = null;
                let environmentSection = null;
                const selectLocationTool = tool => {
                    if (!['select', 'terrain', 'height', 'radiation', 'erase', 'assets', 'light'].includes(tool)) return;
                    cancelLocationAssetResize(false);
                    const previousTool = window.locationEditorTool;
                    if (previousTool === 'assets' && tool !== 'assets') {
                        activeAsset = null;
                        clearLocationAssetPreset();
                        setLocationHouseDrawMode(false);
                        assetSection?.querySelector('[data-house-draw]')?.setAttribute('aria-pressed', 'false');
                        renderAssetCards();
                    }
                    window.locationEditorTool = tool;
                    expandMapToolsPanelOnToolChange(previousTool, tool);
                    toolbar.querySelectorAll('button').forEach(button => {
                        button.setAttribute('aria-pressed', String(button.dataset.locationTool === tool));
                    });
                    Object.entries(sections).forEach(([name, section]) => {
                        section.hidden = name !== 'mode' && name !== tool
                            && !(name === 'brush' && ['terrain', 'height', 'radiation', 'erase'].includes(tool));
                    });
                    waterSettings.hidden = document.getElementById('loc-edit-terrain')?.value !== 'water';
                    eraseSettings.hidden = tool !== 'erase';
                    if (assetSection) assetSection.hidden = tool !== 'assets';
                    if (environmentSection) environmentSection.hidden = tool !== 'light';
                    setLocationDarknessOverlayVisible(tool === 'light');
                    if (tool !== 'assets') setLocationBuildMode('terrain');
                    else if (activeAsset) setLocationAssetPreset(activeAsset);
                    setLocationEraserMode(tool === 'erase');
                    if (tool !== 'assets') setLocationBrushObjectMode(false);
                    const radCheck = document.getElementById('loc-rad-mode');
                    if (radCheck) radCheck.checked = tool === 'radiation';
                    hint.textContent = {
                        select: 'Выберите объект или персонажа без рисования.',
                        assets: 'Выберите ассет в библиотеке, наведите на карту и кликните для размещения. ПКМ отменяет выбор ассета.',
                        terrain: 'Кликните по клетке или проведите кистью, чтобы сменить покрытие.',
                        height: 'Кликните по клетке или проведите кистью, чтобы изменить высоту.',
                        radiation: 'Кликните по клетке или проведите кистью, чтобы задать радиацию.',
                        light: 'Настройте освещение или закрасьте клетки без дневного света.',
                        erase: 'Удаляет декор. Поставьте галочку, чтобы удалять и постройки на выбранной клетке.',
                    }[tool];
                    renderPlacementSettings();
                    if (tool !== 'select' && !getLocationEditMode()) setLocationEditMode(true);
                };
                toolbar.addEventListener('click', event => {
                    const button = event.target.closest('[data-location-tool]');
                    if (button) selectLocationTool(button.dataset.locationTool);
                });
                window.selectLocationEditorTool = selectLocationTool;

                assetSection = document.createElement('section');
                assetSection.className = 'map-editor-section location-asset-library';
                assetSection.innerHTML = `
                    <div class="location-asset-library-heading">
                        <strong class="map-editor-section-heading">Библиотека ассетов</strong>
                        <span>Выберите карточку, затем место на карте</span>
                    </div>
                    <input class="form-control location-asset-search" type="search" placeholder="Найти ассет или аномалию" aria-label="Поиск по ассетам">
                    <div class="location-house-generator">
                        <button type="button" data-house-draw aria-pressed="false">Нарисовать дом</button>
                        <label>Seed <input class="form-control" data-house-seed type="text" value="0" maxlength="32"></label>
                        <span>Растяните контур ЛКМ по ровному участку, от 4×4 до 12×12 клеток. Мебель пока только из каталога: столы, стулья и стеллажи.</span>
                    </div>
                    <div class="location-asset-tabs"></div>
                    <div class="location-asset-grid"></div>
                    <div class="location-asset-placement" hidden>
                        <span data-placement-name></span>
                        <label><span data-placement-height-label>Высота от земли, м</span>
                            <input class="form-control" type="number" data-placement-height min="0" max="10" step="0.1">
                        </label>
                        <div class="location-asset-dimensions" data-placement-size>
                            <label>Длина X, м <input class="form-control" type="number" data-placement-dimension="width" min="0.05" max="30" step="any"></label>
                            <label>Ширина Z, м <input class="form-control" type="number" data-placement-dimension="depth" min="0.02" max="30" step="any"></label>
                            <label>Высота модели, м <input class="form-control" type="number" data-placement-dimension="height" min="0.05" max="20" step="any"></label>
                        </div>
                        <label data-placement-building-field style="display:none;">Здание <select class="form-control" data-placement-building></select></label>
                        <button type="button" data-placement-new-building style="display:none;">Новое здание</button>
                        <input type="hidden" data-placement-building-id value="${editorBuildingId}">
                        <label data-placement-level-field style="display:none;">Этаж размещения <select class="form-control" data-placement-level><option value="0">1</option><option value="1">2</option></select></label>
                        <label data-placement-roof-type-field style="display:none;">Крыша <select class="form-control" data-placement-roof-type><option value="gable">Двускатная</option><option value="flat">Плоская</option></select></label>
                        <span data-placement-angle style="display:none;">Поворот: 0° · Q/E: 15°</span>
                        <span class="location-asset-placement-hint">Наведите на карту и кликните для размещения · ПКМ: отмена</span>
                    </div>
                    <div class="location-asset-inspector"></div>
                `;
                toolsRoot.appendChild(assetSection);
                assetSection.hidden = window.locationEditorTool !== 'assets';
                const assetTabs = assetSection.querySelector('.location-asset-tabs');
                const assetGrid = assetSection.querySelector('.location-asset-grid');
                const assetInspector = assetSection.querySelector('.location-asset-inspector');
                sections.select.appendChild(assetInspector);
                const assetPlacement = assetSection.querySelector('.location-asset-placement');
                const placementHeight = assetPlacement.querySelector('[data-placement-height]');
                const assetSearch = assetSection.querySelector('.location-asset-search');
                const houseButton = assetSection.querySelector('[data-house-draw]');
                houseButton.onclick = () => {
                    const enabled = houseButton.getAttribute('aria-pressed') !== 'true';
                    if (enabled) {
                        activeAsset = null;
                        clearLocationAssetPreset();
                        renderAssetCards();
                        renderPlacementSettings();
                    }
                    selectLocationTool('assets');
                    setLocationHouseDrawMode(enabled);
                    houseButton.setAttribute('aria-pressed', String(enabled));
                    if (enabled) hint.textContent = 'Потяните ЛКМ от первого угла дома до противоположного; отпускание создаст комнаты.';
                };
                const anomalyAssets = (locationWorldRules.anomalies || []).map(anomaly => ({
                    id: `anomaly_${anomaly.key}`, group: 'Аномалии', kind: 'decor',
                    label: anomaly.name, icon: '✧', color: '#79d7dd',
                }));
                const allLocationAssets = [...LOCATION_ASSETS, ...anomalyAssets].filter(asset => !asset.hidden);
                const groups = [...new Set(allLocationAssets.map(asset => asset.group))];
                let activeGroup = 'Свет';
                const renderPlacementSettings = () => {
                    assetPlacement.hidden = !activeAsset || window.locationEditorTool !== 'assets';
                    if (!activeAsset) return;
                    assetPlacement.querySelector('[data-placement-name]').textContent = activeAsset.label;
                    placementHeight.value = activeAsset.kind === 'lamp'
                        ? activeAsset.height : activeAsset.elevation ?? 0;
                    placementHeight.max = activeAsset.kind === 'lamp'
                        ? String(10 - activeLevel * STOREY_HEIGHT) : '10';
                    assetPlacement.querySelector('[data-placement-height-label]').textContent = activeAsset.kind === 'lamp'
                        ? 'Высота над полом этажа, м' : 'Высота от уровня этажа, м';
                    assetPlacement.querySelector('[data-placement-size]').hidden = activeAsset.id?.startsWith('anomaly_');
                    assetPlacement.querySelector('[data-placement-building-field]').style.display = activeAsset.kind === 'structure' ? '' : 'none';
                    assetPlacement.querySelector('[data-placement-new-building]').style.display = activeAsset.kind === 'structure' ? '' : 'none';
                    assetPlacement.querySelector('[data-placement-level-field]').style.display =
                        ['structure', 'lamp'].includes(activeAsset.kind) ? '' : 'none';
                    assetPlacement.querySelector('[data-placement-roof-type-field]').style.display = activeAsset.id === 'floor' ? '' : 'none';
                    assetPlacement.querySelector('[data-placement-angle]').style.display = activeAsset.kind === 'structure'
                        || activeAsset.kind === 'decor' || activeAsset.lightKind === 'spot' ? '' : 'none';
                    const dimensions = assetDimensions(activeAsset, activeAsset.kind, activeAsset.lightKind || activeAsset.id);
                    assetPlacement.querySelectorAll('[data-placement-dimension]').forEach(input => {
                        input.value = dimensions[input.dataset.placementDimension];
                    });
                };
                assetPlacement.addEventListener('change', event => {
                    if (!event.target.matches('[data-placement-dimension]') || !activeAsset) return;
                    const dimensions = Object.fromEntries(Array.from(
                        assetPlacement.querySelectorAll('[data-placement-dimension]'),
                        input => [input.dataset.placementDimension, Number(input.value)],
                    ));
                    if (validAssetDimensions(dimensions)) {
                        activeAsset.dimensions = [dimensions.width, dimensions.depth, dimensions.height];
                        setLocationAssetDimensions(dimensions);
                    } else {
                        showNotification('Размеры объекта вне допустимого диапазона', 'system');
                    }
                    renderPlacementSettings();
                });
                placementHeight.addEventListener('change', () => {
                    if (!activeAsset) return;
                    const value = Math.min(Number(placementHeight.max), clampAssetElevation(placementHeight.value));
                    placementHeight.value = value;
                    if (activeAsset.kind === 'lamp') activeAsset.height = value;
                    else activeAsset.elevation = value;
                    setLocationAssetElevation(value);
                });
                const renderAssetCards = () => {
                    assetTabs.replaceChildren();
                    assetGrid.replaceChildren();
                    groups.forEach(group => {
                        const tab = document.createElement('button');
                        tab.type = 'button';
                        tab.textContent = group;
                        tab.setAttribute('aria-pressed', String(group === activeGroup));
                        tab.onclick = () => { activeGroup = group; renderAssetCards(); };
                        assetTabs.appendChild(tab);
                    });
                    const search = assetSearch.value.trim().toLocaleLowerCase('ru');
                    allLocationAssets.filter(asset => search
                        ? asset.label.toLocaleLowerCase('ru').includes(search)
                        : asset.group === activeGroup).forEach(asset => {
                        const card = document.createElement('button');
                        card.type = 'button';
                        card.className = 'location-asset-card';
                        card.setAttribute('aria-pressed', String(activeAsset?.id === asset.id));
                        const symbol = document.createElement('span');
                        symbol.className = 'location-asset-symbol';
                        symbol.style.setProperty('--asset-color', asset.color);
                        symbol.textContent = asset.icon;
                        const label = document.createElement('span');
                        label.textContent = asset.label;
                        card.append(symbol, label);
                        card.onclick = () => {
                            setLocationHouseDrawMode(false);
                            houseButton.setAttribute('aria-pressed', 'false');
                            if (activeAsset?.id === asset.id) {
                                activeAsset = null;
                                clearLocationAssetPreset();
                                renderPlacementSettings();
                            } else {
                                activeAsset = { ...asset };
                                selectLocationTool('assets');
                            }
                            renderAssetCards();
                        };
                        assetGrid.appendChild(card);
                    });
                };
                window.cancelLocationAssetPlacement = () => {
                    activeAsset = null;
                    clearLocationAssetPreset();
                    renderAssetCards();
                    renderPlacementSettings();
                };
                let activeBuildingId = editorBuildingId;
                let activeLevel = Math.min(1, getLocationViewLevel());
                const buildingSelectors = [document.getElementById('loc-structure-building'),
                    assetPlacement.querySelector('[data-placement-building]')];
                const buildingFields = [document.getElementById('loc-structure-building-id'),
                    assetPlacement.querySelector('[data-placement-building-id]')];
                const levelFields = [document.getElementById('loc-structure-level'),
                    assetPlacement.querySelector('[data-placement-level]')];
                const renderBuildingControls = () => {
                    const ids = getLocationBuildingIds();
                    for (const select of buildingSelectors) {
                        select.replaceChildren(...ids.map((id, index) => new Option(`Здание ${index + 1}`, id)));
                        if (!activeBuildingId) select.add(new Option('Старая постройка (без ID)', ''));
                        else if (!ids.includes(activeBuildingId)) select.add(new Option('Новое здание', activeBuildingId));
                        select.value = activeBuildingId;
                    }
                    for (const input of buildingFields) input.value = activeBuildingId;
                    for (const input of levelFields) input.value = String(activeLevel);
                    document.getElementById('loc-restore-generated-floor').hidden =
                        !canRestoreGeneratedLocationFloor(activeBuildingId, activeLevel);
                };
                const setActiveBuilding = (id, level = activeLevel) => {
                    activeBuildingId = id || '';
                    activeLevel = level === 1 ? 1 : 0;
                    renderBuildingControls();
                    if (activeAsset?.kind === 'lamp') {
                        const maxHeight = 10 - activeLevel * STOREY_HEIGHT;
                        if (activeAsset.height > maxHeight) {
                            activeAsset.height = maxHeight;
                            setLocationAssetElevation(maxHeight);
                        }
                    }
                    renderPlacementSettings();
                    refreshLocationBuildPreview();
                };
                for (const select of buildingSelectors) select.onchange = () => setActiveBuilding(select.value);
                for (const button of [document.getElementById('loc-structure-new-building'),
                    assetPlacement.querySelector('[data-placement-new-building]')]) {
                    button.onclick = () => setActiveBuilding(
                        `building-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`, 0);
                }
                for (const input of levelFields) input.onchange = () => {
                    setActiveBuilding(activeBuildingId, Number(input.value));
                    setLocationViewLevel(Number(input.value));
                };
                document.getElementById('loc-restore-generated-floor').onclick = async event => {
                    const button = event.currentTarget;
                    button.disabled = true;
                    try { await restoreGeneratedLocationFloor(activeBuildingId, activeLevel); }
                    finally { button.disabled = false; renderBuildingControls(); }
                };
                renderBuildingControls();
                const renderAssetSelection = () => {
                    const selection = getSelectedLocationEditorAsset();
                    if (selection?.kind === 'structure' && selection.selectedCount === 1) {
                        setActiveBuilding(selection.buildingId, selection.level);
                    }
                    const keepPreciseOpen = assetInspector.querySelector('.location-asset-precise')?.open || false;
                    assetInspector.replaceChildren();
                    if (!selection) {
                        const hint = document.createElement('p');
                        hint.textContent = 'Для настройки уже размещённого объекта выберите инструмент «Выбор» и кликните по нему.';
                        assetInspector.appendChild(hint);
                        return;
                    }
                    assetInspector.innerHTML = `
                        <div class="location-asset-selection-heading"><strong data-asset-name></strong><span data-asset-position></span></div>
                        <div class="location-asset-height-control">
                            <label>Высота от земли, м
                                <input class="form-control" type="number" data-asset-elevation min="0" max="10" step="0.1">
                            </label>
                            <button type="button" data-height-step="-0.25" aria-label="Опустить на 25 см">−</button>
                            <button type="button" data-height-step="0.25" aria-label="Поднять на 25 см">+</button>
                        </div>
                        <div class="location-asset-actions">
                            <button type="button" data-asset-action="move" title="G">Переместить</button>
                            <button type="button" data-asset-action="rotate" title="T">Повернуть на карте</button>
                            <button type="button" data-asset-action="resize" title="R">Изменить размер</button>
                            <button type="button" data-asset-action="hide" title="H">Скрыть</button>
                            <button type="button" data-asset-action="fire" hidden>Зажечь</button>
                            <button type="button" data-asset-action="delete">Удалить</button>
                        </div>
                        <div class="location-asset-dimensions" data-selected-size>
                            <label>Длина X, м <input class="form-control" type="number" data-selected-dimension="width" min="0.05" max="30" step="any"></label>
                            <label>Ширина Z, м <input class="form-control" type="number" data-selected-dimension="depth" min="0.02" max="30" step="any"></label>
                            <label>Высота модели, м <input class="form-control" type="number" data-selected-dimension="height" min="0.05" max="20" step="any"></label>
                        </div>
                        <div data-selected-building-fields style="display:none;">
                            <span data-selected-building-label></span>
                            <button type="button" data-add-floor hidden>Добавить этаж</button>
                            <button type="button" data-fit-floor hidden>Растянуть по форме здания</button>
                            <span data-fit-floor-reason hidden></span>
                            <details><summary>Принадлежность вручную</summary>
                                <label>ID здания <input class="form-control" type="text" maxlength="64" data-selected-building-id></label>
                                <label>Этаж <select class="form-control" data-selected-level><option value="0">1</option><option value="1">2</option></select></label>
                            </details>
                        </div>
                        <label data-selected-roof-type-field style="display:none;">Крыша <select class="form-control" data-selected-roof-type><option value="gable">Двускатная</option><option value="flat">Плоская</option></select></label>
                        <div class="location-asset-resize-tools" data-resize-tools hidden>
                            <strong data-resize-status></strong>
                            <span>Ось размера:</span>
                            <button type="button" data-resize-axis="all" title="Все оси">Все</button>
                            <button type="button" data-resize-axis="width" title="X">X</button>
                            <button type="button" data-resize-axis="depth" title="Z">Z</button>
                            <button type="button" data-resize-axis="height" title="Y">Y</button>
                            <span data-resize-hint>Volume Scale: тяните маркер грани. Shift: симметрично; Ctrl: шаг 0,1 м (пол: 1 м); Esc: отменить перетаскивание или выйти; отпустите ЛКМ: сохранить и выбрать следующую грань.</span>
                        </div>
                        <details class="location-asset-precise">
                            <summary>Точная настройка</summary>
                            <div class="location-asset-fields">
                                <label>X, м <input class="form-control" type="number" data-asset-field="x" step="0.1"></label>
                                <label>Z, м <input class="form-control" type="number" data-asset-field="z" step="0.1"></label>
                                <label data-angle-label>Угол, ° <input class="form-control" type="number" data-asset-field="rotation" step="1"></label>
                                <label data-lamp-field>Яркость <input class="form-control" type="number" data-asset-field="intensity" min="0" max="10" step="0.1"></label>
                                <label data-lamp-field>Радиус, м <input class="form-control" type="number" data-asset-field="distance" min="1" max="30" step="0.1"></label>
                                <label>Цвет <input class="form-control" type="color" data-asset-field="color"></label>
                            </div>
                            <button type="button" class="btn btn-secondary" data-asset-save>Сохранить параметры</button>
                        </details>
                    `;
                    assetInspector.querySelector('[data-asset-name]').textContent = selection.label;
                    if (selection.selectedCount > 1) {
                        assetInspector.querySelector('[data-asset-name]').textContent = `Выбрано объектов: ${selection.selectedCount}`;
                        assetInspector.querySelector('.location-asset-height-control').hidden = true;
                        assetInspector.querySelector('[data-asset-action="resize"]').hidden = true;
                        assetInspector.querySelector('[data-selected-size]').hidden = true;
                        assetInspector.querySelector('.location-asset-precise').hidden = true;
                    }
                    assetInspector.querySelector('[data-asset-action="hide"]').textContent = selection.hidden && selection.selectedCount === 1 ? 'Показать' : 'Скрыть / показать';
                    const fireButton = assetInspector.querySelector('[data-asset-action="fire"]');
                    fireButton.hidden = !selection.fire || selection.selectedCount !== 1;
                    fireButton.textContent = selection.electric
                        ? (selection.isLit ? 'Выключить' : 'Включить')
                        : (selection.isLit ? 'Потушить' : 'Зажечь');
                    if (keepPreciseOpen) assetInspector.querySelector('.location-asset-precise').open = true;
                    assetInspector.querySelector('[data-asset-position]').textContent = `Клетка ${Math.floor(selection.x)}, ${Math.floor(selection.z)}`;
                    const heightInput = assetInspector.querySelector('[data-asset-elevation]');
                    heightInput.value = selection.elevation ?? 0;
                    assetInspector.querySelectorAll('[data-lamp-field]').forEach(field => {
                        field.hidden = selection.kind !== 'lamp';
                    });
                    assetInspector.querySelector('[data-angle-label]').hidden = selection.kind === 'lamp' && selection.lightKind !== 'spot';
                    assetInspector.querySelector('[data-asset-action="resize"]').hidden = selection.selectedCount > 1 || !selection.resizable;
                    assetInspector.querySelector('[data-selected-size]').hidden = selection.selectedCount > 1 || !selection.resizable;
                    if (selection.resizable) assetInspector.querySelectorAll('[data-selected-dimension]').forEach(input => {
                        input.value = selection.dimensions[input.dataset.selectedDimension];
                    });
                    const buildingIdInput = assetInspector.querySelector('[data-selected-building-id]');
                    const levelInput = assetInspector.querySelector('[data-selected-level]');
                    assetInspector.querySelector('[data-selected-building-fields]').style.display = selection.kind === 'structure' && selection.selectedCount === 1 ? '' : 'none';
                    if (selection.kind === 'structure') {
                        buildingIdInput.value = selection.buildingId || '';
                        levelInput.value = String(selection.level);
                        const buildingNumber = getLocationBuildingIds().indexOf(selection.buildingId) + 1;
                        assetInspector.querySelector('[data-selected-building-label]').textContent = buildingNumber
                            ? `Здание ${buildingNumber} · этаж ${selection.level + 1}` : 'Старая постройка · без ID';
                    }
                    const addFloorButton = assetInspector.querySelector('[data-add-floor]');
                    addFloorButton.hidden = selection.selectedCount !== 1 || selection.structureType !== 'floor'
                        || selection.level !== 0;
                    addFloorButton.onclick = () => addFloorAboveSelectedLocationAsset();
                    const fitFloorButton = assetInspector.querySelector('[data-fit-floor]');
                    const fitFloorReason = assetInspector.querySelector('[data-fit-floor-reason]');
                    fitFloorButton.hidden = selection.selectedCount !== 1 || selection.structureType !== 'floor';
                    if (!fitFloorButton.hidden) {
                        const fit = getSelectedLocationFloorFit();
                        fitFloorButton.disabled = Boolean(fit.error);
                        fitFloorButton.title = fit.error || 'Используется замкнутый контур стен этого этажа';
                        fitFloorReason.hidden = !fit.error;
                        fitFloorReason.textContent = fit.error || '';
                        fitFloorButton.onclick = async () => {
                            fitFloorButton.disabled = true;
                            await fitSelectedLocationFloorToBuilding();
                            if (fitFloorButton.isConnected) renderAssetSelection();
                        };
                    }
                    const roofTypeInput = assetInspector.querySelector('[data-selected-roof-type]');
                    roofTypeInput.parentElement.style.display = selection.selectedCount === 1 && selection.roofType !== undefined ? '' : 'none';
                    if (selection.roofType !== undefined) roofTypeInput.value = selection.roofType;
                    for (const input of assetInspector.querySelectorAll('[data-asset-field]')) {
                        input.value = selection[input.dataset.assetField] ?? '';
                    }
                    const readFields = () => {
                        const fields = {};
                        for (const input of assetInspector.querySelectorAll('[data-asset-field]')) {
                            fields[input.dataset.assetField] = input.type === 'color' ? input.value : Number(input.value);
                        }
                        fields[selection.kind === 'lamp' ? 'height' : 'elevation'] = Number(heightInput.value);
                        if (selection.kind === 'structure') {
                            if (buildingIdInput.value.trim() !== (selection.buildingId || '')) fields.buildingId = buildingIdInput.value.trim();
                            if (Number(levelInput.value) !== selection.level) fields.level = Number(levelInput.value);
                        }
                        if (selection.roofType !== undefined) fields.roofType = roofTypeInput.value;
                        return fields;
                    };
                    for (const input of [buildingIdInput, levelInput]) input.onchange = async () => {
                        if (!await updateSelectedLocationAssetDetails(readFields())) renderAssetSelection();
                    };
                    roofTypeInput.onchange = async () => {
                        if (!await updateSelectedLocationAssetDetails(readFields())) renderAssetSelection();
                    };
                    if (selection.kind === 'lamp') {
                        assetInspector.querySelector('.location-asset-fields').addEventListener('input', () => {
                            previewSelectedLocationLamp(readFields());
                        });
                        heightInput.addEventListener('input', () => previewSelectedLocationLamp(readFields()));
                        assetInspector.querySelector('.location-asset-precise').addEventListener('toggle', event => {
                            if (!event.target.open) applyLocationLighting();
                        });
                    }
                    assetInspector.querySelector('[data-asset-action="move"]').onclick = () => beginMoveSelectedLocationAsset();
                    assetInspector.querySelector('[data-asset-action="rotate"]').onclick = () => beginRotateSelectedLocationAsset();
                    assetInspector.querySelector('[data-asset-action="resize"]').onclick = () => beginResizeSelectedLocationAsset();
                    assetInspector.querySelector('[data-asset-action="hide"]').onclick = () => toggleSelectedLocationAssetsHidden();
                    fireButton.onclick = () => toggleSelectedLocationFire();
                    assetInspector.querySelector('[data-asset-action="delete"]').onclick = () => deleteSelectedLocationAsset();
                    assetInspector.querySelectorAll('[data-resize-axis]').forEach(button => {
                        button.onclick = () => setLocationAssetResizeAxis(button.dataset.resizeAxis);
                    });
                    assetInspector.querySelector('[data-selected-size]').addEventListener('change', async event => {
                        if (!event.target.matches('[data-selected-dimension]')) return;
                        const dimensions = Object.fromEntries(Array.from(
                            assetInspector.querySelectorAll('[data-selected-dimension]'),
                            input => [input.dataset.selectedDimension, Number(input.value)],
                        ));
                        if (!validAssetDimensions(dimensions)) {
                            showNotification('Размеры объекта вне допустимого диапазона', 'system');
                            renderAssetSelection();
                            return;
                        }
                        cancelLocationAssetResize();
                        await updateSelectedLocationAssetDetails({
                            ...readFields(), dimensions,
                        });
                    });
                    assetInspector.querySelector('[data-asset-action="rotate"]').disabled = selection.selectedCount === 1
                        && selection.kind === 'lamp' && selection.lightKind !== 'spot';
                    let savingHeight = false;
                    const saveHeight = async value => {
                        if (savingHeight) return;
                        savingHeight = true;
                        const next = clampAssetElevation(value);
                        heightInput.value = next;
                        const details = {
                            x: selection.x, z: selection.z, rotation: selection.rotation,
                            height: selection.height, intensity: selection.intensity,
                            distance: selection.distance, color: selection.color,
                            elevation: selection.elevation,
                        };
                        details[selection.kind === 'lamp' ? 'height' : 'elevation'] = next;
                        const saved = await updateSelectedLocationAssetDetails(details);
                        if (!saved) {
                            heightInput.value = selection.elevation ?? 0;
                            if (selection.kind === 'lamp') applyLocationLighting();
                        }
                        savingHeight = false;
                    };
                    heightInput.addEventListener('change', () => saveHeight(heightInput.value));
                    assetInspector.querySelectorAll('[data-height-step]').forEach(button => {
                        button.onclick = () => saveHeight(Number(heightInput.value) + Number(button.dataset.heightStep));
                    });
                    assetInspector.querySelector('[data-asset-save]').onclick = async () => {
                        if (await updateSelectedLocationAssetDetails(readFields())) showNotification('Параметры обновлены', 'success');
                    };
                    const resizeState = getLocationAssetResizeState();
                    const resizeTools = assetInspector.querySelector('[data-resize-tools]');
                    resizeTools.hidden = !resizeState.active;
                    resizeTools.querySelector('[data-resize-status]').textContent = resizeState.active
                        ? `X: ${resizeState.dimensions.width.toFixed(2)} м  Y: ${resizeState.dimensions.height.toFixed(2)} м  Z: ${resizeState.dimensions.depth.toFixed(2)} м${resizeState.snapped ? '  ·  ПРИВЯЗКА Ctrl' : ''}`
                        : '';
                    if (selection.kind !== 'structure') {
                        resizeTools.querySelector('[data-resize-hint]').textContent =
                            'Двигайте курсор для изменения размера, ЛКМ — сохранить, Esc — отменить.';
                    }
                    resizeTools.querySelectorAll('[data-resize-axis]').forEach(button => {
                        button.setAttribute('aria-pressed', String(button.dataset.resizeAxis === resizeState.axis));
                    });
                    if (resizeState.active && resizeState.dimensions) {
                        assetInspector.querySelectorAll('[data-selected-dimension]').forEach(input => {
                            input.value = resizeState.dimensions[input.dataset.selectedDimension];
                        });
                    }
                };
                if (window.locationAssetSelectionHandler) {
                    window.removeEventListener('location-editor-selection', window.locationAssetSelectionHandler);
                }
                window.locationAssetSelectionHandler = renderAssetSelection;
                window.addEventListener('location-editor-selection', renderAssetSelection);
                if (window.locationBuildingListHandler) {
                    window.removeEventListener('location-editor-buildings-changed', window.locationBuildingListHandler);
                    window.removeEventListener('location-editor-active-building', window.locationActiveBuildingHandler);
                }
                window.locationBuildingListHandler = renderBuildingControls;
                window.locationActiveBuildingHandler = event => setActiveBuilding(event.detail.buildingId, event.detail.level);
                window.addEventListener('location-editor-buildings-changed', window.locationBuildingListHandler);
                window.addEventListener('location-editor-active-building', window.locationActiveBuildingHandler);
                if (window.locationAssetResizeHandler) {
                    window.removeEventListener('location-editor-resize', window.locationAssetResizeHandler);
                }
                window.locationAssetResizeHandler = event => {
                    const tools = assetInspector.querySelector('[data-resize-tools]');
                    if (!tools) return;
                    tools.hidden = !event.detail.active;
                    tools.querySelector('[data-resize-status]').textContent = event.detail.active
                        ? `X: ${event.detail.dimensions.width.toFixed(2)} м  Y: ${event.detail.dimensions.height.toFixed(2)} м  Z: ${event.detail.dimensions.depth.toFixed(2)} м${event.detail.snapped ? '  ·  ПРИВЯЗКА Ctrl' : ''}`
                        : '';
                    tools.querySelectorAll('[data-resize-axis]').forEach(button => {
                        button.setAttribute('aria-pressed', String(button.dataset.resizeAxis === event.detail.axis));
                    });
                    if (event.detail.active && event.detail.dimensions) {
                        assetInspector.querySelectorAll('[data-selected-dimension]').forEach(input => {
                            if (document.activeElement !== input) input.value = event.detail.dimensions[input.dataset.selectedDimension];
                        });
                    } else if (getSelectedLocationEditorAsset()) {
                        const dimensions = getSelectedLocationEditorAsset().dimensions;
                        assetInspector.querySelectorAll('[data-selected-dimension]').forEach(input => {
                            if (document.activeElement !== input) input.value = dimensions[input.dataset.selectedDimension];
                        });
                    }
                };
                window.addEventListener('location-editor-resize', window.locationAssetResizeHandler);
                assetSearch.addEventListener('input', renderAssetCards);
                renderAssetCards();
                renderAssetSelection();

                let darkTilesDraft = (currentLocationData.lighting?.dark_tiles || []).map(tile => ({ ...tile }));
                let darknessBrushMode = null;
                environmentSection = document.createElement('section');
                environmentSection.className = 'map-editor-section location-environment-section';
                environmentSection.innerHTML = `
                    <strong class="map-editor-section-heading">Свет и атмосфера</strong>
                    <div class="location-environment-body">
                        <div class="location-environment-editor"></div>
                        <div class="location-darkness-controls">
                            <strong>Тёмные области</strong>
                            <button type="button" data-darkness-brush="paint" aria-pressed="false">Затемнять клетки</button>
                            <button type="button" data-darkness-brush="erase" aria-pressed="false">Стереть затемнение</button>
                            <label class="location-darkness-radius">Размер кисти
                                <input type="range" data-darkness-radius min="0" max="5" value="0">
                                <output data-darkness-radius-value>1 × 1</output>
                            </label>
                            <span>Выберите кисть перед рисованием.</span>
                            <span data-darkness-count></span>
                        </div>
                        <div class="location-environment-actions">
                            <button type="button" class="btn btn-primary" data-save-environment>Сохранить свет</button>
                            <button type="button" class="btn btn-secondary" data-revert-environment>Отменить предпросмотр</button>
                            <span data-environment-status>Изменения видны на карте до сохранения</span>
                        </div>
                    </div>
                `;
                toolsRoot.appendChild(environmentSection);
                environmentSection.hidden = window.locationEditorTool !== 'light';
                const environmentStatus = environmentSection.querySelector('[data-environment-status]');
                let environmentEditor;
                const mountEnvironmentEditor = () => {
                    environmentEditor = createLocationLightingEditor(
                        environmentSection.querySelector('.location-environment-editor'),
                        currentLocationData.lighting,
                        settings => {
                            applyLocationLighting(settings, false);
                            environmentStatus.textContent = 'Предпросмотр: изменения ещё не сохранены';
                        },
                        () => currentLocationData.lighting?.local_lights || [],
                        () => darkTilesDraft,
                        getLocationLightingPreset,
                        setLocationLightingPreset,
                    );
                };
                mountEnvironmentEditor();
                const updateDarknessCount = () => {
                    environmentSection.querySelector('[data-darkness-count]').textContent = `Клеток: ${darkTilesDraft.length}`;
                };
                updateDarknessCount();
                const darknessRadiusInput = environmentSection.querySelector('[data-darkness-radius]');
                darknessRadiusInput.value = document.getElementById('loc-edit-radius')?.value || '0';
                environmentSection.querySelector('[data-darkness-radius-value]').textContent =
                    `${Number(darknessRadiusInput.value) * 2 + 1} × ${Number(darknessRadiusInput.value) * 2 + 1}`;
                darknessRadiusInput.oninput = event => {
                    setLocationBrushRadius(Number(event.target.value));
                };
                environmentSection.querySelectorAll('[data-darkness-brush]').forEach(button => {
                    button.onclick = () => {
                        darknessBrushMode = button.dataset.darknessBrush;
                        environmentSection.querySelectorAll('[data-darkness-brush]').forEach(item => {
                            item.setAttribute('aria-pressed', String(item === button));
                        });
                        selectLocationTool('light');
                    };
                });
                window.locationDarknessPaintAtTile = (x, z) => {
                    if (!darknessBrushMode) return;
                    const radius = Number(environmentSection.querySelector('[data-darkness-radius]').value);
                    const next = paintDarkTiles(darkTilesDraft, currentLocationData.grid_width,
                        currentLocationData.grid_height, x, z, radius, darknessBrushMode === 'erase');
                    if (next === darkTilesDraft) return;
                    darkTilesDraft = next;
                    previewLocationDarkTiles(darkTilesDraft);
                    updateDarknessCount();
                    environmentStatus.textContent = 'Предпросмотр: изменения ещё не сохранены';
                };
                environmentSection.querySelector('[data-revert-environment]').onclick = () => {
                    darkTilesDraft = (currentLocationData.lighting?.dark_tiles || []).map(tile => ({ ...tile }));
                    updateDarknessCount();
                    applyLocationLighting();
                    mountEnvironmentEditor();
                    environmentStatus.textContent = 'Изменения видны на карте до сохранения';
                };
                environmentSection.querySelector('[data-save-environment]').onclick = async () => {
                    const settings = environmentEditor.get();
                    try {
                        await Server.updateLocation(currentLobbyId, currentLocationData.id, { lighting: settings });
                        applyLocationLighting(settings);
                        darkTilesDraft = settings.dark_tiles.map(tile => ({ ...tile }));
                        updateDarknessCount();
                        environmentStatus.textContent = 'Свет сохранён';
                        showNotification('Освещение сохранено', 'success');
                    } catch (error) {
                        showNotification(error.message || 'Не удалось сохранить освещение');
                    }
                };

                // Получаем элементы
                const editCheckbox = document.getElementById('loc-edit-toggle-checkbox');
                const terrainSelect = document.getElementById('loc-edit-terrain');
                addTerrainMaterialOptions(terrainSelect);
                const grassSubtypeSelect = document.getElementById('loc-grass-subtype');
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
                waterSettings.hidden=terrainSelect.value!=='water';
                setLocationGrassSubtype(grassSubtypeSelect.value);

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
                const structureRoofTypeField = document.getElementById('loc-structure-roof-type-field');
                const structureRotationField = document.getElementById('loc-structure-rotation-field');
                const structureDefaults = {
                    wall: { width: 3, depth: 0.2, height: 2.4 },
                    floor: { width: 1, depth: 1, height: 0.12 },
                    door: { width: 0.9, depth: 0.18, height: 2 },
                    table: { width: 1.4, depth: 0.8, height: 1 },
                    chair: { width: 0.55, depth: 0.55, height: 1 },
                    box: { width: 0.8, depth: 0.8, height: 0.7 },
                    military_crate: { width: 1.1, depth: 0.8, height: 0.65 },
                    barrel: { width: 0.65, depth: 0.65, height: 1 },
                    shelf: { width: 1.2, depth: 0.4, height: 2 },
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
                    structureRoofTypeField.style.display = isFloor ? '' : 'none';
                    structureRotationField.style.display = '';
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
                if (structureRotation) structureRotation.onchange = (e) =>
                    setLocationStructureRotation(Number(e.target.value) * Math.PI / 180);
                if (structureColor) structureColor.oninput = (e) => setLocationStructureColor(e.target.value);
                applyStructurePreset(structurePreset.value);


                editCheckbox.checked = getLocationEditMode();

                // Обработчики
                editCheckbox.onchange = (e) => setLocationEditMode(e.target.checked);

                terrainSelect.onchange = (e) => {setLocationBrushTerrain(e.target.value);waterSettings.hidden=e.target.value!=='water';};
                grassSubtypeSelect.onchange = (e) => setLocationGrassSubtype(e.target.value);

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
                selectLocationTool('select');
            }
        } else {
            // Обычные игроки: скрываем панель инструментов
            const toolsPanel = document.getElementById('panel-tools');
            if (toolsPanel) toolsPanel.style.display = 'none';
        }
        finishSceneLoading(loadingToken);
    } catch (err) {
        if (!isCurrentSceneLoading(loadingToken)) return;
        failSceneLoading(loadingToken, 'Не удалось загрузить подлокацию.');
        showNotification(err.message);
    }
};

async function deleteCurrentLocation(locationId) {
    try {
        await Server.deleteLocation(currentLobbyId, locationId);
        showNotification('Локация удалена', 'success');
        if (Number(getCurrentLocationId()) === Number(locationId)) exitLocation();
        if (socket) socket.emit('get_markers', { token, lobby_id: currentLobbyId });
    } catch (err) {
        showNotification(err.message);
    }
}

window.exitLocation = function() {
    window.cancelCommonMapTool?.();
    closeMapEditorQuickMenu();
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
    window.locationEditorTool = 'select';
    delete window.selectLocationEditorTool;
    delete window.cancelLocationAssetPlacement;
    delete window.locationDarknessPaintAtTile;
    window.currentLocationId = null;
    window.currentLocationCharacterId = null;

    setLocationViewActive(false);
    showGlobalCanvas();

    setCurrentLocationId(null);
    currentLocationData = null;
    destroyLocationScene();

    // Удаляем кнопки удаления/редактирования
    const delBtn = document.getElementById('delete-location-btn');
    if (delBtn) delBtn.remove();
    const editBtn = document.getElementById('edit-location-btn');
    if (editBtn) editBtn.remove();
    document.getElementById('location-grid-btn')?.remove();
    document.getElementById('location-roof-btn')?.remove();
    document.getElementById('location-floor-menu')?.remove();
    document.getElementById('location-view-toggle-group')?.remove();

    // Восстанавливаем оригинальную панель инструментов (для глобальной карты)
    if (window.isGM && window._originalToolsContent) {
        const toolsPanel = document.getElementById('panel-tools');
        if (toolsPanel) {
            toolsPanel.classList.remove('is-location-editor');
            toolsPanel.querySelector('.panel-content').innerHTML = window._originalToolsContent;
            initWorldNumericInputs();
            window.refreshDirectWorldObjectEditor?.();
            syncMapEditorAutoExpandCheckbox();
            selectWorldEditorTool('select', { autoExpand: false });
            originalSetBrushRadiusFromInput(window.brushRadius);
            originalSetTileHeightFromInput(window.tileHeight);
            setWorldBrushRadiation(window.worldBrushRadiation ?? 0);
            document.getElementById('tile-type-select').value = window.currentTileType;
            setEditMode(getEditMode());
        }
    } else {
        const toolsPanel = document.getElementById('panel-tools');
        if (toolsPanel) toolsPanel.style.display = 'none';
    }

    // Принудительно обновляем глобальную карту
    resumeWorldMapLoad();
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
        <div class="modal-content" style="max-width: 620px;max-height:90vh;overflow:auto;">
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
            <div class="form-group" style="padding:10px 12px;border:1px solid rgba(172,75,57,.45);background:rgba(91,31,23,.16);border-radius:7px;">
                <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;">
                    <input type="checkbox" id="edit-loc-delete-structures" style="margin-top:3px;">
                    <span>
                        <strong>Удалить все созданные структуры</strong><br>
                        <small style="opacity:.75;">Будут удалены стены, полы, двери, мебель и контейнеры. Декор, аномалии и предметы на земле сохранятся.</small>
                    </span>
                </label>
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
        const deleteStructures = document.getElementById('edit-loc-delete-structures').checked;
        if (deleteStructures && !window.confirm('Удалить все созданные структуры этой локации? Отменить это действие после сохранения будет нельзя.')) {
            return;
        }
        let finalTiles = tempTiles;
        if (!finalTiles) finalTiles = locationData.tiles_data;
        if (newWidth !== locationData.grid_width || newHeight !== locationData.grid_height) {
            finalTiles = resizeTilesData(finalTiles, newWidth, newHeight);
        }
        try {
            const updates = {
                name: newName,
                grid_width: newWidth,
                grid_height: newHeight,
                delete_structures: deleteStructures,
            };
            if (tempTiles || newWidth !== locationData.grid_width || newHeight !== locationData.grid_height) {
                updates.tiles_data = finalTiles;
            }
            await Server.updateLocation(currentLobbyId, locationData.id, updates);
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

document.getElementById('panel-tools')?.addEventListener('click', event => {
    if (event.target.closest('#create-location-btn')) startLocationPick();
});
document.getElementById('confirm-create-location')?.addEventListener('click', createLocationFromModal);
document.getElementById('exit-location-btn')?.addEventListener('click', exitLocation);

// ========== Обработчики сокетов для локации ==========
if (socket) {
    socket.on('location_deleted', data => {
        if (Number(getCurrentLocationId()) !== Number(data.location_id)) return;
        showNotification('Открытая подлокация была удалена', 'system');
        window.exitLocation();
    });
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
                    s.is_mutant,
                    s.is_npc,
                    s.gm_hidden,
                    s.mutant_type,
                    s.posture,
                    s.prone_on_back,
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
        if (Number(data.location_id) === Number(getCurrentLocationId())) {
            import('./locationScene.js').then(module => module.addLocationObject(data.object));
        }
    });
    socket.on('location_object_deleted', (data) => {
        if (Number(data.location_id) === Number(getCurrentLocationId())) {
            import('./locationScene.js').then(module => module.removeLocationObject(data.object_id));
        }
    });
    socket.on('location_object_updated', (data) => {
        if (Number(data.location_id) === Number(getCurrentLocationId())) {
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
                data.character.is_mutant,
                data.character.is_npc,
                data.character.gm_hidden,
                data.character.mutant_type,
                data.character.posture,
                data.character.prone_on_back,
            );
        });
    });
    socket.on('location_character_removed', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => {
            module.removeCharacterFromLocation(data.character_id);
        });
    });
    socket.on('location_character_visibility_updated', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => {
            module.applyCharacterVisibilityUpdate(data.character_id, data.gm_hidden);
        });
    });
    socket.on('location_character_posture_updated', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => {
            module.applyCharacterPostureVisual(data.character_id, data.posture);
        });
    });
    socket.on('location_character_visual_pose_updated', (data) => {
        if (Number(data.location_id) !== Number(getCurrentLocationId())) return;
        import('./locationScene.js').then(module => {
            module.applyCharacterVisualPose(data.character_id, data.prone_on_back);
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
    socket.on('combat_start_requested', (data) => {
        showNotification(`${data.actor_name || 'Персонаж'} просит начать бой атакой`, 'system');
        handleCombatStartRequest(data);
    });
    socket.on('combat_start_request_resolved', handleCombatStartRequestResolved);
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
window.setWorldBrushRadiation = setWorldBrushRadiation;
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
    updateControl('weather-fog', settings.fog?.enabled || false, settings.fog?.intensity ?? 0.5);
    updateControl('weather-rain', settings.rain?.enabled || false, settings.rain?.intensity ?? 0.5);
    updateControl('weather-sun', settings.sun?.enabled || false, settings.sun?.intensity ?? 0.5);
    updateControl('weather-emission', settings.emission?.enabled || false, settings.emission?.intensity ?? 0.5);
};

window.updateWeatherValue = (id, value) => {
    const span = document.getElementById(id + '-value');
    if (span) span.textContent = parseFloat(value).toFixed(1);
};

function bindWeatherSliders() {
    const sliderIds = ['weather-fog-intensity', 'weather-rain-intensity', 'weather-sun-intensity', 'weather-emission-intensity'];
    sliderIds.forEach(id => {
        const slider = document.getElementById(id);
        const checkbox = document.getElementById(id.replace('-intensity', ''));
        if (slider) {
            slider.addEventListener('input', (e) => {
                window.updateWeatherValue(id.replace('-intensity', ''), e.target.value);
            });
            checkbox?.addEventListener('change', () => {
                slider.disabled = !checkbox.checked;
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

let sceneLoadingGeneration = 0;

function isCurrentSceneLoading(token) {
    return token === sceneLoadingGeneration;
}

function showSceneLoading(sceneType) {
    const token = ++sceneLoadingGeneration;
    const screen = document.getElementById('scene-loading-screen');
    if (!screen) return token;
    screen.classList.remove('is-hidden', 'is-error');
    document.getElementById('scene-loading-title').textContent =
        sceneType === 'location' ? 'Загрузка…' : 'Карта мира';
    document.getElementById('scene-loading-detail').textContent = sceneType === 'location'
        ? 'Разворачиваем рельеф, объекты и освещение.'
        : 'Загружаем сектора и собираем поверхность.';
    document.getElementById('scene-loading-retry').hidden = true;
    return token;
}

function setSceneLoadingLocationName(token, name) {
    if (!isCurrentSceneLoading(token)) return;
    document.getElementById('scene-loading-title').textContent = String(name || '').trim() || 'Загрузка…';
}

function finishSceneLoading(token) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (isCurrentSceneLoading(token)) {
            document.getElementById('scene-loading-screen')?.classList.add('is-hidden');
        }
    }));
}

function failSceneLoading(token, message) {
    if (!isCurrentSceneLoading(token)) return;
    const screen = document.getElementById('scene-loading-screen');
    if (!screen) return;
    screen.classList.remove('is-hidden');
    screen.classList.add('is-error');
    document.getElementById('scene-loading-title').textContent = 'Ошибка загрузки';
    document.getElementById('scene-loading-detail').textContent = message;
    document.getElementById('scene-loading-retry').hidden = false;
}

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
    const startupToken = showSceneLoading(directLocationId ? 'location' : 'world');
    try {
        await loadLobbyInfo();
        await loadLobbyCharacters();
        initHotkeys();
    } catch (error) {
        console.error('Lobby initialization failed', error);
        failSceneLoading(startupToken, 'Не удалось подготовить комнату.');
        return;
    }
    if (directLocationId) {
        await window.enterLocation(directLocationId);
        window.locationDirectOpenPending = false;
        if (!getCurrentLocationId()) {
            window.isLocationActive = false;
            resumeWorldMapLoad();
        }
    } else {
        resumeWorldMapLoad();
    }
    initWorldTravel(currentLobbyId, socket).catch(error => console.error('World travel load failed', error));

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
