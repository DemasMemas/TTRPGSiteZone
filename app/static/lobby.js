import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import {
    addMarker, moveMarker, removeMarker, loadMarkers,
    addChunk, removeChunk, setTileClickCallback, updateTileInChunk,
    setEditMode
} from './lobby3d.js';

const CHUNK_SIZE = 32;
const MIN_CHUNK = 0;
const MAX_CHUNK = 15;

let loadedChunks = new Map();
let editMode = false;

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

// --- Загрузка информации о лобби ---
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

        setTileClickCallback((tile) => {
            if (!isGM) {
                alert('Только ГМ может редактировать тайлы');
                return;
            }
            const newColor = '#' + Math.floor(Math.random() * 16777215).toString(16);
            updateTile(tile.chunkX, tile.chunkY, tile.tileX, tile.tileY, { color: newColor });
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

async function updateTile(chunkX, chunkY, tileX, tileY, updates) {
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
        if (!response.ok) {
            const err = await response.json();
            alert(err.error || 'Ошибка обновления');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

// --- Участники ---
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
            banBtn.title = 'Заблокировать';
            banBtn.onclick = (e) => {
                e.stopPropagation();
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

// --- Чат ---
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
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.status === 404) {
            console.log(`Chunk (${cx},${cy}) not found on server, creating default`);
            // Чанк не найден на сервере – создаём дефолтный на клиенте
            const defaultData = generateDefaultChunkData(CHUNK_SIZE);
            addChunk(cx, cy, defaultData);
        } else if (response.ok) {
            const chunks = await response.json();
            if (chunks.length > 0) {
                addChunk(chunks[0].chunk_x, chunks[0].chunk_y, chunks[0].data);
            } else {
                const defaultData = generateDefaultChunkData(CHUNK_SIZE);
                addChunk(cx, cy, defaultData);
            }
        } else {
            console.error('Failed to fetch chunk', response.status);
        }
    } catch (error) {
        console.error('Error fetching chunk', error);
    }
}

function generateDefaultChunkData(size) {
    const data = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) {
            let type = 'grass';
            // случайно расставляем лес и дома
            if (Math.random() < 0.1) type = 'forest';
            else if (Math.random() < 0.02) type = 'house';
            // для воды можно проверить, например, края карты
            if (x === 0 || y === 0 || x === size-1 || y === size-1) type = 'water';

            const heightVar = Math.random() * 0.1 - 0.05;
            row.push({
                type: type,
                color: type === 'grass' ? '#3a5f0b' : (type === 'water' ? '#1E90FF' : '#8B4513'),
                height: 1.0 + heightVar
            });
        }
        data.push(row);
    }
    return data;
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
            editBtn.onclick = (e) => { e.stopPropagation(); editCharacter(char.id); };
            charDiv.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-danger';
            deleteBtn.textContent = '🗑️';
            deleteBtn.onclick = (e) => { e.stopPropagation(); deleteCharacter(char.id); };
            charDiv.appendChild(deleteBtn);
        }
        if (isGM) {
            const visibilityBtn = document.createElement('button');
            visibilityBtn.className = 'btn btn-sm';
            visibilityBtn.textContent = '👁️';
            visibilityBtn.title = 'Настроить видимость';
            visibilityBtn.onclick = (e) => {
                e.stopPropagation();
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

// --- Модальные окна (видимость, настройки) ---
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
    import('./lobby3d.js').then(module => {
        module.setEditMode(editMode);
    });
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