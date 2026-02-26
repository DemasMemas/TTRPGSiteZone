// static/lobby.js (исправленная версия)

const socket = io();
let currentLobbyId = null;
let token = localStorage.getItem('access_token');
let username = localStorage.getItem('username');

console.log('Token exists:', !!token);
console.log('Current URL:', window.location.href);

// Извлекаем ID лобби из URL (ожидаем формат /lobbies/123/page)
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

// --- Исправление: выносим аутентификацию в отдельное место ---
socket.on('connect', () => {
    console.log('Socket connected, authenticating...');
    socket.emit('authenticate', { token, lobby_id: currentLobbyId });
});

socket.on('authenticated', (data) => {
    console.log('Authenticated as', data.username);
    addMessage('system', `Вы вошли как ${data.username}`);
    loadLobbyInfo();                // оставляем, если нужно название лобби
    loadMyCharacters();              // загружаем список своих персонажей
    loadParticipantsCharacters();    // загружаем персонажей в лобби
});

socket.on('user_joined', (data) => {
    addMessage('system', `${data.username} присоединился к лобби`);
    loadParticipantsCharacters();  // обновляем список персонажей
});

socket.on('new_message', (data) => {
    addMessage(data.username, data.message, data.timestamp);
});

socket.on('error', (data) => {
    alert('Ошибка: ' + data.message);
});

async function loadLobbyInfo() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Ошибка загрузки лобби');
        const lobby = await response.json();
        document.getElementById('lobby-name').textContent = lobby.name;
    } catch (error) {
        console.error(error);
    }
}

// Вспомогательная функция для отрисовки списка участников
function updateParticipantsList(participants, gmId) {
    const list = document.getElementById('participants-list');
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
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
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

async function loadMyCharacters() {
    try {
        const response = await fetch('/characters/', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const characters = await response.json();
            const select = document.getElementById('character-select');
            select.innerHTML = '<option value="">-- выберите --</option>';
            characters.forEach(c => {
                const option = document.createElement('option');
                option.value = c.id;
                option.textContent = c.name;
                select.appendChild(option);
            });
        }
    } catch (error) {
        console.error('Error loading characters', error);
    }
}

// --- Выбор персонажа для текущего лобби ---
async function selectCharacter() {
    const select = document.getElementById('character-select');
    const characterId = select.value;
    if (!characterId) return;
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

// --- Загрузка списка участников с их персонажами ---
async function loadParticipantsCharacters() {
    try {
        const response = await fetch(`/lobbies/${currentLobbyId}/participants_characters`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const participants = await response.json();
            displayCharacters(participants);
        }
    } catch (error) {
        console.error('Error loading participants characters', error);
    }
}

// --- Отображение карточек персонажей ---
function displayCharacters(participants) {
    const container = document.getElementById('characters-list');
    if (!container) return;
    container.innerHTML = '';
    participants.forEach(p => {
        if (p.character) {
            const charDiv = document.createElement('div');
            charDiv.className = 'character-card';
            charDiv.innerHTML = `<h4>${p.character.name} (${p.username})</h4>`;
            const skills = p.character.data.skills || {};
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
            container.appendChild(charDiv);
        } else {
            const div = document.createElement('div');
            div.textContent = `${p.username}: не выбран персонаж`;
            container.appendChild(div);
        }
    });
}

// --- Функция броска навыка (вызывается при нажатии на кнопку) ---
function rollSkill(characterId, skillName) {
    const modifier = prompt(`Введите дополнительный модификатор для ${skillName} (0 если нет):`, '0');
    if (modifier === null) return;
    const extra = parseInt(modifier) || 0;
    socket.emit('roll_skill', {
        token,
        lobby_id: currentLobbyId,
        character_id: characterId,
        skill_name: skillName,
        extra_modifier: extra
    });
}