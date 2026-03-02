import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

const CHUNK_SIZE = 32;
export const chunksMap = new Map();

const MIN_CHUNK = 0;
const MAX_CHUNK = 15;
const chunkBounds = [];

// Цвета ландшафта
const terrainColors = {
    grass: 0x3a5f0b,
    sand: 0xC2B280,
    rock: 0x808080,
    swamp: 0x4B3B2A,
    water: 0x1E90FF
};

// Геометрия объектов
const treeGeo = new THREE.ConeGeometry(0.3, 1, 8);
const houseGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const fenceGeo = new THREE.BoxGeometry(0.2, 0.5, 0.8);
const anomalyGeo = new THREE.SphereGeometry(0.3, 16, 16);

// Материалы с поддержкой вершинных цветов
const treeMat = new THREE.MeshStandardMaterial();
const houseMat = new THREE.MeshStandardMaterial();
const fenceMat = new THREE.MeshStandardMaterial();
const anomalyMat = new THREE.MeshStandardMaterial({ emissive: 0x333333 });

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

// Освещение
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
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

// --- Вспомогательные функции ---
function getObjectHeightOffset(type) {
    switch(type) {
        case 'tree': return 0.5;
        case 'house': return 0.3;
        case 'fence': return 0.25;
        case 'anomaly': return 0.3;
        default: return 0.3;
    }
}

function getDefaultColorForType(type) {
    switch(type) {
        case 'tree': return '#2d5a27';
        case 'house': return '#8B4513';
        case 'fence': return '#8B5A2B';
        case 'anomaly': return '#00FFFF';
        default: return '#ffffff';
    }
}

// --- Функции для чанков ---
export function addChunk(cx, cy, tilesData) {
    if (cx < MIN_CHUNK || cx > MAX_CHUNK || cy < MIN_CHUNK || cy > MAX_CHUNK) return;

    const key = `${cx},${cy}`;
    if (chunksMap.has(key)) return;

    const size = tilesData.length;
    const totalTiles = size * size;

    // Геометрия для ландшафта
    const groundGeo = new THREE.BoxGeometry(1, 1, 1);
    const planeGeo = new THREE.PlaneGeometry(0.95, 0.95);
    planeGeo.rotateX(-Math.PI / 2);

    // Материалы
    const groundMat = new THREE.MeshStandardMaterial();
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x1E90FF, transparent: true, opacity: 0.8 });

    // Инстанс-меш для земли (все типы, кроме воды)
    const groundInstances = new THREE.InstancedMesh(groundGeo, groundMat, totalTiles);
    groundInstances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(totalTiles * 3), 3);

    // Инстанс-меш для воды
    const waterInstances = new THREE.InstancedMesh(planeGeo, waterMat, totalTiles);

    groundInstances.castShadow = false; groundInstances.receiveShadow = false;
    waterInstances.castShadow = false; waterInstances.receiveShadow = false;

    // Подсчёт количества каждого типа объектов
    let treeCount = 0, houseCount = 0, fenceCount = 0, anomalyCount = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            if (tile.objects) {
                tile.objects.forEach(obj => {
                    if (obj.type === 'tree') treeCount++;
                    else if (obj.type === 'house') houseCount++;
                    else if (obj.type === 'fence') fenceCount++;
                    else if (obj.type === 'anomaly') anomalyCount++;
                });
            }
        }
    }

    // Создание инстанс-мешей для объектов
    const treeInstances = treeCount > 0 ? new THREE.InstancedMesh(treeGeo, treeMat, treeCount) : null;
    if (treeInstances) {
        treeInstances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(treeCount * 3), 3);
        treeInstances.castShadow = true;
        treeInstances.receiveShadow = false;
    }

    const houseInstances = houseCount > 0 ? new THREE.InstancedMesh(houseGeo, houseMat, houseCount) : null;
    if (houseInstances) {
        houseInstances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(houseCount * 3), 3);
        houseInstances.castShadow = true;
        houseInstances.receiveShadow = false;
    }

    const fenceInstances = fenceCount > 0 ? new THREE.InstancedMesh(fenceGeo, fenceMat, fenceCount) : null;
    if (fenceInstances) {
        fenceInstances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(fenceCount * 3), 3);
        fenceInstances.castShadow = true;
        fenceInstances.receiveShadow = false;
    }

    const anomalyInstances = anomalyCount > 0 ? new THREE.InstancedMesh(anomalyGeo, anomalyMat, anomalyCount) : null;
    if (anomalyInstances) {
        anomalyInstances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(anomalyCount * 3), 3);
        anomalyInstances.castShadow = true;
        anomalyInstances.receiveShadow = false;
    }

    const dummy = new THREE.Object3D();
    let minX = Infinity, maxX = -Infinity, minY = 0, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

    let groundIdx = 0, waterIdx = 0;
    let treeIdx = 0, houseIdx = 0, fenceIdx = 0, anomalyIdx = 0;

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
            maxY = Math.max(maxY, height + 0.5);
            minZ = Math.min(minZ, worldZ - 0.5);
            maxZ = Math.max(maxZ, worldZ + 0.5);

            // ---- Земля ----
            dummy.rotation.set(0, 0, 0);
            dummy.position.set(worldX, height / 2, worldZ);
            if (tile.terrain === 'water') {
                dummy.scale.set(0, 0, 0);
            } else {
                dummy.scale.set(1, height, 1);
            }
            dummy.updateMatrix();
            groundInstances.setMatrixAt(groundIdx, dummy.matrix);
            groundIdx++;

            // Цвет земли
            const color = new THREE.Color(terrainColors[tile.terrain] || 0x3a5f0b);
            groundInstances.setColorAt(index, color);

            // ---- Вода ----
            dummy.rotation.set(0, 0, 0);
            dummy.position.set(worldX, height / 2, worldZ);
            if (tile.terrain === 'water') {
                dummy.scale.set(1, 1, 1);
            } else {
                dummy.scale.set(0, 0, 0);
            }
            dummy.updateMatrix();
            waterInstances.setMatrixAt(waterIdx++, dummy.matrix);

            // ---- Объекты ----
            if (tile.objects) {
                tile.objects.forEach(obj => {
                    dummy.rotation.set(0, THREE.MathUtils.degToRad(obj.rotation || 0), 0);
                    dummy.position.set(
                        worldX + (obj.x || 0),
                        height + getObjectHeightOffset(obj.type),
                        worldZ + (obj.z || 0)
                    );
                    dummy.scale.set(obj.scale || 1, 1, obj.scale || 1);
                    dummy.updateMatrix();

                    const objColor = new THREE.Color(obj.color || getDefaultColorForType(obj.type));

                    if (obj.type === 'tree' && treeInstances) {
                        treeInstances.setMatrixAt(treeIdx, dummy.matrix);
                        treeInstances.setColorAt(treeIdx, objColor);
                        treeIdx++;
                    } else if (obj.type === 'house' && houseInstances) {
                        houseInstances.setMatrixAt(houseIdx, dummy.matrix);
                        houseInstances.setColorAt(houseIdx, objColor);
                        houseIdx++;
                    } else if (obj.type === 'fence' && fenceInstances) {
                        fenceInstances.setMatrixAt(fenceIdx, dummy.matrix);
                        fenceInstances.setColorAt(fenceIdx, objColor);
                        fenceIdx++;
                    } else if (obj.type === 'anomaly' && anomalyInstances) {
                        anomalyInstances.setMatrixAt(anomalyIdx, dummy.matrix);
                        anomalyInstances.setColorAt(anomalyIdx, objColor);
                        anomalyIdx++;
                    }
                });
            }
        }
    }

    // Обновление матриц и цветов
    groundInstances.instanceMatrix.needsUpdate = true;
    groundInstances.instanceColor.needsUpdate = true;
    waterInstances.instanceMatrix.needsUpdate = true;

    if (treeInstances) {
        treeInstances.instanceMatrix.needsUpdate = true;
        treeInstances.instanceColor.needsUpdate = true;
    }
    if (houseInstances) {
        houseInstances.instanceMatrix.needsUpdate = true;
        houseInstances.instanceColor.needsUpdate = true;
    }
    if (fenceInstances) {
        fenceInstances.instanceMatrix.needsUpdate = true;
        fenceInstances.instanceColor.needsUpdate = true;
    }
    if (anomalyInstances) {
        anomalyInstances.instanceMatrix.needsUpdate = true;
        anomalyInstances.instanceColor.needsUpdate = true;
    }

    // Добавление в сцену
    scene.add(groundInstances);
    scene.add(waterInstances);
    if (treeInstances) scene.add(treeInstances);
    if (houseInstances) scene.add(houseInstances);
    if (fenceInstances) scene.add(fenceInstances);
    if (anomalyInstances) scene.add(anomalyInstances);

    // Bounding box для рейкаста
    const box = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    chunkBounds.push({ box, mesh: groundInstances, key });
    if (waterInstances) chunkBounds.push({ box, mesh: waterInstances, key });
    if (treeInstances) chunkBounds.push({ box, mesh: treeInstances, key });
    if (houseInstances) chunkBounds.push({ box, mesh: houseInstances, key });
    if (fenceInstances) chunkBounds.push({ box, mesh: fenceInstances, key });
    if (anomalyInstances) chunkBounds.push({ box, mesh: anomalyInstances, key });

    // Сохраняем в карту
    chunksMap.set(key, {
        ground: groundInstances,
        water: waterInstances,
        trees: treeInstances,
        houses: houseInstances,
        fences: fenceInstances,
        anomalies: anomalyInstances,
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
    if (entry.trees) scene.remove(entry.trees);
    if (entry.houses) scene.remove(entry.houses);
    if (entry.fences) scene.remove(entry.fences);
    if (entry.anomalies) scene.remove(entry.anomalies);

    // Удаляем только уникальные для чанка ресурсы (земля и вода)
    entry.ground.geometry.dispose();
    entry.ground.material.dispose();
    entry.water.geometry.dispose();
    entry.water.material.dispose();

    // Для общих объектов не вызываем dispose, так как они используются другими чанками
    // if (entry.trees) { entry.trees.geometry.dispose(); entry.trees.material.dispose(); }
    // и т.д.

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

export function setBrushRadius(radius) {
    currentBrushRadius = radius;
}

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
                if (entry.ground === mesh || entry.water === mesh ||
                    entry.trees === mesh || entry.houses === mesh ||
                    entry.fences === mesh || entry.anomalies === mesh) {
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

                const areaSize = 2 * currentBrushRadius + 1;
                highlightBox.scale.set(areaSize, 0.1, areaSize);
                highlightBox.position.set(worldX, height + 0.1, worldZ);
                highlightBox.visible = true;

                if (tileInfoDiv && tileInfoContent) {
                    tileInfoContent.innerHTML = `
                        <b>Тайл (${chunkEntry.chunkX * CHUNK_SIZE + tileX}, ${chunkEntry.chunkY * CHUNK_SIZE + tileY})</b><br>
                        Ландшафт: ${tileData.terrain}<br>
                        Высота: ${tileData.height}<br>
                        Объектов: ${tileData.objects ? tileData.objects.length : 0}
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

window.addEventListener('dblclick', (event) => {
    if (event.target.closest('.ui-overlay')) return;
    if (editMode && hoveredTile && window.tileClickCallback) {
        window.tileClickCallback({
            chunkX: hoveredTile.chunk.chunkX,
            chunkY: hoveredTile.chunk.chunkY,
            tileX: hoveredTile.tileX,
            tileY: hoveredTile.tileY,
            tileData: hoveredTile.tileData
        }, event, true);
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

export function getHoveredTile() {
    return hoveredTile;
}

// Заглушки для маркеров
export function addMarker(marker) { console.warn('addMarker not implemented'); }
export function moveMarker(markerId, x, y) { console.warn('moveMarker not implemented'); }
export function removeMarker(markerId) { console.warn('removeMarker not implemented'); }
export function loadMarkers(markers) { console.warn('loadMarkers not implemented'); }