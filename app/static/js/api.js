// static/js/api.js
import { getErrorMessage } from './utils.js';

const token = localStorage.getItem('access_token');

export async function apiFetch(url, options = {}) {
    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers,
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(getErrorMessage(data) || `HTTP error ${response.status}`);
    }
    return response.json();
}

export async function getLobbyInfo(lobbyId) {
    return apiFetch(`/lobbies/${lobbyId}`);
}

export async function getLobbyCharacters(lobbyId) {
    return apiFetch(`/lobbies/${lobbyId}/characters`);
}

export async function createLobbyCharacter(lobbyId, name, data = {}) {
    return apiFetch(`/lobbies/${lobbyId}/characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data }),
    });
}

export async function getCharacter(characterId) {
    return apiFetch(`/lobbies/characters/${characterId}`);
}

export async function deleteCharacter(characterId) {
    return apiFetch(`/lobbies/characters/${characterId}`, { method: 'DELETE' });
}

export async function updateCharacter(characterId, updates) {
    return apiFetch(`/lobbies/characters/${characterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
}

export async function setCharacterVisibility(characterId, visibleTo) {
    return apiFetch(`/lobbies/characters/${characterId}/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible_to: visibleTo }),
    });
}

export async function banUser(lobbyId, userId) {
    return apiFetch(`/lobbies/${lobbyId}/ban/${userId}`, { method: 'POST' });
}

export async function unbanUser(lobbyId, userId) {
    return apiFetch(`/lobbies/${lobbyId}/unban/${userId}`, { method: 'POST' });
}

export async function getBannedList(lobbyId) {
    return apiFetch(`/lobbies/${lobbyId}/banned`);
}

export async function updateTile(lobbyId, chunkX, chunkY, tileX, tileY, updates) {
    return apiFetch(`/lobbies/${lobbyId}/chunks/${chunkX}/${chunkY}/tile/${tileX}/${tileY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
}

export async function batchUpdateTiles(lobbyId, updates) {
    return apiFetch(`/lobbies/${lobbyId}/chunks/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
}

export async function getChunks(lobbyId, minX, maxX, minY, maxY) {
    return apiFetch(`/lobbies/${lobbyId}/chunks?min_chunk_x=${minX}&max_chunk_x=${maxX}&min_chunk_y=${minY}&max_chunk_y=${maxY}`);
}

export async function exportMap(lobbyId) {
    const response = await fetch(`/lobbies/${lobbyId}/export`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(getErrorMessage(data) || 'Export failed');
    }
    return response.blob();
}