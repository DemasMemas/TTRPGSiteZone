// static/js/markers.js
import * as THREE from 'three';
import { scene, camera, renderer, controls, getHoveredTile } from './lobby3d.js';
import { showNotification } from './utils.js';
import AppState from './state.js';

let socket;
let currentLobbyId;
let token;
let markers = new Map(); // id -> { sprite, data }
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let dragState = null;
let hoveredMarkerId = null;
let tooltipDiv = null;
let routeLines = new Map();
let routeDatalistCreate = null;
let routeDatalistEdit = null;

// Для выбора тайла
let awaitingTilePick = false;
let tilePickCallback = null;

// Размеры карты в тайлах
let mapWidthTiles = 0;
let mapHeightTiles = 0;

export function updateMapTileSize(chunksWidth, chunksHeight) {
    mapWidthTiles = chunksWidth * 32;
    mapHeightTiles = chunksHeight * 32;
}

function createTooltip() {
    if (tooltipDiv) return;
    tooltipDiv = document.createElement('div');
    tooltipDiv.style.position = 'absolute';
    tooltipDiv.style.background = 'rgba(0,0,0,0.8)';
    tooltipDiv.style.color = 'white';
    tooltipDiv.style.padding = '5px 10px';
    tooltipDiv.style.borderRadius = '5px';
    tooltipDiv.style.fontSize = '14px';
    tooltipDiv.style.pointerEvents = 'none';
    tooltipDiv.style.zIndex = '1000';
    tooltipDiv.style.display = 'none';
    tooltipDiv.style.maxWidth = '300px';
    tooltipDiv.style.wordWrap = 'break-word';
    document.body.appendChild(tooltipDiv);
}

// Улучшенная функция переноса текста
function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    for (let word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}

function createMarkerTexture(type, color, name = '') {
    const canvas = document.createElement('canvas');
    let ctx, canvasWidth, canvasHeight;

    if (type === 'place') {
        canvas.width = 1024;
        canvas.height = 1024;
        ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 96px Arial';
        ctx.fillStyle = color || '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.imageSmoothingEnabled = true;
        const lines = wrapText(ctx, name || '?', canvas.width - 120);
        const lineHeight = 120;
        const startY = (canvas.height - lines.length * lineHeight) / 2 + lineHeight/2;
        lines.forEach((line, index) => {
            ctx.fillText(line, canvas.width/2, startY + index * lineHeight);
        });
    } else {
        canvas.width = 64;
        canvas.height = 64;
        ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.fillStyle = color || '#ffaa00';
        ctx.globalAlpha = 0.7;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 28px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1.0;

        let symbol = '?';
        switch (type) {
            case 'cache': symbol = '📦'; break;
            case 'lair': symbol = '🐾'; break;
            case 'camp': symbol = '⛺'; break;
            case 'anomaly': symbol = '⚠️'; break;
            case 'route_point': symbol = '◉'; break;
            default: symbol = '📍';
        }
        ctx.fillText(symbol, 32, 34);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
}

function createMarkerSprite(marker) {
    const { type, color, position, name } = marker;
    const texture = createMarkerTexture(type, color, name);
    const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        transparent: true
    });
    const sprite = new THREE.Sprite(material);

    // Масштаб в зависимости от типа
    let scale = 2.5;
    if (type === 'route_point') scale = 1.2;
    else if (type === 'place') scale = 3.0;
    sprite.scale.set(scale, scale, 1);

    sprite.position.set(position.x, position.y + 0.8, position.z);
    sprite.userData = { type: 'marker', markerId: marker.id, markerData: marker };
    scene.add(sprite);
    return sprite;
}

export function initMarkers(lobbyId, authToken, socketInstance) {
    currentLobbyId = lobbyId;
    token = authToken;
    socket = socketInstance;
    createTooltip();

    socket.on('markers_list', (markersData) => {
        clearMarkers();
        markersData.forEach(m => addMarkerToScene(m));
        updateRouteDatalists();

        // После добавления всех маркеров обновляем линии маршрутов
        const uniqueRouteIds = new Set();
        markers.forEach(entry => {
            if (entry.data.type === 'route_point' && entry.data.routeId) {
                uniqueRouteIds.add(entry.data.routeId);
            }
        });
        uniqueRouteIds.forEach(id => updateRouteLines(id));
    });

    socket.on('marker_added', (marker) => {
        addMarkerToScene(marker);
        updateRouteDatalists();
    });

    socket.on('marker_updated', (data) => {
        console.log('Marker updated:', data);
        const markerId = data.id;
        const updates = data.updates;

        const entry = markers.get(markerId);
        if (!entry) return;

        // Обновляем данные маркера
        Object.assign(entry.data, updates);

        // Проверяем видимость после обновления
        if (!canSeeMarkerForCurrentUser(entry.data)) {
            // Маркер стал невидим – удаляем
            removeMarkerFromScene(markerId);
        } else {
            // Маркер видим – обновляем внешний вид
            if (updates.color || updates.type) {
                const newTexture = createMarkerTexture(entry.data.type, entry.data.color, entry.data.name);
                entry.sprite.material.map = newTexture;
                entry.sprite.material.needsUpdate = true;
            }
            if (updates.position) {
                entry.sprite.position.set(updates.position.x, updates.position.y + 0.8, updates.position.z);
            }
        }

        // Если маркер связан с маршрутом, обновляем линии
        if (entry.data.routeId) {
            updateRouteLines(entry.data.routeId);
        }
        updateRouteDatalists();
    });

    socket.on('marker_moved', (data) => {
        console.log('Marker moved:', data);
        moveMarkerInScene(data.id, data.position);
        const entry = markers.get(data.id);
        if (entry && entry.data.routeId) {
            updateRouteLines(entry.data.routeId);
        }
    });

    socket.on('marker_deleted', (data) => {
        console.log('Marker deleted:', data);
        const entry = markers.get(data.id);
        const routeId = entry?.data?.routeId;
        removeMarkerFromScene(data.id);
        if (routeId) {
            updateRouteLines(routeId);
        }
        updateRouteDatalists();
    });

    socket.emit('get_markers', { token, lobby_id: currentLobbyId });

    socket.on('connect_error', (err) => {
        showNotification('Ошибка соединения: ' + err.message, 'error');
    });

    socket.onAny((event, ...args) => {
        console.log(`[Socket] ${event}`, args);
    });
}

function addMarkerToScene(marker) {
    if (markers.has(marker.id)) return;
    console.log('Adding marker to scene:', marker.id, marker.position);
    const sprite = createMarkerSprite(marker);
    markers.set(marker.id, { sprite, data: marker });

    if (marker.type === 'route_point' && marker.routeId) {
        updateRouteLines(marker.routeId);
    }
}

function updateMarkerInScene(id, updates) {
    const entry = markers.get(id);
    if (!entry) return;
    Object.assign(entry.data, updates);
    if (updates.color || updates.type) {
        const newTexture = createMarkerTexture(entry.data.type, entry.data.color, entry.data.name);
        entry.sprite.material.map = newTexture;
        entry.sprite.material.needsUpdate = true;
    }
    if (updates.position) {
        entry.sprite.position.set(updates.position.x, updates.position.y + 0.8, updates.position.z);
    }
}

function moveMarkerInScene(id, position) {
    const entry = markers.get(id);
    if (!entry) return;
    entry.sprite.position.set(position.x, position.y + 0.8, position.z);
    entry.data.position = position;
}

function removeMarkerFromScene(id) {
    const entry = markers.get(id);
    if (!entry) return;
    scene.remove(entry.sprite);
    entry.sprite.material.dispose();
    entry.sprite.geometry.dispose();
    markers.delete(id);
}

function clearMarkers() {
    markers.forEach(entry => {
        scene.remove(entry.sprite);
        entry.sprite.material.dispose();
        entry.sprite.geometry.dispose();
    });
    markers.clear();

    // Удаляем все линии маршрутов
    routeLines.forEach(line => scene.remove(line));
    routeLines.clear();
}

function updateTooltipPosition(clientX, clientY) {
    if (!tooltipDiv) return;
    tooltipDiv.style.left = clientX + 15 + 'px';
    tooltipDiv.style.top = clientY - 40 + 'px';
}

function showTooltip(markerData, clientX, clientY) {
    if (!tooltipDiv) return;
    tooltipDiv.innerHTML = `<b>${markerData.name || 'Без названия'}</b><br>${markerData.description || ''}`;
    tooltipDiv.style.display = 'block';
    updateTooltipPosition(clientX, clientY);
}

function hideTooltip() {
    if (!tooltipDiv) return;
    tooltipDiv.style.display = 'none';
}
window.hideTooltip = hideTooltip;

function canSeeMarkerForCurrentUser(marker) {
    const userId = parseInt(localStorage.getItem('user_id'));
    if (AppState.isGM) return true;
    const visibleTo = marker.visibleTo || [];
    return visibleTo.includes('all') || visibleTo.includes(userId);
}

function updateRouteLines(routeId) {
    if (!routeId) return;

    // Удаляем старую линию
    if (routeLines.has(routeId)) {
        scene.remove(routeLines.get(routeId));
        routeLines.delete(routeId);
    }

    // Собираем все точки с данным routeId
    const points = [];
    markers.forEach((entry) => {
        if (entry.data.type === 'route_point' && entry.data.routeId === routeId && entry.data.routeOrder !== undefined) {
            points.push({
                order: entry.data.routeOrder,
                pos: entry.sprite.position.clone()
            });
        }
    });

    if (points.length < 2) return;

    points.sort((a, b) => a.order - b.order);
    const positions = [];
    points.forEach(p => {
        positions.push(p.pos.x, p.pos.y - 0.4, p.pos.z);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xffaa00 });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    routeLines.set(routeId, line);
}

export function setupMarkerInteraction() {
    const canvas = renderer.domElement;

    canvas.addEventListener('mousemove', (event) => {
        console.log('mousemove on canvas');
        if (AppState.editMode) {
            if (hoveredMarkerId !== null) {
                hoveredMarkerId = null;
                hideTooltip();
            }
            return;
        }

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const markerSprites = Array.from(markers.values()).map(e => e.sprite);
        const intersects = raycaster.intersectObjects(markerSprites);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            const markerId = hit.userData.markerId;
            const markerData = markers.get(markerId)?.data;
            if (!markerData) return;

            if (hoveredMarkerId !== markerId) {
                hoveredMarkerId = markerId;
                showTooltip(markerData, event.clientX, event.clientY);
            } else {
                updateTooltipPosition(event.clientX, event.clientY);
            }
        } else {
            if (hoveredMarkerId !== null) {
                hoveredMarkerId = null;
                hideTooltip();
            }
        }
    });

    // Обработчик клика для выбора тайла
    canvas.addEventListener('click', (event) => {
        if (!awaitingTilePick) return;
        event.preventDefault();
        event.stopPropagation();

        const hovered = getHoveredTile();
        if (!hovered) {
            showNotification('Не удалось определить тайл', 'error');
            return;
        }

        const worldX = hovered.chunk.chunkX * 32 + hovered.tileX + 0.5;
        const worldZ = hovered.chunk.chunkY * 32 + hovered.tileY + 0.5;
        const height = hovered.tileData.height || 1.0;

        if (tilePickCallback) {
            tilePickCallback(worldX, height, worldZ);
        }
    }, { capture: true });

    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (hoveredMarkerId === null) return;

        const markerId = hoveredMarkerId;
        const entry = markers.get(markerId);
        if (!entry) return;

        const sprite = entry.sprite;
        console.log('Starting drag for marker', markerId);

        event.preventDefault();
        event.stopPropagation();
        canvas.setPointerCapture(event.pointerId);

        const spritePos = sprite.position.clone();
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -spritePos.y);

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const startPoint = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, startPoint)) return;

        dragState = {
            markerId,
            startPoint,
            startSpritePos: spritePos,
            plane,
            pointerId: event.pointerId
        };

        controls.enabled = false;
        canvas.style.cursor = 'grabbing';

        const onPointerMove = (e) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            e.preventDefault();
            e.stopPropagation();

            const mouseCoords = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            raycaster.setFromCamera(mouseCoords, camera);
            const newPoint = new THREE.Vector3();
            if (!raycaster.ray.intersectPlane(dragState.plane, newPoint)) return;

            const deltaX = newPoint.x - dragState.startPoint.x;
            const deltaZ = newPoint.z - dragState.startPoint.z;

            const newPos = dragState.startSpritePos.clone();
            newPos.x += deltaX;
            newPos.z += deltaZ;

            const entry = markers.get(dragState.markerId);
            if (entry) {
                entry.sprite.position.copy(newPos);
            }
        };

        const onPointerUp = (e) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            e.preventDefault();
            e.stopPropagation();

            const entry = markers.get(dragState.markerId);
            if (entry) {
                const newPos = entry.sprite.position.clone();
                console.log('Move marker sent', dragState.markerId, newPos);
                socket.emit('move_marker', {
                    token,
                    lobby_id: currentLobbyId,
                    marker_id: dragState.markerId,
                    position: { x: newPos.x, y: newPos.y - 0.8, z: newPos.z }
                });

                // Обновляем линии маршрута, если нужно
                if (entry.data.routeId) {
                    updateRouteLines(entry.data.routeId);
                }
            }

            canvas.releasePointerCapture(e.pointerId);
            dragState = null;
            controls.enabled = true;
            canvas.style.cursor = 'default';

            canvas.removeEventListener('pointermove', onPointerMove);
            canvas.removeEventListener('pointerup', onPointerUp);
        };

        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
    }, { capture: true });

    canvas.addEventListener('dblclick', (event) => {
        if (AppState.editMode) return;
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const markerSprites = Array.from(markers.values()).map(e => e.sprite);
        const intersects = raycaster.intersectObjects(markerSprites);
        if (intersects.length > 0) {
            const markerId = intersects[0].object.userData.markerId;
            const markerEntry = markers.get(markerId);
            if (!markerEntry) {
                showNotification('Маркер не найден');
                return;
            }
            const markerData = markerEntry.data;
            console.log('Opening edit modal for', markerData);
            openMarkerEditModal(markerData);
            event.preventDefault();
            event.stopPropagation();
        } else {
            const hovered = getHoveredTile();
            if (hovered) {
                const worldX = hovered.chunk.chunkX * 32 + hovered.tileX + 0.5;
                const worldZ = hovered.chunk.chunkY * 32 + hovered.tileY + 0.5;
                const height = hovered.tileData.height || 1.0;
                openCreateMarkerModal({ x: worldX, y: height + 0.8, z: worldZ });
                event.preventDefault();
                event.stopPropagation();
            }
        }
    }, { capture: true });
}

// ---------- Функции для выбора тайла ----------
export function pickTileForMarker() {
    document.getElementById('marker-create-modal').style.display = 'none';
    awaitingTilePick = true;
    showNotification('Кликните по тайлу на карте', 'system');
    tilePickCallback = (worldX, height, worldZ) => {
        document.getElementById('marker-create-pos-x').value = worldX.toFixed(2);
        document.getElementById('marker-create-pos-y').value = (height + 0.8).toFixed(2);
        document.getElementById('marker-create-pos-z').value = worldZ.toFixed(2);
        document.getElementById('marker-create-modal').style.display = 'flex';
        awaitingTilePick = false;
        tilePickCallback = null;
    };
}

// ---------- Функции для работы с выпадающим списком маршрутов ----------
function toggleRouteFields(modalType) {
    const typeSelect = document.getElementById(`marker-${modalType}-type`);
    const routeFields = document.getElementById(`route-fields-${modalType}`);
    if (typeSelect && routeFields) {
        routeFields.style.display = typeSelect.value === 'route_point' ? 'block' : 'none';
    }
}

// ---------- Модальное окно создания ----------
export function openCreateMarkerModal(position = null) {
    updateRouteDatalists();
    if (position) {
        document.getElementById('marker-create-pos-x').value = position.x.toFixed(2);
        document.getElementById('marker-create-pos-y').value = position.y.toFixed(2);
        document.getElementById('marker-create-pos-z').value = position.z.toFixed(2);
    } else {
        document.getElementById('marker-create-pos-x').value = '0';
        document.getElementById('marker-create-pos-y').value = '0';
        document.getElementById('marker-create-pos-z').value = '0';
    }
    document.getElementById('marker-create-name').value = '';
    document.getElementById('marker-create-desc').value = '';
    document.getElementById('marker-create-color').value = '#ffaa00';
    document.getElementById('marker-create-type').value = 'cache';
    document.getElementById('marker-create-visible-all').checked = true;
    document.getElementById('marker-create-route-id').value = '';
    document.getElementById('marker-create-route-order').value = '1';

    const typeSelect = document.getElementById('marker-create-type');
    typeSelect.removeEventListener('change', () => toggleRouteFields('create'));
    typeSelect.addEventListener('change', () => toggleRouteFields('create'));
    toggleRouteFields('create');

    document.getElementById('marker-create-modal').style.display = 'flex';
}

export function openCreateMarkerModalAtCenter() {
    const centerX = mapWidthTiles / 2;
    const centerZ = mapHeightTiles / 2;
    import('./lobby3d.js').then(({ getTileHeightAt }) => {
        const height = getTileHeightAt(centerX, centerZ);
        const pos = { x: centerX, y: height + 0.8, z: centerZ };
        openCreateMarkerModal(pos);
    }).catch(() => {
        openCreateMarkerModal({ x: centerX, y: 0.8, z: centerZ });
    });
}

export function fillCenterCoordinates() {
    const centerX = mapWidthTiles / 2;
    const centerZ = mapHeightTiles / 2;
    import('./lobby3d.js').then(({ getTileHeightAt }) => {
        const height = getTileHeightAt(centerX, centerZ);
        const posY = (height + 0.8).toFixed(2);
        document.getElementById('marker-create-pos-x').value = centerX.toFixed(2);
        document.getElementById('marker-create-pos-y').value = posY;
        document.getElementById('marker-create-pos-z').value = centerZ.toFixed(2);
    }).catch(() => {
        document.getElementById('marker-create-pos-x').value = centerX.toFixed(2);
        document.getElementById('marker-create-pos-y').value = '0.80';
        document.getElementById('marker-create-pos-z').value = centerZ.toFixed(2);
    });
}

export function submitCreateMarker() {
    const type = document.getElementById('marker-create-type').value;
    const marker = {
        type: type,
        name: document.getElementById('marker-create-name').value,
        description: document.getElementById('marker-create-desc').value,
        color: document.getElementById('marker-create-color').value,
        position: {
            x: parseFloat(document.getElementById('marker-create-pos-x').value) || 0,
            y: parseFloat(document.getElementById('marker-create-pos-y').value) || 0,
            z: parseFloat(document.getElementById('marker-create-pos-z').value) || 0
        },
        visibleTo: document.getElementById('marker-create-visible-all').checked ? ['all'] : [],
        routeId: null,
        routeOrder: null
    };
    if (type === 'route_point') {
        marker.routeId = document.getElementById('marker-create-route-id').value || null;
        marker.routeOrder = parseInt(document.getElementById('marker-create-route-order').value) || null;
    }
    socket.emit('add_marker', {
        token,
        lobby_id: currentLobbyId,
        marker
    });
    document.getElementById('marker-create-modal').style.display = 'none';
}

// ---------- Модальное окно редактирования ----------
function openMarkerEditModal(marker) {
    updateRouteDatalists();
    const idField = document.getElementById('marker-edit-id');
    const nameField = document.getElementById('marker-edit-name');
    const descField = document.getElementById('marker-edit-desc');
    const colorField = document.getElementById('marker-edit-color');
    const typeField = document.getElementById('marker-edit-type');
    const visibleAllField = document.getElementById('marker-edit-visible-all');
    const posXField = document.getElementById('marker-edit-pos-x');
    const posYField = document.getElementById('marker-edit-pos-y');
    const posZField = document.getElementById('marker-edit-pos-z');
    const routeIdField = document.getElementById('marker-edit-route-id');
    const routeOrderField = document.getElementById('marker-edit-route-order');

    if (!idField || !nameField || !descField || !colorField || !typeField || !visibleAllField || !posXField || !posYField || !posZField) {
        console.error('One or more marker edit fields not found in DOM');
        showNotification('Ошибка интерфейса: не найдены поля редактирования');
        return;
    }

    idField.value = marker.id;
    nameField.value = marker.name || '';
    descField.value = marker.description || '';
    colorField.value = marker.color || '#ffaa00';
    typeField.value = marker.type || 'default';
    visibleAllField.checked = marker.visibleTo && marker.visibleTo.includes('all');

    posXField.value = marker.position.x.toFixed(2);
    posYField.value = marker.position.y.toFixed(2);
    posZField.value = marker.position.z.toFixed(2);

    if (routeIdField) routeIdField.value = marker.routeId || '';
    if (routeOrderField) routeOrderField.value = marker.routeOrder !== undefined ? marker.routeOrder : '';

    // Настройка полей маршрута
    const typeSelect = document.getElementById('marker-edit-type');
    typeSelect.removeEventListener('change', () => toggleRouteFields('edit'));
    typeSelect.addEventListener('change', () => toggleRouteFields('edit'));
    toggleRouteFields('edit');

    document.getElementById('marker-edit-modal').style.display = 'flex';
}

export function closeMarkerEditModal() {
    document.getElementById('marker-edit-modal').style.display = 'none';
}

export function saveMarkerEdit() {
    const id = document.getElementById('marker-edit-id').value;
    if (!id) {
        showNotification('Ошибка: ID маркера не найден');
        return;
    }
    const type = document.getElementById('marker-edit-type').value;
    const updates = {
        name: document.getElementById('marker-edit-name').value,
        description: document.getElementById('marker-edit-desc').value,
        color: document.getElementById('marker-edit-color').value,
        type: type,
        visibleTo: document.getElementById('marker-edit-visible-all').checked ? ['all'] : [],
        position: {
            x: parseFloat(document.getElementById('marker-edit-pos-x').value) || 0,
            y: parseFloat(document.getElementById('marker-edit-pos-y').value) || 0,
            z: parseFloat(document.getElementById('marker-edit-pos-z').value) || 0
        },
        routeId: null,
        routeOrder: null
    };
    if (type === 'route_point') {
        updates.routeId = document.getElementById('marker-edit-route-id').value || null;
        updates.routeOrder = parseInt(document.getElementById('marker-edit-route-order').value) || null;
    }
    console.log('Sending update_marker', { id, updates });
    socket.emit('update_marker', {
        token,
        lobby_id: currentLobbyId,
        marker_id: id,
        updates
    });
    closeMarkerEditModal();
}

export function fillEditCenterCoordinates() {
    const centerX = mapWidthTiles / 2;
    const centerZ = mapHeightTiles / 2;
    import('./lobby3d.js').then(({ getTileHeightAt }) => {
        const height = getTileHeightAt(centerX, centerZ);
        const posY = (height + 0.8).toFixed(2);
        document.getElementById('marker-edit-pos-x').value = centerX.toFixed(2);
        document.getElementById('marker-edit-pos-y').value = posY;
        document.getElementById('marker-edit-pos-z').value = centerZ.toFixed(2);
    }).catch(() => {
        document.getElementById('marker-edit-pos-x').value = centerX.toFixed(2);
        document.getElementById('marker-edit-pos-y').value = '0.80';
        document.getElementById('marker-edit-pos-z').value = centerZ.toFixed(2);
    });
}

export function deleteMarker() {
    const id = document.getElementById('marker-edit-id').value;
    if (!id || !confirm('Удалить маркер?')) return;
    socket.emit('delete_marker', {
        token,
        lobby_id: currentLobbyId,
        marker_id: id
    });
    closeMarkerEditModal();
}

function updateRouteDatalists() {
    const routeIds = new Set();
    markers.forEach(entry => {
        if (entry.data.type === 'route_point' && entry.data.routeId) {
            routeIds.add(entry.data.routeId);
        }
    });

    // Обновляем datalist для создания
    const datalistCreate = document.getElementById('route-datalist-create');
    if (datalistCreate) {
        datalistCreate.innerHTML = '';
        routeIds.forEach(id => {
            const option = document.createElement('option');
            option.value = id;
            datalistCreate.appendChild(option);
        });
    }

    // Обновляем datalist для редактирования
    const datalistEdit = document.getElementById('route-datalist-edit');
    if (datalistEdit) {
        datalistEdit.innerHTML = '';
        routeIds.forEach(id => {
            const option = document.createElement('option');
            option.value = id;
            datalistEdit.appendChild(option);
        });
    }
}