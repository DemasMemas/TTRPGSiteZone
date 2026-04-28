// static/js/main.js
import { initSocket } from './socketHandlers.js';
import { initCharacters, loadLobbyCharacters, showCreateCharacterForm } from './characters.js';
import { initLobbyData, loadLobbyInfo, loadAllChunks } from './lobbyData.js';
import { setCurrentLobbyId, toggleParticipants, toggleSettings, showSettingsTab, closeVisibilityModal,
saveVisibility, unbanUserHandler, closeSettings, openSettings } from './ui.js';
import { initMapEdit, setEditMode, setBrushRadius, toggleEraserMode, applyBrush, openTileEditModal, closeTileEditModal,
 applyTerrainChange, applyHeightChange, addObjectToTile, clearObjectsFromTile, removeObjectFromTile, highlightObject,
 getEditMode, setBrushRadiusFromInput, setTileHeightFromInput, setEraserModeFromInput, updateTileEditHeight,
 updateObjectOffsetX, updateObjectOffsetZ, updateObjectScale, updateObjectRotation,
 applyNameChange, applyRadiationChange, updateTileEditRadiation} from './mapEdit.js';
import { hideObjectHighlight, camera, getHoveredTile } from './lobby3d.js';
import { showNotification, getErrorMessage } from './utils.js';
import { Server } from './api.js';
import AppState, { initDraggablePanels, initHotkeys } from './ui_interactions.js';
import { initWeather, applyWeather } from './weather.js';
import { initMarkers, setupMarkerInteraction, closeMarkerEditModal, saveMarkerEdit, submitCreateMarker,
openCreateMarkerModal, openCreateMarkerModalAtCenter, fillCenterCoordinates, deleteMarker,
fillEditCenterCoordinates, pickTileForMarker } from './markers.js';
import { openCharacterSheet, closeCharacterSheet, exportCharacter, importCharacter } from './characterSheet.js';
import { setCurrentLobbyId as setCharLobbyId } from './characterSheet.js';
import { initLocationScene, loadLocation, updateCharacterPosition, setCurrentLocationId, getCurrentLocationId,
 addDeleteLocationButton, setDeleteButtonVisible, addEditLocationButton, setEditButtonVisible, destroyLocationScene } from './locationScene.js';
import * as THREE from 'three';

initWeather();

const token = localStorage.getItem('access_token');
const pathParts = window.location.pathname.split('/').filter(p => p !== '');
let currentLobbyId = null;

if (pathParts.length >= 2 && pathParts[0] === 'lobbies') {
    currentLobbyId = pathParts[1];
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
initMapEdit(currentLobbyId, token);
const socket = initSocket(currentLobbyId, token);

// Инициализация маркеров
initMarkers(currentLobbyId, token, socket);
setupMarkerInteraction();

// Глобальные функции для onclick
window.sendMessage = () => {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message) return;
    socket.emit('send_message', { token, lobby_id: currentLobbyId, message });
    input.value = '';
};

window.leaveLobby = async () => {
    if (!confirm('Покинуть комнату?')) return;
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/leave`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            socket.disconnect();
            window.location.href = '/';
        } else {
            const err = await response.json();
            showNotification(getErrorMessage(err));
        }
    } catch (error) {
        showNotification('Ошибка сети');
    }
};

window.toggleParticipants = toggleParticipants;
window.toggleSettings = toggleSettings;
window.showSettingsTab = showSettingsTab;
window.closeSettings = closeSettings;
window.openSettings = openSettings;
window.closeVisibilityModal = closeVisibilityModal;
window.saveVisibility = saveVisibility;
window.unbanUserHandler = unbanUserHandler;

window.openCharacterSheet = openCharacterSheet;
window.closeCharacterSheet = closeCharacterSheet;
window.exportCharacter = exportCharacter;
window.importCharacter = importCharacter;

window.addSpecialTrait = window.addSpecialTrait || (() => {});
window.removeSpecialTrait = window.removeSpecialTrait || (() => {});
window.addWeapon = window.addWeapon || (() => {});
window.removeWeapon = window.removeWeapon || (() => {});
window.addPocketItem = window.addPocketItem || (() => {});
window.removePocketItem = window.removePocketItem || (() => {});
window.addBackpackItem = window.addBackpackItem || (() => {});
window.removeBackpackItem = window.removeBackpackItem || (() => {});

// Функции редактирования карты
window.toggleEditMode = () => setEditMode(!getEditMode());
window.setEditMode = setEditMode;
window.toggleEraserMode = toggleEraserMode;
window.applyBrush = applyBrush;
window.openTileEditModal = openTileEditModal;
window.closeTileEditModal = closeTileEditModal;
window.applyTerrainChange = applyTerrainChange;
window.applyHeightChange = applyHeightChange;
window.addObjectToTile = addObjectToTile;
window.clearObjectsFromTile = clearObjectsFromTile;
window.removeObjectFromTile = removeObjectFromTile;
window.highlightObject = highlightObject;
window.hideObjectHighlight = hideObjectHighlight;

window.showNotification = showNotification;

window.setBrushRadiusFromInput = setBrushRadiusFromInput;
window.setTileHeightFromInput = setTileHeightFromInput;
window.setEraserModeFromInput = setEraserModeFromInput;
window.applyNameChange = applyNameChange;
window.applyRadiationChange = applyRadiationChange;
window.updateTileEditRadiation = updateTileEditRadiation;

// Функции для модального окна
window.updateTileEditHeight = updateTileEditHeight;
window.updateObjectOffsetX = updateObjectOffsetX;
window.updateObjectOffsetZ = updateObjectOffsetZ;
window.updateObjectScale = updateObjectScale;
window.updateObjectRotation = updateObjectRotation;

window.showCreateCharacterForm = showCreateCharacterForm;

// Маркеры
window.closeMarkerEditModal = closeMarkerEditModal;
window.saveMarkerEdit = saveMarkerEdit;
window.submitCreateMarker = submitCreateMarker;
window.openCreateMarkerModal = openCreateMarkerModal;
window.openCreateMarkerModalAtCenter = openCreateMarkerModalAtCenter;
window.fillCenterCoordinates = fillCenterCoordinates;
window.addMarkerAtCenter = openCreateMarkerModal;
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

document.querySelectorAll('#weather-settings input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', (e) => {
        const range = e.target.closest('.weather-control').querySelector('input[type="range"]');
        if (range) range.disabled = !e.target.checked;
    });
});

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

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let currentLocationData = null;

// Функция входа в локацию
window.enterLocation = async function(locationId) {
    try {
        if (typeof window.resetHoveredMarker === 'function') {
            window.resetHoveredMarker();
        }
        const data = await Server.getLocationDetail(currentLobbyId, locationId);
        currentLocationData = data;
        setCurrentLocationId(locationId);
        document.getElementById('canvas-container').style.display = 'none';
        document.getElementById('location-container').style.display = 'block';
        initLocationScene('location-canvas');
        loadLocation(data);

        if (window.isGM) {
            const delBtn = addDeleteLocationButton(async () => {
                if (confirm('Удалить эту локацию? Это действие необратимо.')) {
                    await deleteCurrentLocation(locationId);
                }
            });
            setDeleteButtonVisible(true);
            addEditLocationButton(() => openLocationEditModal(currentLocationData));
            setEditButtonVisible(true);
        }
    } catch (err) {
        showNotification(err.message);
    }
};

async function deleteCurrentLocation(locationId) {
    try {
        await Server.deleteLocation(currentLobbyId, locationId);
        showNotification('Локация удалена', 'success');
        exitLocation(); // выходим из локации и возвращаемся на карту
        // Обновляем маркеры локаций
        if (socket) socket.emit('get_markers', { token, lobby_id: currentLobbyId });
    } catch (err) {
        showNotification(err.message);
    }
}

// Выход из локации
window.exitLocation = function() {
    const locationId = getCurrentLocationId();
    const characterId = window.currentCharacterId;
    if (socket && characterId) {
        socket.emit('leave_location', {
            token: localStorage.getItem('access_token'),
            location_id: locationId,
            character_id: characterId
        });
    }
    document.getElementById('location-container').style.display = 'none';
    document.getElementById('canvas-container').style.display = 'block';
    setCurrentLocationId(null);
    currentLocationData = null;
    // Уничтожаем сцену локации
    if (typeof destroyLocationScene === 'function') {
        destroyLocationScene();
    }
    // Удаляем кнопки управления локацией, чтобы при новом входе они создались заново
    const delBtn = document.getElementById('delete-location-btn');
    if (delBtn) delBtn.remove();
    const editBtn = document.getElementById('edit-location-btn');
    if (editBtn) editBtn.remove();
};

// Обработчики WebSocket для локации
if (socket) {
    socket.on('joined_location', (data) => {
        console.log('Joined location', data);
        updateCharacterPosition(data.character_id, data.x, data.y);
    });
    socket.on('location_state', (state) => {
        state.forEach(s => updateCharacterPosition(s.character_id, s.x, s.y));
    });
    socket.on('character_moved', (data) => {
        updateCharacterPosition(data.character_id, data.x, data.y);
    });
}

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

// Обработчик кнопки "Создать локацию" – открываем модальное окно и выбираем тайл
let selectedTileForLocation = null;

function openLocationCreateModal(tile) {
    selectedTileForLocation = tile;
    const modal = document.getElementById('location-create-modal');
    if (!modal) {
        showNotification('Ошибка: окно создания локации не найдено');
        return;
    }

    // Определяем тип тайла на карте и сопоставляем с опциями в модалке
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

    // Сброс значений
    document.getElementById('new-loc-name').value = '';
    document.getElementById('new-loc-terrain').value = suggestedTerrainOption;
    document.getElementById('new-loc-width').value = 30;
    document.getElementById('new-loc-height').value = 30;
    document.getElementById('new-loc-gen-objects').checked = true;
    modal.style.display = 'flex';
}

// Функция создания локации (вызывается из модалки)
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
    // Ограничения
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

// Привязываем обработчики (после загрузки DOM)
document.addEventListener('DOMContentLoaded', () => {
    const confirmBtn = document.getElementById('confirm-create-location');
    if (confirmBtn) confirmBtn.onclick = createLocationFromModal;
});

// Модифицируем кнопку создания локации на панели GM
document.getElementById('create-location-btn')?.addEventListener('click', () => {
    // Включаем режим выбора тайла (как у маркеров)
    window.awaitingLocationPick = true;
    showNotification('Кликните по тайлу на карте для создания локации', 'system');
    window.locationPickCallback = (tile) => {
        window.awaitingLocationPick = false;
        openLocationCreateModal(tile);
    };
});

function openLocationEditModal(locationData) {
    // Определяем преобладающий тип ландшафта из тайлов
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

    // Создаём модальное окно
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

    // Переменная для временных тайлов
    let tempTiles = null;

    // Кнопка перегенерации
    document.getElementById('regenerate-loc-btn').onclick = () => {
        const newWidth = parseInt(document.getElementById('edit-loc-width').value);
        const newHeight = parseInt(document.getElementById('edit-loc-height').value);
        const terrainType = document.getElementById('edit-loc-terrain').value;
        const genObjects = document.getElementById('edit-loc-gen-objects').checked;
        if (isNaN(newWidth) || isNaN(newHeight)) return;
        tempTiles = generateLocationTiles(terrainType, newWidth, newHeight, genObjects);
        showNotification('Ландшафт перегенерирован. Не забудьте сохранить.', 'success');
    };

    // Кнопка сохранения
    document.getElementById('save-loc-changes').onclick = async () => {
        const newName = document.getElementById('edit-loc-name').value;
        let newWidth = parseInt(document.getElementById('edit-loc-width').value);
        let newHeight = parseInt(document.getElementById('edit-loc-height').value);
        let finalTiles = tempTiles;
        if (!finalTiles) {
            finalTiles = locationData.tiles_data;
        }
        // Если размеры изменились, нужно привести тайлы к новому размеру
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
            window.enterLocation(locationData.id); // перезагружаем
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

// Добавляем кнопку создания локации в UI (только GM)
document.getElementById('create-location-btn')?.addEventListener('click', () => {
    startLocationPick();
});

document.getElementById('exit-location-btn')?.addEventListener('click', exitLocation);

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '🌑';
}

document.addEventListener('click', function resumeAudio() {
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
        Howler.ctx.resume();
    }
    document.removeEventListener('click', resumeAudio);
}, { once: true });

// Загружаем данные при старте
loadLobbyInfo();
loadLobbyCharacters();
loadAllChunks();
initHotkeys();

setTimeout(() => {
    initDraggablePanels();
}, 100);