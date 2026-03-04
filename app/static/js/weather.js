import * as THREE from 'three';
import { scene, directionalLight, ambientLight, waterMat } from './lobby3d.js';
import { Howl } from 'howler';

let rainParticles = null;
let rainSound = null;
let emissionSound = null;
let rainSpeeds = [];

const RAIN_VOLUME_FACTOR = 0.5;
const EMISSION_VOLUME_FACTOR = 0.05; // ещё тише

const DEFAULT_FOG_INTENSITY = 0.5;
const DEFAULT_RAIN_INTENSITY = 0.5;
const DEFAULT_SUN_INTENSITY = 0.5;
const DEFAULT_EMISSION_INTENSITY = 0.5;

export function initWeather() {
    rainSound = new Howl({ src: ['/static/audio/rain.mp3'], loop: true, volume: 0 });
    emissionSound = new Howl({ src: ['/static/audio/emission.mp3'], loop: true, volume: 0 });
}

export function applyWeather(settings) {
    const fog = {
        enabled: settings.fog?.enabled || false,
        intensity: settings.fog?.intensity !== undefined ? settings.fog.intensity : DEFAULT_FOG_INTENSITY
    };
    const rain = {
        enabled: settings.rain?.enabled || false,
        intensity: settings.rain?.intensity !== undefined ? settings.rain.intensity : DEFAULT_RAIN_INTENSITY
    };
    const sun = {
        enabled: settings.sun?.enabled || false,
        intensity: settings.sun?.intensity !== undefined ? settings.sun.intensity : DEFAULT_SUN_INTENSITY
    };
    const emission = {
        enabled: settings.emission?.enabled || false,
        intensity: settings.emission?.intensity !== undefined ? settings.emission.intensity : DEFAULT_EMISSION_INTENSITY
    };

    // Туман
    if (fog.enabled) {
        const density = 0.02 * fog.intensity;
        scene.fog = new THREE.FogExp2(emission.enabled ? 0xaa3333 : 0xcccccc, density);
    } else {
        scene.fog = null;
    }

    // Вода всегда непрозрачная
    if (waterMat) {
        waterMat.transparent = false;
        waterMat.opacity = 1.0;
    }

    // Дождь
    if (rain.enabled) {
        if (!rainParticles) {
            createRainParticles(rain.intensity);
        } else {
            updateRainIntensity(rain.intensity);
        }
        rainParticles.visible = true;
        rainSound.volume(rain.intensity * RAIN_VOLUME_FACTOR);
        rainSound.play();
    } else {
        if (rainParticles) rainParticles.visible = false;
        rainSound.pause();
    }

    // Солнце (увеличенная яркость)
    if (sun.enabled) {
        directionalLight.intensity = 2.0 * sun.intensity;
        ambientLight.intensity = 0.5 * sun.intensity;
    } else {
        directionalLight.intensity = 0.2;
        ambientLight.intensity = 0.1;
    }

    // Выброс
    if (emission.enabled) {
        const intensity = emission.intensity;
        const normalDir = new THREE.Color(0xffffff);
        const redDir = new THREE.Color(0xff6666);
        directionalLight.color.lerpColors(normalDir, redDir, intensity);

        const normalAmb = new THREE.Color(0xffffff);
        const redAmb = new THREE.Color(0x882222);
        ambientLight.color.lerpColors(normalAmb, redAmb, intensity);

        if (scene.fog) {
            scene.fog.color.lerpColors(new THREE.Color(0xcccccc), new THREE.Color(0xaa3333), intensity);
        }

        emissionSound.volume(intensity * EMISSION_VOLUME_FACTOR);
        emissionSound.play();
    } else {
        directionalLight.color.setHex(0xffffff);
        ambientLight.color.setHex(0xffffff);
        emissionSound.pause();
    }
}

function createRainParticles(intensity = 0.5) {
    const count = 75000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    rainSpeeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i*3] = (Math.random() - 0.5) * 2000;
        positions[i*3+1] = Math.random() * 500;
        positions[i*3+2] = (Math.random() - 0.5) * 2000;
        rainSpeeds[i] = 50 + Math.random() * 100;
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.ellipse(4, 8, 2, 5, 0, 0, Math.PI*2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.PointsMaterial({
        color: 0xaaaaaa,
        size: 0.3 + intensity,
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    rainParticles = new THREE.Points(geometry, material);
    scene.add(rainParticles);
}

function updateRainIntensity(intensity) {
    if (!rainParticles) return;
    rainParticles.material.size = 0.4 + intensity;
}

export function updateRain(deltaTime) {
    if (!rainParticles || !rainParticles.visible) return;

    const positions = rainParticles.geometry.attributes.position.array;
    const count = positions.length / 3;

    for (let i = 0; i < count; i++) {
        positions[i*3+1] -= rainSpeeds[i] * deltaTime;
        if (positions[i*3+1] < -50) {
            positions[i*3+1] = 500 + Math.random() * 100;
            positions[i*3] = (Math.random() - 0.5) * 2000;
            positions[i*3+2] = (Math.random() - 0.5) * 2000;
        }
    }
    rainParticles.geometry.attributes.position.needsUpdate = true;
}