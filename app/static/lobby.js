import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { addMarker, moveMarker, removeMarker, loadMarkers } from './lobby3d.js';

const socket = io();
let currentLobbyId = null;
let token = localStorage.getItem('access_token');
let username = localStorage.getItem('username');

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
    loadMyCharacters();
    loadParticipantsCharacters();
    loadMap(); // загружаем карту
});

socket.on('user_joined', (data) => {
    addMessage('system', `${data.username} присоединился к лобби`);
    loadParticipantsCharacters();
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

async function loadLobbyInfo() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Ошибка загрузки лобби');
        const lobby = await response.json();
        document.getElementById('lobby-name').textContent = lobby.name;
        updateParticipantsList(lobby.participants, lobby.gm_id);

        // Показываем код приглашения, если текущий пользователь - ГМ
        const userId = localStorage.getItem('user_id');
        if (lobby.gm_id == userId) {
            const codeElement = document.getElementById('gm-invite-code');
            const codeSpan = document.getElementById('invite-code-value');
            if (codeElement && codeSpan) {
                codeSpan.textContent = lobby.invite_code;
                codeElement.style.display = 'inline-block';
            }
        }

    } catch (error) {
        console.error('loadLobbyInfo error:', error);
    }
}

function updateParticipantsList(participants, gmId) {
    const list = document.getElementById('participants-list');
    if (!list) return;
    list.innerHTML = '';
    participants.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.username;
        if (p.user_id === gmId) li.textContent += ' (ГМ)';
        list.appendChild(li);
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
window.selectCharacter = selectCharacter;
window.rollSkill = rollSkill;

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