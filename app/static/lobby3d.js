import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

const CHUNK_SIZE = 32;
export const chunksMap = new Map();

const MIN_CHUNK = 0;
const MAX_CHUNK = 15;
const chunkBounds = [];

// --- Сцена ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111122);
scene.fog = new THREE.Fog(0x111122, 500, 1500);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(256, 300, 256);
camera.lookAt(256, 0, 256);

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = false;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2;
controls.target.set(256, 0, 256);

// --- Усиленное освещение ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // яркий белый свет
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(5, 10, 7);
directionalLight.castShadow = false;
scene.add(directionalLight);

// --- Интерактивность ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredTile = null;
let editMode = false;
let currentBrushRadius = 0;

let lastRaycast = 0;
const RAYCAST_INTERVAL = 10;

const highlightBoxGeo = new THREE.BoxGeometry(1.1, 0.1, 1.1);
const highlightBoxMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 });
const highlightBox = new THREE.Mesh(highlightBoxGeo, highlightBoxMat);
highlightBox.position.set(0, 0.05, 0);
scene.add(highlightBox);
highlightBox.visible = false;

const tileInfoDiv = document.getElementById('tile-info');
const tileInfoContent = document.getElementById('tile-info-content');

// --- Функции для чанков ---
export function addChunk(cx, cy, tilesData) {
    if (cx < MIN_CHUNK || cx > MAX_CHUNK || cy < MIN_CHUNK || cy > MAX_CHUNK) return;

    const key = `${cx},${cy}`;
    if (chunksMap.has(key)) return;

    const size = tilesData.length;
    const totalTiles = size * size;

    // Геометрия
    const planeGeo = new THREE.PlaneGeometry(0.95, 0.95);
    planeGeo.rotateX(-Math.PI / 2);
    const objectGeo = new THREE.BoxGeometry(0.5, 1, 0.5);

    // Материалы
    const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true });
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.8 });
    const objectMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });

    // Инстанс-меши
    const groundInstances = new THREE.InstancedMesh(planeGeo, groundMat, totalTiles);
    groundInstances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(totalTiles * 3), 3);
    // Явно связываем атрибут цвета с геометрией
    groundInstances.geometry.setAttribute('color', groundInstances.instanceColor);

    const waterInstances = new THREE.InstancedMesh(planeGeo, waterMat, totalTiles);
    const objectInstances = new THREE.InstancedMesh(objectGeo, objectMat, totalTiles);

    groundInstances.castShadow = false; groundInstances.receiveShadow = false;
    waterInstances.castShadow = false; waterInstances.receiveShadow = false;
    objectInstances.castShadow = true; objectInstances.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let minX = Infinity, maxX = -Infinity, minY = 0, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

    // Проходим по всем тайлам
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            const worldX = cx * size + x + 0.5;
            const worldZ = cy * size + y + 0.5;
            const height = tile.height || 1.0;
            const index = y * size + x;

            // Обновляем границы чанка
            minX = Math.min(minX, worldX - 0.5);
            maxX = Math.max(maxX, worldX + 0.5);
            maxY = Math.max(maxY, height + (tile.type === 'forest' || tile.type === 'house' ? 1.0 : 0));
            minZ = Math.min(minZ, worldZ - 0.5);
            maxZ = Math.max(maxZ, worldZ + 0.5);

            // Земля (для всех типов, кроме воды, ставим масштаб 1, для воды - 0)
            dummy.position.set(worldX, height / 2, worldZ);
            if (tile.type === 'water') {
                dummy.scale.set(0, 1, 0);
            } else {
                dummy.scale.set(1, 1, 1);
            }
            dummy.updateMatrix();
            groundInstances.setMatrixAt(index, dummy.matrix);

            // Устанавливаем цвет для земли
            const color = new THREE.Color(tile.color);
            groundInstances.setColorAt(index, color);

            // Вода
            if (tile.type === 'water') {
                dummy.scale.set(1, 1, 1);
            } else {
                dummy.scale.set(0, 1, 0);
            }
            dummy.updateMatrix();
            waterInstances.setMatrixAt(index, dummy.matrix);

            // Объекты
            if (tile.type === 'forest' || tile.type === 'house') {
                dummy.position.set(worldX, height + 0.5, worldZ);
                dummy.scale.set(tile.type === 'forest' ? 0.3 : 0.8, 1, tile.type === 'forest' ? 0.3 : 0.8);
                dummy.updateMatrix();
                objectInstances.setMatrixAt(index, dummy.matrix);
            } else {
                // Для не-объектов ставим масштаб 0
                dummy.scale.set(0, 0, 0);
                dummy.updateMatrix();
                objectInstances.setMatrixAt(index, dummy.matrix);
            }
        }
    }

    // Обновляем матрицы и цвета
    groundInstances.instanceMatrix.needsUpdate = true;
    groundInstances.instanceColor.needsUpdate = true;
    waterInstances.instanceMatrix.needsUpdate = true;
    objectInstances.instanceMatrix.needsUpdate = true;

    // Добавляем в сцену
    scene.add(groundInstances);
    scene.add(waterInstances);
    scene.add(objectInstances);

    // Bounding box для рейкаста
    const box = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    chunkBounds.push({ box, mesh: groundInstances, key });

    // Сохраняем в карту
    chunksMap.set(key, {
        ground: groundInstances,
        water: waterInstances,
        objects: objectInstances,
        tilesData: tilesData,
        chunkX: cx,
        chunkY: cy
    });
}

export function removeChunk(cx, cy) {
    const key = `${cx},${cy}`;
    const entry = chunksMap.get(key);
    if (!entry) return;

    for (let i = chunkBounds.length - 1; i >= 0; i--) {
        if (chunkBounds[i].key === key) chunkBounds.splice(i, 1);
    }

    scene.remove(entry.ground);
    scene.remove(entry.water);
    scene.remove(entry.objects);

    entry.ground.geometry.dispose();
    entry.ground.material.dispose();
    entry.water.geometry.dispose();
    entry.water.material.dispose();
    entry.objects.geometry.dispose();
    entry.objects.material.dispose();

    chunksMap.delete(key);
}

export function updateTileInChunk(chunkX, chunkY, tileX, tileY, updates) {
    const key = `${chunkX},${chunkY}`;
    const entry = chunksMap.get(key);
    if (!entry) return;
    const tile = entry.tilesData[tileY][tileX];
    Object.assign(tile, updates);
    removeChunk(chunkX, chunkY);
    addChunk(chunkX, chunkY, entry.tilesData);
}

// --- Управление радиусом кисти ---
export function setBrushRadius(radius) {
    currentBrushRadius = radius;
}

// --- Обработка наведения ---
function onMouseMove(event) {
    const now = Date.now();
    if (now - lastRaycast < RAYCAST_INTERVAL) return;
    lastRaycast = now;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const candidates = chunkBounds.filter(entry => raycaster.ray.intersectsBox(entry.box)).map(e => e.mesh);
    const intersects = raycaster.intersectObjects(candidates);

    if (hoveredTile) {
        highlightBox.visible = false;
        hoveredTile = null;
    }
    if (tileInfoDiv) tileInfoDiv.style.display = 'none';

    if (intersects.length > 0) {
        const intersect = intersects[0];
        const mesh = intersect.object;
        const instanceId = intersect.instanceId;
        if (instanceId !== undefined) {
            let chunkEntry = null;
            for (let entry of chunksMap.values()) {
                if (entry.ground === mesh || entry.water === mesh || entry.objects === mesh) {
                    chunkEntry = entry;
                    break;
                }
            }
            if (chunkEntry) {
                const tileX = instanceId % CHUNK_SIZE;
                const tileY = Math.floor(instanceId / CHUNK_SIZE);
                const tileData = chunkEntry.tilesData[tileY][tileX];
                hoveredTile = { chunk: chunkEntry, instanceId, tileX, tileY, tileData };

                const worldX = chunkEntry.chunkX * CHUNK_SIZE + tileX + 0.5;
                const worldZ = chunkEntry.chunkY * CHUNK_SIZE + tileY + 0.5;
                const height = tileData.height || 1.0;

                // Масштабируем подсветку под радиус кисти
                const areaSize = 2 * currentBrushRadius + 1;
                highlightBox.scale.set(areaSize, 0.1, areaSize);
                highlightBox.position.set(worldX, height + 0.1, worldZ);
                highlightBox.visible = true;

                if (tileInfoDiv && tileInfoContent) {
                    tileInfoContent.innerHTML = `
                        <b>Тайл (${chunkEntry.chunkX * CHUNK_SIZE + tileX}, ${chunkEntry.chunkY * CHUNK_SIZE + tileY})</b><br>
                        Тип: ${tileData.type}<br>
                        Цвет: ${tileData.color}<br>
                        Высота: ${tileData.height}
                    `;
                    tileInfoDiv.style.display = 'block';
                }
            }
        }
    }
}
window.addEventListener('mousemove', onMouseMove);

export function setEditMode(enabled) { editMode = enabled; }
export function setTileClickCallback(callback) { window.tileClickCallback = callback; }

window.addEventListener('click', (event) => {
    if (event.target.closest('.ui-overlay')) return;
    if (editMode && hoveredTile && window.tileClickCallback) {
        window.tileClickCallback({
            chunkX: hoveredTile.chunk.chunkX,
            chunkY: hoveredTile.chunk.chunkY,
            tileX: hoveredTile.tileX,
            tileY: hoveredTile.tileY,
            tileData: hoveredTile.tileData
        }, event);
    }
});

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Заглушки для маркеров
export function addMarker(marker) { console.warn('addMarker not implemented'); }
export function moveMarker(markerId, x, y) { console.warn('moveMarker not implemented'); }
export function removeMarker(markerId) { console.warn('removeMarker not implemented'); }
export function loadMarkers(markers) { console.warn('loadMarkers not implemented'); }