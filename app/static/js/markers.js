// static/js/markers.js
import * as THREE from 'three';
import { scene, camera, renderer, controls, getHoveredTile } from './lobby3d.js';
import { showNotification } from './utils.js';
import {Server} from './api.js';
import AppState from './ui_interactions.js';

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
let markerRetryTimer = null;
let locationLoadVersion = 0;
let locationChangeVersion = 0;

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
        canvas.width = 512;
        canvas.height = 512;
        ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = 'bold 48px Arial';
        ctx.fillStyle = color || '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.imageSmoothingEnabled = true;
        const lines = wrapText(ctx, name || '?', canvas.width - 60);
        const lineHeight = 60;
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
    else if (type === 'location') scale = 2.2;
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

    const requestMarkerList = (attempt = 1) => {
        if (!socket.connected) return;
        if (markerRetryTimer) clearTimeout(markerRetryTimer);
        socket.emit('get_markers', { token, lobby_id: currentLobbyId });
        markerRetryTimer = setTimeout(() => {
            if (attempt < 3) requestMarkerList(attempt + 1);
            else showNotification('Не удалось получить маркеры карты. Проверьте соединение.', 'error');
        }, attempt * 10000);
    };

    socket.on('authenticated', () => {
        requestMarkerList();
        loadLocationsAsMarkers();
    });
    socket.on('disconnect', () => {
        if (markerRetryTimer) clearTimeout(markerRetryTimer);
        markerRetryTimer = null;
        locationLoadVersion += 1;
    });

    socket.on('markers_list', (markersData) => {
        if (!Array.isArray(markersData)) return;
        if (markerRetryTimer) clearTimeout(markerRetryTimer);
        markerRetryTimer = null;
        clearSocketMarkers();
        markersData.forEach(addMarkerToScene);
        updateRouteDatalists();

        const uniqueRouteIds = new Set();
        markers.forEach(entry => {
            if (entry.data.type === 'route_point' && entry.data.routeId) {
                uniqueRouteIds.add(entry.data.routeId);
            }
        });
        uniqueRouteIds.forEach(id => updateRouteLines(id));
    });

    socket.on('marker_added', (marker) => {
        if (canSeeMarkerForCurrentUser(marker)) {
            addMarkerToScene(marker);
        }
        updateRouteDatalists();
        if (marker.type === 'route_point' && marker.routeId) {
            updateRouteLines(marker.routeId);
        }
    });

    socket.on('marker_updated', (data) => {
        const markerId = data.id;
        const updates = data.updates;
        const markerData = data.marker || null;
        const entry = markers.get(markerId);
        if (!entry) {
            if (markerData && canSeeMarkerForCurrentUser(markerData)) {
                addMarkerToScene(markerData);
                if (markerData.type === 'route_point' && markerData.routeId) {
                    updateRouteLines(markerData.routeId);
                }
                updateRouteDatalists();
            }
            return;
        }
        const previousRouteId = entry.data.routeId;
        const mergedData = markerData ? { ...entry.data, ...markerData } : { ...entry.data, ...updates };
        Object.assign(entry.data, markerData || updates);

        if (!canSeeMarkerForCurrentUser(mergedData)) {
            removeMarkerFromScene(markerId);
        } else {
            if (updates.color || updates.type || updates.name || markerData?.color || markerData?.type || markerData?.name) {
                const newTexture = createMarkerTexture(entry.data.type, entry.data.color, entry.data.name);
                entry.sprite.material.map?.dispose();
                entry.sprite.material.map = newTexture;
                entry.sprite.material.needsUpdate = true;
            }
            if (updates.position || markerData?.position) {
                const position = markerData?.position || updates.position;
                entry.sprite.position.set(position.x, position.y + 0.8, position.z);
            }
        }
        if (previousRouteId && previousRouteId !== entry.data.routeId) updateRouteLines(previousRouteId);
        if (entry.data.routeId) updateRouteLines(entry.data.routeId);
        updateRouteDatalists();
    });

    socket.on('marker_moved', (data) => {
        moveMarkerInScene(data.id, data.position);
        const entry = markers.get(data.id);
        if (entry && entry.data.routeId) updateRouteLines(entry.data.routeId);
    });

    socket.on('marker_deleted', (data) => {
        const entry = markers.get(data.id);
        const routeId = entry?.data?.routeId;
        removeMarkerFromScene(data.id);
        if (routeId) updateRouteLines(routeId);
        updateRouteDatalists();
    });

    socket.on('location_created', data => {
        if (Number(data.lobby_id) !== Number(currentLobbyId)) return;
        locationChangeVersion += 1;
        upsertLocationMarker(data.location);
    });
    socket.on('location_updated', data => {
        if (Number(data.lobby_id) !== Number(currentLobbyId)) return;
        locationChangeVersion += 1;
        upsertLocationMarker(data.location);
    });
    socket.on('location_deleted', data => {
        if (Number(data.lobby_id) !== Number(currentLobbyId)) return;
        locationChangeVersion += 1;
        removeMarkerFromScene(`loc_${data.location_id}`);
    });

    async function loadLocationsAsMarkers(attempt = 1) {
        const version = ++locationLoadVersion;
        const changeVersion = locationChangeVersion;
        try {
            const locations = await Server.getLocations(currentLobbyId);
            if (version !== locationLoadVersion) return;
            if (changeVersion !== locationChangeVersion) {
                loadLocationsAsMarkers();
                return;
            }
            const currentIds = new Set(locations.map(location => `loc_${location.id}`));
            for (const id of markers.keys()) {
                if (String(id).startsWith('loc_') && !currentIds.has(id)) removeMarkerFromScene(id);
            }
            locations.forEach(upsertLocationMarker);
        } catch (err) {
            if (version !== locationLoadVersion) return;
            if (attempt < 3) {
                setTimeout(() => {
                    if (version === locationLoadVersion) loadLocationsAsMarkers(attempt + 1);
                }, attempt * 2000);
            } else {
                console.warn('Failed to load locations as markers', err);
                showNotification('Не удалось загрузить маркеры подлокаций. Проверьте соединение.', 'error');
            }
        }
    }
}

function addMarkerToScene(marker) {
    if (markers.has(marker.id)) {
        console.warn('Marker already exists:', marker.id);
        return;
    }
    const sprite = createMarkerSprite(marker);
    sprite.userData = { type: 'marker', markerId: marker.id, markerData: marker };
    scene.add(sprite);
    markers.set(marker.id, { sprite, data: marker });
}

function updateMarkerInScene(id, updates) {
    const entry = markers.get(id);
    if (!entry) return;
    Object.assign(entry.data, updates);
    if (updates.color || updates.type) {
        const newTexture = createMarkerTexture(entry.data.type, entry.data.color, entry.data.name);
        entry.sprite.material.map?.dispose();
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
    entry.sprite.material.map?.dispose();
    entry.sprite.material.dispose();
    markers.delete(id);
    if (hoveredMarkerId === id) {
        hoveredMarkerId = null;
        hideTooltip();
    }
}

function clearSocketMarkers() {
    for (const id of markers.keys()) {
        if (!String(id).startsWith('loc_')) removeMarkerFromScene(id);
    }
    routeLines.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
    });
    routeLines.clear();
}

function updateTooltipPosition(clientX, clientY) {
    if (!tooltipDiv) return;
    tooltipDiv.style.left = clientX + 15 + 'px';
    tooltipDiv.style.top = clientY - 40 + 'px';
}

function showTooltip(markerData, clientX, clientY) {
    if (!tooltipDiv) return;
    const title = document.createElement('b');
    title.textContent = markerData.name || 'Без названия';
    const description = document.createElement('span');
    description.textContent = markerData.description || '';
    tooltipDiv.replaceChildren(title, document.createElement('br'), description);
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
    const visibleTo = Array.isArray(marker.visibleTo)
        ? marker.visibleTo
        : (marker.visibleTo ? [marker.visibleTo] : []);
    return visibleTo.includes('all') || visibleTo.map(value => Number(value)).includes(userId);
}

function upsertLocationMarker(location) {
    if (!location || !Number.isInteger(Number(location.id))
        || !Number.isInteger(location.world_tile_x) || !Number.isInteger(location.world_tile_z)) return;
    const id = `loc_${location.id}`;
    const marker = {
        id,
        type: 'location',
        name: location.name,
        description: `Локация: ${location.name}`,
        color: '#44aaff',
        position: { x: location.world_tile_x + 0.5, y: 2.5, z: location.world_tile_z + 0.5 },
        visibleTo: ['all'],
        locationId: location.id,
        worldTileX: location.world_tile_x,
        worldTileZ: location.world_tile_z,
    };
    const existing = markers.get(id);
    if (!existing) {
        addMarkerToScene(marker);
        return;
    }
    Object.assign(existing.data, marker);
    existing.sprite.position.set(marker.position.x, marker.position.y + 0.8, marker.position.z);
    if (hoveredMarkerId === id) {
        hoveredMarkerId = null;
        hideTooltip();
    }
}

function updateRouteLines(routeId) {
    if (!routeId) return;

    // Удаляем старую линию
    if (routeLines.has(routeId)) {
        const previous = routeLines.get(routeId);
        scene.remove(previous);
        previous.geometry.dispose();
        previous.material.dispose();
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

    canvas.addEventListener('contextmenu', event => {
        if (!AppState.isGM || window.isLocationActive) return;
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObjects(Array.from(markers.values()).map(entry => entry.sprite))[0];
        const marker = hit && markers.get(hit.object.userData.markerId)?.data;
        if (!marker) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (marker.type === 'location') {
            openLocationMarkerEditModal(marker);
        } else {
            openMarkerEditModal(marker);
        }
    });

    canvas.addEventListener('mousemove', (event) => {
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

    canvas.addEventListener('click', (event) => {
        if (awaitingTilePick) {
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
            awaitingTilePick = false;
            tilePickCallback = null;
            return;
        }

        if (window.awaitingLocationPick) {
            event.preventDefault();
            event.stopPropagation();
            const hovered = getHoveredTile();
            if (!hovered) {
                showNotification('Не удалось определить тайл', 'error');
                return;
            }
            if (window.locationPickCallback) {
                window.locationPickCallback(hovered);
                window.locationPickCallback = null;
            }
            window.awaitingLocationPick = false;
            return;
        }

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const markerSprites = Array.from(markers.values()).map(e => e.sprite);
        const intersects = raycaster.intersectObjects(markerSprites);
        if (intersects.length > 0) {
            const markerId = intersects[0].object.userData.markerId;
            const markerEntry = markers.get(markerId);
            if (markerEntry && markerEntry.data.type === 'location') {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
        }
    });

    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        if (hoveredMarkerId === null) return;

        const markerId = hoveredMarkerId;
        const entry = markers.get(markerId);
        if (!entry) return;
        if (entry.data.type === 'location') return;

        const sprite = entry.sprite;
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
            if (entry) entry.sprite.position.copy(newPos);
        };

        const onPointerUp = (e) => {
            if (!dragState || e.pointerId !== dragState.pointerId) return;
            e.preventDefault();
            e.stopPropagation();

            const entry = markers.get(dragState.markerId);
            if (entry) {
                const newPos = entry.sprite.position.clone();
                socket.emit('move_marker', {
                    token,
                    lobby_id: currentLobbyId,
                    marker_id: dragState.markerId,
                    position: { x: newPos.x, y: newPos.y - 0.8, z: newPos.z }
                });
                if (entry.data.routeId) updateRouteLines(entry.data.routeId);
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
            if (markerData.type === 'location') {
                if (typeof window.enterLocation === 'function') {
                    window.enterLocation(markerData.locationId);
                } else {
                    showNotification('Функция входа в локацию не определена');
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
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

export function resetHoveredMarker() {
    if (hoveredMarkerId !== null) {
        hoveredMarkerId = null;
        hideTooltip();
    }
}
window.resetHoveredMarker = resetHoveredMarker;

function openLocationMarkerEditModal(marker) {
    if (!AppState.isGM || marker.type !== 'location') return;
    document.querySelector('.location-marker-edit-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal location-marker-edit-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 440px;">
            <h3>Маркер подлокации</h3>
            <div class="form-group"><label>Название</label><input data-location-name type="text" maxlength="100" class="form-control"></div>
            <div class="form-group"><label>Клетка X</label><input data-location-x type="number" min="0" step="1" class="form-control"></div>
            <div class="form-group"><label>Клетка Z</label><input data-location-z type="number" min="0" step="1" class="form-control"></div>
            <div class="form-actions">
                <button type="button" data-location-pick class="btn btn-secondary">Выбрать клетку на карте</button>
                <button type="button" data-location-save class="btn btn-primary">Сохранить</button>
                <button type="button" data-location-close class="btn btn-secondary">Отмена</button>
            </div>
            <div class="form-actions" style="margin-top: 16px;">
                <button type="button" data-location-delete class="btn btn-danger">Удалить подлокацию</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.style.display = 'flex';
    const nameField = modal.querySelector('[data-location-name]');
    const xField = modal.querySelector('[data-location-x]');
    const zField = modal.querySelector('[data-location-z]');
    const saveButton = modal.querySelector('[data-location-save]');
    nameField.value = marker.name || '';
    xField.value = marker.worldTileX ?? Math.floor(marker.position.x);
    zField.value = marker.worldTileZ ?? Math.floor(marker.position.z);
    if (mapWidthTiles) xField.max = String(mapWidthTiles - 1);
    if (mapHeightTiles) zField.max = String(mapHeightTiles - 1);

    let pickCallback = null;
    function close() {
        if (tilePickCallback === pickCallback && pickCallback) {
            awaitingTilePick = false;
            tilePickCallback = null;
        }
        document.removeEventListener('keydown', onKeyDown);
        modal.remove();
    }
    function onKeyDown(event) {
        if (event.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeyDown);
    modal.querySelector('[data-location-close]').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('[data-location-pick]').addEventListener('click', () => {
        modal.style.display = 'none';
        awaitingTilePick = true;
        pickCallback = (worldX, _height, worldZ) => {
            xField.value = Math.floor(worldX);
            zField.value = Math.floor(worldZ);
            modal.style.display = 'flex';
        };
        tilePickCallback = pickCallback;
        showNotification('Выберите новую клетку для маркера', 'system');
    });
    saveButton.addEventListener('click', async () => {
        const name = nameField.value.trim();
        const x = xField.valueAsNumber;
        const z = zField.valueAsNumber;
        if (!name || name.length > 100) {
            showNotification('Введите название длиной до 100 символов', 'error');
            return;
        }
        if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0
            || (mapWidthTiles && x >= mapWidthTiles) || (mapHeightTiles && z >= mapHeightTiles)) {
            showNotification('Выберите клетку в пределах мировой карты', 'error');
            return;
        }
        saveButton.disabled = true;
        try {
            const result = await Server.updateLocation(currentLobbyId, marker.locationId, {
                name, world_tile_x: x, world_tile_z: z,
            });
            upsertLocationMarker(result.location);
            showNotification('Маркер подлокации обновлён', 'success');
            close();
        } catch (error) {
            showNotification(error.message, 'error');
            saveButton.disabled = false;
        }
    });
    const deleteButton = modal.querySelector('[data-location-delete]');
    deleteButton.addEventListener('click', async () => {
        if (!window.confirm(`Безвозвратно удалить подлокацию «${marker.name}» вместе с картой, объектами и размещениями персонажей?`)) return;
        deleteButton.disabled = true;
        saveButton.disabled = true;
        try {
            await Server.deleteLocation(currentLobbyId, marker.locationId);
            removeMarkerFromScene(marker.id);
            showNotification('Подлокация удалена', 'success');
            close();
        } catch (error) {
            showNotification(error.message, 'error');
            deleteButton.disabled = false;
            saveButton.disabled = false;
        }
    });
    nameField.focus();
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
    const visibleTo = Array.isArray(marker.visibleTo)
        ? marker.visibleTo
        : (marker.visibleTo ? [marker.visibleTo] : []);
    visibleAllField.checked = visibleTo.includes('all');

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
