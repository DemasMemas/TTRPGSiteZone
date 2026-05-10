import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let currentLocationId = null;
let characterSprites = new Map();
let animationId = null;
let currentLocationData = null;
let tileCubes = [];
let objectMeshes = [];
let groundPlaneMesh;

// Режимы редактирования
let editMode = false;
let brushRadius = 0;
let currentBrushTerrain = 'grass';
let currentBrushHeight = 1.0;
let eraserMode = false;

// Для raycast
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let hoveredTileCoords = null;
let highlightBox = null;

let locationActive = false;
let eventCleanup = null;

// Глобальный флаг для UI (чтобы хоткеи знали, что локация активна)
window.locationEditMode = false;

const terrainColors = {
    grass: 0x3a5f0b,
    sand: 0xC2B280,
    rock: 0x808080,
    swamp: 0x4B3B2A,
    water: 0x1E90FF
};

function createHighlight() {
    const geometry = new THREE.BoxGeometry(1, 0.1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 });
    highlightBox = new THREE.Mesh(geometry, material);
    scene.add(highlightBox);
    highlightBox.visible = false;
}

function updateHighlight(x, z, height) {
    if (!highlightBox) createHighlight();
    const size = 1 + brushRadius * 2;
    highlightBox.scale.set(size, 0.1, size);
    highlightBox.position.set(x + 0.5, height + 0.1, z + 0.5);
    highlightBox.visible = true;
}

function hideHighlight() {
    if (highlightBox) highlightBox.visible = false;
}

// Обновление объектов на тайле
function rebuildTileObjects(tileX, tileZ) {
    if (!currentLocationData) return;
    const tile = currentLocationData.tiles_data[tileZ][tileX];
    const tileHeight = tile.height || 1.0;
    const worldX = tileX + 0.5;
    const worldZ = tileZ + 0.5;

    // Удаляем старые объекты на этом тайле
    const toRemove = [];
    for (let i = 0; i < objectMeshes.length; i++) {
        const mesh = objectMeshes[i];
        if (mesh.userData && mesh.userData.tileX === tileX && mesh.userData.tileZ === tileZ) {
            scene.remove(mesh);
            toRemove.push(mesh);
        }
    }
    objectMeshes = objectMeshes.filter(m => !toRemove.includes(m));

    const objects = tile.objects || [];
    for (const obj of objects) {
        let geometry, material, yOffset;
        switch (obj.type) {
            case 'tree':
                geometry = new THREE.CylinderGeometry(0.3, 0.5, 0.8, 6);
                material = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
                yOffset = 0.4;
                break;
            case 'rock':
                geometry = new THREE.DodecahedronGeometry(0.3);
                material = new THREE.MeshStandardMaterial({ color: 0x888888 });
                yOffset = 0.15;
                break;
            case 'house':
                geometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
                material = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
                yOffset = 0.35;
                break;
            case 'tent':
                geometry = new THREE.CylinderGeometry(0.5, 0.7, 0.5, 4);
                material = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
                yOffset = 0.25;
                break;
            case 'campfire':
                geometry = new THREE.CylinderGeometry(0.2, 0.3, 0.1, 6);
                material = new THREE.MeshStandardMaterial({ color: 0xff6600 });
                yOffset = 0.05;
                break;
            default:
                geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                material = new THREE.MeshStandardMaterial({ color: 0xffaa44 });
                yOffset = 0.25;
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { tileX, tileZ, objType: obj.type };
        mesh.position.set(worldX, tileHeight + yOffset, worldZ);
        scene.add(mesh);
        objectMeshes.push(mesh);
    }
}

// Инициализация сцены
export function initLocationScene(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (animationId) cancelAnimationFrame(animationId);
    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer = null;
    }
    if (scene) {
        if (highlightBox && highlightBox.parent) scene.remove(highlightBox);
        scene = null;
    }
    camera = null;
    controls = null;
    characterSprites.clear();
    tileCubes = [];
    objectMeshes = [];

    while (container.firstChild) container.removeChild(container.firstChild);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);

    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(50, 60, 50);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0, 0);
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    window.locationControls = controls;

    const ambientLight = new THREE.AmbientLight(0x404060);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const fillLight = new THREE.PointLight(0x4466cc, 0.3);
    fillLight.position.set(0, 5, 0);
    scene.add(fillLight);

    function animate() {
        animationId = requestAnimationFrame(animate);
        if (controls) controls.update();
        if (renderer && scene && camera) renderer.render(scene, camera);
    }
    animate();

    let locInfo = document.getElementById('location-tile-info');
    if (!locInfo) {
        locInfo = document.createElement('div');
        locInfo.id = 'location-tile-info';
        locInfo.style.cssText = `
            position: absolute;
            bottom: 100px;
            right: 20px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 10px;
            border-radius: 8px;
            display: none;
            pointer-events: none;
            z-index: 15;
        `;
        document.body.appendChild(locInfo);
    }
}

// Загрузка данных локации
export function loadLocation(data) {
    console.log('loadLocation', data);
    tileCubes = [];
    objectMeshes = [];
    currentLocationData = data;
    if (!scene) return;

    const toRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight) toRemove.push(child);
    });
    toRemove.forEach(child => scene.remove(child));
    characterSprites.clear();

    const gridWidth = data.grid_width;
    const gridHeight = data.grid_height;
    const centerX = gridWidth / 2;
    const centerZ = gridHeight / 2;

    const gridHelper = new THREE.GridHelper(gridWidth, gridHeight, 0x888888, 0x444444);
    gridHelper.position.set(centerX, -0.1, centerZ);
    scene.add(gridHelper);

    const planeMat = new THREE.MeshStandardMaterial({ color: 0x3a6b3a, side: THREE.DoubleSide, transparent: true, opacity: 0.2 });
    const planeGeo = new THREE.PlaneGeometry(gridWidth, gridHeight);
    const groundPlane = new THREE.Mesh(planeGeo, planeMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.set(centerX, -0.05, centerZ);
    scene.add(groundPlane);
    groundPlaneMesh = groundPlane;

    // Тайлы
    for (let y = 0; y < data.tiles_data.length; y++) {
        const row = data.tiles_data[y];
        for (let x = 0; x < row.length; x++) {
            const tile = row[x];
            const color = terrainColors[tile.terrain] || 0x3a5f0b;
            const height = tile.height || 1.0;
            const geometry = new THREE.BoxGeometry(0.98, height, 0.98);
            const material = new THREE.MeshStandardMaterial({ color });
            const cube = new THREE.Mesh(geometry, material);
            cube.castShadow = false;
            cube.receiveShadow = false;
            cube.userData = { tileX: x, tileZ: y, tileData: tile };
            cube.position.set(x + 0.5, height / 2, y + 0.5);
            tileCubes.push(cube);
            scene.add(cube);
        }
    }

    // Объекты на тайлах
    for (let y = 0; y < data.tiles_data.length; y++) {
        for (let x = 0; x < data.tiles_data[y].length; x++) {
            rebuildTileObjects(x, y);
        }
    }

    // Отдельные объекты
    if (data.objects && data.objects.length) {
        data.objects.forEach(obj => {
            const boxGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
            const mesh = new THREE.Mesh(boxGeo, mat);
            mesh.position.set(obj.tile_x + 0.5, 0.4, obj.tile_y + 0.5);
            scene.add(mesh);
        });
    }

    const distance = Math.max(gridWidth, gridHeight) * 0.8;
    camera.position.set(centerX, distance * 0.6, centerZ + distance);
    controls.target.set(centerX, 0, centerZ);
    controls.update();

    setupLocationEditing();
}

// Уничтожение сцены
export function destroyLocationScene() {
    locationActive = false;
    if (eventCleanup) {
        eventCleanup();
        eventCleanup = null;
    }
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer = null;
    }
    if (scene) {
        tileCubes.forEach(cube => {
            if (cube && cube.parent) scene.remove(cube);
        });
        objectMeshes.forEach(mesh => {
            if (mesh && mesh.parent) scene.remove(mesh);
        });
        scene = null;
    }
    tileCubes = [];
    objectMeshes = [];
    const locInfo = document.getElementById('location-tile-info');
    if (locInfo) locInfo.style.display = 'none';
    camera = null;
    controls = null;
    characterSprites.clear();
    currentLocationData = null;
    hoveredTileCoords = null;
    if (highlightBox && highlightBox.parent) scene?.remove(highlightBox);
    highlightBox = null;
}

// Настройка обработчиков кисти
export function setupLocationEditing() {
    if (!renderer) return;
    const canvas = renderer.domElement;
    const locInfo = document.getElementById('location-tile-info');

    locationActive = true;

    const onPointerMove = (e) => {
        if (!locationActive) return;
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(tileCubes);
        if (intersects.length > 0) {
            const cube = intersects[0].object;
            const x = cube.userData.tileX;
            const z = cube.userData.tileZ;
            const tile = currentLocationData.tiles_data[z][x];
            locInfo.innerHTML = `
                <b>Тайл (${x}, ${z})</b><br>
                Ландшафт: ${tile.terrain}<br>
                Высота: ${tile.height}<br>
                Название: ${tile.name || '—'}<br>
                Объектов: ${tile.objects ? tile.objects.length : 0}
            `;
            locInfo.style.display = 'block';
            updateHighlight(x, z, tile.height || 1.0);
            hoveredTileCoords = { x, z };
        } else {
            locInfo.style.display = 'none';
            hideHighlight();
            hoveredTileCoords = null;
        }
    };

    const onPointerDown = (e) => {
        if (!locationActive) return;
        if (e.button !== 0) return;
        if (!hoveredTileCoords) return;
        if (!window.locationEditMode) return;
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        const { x, z } = hoveredTileCoords;
        const updates = {};
        if (eraserMode) {
            updates.objects = [];
        } else {
            if (e.altKey) updates.terrain = currentBrushTerrain;
            if (e.shiftKey) updates.height = currentBrushHeight;
        }
        if (Object.keys(updates).length) {
            applyLocationBrush(x, z, updates, brushRadius);
        }
    };

    const onPointerUp = (e) => {
        if (!locationActive) return;
        canvas.releasePointerCapture(e.pointerId);
    };

    window.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);

    eventCleanup = () => {
        window.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        locationActive = false;
    };
    window._locationEventCleanup = eventCleanup;
}

// Применение кисти
export function applyLocationBrush(centerX, centerZ, updates, radius) {
    if (!currentLocationData) return;
    const tiles = currentLocationData.tiles_data;
    const changed = [];

    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const x = centerX + dx;
            const z = centerZ + dz;
            if (x < 0 || x >= currentLocationData.grid_width || z < 0 || z >= currentLocationData.grid_height) continue;
            const tile = tiles[z][x];
            let needUpdate = false;

            if (updates.terrain !== undefined && tile.terrain !== updates.terrain) {
                tile.terrain = updates.terrain;
                needUpdate = true;
            }
            if (updates.height !== undefined && tile.height !== updates.height) {
                tile.height = Math.min(3.0, Math.max(0.5, updates.height));
                needUpdate = true;
            }
            if (updates.objects !== undefined) {
                tile.objects = [...updates.objects];
                needUpdate = true;
            }

            if (needUpdate) {
                const oldIndex = tileCubes.findIndex(cube => cube.userData.tileX === x && cube.userData.tileZ === z);
                if (oldIndex !== -1) {
                    scene.remove(tileCubes[oldIndex]);
                    tileCubes.splice(oldIndex, 1);
                }
                const color = terrainColors[tile.terrain] || 0x3a5f0b;
                const geometry = new THREE.BoxGeometry(0.98, tile.height, 0.98);
                const material = new THREE.MeshStandardMaterial({ color });
                const cube = new THREE.Mesh(geometry, material);
                cube.castShadow = false;
                cube.receiveShadow = false;
                cube.userData = { tileX: x, tileZ: z, tileData: tile };
                cube.position.set(x + 0.5, tile.height / 2, z + 0.5);
                tileCubes.push(cube);
                scene.add(cube);
                if (updates.height !== undefined || updates.objects !== undefined) {
                    rebuildTileObjects(x, z);
                }
                changed.push({ x, z, terrain: tile.terrain, height: tile.height, objects: tile.objects });
            }
        }
    }

    if (changed.length === 0) return;
    if (window.socket && window.currentLocationId) {
        window.socket.emit('update_location_tiles', {
            token: localStorage.getItem('access_token'),
            location_id: window.currentLocationId,
            updates: changed
        });
    }
}

// Получение обновлений от сервера
export function applyLocationTilesUpdate(locationId, updates) {
    if (!highlightBox || !highlightBox.parent) createHighlight();
    if (getCurrentLocationId() !== locationId) return;
    if (!currentLocationData) return;
    let savedHovered = hoveredTileCoords ? { x: hoveredTileCoords.x, z: hoveredTileCoords.z } : null;
    for (const upd of updates) {
        const tile = currentLocationData.tiles_data[upd.z][upd.x];
        if (upd.terrain !== undefined) tile.terrain = upd.terrain;
        if (upd.height !== undefined) tile.height = upd.height;
        if (upd.objects !== undefined) tile.objects = upd.objects;
        const oldIndex = tileCubes.findIndex(cube => cube.userData.tileX === upd.x && cube.userData.tileZ === upd.z);
        if (oldIndex !== -1) {
            scene.remove(tileCubes[oldIndex]);
            tileCubes.splice(oldIndex, 1);
        }
        const color = terrainColors[tile.terrain] || 0x3a5f0b;
        const geometry = new THREE.BoxGeometry(0.98, tile.height, 0.98);
        const material = new THREE.MeshStandardMaterial({ color });
        const cube = new THREE.Mesh(geometry, material);
        cube.castShadow = false;
        cube.receiveShadow = false;
        cube.userData = { tileX: upd.x, tileZ: upd.z, tileData: tile };
        cube.position.set(upd.x + 0.5, tile.height / 2, upd.z + 0.5);
        tileCubes.push(cube);
        scene.add(cube);
        rebuildTileObjects(upd.x, upd.z);
    }
    if (savedHovered) {
        hoveredTileCoords = savedHovered;
        const tile = currentLocationData.tiles_data[savedHovered.z]?.[savedHovered.x];
        if (tile) updateHighlight(savedHovered.x, savedHovered.z, tile.height);
    }
    if (highlightBox) highlightBox.visible = true;
}

// Управляющие функции для UI
export function setLocationEditMode(enabled) {
    editMode = enabled;
    window.locationEditMode = enabled;
    if (!enabled) hideHighlight();

    if (hoveredTileCoords && currentLocationData) {
        const { x, z } = hoveredTileCoords;
        const tile = currentLocationData.tiles_data[z]?.[x];
        if (tile) updateHighlight(x, z, tile.height);
    }

    const btn = document.getElementById('edit-toggle');
    if (btn) btn.style.background = enabled ? '#4a6fa5' : '';
    // Синхронизация чекбокса в панели локации
    const locCheckbox = document.getElementById('loc-edit-toggle-checkbox');
    if (locCheckbox) locCheckbox.checked = enabled;
}
export function getLocationEditMode() { return editMode; }
export function setLocationBrushRadius(r) {
    brushRadius = r;
    const radiusSlider = document.getElementById('brush-radius');
    const radiusSpan = document.getElementById('brush-radius-value');
    if (radiusSlider) radiusSlider.value = r;
    if (radiusSpan) radiusSpan.textContent = r;
    const locRadiusSlider = document.getElementById('loc-edit-radius');
    const locRadiusSpan = document.getElementById('loc-radius-value');
    if (locRadiusSlider) locRadiusSlider.value = r;
    if (locRadiusSpan) locRadiusSpan.textContent = r;
    if (hoveredTileCoords && currentLocationData) {
        const { x, z } = hoveredTileCoords;
        const tile = currentLocationData.tiles_data[z][x];
        updateHighlight(x, z, tile.height);
    }
}
export function setLocationBrushTerrain(t) {
    currentBrushTerrain = t;
    const select = document.getElementById('tile-type-select');
    if (select) select.value = t;
    const locSelect = document.getElementById('loc-edit-terrain');
    if (locSelect) locSelect.value = t;
}
export function setLocationBrushHeight(h) {
    currentBrushHeight = h;
    const heightSlider = document.getElementById('tile-height');
    const heightSpan = document.getElementById('tile-height-value');
    if (heightSlider) heightSlider.value = h;
    if (heightSpan) heightSpan.textContent = h.toFixed(1);
    const locHeightSlider = document.getElementById('loc-edit-height');
    const locHeightSpan = document.getElementById('loc-height-value');
    if (locHeightSlider) locHeightSlider.value = h;
    if (locHeightSpan) locHeightSpan.textContent = h.toFixed(1);
}
export function setLocationEraserMode(e) {
    eraserMode = e;
    const eraserCheck = document.getElementById('eraser-checkbox');
    if (eraserCheck) eraserCheck.checked = e;
    const locEraserCheck = document.getElementById('loc-eraser');
    if (locEraserCheck) locEraserCheck.checked = e;
}

// Остальные экспорты (кнопки, персонажи) – без изменений
export function addDeleteLocationButton(callback) {
    let btn = document.getElementById('delete-location-btn');
    if (btn) btn.remove();
    btn = document.createElement('button');
    btn.id = 'delete-location-btn';
    btn.textContent = '🗑️';
    btn.style.position = 'absolute';
    btn.style.top = '20px';
    btn.style.right = '165px';
    btn.style.zIndex = '20';
    btn.style.background = '#dc3545';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.padding = '8px 12px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '18px';
    btn.style.lineHeight = '1';
    btn.style.display = 'block';
    btn.title = 'Удалить локацию';
    btn.onclick = callback;
    document.getElementById('location-container').appendChild(btn);
    return btn;
}

export function setDeleteButtonVisible(visible) {
    const btn = document.getElementById('delete-location-btn');
    if (btn) btn.style.display = visible ? 'block' : 'none';
}

export function addEditLocationButton(callback) {
    let btn = document.getElementById('edit-location-btn');
    if (btn) btn.remove();
    btn = document.createElement('button');
    btn.id = 'edit-location-btn';
    btn.textContent = '✏️';
    btn.style.position = 'absolute';
    btn.style.top = '20px';
    btn.style.right = '218px';
    btn.style.zIndex = '20';
    btn.style.background = '#4a6fa5';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.padding = '8px 12px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '18px';
    btn.style.lineHeight = '1';
    btn.style.display = 'block';
    btn.title = 'Редактировать локацию';
    btn.onclick = callback;
    document.getElementById('location-container').appendChild(btn);
    return btn;
}

export function setEditButtonVisible(visible) {
    const btn = document.getElementById('edit-location-btn');
    if (btn) btn.style.display = visible ? 'block' : 'none';
}

export function updateCharacterPosition(characterId, x, y) {
    if (!scene) return;
    const entry = characterSprites.get(characterId);
    if (entry) {
        entry.sprite.position.set(x + 0.5, 0.5, y + 0.5);
        entry.x = x;
        entry.y = y;
    } else {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffaa44';
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.font = 'bold 24px Arial';
        ctx.fillText('🧙', 20, 45);
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(0.8, 0.8, 1);
        sprite.position.set(x + 0.5, 0.5, y + 0.5);
        scene.add(sprite);
        characterSprites.set(characterId, { sprite, x, y });
    }
}

export function setCurrentLocationId(id) {
    currentLocationId = id;
}
export function getCurrentLocationId() {
    return currentLocationId;
}
export function resizeLocationScene() {
    if (renderer && camera) {
        const container = document.getElementById('location-canvas');
        if (container) {
            const width = container.clientWidth;
            const height = container.clientHeight;
            renderer.setSize(width, height);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
    }
}

export function getHoveredTileCoords() {
    return hoveredTileCoords;
}

export function updateHighlightByCoords(x, z) {
    if (!currentLocationData) return;
    const tile = currentLocationData.tiles_data[z]?.[x];
    if (tile) updateHighlight(x, z, tile.height);
}

window.addEventListener('resize', resizeLocationScene);