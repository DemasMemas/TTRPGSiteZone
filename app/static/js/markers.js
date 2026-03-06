// static/js/markers.js
import * as THREE from 'three';
import { scene, camera, renderer, controls } from './lobby3d.js';
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

function createMarkerTexture(type, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

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

    return new THREE.CanvasTexture(canvas);
}

function createMarkerSprite(marker) {
    const { type, color, position } = marker;
    const texture = createMarkerTexture(type, color);
    const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
        depthWrite: false,
        transparent: true
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 1.5, 1);
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
        console.log('Markers list received, count:', markersData.length);
        clearMarkers();
        markersData.forEach(m => addMarkerToScene(m));
    });

    socket.on('marker_added', (marker) => {
        console.log('Marker added:', marker);
        addMarkerToScene(marker);
    });

    socket.on('marker_updated', (data) => {
        console.log('Marker updated:', data);
        updateMarkerInScene(data.id, data.updates);
    });

    socket.on('marker_moved', (data) => {
        console.log('Marker moved:', data);
        moveMarkerInScene(data.id, data.position);
    });

    socket.on('marker_deleted', (data) => {
        console.log('Marker deleted:', data);
        removeMarkerFromScene(data.id);
    });

    socket.emit('get_markers', { token, lobby_id: currentLobbyId });

    socket.on('error', (data) => {
        showNotification('Ошибка маркера: ' + data.message, 'error');
    });

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
}

function updateMarkerInScene(id, updates) {
    const entry = markers.get(id);
    if (!entry) return;
    Object.assign(entry.data, updates);
    if (updates.color || updates.type) {
        const newTexture = createMarkerTexture(entry.data.type, entry.data.color);
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

    // Обработчик перетаскивания с capture, чтобы перехватывать событие до lobby3d
    canvas.addEventListener('mousedown', (event) => {
        console.log('mousedown on canvas');
        if (event.button !== 0) return;

        console.log('Marker mousedown');
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const markerSprites = Array.from(markers.values()).map(e => e.sprite);
        const intersects = raycaster.intersectObjects(markerSprites);

        if (intersects.length > 0) {
            const hit = intersects[0].object;
            const markerId = hit.userData.markerId;
            console.log('Starting drag for marker', markerId);

            event.preventDefault();
            event.stopPropagation();

            const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.position.y);
            const offset = hit.position.clone().sub(raycaster.ray.origin);

            dragState = {
                markerId,
                offset,
                plane,
                startPosition: hit.position.clone()
            };

            controls.enabled = false;
            canvas.style.cursor = 'grabbing';

            const onMouseMove = (e) => {
                if (!dragState) return;
                e.preventDefault();
                e.stopPropagation();

                const mouseCoords = new THREE.Vector2(
                    ((e.clientX - rect.left) / rect.width) * 2 - 1,
                    -((e.clientY - rect.top) / rect.height) * 2 + 1
                );
                raycaster.setFromCamera(mouseCoords, camera);
                const intersectionPoint = new THREE.Vector3();
                if (!raycaster.ray.intersectPlane(dragState.plane, intersectionPoint)) return;

                const newPos = intersectionPoint.clone().sub(dragState.offset);
                newPos.y = Math.max(0, newPos.y);

                const entry = markers.get(dragState.markerId);
                if (entry) {
                    entry.sprite.position.copy(newPos);
                }
            };

            const onMouseUp = () => {
                if (dragState) {
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
                    }
                    dragState = null;
                    controls.enabled = true;
                    canvas.style.cursor = 'default';
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                }
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
    }, { capture: true }); // capture, чтобы перехватить до lobby3d

    // Обработчик двойного клика с capture
    canvas.addEventListener('dblclick', (event) => {
        console.log('dblclick on canvas');
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
        }
    }, { capture: true });
}

export function openCreateMarkerModal(position = null) {
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
    const marker = {
        type: document.getElementById('marker-create-type').value,
        name: document.getElementById('marker-create-name').value,
        description: document.getElementById('marker-create-desc').value,
        color: document.getElementById('marker-create-color').value,
        position: {
            x: parseFloat(document.getElementById('marker-create-pos-x').value) || 0,
            y: parseFloat(document.getElementById('marker-create-pos-y').value) || 0,
            z: parseFloat(document.getElementById('marker-create-pos-z').value) || 0
        },
        visibleTo: document.getElementById('marker-create-visible-all').checked ? ['all'] : []
    };
    socket.emit('add_marker', {
        token,
        lobby_id: currentLobbyId,
        marker
    });
    document.getElementById('marker-create-modal').style.display = 'none';
}

function openMarkerEditModal(marker) {
    const idField = document.getElementById('marker-edit-id');
    const nameField = document.getElementById('marker-edit-name');
    const descField = document.getElementById('marker-edit-desc');
    const colorField = document.getElementById('marker-edit-color');
    const typeField = document.getElementById('marker-edit-type');
    const visibleAllField = document.getElementById('marker-edit-visible-all');
    const posXField = document.getElementById('marker-edit-pos-x');
    const posYField = document.getElementById('marker-edit-pos-y');
    const posZField = document.getElementById('marker-edit-pos-z');

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
    const updates = {
        name: document.getElementById('marker-edit-name').value,
        description: document.getElementById('marker-edit-desc').value,
        color: document.getElementById('marker-edit-color').value,
        type: document.getElementById('marker-edit-type').value,
        visibleTo: document.getElementById('marker-edit-visible-all').checked ? ['all'] : [],
        position: {
            x: parseFloat(document.getElementById('marker-edit-pos-x').value) || 0,
            y: parseFloat(document.getElementById('marker-edit-pos-y').value) || 0,
            z: parseFloat(document.getElementById('marker-edit-pos-z').value) || 0
        }
    };
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