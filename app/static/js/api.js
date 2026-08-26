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
    if (response.status === 204) return null;
    return response.json();
}

export const Server = {
    // ----- Лобби (комнаты) -----
    async getLobbyInfo(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}`);
    },

    async updateLobbyTime(lobbyId, gameDay, gameTimeMinutes) {
        return apiFetch(`/lobbies/${lobbyId}/time`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game_day: gameDay, game_time_minutes: gameTimeMinutes }),
        });
    },

    async startLobbyRest(lobbyId, type, characterIds) {
        return apiFetch(`/lobbies/${lobbyId}/rest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, character_ids: characterIds }),
        });
    },

    async updateTimeActiveCharacters(lobbyId, characterIds) {
        return apiFetch(`/lobbies/${lobbyId}/characters/time-active`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_ids: characterIds }),
        });
    },

    async repairCharacterEquipment(characterId, toolPath, targetPath) {
        return apiFetch(`/lobbies/characters/${characterId}/repair-equipment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool_path: toolPath, target_path: targetPath }),
        });
    },

    async getWorldGroups(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups`);
    },

    async getWorldRules(lobbyId) {
        return apiFetch(`/lobbies/${lobbyId}/world-rules`);
    },

    async createMutant(lobbyId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/mutants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async useWorldAnomalyField(lobbyId, groupId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups/${groupId}/anomaly-field`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async createWorldGroup(lobbyId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async moveWorldGroup(lobbyId, groupId, tileX, tileY) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups/${groupId}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tile_x: tileX, tile_y: tileY }),
        });
    },

    async waitWorldGroup(lobbyId, groupId) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups/${groupId}/wait`, {
            method: 'POST',
        });
    },

    async updateWorldGroupTurnActivity(lobbyId, groupId, active) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups/${groupId}/turn-active`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active }),
        });
    },

    async updateWorldGroupMembers(lobbyId, groupId, characterIds) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups/${groupId}/members`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_ids: characterIds }),
        });
    },

    async createWorldMapEvent(lobbyId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/world-map-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async deleteWorldMapEvent(lobbyId, eventId) {
        return apiFetch(`/lobbies/${lobbyId}/world-map-events/${eventId}`, {
            method: 'DELETE',
        });
    },

    async deleteWorldGroup(lobbyId, groupId) {
        return apiFetch(`/lobbies/${lobbyId}/world-groups/${groupId}`, {
            method: 'DELETE',
        });
    },

    async resolveWorldTravelEvent(lobbyId, eventId, decision) {
        return apiFetch(`/lobbies/${lobbyId}/world-events/${eventId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision }),
        });
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

    async setCharacterVisibility(characterId, visibleTo, editableTo = []) {
        return apiFetch(`/lobbies/characters/${characterId}/visibility`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible_to: visibleTo, editable_to: editableTo }),
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

    async changeCharacterEquipment(characterId, payload) {
        return apiFetch(`/lobbies/characters/${characterId}/equipment-action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async registerCharacterAddictionExposure(characterId, payload) {
        return apiFetch(`/lobbies/characters/${characterId}/addictions/exposure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async checkCharacterWithdrawal(characterId, addictionKey) {
        return apiFetch(`/lobbies/characters/${characterId}/addictions/${encodeURIComponent(addictionKey)}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });
    },

    async inspectLocationCharacter(lobbyId, locationId, characterId, actorLocationCharacterId) {
        const params = new URLSearchParams({
            actor_location_character_id: actorLocationCharacterId,
        });
        return apiFetch(
            `/lobbies/${lobbyId}/locations/${locationId}/characters/${characterId}/interaction?${params}`
        );
    },

    async lootLocationCharacter(lobbyId, locationId, characterId, payload) {
        return apiFetch(
            `/lobbies/${lobbyId}/locations/${locationId}/characters/${characterId}/loot`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
    },

    async butcherLocationMutant(lobbyId, locationId, characterId, payload) {
        return apiFetch(
            `/lobbies/${lobbyId}/locations/${locationId}/characters/${characterId}/butchering`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
    },

    async treatLocationCharacter(lobbyId, locationId, characterId, payload) {
        return apiFetch(
            `/lobbies/${lobbyId}/locations/${locationId}/characters/${characterId}/treatment`,
            {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }
        );
    },

    async createCharacterInteraction(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/character-interactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async respondCharacterInteraction(lobbyId, requestId, decision) {
        return apiFetch(`/lobbies/${lobbyId}/character-interactions/${requestId}/response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision }),
        });
    },

    async startCharacterTreatment(lobbyId, requestId, pendingActionId = null) {
        return apiFetch(`/lobbies/${lobbyId}/character-interactions/${requestId}/progress`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pending_action_id: pendingActionId }),
        });
    },

    async createLocationObject(lobbyId, locationId, objectData) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/objects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(objectData)
        });
    },

    async deleteLocationObject(lobbyId, objectId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/objects/${objectId}`, {
            method: 'DELETE'
        });
    },

    async updateLocationObject(lobbyId, objectId, updates) {
        return apiFetch(`/lobbies/${lobbyId}/locations/objects/${objectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
    },

    async getLocationCombatState(lobbyId, locationId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat`);
    },

    async getLocationTeams(lobbyId, locationId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/teams`);
    },

    async updateLocationTeams(lobbyId, locationId, assignments) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/teams`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments }),
        });
    },

    async startLocationCombat(
        lobbyId,
        locationId,
        locationCharacterIds = null,
        initiatorLocationCharacterId = null,
    ) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location_character_ids: locationCharacterIds,
                initiator_location_character_id: initiatorLocationCharacterId,
            }),
        });
    },

    async endLocationCombat(lobbyId, locationId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/end`, {
            method: 'POST',
        });
    },

    async endLocationCombatTurn(lobbyId, locationId, locationCharacterId = null) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/end_turn`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_character_id: locationCharacterId }),
        });
    },

    async removeLocationCombatParticipant(lobbyId, locationId, locationCharacterId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/participants/${locationCharacterId}`, {
            method: 'DELETE',
        });
    },

    async applyLocationGmEvent(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/gm-events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async resolveLocationStressEffect(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/stress-effects/resolve`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
    },

    async adjustLocationCharacterStress(lobbyId, locationId, characterId, amount) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/characters/${characterId}/stress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount }),
        });
    },

    async reserveLocationCombatReaction(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/reaction/reserve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async requestLocationCombatReaction(lobbyId, locationId, locationCharacterId) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/reaction/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ location_character_id: locationCharacterId }),
        });
    },

    async resolveLocationCombatReaction(lobbyId, locationId, approve) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/reaction/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approve }),
        });
    },

    async spendLocationCombatResources(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/spend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async resolveLocationOpportunityAttack(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/opportunity-attack`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async adjustLocationCombatResources(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/adjust`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },

    async performLocationCombatAction(lobbyId, locationId, payload) {
        return apiFetch(`/lobbies/${lobbyId}/locations/${locationId}/combat/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    },
};
