import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { updateRain } from './weather.js';
import { createAnomalyEffect, animateAnomalyEffects } from './anomalies.js';
import { createFpsCounter } from './fpsCounter.js';
import {
    createCompatibleWebGLRenderer,
    createUnavailableRenderer,
    showWebGLUnavailable,
} from './webglSupport.js';

const CHUNK_SIZE = 32;
export const chunksMap = new Map();

let lastMouseX = 0, lastMouseY = 0;
let lastModifiers = { alt: false, shift: false };
const globalCameraKeys = new Set();
let lastChunkVisibilityAt = -Infinity;
let lastHoverRaycastAt = -Infinity;
const CHUNK_VISIBILITY_REFRESH_MS = 500;
const HOVER_RAYCAST_REFRESH_MS = 250;
const MOVING_CAMERA_RAYCAST_REFRESH_MS = 100;
const SHADOW_REFRESH_MS = 250;
let cameraDragActive = false;
let hoverRaycastPending = false;
let worldShadowsDirty = false;
let lastWorldShadowAt = -Infinity;
let shadowRefreshesSinceSample = 0;
let worldPerfSampleAt = performance.now();
let worldFrameWorkMs = 0;
let worldSampleFrames = 0;

let postRenderCallbacks = [];

const MIN_CHUNK = 0;
let MAX_CHUNK_X = 15;
let MAX_CHUNK_Y = 15;

const chunkBounds = [];
const worldBrushPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1);

const terrainColors = {
    grass: 0x3a5f0b,
    sand: 0xC2B280,
    rock: 0x808080,
    swamp: 0x4B3B2A,
    water: 0x1E90FF
};

const treeGeo = new THREE.ConeGeometry(0.3, 1, 8);
const houseGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
const fenceGeo = new THREE.BoxGeometry(0.2, 0.5, 0.8);
function landmarkGeometry(parts) {
    const vertices = [];
    const normals = [];
    const vertex = new THREE.Vector3();
    const normal = new THREE.Vector3();
    for (const [geometry, x, y, z, sx = 1, sy = 1, sz = 1, rotation = 0] of parts) {
        const flat = geometry.index ? geometry.toNonIndexed() : geometry;
        const transform = new THREE.Matrix4().compose(
            new THREE.Vector3(x, y, z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
            new THREE.Vector3(sx, sy, sz),
        );
        const normalTransform = new THREE.Matrix3().getNormalMatrix(transform);
        const positions = flat.getAttribute('position');
        const sourceNormals = flat.getAttribute('normal');
        for (let index = 0; index < positions.count; index++) {
            vertex.fromBufferAttribute(positions, index).applyMatrix4(transform);
            normal.fromBufferAttribute(sourceNormals, index).applyMatrix3(normalTransform).normalize();
            vertices.push(vertex.x, vertex.y, vertex.z);
            normals.push(normal.x, normal.y, normal.z);
        }
        if (flat !== geometry) flat.dispose();
        geometry.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return merged;
}

const WORLD_LANDMARKS = {
    forest: { geometry: landmarkGeometry([
        [new THREE.ConeGeometry(0.26, 1.0, 6), -0.23, 0.19, 0.02],
        [new THREE.ConeGeometry(0.29, 1.18, 7), 0.16, 0.28, -0.16],
        [new THREE.ConeGeometry(0.23, 0.86, 6), 0.22, 0.12, 0.24],
    ]), width: 1.05, height: 1.5, depth: 1.05, color: '#244832' },
    hamlet: { geometry: landmarkGeometry([
        [new THREE.BoxGeometry(0.55, 0.28, 0.45), 0, -0.12, 0],
        [new THREE.ConeGeometry(0.42, 0.25, 4), 0, 0.13, 0, 1, 1, 1, Math.PI / 4],
    ]), width: 0.75, height: 0.52, depth: 0.75, color: '#aa8665' },
    village: { geometry: landmarkGeometry([
        [new THREE.BoxGeometry(0.35, 0.24, 0.3), -0.23, -0.13, -0.22],
        [new THREE.ConeGeometry(0.27, 0.2, 4), -0.23, 0.08, -0.22, 1, 1, 1, Math.PI / 4],
        [new THREE.BoxGeometry(0.38, 0.28, 0.32), 0.23, -0.11, -0.1],
        [new THREE.ConeGeometry(0.3, 0.22, 4), 0.23, 0.13, -0.1, 1, 1, 1, Math.PI / 4],
        [new THREE.BoxGeometry(0.32, 0.23, 0.28), 0, -0.15, 0.27],
        [new THREE.ConeGeometry(0.25, 0.2, 4), 0, 0.05, 0.27, 1, 1, 1, Math.PI / 4],
    ]), width: 1.05, height: 0.53, depth: 1.05, color: '#b39474' },
    road: { geometry: new THREE.BoxGeometry(0.92, 0.035, 0.25), width: 0.92, height: 0.035, depth: 0.25, color: '#756f61' },
    factory: { geometry: landmarkGeometry([
        [new THREE.BoxGeometry(0.75, 0.42, 0.58), 0, -0.17, 0],
        [new THREE.CylinderGeometry(0.075, 0.085, 0.48, 6), -0.22, 0.27, -0.12],
        [new THREE.CylinderGeometry(0.06, 0.07, 0.34, 6), 0.21, 0.2, -0.12],
    ]), width: 0.8, height: 0.85, depth: 0.58, color: '#66747b' },
    base: { geometry: landmarkGeometry([
        [new THREE.CylinderGeometry(0.45, 0.5, 0.23, 8), 0, -0.13, 0],
        [new THREE.CylinderGeometry(0.16, 0.2, 0.39, 6), 0, 0.13, 0],
        [new THREE.ConeGeometry(0.24, 0.16, 6), 0, 0.4, 0],
    ]), width: 1, height: 0.75, depth: 1, color: '#6c765d' },
    camp: { geometry: landmarkGeometry([
        [new THREE.ConeGeometry(0.33, 0.43, 4), -0.17, 0, -0.1, 1, 1, 1, Math.PI / 4],
        [new THREE.ConeGeometry(0.25, 0.33, 4), 0.22, -0.05, 0.18, 1, 1, 1, Math.PI / 4],
    ]), width: 1, height: 0.5, depth: 0.85, color: '#9c8362' },
};
const WORLD_LANDMARK_TYPES = Object.keys(WORLD_LANDMARKS);
const landmarkMat = new THREE.MeshStandardMaterial();

const treeMat = new THREE.MeshStandardMaterial();
const houseMat = new THREE.MeshStandardMaterial();
const fenceMat = new THREE.MeshStandardMaterial();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510);
scene.fog = new THREE.FogExp2(0x050510, 0.0015);

window.isLocationActive = false;

function createCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    let seed = 34171;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const puff = (x, y, radiusX, radiusY, opacity) => {
        for (const offset of [-canvas.width, 0, canvas.width]) {
            const wrappedX = x + offset;
            if (wrappedX + radiusX < 0 || wrappedX - radiusX > canvas.width) continue;
            ctx.save();
            ctx.translate(wrappedX, y);
            ctx.scale(1, radiusY / radiusX);
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
            gradient.addColorStop(0, `rgba(255,255,255,${opacity})`);
            gradient.addColorStop(0.45, `rgba(255,255,255,${opacity * 0.7})`);
            gradient.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    };
    for (let i = 0; i < 65; i++) {
        const x = random() * canvas.width;
        const y = 20 + random() * (canvas.height - 40);
        const width = 75 + random() * 90;
        puff(x, y, width, 12 + random() * 19, 0.18);
        for (let j = 0; j < 5; j++) {
            const offset = (j - 2) * width * 0.28;
            puff(x + offset, y - random() * 12, width * (0.32 + random() * 0.22),
                15 + random() * 19, 0.23 + random() * 0.12);
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(3, 1); // небольшое повторение для сглаживания шва
    return texture;
}

// Создаём текстуру один раз
const cloudTexture = createCloudTexture();

// Единое небо: время плавно смешивает день и ночь, облачность меняет покрытие.
const worldSkySphere = (() => {
    const geometry = new THREE.SphereGeometry(980, 64, 40);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            cloudTexture: { value: cloudTexture },
            dayTopColor: { value: new THREE.Color(0x5c9db8) },
            dayBottomColor: { value: new THREE.Color(0xd5d5bd) },
            nightTopColor: { value: new THREE.Color(0x08111d) },
            nightBottomColor: { value: new THREE.Color(0x263646) },
            daylight: { value: 1 },
            clarity: { value: 1 },
            starlight: { value: 0 },
            starRotation: { value: 0 }
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vPosition;
            void main() {
                vUv = uv;
                vPosition = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D cloudTexture;
            uniform vec3 dayTopColor;
            uniform vec3 dayBottomColor;
            uniform vec3 nightTopColor;
            uniform vec3 nightBottomColor;
            uniform float daylight;
            uniform float clarity;
            uniform float starlight;
            uniform float starRotation;
            varying vec2 vUv;
            varying vec3 vPosition;

            void main() {
                vec3 direction = normalize(vPosition);
                float h = smoothstep(-0.08, 0.8, direction.y);
                vec3 dayColor = mix(dayBottomColor, dayTopColor, h);
                vec3 nightColor = mix(nightBottomColor, nightTopColor, h);
                vec3 skyColor = mix(nightColor, dayColor, daylight);
                float cloudPattern = smoothstep(0.04, 0.38, texture2D(cloudTexture, vUv).a);
                float cloudCover = mix(0.82 + cloudPattern * 0.18, cloudPattern * 0.5, clarity);
                vec3 cloudColor = mix(vec3(0.09, 0.11, 0.14), vec3(0.52, 0.56, 0.59), daylight);
                cloudColor += vec3(0.1, 0.1, 0.09) * daylight * cloudPattern;
                vec3 finalColor = mix(skyColor, cloudColor, cloudCover);
                vec3 rotatedStars = vec3(
                    direction.x * cos(starRotation) + direction.y * sin(starRotation),
                    direction.y * cos(starRotation) - direction.x * sin(starRotation),
                    direction.z
                );
                vec2 skyUv = vec2(
                    atan(rotatedStars.z, rotatedStars.x) / 6.2831853 + 0.5,
                    asin(rotatedStars.y) / 3.14159265 + 0.5
                );
                vec2 starGrid = skyUv * vec2(180.0, 90.0);
                vec2 starCell = floor(starGrid);
                float starSeed = fract(sin(dot(starCell, vec2(12.9898, 78.233))) * 43758.5453);
                float starShape = 1.0 - smoothstep(0.04, 0.16, length(fract(starGrid) - 0.5));
                float star = step(0.975, starSeed) * starShape * starlight * clarity * (1.0 - cloudCover);
                finalColor += vec3(0.9, 0.95, 1.0) * star;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        side: THREE.BackSide
    });
    return new THREE.Mesh(geometry, material);
})();

// Звёзды (только для ночи)
let stars = null;
function createStars() {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    for (let i = 0; i < 1900; i++) {
        const azimuth = Math.random() * Math.PI * 2;
        // The world camera looks down, so its visible horizon is below the camera.
        const elevation = -0.75 + Math.random() * 1.35;
        const horizontal = Math.sqrt(1 - elevation * elevation) * 900;
        vertices.push(
            Math.cos(azimuth) * horizontal,
            elevation * 900,
            Math.sin(azimuth) * horizontal,
        );
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const material = new THREE.PointsMaterial({
        color: 0xe5eef5, size: 2.6, sizeAttenuation: false, depthWrite: false,
        fog: false, transparent: true, opacity: 0,
    });
    stars = new THREE.Points(geometry, material);
    stars.renderOrder = 1;
    scene.add(stars);
}

scene.add(worldSkySphere);
createStars();

const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(10, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe6a0, fog: false, depthWrite: false, transparent: true }),
);
const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(8, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xd9e5f2, fog: false, depthWrite: false, transparent: true }),
);
sunDisc.renderOrder = 2;
moonDisc.renderOrder = 2;
worldSkySphere.add(sunDisc);
worldSkySphere.add(moonDisc);

let celestialMinutes = 480;
const MIN_WORLD_SHADOW_LIGHT_Y = 0.8;

function updateCelestialPositions() {
    const angle = celestialMinutes >= 360 && celestialMinutes < 1200
        ? (celestialMinutes - 360) * Math.PI / 840
        : Math.PI + ((celestialMinutes + (celestialMinutes < 360 ? 1440 : 0)) - 1200) * Math.PI / 600;
    const sunDirection = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.22).normalize();
    const moonDirection = sunDirection.clone().negate();
    sunDisc.position.copy(sunDirection).multiplyScalar(920);
    moonDisc.position.copy(moonDirection).multiplyScalar(920);
    sunDisc.visible = sunDirection.y > 0.02;
    moonDisc.visible = moonDirection.y > 0.02;
    worldSkySphere.material.uniforms.starRotation.value = angle;
    stars.rotation.z = angle;

    const celestialLightDirection = sunDirection.y > 0 ? sunDirection : moonDirection;
    // Keep the visible sun low at dawn/dusk without stretching terrain shadows across several tiles.
    const lightDirection = new THREE.Vector3(
        celestialLightDirection.x,
        Math.max(celestialLightDirection.y, MIN_WORLD_SHADOW_LIGHT_Y),
        celestialLightDirection.z,
    ).normalize();
    const centerX = (MAX_CHUNK_X + 1) * CHUNK_SIZE / 2;
    const centerZ = (MAX_CHUNK_Y + 1) * CHUNK_SIZE / 2;
    directionalLight.target.position.set(centerX, 0, centerZ);
    directionalLight.position.set(
        centerX + lightDirection.x * 500,
        lightDirection.y * 500,
        centerZ + lightDirection.z * 500,
    );
    directionalLight.target.updateMatrixWorld();
    markWorldShadowsDirty();
}

export function setCelestialTime(minutes) {
    celestialMinutes = ((Math.trunc(Number(minutes) || 0) % 1440) + 1440) % 1440;
    updateCelestialPositions();
}

export function setSkyConditions(daylight, clarity, starlight) {
    const day = THREE.MathUtils.clamp(Number(daylight) || 0, 0, 1);
    const clear = THREE.MathUtils.clamp(Number(clarity) || 0, 0, 1);
    const visibleStars = THREE.MathUtils.clamp(Number(starlight) || 0, 0, 1);
    worldSkySphere.material.uniforms.daylight.value = day;
    worldSkySphere.material.uniforms.clarity.value = clear;
    worldSkySphere.material.uniforms.starlight.value = visibleStars;
    stars.material.opacity = visibleStars * clear;
    stars.visible = stars.material.opacity > 0.01;
    sunDisc.material.opacity = (0.06 + 0.94 * clear) * (0.35 + 0.65 * day);
    moonDisc.material.opacity = (0.04 + 0.88 * clear) * (1 - day * 0.7);
    scene.background.copy(new THREE.Color(0x101b29).lerp(new THREE.Color(0x8199a0), day * (0.65 + 0.35 * clear)));
}

// ===== Конец неба =====

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(256, 300, 256);
camera.lookAt(256, 0, 256);

const renderer = createCompatibleWebGLRenderer(THREE, {
    antialias: true,
    logarithmicDepthBuffer: true,
}) || createUnavailableRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = !renderer.isUnavailableRenderer;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
if (!renderer.isUnavailableRenderer) {
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
}
const globalCanvasContainer = document.getElementById('canvas-container');
globalCanvasContainer.appendChild(renderer.domElement);
const worldFpsCounter = createFpsCounter(globalCanvasContainer, 'Карта');
if (renderer.isUnavailableRenderer) {
    window.webGLUnavailable = true;
    showWebGLUnavailable(globalCanvasContainer);
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePointerCapture = false;
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2;
controls.target.set(256, 0, 256);

controls.mouseButtons = {
    LEFT: null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE
};

function markWorldShadowsDirty() {
    if (!renderer.isUnavailableRenderer) worldShadowsDirty = true;
}

function refreshWorldShadows(now, cameraMoved) {
    if (!worldShadowsDirty || renderer.isUnavailableRenderer) return;
    if (cameraMoved && now - lastWorldShadowAt < SHADOW_REFRESH_MS) return;
    renderer.shadowMap.needsUpdate = true;
    worldShadowsDirty = false;
    lastWorldShadowAt = now;
    shadowRefreshesSinceSample += 1;
}

let isMouseDown = false;
let lastProcessedTileKey = null;
let controlsDisabled = false;
let brushActive = false;
let globalMouseUpHandler = null;

// --- Освещение и тени ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(256, 300, 256);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 4096;
directionalLight.shadow.mapSize.height = 4096;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 1000;
directionalLight.shadow.camera.left = -400;
directionalLight.shadow.camera.right = 400;
directionalLight.shadow.camera.top = 400;
directionalLight.shadow.camera.bottom = -400;
directionalLight.shadow.bias = 0;
directionalLight.shadow.normalBias = 0;
scene.add(directionalLight);
scene.add(directionalLight.target);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
fillLight.position.set(-50, 50, -50);
scene.add(fillLight);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredTile = null;
let editMode = false;
let currentBrushRadius = 0;

const highlightBoxGeo = new THREE.BoxGeometry(1.1, 0.1, 1.1);
const highlightBoxMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 });
const highlightBox = new THREE.Mesh(highlightBoxGeo, highlightBoxMat);
highlightBox.position.set(0, 0.05, 0);
scene.add(highlightBox);
highlightBox.visible = false;

const tileInfoDiv = document.getElementById('tile-info');
const tileInfoContent = document.getElementById('tile-info-content');

// ---- Preview object ----
let previewObject = null;

function getGeometryForType(type) {
    if (WORLD_LANDMARKS[type]) return WORLD_LANDMARKS[type].geometry;
    switch(type) {
        case 'tree': return treeGeo;
        case 'house': return houseGeo;
        case 'fence': return fenceGeo;
        default: return new THREE.BoxGeometry(0.5, 0.5, 0.5);
    }
}

function createAnomalyPreview(x, y, z, type, color, scale) {
    const geo = new THREE.SphereGeometry(0.3, 8);
    const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(scale, scale, scale);
    return mesh;
}

export function createPreviewObject(tile, params) {
    if (previewObject) scene.remove(previewObject);

    const { type, anomalyType, color, offsetX, offsetZ, scale, rotation } = params;
    const worldX = tile.chunkX * CHUNK_SIZE + tile.tileX + 0.5 + offsetX;
    const worldZ = tile.chunkY * CHUNK_SIZE + tile.tileY + 0.5 + offsetZ;
    const height = tile.tileData.height || 1.0;
    const baseHalf = getBaseGroundOffset(type, anomalyType);
    const yPos = height + baseHalf * scale;

    let obj;
    if (type === 'anomaly') {
        obj = createAnomalyPreview(worldX, yPos, worldZ, anomalyType, color, scale);
    } else {
        const geo = getGeometryForType(type);
        const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.5 });
        obj = new THREE.Mesh(geo, mat);
        obj.position.set(worldX, yPos, worldZ);
        obj.scale.set(scale, scale, scale);
        obj.rotation.y = THREE.MathUtils.degToRad(rotation);
    }
    scene.add(obj);
    previewObject = obj;
}

export function updatePreviewObject(params) {
    if (!previewObject) return;
    const currentTile = window.currentEditTile;
    if (currentTile) {
        createPreviewObject(currentTile, params);
    }
}

export function removePreviewObject() {
    if (previewObject) {
        scene.remove(previewObject);
        previewObject = null;
    }
}
// ---- End Preview object ----

export function setMapDimensions(widthChunks, heightChunks) {
    MAX_CHUNK_X = widthChunks - 1;
    MAX_CHUNK_Y = heightChunks - 1;
    updateCelestialPositions();
    console.log(`Map dimensions set: ${widthChunks} x ${heightChunks} chunks`);
}

function getBaseDimensions(type, anomalyType) {
    const base = { width: 0.6, height: 0.6, depth: 0.6 };
    if (WORLD_LANDMARKS[type]) {
        const { width, height, depth } = WORLD_LANDMARKS[type];
        return { width, height, depth };
    }
    if (type === 'tree') {
        base.width = 0.6;
        base.height = 1.0;
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
                base.width = 1.0;
                base.height = 0.1;
                base.depth = 1.0;
                break;
            default:
                base.width = 0.6;
                base.height = 0.6;
                base.depth = 0.6;
                break;
        }
    }
    return base;
}

function getBaseHalfHeight(type, anomalyType) {
    const dims = getBaseDimensions(type, anomalyType);
    return dims.height / 2;
}

function getBaseGroundOffset(type, anomalyType) {
    const landmark = WORLD_LANDMARKS[type];
    if (!landmark) return getBaseHalfHeight(type, anomalyType);
    if (!landmark.geometry.boundingBox) landmark.geometry.computeBoundingBox();
    return -landmark.geometry.boundingBox.min.y;
}

export function getObjectHalfHeight(type, anomalyType) {
    return getBaseHalfHeight(type, anomalyType);
}

export function getObjectHeightOffset(type, anomalyType) {
    return getBaseGroundOffset(type, anomalyType);
}

function getDefaultColorForType(type) {
    if (WORLD_LANDMARKS[type]) return WORLD_LANDMARKS[type].color;
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

// --- Аномалии ---
function createElectricAnomaly(color) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);
    const coreGeo = new THREE.SphereGeometry(0.2, 8);
    const coreMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, transparent: true, opacity: 0.7 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

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
    const particleMat = new THREE.PointsMaterial({ size: 0.05, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, map: createSparkTexture() });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);

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
    const coreGeo = new THREE.SphereGeometry(0.2, 6);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xff5500, emissive: 0xff2200, transparent: true, opacity: 0.8 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

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
    const particleMat = new THREE.PointsMaterial({ size: 0.1, color: 0xffaa00, blending: THREE.AdditiveBlending, map: createFireTexture() });
    const particles = new THREE.Points(particleGeo, particleMat);
    group.add(particles);
    return group;
}

function createAcidAnomaly(color) {
    const group = new THREE.Group();
    const col = new THREE.Color(color);
    const puddleGeo = new THREE.CircleGeometry(0.5, 8);
    const puddleMat = new THREE.MeshStandardMaterial({ color: col, emissive: col.clone().multiplyScalar(0.3), transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const puddle = new THREE.Mesh(puddleGeo, puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.y = 0.05;
    group.add(puddle);

    const bubbleCount = 5;
    for (let i = 0; i < bubbleCount; i++) {
        const bubbleGeo = new THREE.SphereGeometry(0.05, 4);
        const bubbleMat = new THREE.MeshStandardMaterial({ color: 0x88ff88, emissive: 0x224422, transparent: true, opacity: 0.5 });
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
    const geo = new THREE.SphereGeometry(0.3, 16);
    const noiseTex = createNoiseTexture();
    const mat = new THREE.MeshPhongMaterial({ map: noiseTex, color: col, emissive: col.clone().multiplyScalar(0.5), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const sphere = new THREE.Mesh(geo, mat);
    group.add(sphere);

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
    const pointMat = new THREE.PointsMaterial({ size: 0.05, color: 0xffffff, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(pointGeo, pointMat);
    group.add(points);
    return group;
}

function createAnomalyLOD(x, y, z, type = 'electric', baseColor = '#00ffff', scale = 1.0) {
    const lod = new THREE.LOD();
    const color = new THREE.Color(baseColor);

    const nearGroup = createAnomalyEffect(type, color, scale);
    nearGroup.position.set(0, 0, 0);
    lod.addLevel(nearGroup, 0);

    lod.position.set(x, y, z);
    lod.userData.farColor = color;
    lod.userData.farScale = scale;
    lod.userData.cullRadius = Math.max(1, 4 * scale);
    return lod;
}

function createAnomalyFieldLOD(tile, x, z) {
    const field = tile.anomaly_field;
    if (!field?.name) return null;
    const type = String(field.field_type || '').toLowerCase();
    const visual = type.includes('электр') ? ['electric', '#7fd6f3']
        : type.includes('термич') ? ['fire', '#e69967']
            : type.includes('химич') ? ['acid', '#9ecb80']
                : type.includes('радио') ? ['radiation', '#bbd565']
                    : type.includes('пси') ? ['psi', '#8eace4']
                        : ['void', '#c3a4d5'];
    const rank = Math.max(1, Math.min(4, Number(field.rank) || 1));
    const lod = createAnomalyLOD(
        x, (tile.height || 1) + 0.12, z, visual[0], visual[1], 0.55 + rank * 0.12,
    );
    lod.userData.anomalyField = field.name;
    return lod;
}

const FAR_ANOMALY_DISTANCE_SQ = 200 * 200;
const farAnomalyGeo = new THREE.SphereGeometry(0.2, 4);
const farAnomalyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const visibleNearAnomalies = [];

function createFarAnomalyInstances(lods) {
    if (!lods.length) return null;
    const mesh = new THREE.InstancedMesh(farAnomalyGeo, farAnomalyMat, lods.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lods.length * 3), 3);
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
    return mesh;
}

function disposeChunkAnomalyLODs(lods) {
    (lods || []).forEach(lod => {
        scene.remove(lod);
        lod.traverse(node => {
            node.geometry?.dispose();
            const materials = Array.isArray(node.material) ? node.material : [node.material];
            materials.forEach(material => {
                material?.map?.dispose();
                material?.dispose();
            });
        });
    });
}

function updateFarAnomalyInstances(chunk, visible) {
    if (!chunk.anomalyLODs?.length) return;
    if (!visible) {
        chunk.anomalyLODs.forEach(lod => lod.visible = false);
        if (chunk.farAnomalies) chunk.farAnomalies.visible = false;
        return;
    }
    const far = [];
    for (const lod of chunk.anomalyLODs) {
        anomalyVisibilitySphere.center.copy(lod.position);
        anomalyVisibilitySphere.radius = lod.userData.cullRadius;
        if (!chunkFrustum.intersectsSphere(anomalyVisibilitySphere)) {
            lod.visible = false;
            continue;
        }
        const distant = lod.position.distanceToSquared(camera.position) >= FAR_ANOMALY_DISTANCE_SQ;
        lod.visible = !distant;
        if (distant) far.push(lod);
        else visibleNearAnomalies.push(lod);
    }
    const mesh = chunk.farAnomalies;
    if (!mesh) return;
    const previous = chunk.farAnomalyActive || [];
    const changed = far.length !== previous.length || far.some((lod, index) => lod !== previous[index]);
    if (changed) {
        const dummy = new THREE.Object3D();
        far.forEach((lod, index) => {
            dummy.position.copy(lod.position);
            dummy.scale.setScalar(lod.userData.farScale);
            dummy.updateMatrix();
            mesh.setMatrixAt(index, dummy.matrix);
            mesh.setColorAt(index, lod.userData.farColor);
        });
        mesh.count = far.length;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        chunk.farAnomalyActive = far;
    }
    mesh.visible = mesh.count > 0;
}

function animateChunkAnomalies(time) {
    animateAnomalyEffects(visibleNearAnomalies, time);
}

function createWaterTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const u = x / size * Math.PI * 2;
            const v = y / size * Math.PI * 2;
            const waves = Math.sin(u * 4 + Math.sin(v * 2) * 0.7)
                + 0.55 * Math.sin(v * 7 - u * 2)
                + 0.25 * Math.sin((u + v) * 11);
            const shade = Math.round(waves * 8);
            const index = (y * size + x) * 4;
            image.data[index] = 36 + shade;
            image.data[index + 1] = 92 + shade;
            image.data[index + 2] = 110 + shade;
            image.data[index + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.encoding = THREE.sRGBEncoding;
    return texture;
}

const waterTexture = createWaterTexture();
const waterMat = new THREE.MeshStandardMaterial({
    map: waterTexture,
    color: 0xc9e1e3,
    roughness: 0.38,
    metalness: 0.08,
    emissive: 0x07121a,
    transparent: false,
    opacity: 1.0
});
const groundGeo = new THREE.BoxGeometry(1, 1, 1);
const groundMat = new THREE.MeshStandardMaterial();

function fillChunkTerrainInstances(ground, water, tilesData, chunkX, chunkY, visible = true) {
    const size = tilesData.length;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const groundIndices = new Int16Array(size * size).fill(-1);
    const waterIndices = new Int16Array(size * size).fill(-1);
    let landCount = 0;
    let waterCount = 0;

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            const tileIndex = y * size + x;
            const height = tile.height || 1.0;
            dummy.position.set(chunkX * size + x + 0.5, height / 2, chunkY * size + y + 0.5);
            if (tile.terrain === 'water') {
                dummy.scale.set(1, height, 1);
                dummy.updateMatrix();
                waterIndices[tileIndex] = waterCount;
                water.setMatrixAt(waterCount++, dummy.matrix);
            } else {
                dummy.scale.set(1, height, 1);
                dummy.updateMatrix();
                groundIndices[tileIndex] = landCount;
                ground.setMatrixAt(landCount, dummy.matrix);
                color.setHex(terrainColors[tile.terrain] || 0x3a5f0b);
                ground.setColorAt(landCount++, color);
            }
        }
    }

    ground.count = landCount;
    water.count = waterCount;
    ground.visible = visible && landCount > 0;
    water.visible = visible && waterCount > 0;
    ground.instanceMatrix.needsUpdate = landCount > 0;
    ground.instanceColor.needsUpdate = landCount > 0;
    water.instanceMatrix.needsUpdate = waterCount > 0;
    return { groundIndices, waterIndices };
}

// --- Функции для чанков ---
function createLandmarkMeshes(tilesData) {
    const counts = Object.fromEntries(WORLD_LANDMARK_TYPES.map(type => [type, 0]));
    for (const row of tilesData) {
        for (const tile of row) {
            for (const object of tile.objects || []) {
                if (counts[object.type] !== undefined) counts[object.type]++;
            }
        }
    }
    return Object.fromEntries(WORLD_LANDMARK_TYPES.map(type => {
        const count = counts[type];
        if (!count) return [type, null];
        const mesh = new THREE.InstancedMesh(WORLD_LANDMARKS[type].geometry, landmarkMat, count);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
        mesh.castShadow = type !== 'road';
        mesh.receiveShadow = false;
        return [type, mesh];
    }));
}

function fillLandmarkMeshes(meshes, tilesData, cx, cy) {
    const size = tilesData.length;
    const indices = Object.fromEntries(WORLD_LANDMARK_TYPES.map(type => [
        type, Array.from({ length: size * size }, () => []),
    ]));
    const nextIndex = Object.fromEntries(WORLD_LANDMARK_TYPES.map(type => [type, 0]));
    const dummy = new THREE.Object3D();
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            for (const object of tile.objects || []) {
                const mesh = meshes[object.type];
                if (!mesh) continue;
                const scale = object.scale || 1;
                dummy.position.set(
                    cx * size + x + 0.5 + (object.x || 0),
                    (tile.height || 1) + getBaseGroundOffset(object.type) * scale,
                    cy * size + y + 0.5 + (object.z || 0),
                );
                dummy.rotation.set(0, THREE.MathUtils.degToRad(object.rotation || 0), 0);
                dummy.scale.setScalar(scale);
                dummy.updateMatrix();
                const index = nextIndex[object.type]++;
                mesh.setMatrixAt(index, dummy.matrix);
                mesh.setColorAt(index, new THREE.Color(object.color || getDefaultColorForType(object.type)));
                indices[object.type][y * size + x].push(index);
            }
        }
    }
    for (const mesh of Object.values(meshes)) {
        if (!mesh) continue;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        scene.add(mesh);
    }
    return indices;
}

export function addChunk(cx, cy, tilesData) {
    if (cx < MIN_CHUNK || cx > MAX_CHUNK_X || cy < MIN_CHUNK || cy > MAX_CHUNK_Y) return;

    const key = `${cx},${cy}`;
    if (chunksMap.has(key)) return;

    const size = tilesData.length;
    const totalTiles = size * size;

    const groundInstances = new THREE.InstancedMesh(groundGeo, groundMat, totalTiles);
    groundInstances.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(totalTiles * 3), 3);

    const waterInstances = new THREE.InstancedMesh(groundGeo, waterMat, totalTiles);

    groundInstances.castShadow = false;
    groundInstances.receiveShadow = true;
    groundInstances.frustumCulled = false;
    waterInstances.castShadow = false;
    waterInstances.receiveShadow = false;
    waterInstances.frustumCulled = false;

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

    let treeIdx = 0, houseIdx = 0, fenceIdx = 0;
    const anomalyLODs = [];

    const objectIndices = {
        trees: new Array(size * size).fill().map(() => []),
        houses: new Array(size * size).fill().map(() => []),
        fences: new Array(size * size).fill().map(() => [])
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            const worldX = cx * size + x + 0.5;
            const worldZ = cy * size + y + 0.5;
            const height = tile.height || 1.0;
            const tileIndex = y * size + x;

            minX = Math.min(minX, worldX - 0.5);
            maxX = Math.max(maxX, worldX + 0.5);
            maxY = Math.max(maxY, height + 0.5);
            minZ = Math.min(minZ, worldZ - 0.5);
            maxZ = Math.max(maxZ, worldZ + 0.5);

            const fieldLOD = createAnomalyFieldLOD(tile, worldX, worldZ);
            if (fieldLOD) {
                scene.add(fieldLOD);
                anomalyLODs.push(fieldLOD);
            }

            if (tile.objects) {
                tile.objects.forEach(obj => {
                    if (obj.type !== 'anomaly') {
                        const baseHalf = getBaseGroundOffset(obj.type);
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
                            objectIndices.trees[tileIndex].push(treeIdx);
                            treeIdx++;
                        } else if (obj.type === 'house' && houseInstances) {
                            houseInstances.setMatrixAt(houseIdx, dummy.matrix);
                            houseInstances.setColorAt(houseIdx, objColor);
                            objectIndices.houses[tileIndex].push(houseIdx);
                            houseIdx++;
                        } else if (obj.type === 'fence' && fenceInstances) {
                            fenceInstances.setMatrixAt(fenceIdx, dummy.matrix);
                            fenceInstances.setColorAt(fenceIdx, objColor);
                            objectIndices.fences[tileIndex].push(fenceIdx);
                            fenceIdx++;
                        }
                    }
                });
            }
        }
    }

    const terrainIndices = fillChunkTerrainInstances(groundInstances, waterInstances, tilesData, cx, cy);

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

    scene.add(groundInstances);
    scene.add(waterInstances);
    if (treeInstances) scene.add(treeInstances);
    if (houseInstances) scene.add(houseInstances);
    if (fenceInstances) scene.add(fenceInstances);
    const landmarkMeshes = createLandmarkMeshes(tilesData);
    const landmarkIndices = fillLandmarkMeshes(landmarkMeshes, tilesData, cx, cy);

    const farAnomalies = createFarAnomalyInstances(anomalyLODs);

    const box = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
    chunkBounds.push({ box, mesh: groundInstances, key });
    if (waterInstances) chunkBounds.push({ box, mesh: waterInstances, key });

    chunksMap.set(key, {
        ground: groundInstances,
        water: waterInstances,
        trees: treeInstances,
        houses: houseInstances,
        fences: fenceInstances,
        landmarks: landmarkMeshes,
        landmarkIndices,
        anomalyLODs: anomalyLODs,
        farAnomalies,
        farAnomalyActive: [],
        tilesData: tilesData,
        chunkX: cx,
        chunkY: cy,
        terrainVisible: true,
        ...terrainIndices,
        bounds: box,
        objectIndices: objectIndices,
        pendingRebuild: null
    });
    lastChunkVisibilityAt = -Infinity;
    lastHoverRaycastAt = -Infinity;
    markWorldShadowsDirty();
}

export function removeChunk(cx, cy) {
    const key = `${cx},${cy}`;
    const entry = chunksMap.get(key);
    if (!entry) return;
    if (entry.pendingRebuild) {
        cancelAnimationFrame(entry.pendingRebuild);
        entry.pendingRebuild = null;
    }

    for (let i = chunkBounds.length - 1; i >= 0; i--) {
        if (chunkBounds[i].key === key) chunkBounds.splice(i, 1);
    }

    scene.remove(entry.ground);
    scene.remove(entry.water);
    if (entry.trees) scene.remove(entry.trees);
    if (entry.houses) scene.remove(entry.houses);
    if (entry.fences) scene.remove(entry.fences);
    entry.ground.dispose();
    entry.water.dispose();
    entry.trees?.dispose();
    entry.houses?.dispose();
    entry.fences?.dispose();
    for (const mesh of Object.values(entry.landmarks || {})) {
        if (mesh) {
            scene.remove(mesh);
            mesh.dispose();
        }
    }
    disposeChunkAnomalyLODs(entry.anomalyLODs);
    if (entry.farAnomalies) {
        scene.remove(entry.farAnomalies);
        entry.farAnomalies.dispose();
    }

    chunksMap.delete(key);
    lastChunkVisibilityAt = -Infinity;
    lastHoverRaycastAt = -Infinity;
    markWorldShadowsDirty();
}

// --- Функция для обновления позиций объектов на тайле при изменении высоты ---
function updateTileObjectsPositions(entry, tileX, tileY, newHeight) {
    const size = CHUNK_SIZE;
    const tileIndex = tileY * size + tileX;
    const worldX = entry.chunkX * size + tileX + 0.5;
    const worldZ = entry.chunkY * size + tileY + 0.5;

    const dummy = new THREE.Object3D();

    const tile = entry.tilesData[tileY][tileX];
    if (!tile.objects) return;

    let treeIdxPos = 0, houseIdxPos = 0, fenceIdxPos = 0;
    const landmarkPositions = Object.fromEntries(WORLD_LANDMARK_TYPES.map(type => [type, 0]));

    tile.objects.forEach(obj => {
        const baseHalf = getBaseGroundOffset(obj.type, obj.anomalyType);
        const yPos = newHeight + baseHalf * (obj.scale || 1.0);

        dummy.rotation.set(0, THREE.MathUtils.degToRad(obj.rotation || 0), 0);
        dummy.position.set(
            worldX + (obj.x || 0),
            yPos,
            worldZ + (obj.z || 0)
        );
        dummy.scale.set(obj.scale || 1, obj.scale || 1, obj.scale || 1);
        dummy.updateMatrix();

        if (obj.type === 'tree' && entry.trees) {
            const idx = entry.objectIndices.trees[tileIndex][treeIdxPos++];
            entry.trees.setMatrixAt(idx, dummy.matrix);
        } else if (obj.type === 'house' && entry.houses) {
            const idx = entry.objectIndices.houses[tileIndex][houseIdxPos++];
            entry.houses.setMatrixAt(idx, dummy.matrix);
        } else if (obj.type === 'fence' && entry.fences) {
            const idx = entry.objectIndices.fences[tileIndex][fenceIdxPos++];
            entry.fences.setMatrixAt(idx, dummy.matrix);
        } else if (entry.landmarks?.[obj.type]) {
            const idx = entry.landmarkIndices[obj.type][tileIndex][landmarkPositions[obj.type]++];
            entry.landmarks[obj.type].setMatrixAt(idx, dummy.matrix);
        }
    });

    if (entry.trees) entry.trees.instanceMatrix.needsUpdate = true;
    if (entry.houses) entry.houses.instanceMatrix.needsUpdate = true;
    if (entry.fences) entry.fences.instanceMatrix.needsUpdate = true;
    for (const mesh of Object.values(entry.landmarks || {})) {
        if (mesh) mesh.instanceMatrix.needsUpdate = true;
    }
}

// --- Функция для полного перестроения объектов чанка (при изменении объектов) ---
function rebuildChunkObjects(entry) {
    if (entry.trees) {
        scene.remove(entry.trees);
        entry.trees.dispose();
    }
    if (entry.houses) {
        scene.remove(entry.houses);
        entry.houses.dispose();
    }
    if (entry.fences) {
        scene.remove(entry.fences);
        entry.fences.dispose();
    }
    for (const mesh of Object.values(entry.landmarks || {})) {
        if (mesh) {
            scene.remove(mesh);
            mesh.dispose();
        }
    }
    disposeChunkAnomalyLODs(entry.anomalyLODs);
    if (entry.farAnomalies) {
        scene.remove(entry.farAnomalies);
        entry.farAnomalies.dispose();
    }

    const tilesData = entry.tilesData;
    const size = CHUNK_SIZE;
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
    let treeIdx = 0, houseIdx = 0, fenceIdx = 0;
    const anomalyLODs = [];

    const objectIndices = {
        trees: new Array(size * size).fill().map(() => []),
        houses: new Array(size * size).fill().map(() => []),
        fences: new Array(size * size).fill().map(() => [])
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const tile = tilesData[y][x];
            const worldX = entry.chunkX * size + x + 0.5;
            const worldZ = entry.chunkY * size + y + 0.5;
            const height = tile.height || 1.0;
            const tileIndex = y * size + x;

            const fieldLOD = createAnomalyFieldLOD(tile, worldX, worldZ);
            if (fieldLOD) {
                scene.add(fieldLOD);
                anomalyLODs.push(fieldLOD);
            }

            if (tile.objects) {
                tile.objects.forEach(obj => {
                    if (obj.type !== 'anomaly') {
                        const baseHalf = getBaseGroundOffset(obj.type);
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
                            objectIndices.trees[tileIndex].push(treeIdx);
                            treeIdx++;
                        } else if (obj.type === 'house' && houseInstances) {
                            houseInstances.setMatrixAt(houseIdx, dummy.matrix);
                            houseInstances.setColorAt(houseIdx, objColor);
                            objectIndices.houses[tileIndex].push(houseIdx);
                            houseIdx++;
                        } else if (obj.type === 'fence' && fenceInstances) {
                            fenceInstances.setMatrixAt(fenceIdx, dummy.matrix);
                            fenceInstances.setColorAt(fenceIdx, objColor);
                            objectIndices.fences[tileIndex].push(fenceIdx);
                            fenceIdx++;
                        }
                    }
                });
            }
        }
    }

    if (treeInstances) {
        treeInstances.instanceMatrix.needsUpdate = true;
        treeInstances.instanceColor.needsUpdate = true;
        scene.add(treeInstances);
    }
    if (houseInstances) {
        houseInstances.instanceMatrix.needsUpdate = true;
        houseInstances.instanceColor.needsUpdate = true;
        scene.add(houseInstances);
    }
    if (fenceInstances) {
        fenceInstances.instanceMatrix.needsUpdate = true;
        fenceInstances.instanceColor.needsUpdate = true;
        scene.add(fenceInstances);
    }
    const landmarkMeshes = createLandmarkMeshes(tilesData);
    const landmarkIndices = fillLandmarkMeshes(
        landmarkMeshes, tilesData, entry.chunkX, entry.chunkY,
    );

    entry.trees = treeInstances;
    entry.houses = houseInstances;
    entry.fences = fenceInstances;
    entry.landmarks = landmarkMeshes;
    entry.landmarkIndices = landmarkIndices;
    entry.anomalyLODs = anomalyLODs;
    entry.farAnomalies = createFarAnomalyInstances(anomalyLODs);
    entry.farAnomalyActive = [];
    entry.objectIndices = objectIndices;
    lastChunkVisibilityAt = -Infinity;
    lastHoverRaycastAt = -Infinity;
    markWorldShadowsDirty();
}

export function updateTileInChunk(chunkX, chunkY, tileX, tileY, updates) {
    const key = `${chunkX},${chunkY}`;
    const entry = chunksMap.get(key);
    if (!entry) return;

    const tile = entry.tilesData[tileY][tileX];
    Object.assign(tile, updates);
    lastHoverRaycastAt = -Infinity;

    if (updates.terrain !== undefined || updates.height !== undefined) {
        if (entry.bounds) {
            entry.bounds.max.y = Math.max(entry.bounds.max.y, (tile.height || 1) + 0.5);
        }
        const tileIndex = tileY * CHUNK_SIZE + tileX;
        const groundIndex = entry.groundIndices[tileIndex];
        const waterIndex = entry.waterIndices[tileIndex];
        const isWater = tile.terrain === 'water';
        if ((isWater && groundIndex >= 0) || (!isWater && waterIndex >= 0)) {
            Object.assign(entry, fillChunkTerrainInstances(
                entry.ground, entry.water, entry.tilesData, chunkX, chunkY, entry.terrainVisible,
            ));
        } else {
            const dummy = new THREE.Object3D();
            const height = tile.height || 1.0;
            dummy.position.set(chunkX * CHUNK_SIZE + tileX + 0.5, height / 2, chunkY * CHUNK_SIZE + tileY + 0.5);
            if (isWater) {
                dummy.scale.set(1, height, 1);
                dummy.updateMatrix();
                entry.water.setMatrixAt(waterIndex, dummy.matrix);
                entry.water.instanceMatrix.needsUpdate = true;
            } else {
                dummy.scale.set(1, height, 1);
                dummy.updateMatrix();
                entry.ground.setMatrixAt(groundIndex, dummy.matrix);
                entry.ground.setColorAt(groundIndex, new THREE.Color(terrainColors[tile.terrain] || 0x3a5f0b));
                entry.ground.instanceMatrix.needsUpdate = true;
                entry.ground.instanceColor.needsUpdate = true;
            }
        }
    }

    if (updates.height !== undefined) {
        updateTileObjectsPositions(entry, tileX, tileY, tile.height);
        lastChunkVisibilityAt = -Infinity;
        markWorldShadowsDirty();
    }

    if (updates.objects !== undefined || updates.anomaly_field !== undefined
        || (updates.height !== undefined && tile.anomaly_field)) {
        if (entry.pendingRebuild) {
            cancelAnimationFrame(entry.pendingRebuild);
        }
        entry.pendingRebuild = requestAnimationFrame(() => {
            rebuildChunkObjects(entry);
            entry.pendingRebuild = null;
        });
    }
}

export function setBrushRadius(radius) {
    currentBrushRadius = radius;
    lastHoverRaycastAt = -Infinity;
}

const TERRAIN_RENDER_DISTANCE = 380;
const NATURAL_DETAIL_DISTANCE = 190;
const STRUCTURE_DETAIL_DISTANCE = 280;
const ANOMALY_DETAIL_DISTANCE = 320;
const chunkFrustum = new THREE.Frustum();
const chunkProjectionMatrix = new THREE.Matrix4();
const anomalyVisibilitySphere = new THREE.Sphere();

function chunkWithinHorizontalDistance(bounds, focus, distance) {
    const nearestX = Math.max(bounds.min.x, Math.min(focus.x, bounds.max.x));
    const nearestZ = Math.max(bounds.min.z, Math.min(focus.z, bounds.max.z));
    const dx = focus.x - nearestX;
    const dz = focus.z - nearestZ;
    return dx * dx + dz * dz <= distance * distance;
}

function updateChunkVisibility() {
    camera.updateMatrixWorld();
    chunkFrustum.setFromProjectionMatrix(chunkProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    visibleNearAnomalies.length = 0;

    chunksMap.forEach((chunk) => {
        if (!chunk.bounds) return;

        if (!chunkWithinHorizontalDistance(chunk.bounds, controls.target, TERRAIN_RENDER_DISTANCE)) {
            setVisible(chunk, false);
            return;
        }

        const visible = chunkFrustum.intersectsBox(chunk.bounds);
        setVisible(
            chunk,
            visible,
            visible && chunkWithinHorizontalDistance(chunk.bounds, controls.target, NATURAL_DETAIL_DISTANCE),
            visible && chunkWithinHorizontalDistance(chunk.bounds, controls.target, STRUCTURE_DETAIL_DISTANCE),
            visible && chunkWithinHorizontalDistance(chunk.bounds, controls.target, ANOMALY_DETAIL_DISTANCE),
        );
    });
}

function setVisible(chunk, visible, naturalVisible = false, structureVisible = false, anomalyVisible = false) {
    const groundVisible = visible && chunk.ground?.count !== 0;
    const waterVisible = visible && chunk.water?.count !== 0;
    const visibilityChanged = (chunk.ground && chunk.ground.visible !== groundVisible)
        || (chunk.trees && chunk.trees.visible !== naturalVisible)
        || (chunk.houses && chunk.houses.visible !== structureVisible)
        || (chunk.fences && chunk.fences.visible !== naturalVisible)
        || Object.entries(chunk.landmarks || {}).some(([type, mesh]) => (
            mesh && mesh.visible !== (type === 'forest' ? naturalVisible : structureVisible)
        ));
    chunk.terrainVisible = visible;
    if (chunk.ground) chunk.ground.visible = groundVisible;
    if (chunk.water) chunk.water.visible = waterVisible;
    if (chunk.trees) chunk.trees.visible = naturalVisible;
    if (chunk.houses) chunk.houses.visible = structureVisible;
    if (chunk.fences) chunk.fences.visible = naturalVisible;
    for (const [type, mesh] of Object.entries(chunk.landmarks || {})) {
        if (mesh) mesh.visible = type === 'forest' ? naturalVisible : structureVisible;
    }
    updateFarAnomalyInstances(chunk, anomalyVisible);
    if (visibilityChanged) markWorldShadowsDirty();
}

export function setEditMode(enabled) {
    editMode = enabled;
    if (!enabled && controlsDisabled) {
        controls.enabled = true;
        controlsDisabled = false;
    }
}
export function setTileClickCallback(callback) { window.tileClickCallback = callback; }
export function setWorldTravelTileClickCallback(callback) {
    window.worldTravelTileClickCallback = callback;
}

function performRaycast(clientX, clientY) {
    if (window.isLocationActive) return;
    lastHoverRaycastAt = performance.now();
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const candidates = chunkBounds.filter(entry => entry.mesh.visible && raycaster.ray.intersectsBox(entry.box)).map(e => e.mesh);
    const intersects = raycaster.intersectObjects(candidates);

    if (hoveredTile) {
        highlightBox.visible = false;
        hoveredTile = null;
    }
    if (tileInfoDiv) tileInfoDiv.style.display = 'none';

    const point = intersects[0]?.point
        || (editMode ? raycaster.ray.intersectPlane(worldBrushPlane, new THREE.Vector3()) : null);
    if (point) {

        const globalX = point.x;
        const globalZ = point.z;

        const chunkX = Math.floor(globalX / CHUNK_SIZE);
        const chunkY = Math.floor(globalZ / CHUNK_SIZE);
        const tileX = Math.floor(globalX % CHUNK_SIZE);
        const tileY = Math.floor(globalZ % CHUNK_SIZE);

        if (chunkX >= MIN_CHUNK && chunkX <= MAX_CHUNK_X && chunkY >= MIN_CHUNK && chunkY <= MAX_CHUNK_Y &&
            tileX >= 0 && tileX < CHUNK_SIZE && tileY >= 0 && tileY < CHUNK_SIZE) {

            const key = `${chunkX},${chunkY}`;
            const chunkEntry = chunksMap.get(key);
            if (chunkEntry) {
                const tileData = chunkEntry.tilesData[tileY][tileX];
                hoveredTile = { chunk: chunkEntry, tileX, tileY, tileData };

                const worldX = chunkX * CHUNK_SIZE + tileX + 0.5;
                const worldZ = chunkY * CHUNK_SIZE + tileY + 0.5;
                const height = tileData.height || 1.0;

                const areaSize = 2 * currentBrushRadius + 1;
                highlightBox.scale.set(areaSize, 0.1, areaSize);
                highlightBox.position.set(worldX, height + 0.1, worldZ);
                highlightBox.visible = true;

                if (tileInfoDiv && tileInfoContent) {
                    tileInfoContent.innerHTML = `
                        <b>(${chunkX * CHUNK_SIZE + tileX}, ${chunkY * CHUNK_SIZE + tileY})</b><br>
                        Высота: ${tileData.height}<br>
                        Радиация: ${tileData.radiation ?? 0}
                    `;
                    tileInfoDiv.style.display = 'block';
                }
            }
        }
    }
}

function canvasMouseDownHandler(event) {
    if (window.isLocationActive) return;
    if (event.button === 2 && editMode) {
        controls.enabled = true;
        controlsDisabled = false;
        brushActive = false;
        return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    if (event.target.closest('.ui-overlay')) return;

    performRaycast(event.clientX, event.clientY);

    isMouseDown = true;
    lastProcessedTileKey = null;

    const isEditing = editMode && !window.isWorldTravelSelectionActive?.()
        && (event.altKey || event.shiftKey || ['terrain', 'height', 'radiation', 'erase'].includes(window.worldEditorTool));

    if (isEditing) {
        event.preventDefault();
        event.stopImmediatePropagation();

        controls.enabled = false;
        controlsDisabled = true;
        brushActive = true;

        if (hoveredTile && window.tileClickCallback) {
            window.tileClickCallback({
                tile: {
                    chunkX: hoveredTile.chunk.chunkX,
                    chunkY: hoveredTile.chunk.chunkY,
                    tileX: hoveredTile.tileX,
                    tileY: hoveredTile.tileY,
                    tileData: hoveredTile.tileData
                },
                event,
                isDoubleClick: false,
                isDrag: false
            });
            lastProcessedTileKey = `${hoveredTile.chunk.chunkX},${hoveredTile.chunk.chunkY},${hoveredTile.tileX},${hoveredTile.tileY}`;
        }

        if (!globalMouseUpHandler) {
            globalMouseUpHandler = (e) => {
                if (e.button !== 0) return;
                isMouseDown = false;
                lastProcessedTileKey = null;
                if (controlsDisabled) {
                    controls.enabled = true;
                    controlsDisabled = false;
                }
                brushActive = false;
                document.removeEventListener('mouseup', globalMouseUpHandler);
                globalMouseUpHandler = null;
            };
            document.addEventListener('mouseup', globalMouseUpHandler, { capture: true });
        }
    }
}

renderer.domElement.addEventListener('pointerdown', canvasMouseDownHandler, { capture: true });
renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
renderer.domElement.addEventListener('dragstart', event => event.preventDefault());

window.addEventListener('click', (event) => {
    if (window.isLocationActive) return;
    if (event.target.closest('.ui-overlay')) return;
    if (hoveredTile && window.worldTravelTileClickCallback) {
        const consumed = window.worldTravelTileClickCallback({
            tile: {
                chunkX: hoveredTile.chunk.chunkX,
                chunkY: hoveredTile.chunk.chunkY,
                tileX: hoveredTile.tileX,
                tileY: hoveredTile.tileY,
                tileData: hoveredTile.tileData
            },
            event
        });
        if (consumed) return;
    }
});

window.addEventListener('dblclick', (event) => {
    if (window.isLocationActive) return;
    if (event.target.closest('.ui-overlay')) return;
    if (editMode && hoveredTile && window.tileClickCallback) {
        window.tileClickCallback({
            tile: {
                chunkX: hoveredTile.chunk.chunkX,
                chunkY: hoveredTile.chunk.chunkY,
                tileX: hoveredTile.tileX,
                tileY: hoveredTile.tileY,
                tileData: hoveredTile.tileData
            },
            event,
            isDoubleClick: true,
            isDrag: false
        });
    }
});

let lastTime = performance.now();
function updateGlobalCameraMovement(deltaSeconds) {
    if (window.isLocationActive || globalCameraKeys.size === 0) return;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) return;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const movement = new THREE.Vector3();
    if (globalCameraKeys.has('KeyW')) movement.add(forward);
    if (globalCameraKeys.has('KeyS')) movement.sub(forward);
    if (globalCameraKeys.has('KeyD')) movement.add(right);
    if (globalCameraKeys.has('KeyA')) movement.sub(right);
    if (movement.lengthSq() === 0) return;

    const distanceToTarget = camera.position.distanceTo(controls.target);
    movement.normalize().multiplyScalar(Math.max(20, distanceToTarget * 0.7) * deltaSeconds);
    const oldTarget = controls.target.clone();
    const nextTarget = oldTarget.clone().add(movement);
    nextTarget.x = THREE.MathUtils.clamp(nextTarget.x, 0.5, (MAX_CHUNK_X + 1) * CHUNK_SIZE - 0.5);
    nextTarget.z = THREE.MathUtils.clamp(nextTarget.z, 0.5, (MAX_CHUNK_Y + 1) * CHUNK_SIZE - 0.5);
    const appliedMovement = nextTarget.sub(oldTarget);
    controls.target.add(appliedMovement);
    camera.position.add(appliedMovement);
}

function animate() {
    const now = performance.now();
    const delta = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    requestAnimationFrame(animate);
    // The sublocation has its own renderer; do not render the hidden world behind it.
    if (document.hidden || window.isLocationActive) {
        worldFpsCounter.pause();
        worldPerfSampleAt = now;
        worldFrameWorkMs = 0;
        worldSampleFrames = 0;
        shadowRefreshesSinceSample = 0;
        return;
    }
    const frameWorkStartedAt = performance.now();
    if (!renderer.isUnavailableRenderer) {
        updateGlobalCameraMovement(Math.min(0.1, Math.max(0, delta)));
        const cameraMoved = controls.update();
        if (cameraMoved || now - lastChunkVisibilityAt >= CHUNK_VISIBILITY_REFRESH_MS) {
            updateChunkVisibility();
            lastChunkVisibilityAt = now;
        }
        updateRain(delta);
        animateChunkAnomalies(now);
        waterTexture.offset.set((now * 0.000002) % 1, (now * 0.000001) % 1);
        worldSkySphere.position.copy(camera.position);
        stars.position.copy(camera.position);

        if ((lastMouseX !== 0 || lastMouseY !== 0)
            && !cameraDragActive
            && (hoverRaycastPending
                || (cameraMoved && now - lastHoverRaycastAt >= MOVING_CAMERA_RAYCAST_REFRESH_MS)
                || now - lastHoverRaycastAt >= HOVER_RAYCAST_REFRESH_MS)) {
            performRaycast(lastMouseX, lastMouseY);
            hoverRaycastPending = false;
        }
        refreshWorldShadows(now, cameraMoved);
    }

    if (!renderer.isUnavailableRenderer) {
        renderer.render(scene, camera);
        worldFpsCounter.frame(now);
        worldFrameWorkMs += performance.now() - frameWorkStartedAt;
        worldSampleFrames += 1;
        if (now - worldPerfSampleAt >= 1000) {
            const renderInfo = renderer.info?.render;
            if (renderInfo) {
                worldFpsCounter.setDetails(
                    `calls ${renderInfo.calls} | tris ${Math.round(renderInfo.triangles / 1000)}k | CPU ${(worldFrameWorkMs / worldSampleFrames).toFixed(1)}ms | shadows ${shadowRefreshesSinceSample}`
                );
            }
            worldPerfSampleAt = now;
            worldFrameWorkMs = 0;
            worldSampleFrames = 0;
            shadowRefreshesSinceSample = 0;
        }
    } else {
        worldFpsCounter.pause();
    }
    postRenderCallbacks.forEach(cb => cb());
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

export function getObjectDimensions(type, anomalyType, scale = 1.0) {
    const base = getBaseDimensions(type, anomalyType);
    return {
        width: base.width * scale,
        height: base.height * scale,
        depth: base.depth * scale
    };
}

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

window.addEventListener('pointermove', (event) => {
    if (window.isLocationActive) return;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
    lastModifiers.alt = event.altKey;
    lastModifiers.shift = event.shiftKey;

    cameraDragActive = Boolean(event.buttons & 6);
    if (cameraDragActive) {
        hoverRaycastPending = true;
        return;
    }
    performRaycast(event.clientX, event.clientY);

    if ((event.buttons === 1) && brushActive && editMode && hoveredTile && window.applyBrush) {
        const tileKey = `${hoveredTile.chunk.chunkX},${hoveredTile.chunk.chunkY},${hoveredTile.tileX},${hoveredTile.tileY}`;
        if (lastProcessedTileKey === tileKey) return;
        const updates = {};
        if (window.eraserMode) {
            updates.objects = [];
        } else if (event.altKey) {
            updates.terrain = window.currentTileType;
        } else if (event.shiftKey) {
            updates.height = window.tileHeight;
        } else if (window.worldEditorTool === 'terrain') {
            updates.terrain = window.currentTileType;
        } else if (window.worldEditorTool === 'height') {
            updates.height = window.tileHeight;
        } else if (window.worldEditorTool === 'radiation') {
            updates.radiation = window.worldBrushRadiation ?? 0;
        }
        if (Object.keys(updates).length > 0) {
            lastProcessedTileKey = tileKey;
            window.applyBrush(hoveredTile, updates, window.brushRadius);
        }
    }
}, { capture: true });

window.addEventListener('pointerup', () => {
    cameraDragActive = false;
    hoverRaycastPending = true;
});

window.addEventListener('keydown', (e) => {
    const isTyping = Boolean(e.target?.closest?.('input, textarea, select, [contenteditable="true"]'));
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) && !isTyping && !window.isLocationActive) {
        globalCameraKeys.add(e.code);
        e.preventDefault();
    } else if (e.key === 'Alt') {
        lastModifiers.alt = true;
        e.preventDefault();
    } else if (e.key === 'Shift') {
        lastModifiers.shift = true;
    }
}, { capture: true });

window.addEventListener('keyup', (e) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        globalCameraKeys.delete(e.code);
    }
    if (e.key === 'Alt') {
        lastModifiers.alt = false;
    } else if (e.key === 'Shift') {
        lastModifiers.shift = false;
    }
}, { capture: true });

window.addEventListener('blur', () => globalCameraKeys.clear());

export function getTileHeightAt(globalX, globalZ) {
    const chunkX = Math.floor(globalX / CHUNK_SIZE);
    const chunkY = Math.floor(globalZ / CHUNK_SIZE);
    const key = `${chunkX},${chunkY}`;
    const chunk = chunksMap.get(key);
    if (!chunk) return 0;
    const tileX = Math.floor(globalX % CHUNK_SIZE);
    const tileY = Math.floor(globalZ % CHUNK_SIZE);
    if (tileX < 0 || tileX >= CHUNK_SIZE || tileY < 0 || tileY >= CHUNK_SIZE) return 0;
    return chunk.tilesData[tileY][tileX].height || 1.0;
}

export { scene, camera, renderer, controls, directionalLight, ambientLight, fillLight, waterMat };

// ========== ВРЕМЕННОЕ СКРЫТИЕ ГЛОБАЛЬНОЙ КАРТЫ (ДЛЯ ЛОКАЦИЙ) ==========
let globalCanvasParent = null;
let globalCanvasNextSibling = null;

export function hideGlobalCanvas() {
    const canvas = renderer?.domElement;
    if (!canvas || !canvas.parentNode) return;
    // Сохраняем родителя и позицию в DOM
    globalCanvasParent = canvas.parentNode;
    globalCanvasNextSibling = canvas.nextSibling;
    canvas.remove();
}

export function showGlobalCanvas() {
    if (!globalCanvasParent || !renderer?.domElement) return;
    // Вставляем обратно на то же место
    if (globalCanvasNextSibling) {
        globalCanvasParent.insertBefore(renderer.domElement, globalCanvasNextSibling);
    } else {
        globalCanvasParent.appendChild(renderer.domElement);
    }
    // Принудительно перерисовываем один раз, чтобы канвас ожил
    renderer.render(scene, camera);
}
