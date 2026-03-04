// static/js/lobbyData.js
import { getLobbyInfo, getChunks } from './api.js';
import { setMapDimensions, setTileClickCallback } from './lobby3d.js';
import { setLobbyData, updateParticipantsList } from './ui.js';
import AppState from './state.js';

let currentLobbyId;

export function initLobbyData(lobbyId) {
    currentLobbyId = lobbyId;
}

export async function loadLobbyInfo() {
    try {
        const lobby = await getLobbyInfo(currentLobbyId);
        document.getElementById('lobby-name').textContent = lobby.name;
        setLobbyData(lobby.participants, lobby.gm_id);
        updateParticipantsList();

        // Устанавливаем глобальную переменную isGM (важно!)
        window.isGM = (lobby.gm_id == localStorage.getItem('user_id'));
        AppState.setIsGM(window.isGM);

        window.MAP_CHUNKS_WIDTH = lobby.chunks_width;
        window.MAP_CHUNKS_HEIGHT = lobby.chunks_height;
        setMapDimensions(lobby.chunks_width, lobby.chunks_height);

        const mapSizeSpan = document.getElementById('map-size-info');
        if (mapSizeSpan) {
            mapSizeSpan.textContent = `${lobby.chunks_width} x ${lobby.chunks_height}`;
        }

        if (window.isGM) {
            document.getElementById('settings-btn').style.display = 'inline-block';
            document.getElementById('edit-toggle').style.display = 'inline-block';
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
                }
            });
        }
    } catch (error) {
        console.error('loadLobbyInfo error:', error);
    }
}

export async function loadAllChunks() {
    const promises = [];
    const maxChunkX = window.MAP_CHUNKS_WIDTH - 1;
    const maxChunkY = window.MAP_CHUNKS_HEIGHT - 1;
    for (let cx = 0; cx <= maxChunkX; cx++) {
        for (let cy = 0; cy <= maxChunkY; cy++) {
            promises.push(fetchChunk(cx, cy));
        }
    }
    await Promise.allSettled(promises);
    console.log('All chunks loaded');
}

async function fetchChunk(cx, cy) {
    try {
        const chunks = await getChunks(currentLobbyId, cx, cx, cy, cy);
        if (chunks.length > 0) {
            const { addChunk } = await import('./lobby3d.js');
            addChunk(chunks[0].chunk_x, chunks[0].chunk_y, chunks[0].data);
        }
    } catch (error) {
        console.error('Error fetching chunk', error);
    }
}