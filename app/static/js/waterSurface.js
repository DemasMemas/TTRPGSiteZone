import * as THREE from 'three';

export function createWaterTexture() {
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

export function createWaterMaterial() {
    return new THREE.MeshStandardMaterial({
        map: createWaterTexture(),
        color: 0xc9e1e3,
        roughness: 0.38,
        metalness: 0.08,
        emissive: 0x07121a,
        transparent: false,
        opacity: 1,
    });
}
