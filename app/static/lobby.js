import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import {
    addMarker, moveMarker, removeMarker, loadMarkers,
    addChunk, removeChunk, setTileClickCallback, updateTileInChunk,
    setEditMode, setBrushRadius, getHoveredTile, chunksMap,
    getObjectHeightOffset, showObjectHighlight, hideObjectHighlight,
    getObjectDimensions
} from './lobby3d.js';

const CHUNK_SIZE = 32;
const MIN_CHUNK = 0;
const MAX_CHUNK = 15;

let loadedChunks = new Map();
let editMode = false;
let eraserMode = false;
window.eraserMode = eraserMode;
let currentTileType = 'grass';
let currentEditTile = null;
let brushRadius = 0;
let tileHeight = 1.0;

const gmControls = document.getElementById('gm-only-controls');
const ANOMALY_TYPES = ['electric', 'fire', 'acid', 'void'];

const socket = io();
let currentLobbyId = null;
let token = localStorage.getItem('access_token');
let username = localStorage.getItem('username');
let settingsVisible = false;
let currentVisibilityCharacterId = null;

let lobbyParticipants = [];
let gmId = null;
let isGM = false;
let onlineUserIds = new Set();

const pathParts = window.location.pathname.split('/').filter(p => p !== '');
if (pathParts.length >= 2 && pathParts[0] === 'lobbies') {
    currentLobbyId = pathParts[1];
}

if (!token) {
    alert('Вы не авторизованы');
    window.location.href = '/';
}
if (!currentLobbyId) {
    alert('Некорректный URL лобби');
    window.location.href = '/';
}

// --- Socket events ---
socket.on('connect', () => {
    socket.emit('authenticate', { token, lobby_id: currentLobbyId });
});

socket.on('authenticated', (data) => {
    addMessage('system', `Вы вошли как ${data.username}`);
    loadLobbyInfo();
    loadLobbyCharacters();
    loadAllChunks();
});

socket.on('new_message', (data) => {
    addMessage(data.username, data.message, data.timestamp);
});

socket.on('error', (data) => {
    alert('Ошибка: ' + data.message);
});

socket.on('marker_added', (marker) => addMarker(marker));
socket.on('marker_moved', (data) => moveMarker(data.id, data.x, data.y));
socket.on('marker_deleted', (data) => removeMarker(data.id));

socket.on('chat_history', (messages) => {
    messages.forEach(msg => addMessage(msg.username, msg.message, msg.timestamp));
});

socket.on('online_users', (userIds) => {
    onlineUserIds = new Set(userIds);
    updateParticipantsList();
});

socket.on('user_joined', (data) => {
    addMessage('system', `${data.username} присоединился к лобби`);
    if (!lobbyParticipants.some(p => p.user_id === data.user_id)) {
        lobbyParticipants.push({ user_id: data.user_id, username: data.username });
    }
    onlineUserIds.add(data.user_id);
    updateParticipantsList();
    loadLobbyCharacters();
});

socket.on('user_left', (data) => {
    onlineUserIds.delete(data.user_id);
    updateParticipantsList();
    loadLobbyCharacters();
});

socket.on('kicked', () => {
    alert('Вы были заблокированы в этом лобби');
    window.location.href = '/';
});

socket.on('character_created', () => loadLobbyCharacters());
socket.on('character_deleted', () => loadLobbyCharacters());
socket.on('character_updated', () => loadLobbyCharacters());
socket.on('tile_updated', (data) => {
    updateTileInChunk(data.chunk_x, data.chunk_y, data.tile_x, data.tile_y, data.updates);
});

function getTileUpdates(shiftKey) {
    if (shiftKey) {
        return { height: tileHeight };
    } else {
        return {
            terrain: currentTileType,
            height: tileHeight
        };
    }
}

async function loadLobbyInfo() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Ошибка загрузки лобби');
        const lobby = await response.json();

        document.getElementById('lobby-name').textContent = lobby.name;
        gmId = lobby.gm_id;
        isGM = (gmId == localStorage.getItem('user_id'));

        const gmControls = document.getElementById('gm-only-controls');
        if (gmControls) {
            gmControls.style.display = isGM ? 'inline-block' : 'none';
        }

        updateGMControlsVisibility();

        setTileClickCallback((options) => {
            const { tile, event, isDoubleClick, isDrag } = options;
            if (!isGM) {
                alert('Только ГМ может редактировать тайлы');
                return;
            }
            if (isDoubleClick) {
                openTileEditModal(tile);
            } else if (eraserMode) {
                applyBrush(tile, { objects: [] }, brushRadius);
            } else if (event.altKey) {
                applyBrush(tile, { terrain: currentTileType }, brushRadius);
            } else if (event.shiftKey) {
                applyBrush(tile, { height: tileHeight }, brushRadius);
            }
            console.log('callback', { isDoubleClick, eraserMode, altKey: event.altKey, shiftKey: event.shiftKey });
        });

        if (isGM) {
            document.getElementById('settings-btn').style.display = 'inline-block';
            document.getElementById('edit-toggle').style.display = 'inline-block';
            const codeElement = document.getElementById('gm-invite-code');
            const codeSpan = document.getElementById('invite-code-value');
            if (codeElement && codeSpan) {
                codeSpan.textContent = lobby.invite_code;
                codeElement.style.display = 'inline-block';
            }
        }

        lobbyParticipants = lobby.participants;
        updateParticipantsList();
    } catch (error) {
        console.error('loadLobbyInfo error:', error);
    }
}

async function updateTile(chunkX, chunkY, tileX, tileY, updates, callback) {
    const url = `/lobbies/${currentLobbyId}/chunks/${chunkX}/${chunkY}/tile/${tileX}/${tileY}`;
    console.log(`PATCH ${url}`, updates);
    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(updates)
        });
        if (response.ok) {
            updateTileInChunk(chunkX, chunkY, tileX, tileY, updates);
            if (callback) callback();
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка обновления');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

function updateParticipantsList() {
    const onlineList = document.getElementById('online-participants');
    const offlineList = document.getElementById('offline-participants');
    if (!onlineList || !offlineList) return;

    onlineList.innerHTML = '';
    offlineList.innerHTML = '';

    lobbyParticipants.forEach(p => {
        const li = document.createElement('li');
        li.setAttribute('data-user-id', p.user_id);
        li.innerHTML = `${p.username} ${p.user_id === gmId ? '(ГМ)' : ''}`;

        if (isGM && p.user_id !== gmId) {
            const banBtn = document.createElement('button');
            banBtn.className = 'ban-btn';
            banBtn.innerHTML = '⛔';
            banBtn.onclick = (e) => {
                banUser(p.user_id);
            };
            li.appendChild(banBtn);
        }

        if (onlineUserIds.has(p.user_id)) {
            onlineList.appendChild(li);
        } else {
            offlineList.appendChild(li);
        }
    });
}

async function banUser(userId) {
    if (!confirm('Заблокировать этого участника?')) return;
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/ban/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            lobbyParticipants = lobbyParticipants.filter(p => p.user_id !== userId);
            onlineUserIds.delete(userId);
            updateParticipantsList();
            alert('Участник заблокирован');
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка при блокировке');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

function addMessage(username, text, timestamp) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    if (username.startsWith('System')) msgDiv.classList.add('system');
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : '';
    msgDiv.innerHTML = `<span class="username">${username}:</span> ${text} <span class="timestamp">${timeStr}</span>`;
    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message) return;
    socket.emit('send_message', { token, lobby_id: currentLobbyId, message });
    input.value = '';
}
window.sendMessage = sendMessage;

async function leaveLobby() {
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
            alert(err.error || 'Ошибка');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}
window.leaveLobby = leaveLobby;

async function loadAllChunks() {
    const promises = [];
    for (let cx = MIN_CHUNK; cx <= MAX_CHUNK; cx++) {
        for (let cy = MIN_CHUNK; cy <= MAX_CHUNK; cy++) {
            promises.push(fetchChunk(cx, cy));
        }
    }
    await Promise.allSettled(promises);
    console.log('All chunks loaded');
}

async function fetchChunk(cx, cy) {
    const url = `/lobbies/${currentLobbyId}/chunks?min_chunk_x=${cx}&max_chunk_x=${cx}&min_chunk_y=${cy}&max_chunk_y=${cy}`;
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache'
            }
        });
        if (response.ok) {
            const chunks = await response.json();
            if (chunks.length > 0) {
                addChunk(chunks[0].chunk_x, chunks[0].chunk_y, chunks[0].data);
            } else {
                console.error('Server returned empty chunks for existing request');
            }
        } else {
            console.error('Failed to fetch chunk', response.status);
        }
    } catch (error) {
        console.error('Error fetching chunk', error);
    }
}

// --- Управление персонажами ---
async function loadLobbyCharacters() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/characters`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const characters = await response.json();
            displayLobbyCharacters(characters);
        }
    } catch (error) {
        console.error('Error loading characters', error);
    }
}

function displayLobbyCharacters(characters) {
    const container = document.getElementById('lobby-characters-list');
    if (!container) return;
    container.innerHTML = '';
    if (characters.length === 0) {
        container.innerHTML = '<p>В лобби пока нет персонажей</p>';
        return;
    }
    characters.forEach(char => {
        const charDiv = document.createElement('div');
        charDiv.className = 'character-card';
        charDiv.innerHTML = `
            <h4>${char.name}</h4>
            <p>Владелец: ${char.owner_username}</p>
            <button class="btn btn-sm" onclick="viewCharacter(${char.id})">Открыть</button>
        `;
        if (char.owner_id == localStorage.getItem('user_id') || isGM) {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-sm';
            editBtn.textContent = '✏️';
            editBtn.onclick = (e) => { editCharacter(char.id); };
            charDiv.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-danger';
            deleteBtn.textContent = '🗑️';
            deleteBtn.onclick = (e) => { deleteCharacter(char.id); };
            charDiv.appendChild(deleteBtn);
        }
        if (isGM) {
            const visibilityBtn = document.createElement('button');
            visibilityBtn.className = 'btn btn-sm';
            visibilityBtn.textContent = '👁️';
            visibilityBtn.onclick = (e) => {
                openVisibilityModal(char.id, char.name, char.visible_to || []);
            };
            charDiv.appendChild(visibilityBtn);
        }
        container.appendChild(charDiv);
    });
}

window.viewCharacter = (id) => {
    fetch(`/lobbies/characters/${id}`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(res => res.json())
        .then(char => alert(JSON.stringify(char.data, null, 2)))
        .catch(err => alert('Ошибка загрузки'));
};

window.editCharacter = (id) => alert('Редактирование пока не реализовано');

window.deleteCharacter = async (id) => {
    if (!confirm('Удалить персонажа?')) return;
    try {
        const response = await fetch(`/lobbies/characters/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            alert('Персонаж удалён');
            loadLobbyCharacters();
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка удаления');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
};

window.showCreateCharacterForm = () => {
    const name = prompt('Введите имя персонажа:');
    if (!name) return;
    const data = prompt('Введите JSON данные (можно оставить пустым):', '{}');
    try {
        const parsed = JSON.parse(data || '{}');
        createCharacter(name, parsed);
    } catch (e) {
        alert('Некорректный JSON');
    }
};

async function createCharacter(name, data) {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/characters`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name, data })
        });
        if (response.ok) {
            alert('Персонаж создан');
            loadLobbyCharacters();
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка создания');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

// --- Модальные окна ---
window.openVisibilityModal = (characterId, characterName, currentVisibleTo) => {
    currentVisibilityCharacterId = characterId;
    document.getElementById('visibility-character-name').textContent = `Персонаж: ${characterName}`;
    const container = document.getElementById('visibility-participants-list');
    container.innerHTML = '';
    lobbyParticipants.forEach(p => {
        const div = document.createElement('div');
        div.className = 'visibility-participant';
        div.innerHTML = `
            <input type="checkbox" value="${p.user_id}" ${currentVisibleTo.includes(p.user_id) ? 'checked' : ''}>
            <label>${p.username}</label>
        `;
        container.appendChild(div);
    });
    document.getElementById('visibility-modal').style.display = 'flex';
};

window.closeVisibilityModal = () => {
    document.getElementById('visibility-modal').style.display = 'none';
    currentVisibilityCharacterId = null;
};

window.saveVisibility = async () => {
    if (!currentVisibilityCharacterId) return;
    const checkboxes = document.querySelectorAll('#visibility-participants-list input:checked');
    const visibleTo = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
    try {
        const response = await fetch(`/lobbies/characters/${currentVisibilityCharacterId}/visibility`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ visible_to: visibleTo })
        });
        if (response.ok) {
            alert('Видимость обновлена');
            closeVisibilityModal();
            loadLobbyCharacters();
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
};

// --- Панели и настройки ---
window.toggleParticipants = function() {
    const panel = document.getElementById('participants-panel');
    panel.classList.toggle('collapsed');
    const icon = panel.querySelector('.toggle-icon');
    if (icon) icon.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
};
document.querySelector('.panel-header').addEventListener('click', window.toggleParticipants);

window.toggleSettings = function() {
    settingsVisible ? closeSettings() : openSettings();
};
window.openSettings = function() {
    document.getElementById('settings-panel').style.display = 'block';
    settingsVisible = true;
    loadBannedList();
};
window.closeSettings = function() {
    document.getElementById('settings-panel').style.display = 'none';
    settingsVisible = false;
};
window.showSettingsTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    if (tab === 'banned') loadBannedList();
};

window.toggleEditMode = function() {
    editMode = !editMode;
    setEditMode(editMode);
    updateGMControlsVisibility();
    const btn = document.getElementById('edit-toggle');
    if (btn) {
        btn.style.background = editMode ? '#4a6fa5' : '';
    }
};

async function loadBannedList() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/banned`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const content = document.getElementById('settings-content');
        if (response.ok) {
            const banned = await response.json();
            if (banned.length === 0) {
                content.innerHTML = '<p>Нет забаненных пользователей</p>';
                return;
            }
            let html = '';
            banned.forEach(user => {
                html += `
                    <div class="banned-user">
                        <span>${user.username}</span>
                        <button class="unban-btn" onclick="unbanUser(${user.user_id})">Разбанить</button>
                    </div>
                `;
            });
            content.innerHTML = html;
        } else {
            const err = await response.json();
            content.innerHTML = `<p class="error">Ошибка: ${err.error || 'Не удалось загрузить'}</p>`;
        }
    } catch (error) {
        document.getElementById('settings-content').innerHTML = '<p class="error">Ошибка сети</p>';
    }
}

window.unbanUser = async function(userId) {
    if (!confirm('Разбанить этого пользователя?')) return;
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/unban/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            alert('Пользователь разбанен');
            loadBannedList();
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка при разбане');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
};

// --- Инструменты карты (маркеры) ---
let currentMarkerType = 'default';
window.setMarkerType = (type) => {
    currentMarkerType = type;
    document.getElementById('current-marker-type').textContent = type;
};
window.addMarkerAtCenter = () => {
    const x = Math.floor(Math.random() * 10) - 5;
    const y = Math.floor(Math.random() * 10) - 5;
    socket.emit('add_marker', { token, lobby_id: currentLobbyId, x, y, type: currentMarkerType });
};

document.getElementById('tile-type-select')?.addEventListener('change', (e) => {
    currentTileType = e.target.value;
    window.currentTileType = currentTileType;
});

document.getElementById('brush-radius')?.addEventListener('input', (e) => {
    let val = parseInt(e.target.value);
    const maxRadius = 3;
    if (val > maxRadius) val = maxRadius;
    brushRadius = val;
    document.getElementById('brush-radius-value').textContent = brushRadius;
    setBrushRadius(brushRadius);
    window.brushRadius = brushRadius;
});

document.getElementById('tile-height')?.addEventListener('input', (e) => {
    tileHeight = parseFloat(e.target.value);
    document.getElementById('tile-height-value').textContent = tileHeight.toFixed(1);
    window.tileHeight = tileHeight;
});

window.addRandomObject = async function() {
    const tileInfo = getHoveredTile();
    if (!isGM || !tileInfo) {
        alert('Выберите тайл');
        return;
    }
    const tile = tileInfo.tileData;
    const newObject = {
        type: 'tree',
        x: Math.random() * 0.8 - 0.4,
        z: Math.random() * 0.8 - 0.4,
        scale: 0.8 + Math.random() * 0.4,
        rotation: Math.floor(Math.random() * 360)
    };
    const objects = tile.objects ? [...tile.objects, newObject] : [newObject];
    await updateTile(tileInfo.chunk.chunkX, tileInfo.chunk.chunkY,
                     tileInfo.tileX, tileInfo.tileY, { objects: objects });
};

window.clearObjects = async function() {
    const tileInfo = getHoveredTile();
    if (!isGM || !tileInfo) {
        alert('Выберите тайл');
        return;
    }
    await updateTile(tileInfo.chunk.chunkX, tileInfo.chunk.chunkY,
                     tileInfo.tileX, tileInfo.tileY, { objects: [] });
};

window.openTileEditModal = function(tile) {
    currentEditTile = tile;
    updateTileEditModal();
    document.getElementById('tile-edit-modal').style.display = 'flex';
};

window.closeTileEditModal = function() {
    document.getElementById('tile-edit-modal').style.display = 'none';
    hideObjectHighlight();
    currentEditTile = null;
};

window.applyTerrainChange = async function() {
    if (!currentEditTile) return;
    const newTerrain = document.getElementById('tile-edit-terrain').value;
    await updateTile(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { terrain: newTerrain },
        () => {
            const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
            const chunkEntry = chunksMap.get(chunkKey);
            if (chunkEntry) {
                const newTileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
                currentEditTile.tileData = newTileData;
                updateTileEditModal();
            }
        }
    );
};

window.applyHeightChange = async function() {
    if (!currentEditTile) return;
    const newHeight = parseFloat(document.getElementById('tile-edit-height').value);
    await updateTile(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { height: newHeight },
        () => {
            const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
            const chunkEntry = chunksMap.get(chunkKey);
            if (chunkEntry) {
                const newTileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
                currentEditTile.tileData = newTileData;
                updateTileEditModal();
            }
        }
    );
};

window.addObjectToTile = async function() {
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

    console.log('Adding object:', newObject);

    const objects = tile.objects ? [...tile.objects, newObject] : [newObject];
    await updateTile(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { objects: objects },
        () => {
            const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
            const chunkEntry = chunksMap.get(chunkKey);
            if (chunkEntry) {
                const newTileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
                currentEditTile.tileData = newTileData;
                updateTileEditModal();
            }
        }
    );
};

window.clearObjectsFromTile = async function() {
    if (!currentEditTile) return;
    await updateTile(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { objects: [] },
        () => {
            const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
            const chunkEntry = chunksMap.get(chunkKey);
            if (chunkEntry) {
                const newTileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
                currentEditTile.tileData = newTileData;
                updateTileEditModal();
            }
        }
    );
};

// --- Удаление конкретного объекта ---
async function removeObjectFromTile(index) {
    if (!currentEditTile) return;
    const objects = currentEditTile.tileData.objects ? [...currentEditTile.tileData.objects] : [];
    if (index < 0 || index >= objects.length) return;
    objects.splice(index, 1);
    await updateTile(
        currentEditTile.chunkX,
        currentEditTile.chunkY,
        currentEditTile.tileX,
        currentEditTile.tileY,
        { objects: objects },
        () => {
            const chunkKey = `${currentEditTile.chunkX},${currentEditTile.chunkY}`;
            const chunkEntry = chunksMap.get(chunkKey);
            if (chunkEntry) {
                const newTileData = chunkEntry.tilesData[currentEditTile.tileY][currentEditTile.tileX];
                currentEditTile.tileData = newTileData;
                updateTileEditModal();
            }
        }
    );
}
window.removeObjectFromTile = removeObjectFromTile;

function highlightObject(index) {
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
window.highlightObject = highlightObject;

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
                    onmouseenter="highlightObject(${index})"
                    onmouseleave="hideObjectHighlight()">
                    <span>${typeDisplay} (${obj.color})</span>
                    <button class="btn btn-sm btn-danger" onclick="removeObjectFromTile(${index})" style="padding: 2px 8px;">✕</button>
                </li>
            `;
        });
        listHtml += '</ul>';
        objectsListDiv.innerHTML = listHtml;
    }

    document.getElementById('tile-edit-terrain').value = tileData.terrain;
    document.getElementById('tile-edit-height').value = tileData.height;
    document.getElementById('tile-edit-height-value').textContent = tileData.height.toFixed(1);
}

function updateGMControlsVisibility() {
    const gmControls = document.getElementById('gm-only-controls');
    if (gmControls) {
        gmControls.style.display = (isGM && editMode) ? 'flex' : 'none';
    }
}

function getDefaultColorForType(type) {
    switch(type) {
        case 'tree': return '#2d5a27';
        case 'house': return '#8B4513';
        case 'fence': return '#8B5A2B';
        case 'anomaly': return '#00FFFF';
        default: return '#ffffff';
    }
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

document.getElementById('tile-edit-height')?.addEventListener('input', (e) => {
    document.getElementById('tile-edit-height-value').textContent = parseFloat(e.target.value).toFixed(1);
});

document.getElementById('object-offset-x')?.addEventListener('input', (e) => {
    document.getElementById('object-offset-x-value').textContent = parseFloat(e.target.value).toFixed(2);
});
document.getElementById('object-offset-z')?.addEventListener('input', (e) => {
    document.getElementById('object-offset-z-value').textContent = parseFloat(e.target.value).toFixed(2);
});
document.getElementById('object-scale')?.addEventListener('input', (e) => {
    document.getElementById('object-scale-value').textContent = parseFloat(e.target.value).toFixed(2);
});
document.getElementById('object-rotation')?.addEventListener('input', (e) => {
    document.getElementById('object-rotation-value').textContent = e.target.value + '°';
});

window.highlightObject = highlightObject;
window.hideObjectHighlight = hideObjectHighlight;

document.getElementById('eraser-checkbox')?.addEventListener('change', (e) => {
    eraserMode = e.target.checked;
    window.eraserMode = eraserMode;
});

// Экспортируем всё необходимое в window для доступа из lobby3d.js
window.currentTileType = currentTileType;
window.tileHeight = tileHeight;
window.brushRadius = brushRadius;
window.applyBrush = applyBrush;
window.updateTile = updateTile;

let pendingTileUpdates = [];
let batchUpdateTimeout = null;

async function batchUpdateTiles(updates) {
    if (updates.length === 0) return;
    const url = `/lobbies/${currentLobbyId}/chunks/batch`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(updates)
        });
        if (response.ok) {
            // Обновляем локальные чанки для всех изменённых тайлов
            updates.forEach(item => {
                updateTileInChunk(item.chunk_x, item.chunk_y, item.tile_x, item.tile_y, item.updates);
            });
        } else {
            const err = await response.json();
            console.error('Batch update error:', err);
        }
    } catch (error) {
        console.error('Network error in batch update:', error);
    }
}

function scheduleBatchUpdate() {
    if (batchUpdateTimeout) clearTimeout(batchUpdateTimeout);
    batchUpdateTimeout = setTimeout(() => {
        if (pendingTileUpdates.length > 0) {
            const updatesCopy = pendingTileUpdates.slice();
            pendingTileUpdates = [];
            batchUpdateTiles(updatesCopy);
        }
    }, 1000); // задержка 1000 мс
}

function applyBrush(centerTile, updates, radius) {
    console.log('applyBrush called', centerTile, updates, radius);

    // Определяем координаты в зависимости от формата входного объекта
    let chunkX, chunkY, tileX, tileY;
    if (centerTile.chunk) {
        // формат из hoveredTile (используется в рисовании)
        chunkX = centerTile.chunk.chunkX;
        chunkY = centerTile.chunk.chunkY;
        tileX = centerTile.tileX;
        tileY = centerTile.tileY;
    } else {
        // формат из клика (используется в setTileClickCallback)
        chunkX = centerTile.chunkX;
        chunkY = centerTile.chunkY;
        tileX = centerTile.tileX;
        tileY = centerTile.tileY;
    }

    const centerGlobalX = chunkX * CHUNK_SIZE + tileX;
    const centerGlobalY = chunkY * CHUNK_SIZE + tileY;

    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            const targetGlobalX = centerGlobalX + dx;
            const targetGlobalY = centerGlobalY + dy;
            if (targetGlobalX < 0 || targetGlobalX >= (MAX_CHUNK + 1) * CHUNK_SIZE ||
                targetGlobalY < 0 || targetGlobalY >= (MAX_CHUNK + 1) * CHUNK_SIZE) {
                continue;
            }
            const targetChunkX = Math.floor(targetGlobalX / CHUNK_SIZE);
            const targetChunkY = Math.floor(targetGlobalY / CHUNK_SIZE);
            const targetTileX = targetGlobalX % CHUNK_SIZE;
            const targetTileY = targetGlobalY % CHUNK_SIZE;

            // Добавляем обновление в очередь
            pendingTileUpdates.push({
                chunk_x: targetChunkX,
                chunk_y: targetChunkY,
                tile_x: targetTileX,
                tile_y: targetTileY,
                updates: updates
            });
        }
    }
    scheduleBatchUpdate();
}

socket.on('tiles_updated', (updates) => {
    updates.forEach(item => {
        updateTileInChunk(item.chunk_x, item.chunk_y, item.tile_x, item.tile_y, item.updates);
    });
});