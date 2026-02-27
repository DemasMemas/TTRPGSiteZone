import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { addMarker, moveMarker, removeMarker, loadMarkers } from './lobby3d.js';

const socket = io();
let currentLobbyId = null;
let token = localStorage.getItem('access_token');
let username = localStorage.getItem('username');
let settingsVisible = false;

let lobbyParticipants = [];          // полный список участников из HTTP
let gmId = null;                     // ID ГМ
let isGM = false;                    // флаг, является ли текущий пользователь ГМ
let onlineUserIds = new Set();       // множество ID онлайн-участников

console.log('Token exists:', !!token);
console.log('Current URL:', window.location.href);

// Извлекаем ID лобби
const pathParts = window.location.pathname.split('/').filter(p => p !== '');
if (pathParts.length >= 2 && pathParts[0] === 'lobbies') {
    currentLobbyId = pathParts[1];
}
console.log('Extracted lobby ID:', currentLobbyId);

if (!token) {
    alert('Вы не авторизованы');
    window.location.href = '/';
}

if (!currentLobbyId) {
    alert('Некорректный URL лобби');
    window.location.href = '/';
}

// ----- Socket events -----
socket.on('connect', () => {
    console.log('Socket connected, authenticating...');
    socket.emit('authenticate', { token, lobby_id: currentLobbyId });
});

socket.on('authenticated', (data) => {
    console.log('Authenticated as', data.username);
    addMessage('system', `Вы вошли как ${data.username}`);
    loadLobbyInfo();
    loadMap(); // загружаем карту
});

socket.on('new_message', (data) => {
    addMessage(data.username, data.message, data.timestamp);
});

socket.on('error', (data) => {
    alert('Ошибка: ' + data.message);
});

// События карты
socket.on('marker_added', (marker) => {
    addMarker(marker);
});

socket.on('marker_moved', (data) => {
    moveMarker(data.id, data.x, data.y);
});

socket.on('marker_deleted', (data) => {
    removeMarker(data.id);
});

socket.on('chat_history', (messages) => {
    messages.forEach(msg => {
        addMessage(msg.username, msg.message, msg.timestamp);
    });
});

socket.on('online_users', (userIds) => {
    console.log('Received online_users:', userIds);
    onlineUserIds = new Set(userIds);
    updateParticipantsList();
});

socket.on('user_joined', (data) => {
    console.log('user_joined:', data);
    addMessage('system', `${data.username} присоединился к лобби`);
    const exists = lobbyParticipants.some(p => p.user_id === data.user_id);
    if (!exists) {
        lobbyParticipants.push({ user_id: data.user_id, username: data.username });
    }
    onlineUserIds.add(data.user_id);
    updateParticipantsList();
});

socket.on('user_left', (data) => {
    onlineUserIds.delete(data.user_id);
    updateParticipantsList();
});

socket.on('kicked', (data) => {
    alert('Вы были заблокированы в этом лобби');
    window.location.href = '/';
});

async function loadLobbyInfo() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Ошибка загрузки лобби');
        const lobby = await response.json();

        document.getElementById('lobby-name').textContent = lobby.name;
        gmId = lobby.gm_id;
        isGM = (gmId == localStorage.getItem('user_id')); // сравниваем как числа

        if (isGM) {
            document.getElementById('settings-btn').style.display = 'inline-block';
        }

        console.log('gmId:', gmId, 'currentUserId:', localStorage.getItem('user_id'), 'isGM:', isGM);

        lobbyParticipants = lobby.participants; // массив объектов { user_id, username }
        console.log('loadLobbyInfo response:', lobby);
        console.log('lobbyParticipants:', lobbyParticipants);

        // Показываем код приглашения, если пользователь - ГМ
        if (isGM) {
            const codeElement = document.getElementById('gm-invite-code');
            const codeSpan = document.getElementById('invite-code-value');
            if (codeElement && codeSpan) {
                codeSpan.textContent = lobby.invite_code;
                codeElement.style.display = 'inline-block';
            }
        }

        // Первоначальное отображение списка участников (пока без онлайн-статуса)
        updateParticipantsList();

    } catch (error) {
        console.error('loadLobbyInfo error:', error);
    }
}

function updateParticipantsList() {
    console.log('updateParticipantsList called with participants:', lobbyParticipants, 'online:', onlineUserIds);
    const onlineList = document.getElementById('online-participants');
    const offlineList = document.getElementById('offline-participants');
    if (!onlineList || !offlineList) return;

    onlineList.innerHTML = '';
    offlineList.innerHTML = '';

    lobbyParticipants.forEach(p => {
        const li = document.createElement('li');
        li.setAttribute('data-user-id', p.user_id);
        li.innerHTML = `${p.username} ${p.user_id === gmId ? '(ГМ)' : ''}`;

        console.log('Checking ban button for user', p.user_id, 'isGM:', isGM, 'gmId:', gmId);
        // Добавляем кнопку бана, если текущий пользователь ГМ и это не ГМ
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

        // Определяем, онлайн ли пользователь
        if (onlineUserIds.has(p.user_id)) {
            onlineList.appendChild(li);
        } else {
            offlineList.appendChild(li);
        }
    });
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

    socket.emit('send_message', {
        token,
        lobby_id: currentLobbyId,
        message
    });
    input.value = '';
}

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

async function banUser(userId) {
    console.log('banUser called for userId:', userId);
    if (!confirm('Заблокировать этого участника? Он будет удалён из лобби и не сможет вернуться.')) return;
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/ban/${userId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            // Удаляем забаненного из локальных списков
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

// ----- Работа с персонажами (полные реализации) -----
async function loadMyCharacters() {
    try {
        const response = await fetch('/characters/', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const characters = await response.json();
            console.log('My characters:', characters);
            const select = document.getElementById('character-select');
            if (!select) {
                console.error('Element #character-select not found');
                return;
            }
            select.innerHTML = '<option value="">-- выберите --</option>';
            characters.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = c.name;
                select.appendChild(option);
            });
        } else {
            console.error('Failed to load characters:', response.status);
        }
    } catch (error) {
        console.error('Error loading characters', error);
    }
}

async function selectCharacter() {
    const select = document.getElementById('character-select');
    const characterId = select.value;
    if (!characterId) {
        alert('Выберите персонажа');
        return;
    }
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/select_character`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ character_id: characterId })
        });
        if (response.ok) {
            alert('Персонаж выбран');
            loadParticipantsCharacters(); // обновляем панель персонажей
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
}

async function loadParticipantsCharacters() {
    console.log('loadParticipantsCharacters started');
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/participants_characters`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('Participants characters response status:', response.status);
        if (response.ok) {
            const participants = await response.json();
            console.log('Participants characters data:', participants);
            displayCharacters(participants);
        } else {
            console.error('Failed to load participants characters:', response.status);
        }
    } catch (error) {
        console.error('Error loading participants characters', error);
    }
}

function displayCharacters(participants) {
    console.log('displayCharacters called with', participants);
    const container = document.getElementById('characters-list');
    if (!container) {
        console.error('Element #characters-list not found');
        return;
    }
    container.innerHTML = '';
    participants.forEach(p => {
        console.log('Processing participant:', p);
        if (p.character) {
            const charDiv = document.createElement('div');
            charDiv.className = 'character-card';
            charDiv.innerHTML = `<h4>${p.character.name} (${p.username})</h4>`;
            // Проверяем наличие навыков
            const skills = p.character.data?.skills || {};
            console.log('Skills for', p.character.name, skills);
            if (Object.keys(skills).length === 0) {
                // Если навыков нет, показываем заглушку
                const noSkills = document.createElement('p');
                noSkills.textContent = 'Нет навыков';
                charDiv.appendChild(noSkills);
            } else {
                const skillsDiv = document.createElement('div');
                skillsDiv.className = 'skills-list';
                for (const [skill, bonus] of Object.entries(skills)) {
                    const btn = document.createElement('button');
                    btn.className = 'skill-button';
                    btn.textContent = `${skill} (${bonus})`;
                    btn.onclick = () => rollSkill(p.character.id, skill);
                    skillsDiv.appendChild(btn);
                }
                charDiv.appendChild(skillsDiv);
            }
            container.appendChild(charDiv);
        } else {
            const div = document.createElement('div');
            div.textContent = `${p.username}: не выбран персонаж`;
            container.appendChild(div);
        }
    });
}

function rollSkill(characterId, skillName) {
    const modifier = prompt(`Введите дополнительный модификатор для ${skillName} (0 если нет):`, '0');
    if (modifier === null) return;
    const extra = parseInt(modifier) || 0;
    console.log(`Rolling skill ${skillName} for character ${characterId} with extra modifier ${extra}`);
    socket.emit('roll_skill', {
        token,
        lobby_id: currentLobbyId,
        character_id: characterId,
        skill_name: skillName,
        extra_modifier: extra
    });
}

// ----- Карта (загрузка с сервера) -----
async function loadMap() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/map`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const mapData = await response.json();
            loadMarkers(mapData.markers); // функция из lobby3d.js
        }
    } catch (error) {
        console.error('Error loading map', error);
    }
}

// Экспортируем функции, которые нужны для глобального доступа (если есть inline-обработчики)
window.sendMessage = sendMessage;
window.leaveLobby = leaveLobby;

let currentMarkerType = 'default';
window.setMarkerType = (type) => {
    currentMarkerType = type;
    document.getElementById('current-marker-type').textContent = type;
};

window.addMarkerAtCenter = () => {
    // Генерируем случайные координаты в пределах от -5 до 5
    const x = Math.floor(Math.random() * 10) - 5;
    const y = Math.floor(Math.random() * 10) - 5;
    socket.emit('add_marker', {
        token,
        lobby_id: currentLobbyId,
        x, y,
        type: currentMarkerType
    });
};

window.toggleParticipants = function() {
    const panel = document.getElementById('participants-panel');
    panel.classList.toggle('collapsed');
    const icon = panel.querySelector('.toggle-icon');
    if (icon) {
        icon.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
    }
};

document.querySelector('.panel-header').addEventListener('click', toggleParticipants);

window.toggleSettings = function() {
    if (settingsVisible) {
        closeSettings();
    } else {
        openSettings();
    }
};

window.openSettings = function() {
    document.getElementById('settings-panel').style.display = 'block';
    settingsVisible = true;
    loadBannedList(); // загружаем список забаненных при открытии
};

window.closeSettings = function() {
    document.getElementById('settings-panel').style.display = 'none';
    settingsVisible = false;
};

window.showSettingsTab = function(tab) {
    // Обновляем активную вкладку
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    if (tab === 'banned') {
        loadBannedList();
    }
};

async function loadBannedList() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/banned`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const banned = await response.json();
            const content = document.getElementById('settings-content');
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
            // Обновляем список
            loadBannedList();
        } else {
            const err = await response.json();
            alert(err.error || 'Ошибка при разбане');
        }
    } catch (error) {
        alert('Ошибка сети');
    }
};