// static/js/characters.js
import { Server } from './api.js';
import { showNotification } from './utils.js';

let currentLobbyId;
let mutantCatalog = [];

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

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function selectedMutant() {
    const name = document.getElementById('mutant-create-type')?.value;
    return mutantCatalog.find(item => item.name === name);
}

function updateMutantForm() {
    const mutant = selectedMutant();
    const variant = document.getElementById('mutant-create-variant');
    const name = document.getElementById('mutant-create-name');
    const preview = document.getElementById('mutant-create-preview');
    if (!mutant || !variant || !name || !preview) return;
    variant.innerHTML = '<option value="">Базовый вид</option>' + (mutant.variants || [])
        .map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
    name.value = mutant.name;
    preview.innerHTML = `
        <div><strong>ОЗ:</strong> ${mutant.health} · <strong>Перемещение:</strong> ${mutant.movement}</div>
        <div><strong>Защита:</strong> физическая ${mutant.physical_protection}%, аномальная ${mutant.anomaly_protection}%</div>
        <div><strong>Атаки:</strong> ${(mutant.attacks || []).map(item => `${escapeHtml(item.name)}: ${escapeHtml(item.effect)}`).join('<br>') || 'Нет'}</div>
        <div><strong>Особенности:</strong><br>${(mutant.traits || []).map(escapeHtml).join('<br>') || 'Нет'}</div>
    `;
}

export async function showCreateMutantForm() {
    if (!window.isGM) return;
    try {
        if (!mutantCatalog.length) {
            mutantCatalog = (await Server.getWorldRules(currentLobbyId)).mutants || [];
        }
        const select = document.getElementById('mutant-create-type');
        select.innerHTML = mutantCatalog.map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
        updateMutantForm();
        document.getElementById('mutant-create-modal').style.display = 'flex';
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

export function initMutantForm() {
    const modal = document.getElementById('mutant-create-modal');
    document.getElementById('mutant-create-type')?.addEventListener('change', updateMutantForm);
    document.getElementById('mutant-create-variant')?.addEventListener('change', event => {
        const name = document.getElementById('mutant-create-name');
        if (name) name.value = event.target.value || selectedMutant()?.name || '';
    });
    document.querySelector('[data-mutant-create-close]')?.addEventListener('click', () => {
        modal.style.display = 'none';
    });
    document.querySelector('[data-mutant-create-confirm]')?.addEventListener('click', async () => {
        try {
            await Server.createMutant(currentLobbyId, {
                mutant_type: document.getElementById('mutant-create-type').value,
                variant: document.getElementById('mutant-create-variant').value || null,
                name: document.getElementById('mutant-create-name').value,
            });
            modal.style.display = 'none';
            await loadLobbyCharacters();
            showNotification('Мутант создан', 'success');
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
}
