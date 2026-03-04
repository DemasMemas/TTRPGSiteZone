// static/js/socketHandlers.js
import { showNotification } from './utils.js';
import { loadLobbyCharacters } from './characters.js';
import { loadLobbyInfo, loadAllChunks } from './lobbyData.js';
import { addMessage, updateParticipantsList, onlineUserIds, lobbyParticipants } from './ui.js';
import { updateTileInChunk } from './lobby3d.js';

let socket;
let currentLobbyId;

export function initSocket(lobbyId, token) {
    currentLobbyId = lobbyId;
    socket = io();

    socket.on('connect', () => {
        socket.emit('authenticate', { token, lobby_id: lobbyId });
    });

    socket.on('authenticated', (data) => {
        addMessage('system', `Вы вошли как ${data.username}`);
        const myId = parseInt(localStorage.getItem('user_id'));
        onlineUserIds.add(myId);
        loadLobbyInfo();
        loadLobbyCharacters();
        loadAllChunks();
    });

    socket.on('new_message', (data) => {
        addMessage(data.username, data.message, data.timestamp);
    });

    socket.on('error', (data) => {
        showNotification('Ошибка: ' + data.message);
    });

    socket.on('marker_added', (marker) => {
        import('./lobby3d.js').then(module => module.addMarker(marker));
    });
    socket.on('marker_moved', (data) => {
        import('./lobby3d.js').then(module => module.moveMarker(data.id, data.x, data.y));
    });
    socket.on('marker_deleted', (data) => {
        import('./lobby3d.js').then(module => module.removeMarker(data.id));
    });

    socket.on('chat_history', (messages) => {
        messages.forEach(msg => addMessage(msg.username, msg.message, msg.timestamp));
    });

    socket.on('online_users', (userIds) => {
        onlineUserIds.clear();
        userIds.forEach(id => onlineUserIds.add(id));
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
        showNotification('Вы были заблокированы в этом лобби');
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

    return socket;
}

export function sendMessage(message) {
    if (!socket) return;
    socket.emit('send_message', { token: localStorage.getItem('access_token'), lobby_id: currentLobbyId, message });
}