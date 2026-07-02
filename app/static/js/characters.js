// static/js/characters.js
import { Server } from './api.js';
import { showNotification } from './utils.js';

let currentLobbyId;

export function initCharacters(lobbyId) {
    currentLobbyId = lobbyId;
}

export async function loadLobbyCharacters() {
    try {
        const characters = await Server.getLobbyCharacters(currentLobbyId);
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
        charDiv.setAttribute('draggable', 'true');
        charDiv.setAttribute('data-character-id', char.id);
        charDiv.setAttribute('data-character-name', char.name);
        charDiv.innerHTML = `
            <h4 style="cursor: pointer;" onclick="window.openCharacterSheet(${char.id})">${char.name}</h4>
        `;

        // Drag start
        charDiv.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({
                characterId: char.id,
                characterName: char.name,
                ownerId: char.owner_id
            }));
            e.dataTransfer.effectAllowed = 'copy';
            charDiv.classList.add('dragging');
            // Показываем превью перетаскивания (браузерное)
            // Но мы будем рисовать свой 3D-превью отдельно
        });
        charDiv.addEventListener('dragend', (e) => {
            charDiv.classList.remove('dragging');
            // Скрываем 3D-превью
            if (window.locationPreviewSprite) {
                window.locationPreviewSprite.visible = false;
            }
        });

        container.appendChild(charDiv);
    });
}

export async function createCharacter(name, data) {
    try {
        await Server.createLobbyCharacter(currentLobbyId, name, data);
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