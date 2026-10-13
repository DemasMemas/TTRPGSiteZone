import * as THREE from 'three';
import { grassPlacements } from './locationGrassDetail.js';
import { createLocationTerrainPixels } from './locationTerrainTexture.js';
import { findLocationAsset } from './locationAssetCatalog.js';
import { applyLocationPbrMaterial } from './locationPbrMaterials.js';
import { comparisonCovered, createComparisonResources,
    createComparisonVegetation, grassCardsD21Reference,
    prepareComparisonTufts } from './vegetationComparisonVariants.js';

const view = document.getElementById('view');
const readout = document.getElementById('readout');
const results = document.getElementById('results');
const measureButton = document.getElementById('measure');
const densityControl = document.getElementById('density');
const ids = ['reference', 'low', 'tall', 'mixed'];
const labels = ['01 Эталон D.2.1', '02 Низкая трава', '03 Высокая трава', '04 Смешанный покров'];
const plotCenters = [-14.25, -4.75, 4.75, 14.25];
const plotTiles = Array.from({ length: 14 }, () => Array.from({ length: 8 }, () => ({ terrain: 'grass' })));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setClearColor(0x848c81);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x848c81);
scene.add(new THREE.HemisphereLight(0xdde3d5, 0x585043, 1.35));
const sun = new THREE.DirectionalLight(0xffe1b5, 1.35);
sun.position.set(-13, 28, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = sun.shadow.camera.bottom = -33;
sun.shadow.camera.right = sun.shadow.camera.top = 33;
scene.add(sun);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 140);

const state = { focus: 'all', yaw: 0, pitch: 0.76, distance: 48, targetX: 0,
    measuring: false, density: 1 };
let drag = null;
let sampler = null;
const plots = [];

function groundGeometry(width, depth) {
    const geometry = new THREE.PlaneGeometry(width, depth);
    const uv = geometry.getAttribute('uv');
    for (let index = 0; index < uv.count; index++) {
        uv.setXY(index, uv.getX(index) * width / 2, uv.getY(index) * depth / 2);
    }
    geometry.setAttribute('uv2', uv.clone());
    return geometry;
}

const earthMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
const earthAsset = findLocationAsset('art_dirty_earth');
applyLocationPbrMaterial(earthMaterial, earthAsset.visual.maps);
const roadPixels = createLocationTerrainPixels(Array.from({ length: 2 }, () =>
    Array.from({ length: 8 }, () => ({ terrain: 'sand' }))));
const roadTexture = new THREE.DataTexture(roadPixels.data, roadPixels.width, roadPixels.height,
    THREE.RGBAFormat, THREE.UnsignedByteType);
roadTexture.encoding = THREE.sRGBEncoding;
roadTexture.magFilter = roadTexture.minFilter = THREE.LinearFilter;
roadTexture.needsUpdate = true;
const roadMaterial = new THREE.MeshStandardMaterial({ map: roadTexture, roughness: 1 });
const earthFrontGeometry = groundGeometry(8, 8);
const earthBackGeometry = groundGeometry(8, 4);
const roadGeometry = new THREE.PlaneGeometry(8, 2);

function fenceTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    context.strokeStyle = '#96978d';
    context.lineWidth = 2.5;
    for (let offset = -128; offset < 256; offset += 32) {
        context.beginPath();
        context.moveTo(offset, 0);
        context.lineTo(offset + 128, 128);
        context.moveTo(offset + 128, 0);
        context.lineTo(offset, 128);
        context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 1);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    return texture;
}

const wireMaterial = new THREE.MeshLambertMaterial({
    map: fenceTexture(), alphaTest: 0.45, transparent: false, side: THREE.DoubleSide,
});
const wireGeometry = new THREE.PlaneGeometry(8, 1.12);
const postGeometry = new THREE.CylinderGeometry(0.035, 0.045, 1.45, 6);
const postMaterial = new THREE.MeshStandardMaterial({ color: 0x51564e, metalness: 0.58, roughness: 0.74 });
const vegetationResources = createComparisonResources(THREE);
const positions = grassPlacements(plotTiles, comparisonCovered).tufts;

function signTexture(label) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#282d26';
    context.fillRect(0, 0, 512, 128);
    context.strokeStyle = '#a89b71';
    context.lineWidth = 5;
    context.strokeRect(5, 5, 502, 118);
    context.font = 'bold 41px Georgia';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f2e9cf';
    context.fillText(label, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.sRGBEncoding;
    return texture;
}

function addPlot(index) {
    const group = new THREE.Group();
    group.position.x = plotCenters[index];
    const ground = (geometry, material, z) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.z = z;
        mesh.receiveShadow = true;
        group.add(mesh);
    };
    ground(earthFrontGeometry, earthMaterial, 4);
    ground(roadGeometry, roadMaterial, 9);
    ground(earthBackGeometry, earthMaterial, 12);
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, 5);
    const dummy = new THREE.Object3D();
    for (let post = 0; post < 5; post++) {
        dummy.position.set(-4 + post * 2, 0.725, 13.8);
        dummy.updateMatrix();
        posts.setMatrixAt(post, dummy.matrix);
    }
    posts.instanceMatrix.needsUpdate = true;
    posts.frustumCulled = false;
    posts.castShadow = true;
    group.add(posts);
    const wire = new THREE.Mesh(wireGeometry, wireMaterial);
    wire.position.set(0, 0.69, 13.8);
    group.add(wire);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15),
        new THREE.MeshBasicMaterial({ map: signTexture(labels[index]), side: THREE.DoubleSide }));
    sign.position.set(0, 1.18, -0.68);
    group.add(sign);

    const vegetation = buildVegetation(ids[index], 1);
    group.add(vegetation);
    group.userData.vegetation = vegetation;
    group.userData.vegetationByDensity = new Map([[1, vegetation]]);
    scene.add(group);
    plots.push(group);
}

ids.forEach((_, index) => addPlot(index));

function buildVegetation(id, density) {
    const margin = id === 'reference' ? grassCardsD21Reference.margin : 0.74;
    const vegetation = createComparisonVegetation(THREE, id,
        prepareComparisonTufts(positions, density, margin), vegetationResources);
    // Terrain geometry is centred on x=0; placement generators use tile coordinates 0..8.
    vegetation.position.x = -4;
    return vegetation;
}

function setDensity(density) {
    state.density = density;
    for (let index = 0; index < plots.length; index++) {
        const plot = plots[index];
        plot.userData.vegetation.visible = false;
        let vegetation = plot.userData.vegetationByDensity.get(density);
        if (!vegetation) {
            vegetation = buildVegetation(ids[index], density);
            plot.add(vegetation);
            plot.userData.vegetationByDensity.set(density, vegetation);
        }
        vegetation.visible = true;
        plot.userData.vegetation = vegetation;
    }
    results.replaceChildren();
    readout.textContent = `Плотность ×${density}. Повторите замер: прежние результаты очищены.`;
}

densityControl.addEventListener('change', () => {
    if (!state.measuring) setDensity(Number(densityControl.value));
});

document.querySelectorAll('[data-angle]').forEach(button => {
    button.addEventListener('click', () => {
        if (state.measuring) return;
        const preset = {
            top: [0, Math.PI / 2], game: [0, 0.76], low: [0, 0.34],
        }[button.dataset.angle];
        state.yaw = preset[0];
        state.pitch = preset[1];
        document.querySelectorAll('[data-angle]').forEach(candidate => {
            candidate.setAttribute('aria-pressed', String(candidate === button));
        });
    });
});

function vegetationStats(group) {
    let instances = 0;
    let calls = 0;
    let vertices = 0;
    let triangles = 0;
    let bytes = 0;
    group.traverse(mesh => {
        if (!mesh.isInstancedMesh) return;
        const count = mesh.count;
        const geometry = mesh.geometry;
        const vertexCount = geometry.getAttribute('position').count;
        const triangleCount = geometry.index ? geometry.index.count : vertexCount;
        instances += count;
        calls++;
        vertices += count * vertexCount;
        triangles += count * triangleCount / 3;
        for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
        if (geometry.index) bytes += geometry.index.array.byteLength;
        bytes += count * (16 + (mesh.instanceColor ? 3 : 0)) * 4;
    });
    return { instances, calls, vertices, triangles, bytes };
}

function setFocus(id, isolate = false) {
    const index = ids.indexOf(id);
    state.focus = id;
    state.targetX = index < 0 ? 0 : plotCenters[index];
    state.distance = index < 0 ? Math.max(48, 48 / Math.max(0.55, view.clientWidth / view.clientHeight)) : 19;
    for (let plot = 0; plot < plots.length; plot++) plots[plot].visible = !isolate || plot === index;
    document.querySelectorAll('[data-focus]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.focus === id));
    });
}

document.querySelectorAll('[data-focus]').forEach(button => {
    button.addEventListener('click', () => {
        if (!state.measuring) setFocus(button.dataset.focus);
    });
});

view.addEventListener('pointerdown', event => {
    if (state.measuring) return;
    drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    view.setPointerCapture(event.pointerId);
});
view.addEventListener('pointermove', event => {
    if (state.measuring || !drag || drag.pointerId !== event.pointerId) return;
    state.yaw += (drag.x - event.clientX) * 0.006;
    state.pitch = Math.max(0.28, Math.min(1.54, state.pitch + (event.clientY - drag.y) * 0.005));
    drag.x = event.clientX;
    drag.y = event.clientY;
});
view.addEventListener('pointerup', () => { drag = null; });
view.addEventListener('pointercancel', () => { drag = null; });
view.addEventListener('wheel', event => {
    event.preventDefault();
    if (!state.measuring) state.distance = Math.max(7, Math.min(95, state.distance * (event.deltaY > 0 ? 1.1 : 0.9)));
}, { passive: false });

function updateCamera() {
    const cos = Math.cos(state.pitch);
    camera.position.set(state.targetX + Math.sin(state.yaw) * state.distance * cos,
        state.distance * Math.sin(state.pitch), 7 + Math.cos(state.yaw) * state.distance * cos);
    camera.up.set(0, state.pitch === Math.PI / 2 ? 0 : 1,
        state.pitch === Math.PI / 2 ? -1 : 0);
    camera.lookAt(state.targetX, 0, 7);
}

function render(now) {
    const width = view.clientWidth;
    const height = view.clientHeight;
    if (width && height) {
        if (renderer.domElement.clientWidth !== width || renderer.domElement.clientHeight !== height) {
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        updateCamera();
        renderer.info.reset();
        renderer.render(scene, camera);
        if (sampler && now >= sampler.start) {
            if (sampler.lastFrame) {
                sampler.intervals.push(now - sampler.lastFrame);
                sampler.calls += renderer.info.render.calls;
                sampler.triangles += renderer.info.render.triangles;
            }
            sampler.lastFrame = now;
            if (now >= sampler.end) {
                const sample = sampler;
                sampler = null;
                sample.resolve({ intervals: sample.intervals,
                    calls: sample.calls / Math.max(1, sample.intervals.length),
                    triangles: sample.triangles / Math.max(1, sample.intervals.length),
                    width: renderer.domElement.width, height: renderer.domElement.height,
                    pixelRatio: renderer.getPixelRatio() });
            }
        }
    }
    requestAnimationFrame(render);
}

function sampleFrames(duration = 3500) {
    return new Promise(resolve => {
        const start = performance.now() + 650;
        sampler = { start, end: start + duration, lastFrame: 0, intervals: [], calls: 0,
            triangles: 0, resolve };
    });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function measureAll() {
    if (state.measuring) return;
    state.measuring = true;
    measureButton.disabled = true;
    densityControl.disabled = true;
    results.replaceChildren();
    const previous = { ...state };
    for (let index = 0; index < ids.length; index++) {
        const id = ids[index];
        setFocus(id, true);
        state.yaw = 0;
        state.pitch = 0.76;
        state.distance = 19;
        readout.textContent = `Измерение ${labels[index]}...`;
        await sleep(250);
        const sample = await sampleFrames();
        const sorted = sample.intervals.slice().sort((a, b) => a - b);
        const mean = sample.intervals.reduce((sum, value) => sum + value, 0)
            / Math.max(1, sample.intervals.length);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
        const budget = vegetationStats(plots[index].userData.vegetation);
        const types = plots[index].userData.vegetation.userData.counts;
        const fps = mean ? 1000 / mean : 0;
        const displayIntervals = [1000 / 60, 1000 / 75, 1000 / 100,
            1000 / 120, 1000 / 144, 1000 / 165];
        const capped = p95 && Math.abs(p95 - mean) < 1.5
            && displayIntervals.some(interval => Math.abs(mean - interval) < 0.65);
        const row = document.createElement('tr');
        for (const value of [labels[index].slice(0, 2), budget.instances,
            budget.vertices, Math.round(budget.triangles), sample.calls.toFixed(0),
            mean.toFixed(1), p95.toFixed(1), `${fps.toFixed(1)}${capped ? '*' : ''}`]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        }
        results.appendChild(row);
        console.log('Vegetation comparison', { variant: id, density: state.density, fps,
            meanFrameMs: mean, p95FrameMs: p95, possibleDisplayCap: capped, budget,
            vegetationTypes: types,
            drawCalls: sample.calls, renderedTriangles: sample.triangles,
            renderSize: [sample.width, sample.height], pixelRatio: sample.pixelRatio });
        readout.textContent = `${labels[index]} ×${state.density}: ${fps.toFixed(1)} FPS${capped ? ' (возможно, лимит дисплея)' : ''}\n`
            + `Кадр ${mean.toFixed(1)} мс; p95 ${p95.toFixed(1)} мс; рендер ${sample.width}×${sample.height} @${sample.pixelRatio.toFixed(2)}\n`
            + `${budget.instances} экземпляров; ${budget.vertices} вершин / ${Math.round(budget.triangles)} треугольников травы\n`
            + `Сцена: ${sample.calls.toFixed(0)} выз. / ${Math.round(sample.triangles)} треуг.; трава: ${budget.calls} выз.\n`
            + (id === 'mixed' ? `Эталон ${types.reference}, низкая ${types.low}, высокая ${types.tall}.\n` : '')
            + `Буферы травы ~${Math.round(budget.bytes / 1024)} КБ. AlphaTest может ограничиваться fill-rate.`;
    }
    state.yaw = previous.yaw;
    state.pitch = previous.pitch;
    setFocus(previous.focus);
    state.distance = previous.distance;
    state.measuring = false;
    measureButton.disabled = false;
    densityControl.disabled = false;
}

measureButton.addEventListener('click', measureAll);
window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    for (const geometry of Object.values(vegetationResources.geometries)) geometry.dispose();
    for (const material of Object.values(vegetationResources.materials)) material.dispose();
    for (const texture of Object.values(vegetationResources.textures)) texture.dispose();
    renderer.dispose();
});
renderer.info.autoReset = false;
setFocus('all');
readout.textContent = 'Четыре разновидности Grass Cards построены один раз. Загрузка общей PBR-земли...';
const started = performance.now();
const readiness = setInterval(() => {
    if (!earthMaterial.map && performance.now() - started < 8000) return;
    clearInterval(readiness);
    measureButton.disabled = false;
    readout.textContent = earthMaterial.map
        ? 'Готово. Выберите участок или запустите одинаковый замер всех четырёх.'
        : 'PBR-карты грунта недоступны; работает однотонный резервный материал.';
    if (!earthMaterial.map) {
        earthMaterial.color.set(0x746b58);
        const recovery = setInterval(() => {
            if (!earthMaterial.map) return;
            earthMaterial.color.set(0xffffff);
            clearInterval(recovery);
        }, 1000);
    }
}, 100);
requestAnimationFrame(render);
window.dispatchEvent(new Event('vegetation-comparison-ready'));
