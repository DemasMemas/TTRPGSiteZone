// static/js/ui.js
import { showNotification } from './utils.js';
import { Server } from './api.js';
import { loadLobbyCharacters } from './characters.js';
import { setGmId, getUserColorHex } from './colors.js';

export let lobbyParticipants = [];
export let gmId = null;
export let isGM = false;
export let onlineUserIds = new Set();
export let settingsVisible = false;
export let currentVisibilityCharacterId = null;
let currentLobbyId;

export function setLobbyData(participants, gm) {
    lobbyParticipants = (participants || []).filter(
        participant => !participant.is_banned
    );
    window.lobbyParticipants = lobbyParticipants;
    gmId = gm;
    setGmId(gmId);
    isGM = (gmId == localStorage.getItem('user_id'));
}

export function setCurrentLobbyId(id) {
    currentLobbyId = id;
}

export function updateParticipantsList() {
    const onlineList = document.getElementById('online-participants');
    const offlineList = document.getElementById('offline-participants');
    if (!onlineList || !offlineList) return;

    onlineList.innerHTML = '';
    offlineList.innerHTML = '';

    lobbyParticipants.forEach(p => {
        const li = document.createElement('li');
        const colorHex = getUserColorHex(p.user_id);
        li.innerHTML = `
            <span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:${colorHex}; margin-right:8px; flex-shrink:0;"></span>
            ${p.username} ${p.user_id === gmId ? '(ГМ)' : ''}
        `;

        if (isGM && p.user_id !== gmId) {
            const banBtn = document.createElement('button');
            banBtn.className = 'ban-btn';
            banBtn.innerHTML = '⛔';
            banBtn.onclick = (e) => {
                banUserHandler(p.user_id);
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

async function banUserHandler(userId) {
    if (!confirm('Заблокировать этого участника?')) return;
    try {
        await Server.banUser(currentLobbyId, userId);
        lobbyParticipants = lobbyParticipants.filter(p => p.user_id !== userId);
        window.lobbyParticipants = lobbyParticipants;
        onlineUserIds.delete(userId);
        updateParticipantsList();
        showNotification('Участник заблокирован');
    } catch (error) {
        showNotification(error.message);
    }
}

export function addMessage(username, text, timestamp) {
    const chat = document.getElementById('chat');
    if (!chat) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message';
    msgDiv.style.whiteSpace = 'pre-wrap';
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString() : '';
    const usernameSpan = document.createElement('span');
    usernameSpan.className = 'username';
    usernameSpan.textContent = `${username}:`;
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'timestamp';
    timestampSpan.textContent = timeStr;
    msgDiv.append(
        usernameSpan,
        document.createTextNode(` ${text} `),
        timestampSpan,
    );
    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight;
}

export function toggleParticipants() {
    const panel = document.getElementById('participants-panel');
    panel.classList.toggle('collapsed');
    const icon = panel.querySelector('.toggle-icon');
    if (icon) icon.textContent = panel.classList.contains('collapsed') ? '▶' : '▼';
}

export function toggleSettings() {
    settingsVisible ? closeSettings() : openSettings();
}

export function openSettings() {
    document.getElementById('settings-panel').style.display = 'block';
    settingsVisible = true;
    showSettingsTab('banned', document.querySelector('.tab-btn.active'));
}

export function closeSettings() {
    document.getElementById('settings-panel').style.display = 'none';
    settingsVisible = false;
}

export function showSettingsTab(tab, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.settings-tab-content').forEach(el => el.style.display = 'none');

    if (tab === 'banned') {
        document.getElementById('settings-content').style.display = 'block';
        loadBannedList();
    } else if (tab === 'export') {
        document.getElementById('export-settings').style.display = 'block';
    } else if (tab === 'weather') {
        document.getElementById('weather-settings').style.display = 'block';
        if (window.loadWeatherSettings && window.weatherSettings) {
            window.loadWeatherSettings(window.weatherSettings);
        }
    }
}

async function loadBannedList() {
    try {
        const banned = await Server.getBannedList(currentLobbyId);
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
                    <button class="unban-btn" onclick="window.unbanUserHandler(${user.user_id})">Разбанить</button>
                </div>
            `;
        });
        content.innerHTML = html;
    } catch (error) {
        document.getElementById('settings-content').innerHTML = `<p class="error">Ошибка: ${error.message}</p>`;
    }
}

export async function unbanUserHandler(userId) {
    if (!confirm('Разбанить этого пользователя?')) return;
    try {
        await Server.unbanUser(currentLobbyId, userId);
        showNotification('Пользователь разбанен');
        loadBannedList();
    } catch (error) {
        showNotification(error.message);
    }
}

export function openVisibilityModal(characterId, characterName, currentVisibleTo) {
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
}

export function closeVisibilityModal() {
    document.getElementById('visibility-modal').style.display = 'none';
    currentVisibilityCharacterId = null;
}

export async function saveVisibility() {
    if (!currentVisibilityCharacterId) return;
    const checkboxes = document.querySelectorAll('#visibility-participants-list input:checked');
    const visibleTo = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
    try {
        await Server.setCharacterVisibility(currentVisibilityCharacterId, visibleTo);
        showNotification('Видимость обновлена');
        closeVisibilityModal();
        loadLobbyCharacters();
    } catch (error) {
        showNotification(error.message);
    }
}
