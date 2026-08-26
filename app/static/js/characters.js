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
    const regularCharacters = characters.filter(char => !char.data?.is_mutant && !char.data?.basic?.is_mutant);
    const mutants = characters.filter(char => char.data?.is_mutant || char.data?.basic?.is_mutant);

    const appendCharacterCard = (char, target) => {
        const charDiv = document.createElement('div');
        charDiv.className = 'character-card';
        charDiv.setAttribute('draggable', 'true');
        charDiv.setAttribute('data-character-id', char.id);
        charDiv.setAttribute('data-character-name', char.name);
        const title = document.createElement('h4');
        title.textContent = char.name;
        title.addEventListener('click', () => window.openCharacterSheet(char.id));
        charDiv.appendChild(title);

        charDiv.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({
                characterId: char.id,
                characterName: char.name,
                ownerId: char.owner_id
            }));
            e.dataTransfer.effectAllowed = 'copy';
            charDiv.classList.add('dragging');
        });
        charDiv.addEventListener('dragend', () => {
            charDiv.classList.remove('dragging');
            if (window.locationPreviewSprite) {
                window.locationPreviewSprite.visible = false;
            }
        });
        target.appendChild(charDiv);
    };

    if (regularCharacters.length) {
        const heading = document.createElement('div');
        heading.className = 'character-list-heading';
        heading.textContent = 'Персонажи';
        container.appendChild(heading);
        regularCharacters.forEach(char => appendCharacterCard(char, container));
    }

    if (mutants.length) {
        const heading = document.createElement('div');
        heading.className = 'character-list-heading mutant-list-heading';
        heading.textContent = 'Мутанты';
        container.appendChild(heading);
        const groups = new Map();
        mutants.forEach(char => {
            const type = char.data?.basic?.mutant_type || char.data?.mutant?.profile || 'Мутант';
            const variant = char.data?.basic?.mutant_variant || char.data?.mutant?.variant?.name || '';
            const key = `${type}\u0000${variant}`;
            if (!groups.has(key)) groups.set(key, { type, variant, members: [] });
            groups.get(key).members.push(char);
        });
        groups.forEach(group => {
            const details = document.createElement('details');
            details.className = 'mutant-group';
            const summary = document.createElement('summary');
            summary.textContent = `${group.type}${group.variant ? ` · ${group.variant}` : ''} ×${group.members.length}`;
            details.appendChild(summary);
            const members = document.createElement('div');
            members.className = 'mutant-group-members';
            group.members.forEach(char => {
                const row = document.createElement('div');
                row.className = 'mutant-instance-row';
                row.draggable = true;
                row.dataset.characterId = char.id;
                const health = char.data?.health || {};
                row.innerHTML = `
                    <button type="button" class="mutant-instance-open">${escapeHtml(char.name)}</button>
                    <span>${Number(health.current) || 0}/${Number(health.max) || 0} ОЗ</span>
                    <span class="mutant-drag-hint">перетащить</span>
                `;
                row.querySelector('.mutant-instance-open').addEventListener('click', () => openMutantCard(char.id));
                row.addEventListener('dragstart', event => {
                    event.dataTransfer.setData('text/plain', JSON.stringify({
                        characterId: char.id,
                        characterName: char.name,
                        ownerId: char.owner_id,
                    }));
                    event.dataTransfer.effectAllowed = 'copy';
                    row.classList.add('dragging');
                });
                row.addEventListener('dragend', () => row.classList.remove('dragging'));
                members.appendChild(row);
            });
            details.appendChild(members);
            container.appendChild(details);
        });
    }
}

export async function openMutantCard(characterId, loadedCharacter = null) {
    try {
        const character = loadedCharacter || await Server.getCharacter(characterId);
        const data = character.data || {};
        const mutant = data.mutant || {};
        const health = data.health || {};
        const modal = document.createElement('div');
        modal.className = 'modal mutant-card-modal';
        modal.style.display = 'flex';
        const attacks = (mutant.attacks || []).map(attack => `
            <div class="mutant-card-line"><strong>${escapeHtml(attack.name)}</strong><span>${escapeHtml(attack.effect || '')}</span></div>
        `).join('');
        const traits = (mutant.traits || []).map(trait => `<li>${escapeHtml(trait)}</li>`).join('');
        const variantTraits = (mutant.variant?.traits || []).map(trait => `<li>${escapeHtml(trait)}</li>`).join('');
        const zoneLabels = {
            head: 'Голова', chest: 'Грудь', abdomen: 'Живот',
            leftArm: 'Левая рука', rightArm: 'Правая рука',
            leftLeg: 'Левая нога', rightLeg: 'Правая нога',
        };
        const zones = Object.entries(health.zones || {}).map(([key, zone]) => {
            const current = Number(zone?.current) || 0;
            const maximum = Number(zone?.max) || 0;
            const percent = maximum > 0 ? Math.max(0, Math.min(100, current / maximum * 100)) : 0;
            return `
                <div class="mutant-health-zone ${current <= 0 ? 'is-disabled' : ''}">
                    <span>${escapeHtml(zoneLabels[key] || key)}</span>
                    <strong>${current}/${maximum}</strong>
                    <i style="--health-percent:${percent}%"></i>
                </div>
            `;
        }).join('');
        const areaLabels = {
            head: 'голова', chest: 'грудь', abdomen: 'живот',
            leftArm: 'левая рука', rightArm: 'правая рука',
            leftLeg: 'левая нога', rightLeg: 'правая нога',
        };
        const effectLabels = {
            bleeding_external_light: 'Лёгкое внешнее кровотечение',
            bleeding_external_medium: 'Среднее внешнее кровотечение',
            bleeding_external_severe: 'Сильное внешнее кровотечение',
            bleeding_external_extreme: 'Экстремальное внешнее кровотечение',
            bleeding_internal_light: 'Лёгкое внутреннее кровотечение',
            bleeding_internal_medium: 'Среднее внутреннее кровотечение',
            bleeding_internal_severe: 'Сильное внутреннее кровотечение',
            bleeding_internal_extreme: 'Экстремальное внутреннее кровотечение',
            fracture: 'Перелом', fracture_fixed: 'Зафиксированный перелом',
            fracture_unfixed: 'Незафиксированный перелом',
            mangled_limb: 'Искореженная конечность', amputation: 'Утраченная конечность',
            organ_loss: 'Повреждённый орган', organ_failure: 'Смертельное повреждение органа',
            shock: 'Болевой шок', unconsciousness: 'Без сознания',
            critical_condition: 'Критическое состояние', death: 'Смерть',
            pain: 'Боль', blindness: 'Слепота', deafness: 'Глухота',
            mutant_ambush: 'Засада: СЛ обнаружения +5',
            mutant_camouflage: 'Маскировка',
            mutant_pack: 'Бонус стаи',
            mutant_rage: 'Яростные атаки',
            mutant_provoked: 'Спровоцирован',
        };
        const hiddenEffectTypes = new Set(['stress', 'stress_effect', 'stress_stupor', 'phobia']);
        const visibleEffects = [
            ...(health.effects || []),
            ...(health.combatMeta?.mutantAmbushActive
                ? [{ type: 'mutant_ambush', active: true }]
                : []),
            ...(health.combatMeta?.mutantCamouflageActive
                ? [{
                    type: 'mutant_camouflage',
                    active: true,
                    area: `до раунда ${health.combatMeta.mutantCamouflageUntilRound}`,
                }]
                : []),
            ...(Number(health.combatMeta?.mutantPackRollBonus) > 0
                ? [{
                    type: 'mutant_pack',
                    active: true,
                    area: `+${Number(health.combatMeta.mutantPackRollBonus)} к броскам`,
                }]
                : []),
            ...(Number(health.combatMeta?.mutantRageAccuracy) > 0
                ? [{
                    type: 'mutant_rage',
                    active: true,
                    area: `+${Number(health.combatMeta.mutantRageAccuracy)} к точности`,
                }]
                : []),
            ...(health.combatMeta?.mutantProvoked
                ? [{ type: 'mutant_provoked', active: true }]
                : []),
        ];
        const effects = visibleEffects
            .filter(effect => effect && effect.active !== false && !hiddenEffectTypes.has(effect.type))
            .map(effect => {
                const label = effectLabels[effect.type] || effect.name || effect.type || 'Состояние';
                const area = areaLabels[effect.area] || effect.area;
                const value = effect.type === 'pain' && effect.value ? ` +${Number(effect.value)}` : '';
                return `<li><strong>${escapeHtml(label)}${escapeHtml(value)}</strong>${area ? `<span>${escapeHtml(area)}</span>` : ''}</li>`;
            }).join('');
        modal.innerHTML = `
            <div class="modal-content mutant-card-content">
                <button type="button" class="close mutant-card-close">&times;</button>
                <div class="mutant-card-kicker">${escapeHtml(mutant.profile || data.basic?.mutant_type || 'Мутант')}</div>
                <h3>${escapeHtml(character.name)}</h3>
                <div class="mutant-card-stats">
                    <span><strong>ОЗ</strong>${Number(health.current) || 0}/${Number(health.max) || 0}</span>
                    <span><strong>Перемещение</strong>${Number(data.movement?.base) || 0}</span>
                    <span><strong>Физ. защита</strong>${Number(mutant.physical_protection) || 0}%</span>
                    <span><strong>Аном. защита</strong>${Number(mutant.anomaly_protection) || 0}%</span>
                </div>
                <h4>Части тела</h4>
                <div class="mutant-health-zones">${zones || '<span>Нет данных</span>'}</div>
                <h4>Травмы и состояния</h4>
                <ul class="mutant-health-effects">${effects || '<li class="is-empty">Нет активных повреждений</li>'}</ul>
                <h4>Атаки</h4>
                <div class="mutant-card-attacks">${attacks || '<span>Нет</span>'}</div>
                ${(traits || variantTraits) ? `<h4>Особенности</h4><ul class="mutant-card-traits">${traits}${variantTraits}</ul>` : ''}
                ${window.isGM ? '<button type="button" class="btn btn-sm btn-danger mutant-card-delete">Удалить экземпляр</button>' : ''}
            </div>
        `;
        document.body.appendChild(modal);
        const close = () => modal.remove();
        modal.querySelector('.mutant-card-close').addEventListener('click', close);
        modal.addEventListener('pointerdown', event => {
            if (event.target === modal) close();
        });
        modal.querySelector('.mutant-card-delete')?.addEventListener('click', async () => {
            if (!window.confirm(`Удалить мутанта «${character.name}»?`)) return;
            await Server.deleteCharacter(characterId);
            close();
            await loadLobbyCharacters();
            showNotification('Мутант удалён', 'success');
        });
    } catch (error) {
        showNotification(error.message, 'error');
    }
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
        const count = document.getElementById('mutant-create-count');
        if (count) count.value = '1';
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
            const count = Math.max(1, Math.min(50, Number(document.getElementById('mutant-create-count')?.value) || 1));
            const baseName = document.getElementById('mutant-create-name').value.trim()
                || document.getElementById('mutant-create-type').value;
            const created = [];
            for (let index = 0; index < count; index += 1) {
                created.push(await Server.createMutant(currentLobbyId, {
                    mutant_type: document.getElementById('mutant-create-type').value,
                    variant: document.getElementById('mutant-create-variant').value || null,
                    name: count === 1 ? baseName : `${baseName} ${index + 1}`,
                }));
            }
            modal.style.display = 'none';
            await loadLobbyCharacters();
            const scene = await import('./locationScene.js');
            if (!scene.beginCharacterPlacement(created)) {
                showNotification(
                    `${count === 1 ? 'Мутант создан' : `Создано мутантов: ${count}`} в списке мутантов. Откройте подлокацию и перетащите нужные экземпляры на карту.`,
                    'success',
                );
            }
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
}
