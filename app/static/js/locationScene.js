import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let currentLocationId = null;
let characterSprites = new Map(); // character_id -> { sprite, x, y }

export function initLocationScene(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    // Очистить контейнер
    while (container.firstChild) container.removeChild(container.firstChild);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    // Установить камеру в зависимости от размера локации (будет обновлено после загрузки)
    camera.position.set(50, 60, 50);
    camera.lookAt(0, 0, 0);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0, 0);
    // Настройка кнопок мыши (как на глобальной карте)
    controls.mouseButtons = {
        LEFT: null,          // ЛКМ не используется для навигации
        MIDDLE: THREE.MOUSE.PAN,   // СКМ – панорамирование
        RIGHT: THREE.MOUSE.ROTATE  // ПКМ – вращение
    };
    // Освещение
    const ambientLight = new THREE.AmbientLight(0x404060);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);
    const fillLight = new THREE.PointLight(0x4466cc, 0.3);
    fillLight.position.set(0, 5, 0);
    scene.add(fillLight);
    animate();
}

function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
}

export function loadLocation(data) {
    if (!scene) return;
    // Удаляем старые объекты (кроме освещения)
    const toRemove = [];
    scene.children.forEach(child => {
        if (child.isMesh || child.isLineSegments || child.isSprite || (child.isGroup && child !== controls)) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => scene.remove(child));
    characterSprites.clear();

    const gridWidth = data.grid_width;
    const gridHeight = data.grid_height;
    const centerX = gridWidth / 2;
    const centerZ = gridHeight / 2;

    // Создаём сетку (GridHelper) с размерами gridWidth x gridHeight
    // Удаляем старый, если был
    const gridHelper = new THREE.GridHelper(gridWidth, gridHeight, 0x888888, 0x444444);
    gridHelper.position.set(centerX, -0.1, centerZ);
    scene.add(gridHelper);

    // Пол (прозрачная плоскость для raycasting, если нужно)
    const planeMat = new THREE.MeshStandardMaterial({ color: 0x3a6b3a, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
    const planeGeo = new THREE.PlaneGeometry(gridWidth, gridHeight);
    const groundPlane = new THREE.Mesh(planeGeo, planeMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.set(centerX, -0.05, centerZ);
    scene.add(groundPlane);

    // Настройка камеры и controls.target
    const distance = Math.max(gridWidth, gridHeight) * 0.8;
    camera.position.set(centerX, distance * 0.6, centerZ + distance);
    controls.target.set(centerX, 0, centerZ);
    controls.update();

    // Добавляем объекты из data.objects (если есть)
    if (data.objects && data.objects.length) {
        data.objects.forEach(obj => {
            const boxGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
            const mat = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
            const mesh = new THREE.Mesh(boxGeo, mat);
            mesh.position.set(obj.tile_x + 0.5, 0.4, obj.tile_y + 0.5);
            scene.add(mesh);
        });
    }
}

export function updateCharacterPosition(characterId, x, y) {
    const entry = characterSprites.get(characterId);
    if (entry) {
        entry.sprite.position.set(x + 0.5, 0.5, y + 0.5);
        entry.x = x;
        entry.y = y;
    } else {
        // Создать новый спрайт
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffaa44';
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI*2);
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

window.addEventListener('resize', resizeLocationScene);