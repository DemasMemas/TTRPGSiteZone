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
import { initLocationScene, loadLocation, updateCharacterPosition, setCurrentLocationId, getCurrentLocationId } from './locationScene.js';
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
    } catch (err) {
        showNotification(err.message);
    }
};

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
    // Перезагрузить чанки глобальной карты, если нужно
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

let awaitingLocationTile = false;
let locationTileCallback = null;

window.startLocationPick = function() {
    window.awaitingLocationPick = true;
    showNotification('Кликните по тайлу на карте для создания локации', 'system');
    window.locationPickCallback = async (tile) => {
        const worldX = tile.chunk.chunkX * 32 + tile.tileX;
        const worldZ = tile.chunk.chunkY * 32 + tile.tileY;
        const name = prompt('Название локации:');
        if (!name) return;
        let width = parseInt(prompt('Ширина локации (в тайлах, от 5 до 200):', '100'));
        if (isNaN(width) || width < 5) width = 100;
        let height = parseInt(prompt('Высота локации (в тайлах):', width));
        if (isNaN(height) || height < 5) height = width;
        await createLocationFromCoordinates(worldX, worldZ, name, width, height);
    };
};

window.createLocationFromCoordinates = async function(tileX, tileZ, name, width, height) {
    try {
        await Server.createLocation(currentLobbyId, {
            name: name,
            type: 'exploration',
            world_tile_x: tileX,
            world_tile_z: tileZ,
            grid_width: width,
            grid_height: height,
            tiles_data: []
        });
        showNotification('Локация создана', 'success');
        // Принудительно перезагружаем все маркеры (чтобы новые локации стали кликабельными)
        if (socket) socket.emit('get_markers', { token, lobby_id: currentLobbyId });
    } catch (err) {
        showNotification(err.message);
    }
};

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