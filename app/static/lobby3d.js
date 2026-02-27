import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

const CHUNK_SIZE = 32;
export const chunksMap = new Map();

const MIN_CHUNK = 0;
const MAX_CHUNK = 31;

// --- Сцена ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111122);

// --- ОТЛАДКА: красный куб в центре (теперь в середине карты) ---
const centerCubeGeo = new THREE.BoxGeometry(5, 5, 5);
const centerCubeMat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const centerCube = new THREE.Mesh(centerCubeGeo, centerCubeMat);
centerCube.position.set(512, 2.5, 512); // центр карты (16*32 = 512)
scene.add(centerCube);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(520, 300, 520);
camera.lookAt(512, 0, 512);

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2;
controls.target.set(512, 0, 512); // центр вращения

// Освещение
const ambientLight = new THREE.AmbientLight(0x404060);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7);
directionalLight.castShadow = false;
scene.add(directionalLight);


const gridHelper = new THREE.GridHelper(1024, 64, 0x88aaff, 0x335588);
gridHelper.position.set(512, 0, 512);
gridHelper.visible = false;
scene.add(gridHelper);

// --- Интерактивность ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredTile = null;
let editMode = false;

let lastRaycast = 0;
const RAYCAST_INTERVAL = 10; // 20 FPS

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
    if (cx < MIN_CHUNK || cx > MAX_CHUNK || cy < MIN_CHUNK || cy > MAX_CHUNK) {
        console.warn(`Chunk (${cx},${cy}) out of bounds`);
        return;
    }

    const key = `${cx},${cy}`;
    if (chunksMap.has(key)) return;

    const size = tilesData.length;
    const totalTiles = size * size;

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0x44aa88 });
    material.polygonOffset = true;
    material.polygonOffsetFactor = 2;
    material.polygonOffsetUnits = 2;

    const instances = new THREE.InstancedMesh(geometry, material, totalTiles);
    instances.castShadow = false;
    instances.receiveShadow = false;

    const dummy = new THREE.Object3D();
    let index = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            const worldX = cx * size + x + 0.5;
            const worldZ = cy * size + y + 0.5;
            const height = tile.height || 1.0;
            dummy.position.set(worldX, height / 2, worldZ);
            dummy.scale.set(0.95, height, 0.95);
            dummy.updateMatrix();
            instances.setMatrixAt(index, dummy.matrix);

            minX = Math.min(minX, worldX - 0.5);
            maxX = Math.max(maxX, worldX + 0.5);
            minY = Math.min(minY, 0);
            maxY = Math.max(maxY, height);
            minZ = Math.min(minZ, worldZ - 0.5);
            maxZ = Math.max(maxZ, worldZ + 0.5);

            index++;
        }
    }
    instances.instanceMatrix.needsUpdate = true;

    instances.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    instances.boundingSphere = new THREE.Sphere(new THREE.Vector3((minX+maxX)/2, (minY+maxY)/2, (minZ+maxZ)/2), Math.max(maxX-minX, maxY-minY, maxZ-minZ)/2);

    chunksMap.set(key, {
        mesh: instances,
        tilesData: tilesData,
        chunkX: cx,
        chunkY: cy
    });

    scene.add(instances);
}

export function removeChunk(cx, cy) {
    const key = `${cx},${cy}`;
    const entry = chunksMap.get(key);
    if (entry) {
        scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
        chunksMap.delete(key);
    }
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

// --- Обработка наведения с throttle ---
function onMouseMove(event) {
    const now = Date.now();
    if (now - lastRaycast < RAYCAST_INTERVAL) return;
    lastRaycast = now;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const meshes = Array.from(chunksMap.values()).map(entry => entry.mesh);
    const intersects = raycaster.intersectObjects(meshes);

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
                if (entry.mesh === mesh) {
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

export function setEditMode(enabled) {
    editMode = enabled;
}

export function setTileClickCallback(callback) {
    window.tileClickCallback = callback;
}

window.addEventListener('click', (event) => {
    if (event.target.closest('.ui-overlay')) return;
    if (editMode && hoveredTile && window.tileClickCallback) {
        window.tileClickCallback({
            chunkX: hoveredTile.chunk.chunkX,
            chunkY: hoveredTile.chunk.chunkY,
            tileX: hoveredTile.tileX,
            tileY: hoveredTile.tileY,
            tileData: hoveredTile.tileData
        });
    }
});

// --- Анимация ---
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

// --- Заглушки для маркеров ---
export function addMarker(marker) { console.warn('addMarker not implemented'); }
export function moveMarker(markerId, x, y) { console.warn('moveMarker not implemented'); }
export function removeMarker(markerId) { console.warn('removeMarker not implemented'); }
export function loadMarkers(markers) { console.warn('loadMarkers not implemented'); }