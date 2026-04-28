import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let currentLocationId = null;
let characterSprites = new Map();
let animationId = null;

// ---- Инициализация сцены локации (вызывается при входе) ----
export function initLocationScene(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Останавливаем предыдущий анимационный цикл
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    // Уничтожаем старые ресурсы
    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer = null;
    }
    if (scene) {
        scene = null;
    }
    camera = null;
    controls = null;
    characterSprites.clear();

    // Очищаем контейнер
    while (container.firstChild) container.removeChild(container.firstChild);

    // Создаём новый рендерер
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // Новая сцена
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
    controls.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE
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

    // Запускаем анимацию
    function animate() {
        animationId = requestAnimationFrame(animate);
        if (controls) controls.update();
        if (renderer && scene && camera) renderer.render(scene, camera);
    }
    animate();
}

// ---- Загрузка данных локации и отрисовка тайлов ----
export function loadLocation(data) {
    if (!scene) return;

    // Удаляем всё, кроме источников света
    const toRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight) {
            toRemove.push(child);
        }
    });
    toRemove.forEach(child => {
        if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                else child.material.dispose();
            }
        }
        if (child.isSprite && child.material) {
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
        }
        scene.remove(child);
    });
    characterSprites.clear();

    const gridWidth = data.grid_width;
    const gridHeight = data.grid_height;
    const centerX = gridWidth / 2;
    const centerZ = gridHeight / 2;

    // Сетка
    const gridHelper = new THREE.GridHelper(gridWidth, gridHeight, 0x888888, 0x444444);
    gridHelper.position.set(centerX, -0.1, centerZ);
    scene.add(gridHelper);

    // Пол (полупрозрачная плоскость)
    const planeMat = new THREE.MeshStandardMaterial({ color: 0x3a6b3a, side: THREE.DoubleSide, transparent: true, opacity: 0.2 });
    const planeGeo = new THREE.PlaneGeometry(gridWidth, gridHeight);
    const groundPlane = new THREE.Mesh(planeGeo, planeMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.set(centerX, -0.05, centerZ);
    scene.add(groundPlane);

    // Тайлы и объекты на них
    if (data.tiles_data && data.tiles_data.length) {
        const terrainColors = {
            grass: 0x3a5f0b,
            sand: 0xC2B280,
            rock: 0x808080,
            swamp: 0x4B3B2A,
            water: 0x1E90FF
        };
        // Группировка по материалу для оптимизации
        const cubesByMaterial = new Map();
        for (let y = 0; y < data.tiles_data.length; y++) {
            const row = data.tiles_data[y];
            for (let x = 0; x < row.length; x++) {
                const tile = row[x];
                const terrain = tile.terrain || 'grass';
                const color = terrainColors[terrain] || 0x3a5f0b;
                const height = tile.height || 1.0;
                const key = `${color}_${height}`;
                if (!cubesByMaterial.has(key)) {
                    const material = new THREE.MeshStandardMaterial({ color: color });
                    const geometry = new THREE.BoxGeometry(0.98, height, 0.98);
                    cubesByMaterial.set(key, { material, geometry, positions: [] });
                }
                cubesByMaterial.get(key).positions.push({ x, y, height });
            }
        }
        for (const { material, geometry, positions } of cubesByMaterial.values()) {
            for (const pos of positions) {
                const cube = new THREE.Mesh(geometry, material);
                cube.position.set(pos.x + 0.5, pos.height / 2, pos.y + 0.5);
                scene.add(cube);
            }
        }

        // Отрисовка объектов на тайлах (деревья, камни и т.д.)
        for (let y = 0; y < data.tiles_data.length; y++) {
            const row = data.tiles_data[y];
            for (let x = 0; x < row.length; x++) {
                const tile = row[x];
                const objects = tile.objects || [];
                const tileHeight = tile.height || 1.0;
                for (const obj of objects) {
                    const type = obj.type;
                    let geometry, material, yOffset;
                if (type === 'tree') {
                    geometry = new THREE.CylinderGeometry(0.3, 0.5, 0.8, 6);
                    material = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
                    yOffset = 0.4;
                } else if (type === 'rock') {
                    geometry = new THREE.DodecahedronGeometry(0.3);
                    material = new THREE.MeshStandardMaterial({ color: 0x888888 });
                    yOffset = 0.15;
                } else if (type === 'house') {
                    geometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
                    material = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
                    yOffset = 0.35;
                } else if (type === 'tent') {
                    geometry = new THREE.CylinderGeometry(0.5, 0.7, 0.5, 4);
                    material = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
                    yOffset = 0.25;
                } else if (type === 'campfire') {
                    geometry = new THREE.CylinderGeometry(0.2, 0.3, 0.1, 6);
                    material = new THREE.MeshStandardMaterial({ color: 0xff6600 });
                    yOffset = 0.05;
                } else {
                    geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                    material = new THREE.MeshStandardMaterial({ color: 0xffaa44 });
                    yOffset = 0.25;
                }
                    const mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(x + 0.5, tileHeight + yOffset, y + 0.5);
                    scene.add(mesh);
                }
            }
        }
    }

    // Отдельные объекты (если используются, можно из LocationObject)
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
}

// ---- Полное уничтожение сцены локации (вызывается при выходе) ----
export function destroyLocationScene() {
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
        scene = null;
    }
    camera = null;
    controls = null;
    characterSprites.clear();
}

// ---- Кнопки управления локацией (GM) ----
export function addDeleteLocationButton(callback) {
    let btn = document.getElementById('delete-location-btn');
    if (btn) btn.remove(); // Удаляем существующую, чтобы не дублировать
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

// ---- Персонажи ----
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

// ---- Прочее ----
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