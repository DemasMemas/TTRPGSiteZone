// static/js/characters.js
import { getLobbyCharacters, createLobbyCharacter, deleteCharacter } from './api.js';
import { showNotification } from './utils.js';

let currentLobbyId;
let token;

export function initCharacters(lobbyId, authToken) {
    currentLobbyId = lobbyId;
    token = authToken;
}

export async function loadLobbyCharacters() {
    try {
        const characters = await getLobbyCharacters(currentLobbyId);
        displayLobbyCharacters(characters);
    } catch (error) {
        console.error('Error loading characters', error);
    }
}

function displayLobbyCharacters(characters) {
    const container = document.getElementById('lobby-characters-list');
    if (!container) return;
    container.innerHTML = '';
    if (characters.length === 0) {
        container.innerHTML = '<p>В комнате пока нет персонажей</p>';
        return;
    }
    characters.forEach(char => {
        const charDiv = document.createElement('div');
        charDiv.className = 'character-card';
        charDiv.innerHTML = `
            <h4 style="cursor: pointer;" onclick="window.openCharacterSheet(${char.id})">${char.name}</h4>
        `;
        container.appendChild(charDiv);
    });
}

export async function createCharacter(name, data) {
    try {
        await createLobbyCharacter(currentLobbyId, name, data);
        showNotification('Персонаж создан');
        loadLobbyCharacters();
    } catch (error) {
        showNotification(error.message);
    }
}

export function showCreateCharacterForm() {
    const name = prompt('Введите имя персонажа:');
    if (!name) return;
    createCharacter(name, {});
}