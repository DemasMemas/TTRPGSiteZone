import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

const CHUNK_SIZE = 32;
export const chunksMap = new Map();

const MIN_CHUNK = 0;
const MAX_CHUNK = 15;
const chunkBounds = [];
const ANOMALY_TYPES = ['electric', 'fire', 'acid', 'void'];

// Цвета ландшафта
const terrainColors = {
    grass: 0x3a5f0b,
    sand: 0xC2B280,
    rock: 0x808080,
    swamp: 0x4B3B2A,
    water: 0x1E90FF
};

// Геометрия объектов (для инстансинга)
const treeGeo = new THREE.ConeGeometry(0.3, 1, 8);
const houseGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const fenceGeo = new THREE.BoxGeometry(0.2, 0.5, 0.8);

// Материалы для инстанс-мешей
const treeMat = new THREE.MeshStandardMaterial();
const houseMat = new THREE.MeshStandardMaterial();
const fenceMat = new THREE.MeshStandardMaterial();

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

// --- Вспомогательные функции для определения базовых размеров ---
function getBaseDimensions(type, anomalyType) {
    const base = { width: 0.6, height: 0.6, depth: 0.6 }; // значения по умолчанию
    if (type === 'tree') {
        base.width = 0.6;  // диаметр
        base.height = 1.0;  // высота конуса
        base.depth = 0.6;
    } else if (type === 'house') {
        base.width = 0.6;
        base.height = 0.6;
        base.depth = 0.6;
    } else if (type === 'fence') {
        base.width = 0.2;
        base.height = 0.5;
        base.depth = 0.8;
    } else if (type === 'anomaly') {
        switch(anomalyType) {
            case 'acid':
                base.width = 1.0;   // диаметр лужи
                base.height = 0.1;   // толщина диска
                base.depth = 1.0;
                break;
            case 'fire':
            case 'electric':
            case 'void':
            default:
                base.width = 0.6;    // диаметр сферы (радиус 0.3)
                base.height = 0.6;
                base.depth = 0.6;
                break;
        }
    }
    return base;
}

// Возвращает половину базовой высоты (для позиционирования центра)
function getBaseHalfHeight(type, anomalyType) {
    const dims = getBaseDimensions(type, anomalyType);
    return dims.height / 2;
}

// Экспортируем для использования в lobby.js
export function getObjectHalfHeight(type, anomalyType) {
    return getBaseHalfHeight(type, anomalyType);
}

// Для обратной совместимости
export function getObjectHeightOffset(type, anomalyType) {
    return getBaseHalfHeight(type, anomalyType);
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

// --- Текстуры для аномалий ---
function createSparkTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(4, 4, 2, 0, Math.PI * 2);
    ctx.fill();
    return new THREE.CanvasTexture(canvas);
}

function createFireTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,200,0,0.8)');
    gradient.addColorStop(0.8, 'rgba(255,0,0,0.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 16, 16);
    return new THREE.CanvasTexture(canvas);
}

function createNoiseTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
        const val = Math.random() * 255;
        imageData.data[i] = val;
        imageData.data[i+1] = val;
        imageData.data[i+2] = val;
        imageData.data[i+3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return new THREE.CanvasTexture(canvas);
}

// --- Типы аномалий ---
function createElectricAnomaly(color) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);

    // Ядро
    const coreGeo = new THREE.SphereGeometry(0.2, 8);
    const coreMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col,
        transparent: true,
        opacity: 0.7
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    // Искры-частицы
    const particleCount = 15;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const r = 0.3 + Math.random() * 0.3;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 2;
        positions[i*3] = Math.sin(theta) * Math.cos(phi) * r;
        positions[i*3+1] = Math.sin(theta) * Math.sin(phi) * r;
        positions[i*3+2] = Math.cos(theta) * r;

        const c = col.clone().lerp(new THREE.Color(0xffffff), Math.random() * 0.5);
        colors[i*3] = c.r;
        colors[i*3+1] = c.g;
        colors[i*3+2] = c.b;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const particleMat = new THREE.PointsMaterial({
        size: 0.05,
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        map: createSparkTexture()
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);

    // Молнии
    const lightningCount = 3;
    for (let j = 0; j < lightningCount; j++) {
        const points = [];
        const start = new THREE.Vector3(0, 0, 0);
        const end = new THREE.Vector3(
            (Math.random() - 0.5) * 0.6,
            (Math.random() - 0.5) * 0.6,
            (Math.random() - 0.5) * 0.6
        ).normalize().multiplyScalar(0.5);
        const segments = 4;
        points.push(start);
        for (let i = 1; i < segments; i++) {
            const t = i / segments;
            const p = start.clone().lerp(end, t);
            p.x += (Math.random() - 0.5) * 0.1;
            p.y += (Math.random() - 0.5) * 0.1;
            p.z += (Math.random() - 0.5) * 0.1;
            points.push(p);
        }
        points.push(end);
        const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
        const line = new THREE.Line(lineGeo, lineMat);
        group.add(line);
    }

    return group;
}

function createFireAnomaly(color) {
    const group = new THREE.Group();

    // Ядро (огненное)
    const coreGeo = new THREE.SphereGeometry(0.2, 6);
    const coreMat = new THREE.MeshStandardMaterial({
        color: 0xff5500,
        emissive: 0xff2200,
        transparent: true,
        opacity: 0.8
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    // Частицы огня (поднимающиеся)
    const particleCount = 20;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const r = 0.2 + Math.random() * 0.3;
        const angle = Math.random() * Math.PI * 2;
        const height = Math.random() * 0.8;
        positions[i*3] = Math.cos(angle) * r;
        positions[i*3+1] = height;
        positions[i*3+2] = Math.sin(angle) * r;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
        size: 0.1,
        color: 0xffaa00,
        blending: THREE.AdditiveBlending,
        map: createFireTexture()
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);

    return group;
}

function createAcidAnomaly(color) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);

    // Лужа (диск)
    const puddleGeo = new THREE.CircleGeometry(0.5, 8);
    const puddleMat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: col.clone().multiplyScalar(0.3),
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    });
    const puddle = new THREE.Mesh(puddleGeo, puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.y = 0.05; // центр диска на высоте 0.05 (толщина 0.1, значит низ на 0)
    group.add(puddle);

    // Пузырьки
    const bubbleCount = 5;
    for (let i = 0; i < bubbleCount; i++) {
        const bubbleGeo = new THREE.SphereGeometry(0.05, 4);
        const bubbleMat = new THREE.MeshStandardMaterial({
            color: 0x88ff88,
            emissive: 0x224422,
            transparent: true,
            opacity: 0.5
        });
        const bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
        bubble.position.set(
            (Math.random() - 0.5) * 0.4,
            0.1 + Math.random() * 0.1,
            (Math.random() - 0.5) * 0.4
        );
        group.add(bubble);
    }

    return group;
}

function createVoidAnomaly(color) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);

    // Сфера с шумом
    const geo = new THREE.SphereGeometry(0.3, 16);
    const noiseTex = createNoiseTexture();
    const mat = new THREE.MeshPhongMaterial({
        map: noiseTex,
        color: col,
        emissive: col.clone().multiplyScalar(0.5),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
    });
    const sphere = new THREE.Mesh(geo, mat);
    group.add(sphere);

    // Внутренние точки
    const pointCount = 8;
    const pointPositions = [];
    for (let i = 0; i < pointCount; i++) {
        const r = 0.2;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        pointPositions.push(
            Math.sin(phi) * Math.cos(theta) * r,
            Math.sin(phi) * Math.sin(theta) * r,
            Math.cos(phi) * r
        );
    }
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.Float32BufferAttribute(pointPositions, 3));
    const pointMat = new THREE.PointsMaterial({
        size: 0.05,
        color: 0xffffff,
        blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(pointGeo, pointMat);
    group.add(points);

    return group;
}

// --- Создание LOD для аномалии ---
function createAnomalyLOD(x, y, z, type = 'electric', baseColor = '#00ffff', scale = 1.0) {
    const lod = new THREE.LOD();
    const color = new THREE.Color(baseColor);

    // Ближний уровень (полный)
    let nearGroup;
    switch(type) {
        case 'fire':
            nearGroup = createFireAnomaly(color);
            break;
        case 'electric':
            nearGroup = createElectricAnomaly(color);
            break;
        case 'acid':
            nearGroup = createAcidAnomaly(color);
            break;
        case 'void':
        default:
            nearGroup = createVoidAnomaly(color);
            break;
    }
    nearGroup.scale.set(scale, scale, scale);
    nearGroup.position.set(0, 0, 0);
    lod.addLevel(nearGroup, 0);

    // Средний уровень (упрощённый: только ядро)
    const midGroup = new THREE.Group();
    const coreGeo = new THREE.SphereGeometry(0.25, 8);
    const coreMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color.clone().multiplyScalar(0.5),
        transparent: true,
        opacity: 0.8
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.scale.set(scale, scale, scale);
    midGroup.add(core);
    midGroup.position.set(0, 0, 0);
    lod.addLevel(midGroup, 80);

    // Дальний уровень (простой спрайт/сфера)
    const farGeo = new THREE.SphereGeometry(0.2, 4);
    const farMat = new THREE.MeshStandardMaterial({ color: color, emissive: color.clone().multiplyScalar(0.3) });
    const farMesh = new THREE.Mesh(farGeo, farMat);
    farMesh.scale.set(scale, scale, scale);
    farMesh.position.set(0, 0, 0);
    lod.addLevel(farMesh, 200);

    lod.position.set(x, y, z);
    return lod;
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

    // Подсчёт количества каждого типа объектов (кроме аномалий)
    let treeCount = 0, houseCount = 0, fenceCount = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            if (tile.objects) {
                tile.objects.forEach(obj => {
                    if (obj.type === 'tree') treeCount++;
                    else if (obj.type === 'house') houseCount++;
                    else if (obj.type === 'fence') fenceCount++;
                });
            }
        }
    }

    // Создание инстанс-мешей для объектов (деревья, дома, заборы)
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

    const dummy = new THREE.Object3D();
    let minX = Infinity, maxX = -Infinity, minY = 0, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

    let groundIdx = 0, waterIdx = 0;
    let treeIdx = 0, houseIdx = 0, fenceIdx = 0;
    const anomalyLODs = [];

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
                    if (obj.type === 'anomaly') {
                        let anomalyType = obj.anomalyType;
                        if (!anomalyType) {
                            anomalyType = ANOMALY_TYPES[Math.floor(Math.random() * ANOMALY_TYPES.length)];
                            obj.anomalyType = anomalyType;
                        }
                        const baseHalf = getBaseHalfHeight('anomaly', anomalyType);
                        const yPos = height + baseHalf * (obj.scale || 1.0);
                        const lod = createAnomalyLOD(
                            worldX + (obj.x || 0),
                            yPos,
                            worldZ + (obj.z || 0),
                            anomalyType,
                            obj.color || getDefaultColorForType('anomaly'),
                            obj.scale || 1.0
                        );
                        scene.add(lod);
                        anomalyLODs.push(lod);
                    } else {
                        const baseHalf = getBaseHalfHeight(obj.type);
                        const yPos = height + baseHalf * (obj.scale || 1.0);
                        dummy.rotation.set(0, THREE.MathUtils.degToRad(obj.rotation || 0), 0);
                        dummy.position.set(
                            worldX + (obj.x || 0),
                            yPos,
                            worldZ + (obj.z || 0)
                        );
                        dummy.scale.set(obj.scale || 1, obj.scale || 1, obj.scale || 1);
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
                        }
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

    // Добавление в сцену
    scene.add(groundInstances);
    scene.add(waterInstances);
    if (treeInstances) scene.add(treeInstances);
    if (houseInstances) scene.add(houseInstances);
    if (fenceInstances) scene.add(fenceInstances);

    // Bounding box для рейкаста и видимости
    const box = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    chunkBounds.push({ box, mesh: groundInstances, key });
    if (waterInstances) chunkBounds.push({ box, mesh: waterInstances, key });
    if (treeInstances) chunkBounds.push({ box, mesh: treeInstances, key });
    if (houseInstances) chunkBounds.push({ box, mesh: houseInstances, key });
    if (fenceInstances) chunkBounds.push({ box, mesh: fenceInstances, key });

    // Сохраняем в карту
    chunksMap.set(key, {
        ground: groundInstances,
        water: waterInstances,
        trees: treeInstances,
        houses: houseInstances,
        fences: fenceInstances,
        anomalyLODs: anomalyLODs,
        tilesData: tilesData,
        chunkX: cx,
        chunkY: cy,
        bounds: box.clone()
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

    if (entry.anomalyLODs) {
        entry.anomalyLODs.forEach(lod => scene.remove(lod));
    }

    entry.ground.geometry.dispose();
    entry.ground.material.dispose();
    entry.water.geometry.dispose();
    entry.water.material.dispose();

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

// --- Оптимизация видимости чанков на основе фрустума камеры + дальность ---
const MAX_RENDER_DISTANCE = 800; // максимальная дистанция отрисовки

function updateChunkVisibility() {
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));

    chunksMap.forEach((chunk) => {
        if (!chunk.bounds) return;

        // Проверка дистанции
        const center = chunk.bounds.getCenter(new THREE.Vector3());
        const dist = camera.position.distanceTo(center);
        if (dist > MAX_RENDER_DISTANCE) {
            // Слишком далеко – скрыть
            setVisible(chunk, false);
            return;
        }

        // Проверка пересечения с фрустумом
        const visible = frustum.intersectsBox(chunk.bounds);
        setVisible(chunk, visible);
    });
}

function setVisible(chunk, visible) {
    if (chunk.ground) chunk.ground.visible = visible;
    if (chunk.water) chunk.water.visible = visible;
    if (chunk.trees) chunk.trees.visible = visible;
    if (chunk.houses) chunk.houses.visible = visible;
    if (chunk.fences) chunk.fences.visible = visible;
    if (chunk.anomalyLODs) {
        chunk.anomalyLODs.forEach(lod => lod.visible = visible);
    }
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
                    entry.fences === mesh) {
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
    updateChunkVisibility();
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Функция для получения размеров объекта (для подсветки) ---
export function getObjectDimensions(type, anomalyType, scale = 1.0) {
    const base = getBaseDimensions(type, anomalyType);
    return {
        width: base.width * scale,
        height: base.height * scale,
        depth: base.depth * scale
    };
}

// --- Подсветка объекта (wireframe куб) ---
const highlightWireframeMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true, transparent: true, opacity: 0.8 });
const highlightWireframeGeometry = new THREE.BoxGeometry(1, 1, 1);
const highlightWireframe = new THREE.Mesh(highlightWireframeGeometry, highlightWireframeMaterial);
scene.add(highlightWireframe);
highlightWireframe.visible = false;

export function showObjectHighlight(x, y, z, dimensions) {
    highlightWireframe.position.set(x, y, z);
    highlightWireframe.scale.set(dimensions.width, dimensions.height, dimensions.depth);
    highlightWireframe.visible = true;
}

export function hideObjectHighlight() {
    highlightWireframe.visible = false;
}

export function getHoveredTile() {
    return hoveredTile;
}

// Заглушки для маркеров
export function addMarker(marker) { console.warn('addMarker not implemented'); }
export function moveMarker(markerId, x, y) { console.warn('moveMarker not implemented'); }
export function removeMarker(markerId) { console.warn('removeMarker not implemented'); }
export function loadMarkers(markers) { console.warn('loadMarkers not implemented'); }