// static/js/locationScene.js
import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'https://unpkg.com/three@0.128.0/examples/jsm/renderers/CSS2DRenderer.js';
import { showNotification } from './utils.js';

let scene, camera, renderer, labelRenderer, controls;
let currentLocationId = null;
let currentLocationData = null;
let tileCubes = [];
let objectMeshes = [];
let groundPlaneMesh;
let characterModels = new Map(); // characterId -> { model, label, data }

// Переменные для перетаскивания персонажа
let dragCharacter = null;       // { characterId, model, offsetX, offsetZ, startX, startZ }
let isDraggingCharacter = false;
let hoveredCharacterId = null;

// Режимы редактирования
let editMode = false;
let brushRadius = 0;
let currentBrushTerrain = 'grass';
let currentBrushHeight = 1.0;
let eraserMode = false;
let brushRadiation = 0.0;
let brushObjectMode = false;
let brushObjectType = 'tree';
let brushObjectColor = '#2d5a27';
let brushObjectOffsetX = 0.0;
let brushObjectOffsetZ = 0.0;
let brushObjectScale = 1.0;
let brushObjectRotation = 0;

// Для raycast
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let hoveredTileCoords = null;
let highlightBox = null;

let locationActive = false;
let eventCleanup = null;
let processedTilesForObjects = new Set();
let lastHighlightCoords = null;

// Глобальный флаг для UI
window.locationEditMode = false;

const terrainColors = {
    grass: 0x3a5f0b,
    sand: 0xC2B280,
    rock: 0x808080,
    swamp: 0x4B3B2A,
    water: 0x1E90FF
};

// ========== Вспомогательные функции ==========
function getTileHeight(tileX, tileZ) {
    if (!currentLocationData) return 1.0;
    if (tileZ < 0 || tileZ >= currentLocationData.tiles_data.length) return 1.0;
    const row = currentLocationData.tiles_data[tileZ];
    if (tileX < 0 || tileX >= row.length) return 1.0;
    return row[tileX].height || 1.0;
}

// ========== Создание 3D модели персонажа ==========
function createCharacterModel(ownerId) {
    const group = new THREE.Group();

    // Тело (капсула) – цилиндр + полусферы
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.7, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x44aaff });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.35;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Голова (сфера)
    const headGeo = new THREE.SphereGeometry(0.15, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffddbb });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.8;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    // Цвет в зависимости от ownerId
    const hue = (ownerId * 137.508) % 1.0;
    const color = new THREE.Color().setHSL(hue, 0.8, 0.5);
    bodyMat.color.copy(color);

    // Добавляем выделение при наведении (будет меняться позже)
    group.userData.isCharacter = true;

    return group;
}

// ========== Добавление персонажа в сцену ==========
export function addCharacterToLocation(characterId, name, ownerId, ownerName, posX, posY, hpZones, effects) {
    // Удаляем старого, если есть
    if (characterModels.has(characterId)) {
        const old = characterModels.get(characterId);
        scene.remove(old.model);
        if (old.label) scene.remove(old.label);
        characterModels.delete(characterId);
    }

    // Создаём модель
    const model = createCharacterModel(ownerId);
    const tileHeight = getTileHeight(posX, posY);
    model.position.set(posX + 0.5, tileHeight, posY + 0.5);
    model.userData.characterId = characterId;
    model.userData.ownerId = ownerId;
    scene.add(model);

    // Создаём CSS2D-метку с именем
    const div = document.createElement('div');
    div.textContent = name;
    div.style.color = 'white';
    div.style.fontSize = '14px';
    div.style.fontWeight = 'bold';
    div.style.textShadow = '1px 1px 3px black';
    div.style.backgroundColor = 'rgba(0,0,0,0.6)';
    div.style.padding = '2px 8px';
    div.style.borderRadius = '10px';
    div.style.pointerEvents = 'none';
    const label = new CSS2DObject(div);
    label.position.set(posX + 0.5, tileHeight + 1.2, posY + 0.5);
    scene.add(label);

    // Сохраняем данные
    characterModels.set(characterId, {
        model,
        label,
        name,
        ownerId,
        ownerName,
        hpZones,
        effects,
        posX,
        posY
    });
}

// ========== Обновление позиции персонажа ==========
export function updateCharacterPosition(characterId, posX, posY) {
    const entry = characterModels.get(characterId);
    if (!entry) return;
    const tileHeight = getTileHeight(posX, posY);
    entry.model.position.set(posX + 0.5, tileHeight, posY + 0.5);
    entry.label.position.set(posX + 0.5, tileHeight + 1.2, posY + 0.5);
    entry.posX = posX;
    entry.posY = posY;
}

// ========== Удаление всех персонажей ==========
function clearAllCharacters() {
    characterModels.forEach((entry) => {
        scene.remove(entry.model);
        if (entry.label) scene.remove(entry.label);
    });
    characterModels.clear();
}

// ========== Инициализация сцены ==========
export function initLocationScene(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Очистка предыдущей сцены
    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer = null;
    }
    if (labelRenderer) {
        if (labelRenderer.domElement && labelRenderer.domElement.parentNode) {
            labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement);
        }
        labelRenderer = null;
    }
    if (scene) {
        scene = null;
    }
    camera = null;
    controls = null;
    tileCubes = [];
    objectMeshes = [];
    clearAllCharacters();
    dragCharacter = null;
    isDraggingCharacter = false;
    hoveredCharacterId = null;

    while (container.firstChild) container.removeChild(container.firstChild);

    // Создаём WebGL рендерер
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Создаём CSS2D рендерер для меток
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none'; // чтобы клики проходили сквозь метки
    container.appendChild(labelRenderer.domElement);

    // Сцена
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);

    // Камера
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(50, 60, 50);

    // Управление
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0, 0);
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    window.locationControls = controls;

    // Освещение
    const ambientLight = new THREE.AmbientLight(0x404060);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const fillLight = new THREE.PointLight(0x4466cc, 0.3);
    fillLight.position.set(0, 5, 0);
    scene.add(fillLight);

    // Highlight box (для редактирования)
    createHighlight();

    // Анимация
    function animate() {
        requestAnimationFrame(animate);
        if (controls) controls.update();
        if (renderer && scene && camera) renderer.render(scene, camera);
        if (labelRenderer) labelRenderer.render(scene, camera);
    }
    animate();

    // Инфо-панель
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

    // Настройка обработчиков редактирования, drag&drop спавна и перетаскивания персонажей
    setupLocationEditing();
    setupCharacterDragging();
}

// ========== Highlight ==========
function createHighlight() {
    if (highlightBox) return;
    const geometry = new THREE.BoxGeometry(1, 0.1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 });
    highlightBox = new THREE.Mesh(geometry, material);
    highlightBox.visible = false;
    scene.add(highlightBox);
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

// ========== Загрузка данных локации ==========
export function loadLocation(data) {
    console.log('loadLocation', data);
    tileCubes = [];
    objectMeshes = [];
    currentLocationData = data;
    if (!scene) return;

    // Очищаем сцену от старых объектов (кроме света и highlight)
    const toRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight && child !== highlightBox) toRemove.push(child);
    });
    toRemove.forEach(child => scene.remove(child));

    clearAllCharacters();

    const gridWidth = data.grid_width;
    const gridHeight = data.grid_height;
    const centerX = gridWidth / 2;
    const centerZ = gridHeight / 2;

    // Сетка
    const gridHelper = new THREE.GridHelper(gridWidth, gridHeight, 0x888888, 0x444444);
    gridHelper.position.set(centerX, -0.1, centerZ);
    scene.add(gridHelper);

    // Пол
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

    // Отдельные объекты (если есть)
    if (data.objects && data.objects.length) {
        data.objects.forEach(obj => {
            const boxGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
            const mesh = new THREE.Mesh(boxGeo, mat);
            mesh.position.set(obj.tile_x + 0.5, 0.4, obj.tile_y + 0.5);
            scene.add(mesh);
        });
    }

    // Настройка камеры
    const distance = Math.max(gridWidth, gridHeight) * 0.8;
    camera.position.set(centerX, distance * 0.6, centerZ + distance);
    controls.target.set(centerX, 0, centerZ);
    controls.update();

    // Добавляем highlight обратно в сцену (если он был удалён)
    if (highlightBox && !scene.children.includes(highlightBox)) scene.add(highlightBox);
}

// ========== Обновление тайла ==========
function updateTileCube(x, z, tile) {
    const cube = tileCubes.find(c => c.userData.tileX === x && c.userData.tileZ === z);
    if (!cube) return;
    const newHeight = tile.height || 1.0;
    const newColor = terrainColors[tile.terrain] || 0x3a5f0b;
    const newGeo = new THREE.BoxGeometry(0.98, newHeight, 0.98);
    cube.geometry.dispose();
    cube.geometry = newGeo;
    cube.material.color.setHex(newColor);
    cube.position.y = newHeight / 2;
    cube.userData.tileData = tile;
}

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

// ========== Применение обновлений тайлов (из сокета) ==========
export function applyLocationTilesUpdate(locationId, updates) {
    if (getCurrentLocationId() !== locationId) return;
    if (!currentLocationData) return;
    for (const upd of updates) {
        const tile = currentLocationData.tiles_data[upd.z][upd.x];
        if (upd.terrain !== undefined) tile.terrain = upd.terrain;
        if (upd.height !== undefined) tile.height = upd.height;
        if (upd.objects !== undefined) tile.objects = upd.objects;
        if (upd.radiation !== undefined) tile.radiation = upd.radiation;
        updateTileCube(upd.x, upd.z, tile);
        rebuildTileObjects(upd.x, upd.z);
    }
    // Обновляем позиции персонажей, если изменилась высота тайлов
    characterModels.forEach((entry) => {
        const height = getTileHeight(entry.posX, entry.posY);
        entry.model.position.y = height;
        entry.label.position.y = height + 1.2;
    });
}

// ========== Редактирование (кисть) ==========
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
            if (updates.radiation !== undefined && tile.radiation !== updates.radiation) {
                tile.radiation = Math.min(10, Math.max(0, updates.radiation));
                needUpdate = true;
            }
            if (updates.addObject && brushObjectMode) {
                const key = `${x},${z}`;
                if (!processedTilesForObjects.has(key)) {
                    processedTilesForObjects.add(key);
                    if (!tile.objects) tile.objects = [];
                    const newObj = {
                        type: brushObjectType,
                        x: brushObjectOffsetX,
                        z: brushObjectOffsetZ,
                        scale: brushObjectScale,
                        rotation: brushObjectRotation,
                        color: brushObjectColor
                    };
                    if (brushObjectType.startsWith('anomaly_')) {
                        newObj.type = 'anomaly';
                        newObj.anomalyType = brushObjectType.replace('anomaly_', '');
                    }
                    tile.objects.push(newObj);
                    needUpdate = true;
                }
            }
            if (updates.objects !== undefined && updates.objects.length === 0 && !brushObjectMode) {
                tile.objects = [];
                needUpdate = true;
            }

            if (needUpdate) {
                updateTileCube(x, z, tile);
                if (updates.objects !== undefined || updates.addObject) {
                    rebuildTileObjects(x, z);
                }
                changed.push({ x, z, terrain: tile.terrain, height: tile.height, objects: tile.objects, radiation: tile.radiation });
            }
        }
    }

    if (changed.length === 0) return;
    if (window.socket && window.currentLocationId) {
        window.socket.emit('update_location_tiles', {
            token: localStorage.getItem('access_token'),
            location_id: window.currentLocationId,
            updates: changed.map(c => ({ x: c.x, z: c.z, terrain: c.terrain, height: c.height, objects: c.objects, radiation: c.radiation }))
        });
    }
    // Обновляем позиции персонажей после изменения высоты
    characterModels.forEach((entry) => {
        const height = getTileHeight(entry.posX, entry.posY);
        entry.model.position.y = height;
        entry.label.position.y = height + 1.2;
    });
}

// ========== Настройка обработчиков для перетаскивания персонажей (3D) ==========
function setupCharacterDragging() {
    if (!renderer) return;
    const canvas = renderer.domElement;

    // Находим персонажа под курсором
    function getCharacterAtScreen(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        // Получаем все модели персонажей
        const models = [];
        characterModels.forEach((entry, id) => {
            models.push(entry.model);
        });
        const intersects = raycaster.intersectObjects(models, true); // true для дочерних объектов
        if (intersects.length > 0) {
            // Ищем родителя с userData.isCharacter
            let obj = intersects[0].object;
            while (obj) {
                if (obj.userData && obj.userData.isCharacter) {
                    return obj;
                }
                obj = obj.parent;
            }
            // Если не нашли, пробуем взять ближайший объект
            return intersects[0].object;
        }
        return null;
    }

    // Обработчик наведения (подсветка)
    canvas.addEventListener('mousemove', (e) => {
        if (isDraggingCharacter) return;
        const obj = getCharacterAtScreen(e.clientX, e.clientY);
        if (obj) {
            const charId = obj.userData.characterId;
            if (charId && hoveredCharacterId !== charId) {
                hoveredCharacterId = charId;
                canvas.style.cursor = 'grab';
                // Можно добавить подсветку, например увеличить яркость
                const entry = characterModels.get(charId);
                if (entry) {
                    entry.model.children.forEach(child => {
                        if (child.isMesh) {
                            child.material.emissive = new THREE.Color(0x444466);
                            child.material.emissiveIntensity = 0.3;
                        }
                    });
                }
            }
        } else {
            if (hoveredCharacterId !== null) {
                // Убираем подсветку
                const entry = characterModels.get(hoveredCharacterId);
                if (entry) {
                    entry.model.children.forEach(child => {
                        if (child.isMesh) {
                            child.material.emissive = new THREE.Color(0x000000);
                            child.material.emissiveIntensity = 0;
                        }
                    });
                }
                hoveredCharacterId = null;
                canvas.style.cursor = 'default';
            }
        }
    });

    // Начало перетаскивания
    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (window.locationEditMode) return; // не мешаем редактированию
        if (isDraggingCharacter) return;

        const obj = getCharacterAtScreen(e.clientX, e.clientY);
        if (!obj) return;
        const charId = obj.userData.characterId;
        if (!charId) return;

        const entry = characterModels.get(charId);
        if (!entry) return;

        // Проверяем права: только владелец или GM
        const currentUserId = parseInt(localStorage.getItem('user_id'));
        const isGM = window.isGM;
        if (entry.ownerId !== currentUserId && !isGM) {
            showNotification('Вы не можете перемещать этого персонажа');
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        // Запоминаем данные для перетаскивания
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        // Получаем плоскость на высоте персонажа
        const planeY = entry.model.position.y;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        const intersectPoint = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, intersectPoint)) {
            return;
        }

        dragCharacter = {
            characterId: charId,
            model: entry.model,
            offsetX: entry.model.position.x - intersectPoint.x,
            offsetZ: entry.model.position.z - intersectPoint.z,
            startX: entry.posX,
            startZ: entry.posY
        };
        isDraggingCharacter = true;
        controls.enabled = false;
        canvas.style.cursor = 'grabbing';

        // Убираем подсветку
        if (hoveredCharacterId !== null) {
            const oldEntry = characterModels.get(hoveredCharacterId);
            if (oldEntry) {
                oldEntry.model.children.forEach(child => {
                    if (child.isMesh) {
                        child.material.emissive = new THREE.Color(0x000000);
                        child.material.emissiveIntensity = 0;
                    }
                });
            }
            hoveredCharacterId = null;
        }
    });

    // Перемещение
    canvas.addEventListener('pointermove', (e) => {
        if (!isDraggingCharacter || !dragCharacter) return;
        e.preventDefault();

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const planeY = dragCharacter.model.position.y;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        const intersectPoint = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, intersectPoint)) {
            return;
        }

        // Новая позиция (мировые координаты)
        let newX = intersectPoint.x + dragCharacter.offsetX;
        let newZ = intersectPoint.z + dragCharacter.offsetZ;

        // Ограничиваем по границам локации
        newX = Math.max(0.5, Math.min(currentLocationData.grid_width - 0.5, newX));
        newZ = Math.max(0.5, Math.min(currentLocationData.grid_height - 0.5, newZ));

        // Получаем высоту тайла под новой позицией
        const tileX = Math.floor(newX);
        const tileZ = Math.floor(newZ);
        const height = getTileHeight(tileX, tileZ);

        // Обновляем позицию модели и метки
        dragCharacter.model.position.set(newX, height, newZ);
        const entry = characterModels.get(dragCharacter.characterId);
        if (entry) {
            entry.label.position.set(newX, height + 1.2, newZ);
            // Обновляем сохранённые координаты
            entry.posX = tileX;
            entry.posY = tileZ;
        }
    });

    // Отпускание
    const endDrag = (e) => {
        if (!isDraggingCharacter || !dragCharacter) {
            controls.enabled = true;
            return;
        }

        e.preventDefault();

        // Отправляем обновление позиции на сервер
        const entry = characterModels.get(dragCharacter.characterId);
        if (entry) {
            const newX = Math.floor(entry.posX);
            const newY = Math.floor(entry.posY);
            // Отправляем через сокет или REST
            if (window.socket && window.currentLocationId) {
                // Используем существующий механизм перемещения (или спавн?)
                // Но у нас нет отдельного события для перемещения в локации,
                // можно использовать move_in_location или обновить через REST.
                // Для простоты пока просто сохраняем локально, но для синхронизации надо отправить.
                // В вашем проекте есть сокет-событие 'move_in_location'.
                // Пока отправим вручную (если есть обработчик на бэкенде).
                window.socket.emit('move_in_location', {
                    token: localStorage.getItem('access_token'),
                    location_id: window.currentLocationId,
                    character_id: dragCharacter.characterId,
                    x: newX,
                    y: newY
                });
            }
        }

        dragCharacter = null;
        isDraggingCharacter = false;
        controls.enabled = true;
        canvas.style.cursor = 'default';
    };

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
}

// ========== Настройка обработчиков ввода (редактирование + drag&drop) ==========
export function setupLocationEditing() {
    if (!renderer) return;
    const canvas = renderer.domElement;
    const locInfo = document.getElementById('location-tile-info');

    locationActive = true;

    // ---- Обновление подсветки и информации при движении мыши ----
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
                Радиация: ${tile.radiation !== undefined ? tile.radiation : '0'}<br>
                Объектов: ${tile.objects ? tile.objects.length : 0}
            `;
            locInfo.style.display = 'block';
            if (!lastHighlightCoords || lastHighlightCoords.x !== x || lastHighlightCoords.z !== z) {
                updateHighlight(x, z, tile.height || 1.0);
                lastHighlightCoords = { x, z };
            }
            hoveredTileCoords = { x, z };
        } else {
            locInfo.style.display = 'none';
            hideHighlight();
            hoveredTileCoords = null;
            lastHighlightCoords = null;
        }
    };

    // ---- Редактирование кистью при зажатой кнопке ----
    const onPointerDown = (e) => {
        if (!locationActive) return;
        if (e.button !== 0) return;
        if (!hoveredTileCoords) return;
        if (!window.locationEditMode) return;
        if (e.target !== canvas) return;

        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        const { x, z } = hoveredTileCoords;

        const radMode = document.getElementById('loc-rad-mode')?.checked;
        const objMode = document.getElementById('loc-obj-mode')?.checked;

        const updates = {};
        if (eraserMode) {
            updates.objects = [];
        } else {
            if (radMode) {
                updates.radiation = brushRadiation;
            } else if (objMode) {
                updates.addObject = true;
            } else {
                if (e.altKey) updates.terrain = currentBrushTerrain;
                if (e.shiftKey) updates.height = currentBrushHeight;
            }
        }
        if (Object.keys(updates).length) {
            applyLocationBrush(x, z, updates, brushRadius);
        }
        processedTilesForObjects.clear();
    };

    const onPointerMoveWithDrag = (e) => {
        if (!locationActive) return;
        if (e.buttons !== 1) return;
        if (!window.locationEditMode) return;
        if (!hoveredTileCoords) return;
        if (e.target !== canvas) return;

        const { x, z } = hoveredTileCoords;
        const radMode = document.getElementById('loc-rad-mode')?.checked;
        const objMode = document.getElementById('loc-obj-mode')?.checked;

        const updates = {};
        if (eraserMode) {
            updates.objects = [];
        } else {
            if (radMode) {
                updates.radiation = brushRadiation;
            } else if (objMode) {
                updates.addObject = true;
            } else {
                if (e.altKey) updates.terrain = currentBrushTerrain;
                if (e.shiftKey) updates.height = currentBrushHeight;
            }
        }
        if (Object.keys(updates).length) {
            applyLocationBrush(x, z, updates, brushRadius);
        }
    };

    const onPointerUp = (e) => {
        if (!locationActive) return;
        canvas.releasePointerCapture(e.pointerId);
    };

    // ---- Drag & Drop персонажей ----
    let previewSprite = null;
    let previewValid = false;

    function createPreviewSprite() {
        const canvas2 = document.createElement('canvas');
        canvas2.width = 64;
        canvas2.height = 64;
        const ctx = canvas2.getContext('2d');
        ctx.fillStyle = '#88aaff';
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 20px Arial';
        ctx.fillText('✨', 26, 42);
        const texture = new THREE.CanvasTexture(canvas2);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.7 });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(0.8, 0.8, 1);
        scene.add(sprite);
        return sprite;
    }

    function updatePreviewPosition(clientX, clientY) {
        if (!renderer) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(tileCubes);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const tileX = Math.floor(point.x);
            const tileZ = Math.floor(point.z);
            if (tileX >= 0 && tileX < currentLocationData.grid_width && tileZ >= 0 && tileZ < currentLocationData.grid_height) {
                const tile = currentLocationData.tiles_data[tileZ][tileX];
                const height = tile.height || 1.0;
                if (!previewSprite) previewSprite = createPreviewSprite();
                previewSprite.position.set(tileX + 0.5, height + 0.5, tileZ + 0.5);
                previewSprite.visible = true;
                previewValid = true;
                return;
            }
        }
        if (previewSprite) previewSprite.visible = false;
        previewValid = false;
    }

    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        updatePreviewPosition(e.clientX, e.clientY);
    });

    canvas.addEventListener('dragleave', (e) => {
        e.preventDefault();
        if (previewSprite) previewSprite.visible = false;
        previewValid = false;
    });

    canvas.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!previewValid) {
            console.warn('Drop cancelled: preview not valid');
            return;
        }
        // Получаем координаты тайла под мышью
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(tileCubes);
        if (intersects.length === 0) return;
        const point = intersects[0].point;
        const tileX = Math.floor(point.x);
        const tileZ = Math.floor(point.z);

        const dragData = e.dataTransfer.getData('text/plain');
        if (!dragData) {
            console.warn('No drag data');
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(dragData);
        } catch (err) {
            console.warn('Invalid drag data JSON', err);
            return;
        }
        const characterId = parsed.characterId;
        const ownerId = parsed.ownerId;

        if (!characterId) {
            console.warn('No characterId in drag data');
            return;
        }

        // Открываем модальное окно выбора владельца
        openOwnerSelectionModal(characterId, tileX, tileZ, ownerId);

        if (previewSprite) previewSprite.visible = false;
        previewValid = false;
    });

    // ---- Регистрация обработчиков ----
    window.addEventListener('pointermove', onPointerMoveWithDrag);
    window.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);

    // Отключаем зуум при Alt
    canvas.addEventListener('wheel', (e) => {
        if (e.altKey) {
            e.preventDefault();
        }
    }, { passive: false });

    // Сохраняем cleanup
    eventCleanup = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointermove', onPointerMoveWithDrag);
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointerup', onPointerUp);
        locationActive = false;
        if (previewSprite) {
            scene.remove(previewSprite);
            previewSprite = null;
        }
    };
    window._locationEventCleanup = eventCleanup;
}

// ========== Модальное окно выбора владельца ==========
export async function openOwnerSelectionModal(characterId, tileX, tileZ, dragDataOwnerId) {
    const lobbyParticipants = window.lobbyParticipants || [];
    const currentUserId = parseInt(localStorage.getItem('user_id'));
    const isGM = window.isGM;

    let characterOwner = dragDataOwnerId;
    if (!characterOwner) {
        try {
            const response = await fetch(`/lobbies/characters/${characterId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (response.ok) {
                const info = await response.json();
                characterOwner = info.owner_id;
            }
        } catch (err) {
            console.warn('Failed to fetch character owner', err);
        }
    }

    let options = [];
    if (isGM) {
        options = lobbyParticipants.map(p => ({ id: p.user_id, name: p.username }));
    } else {
        if (characterOwner !== currentUserId) {
            showNotification('Вы не можете спавнить чужого персонажа');
            return;
        }
        options = [{ id: currentUserId, name: localStorage.getItem('username') }];
    }

    if (options.length === 0) {
        showNotification('Нет доступных владельцев');
        return;
    }

    // Модальное окно
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Выберите владельца персонажа</h3>
            <select id="owner-select" class="form-control">
                ${options.map(opt => `<option value="${opt.id}">${opt.name}</option>`).join('')}
            </select>
            <div class="form-actions">
                <button id="confirm-spawn" class="btn btn-primary">Поместить</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('confirm-spawn').onclick = async () => {
        const assignToUserId = parseInt(document.getElementById('owner-select').value);
        modal.remove();
        try {
            const response = await fetch(`/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/spawn_character`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                },
                body: JSON.stringify({
                    character_id: characterId,
                    tile_x: tileX,
                    tile_y: tileZ,
                    assign_to_user_id: assignToUserId
                })
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to spawn character');
            }
            showNotification('Персонаж появился в локации', 'success');
        } catch (err) {
            showNotification(err.message);
        }
    };
}

// ========== Управляющие функции для UI ==========
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
export function setLocationBrushRadiation(rad) {
    brushRadiation = Math.min(10, Math.max(0, rad));
    const radiationSlider = document.getElementById('loc-edit-radiation');
    const radiationSpan = document.getElementById('loc-radiation-value');
    if (radiationSlider) radiationSlider.value = brushRadiation;
    if (radiationSpan) radiationSpan.textContent = brushRadiation.toFixed(1);
}
export function setLocationBrushObjectMode(enabled) {
    brushObjectMode = enabled;
    const checkbox = document.getElementById('loc-obj-mode');
    if (checkbox) checkbox.checked = enabled;
}
export function setLocationBrushObjectType(type) {
    brushObjectType = type;
    const select = document.getElementById('loc-obj-type');
    if (select) select.value = type;
}
export function setLocationBrushObjectColor(color) {
    brushObjectColor = color;
    const input = document.getElementById('loc-obj-color');
    if (input) input.value = color;
}
export function setLocationBrushObjectOffsetX(offset) {
    brushObjectOffsetX = parseFloat(offset) || 0;
    const span = document.getElementById('loc-obj-offset-x-value');
    if (span) span.textContent = brushObjectOffsetX.toFixed(2);
}
export function setLocationBrushObjectOffsetZ(offset) {
    brushObjectOffsetZ = parseFloat(offset) || 0;
    const span = document.getElementById('loc-obj-offset-z-value');
    if (span) span.textContent = brushObjectOffsetZ.toFixed(2);
}
export function setLocationBrushObjectScale(scale) {
    brushObjectScale = parseFloat(scale) || 1.0;
    const span = document.getElementById('loc-obj-scale-value');
    if (span) span.textContent = brushObjectScale.toFixed(2);
}
export function setLocationBrushObjectRotation(rot) {
    brushObjectRotation = parseInt(rot) || 0;
    const span = document.getElementById('loc-obj-rotation-value');
    if (span) span.textContent = brushObjectRotation + '°';
}

// ========== Остальные экспорты ==========
export function setCurrentLocationId(id) { currentLocationId = id; }
export function getCurrentLocationId() { return currentLocationId; }
export function getHoveredTileCoords() { return hoveredTileCoords; }
export function updateHighlightByCoords(x, z) {
    if (!currentLocationData) return;
    const tile = currentLocationData.tiles_data[z]?.[x];
    if (tile) updateHighlight(x, z, tile.height);
}

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

export function destroyLocationScene() {
    locationActive = false;
    if (eventCleanup) {
        eventCleanup();
        eventCleanup = null;
    }
    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer = null;
    }
    if (labelRenderer) {
        if (labelRenderer.domElement && labelRenderer.domElement.parentNode) {
            labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement);
        }
        labelRenderer = null;
    }
    clearAllCharacters();
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
    currentLocationData = null;
    hoveredTileCoords = null;
    if (highlightBox && highlightBox.parent) scene?.remove(highlightBox);
    highlightBox = null;
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

window.addEventListener('resize', resizeLocationScene);