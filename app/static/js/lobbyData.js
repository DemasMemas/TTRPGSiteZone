// static/js/lobbyData.js
import { Server } from './api.js';
import { setMapDimensions, setTileClickCallback } from './lobby3d.js';
import { setLobbyData, updateParticipantsList } from './ui.js';
import AppState from './ui_interactions.js';
import { applyWeather, applyWorldTime } from './weather.js';
import { updateMapTileSize } from './markers.js';

let currentLobbyId;

function applyLobbyTime(data) {
    const dayInput = document.getElementById('lobby-game-day');
    const timeInput = document.getElementById('lobby-game-time');
    const minutes = Math.max(0, Math.min(1439, Number(data?.game_time_minutes ?? 480)));
    window.lobbyGameDay = Math.max(1, Number(data?.game_day || 1));
    window.lobbyGameTimeMinutes = minutes;
    applyWorldTime(minutes);
    if (dayInput) dayInput.value = Math.max(1, Number(data?.game_day || 1));
    if (timeInput) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        timeInput.value = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
}

export function updateDisplayedLobbyTime(data) {
    applyLobbyTime(data);
}

export function initLobbyData(lobbyId) {
    currentLobbyId = lobbyId;
}

export async function loadLobbyInfo() {
    try {
        const lobby = await Server.getLobbyInfo(currentLobbyId);
        document.getElementById('lobby-name').textContent = lobby.name;
        setLobbyData(lobby.participants, lobby.gm_id);
        updateParticipantsList();

        applyWeather(lobby.weather_settings || {});
        window.weatherSettings = lobby.weather_settings || {};

        window.isGM = (lobby.gm_id == localStorage.getItem('user_id'));
        AppState.setIsGM(window.isGM);
        applyLobbyTime(lobby);
        const dayInput = document.getElementById('lobby-game-day');
        const timeInput = document.getElementById('lobby-game-time');
        [dayInput, timeInput].forEach(input => { if (input) input.disabled = !window.isGM; });
        const saveTime = async () => {
            if (!window.isGM || !dayInput || !timeInput || !timeInput.value) return;
            const [hours, minutes] = timeInput.value.split(':').map(Number);
            try {
                await Server.updateLobbyTime(
                    currentLobbyId,
                    Number(dayInput.value),
                    hours * 60 + minutes,
                );
            } catch (error) {
                window.showNotification?.(error.message);
                applyLobbyTime(lobby);
            }
        };
        if (dayInput && !dayInput._lobbyTimeBound) {
            dayInput.addEventListener('change', saveTime);
            dayInput._lobbyTimeBound = true;
        }
        if (timeInput && !timeInput._lobbyTimeBound) {
            timeInput.addEventListener('change', saveTime);
            timeInput._lobbyTimeBound = true;
        }

        window.MAP_CHUNKS_WIDTH = lobby.chunks_width;
        window.MAP_CHUNKS_HEIGHT = lobby.chunks_height;
        setMapDimensions(lobby.chunks_width, lobby.chunks_height);
        updateMapTileSize(lobby.chunks_width, lobby.chunks_height);

        const weatherTab = document.getElementById('weather-tab-btn');
        if (weatherTab) {
            weatherTab.style.display = window.isGM ? 'inline-block' : 'none';
        }

        const mapSizeSpan = document.getElementById('map-size-info');
        if (mapSizeSpan) {
            mapSizeSpan.textContent = `${lobby.chunks_width} x ${lobby.chunks_height}`;
        }

        if (window.isGM) {
            document.getElementById('settings-btn').style.display = 'inline-block';
            document.getElementById('lobby-rest-btn').style.display = 'inline-block';
            document.getElementById('edit-toggle').style.display = 'inline-block';
            document.getElementById('templates-manager-btn').style.display = 'inline-block';
            const mutantButton = document.getElementById('create-mutant-btn');
            if (mutantButton) mutantButton.style.display = 'inline-block';
            const codeElement = document.getElementById('gm-invite-code');
            const codeSpan = document.getElementById('invite-code-value');
            if (codeElement && codeSpan) {
                codeSpan.textContent = lobby.invite_code;
                codeElement.style.display = 'inline-block';
            }

            setTileClickCallback((options) => {
                const { tile, event, isDoubleClick } = options;
                if (!window.isGM) {
                    window.showNotification('Только ГМ может редактировать тайлы');
                    return;
                }
                if (isDoubleClick) {
                    window.openTileEditModal(tile);
                } else if (window.eraserMode) {
                    window.applyBrush(tile, { objects: [] }, window.brushRadius);
                } else if (event.altKey) {
                    window.applyBrush(tile, { terrain: window.currentTileType }, window.brushRadius);
                } else if (event.shiftKey) {
                    window.applyBrush(tile, { height: window.tileHeight }, window.brushRadius);
                } else if (window.worldEditorTool === 'terrain') {
                    window.applyBrush(tile, { terrain: window.currentTileType }, window.brushRadius);
                } else if (window.worldEditorTool === 'height') {
                    window.applyBrush(tile, { height: window.tileHeight }, window.brushRadius);
                } else if (window.worldEditorTool === 'radiation') {
                    window.applyBrush(tile, { radiation: window.worldBrushRadiation ?? 0 }, window.brushRadius);
                }
            });
        }
    } catch (error) {
        console.error('loadLobbyInfo error:', error);
    }
}

let loadingAllChunks = null;

export function loadAllChunks() {
    if (loadingAllChunks) return loadingAllChunks;
    loadingAllChunks = (async () => {
        const positions = [];
        for (let cx = 0; cx < window.MAP_CHUNKS_WIDTH; cx++) {
            for (let cy = 0; cy < window.MAP_CHUNKS_HEIGHT; cy++) {
                positions.push([cx, cy]);
            }
        }
        let nextIndex = 0;
        const worker = async () => {
            while (nextIndex < positions.length) {
                const [cx, cy] = positions[nextIndex++];
                await fetchChunk(cx, cy);
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, positions.length) }, worker));
        console.log('All chunks loaded');
    })().finally(() => { loadingAllChunks = null; });
    return loadingAllChunks;
}

async function fetchChunk(cx, cy) {
    try {
        const chunks = await Server.getChunks(currentLobbyId, cx, cx, cy, cy);
        if (chunks.length > 0) {
            const { addChunk } = await import('./lobby3d.js');
            addChunk(chunks[0].chunk_x, chunks[0].chunk_y, chunks[0].data);
        }
    } catch (error) {
        console.error('Error fetching chunk', error);
    }
}
