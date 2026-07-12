// static/js/colors.js
import * as THREE from 'three';

const colorCache = new Map();
let gmId = null;

export function setGmId(id) {
    gmId = id;
}

export function getUserColor(userId) {
    const hex = getUserColorHex(userId);
    return new THREE.Color(hex);
}

export function getUserColorHex(userId) {
    // Если пользователь — GM, возвращаем черный (или серый)
    if (gmId !== null && userId === gmId) {
        return '#222222';
    }
    if (colorCache.has(userId)) {
        return colorCache.get(userId);
    }
    const hue = (userId * 137.508) % 1.0;
    const color = new THREE.Color().setHSL(hue, 0.8, 0.5);
    const hex = '#' + color.getHexString();
    colorCache.set(userId, hex);
    return hex;
}

export function setUserColor(userId, hexColor) {
    if (hexColor && /^#[0-9a-fA-F]{6}$/.test(hexColor)) {
        colorCache.set(userId, hexColor);
    }
}

export async function updateMyColor(newColor) {
    const token = localStorage.getItem('access_token');
    const response = await fetch('/auth/color', {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ color: newColor })
    });
    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update color');
    }
    const data = await response.json();
    const userId = parseInt(localStorage.getItem('user_id'));
    setUserColor(userId, data.color);
    return data;
}