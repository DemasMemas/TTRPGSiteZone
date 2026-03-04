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
import { hideObjectHighlight } from './lobby3d.js';
import { showNotification, getErrorMessage } from './utils.js';
import { exportMap } from './api.js';
import { initDraggablePanels } from './draggable.js';
import { initHotkeys } from './hotkeys.js';

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
    showNotification('Некорректный URL лобби');
    window.location.href = '/';
}

// Инициализация модулей
setCurrentLobbyId(currentLobbyId);
initLobbyData(currentLobbyId);
initCharacters(currentLobbyId, token);
initMapEdit(currentLobbyId, token);
const socket = initSocket(currentLobbyId, token);

// Глобальные функции для onclick
window.sendMessage = () => {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message) return;
    socket.emit('send_message', { token, lobby_id: currentLobbyId, message });
    input.value = '';
};

window.leaveLobby = async () => {
    if (!confirm('Покинуть лобби?')) return;
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

// Маркеры (если нужны)
window.setMarkerType = (type) => {
    console.warn('setMarkerType not implemented');
};
window.addMarkerAtCenter = () => {
    const x = Math.floor(Math.random() * 10) - 5;
    const y = Math.floor(Math.random() * 10) - 5;
    socket.emit('add_marker', { token, lobby_id: currentLobbyId, x, y, type: 'default' });
};

// Экспорт карты
window.exportMap = async () => {
    try {
        const blob = await exportMap(currentLobbyId);
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

const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '🌑';
}

// Загружаем данные при старте
loadLobbyInfo();
loadLobbyCharacters();
loadAllChunks();
initHotkeys();

setTimeout(() => {
    initDraggablePanels();
}, 100);