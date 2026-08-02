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

export function initSocket(lobbyId, token) {
    currentLobbyId = lobbyId;
    socket = io();

    socket.on('connect', () => {
        socket.emit('authenticate', { token, lobby_id: lobbyId });
    });

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
