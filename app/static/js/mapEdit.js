// static/js/mapEdit.js
import AppState from './ui_interactions.js';
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

export function initMapEdit(lobbyId, authToken) {
    currentLobbyId = lobbyId;
    token = authToken;

    const typeSelect = document.getElementById('tile-type-select');
    if (typeSelect) {
        typeSelect.addEventListener('change', (e) => {
            AppState.setCurrentTileType(e.target.value);
        });
    }

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

export function setEditMode(enabled) {
    AppState.setEditMode(enabled);
    import('./lobby3d.js').then(module => {
        module.setEditMode(enabled);
    });
    updateGMControlsVisibility();
    const btn = document.getElementById('edit-toggle');
    if (btn) {
        btn.style.background = AppState.editMode ? '#4a6fa5' : '';
    }
}

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
    if (gmControls) {
        gmControls.style.display = (AppState.isGM && AppState.editMode) ? 'flex' : 'none';
    }
}

function scheduleBatchUpdate() {
    if (batchUpdateTimeout) clearTimeout(batchUpdateTimeout);
    batchUpdateTimeout = setTimeout(() => {
        if (pendingTileUpdates.length > 0) {
            const updatesCopy = pendingTileUpdates.slice();
            pendingTileUpdates = [];
            Server.batchUpdateTiles(currentLobbyId, updatesCopy).catch(err => {
                showNotification(err.message);
            });
        }
    }, 500);
}

export function applyBrush(centerTile, updates, radius) {
    if (!AppState.isGM) {
        showNotification('Только ГМ может редактировать тайлы');
        return;
    }
    const allowedFields = ['terrain', 'height', 'objects'];
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
    const allowedFields = ['terrain', 'height', 'objects', 'name', 'radiation'];
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
    } catch (error) {
        showNotification(error.message);
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
        <p>Ландшафт: ${tileData.terrain}</p>
        <p>Высота: ${tileData.height}</p>
        <p>Объектов: ${tileData.objects ? tileData.objects.length : 0}</p>
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
                typeDisplay = `аномалия (${obj.anomalyType})`;
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
    document.getElementById('tile-edit-name').value = tileData.name || '';
    document.getElementById('tile-edit-radiation').value = tileData.radiation !== undefined ? tileData.radiation : 0;
    document.getElementById('tile-edit-radiation-value').textContent = (tileData.radiation !== undefined ? tileData.radiation : 0).toFixed(1);
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
    const anomalyType = getAnomalyTypeFromSelect(selectValue);
    if (anomalyType) {
        newObject = {
            type: 'anomaly',
            anomalyType: anomalyType,
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
    return map[value] || null;
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
    AppState.setEraserMode(checked);
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

export async function applyNameChange() {
    if (!currentEditTile) return;
    const newName = document.getElementById('tile-edit-name').value;
    await handleTileUpdate(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { name: newName }
    );
    const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
    const chunkEntry = chunksMap.get(chunkKey);
    if (chunkEntry) {
        currentEditTile.tileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
        updateTileEditModal();
    }
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
        anomalyType = anomalyTypeFromSelect;
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