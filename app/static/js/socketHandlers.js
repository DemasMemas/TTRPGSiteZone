// static/js/socketHandlers.js
import { showNotification } from './utils.js';
import { loadLobbyCharacters } from './characters.js';
import { loadLobbyInfo, loadAllChunks, updateDisplayedLobbyTime } from './lobbyData.js';
import { addMessage, updateParticipantsList, onlineUserIds, lobbyParticipants } from './ui.js';
import { updateTileInChunk } from './lobby3d.js';
import { applyWeather } from './weather.js';
import { setUserColor } from './colors.js';
import { refreshUserColor } from './locationScene.js';

let socket;
let currentLobbyId;
let networkMonitorTimer = null;
let pingInFlight = false;

function updateNetworkStatus(state, ping = null) {
    const root = document.getElementById('network-status');
    const label = document.getElementById('network-status-label');
    const value = document.getElementById('network-status-ping');
    if (!root || !label || !value) return;
    root.classList.remove('is-online', 'is-slow', 'is-offline', 'is-connecting');
    root.classList.add(`is-${state}`);
    if (state === 'offline') {
        label.textContent = navigator.onLine ? 'Нет связи' : 'Нет сети';
        value.textContent = '—';
        root.title = navigator.onLine ? 'Связь с игровым сервером потеряна. Выполняется переподключение.' : 'Устройство не подключено к интернету.';
        return;
    }
    if (state === 'connecting') {
        label.textContent = 'Связь';
        value.textContent = '...';
        root.title = 'Подключение к игровому серверу.';
        return;
    }
    const milliseconds = Math.max(0, Math.round(Number(ping) || 0));
    label.textContent = state === 'slow' ? 'Задержка' : 'Сеть';
    value.textContent = `${milliseconds} мс`;
    root.title = state === 'slow' ? `Высокая задержка до сервера: ${milliseconds} мс.` : `Соединение с сервером активно. Пинг: ${milliseconds} мс.`;
}

function measureServerPing() {
    if (!socket?.connected || pingInFlight) return;
    pingInFlight = true;
    const startedAt = performance.now();
    let completed = false;
    const timeout = window.setTimeout(() => {
        if (completed) return;
        completed = true;
        pingInFlight = false;
        updateNetworkStatus('offline');
    }, 5000);
    socket.emit('network_ping', {}, () => {
        if (completed) return;
        completed = true;
        window.clearTimeout(timeout);
        pingInFlight = false;
        const ping = performance.now() - startedAt;
        updateNetworkStatus(ping >= 250 ? 'slow' : 'online', ping);
    });
}

function startNetworkMonitor() {
    if (networkMonitorTimer) window.clearInterval(networkMonitorTimer);
    measureServerPing();
    networkMonitorTimer = window.setInterval(measureServerPing, 5000);
}

export function initSocket(lobbyId, token) {
    currentLobbyId = lobbyId;
    socket = io();

    socket.on('connect', () => {
        updateNetworkStatus('connecting');
        socket.emit('authenticate', { token, lobby_id: lobbyId });
        startNetworkMonitor();
    });
    socket.on('disconnect', () => updateNetworkStatus('offline'));
    socket.on('connect_error', () => updateNetworkStatus('offline'));
    socket.io.on('reconnect_attempt', () => updateNetworkStatus('connecting'));
    socket.io.on('reconnect_failed', () => updateNetworkStatus('offline'));

    socket.on('authenticated', (data) => {
        showNotification(`Вы вошли как ${data.username}`, 'system', 'bottom-left');
        const myId = parseInt(localStorage.getItem('user_id'));
        onlineUserIds.add(myId);
        loadLobbyInfo();
        loadLobbyCharacters();
        loadAllChunks();
    });

    socket.on('new_message', (data) => {
        if (data.username.startsWith('System')) {
            showNotification(data.message, 'system', 'bottom-left');
        } else {
            addMessage(data.username, data.message, data.timestamp);
        }
    });

    socket.on('error', (data) => {
        if (data.message === 'Invalid token') {
            showNotification('Сессия истекла, войдите заново', 'error');
            setTimeout(() => { window.location.href = '/'; }, 2000);
        } else {
            showNotification('Ошибка: ' + data.message, 'error');
        }
    });

    socket.on('chat_history', (messages) => {
        messages.forEach(msg => {
            if (msg.username.startsWith('System')) {
                showNotification(msg.message, 'system', 'bottom-left');
            } else {
                addMessage(msg.username, msg.message, msg.timestamp);
            }
        });
        requestAnimationFrame(() => {
            const chat = document.getElementById('chat');
            if (chat) chat.scrollTop = chat.scrollHeight;
        });
    });

    socket.on('online_users', (userIds) => {
        onlineUserIds.clear();
        userIds.forEach(id => onlineUserIds.add(Number(id)));
        updateParticipantsList();
    });

    socket.on('user_joined', (data) => {
        showNotification(`${data.username} присоединился к комнате`, 'system', 'bottom-left');
        const userId = Number(data.user_id);
        if (!lobbyParticipants.some(p => Number(p.user_id) === userId)) {
            lobbyParticipants.push({
                user_id: userId,
                username: data.username,
                color: data.color,
            });
        }
        onlineUserIds.add(userId);
        updateParticipantsList();
        loadLobbyCharacters();
    });

    socket.on('user_left', (data) => {
        showNotification(`${data.username} покинул комнату`, 'system', 'bottom-left');
        onlineUserIds.delete(Number(data.user_id));
        updateParticipantsList();
        loadLobbyCharacters();
    });

    socket.on('participant_banned', (data) => {
        onlineUserIds.delete(Number(data.user_id));
        loadLobbyInfo();
        loadLobbyCharacters();
    });

    socket.on('user_color_updated', (data) => {
        const userId = Number(data.user_id);
        setUserColor(userId, data.color);
        const participant = lobbyParticipants.find(
            item => Number(item.user_id) === userId
        );
        if (participant) participant.color = data.color;
        updateParticipantsList();
        refreshUserColor(userId);
    });

    socket.on('lobby_time_updated', (data) => {
        updateDisplayedLobbyTime(data);
    });

    socket.on('kicked', () => {
        showNotification('Вы были заблокированы в этой комнате', 'error', 'top-right');
        window.location.href = '/';
    });

    socket.on('character_created', () => loadLobbyCharacters());
    socket.on('character_deleted', () => loadLobbyCharacters());
    socket.on('character_updated', () => loadLobbyCharacters());

    socket.on('tile_updated', (data) => {
        updateTileInChunk(data.chunk_x, data.chunk_y, data.tile_x, data.tile_y, data.updates);
    });

    socket.on('tiles_updated', (updates) => {
        updates.forEach(item => {
            updateTileInChunk(item.chunk_x, item.chunk_y, item.tile_x, item.tile_y, item.updates);
        });
    });

    socket.on('weather_updated', (settings) => {
        applyWeather(settings);
        window.weatherSettings = settings;
    });

    return socket;
}

export function sendMessage(message) {
    if (!socket) return;
    socket.emit('send_message', { token: localStorage.getItem('access_token'), lobby_id: currentLobbyId, message });
}

export function getSocket() { return socket; }
