// static/js/mapEdit.js
import AppState, {
    expandMapToolsPanelOnToolChange,
    setMapEditorAutoExpandEnabled,
    syncMapEditorAutoExpandCheckbox,
} from './ui_interactions.js';
import {
    getHoveredTile,
    updateTileInChunk,
    chunksMap,
    getObjectHeightOffset,
    getObjectDimensions,
    showObjectHighlight,
    hideObjectHighlight,
    createPreviewObject,
    updatePreviewObject,
    removePreviewObject
} from './lobby3d.js';
import { Server } from './api.js';
import { showNotification } from './utils.js';

const CHUNK_SIZE = 32;
let currentLobbyId;
let token;

let currentEditTile = null;
let pendingTileUpdates = [];
let batchUpdateTimeout = null;
let anomalyFieldCatalog = [];
let anomalyCatalog = [];
const WORLD_OBJECT_COLORS = {
    forest: '#315f3b', hamlet: '#aa8665', village: '#b39474',
    road: '#756f61', factory: '#66747b', base: '#6c765d', camp: '#9c8362',
    tree: '#2d5a27', house: '#8b4513', fence: '#8b5a2b',
};
const WORLD_OBJECT_TYPES = new Set(Object.keys(WORLD_OBJECT_COLORS));
const placingObjectTiles = new Set();
let selectedWorldObject = 'tree';
let lastPlacedObjectKey = null;
let lastPlacedObjectAt = 0;
let roadLinkActive = false;
let roadLinkFirst = null;
let roadLinkSaving = false;

const ANOMALY_TYPE_LABELS = {
    void: 'гравитационная',
    gravity: 'гравитационная',
    electric: 'электрическая',
    fire: 'термическая',
    thermal: 'термическая',
    radiation: 'радиационная',
    acid: 'химическая',
    chemical: 'химическая',
    psi: 'псионическая',
};

export function initMapEdit(lobbyId, authToken) {
    currentLobbyId = lobbyId;
    token = authToken;
    loadAnomalyFieldCatalog();

    document.getElementById('panel-tools')?.addEventListener('click', event => {
        const button = event.target.closest('[data-world-tool]');
        if (button) selectWorldEditorTool(button.dataset.worldTool);
        const objectButton = event.target.closest('[data-world-object]');
        if (objectButton) selectWorldObject(objectButton.dataset.worldObject);
        if (event.target.closest('#world-road-link-button')) {
            if (!roadLinkActive) selectWorldObject('road');
            toggleWorldRoadLink();
        }
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && roadLinkActive) toggleWorldRoadLink(false);
    });
    document.getElementById('panel-tools')?.addEventListener('change', event => {
        if (event.target.id === 'tile-type-select') AppState.setCurrentTileType(event.target.value);
        if (event.target.id === 'world-brush-radiation') setWorldBrushRadiation(event.target.value);
        if (event.target.matches('[data-map-editor-auto-expand]')) {
            setMapEditorAutoExpandEnabled(event.target.checked);
        }
    });
    syncMapEditorAutoExpandCheckbox();
    selectWorldEditorTool('select');
    for (const id of ['world-object-color', 'world-object-scale', 'world-object-rotation']) {
        document.getElementById(id)?.addEventListener('input', () => updateWorldObjectPreview(getHoveredTile()));
    }
    document.getElementById('object-type-select')?.addEventListener('change', event => {
        const color = document.getElementById('object-color');
        if (color && WORLD_OBJECT_COLORS[event.target.value]) {
            color.value = WORLD_OBJECT_COLORS[event.target.value];
            updatePreviewFromModal();
        }
    });

    const previewFields = [
        'object-type-select',
        'object-color',
        'object-offset-x',
        'object-offset-z',
        'object-scale',
        'object-rotation'
    ];
    previewFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updatePreviewFromModal);
            if (el.tagName === 'SELECT') {
                el.addEventListener('change', updatePreviewFromModal);
            }
        }
    });
}

async function loadAnomalyFieldCatalog() {
    const select = document.getElementById('tile-edit-anomaly-field');
    if (!select) return;
    try {
        const rules = await Server.getWorldRules(currentLobbyId);
        anomalyFieldCatalog = rules.anomaly_fields || [];
        anomalyCatalog = rules.anomalies || [];
        select.innerHTML = '<option value="">Нет аномального поля</option>'
            + anomalyFieldCatalog.map(field => (
                `<option value="${field.source_order}">${field.name} (${field.rank_min}-${field.rank_max})</option>`
            )).join('');
        updateAnomalyFieldRankOptions();
    } catch (error) {
        showNotification(`Не удалось загрузить аномальные поля: ${error.message}`, 'error');
    }
}

export function updateAnomalyFieldRankOptions() {
    const fieldSelect = document.getElementById('tile-edit-anomaly-field');
    const rankSelect = document.getElementById('tile-edit-anomaly-rank');
    if (!fieldSelect || !rankSelect) return;
    const field = anomalyFieldCatalog.find(item => String(item.source_order) === fieldSelect.value);
    rankSelect.disabled = !field;
    rankSelect.innerHTML = field
        ? Array.from(
            { length: field.rank_max - field.rank_min + 1 },
            (_, index) => field.rank_min + index,
        ).map(rank => `<option value="${rank}">${rank}</option>`).join('')
        : '<option value="">-</option>';
}

export function setEditMode(enabled) {
    AppState.setEditMode(enabled);
    if (!enabled) {
        toggleWorldRoadLink(false);
        removePreviewObject();
    }
    import('./lobby3d.js').then(module => {
        module.setEditMode(enabled);
    });
    updateGMControlsVisibility();
    const btn = document.getElementById('edit-toggle');
    if (btn) {
        btn.style.background = AppState.editMode ? '#4a6fa5' : '';
    }
}

export function selectWorldEditorTool(tool, { autoExpand = true } = {}) {
    const root = document.getElementById('gm-only-controls');
    if (!root || !['select', 'terrain', 'height', 'radiation', 'erase', 'objects'].includes(tool)) return;
    const previousTool = window.worldEditorTool;
    if (tool !== 'objects' && roadLinkActive) toggleWorldRoadLink(false);
    root.dataset.tool = tool;
    window.worldEditorTool = tool;
    if (autoExpand) expandMapToolsPanelOnToolChange(previousTool, tool);
    root.querySelectorAll('[data-world-tool]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.worldTool === tool));
    });
    if (tool === 'objects') updateWorldObjectPreview(getHoveredTile());
    else if (previousTool === 'objects') removePreviewObject();
    const eraser = document.getElementById('eraser-checkbox');
    if (eraser) eraser.checked = tool === 'erase';
    AppState.setEraserMode(tool === 'erase');
    const hint = document.getElementById('world-editor-hint');
    if (hint) hint.textContent = {
        select: 'Выбор без рисования. Двойной клик открывает настройки тайла.',
        terrain: 'Проведите кистью по карте, чтобы изменить покрытие.',
        height: 'Проведите кистью по карте, чтобы изменить высоту.',
        radiation: 'Проведите кистью по карте, чтобы изменить радиацию.',
        erase: 'Проведите по карте, чтобы удалить объекты с тайлов.',
        objects: 'Выберите объект и поставьте его кликом по карте. Двойной клик открывает точные настройки тайла.',
    }[tool];
}

export function selectWorldObject(type) {
    if (!WORLD_OBJECT_TYPES.has(type)) return;
    if (type !== 'road' && roadLinkActive) toggleWorldRoadLink(false);
    selectedWorldObject = type;
    document.querySelectorAll('[data-world-object]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.worldObject === type));
    });
    const color = document.getElementById('world-object-color');
    if (color) color.value = WORLD_OBJECT_COLORS[type];
    updateWorldObjectPreview(getHoveredTile());
}

function updateWorldRoadLinkStatus(message) {
    const button = document.getElementById('world-road-link-button');
    const status = document.getElementById('world-road-link-status');
    if (button) button.setAttribute('aria-pressed', String(roadLinkActive));
    if (status) status.textContent = message || 'Выберите две соседние клетки с дорогами.';
}

export function toggleWorldRoadLink(enabled = !roadLinkActive) {
    roadLinkActive = Boolean(enabled);
    roadLinkFirst = null;
    updateWorldRoadLinkStatus(roadLinkActive
        ? 'Кликните по первой дороге, затем по соседней дороге. Esc отменяет.'
        : null);
    updateWorldObjectPreview(getHoveredTile());
}

async function connectRoadAtTile(tile) {
    if (roadLinkSaving) return false;
    if (!tile.tileData.objects?.some(object => object.type === 'road')) {
        showNotification('На выбранной клетке нет дороги.');
        return false;
    }
    const point = [tile.chunkX * CHUNK_SIZE + tile.tileX, tile.chunkY * CHUNK_SIZE + tile.tileY];
    if (!roadLinkFirst) {
        roadLinkFirst = point;
        updateWorldRoadLinkStatus(`Первая дорога: (${point[0]}, ${point[1]}). Выберите соседнюю.`);
        return true;
    }
    if (point[0] === roadLinkFirst[0] && point[1] === roadLinkFirst[1]) return false;
    if (Math.max(Math.abs(point[0] - roadLinkFirst[0]), Math.abs(point[1] - roadLinkFirst[1])) !== 1) {
        showNotification('Для соединения выберите соседнюю клетку с дорогой.');
        return false;
    }
    roadLinkSaving = true;
    try {
        const result = await Server.connectWorldRoads(currentLobbyId, roadLinkFirst, point);
        for (const update of result.updates) {
            updateTileInChunk(update.chunk_x, update.chunk_y, update.tile_x, update.tile_y, update.updates);
        }
        roadLinkFirst = null;
        updateWorldRoadLinkStatus('Дороги соединены. Выберите следующую пару или нажмите Esc.');
        showNotification('Дороги соединены.', 'success');
        return true;
    } catch (error) {
        showNotification(error.message, 'error');
        return false;
    } finally {
        roadLinkSaving = false;
    }
}

function worldObjectSettings() {
    const scale = Math.max(0.2, Math.min(2, Number(document.getElementById('world-object-scale')?.value) || 1));
    const rotation = Math.max(0, Math.min(359, Number(document.getElementById('world-object-rotation')?.value) || 0));
    const scaleOutput = document.getElementById('world-object-scale-value');
    const rotationOutput = document.getElementById('world-object-rotation-value');
    if (scaleOutput) scaleOutput.textContent = scale.toFixed(2);
    if (rotationOutput) rotationOutput.textContent = `${rotation}°`;
    return { type: selectedWorldObject, color: document.getElementById('world-object-color')?.value
        || WORLD_OBJECT_COLORS[selectedWorldObject], scale, rotation };
}

export function updateWorldObjectPreview(tile) {
    if (document.getElementById('tile-edit-modal')?.style.display === 'flex') return;
    if (!AppState.isGM || !AppState.editMode || window.worldEditorTool !== 'objects' || !tile || roadLinkActive) {
        removePreviewObject();
        return;
    }
    const globalX = tile.chunk.chunkX * CHUNK_SIZE + tile.tileX + 0.5;
    const globalZ = tile.chunk.chunkY * CHUNK_SIZE + tile.tileY + 0.5;
    createPreviewObject({
        chunkX: tile.chunk.chunkX, chunkY: tile.chunk.chunkY,
        tileX: tile.tileX, tileY: tile.tileY, tileData: tile.tileData,
    }, {
        ...worldObjectSettings(),
        offsetX: Math.max(-0.49, Math.min(0.49, (tile.pointX ?? globalX) - globalX)),
        offsetZ: Math.max(-0.49, Math.min(0.49, (tile.pointZ ?? globalZ) - globalZ)),
    });
}

export async function placeWorldObjectAtTile(tile) {
    if (roadLinkActive) {
        return AppState.isGM && AppState.editMode && window.worldEditorTool === 'objects' && tile?.tileData
            ? connectRoadAtTile(tile) : false;
    }
    if (!AppState.isGM || !AppState.editMode || window.worldEditorTool !== 'objects'
        || !tile?.tileData || tile.tileData.terrain === 'water') {
        if (tile?.tileData?.terrain === 'water') showNotification('На воде этот объект разместить нельзя');
        return false;
    }
    const { chunkX, chunkY, tileX, tileY } = tile;
    const key = `${chunkX},${chunkY},${tileX},${tileY}`;
    if (placingObjectTiles.has(key) || (lastPlacedObjectKey === key && Date.now() - lastPlacedObjectAt < 400)) {
        return false;
    }
    placingObjectTiles.add(key);
    try {
        const globalX = chunkX * CHUNK_SIZE + tileX + 0.5;
        const globalZ = chunkY * CHUNK_SIZE + tileY + 0.5;
        const object = {
            ...worldObjectSettings(),
            x: Math.max(-0.49, Math.min(0.49, (tile.pointX ?? globalX) - globalX)),
            z: Math.max(-0.49, Math.min(0.49, (tile.pointZ ?? globalZ) - globalZ)),
        };
        const objects = [...(tile.tileData.objects || []), object];
        const saved = await handleTileUpdate(chunkX, chunkY, tileX, tileY, { objects });
        if (saved) {
            lastPlacedObjectKey = key;
            lastPlacedObjectAt = Date.now();
        }
        return saved;
    } finally {
        placingObjectTiles.delete(key);
    }
}

window.updateWorldObjectPreview = updateWorldObjectPreview;
window.placeWorldObjectAtTile = placeWorldObjectAtTile;
window.isWorldRoadLinkActive = () => roadLinkActive;

export function getEditMode() {
    return AppState.editMode;
}

export function setBrushRadius(radius) {
    AppState.setBrushRadius(radius);
    import('./lobby3d.js').then(module => module.setBrushRadius(radius));
}

export function toggleEraserMode(enabled) {
    AppState.setEraserMode(enabled);
}

export function getCurrentTileType() { return AppState.currentTileType; }
export function getTileHeight() { return AppState.tileHeight; }
export function getEraserMode() { return AppState.eraserMode; }

function updateGMControlsVisibility() {
    const gmControls = document.getElementById('gm-only-controls');
    const createLocationBtn = document.getElementById('create-location-btn');
    if (gmControls) {
        gmControls.style.display = (AppState.isGM && AppState.editMode) ? 'flex' : 'none';
    }
    if (createLocationBtn) {
        createLocationBtn.style.display = (AppState.isGM && AppState.editMode) ? 'inline-flex' : 'none';
    }
}

function scheduleBatchUpdate() {
    if (batchUpdateTimeout) clearTimeout(batchUpdateTimeout);
    batchUpdateTimeout = setTimeout(() => {
        if (pendingTileUpdates.length > 0) {
            const merged = new Map();
            for (const item of pendingTileUpdates) {
                const key = `${item.chunk_x},${item.chunk_y},${item.tile_x},${item.tile_y}`;
                const previous = merged.get(key);
                merged.set(key, previous
                    ? { ...item, updates: { ...previous.updates, ...item.updates } }
                    : item);
            }
            pendingTileUpdates = [];
            Server.batchUpdateTiles(currentLobbyId, [...merged.values()]).catch(err => {
                showNotification(err.message);
            });
        }
    }, 500);
}

export function applyBrush(centerTile, updates, radius) {
    if (document.getElementById('location-container')?.style.display === 'block') return;
    if (!AppState.isGM) {
        showNotification('Только ГМ может редактировать тайлы');
        return;
    }
    const allowedFields = ['terrain', 'height', 'radiation', 'objects'];
    const filteredUpdates = {};
    for (const key of allowedFields) {
        if (updates[key] !== undefined) {
            filteredUpdates[key] = updates[key];
        }
    }
    if (Object.keys(filteredUpdates).length === 0) return;

    let chunkX, chunkY, tileX, tileY;
    if (centerTile.chunk) {
        chunkX = centerTile.chunk.chunkX;
        chunkY = centerTile.chunk.chunkY;
        tileX = centerTile.tileX;
        tileY = centerTile.tileY;
    } else {
        chunkX = centerTile.chunkX;
        chunkY = centerTile.chunkY;
        tileX = centerTile.tileX;
        tileY = centerTile.tileY;
    }

    const centerGlobalX = chunkX * CHUNK_SIZE + tileX;
    const centerGlobalY = chunkY * CHUNK_SIZE + tileY;
    const maxChunkX = window.MAP_CHUNKS_WIDTH - 1;
    const maxChunkY = window.MAP_CHUNKS_HEIGHT - 1;
    const maxGlobalX = (maxChunkX + 1) * CHUNK_SIZE;
    const maxGlobalY = (maxChunkY + 1) * CHUNK_SIZE;

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            const targetGlobalX = centerGlobalX + dx;
            const targetGlobalY = centerGlobalY + dy;
            if (targetGlobalX < 0 || targetGlobalX >= maxGlobalX ||
                targetGlobalY < 0 || targetGlobalY >= maxGlobalY) {
                continue;
            }
            const targetChunkX = Math.floor(targetGlobalX / CHUNK_SIZE);
            const targetChunkY = Math.floor(targetGlobalY / CHUNK_SIZE);
            const targetTileX = targetGlobalX % CHUNK_SIZE;
            const targetTileY = targetGlobalY % CHUNK_SIZE;

            pendingTileUpdates.push({
                chunk_x: targetChunkX,
                chunk_y: targetChunkY,
                tile_x: targetTileX,
                tile_y: targetTileY,
                updates: filteredUpdates
            });
            updateTileInChunk(targetChunkX, targetChunkY, targetTileX, targetTileY, filteredUpdates);
        }
    }
    scheduleBatchUpdate();
}

export async function handleTileUpdate(chunkX, chunkY, tileX, tileY, updates) {
    if (!AppState.isGM) {
        showNotification('Только ГМ может редактировать тайлы');
        return;
    }
    const allowedFields = ['terrain', 'height', 'objects', 'name', 'radiation', 'anomaly_field'];
    const filteredUpdates = {};
    for (const key of allowedFields) {
        if (updates[key] !== undefined) {
            filteredUpdates[key] = updates[key];
        }
    }
    if (Object.keys(filteredUpdates).length === 0) return;

    try {
        await Server.updateTile(currentLobbyId, chunkX, chunkY, tileX, tileY, filteredUpdates);
        updateTileInChunk(chunkX, chunkY, tileX, tileY, filteredUpdates);
        return true;
    } catch (error) {
        showNotification(error.message);
        return false;
    }
}

export function openTileEditModal(tile) {
    if (!AppState.isGM) {
        showNotification('Только ГМ может редактировать тайлы');
        return;
    }
    currentEditTile = tile;
    updateTileEditModal();
    document.getElementById('tile-edit-modal').style.display = 'flex';
    updatePreviewFromModal();
}

export function closeTileEditModal() {
    document.getElementById('tile-edit-modal').style.display = 'none';
    hideObjectHighlight();
    removePreviewObject();
    currentEditTile = null;
}

function updateTileEditModal() {
    if (!currentEditTile) return;
    hideObjectHighlight();
    const tileData = currentEditTile.tileData;

    let infoHtml = `
        <p>Координаты: (${currentEditTile.chunkX * CHUNK_SIZE + currentEditTile.tileX}, ${currentEditTile.chunkY * CHUNK_SIZE + currentEditTile.tileY})</p>
        <p>Высота: ${tileData.height}</p>
        <p>Радиация: ${tileData.radiation ?? 0}</p>
    `;
    document.getElementById('tile-edit-info').innerHTML = infoHtml;

    const objectsListDiv = document.getElementById('tile-objects-list');
    if (!objectsListDiv) return;

    if (!tileData.objects || tileData.objects.length === 0) {
        objectsListDiv.innerHTML = '<p>Нет объектов</p>';
    } else {
        let listHtml = '<ul style="list-style: none; padding: 0; margin: 0;">';
        tileData.objects.forEach((obj, index) => {
            let typeDisplay = obj.type;
            if (obj.type === 'anomaly' && obj.anomalyType) {
                const anomalyName = obj.anomalyName || anomalyCatalog.find(
                    anomaly => anomaly.key === obj.anomalyKey
                )?.name;
                const anomalyType = ANOMALY_TYPE_LABELS[obj.anomalyCategory]
                    || ANOMALY_TYPE_LABELS[obj.anomalyType]
                    || 'неизвестного типа';
                typeDisplay = anomalyName
                    ? `аномалия «${anomalyName}» · ${anomalyType}`
                    : `аномалия · ${anomalyType}`;
            }
            listHtml += `
                <li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; padding: 3px; background: rgba(255,255,255,0.1); border-radius: 4px;"
                    onmouseenter="window.highlightObject(${index})"
                    onmouseleave="window.hideObjectHighlight()">
                    <span>${typeDisplay} (${obj.color})</span>
                    <button class="btn btn-sm btn-danger" onclick="window.removeObjectFromTile(${index})" style="padding: 2px 8px;">✕</button>
                </li>
            `;
        });
        listHtml += '</ul>';
        objectsListDiv.innerHTML = listHtml;
    }

    document.getElementById('tile-edit-terrain').value = tileData.terrain;
    document.getElementById('tile-edit-height').value = tileData.height;
    document.getElementById('tile-edit-height-value').textContent = tileData.height.toFixed(1);
    document.getElementById('tile-edit-radiation').value = tileData.radiation !== undefined ? tileData.radiation : 0;
    document.getElementById('tile-edit-radiation-value').textContent = (tileData.radiation !== undefined ? tileData.radiation : 0).toFixed(1);
    const fieldSelect = document.getElementById('tile-edit-anomaly-field');
    const selectedField = anomalyFieldCatalog.find(field => field.name === tileData.anomaly_field?.name);
    if (fieldSelect) fieldSelect.value = selectedField ? String(selectedField.source_order) : '';
    updateAnomalyFieldRankOptions();
    const rankSelect = document.getElementById('tile-edit-anomaly-rank');
    if (rankSelect && selectedField) rankSelect.value = String(tileData.anomaly_field?.rank || selectedField.rank_min);
}

export async function applyAnomalyFieldChange() {
    if (!currentEditTile) return;
    const sourceOrder = document.getElementById('tile-edit-anomaly-field')?.value;
    const profile = anomalyFieldCatalog.find(field => String(field.source_order) === sourceOrder);
    const rank = Number(document.getElementById('tile-edit-anomaly-rank')?.value || 0);
    const anomalyField = profile ? {
        name: profile.name,
        field_type: profile.field_type,
        hazard: profile.hazard,
        rank: Math.max(profile.rank_min, Math.min(profile.rank_max, rank)),
    } : null;
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { anomaly_field: anomalyField },
    );
    currentEditTile.tileData.anomaly_field = anomalyField;
    updateTileEditModal();
    showNotification(anomalyField ? 'Аномальное поле сохранено' : 'Аномальное поле удалено', 'success');
}

export async function applyTerrainChange() {
    if (!currentEditTile) return;
    const newTerrain = document.getElementById('tile-edit-terrain').value;
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { terrain: newTerrain }
    );
    const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
    const chunkEntry = chunksMap.get(chunkKey);
    if (chunkEntry) {
        currentEditTile.tileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
        updateTileEditModal();
    }
}

export async function applyHeightChange() {
    if (!currentEditTile) return;
    const newHeight = parseFloat(document.getElementById('tile-edit-height').value);
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { height: newHeight }
    );
    const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
    const chunkEntry = chunksMap.get(chunkKey);
    if (chunkEntry) {
        currentEditTile.tileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
        updateTileEditModal();
    }
}

export async function addObjectToTile() {
    if (!currentEditTile) return;
    const tile = currentEditTile.tileData;
    const selectValue = document.getElementById('object-type-select').value;
    const color = document.getElementById('object-color').value;
    const offsetX = parseFloat(document.getElementById('object-offset-x').value) || 0;
    const offsetZ = parseFloat(document.getElementById('object-offset-z').value) || 0;
    const scale = parseFloat(document.getElementById('object-scale').value) || 1.0;
    const rotation = parseInt(document.getElementById('object-rotation').value) || 0;

    let newObject;
    const anomaly = getAnomalyTypeFromSelect(selectValue);
    if (anomaly) {
        newObject = {
            type: 'anomaly',
            anomalyType: anomaly.visual,
            anomalyKey: anomaly.key,
            anomalyName: anomaly.name || anomaly.key,
            anomalyRank: anomaly.rank || null,
            anomalyCategory: anomaly.category || null,
            x: offsetX,
            z: offsetZ,
            scale: scale,
            rotation: rotation,
            color: color
        };
    } else {
        newObject = {
            type: selectValue,
            x: offsetX,
            z: offsetZ,
            scale: scale,
            rotation: rotation,
            color: color
        };
    }

    const objects = tile.objects ? [...tile.objects, newObject] : [newObject];
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { objects: objects }
    );
    const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
    const chunkEntry = chunksMap.get(chunkKey);
    if (chunkEntry) {
        currentEditTile.tileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
        updateTileEditModal();
    }
    removePreviewObject();
}

export async function clearObjectsFromTile() {
    if (!currentEditTile) return;
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { objects: [] }
    );
    const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
    const chunkEntry = chunksMap.get(chunkKey);
    if (chunkEntry) {
        currentEditTile.tileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
        updateTileEditModal();
    }
    removePreviewObject();
}

export async function removeObjectFromTile(index) {
    if (!currentEditTile) return;
    const objects = currentEditTile.tileData.objects ? [...currentEditTile.tileData.objects] : [];
    if (index < 0 || index >= objects.length) return;
    objects.splice(index, 1);
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { objects: objects }
    );
    const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
    const chunkEntry = chunksMap.get(chunkKey);
    if (chunkEntry) {
        currentEditTile.tileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
        updateTileEditModal();
    }
    removePreviewObject();
}

export function highlightObject(index) {
    if (!currentEditTile) return;
    const tileData = currentEditTile.tileData;
    const obj = tileData.objects[index];
    if (!obj) return;

    const worldX = currentEditTile.chunkX * CHUNK_SIZE + currentEditTile.tileX + 0.5 + (obj.x || 0);
    const worldZ = currentEditTile.chunkY * CHUNK_SIZE + currentEditTile.tileY + 0.5 + (obj.z || 0);
    const height = tileData.height || 1.0;
    const yOffset = getObjectHeightOffset(obj.type, obj.anomalyType);
    const worldY = height + yOffset * (obj.scale || 1.0);
    const dimensions = getObjectDimensions(obj.type, obj.anomalyType, obj.scale || 1.0);
    showObjectHighlight(worldX, worldY, worldZ, dimensions);
}

function getAnomalyTypeFromSelect(value) {
    const map = {
        'anomaly_electric': 'electric',
        'anomaly_fire': 'fire',
        'anomaly_acid': 'acid',
        'anomaly_void': 'void'
    };
    if (map[value]) return { visual: map[value], key: null };
    if (!String(value).startsWith('anomaly_')) return null;
    const key = String(value).slice('anomaly_'.length);
    const electric = ['vspishka', 'pautina', 'tesla', 'katushka', 'kapkan', 'paralizator', 'akkumulyator', 'ionny_tuman'];
    const thermal = ['banya', 'parilka', 'mochalka', 'kipyatilnik', 'morozilnik', 'uley', 'metelitsa', 'gril'];
    const radiation = ['zarosli', 'svetlyachki', 'mor', 'zapovednik', 'mertvy_koster', 'solyariy', 'radioaktivny_roy', 'bagrovaya_luna'];
    const chemical = ['varevo', 'soda', 'ezhinoe_oblako', 'rzhavchina', 'mogilshchik', 'chuma', 'myshelovka', 'gniloy_razlom'];
    const psi = ['ekho', 'mirazh', 'starshina', 'tuman_poteryannykh', 'tma', 'piyavka', 'kolodets', 'mozgotrobilka'];
    const visual = electric.includes(key) ? 'electric'
        : thermal.includes(key) ? 'fire'
            : radiation.includes(key) ? 'radiation'
                : chemical.includes(key) ? 'acid'
                    : psi.includes(key) ? 'psi' : 'void';
    const profile = anomalyCatalog.find(anomaly => anomaly.key === key);
    return {
        visual: profile?.visual || visual,
        key,
        name: profile?.name || key,
        rank: profile?.rank || null,
        category: profile?.category || null,
    };
}

export function setBrushRadiusFromInput(value) {
    AppState.setBrushRadius(parseInt(value));
    document.getElementById('brush-radius-value').textContent = AppState.brushRadius;
    document.getElementById('brush-radius').value = AppState.brushRadius;
    setBrushRadius(AppState.brushRadius);
}

export function setTileHeightFromInput(value) {
    AppState.setTileHeight(parseFloat(value));
    document.getElementById('tile-height-value').textContent = AppState.tileHeight.toFixed(1);
    document.getElementById('tile-height').value = AppState.tileHeight;
}

export function setEraserModeFromInput(checked) {
    selectWorldEditorTool(checked ? 'erase' : 'select');
}

export function setWorldBrushRadiation(value) {
    const radiation = Math.max(0, Math.min(10, Number(value) || 0));
    window.worldBrushRadiation = radiation;
    const output = document.getElementById('world-brush-radiation-value');
    if (output) output.textContent = radiation.toFixed(1);
}

export function updateTileEditHeight(value) {
    document.getElementById('tile-edit-height-value').textContent = parseFloat(value).toFixed(1);
}

export function updateObjectOffsetX(value) {
    document.getElementById('object-offset-x-value').textContent = parseFloat(value).toFixed(2);
    updatePreviewFromModal();
}

export function updateObjectOffsetZ(value) {
    document.getElementById('object-offset-z-value').textContent = parseFloat(value).toFixed(2);
    updatePreviewFromModal();
}

export function updateObjectScale(value) {
    document.getElementById('object-scale-value').textContent = parseFloat(value).toFixed(2);
    updatePreviewFromModal();
}

export function updateObjectRotation(value) {
    document.getElementById('object-rotation-value').textContent = value + '°';
    updatePreviewFromModal();
}

export function updateTileEditRadiation(value) {
    document.getElementById('tile-edit-radiation-value').textContent = parseFloat(value).toFixed(1);
}

export async function applyRadiationChange() {
    if (!currentEditTile) return;
    const newRadiation = parseFloat(document.getElementById('tile-edit-radiation').value);
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { radiation: newRadiation }
    );
    const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
    const chunkEntry = chunksMap.get(chunkKey);
    if (chunkEntry) {
        currentEditTile.tileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
        updateTileEditModal();
    }
}

function updatePreviewFromModal() {
    if (!currentEditTile) return;
    const selectValue = document.getElementById('object-type-select').value;
    const color = document.getElementById('object-color').value;
    const offsetX = parseFloat(document.getElementById('object-offset-x').value) || 0;
    const offsetZ = parseFloat(document.getElementById('object-offset-z').value) || 0;
    const scale = parseFloat(document.getElementById('object-scale').value) || 1.0;
    const rotation = parseInt(document.getElementById('object-rotation').value) || 0;

    let type, anomalyType;
    const anomalyTypeFromSelect = getAnomalyTypeFromSelect(selectValue);
    if (anomalyTypeFromSelect) {
        type = 'anomaly';
        anomalyType = anomalyTypeFromSelect.visual;
    } else {
        type = selectValue;
        anomalyType = null;
    }

    const params = {
        type,
        anomalyType,
        color,
        offsetX,
        offsetZ,
        scale,
        rotation
    };
    createPreviewObject(currentEditTile, params);
}

window.applyBrush = applyBrush;
