// static/js/api.js
import { getErrorMessage } from './utils.js';

const token = localStorage.getItem('access_token');

async function apiFetch(url, options = {}) {
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

export const Server = {
    // ----- Лобби (комнаты) -----
    async getLobbyInfo(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}`);
    },

    async createLobby(name, mapType, chunksWidth, chunksHeight, importData = null) {
        // Для импорта используется FormData, для обычного — JSON
        if (mapType === 'imported' && importData) {
            const formData = new FormData();
            formData.append('name', name);
            formData.append('map_type', 'imported');
            formData.append('map_file', new Blob([JSON.stringify(importData)], { type: 'application/json' }), 'map.json');
            const response = await fetch('/lobbies/', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(getErrorMessage(data) || 'Failed to create lobby');
            }
            return response.json();
        } else {
            return apiFetch('/lobbies/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, map_type: mapType, chunks_width: chunksWidth, chunks_height: chunksHeight }),
            });
        }
    },

    async listLobbies() {
        return apiFetch('/lobbies/');
    },

    async joinLobby(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}/join`, { method: 'POST' });
    },

    async leaveLobby(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}/leave`, { method: 'POST' });
    },

    async deleteLobby(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}`, { method: 'DELETE' });
    },

    async joinByCode(code) {
        return apiFetch('/lobbies/join_by_code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });
    },

    async getMyLobbies(limit, offset) {
        const params = new URLSearchParams();
        if (limit !== undefined) params.set('limit', limit);
        if (offset !== undefined) params.set('offset', offset);
        return apiFetch(`/lobbies/my?${params}`);
    },

    async getJoinedLobbies(limit, offset) {
        const params = new URLSearchParams();
        if (limit !== undefined) params.set('limit', limit);
        if (offset !== undefined) params.set('offset', offset);
        return apiFetch(`/lobbies/joined?${params}`);
    },

    // ----- Участники и баны -----
    async banUser(lobbyId, userId) {
        return apiFetch(`/lobbies/${lobbyId}/ban/${userId}`, { method: 'POST' });
    },

    async unbanUser(lobbyId, userId) {
        return apiFetch(`/lobbies/${lobbyId}/unban/${userId}`, { method: 'POST' });
    },

    async getBannedList(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}/banned`);
    },

    // ----- Персонажи -----
    async getLobbyCharacters(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}/characters`);
    },

    async createLobbyCharacter(lobbyId, name, data = {}) {
        return apiFetch(`/lobbies/${lobbyId}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, data }),
        });
    },

    async getCharacter(characterId) {
        return apiFetch(`/lobbies/characters/${characterId}`);
    },

    async updateCharacter(characterId, updates) {
        return apiFetch(`/lobbies/characters/${characterId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
    },

    async deleteCharacter(characterId) {
        return apiFetch(`/lobbies/characters/${characterId}`, { method: 'DELETE' });
    },

    async setCharacterVisibility(characterId, visibleTo) {
        return apiFetch(`/lobbies/characters/${characterId}/visibility`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible_to: visibleTo }),
        });
    },

    // ----- Карта -----
    async getChunks(lobbyId, minX, maxX, minY, maxY) {
        return apiFetch(`/lobbies/${lobbyId}/chunks?min_chunk_x=${minX}&max_chunk_x=${maxX}&min_chunk_y=${minY}&max_chunk_y=${maxY}`);
    },

    async updateTile(lobbyId, chunkX, chunkY, tileX, tileY, updates) {
        return apiFetch(`/lobbies/${lobbyId}/chunks/${chunkX}/${chunkY}/tile/${tileX}/${tileY}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
    },

    async batchUpdateTiles(lobbyId, updates) {
        return apiFetch(`/lobbies/${lobbyId}/chunks/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
    },

    async exportMap(lobbyId) {
        const response = await fetch(`/lobbies/${lobbyId}/export`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(getErrorMessage(data) || 'Export failed');
        }
        return response.blob();
    },

    // ----- Погода -----
    async updateWeather(lobbyId, settings) {
        return apiFetch(`/lobbies/${lobbyId}/weather`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
    },

    // ----- Шаблоны предметов -----
    async getLobbyTemplates(lobbyId, category, subcategory = null) {
        const params = new URLSearchParams({ category });
        if (subcategory) params.set('subcategory', subcategory);
        return apiFetch(`/lobbies/${lobbyId}/templates?${params}`);
    },

    async createLobbyTemplate(lobbyId, templateData) {
        return apiFetch(`/lobbies/${lobbyId}/templates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(templateData),
        });
    },

    async updateLobbyTemplate(lobbyId, templateId, templateData) {
        return apiFetch(`/lobbies/${lobbyId}/templates/${templateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(templateData),
        });
    },

    async deleteLobbyTemplate(lobbyId, templateId) {
        const token = localStorage.getItem('access_token');
        const response = await fetch(`/lobbies/${lobbyId}/templates/${templateId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(getErrorMessage(data) || `HTTP error ${response.status}`);
        }
        // При успехе возвращаем true или ничего, т.к. статус 204 No Content
        return true;
    },

    // ----- Аутентификация (если нужно) -----
    async register(username, email, password) {
        return apiFetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password }),
        });
    },

    async login(username, password) {
        return apiFetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
    },

    async getProfile() {
        return apiFetch('/auth/profile');
    },

    async createLocation(lobbyId, locationData) {
        return apiFetch(`/lobbies/${lobbyId}/locations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(locationData)
        });
    },

    async getLocations(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}/locations`);
    },

    async getLocationDetail(lobbyId, locationId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}`);
    },

    async updateLocation(lobbyId, locationId, updates) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
    },

    async deleteLocation(lobbyId, locationId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}`, { method: 'DELETE' });
    },
};