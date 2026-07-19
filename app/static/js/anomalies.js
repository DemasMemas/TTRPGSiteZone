import * as THREE from 'three';

function material(color, opacity = 1) {
    return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

function createLightningLine(color, seed) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    line.userData = { seed };
    return line;
}

function updateLightning(line, time, index) {
    const angle = time * 1.8 + index * 2.1 + line.userData.seed;
    const end = new THREE.Vector3(Math.cos(angle) * 0.5, 0.25 + Math.sin(time + index) * 0.25, Math.sin(angle) * 0.5);
    const positions = line.geometry.attributes.position;
    for (let step = 0; step <= 6; step++) {
        const t = step / 6;
        positions.setXYZ(step,
            end.x * t + (step && step < 6 ? Math.sin(time * 12 + step * 9 + index) * 0.12 : 0),
            end.y * t + (step && step < 6 ? Math.cos(time * 13 + step * 7 + index) * 0.1 : 0),
            end.z * t + (step && step < 6 ? Math.cos(time * 11 + step * 5 + index) * 0.12 : 0)
        );
    }
    positions.needsUpdate = true;
}

export function createAnomalyEffect(type = 'electric', color = '#00ffff', scale = 1) {
    const group = new THREE.Group();
    group.userData.anomalyEffect = { type, phase: Math.random() * Math.PI * 2, scale };
    const tint = new THREE.Color(color);

    if (type === 'fire') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.68, 0.1, 12), material(0xb51c00, 0.9));
        base.position.y = 0.04;
        group.add(base);
        [
            { radius: 0.48, height: 2.15, color: 0xff2600, opacity: 0.45 },
            { radius: 0.34, height: 1.75, color: 0xff7300, opacity: 0.7 },
            { radius: 0.18, height: 1.28, color: 0xffff9a, opacity: 0.92 }
        ].forEach((layer, index) => {
            const flame = new THREE.Mesh(new THREE.ConeGeometry(layer.radius, layer.height, 12), material(layer.color, layer.opacity));
            flame.position.y = layer.height / 2;
            flame.userData.flame = { index, height: layer.height };
            group.add(flame);
        });
    } else if (type === 'electric') {
        group.position.y = 0.62;
        for (let index = 0; index < 5; index++) group.add(createLightningLine(0xd6f6ff, Math.random() * 10));
    } else if (type === 'acid') {
        [0.58, 0.43, 0.27].forEach((radius, index) => {
            const puddle = new THREE.Mesh(new THREE.CircleGeometry(radius, 28), material(index ? 0x8dff3d : tint, 0.34 + index * 0.12));
            puddle.rotation.x = -Math.PI / 2;
            puddle.position.y = 0.025 + index * 0.012;
            puddle.userData.puddle = index;
            group.add(puddle);
        });
        for (let index = 0; index < 7; index++) {
            const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.035 + Math.random() * 0.05, 6, 5), material(0xb6ff8a, 0.7));
            bubble.userData.bubble = { index, phase: Math.random() * Math.PI * 2, radius: Math.random() * 0.35 };
            group.add(bubble);
        }
        for (let index = 0; index < 4; index++) {
            const vapor = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), material(0x8cff6a, 0.18));
            vapor.userData.vapor = { index, phase: Math.random() * Math.PI * 2, radius: 0.15 + Math.random() * 0.25 };
            group.add(vapor);
        }
    } else {
        const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.38, 20, 14), material(tint, 0.22));
        bubble.position.y = 0.68;
        bubble.userData.voidBubble = true;
        group.add(bubble);
        for (let index = 0; index < 3; index++) {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28 + index * 0.07, 0.018, 6, 24), material(0xd8ccff, 0.55));
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.68;
            ring.userData.voidRing = index;
            group.add(ring);
        }
    }
    group.scale.setScalar(scale);
    return group;
}

export function animateAnomalyEffects(roots, time) {
    roots.forEach(root => root?.traverse(node => {
        const effect = node.userData.anomalyEffect;
        if (!effect || !node.visible) return;
        if (node.parent?.isLOD && typeof node.parent.getCurrentLevel === 'function' && node.parent.levels?.[node.parent.getCurrentLevel()]?.object !== node) return;
        const t = time * 0.001 + effect.phase;
        if (effect.type === 'fire') {
            const burst = Math.max(0.035, Math.max(0, Math.sin(t * 0.62)) ** 10);
            node.children.forEach(child => {
                if (!child.userData.flame) return;
                const flame = child.userData.flame;
                child.position.y = flame.height * 0.5 * burst;
                child.scale.set(1 + Math.sin(t * 4 + flame.index) * 0.05, burst, 1 + Math.cos(t * 3 + flame.index) * 0.05);
            });
        } else if (effect.type === 'electric') {
            node.children.forEach((child, index) => {
                if (child.isLine) updateLightning(child, t, index);
            });
            node.rotation.y = t * 0.8;
        } else if (effect.type === 'acid') {
            node.children.forEach(child => {
                if (child.userData.puddle !== undefined) {
                    const pulse = 1 + Math.sin(t * 1.5 + child.userData.puddle) * 0.06;
                    child.scale.set(pulse, 1, pulse);
                    child.rotation.z = t * 0.12 * (child.userData.puddle + 1);
                }
                if (child.userData.bubble) {
                    const bubble = child.userData.bubble;
                    const rise = (t * 0.45 + bubble.phase) % 1;
                    child.position.set(Math.cos(bubble.phase) * bubble.radius, 0.08 + rise * 0.42, Math.sin(bubble.phase) * bubble.radius);
                    child.scale.setScalar(1 - rise * 0.55);
                }
                if (child.userData.vapor) {
                    const vapor = child.userData.vapor;
                    const rise = (t * 0.18 + vapor.phase) % 1;
                    child.position.set(Math.cos(vapor.phase + t) * vapor.radius, 0.25 + rise * 0.7, Math.sin(vapor.phase + t) * vapor.radius);
                    child.scale.setScalar(0.7 + rise * 1.4);
                    child.material.opacity = 0.18 * (1 - rise);
                }
            });
        } else {
            const pulse = 1 + Math.sin(t * 2.5) * 0.16;
            node.scale.setScalar(effect.scale * pulse);
            node.children.forEach(child => {
                if (child.userData.voidRing !== undefined) {
                    child.rotation.z = t * (0.8 + child.userData.voidRing * 0.3);
                    child.position.y = 0.68 + Math.sin(t * 2 + child.userData.voidRing) * 0.12;
                }
                if (child.userData.voidBubble) child.material.opacity = 0.18 + Math.sin(t * 3) * 0.08;
            });
        }
    }));
}
