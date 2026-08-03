import * as THREE from 'three';

import { Server } from './api.js';
import {
    camera,
    chunksMap,
    renderer,
    scene,
    setWorldTravelTileClickCallback,
} from './lobby3d.js';
import { showNotification } from './utils.js';

const CHUNK_SIZE = 32;
const models = new Map();
const eventModels = new Map();
const movementHighlights = [];
const contextRaycaster = new THREE.Raycaster();
const contextPointer = new THREE.Vector2();
let lobbyId = null;
let groups = [];
let pendingEvents = [];
let mapEvents = [];
let availableCharacters = [];
let selectionMode = null;
let contextMenu = null;
let editingMembersGroupId = null;

function tileHeight(tileX, tileY) {
    const chunkX = Math.floor(tileX / CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CHUNK_SIZE);
    const localX = tileX % CHUNK_SIZE;
    const localY = tileY % CHUNK_SIZE;
    return Number(chunksMap.get(`${chunkX},${chunkY}`)?.tilesData?.[localY]?.[localX]?.height || 1);
}

function makeLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.fillStyle = 'rgba(12, 15, 11, 0.88)';
    context.fillRect(8, 8, 368, 72);
    context.strokeStyle = '#b89a55';
    context.lineWidth = 4;
    context.strokeRect(8, 8, 368, 72);
    context.fillStyle = '#eee4c8';
    context.font = 'bold 34px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(text).slice(0, 20), 192, 44);
    const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.position.y = 1.75;
    return sprite;
}

function createGroupModel(group) {
    const root = new THREE.Group();
    const hitArea = new THREE.Mesh(
        new THREE.CylinderGeometry(0.68, 0.68, 1.5, 12),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitArea.position.y = 0.72;
    hitArea.userData.isWorldGroupHitArea = true;
    root.add(hitArea);
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.58, 24),
        new THREE.MeshBasicMaterial({ color: 0xc39b4a, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);

    const coat = new THREE.MeshStandardMaterial({ color: 0x596144, roughness: 0.9 });
    const heads = new THREE.MeshStandardMaterial({ color: 0xb99b75, roughness: 1 });
    [[-0.25, 0], [0.22, 0.13], [0.04, -0.25]].forEach(([x, z], index) => {
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.55, 8), coat);
        body.position.set(x, 0.38 + index * 0.02, z);
        root.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), heads);
        head.position.set(x, 0.72 + index * 0.02, z);
        root.add(head);
    });
    root.add(makeLabel(group.name));
    root.userData = { type: 'world-group', groupId: group.id };
    return root;
}

function createMapEventModel(event) {
    const root = new THREE.Group();
    const hitArea = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 1.5, 12),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitArea.position.y = 0.72;
    root.add(hitArea);
    const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x685c43, roughness: 0.9 })
    );
    pole.position.y = 0.43;
    root.add(pole);
    const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.24),
        new THREE.MeshStandardMaterial({ color: event.repeatable ? 0xc99236 : 0xa94132, roughness: 0.65 })
    );
    marker.position.y = 0.96;
    root.add(marker);
    const label = makeLabel(event.name);
    label.scale.set(2, 0.5, 1);
    label.position.y = 1.48;
    root.add(label);
    root.userData = { type: 'world-map-event', eventId: event.id };
    return root;
}

function disposeModel(model) {
    scene.remove(model);
    model.traverse(object => {
        object.geometry?.dispose?.();
        if (object.material?.map) object.material.map.dispose();
        object.material?.dispose?.();
    });
}

function renderModels() {
    const ids = new Set(groups.map(group => Number(group.id)));
    models.forEach((model, id) => {
        if (!ids.has(id)) {
            disposeModel(model);
            models.delete(id);
        }
    });
    groups.forEach(group => {
        let model = models.get(Number(group.id));
        if (!model) {
            model = createGroupModel(group);
            models.set(Number(group.id), model);
            scene.add(model);
        }
        model.position.set(group.tile_x + 0.5, tileHeight(group.tile_x, group.tile_y), group.tile_y + 0.5);
        const ring = model.children.find(child => child.geometry?.type === 'RingGeometry');
        if (ring?.material?.color) ring.material.color.set(group.has_pending_event ? 0xb64a35 : 0xc39b4a);
    });
    const eventIds = new Set(mapEvents.map(event => Number(event.id)));
    eventModels.forEach((model, id) => {
        if (!eventIds.has(id)) {
            disposeModel(model);
            eventModels.delete(id);
        }
    });
    mapEvents.forEach(event => {
        let model = eventModels.get(Number(event.id));
        if (!model) {
            model = createMapEventModel(event);
            eventModels.set(Number(event.id), model);
            scene.add(model);
        }
        model.position.set(event.tile_x + 0.5, tileHeight(event.tile_x, event.tile_y), event.tile_y + 0.5);
    });
}

function clearMovementHighlights() {
    movementHighlights.splice(0).forEach(mesh => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
    });
}

function isInsideMap(tileX, tileY) {
    return tileX >= 0
        && tileY >= 0
        && tileX < Number(window.MAP_CHUNKS_WIDTH || 0) * CHUNK_SIZE
        && tileY < Number(window.MAP_CHUNKS_HEIGHT || 0) * CHUNK_SIZE;
}

function showMovementHighlights(group) {
    clearMovementHighlights();
    const distance = Number(group.movement_distance || 0);
    for (let offsetY = -distance; offsetY <= distance; offsetY += 1) {
        for (let offsetX = -distance; offsetX <= distance; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue;
            const tileX = group.tile_x + offsetX;
            const tileY = group.tile_y + offsetY;
            if (!isInsideMap(tileX, tileY)) continue;
            const marker = new THREE.Mesh(
                new THREE.PlaneGeometry(0.86, 0.86),
                new THREE.MeshBasicMaterial({
                    color: 0xb89a55,
                    transparent: true,
                    opacity: 0.48,
                    side: THREE.DoubleSide,
                    depthWrite: false,
                })
            );
            marker.rotation.x = -Math.PI / 2;
            marker.position.set(tileX + 0.5, tileHeight(tileX, tileY) + 0.08, tileY + 0.5);
            marker.userData = { tileX, tileY };
            scene.add(marker);
            movementHighlights.push(marker);
        }
    }
}

function hideContextMenu() {
    if (contextMenu) contextMenu.style.display = 'none';
}

function worldObjectFromPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    contextPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    contextPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    contextRaycaster.setFromCamera(contextPointer, camera);
    const hits = contextRaycaster.intersectObjects(
        [...models.values(), ...eventModels.values()],
        true
    );
    if (!hits.length) return null;
    let object = hits[0].object;
    while (object && !['world-group', 'world-map-event'].includes(object.userData?.type)) {
        object = object.parent;
    }
    if (object?.userData?.type === 'world-group') {
        return {
            type: 'group',
            data: groups.find(group => Number(group.id) === Number(object.userData.groupId)),
        };
    }
    if (object?.userData?.type === 'world-map-event') {
        return {
            type: 'event',
            data: mapEvents.find(eventData => Number(eventData.id) === Number(object.userData.eventId)),
        };
    }
    return null;
}

function showGroupContextMenu(group, clientX, clientY) {
    if (!contextMenu) return;
    contextMenu.innerHTML = `
        <div class="world-group-context-title">${escapeHtml(group.name)}</div>
        <div class="world-group-context-speed">${escapeHtml(group.movement_speed_label)} · ${group.movement_distance} кл. / 10 мин.</div>
        <button type="button" data-context-move ${group.has_pending_event || group.movement_distance <= 0 ? 'disabled' : ''}>Переместить</button>
        ${window.isGM && group.has_pending_event ? '<button type="button" data-context-event>Ожидающее событие</button>' : ''}
        ${window.isGM ? '<button type="button" data-context-delete>Удалить с карты</button>' : ''}
    `;
    contextMenu.style.display = 'grid';
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.min(clientX, window.innerWidth - rect.width - 8)}px`;
    contextMenu.style.top = `${Math.min(clientY, window.innerHeight - rect.height - 8)}px`;
    contextMenu.querySelector('[data-context-move]')?.addEventListener('click', () => {
        hideContextMenu();
        beginWorldGroupMove(group.id);
    });
    contextMenu.querySelector('[data-context-event]')?.addEventListener('click', () => {
        hideContextMenu();
        const pendingEvent = pendingEvents.find(event => Number(event.group_id) === Number(group.id));
        openWorldTravelModal();
        if (!pendingEvent) return;
        requestAnimationFrame(() => {
            const card = document.querySelector(`[data-world-event-card="${pendingEvent.id}"]`);
            card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card?.classList.add('world-event-focus');
            setTimeout(() => card?.classList.remove('world-event-focus'), 1400);
        });
    });
    contextMenu.querySelector('[data-context-delete]')?.addEventListener('click', async () => {
        hideContextMenu();
        try {
            await Server.deleteWorldGroup(lobbyId, group.id);
            await refreshWorldTravel();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
}

function showMapEventContextMenu(event, clientX, clientY) {
    if (!contextMenu || !window.isGM) return;
    contextMenu.innerHTML = `
        <div class="world-group-context-title">${escapeHtml(event.name)}</div>
        <div class="world-group-context-speed">${event.repeatable ? 'Повторяемое событие' : 'Одноразовое событие'} · клетка ${event.tile_x}, ${event.tile_y}</div>
        <div class="world-map-event-context-description">${escapeHtml(event.description)}</div>
        <button type="button" data-context-delete-event>Удалить событие</button>
    `;
    contextMenu.style.display = 'grid';
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.min(clientX, window.innerWidth - rect.width - 8)}px`;
    contextMenu.style.top = `${Math.min(clientY, window.innerHeight - rect.height - 8)}px`;
    contextMenu.querySelector('[data-context-delete-event]')?.addEventListener('click', async () => {
        hideContextMenu();
        try {
            await Server.deleteWorldMapEvent(lobbyId, event.id);
            await refreshWorldTravel();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    });
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderModal() {
    const list = document.getElementById('world-group-list');
    const events = document.getElementById('world-event-list');
    const create = document.getElementById('world-group-create');
    const mapEventCreate = document.getElementById('world-map-event-create');
    const mapEventList = document.getElementById('world-map-event-list');
    if (!list || !events || !create || !mapEventCreate || !mapEventList) return;
    create.style.display = window.isGM ? 'flex' : 'none';
    mapEventCreate.style.display = window.isGM ? 'grid' : 'none';
    list.innerHTML = groups.length ? groups.map(group => `
        <div class="world-group-row">
            <div>
                <strong>${escapeHtml(group.name)}</strong>
                <small>Клетка ${group.tile_x}, ${group.tile_y}${group.has_pending_event ? ' · ожидает решения ГМа' : ''}</small>
                <small>Состав: ${group.members?.length ? group.members.map(member => escapeHtml(member.name)).join(', ') : 'не задан'}</small>
                <small>Скорость: ${escapeHtml(group.movement_speed_label)} · штраф ${group.movement_penalty} · ${group.movement_distance} кл. за 10 минут</small>
            </div>
            <div class="world-group-actions">
                ${window.isGM ? `<button class="btn btn-sm btn-secondary" data-world-members="${group.id}">Состав</button>` : ''}
                ${window.isGM ? `<button class="btn btn-sm btn-danger" data-world-delete="${group.id}">Удалить</button>` : ''}
            </div>
        </div>
    `).join('') : '<p class="world-travel-empty">На карте пока нет групп.</p>';

    events.innerHTML = pendingEvents.length ? pendingEvents.map(event => `
        <div class="world-event-row" data-world-event-card="${event.id}">
            <strong>${escapeHtml(event.group_name)}</strong>
            <p>${window.isGM ? escapeHtml(event.description) : 'Случайное событие ожидает решения ГМа.'}</p>
            ${window.isGM ? `<div class="world-group-actions">
                <button class="btn btn-sm btn-primary" data-event-decision="approve" data-event-id="${event.id}">Одобрить</button>
                <button class="btn btn-sm btn-secondary" data-event-decision="reject" data-event-id="${event.id}">Отклонить</button>
            </div>` : ''}
        </div>
    `).join('') : '<p class="world-travel-empty">Ожидающих событий нет.</p>';
    mapEventList.innerHTML = window.isGM && mapEvents.length
        ? mapEvents.map(event => `
            <div class="world-map-event-row">
                <div>
                    <strong>${escapeHtml(event.name)}</strong>
                    <small>Клетка ${event.tile_x}, ${event.tile_y} · ${event.repeatable ? 'повторяемое' : 'одноразовое'}</small>
                </div>
                <button class="btn btn-sm btn-danger" data-world-map-event-delete="${event.id}">Удалить</button>
            </div>
        `).join('')
        : '<p class="world-travel-empty">Расставленных событий нет.</p>';
    renderMembersEditor();
}

function renderMembersEditor() {
    const editor = document.getElementById('world-group-members-editor');
    const title = document.getElementById('world-group-members-title');
    const list = document.getElementById('world-group-members-list');
    if (!editor || !title || !list) return;
    const group = groups.find(item => Number(item.id) === Number(editingMembersGroupId));
    if (!window.isGM || !group) {
        editor.style.display = 'none';
        return;
    }
    const selected = new Set((group.members || []).map(member => Number(member.id)));
    title.textContent = `Состав: ${group.name}`;
    list.innerHTML = availableCharacters.length
        ? availableCharacters.map(character => `
            <label class="world-group-member-option">
                <input type="checkbox" value="${character.id}" ${selected.has(Number(character.id)) ? 'checked' : ''}>
                <span>${escapeHtml(character.name)}</span>
            </label>
        `).join('')
        : '<p class="world-travel-empty">В комнате нет персонажей.</p>';
    editor.style.display = 'block';
}

function openMembersEditor(groupId) {
    editingMembersGroupId = Number(groupId);
    renderMembersEditor();
    document.getElementById('world-group-members-editor')?.scrollIntoView({ block: 'nearest' });
}

async function saveMembersEditor() {
    if (!window.isGM || !editingMembersGroupId) return;
    const ids = [...document.querySelectorAll('#world-group-members-list input:checked')]
        .map(input => Number(input.value));
    try {
        await Server.updateWorldGroupMembers(lobbyId, editingMembersGroupId, ids);
        editingMembersGroupId = null;
        await refreshWorldTravel();
        showNotification('Состав группы сохранён', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

export async function refreshWorldTravel() {
    if (!lobbyId) return;
    try {
        const data = await Server.getWorldGroups(lobbyId);
        groups = data.groups || [];
        pendingEvents = data.pending_events || [];
        mapEvents = data.map_events || [];
        availableCharacters = data.available_characters || [];
        renderModels();
        renderModal();
    } catch (error) {
        console.error('World travel load failed:', error);
    }
}

export function openWorldTravelModal() {
    renderModal();
    document.getElementById('world-travel-modal').style.display = 'flex';
}

export function closeWorldTravelModal() {
    document.getElementById('world-travel-modal').style.display = 'none';
}

export function beginWorldGroupCreation() {
    if (!window.isGM) return;
    const input = document.getElementById('world-group-name');
    const name = input?.value.trim();
    if (!name) {
        showNotification('Введите название группы', 'error');
        return;
    }
    selectionMode = { type: 'create', name };
    closeWorldTravelModal();
    showNotification('Выберите клетку для группы. Esc отменяет выбор.', 'system');
}

export function beginWorldMapEventCreation() {
    if (!window.isGM) return;
    const name = document.getElementById('world-map-event-name')?.value.trim();
    const description = document.getElementById('world-map-event-description')?.value.trim();
    const repeatable = document.getElementById('world-map-event-repeatable')?.checked === true;
    if (!name || !description) {
        showNotification('Укажите название и описание события', 'error');
        return;
    }
    selectionMode = { type: 'event-create', name, description, repeatable };
    closeWorldTravelModal();
    showNotification('Выберите клетку для события. Esc отменяет выбор.', 'system');
}

export function beginWorldGroupMove(groupId) {
    const group = groups.find(item => Number(item.id) === Number(groupId));
    if (!group || group.has_pending_event) return;
    if (Number(group.movement_distance || 0) <= 0) {
        showNotification('Группа не может идти: максимальный штраф перемещения 10 или выше', 'error');
        return;
    }
    selectionMode = { type: 'move', groupId: Number(groupId) };
    showMovementHighlights(group);
    showNotification(
        `Выберите подсвеченную клетку в пределах ${group.movement_distance}. Esc отменяет перемещение.`,
        'system'
    );
}

async function handleTileSelection({ tile }) {
    if (!selectionMode) return false;
    const tileX = tile.chunkX * CHUNK_SIZE + tile.tileX;
    const tileY = tile.chunkY * CHUNK_SIZE + tile.tileY;
    const mode = selectionMode;
    if (mode.type === 'move') {
        const group = groups.find(item => Number(item.id) === Number(mode.groupId));
        const distance = group
            ? maxDistance(tileX, tileY, group.tile_x, group.tile_y)
            : Infinity;
        if (distance < 1 || distance > Number(group?.movement_distance || 0)) {
            showNotification(`Выберите клетку в пределах ${group?.movement_distance || 0}`, 'error');
            return true;
        }
    }
    selectionMode = null;
    clearMovementHighlights();
    try {
        if (mode.type === 'create') {
            await Server.createWorldGroup(lobbyId, { name: mode.name, tile_x: tileX, tile_y: tileY });
            const input = document.getElementById('world-group-name');
            if (input) input.value = '';
            showNotification('Группа создана', 'success');
        } else if (mode.type === 'event-create') {
            await Server.createWorldMapEvent(lobbyId, {
                name: mode.name,
                description: mode.description,
                repeatable: mode.repeatable,
                tile_x: tileX,
                tile_y: tileY,
            });
            document.getElementById('world-map-event-name').value = '';
            document.getElementById('world-map-event-description').value = '';
            document.getElementById('world-map-event-repeatable').checked = false;
            showNotification('Событие размещено на карте', 'success');
        } else {
            const result = await Server.moveWorldGroup(lobbyId, mode.groupId, tileX, tileY);
            showNotification(
                result.event_pending
                    ? 'Группа перемещена. Событие ожидает решения ГМа.'
                    : 'Группа перемещена. Прошло 10 минут.',
                result.event_pending ? 'system' : 'success'
            );
        }
        await refreshWorldTravel();
    } catch (error) {
        showNotification(error.message, 'error');
    }
    return true;
}

async function handleModalClick(event) {
    const mapEventDelete = event.target.closest('[data-world-map-event-delete]');
    if (mapEventDelete) {
        try {
            await Server.deleteWorldMapEvent(lobbyId, mapEventDelete.dataset.worldMapEventDelete);
            await refreshWorldTravel();
        } catch (error) {
            showNotification(error.message, 'error');
        }
        return;
    }
    const members = event.target.closest('[data-world-members]');
    if (members) return openMembersEditor(members.dataset.worldMembers);
    if (event.target.closest('[data-world-members-save]')) return saveMembersEditor();
    if (event.target.closest('[data-world-members-cancel]')) {
        editingMembersGroupId = null;
        renderMembersEditor();
        return;
    }
    const remove = event.target.closest('[data-world-delete]');
    if (remove) {
        try {
            await Server.deleteWorldGroup(lobbyId, remove.dataset.worldDelete);
            await refreshWorldTravel();
        } catch (error) {
            showNotification(error.message, 'error');
        }
        return;
    }
    const decision = event.target.closest('[data-event-decision]');
    if (decision) {
        try {
            await Server.resolveWorldTravelEvent(
                lobbyId,
                decision.dataset.eventId,
                decision.dataset.eventDecision
            );
            await refreshWorldTravel();
        } catch (error) {
            showNotification(error.message, 'error');
        }
    }
}

function maxDistance(x1, y1, x2, y2) {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

export function initWorldTravel(currentLobbyId, socket) {
    lobbyId = currentLobbyId;
    setWorldTravelTileClickCallback(handleTileSelection);
    contextMenu = document.createElement('div');
    contextMenu.className = 'world-group-context-menu';
    contextMenu.style.display = 'none';
    document.querySelector('.ui-overlay')?.appendChild(contextMenu);
    renderer.domElement.addEventListener('contextmenu', event => {
        if (window.isLocationActive) return;
        const worldObject = worldObjectFromPointer(event);
        if (!worldObject?.data) {
            hideContextMenu();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (worldObject.type === 'group') {
            showGroupContextMenu(worldObject.data, event.clientX, event.clientY);
        } else if (window.isGM) {
            showMapEventContextMenu(worldObject.data, event.clientX, event.clientY);
        }
    });
    document.addEventListener('pointerdown', event => {
        if (contextMenu && !contextMenu.contains(event.target)) hideContextMenu();
    });
    document.getElementById('world-travel-modal')?.addEventListener('click', handleModalClick);
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !selectionMode) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        selectionMode = null;
        clearMovementHighlights();
        hideContextMenu();
        showNotification('Выбор клетки отменён', 'system');
    }, true);
    ['world_group_created', 'world_group_updated', 'world_group_moved', 'world_group_deleted',
        'world_map_event_created', 'world_map_event_deleted', 'world_map_event_triggered',
        'world_travel_event_pending', 'world_travel_event_resolved'].forEach(eventName => {
        socket.on(eventName, refreshWorldTravel);
    });
    return refreshWorldTravel();
}
