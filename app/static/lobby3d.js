// static/lobby3d.js
import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

const container = document.getElementById('canvas-container');
if (!container) {
  console.error('Canvas container not found!');
}

// Сцена, камера, рендерер
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111122);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(10, 10, 10);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; // для красоты
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Орбитальный контроль (чтобы крутить камеру)
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Освещение
const ambientLight = new THREE.AmbientLight(0x404060);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 7);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
scene.add(directionalLight);

// Пол (сетка)
const gridHelper = new THREE.GridHelper(20, 20, 0x88aaff, 0x335588);
scene.add(gridHelper);

// Земля (плоскость для теней, если нужны)
const planeGeometry = new THREE.PlaneGeometry(20, 20);
const planeMaterial = new THREE.MeshStandardMaterial({ color: 0x224466, side: THREE.DoubleSide });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
plane.rotation.x = Math.PI / 2;
plane.position.y = -0.01;
plane.receiveShadow = true;
scene.add(plane);

// Хранилище всех меток для быстрого доступа по id
const markersMap = new Map();

// Функция добавления метки
export function addMarker(marker) {
    // marker: { id, x, y, type }
    // Преобразуем координаты (предположим, x и y — целые числа от 0 до 9, как в 2D)
    // Но в 3D можно разместить их на плоскости: (x, 0, y)
    const geometry = new THREE.SphereGeometry(0.3, 16, 16);
    let color;
    if (marker.type === 'blue') color = 0x3366ff;
    else if (marker.type === 'green') color = 0x33cc33;
    else color = 0xff4433; // red по умолчанию

    const material = new THREE.MeshStandardMaterial({ color });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    sphere.position.set(marker.x, 0.3, marker.y); // приподнимем над полом

    // Сохраняем id в пользовательском свойстве, чтобы потом найти
    sphere.userData = { id: marker.id, type: marker.type };

    scene.add(sphere);
    markersMap.set(marker.id, sphere);
}

// Функция перемещения метки
export function moveMarker(markerId, x, y) {
    const sphere = markersMap.get(markerId);
    if (sphere) {
        sphere.position.set(x, 0.3, y);
    }
}

// Функция удаления метки
export function removeMarker(markerId) {
    const sphere = markersMap.get(markerId);
    if (sphere) {
        scene.remove(sphere);
        markersMap.delete(markerId);
    }
}

// Обработка ресайза окна
window.addEventListener('resize', onWindowResize, false);
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Анимационный цикл
function animate() {
    requestAnimationFrame(animate);
    controls.update(); // для плавности
    renderer.render(scene, camera);
}
animate();

// Экспортируем функцию для загрузки всех меток сразу
export function loadMarkers(markers) {
    // Очищаем старые
    markersMap.forEach((sphere) => scene.remove(sphere));
    markersMap.clear();
    markers.forEach(m => addMarker(m));
}