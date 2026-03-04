// static/js/characters.js
import { apiFetch, getLobbyCharacters, createLobbyCharacter, deleteCharacter } from './api.js';
import { showNotification } from './utils.js';
import { isGM, openVisibilityModal } from './ui.js';

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
        container.innerHTML = '<p>В лобби пока нет персонажей</p>';
        return;
    }
    characters.forEach(char => {
        const charDiv = document.createElement('div');
        charDiv.className = 'character-card';
        charDiv.innerHTML = `
            <h4>${char.name}</h4>
            <p>Владелец: ${char.owner_username}</p>
            <button class="btn btn-sm" onclick="window.viewCharacter(${char.id})">Открыть</button>
        `;
        if (char.owner_id == localStorage.getItem('user_id') || isGM) {
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-sm';
            editBtn.textContent = '✏️';
            editBtn.onclick = (e) => { window.editCharacter(char.id); };
            charDiv.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-sm btn-danger';
            deleteBtn.textContent = '🗑️';
            deleteBtn.onclick = (e) => { deleteCharacterHandler(char.id); };
            charDiv.appendChild(deleteBtn);
        }
        if (isGM) {
            const visibilityBtn = document.createElement('button');
            visibilityBtn.className = 'btn btn-sm';
            visibilityBtn.textContent = '👁️';
            visibilityBtn.onclick = (e) => {
                openVisibilityModal(char.id, char.name, char.visible_to || []);
            };
            charDiv.appendChild(visibilityBtn);
        }
        container.appendChild(charDiv);
    });
}

window.viewCharacter = async (id) => {
    try {
        const char = await apiFetch(`/lobbies/characters/${id}`);
        showNotification(JSON.stringify(char.data, null, 2));
    } catch (error) {
        showNotification(error.message);
    }
};

window.editCharacter = (id) => showNotification('Редактирование пока не реализовано');

async function deleteCharacterHandler(id) {
    if (!confirm('Удалить персонажа?')) return;
    try {
        await deleteCharacter(id);
        showNotification('Персонаж удалён');
        loadLobbyCharacters();
    } catch (error) {
        showNotification(error.message);
    }
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

// Новая функция для вызова из HTML
export function showCreateCharacterForm() {
    const name = prompt('Введите имя персонажа:');
    if (!name) return;
    const data = prompt('Введите JSON данные (можно оставить пустым):', '{}');
    try {
        const parsed = JSON.parse(data || '{}');
        createCharacter(name, parsed);
    } catch (e) {
        showNotification('Некорректный JSON');
    }
}