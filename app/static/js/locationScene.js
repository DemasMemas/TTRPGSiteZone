// static/js/locationScene.js
import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'https://unpkg.com/three@0.128.0/examples/jsm/renderers/CSS2DRenderer.js';
import {
    createCompatibleWebGLRenderer,
    createUnavailableRenderer,
    showWebGLUnavailable,
} from './webglSupport.js';
import { showNotification } from './utils.js';
import { getUserColor, getUserColorHex } from './colors.js';
import { Server } from './api.js';
import { createAnomalyEffect, animateAnomalyEffects } from './anomalies.js';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    })[character]);
}

// ========== Глобальные переменные ==========
let scene, camera, renderer, labelRenderer, controls;
let currentLocationId = null;
let currentLocationData = null;
let tileCubes = [];
let locationTileMesh = null;
const tileInstanceTransform = new THREE.Object3D();
let objectMeshes = [];
let anomalyEffectMeshes = [];
let locationObjectMeshes = [];
let groundPlaneMesh;
let characterModels = new Map();
let previewSprite = null;
let contextMenu = null;
let contextMenuCharacterId = null;
let dragCharacter = null;
let isDraggingCharacter = false;
let hoveredCharacterId = null;
let editMode = false;
let brushRadius = 0;
let currentBrushTerrain = 'grass';
let currentBrushHeight = 1.0;
let eraserMode = false;
let brushRadiation = 0.0;
let brushObjectMode = false;
let brushObjectType = 'tree';
let brushObjectColor = '#2d5a27';
let brushObjectOffsetX = 0.0;
let brushObjectOffsetZ = 0.0;
let brushObjectScale = 1.0;
let brushObjectRotation = 0;
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let hoveredTileCoords = null;
let highlightBox = null;
let locationActive = false;
let eventCleanup = null;
let processedTilesForObjects = new Set();
let lastHighlightCoords = null;
window.locationEditMode = false;
let animationFrameId = null;
let combatState = null;
let combatHud = null;
let combatHudDragState = null;
const storedCombatHudCollapsed = window.localStorage.getItem('combatHudCollapsed');
let combatHudCollapsed = storedCombatHudCollapsed === null
    ? null
    : storedCombatHudCollapsed === '1';
let combatActionMenu = null;
let combatActionMenuCharacterId = null;
let pendingCombatAction = null;
let structureActionMenu = null;
let structureActionMenuState = null;
let structureRotationMenu = null;
let structureRotationMenuState = null;
let pendingStructureAction = null;
let containerInteractionMenu = null;
let containerInteractionState = null;
let containerExchangeTarget = null;
let containerInteractionDragState = null;
let medicalConsumableMenu = null;
let medicalConsumableMenuState = null;
let medicalConsumableDragState = null;
let armedMoveCharacterId = null;
let armedMovementType = null;
let movementTypeMenu = null;
let postureMenu = null;
let combatParticipantMenu = null;
let aimedZoneMenu = null;
let aimedZoneMenuResolve = null;
let movementPreviewGhost = null;
let movementPreviewLine = null;
let movementPreviewHint = null;
let movementPreviewCharacterId = null;
let movementPreviewStartX = null;
let movementPreviewStartY = null;
let movementPreviewLastTargetKey = null;
let structureMovePreviewGhost = null;
let structureMovePreviewHint = null;
let structureMovePreviewObjectId = null;
let structureHoverLastObjectId = null;
let attackPreviewLine = null;
let movementMapCache = new Map();
let movementMapVersion = 0;
let locationObjectPickCache = { key: null, result: null };
const locationCameraKeys = new Set();

const COMBAT_MOVEMENT_TYPES = {
    walk: {
        label: 'Ходьба',
        icon: '🚶',
        maxDistance: 10,
        divisor: 1,
        actionPoints: 0,
        freeActions: 0,
        summary: '1 м = 1 ОП',
    },
    correction: {
        label: 'Корректировка',
        icon: '↔',
        maxDistance: 3,
        divisor: null,
        actionPoints: 0,
        freeActions: 1,
        summary: 'До 3 м без траты ОП',
    },
    run: {
        label: 'Бег',
        icon: '🏃',
        maxDistance: 20,
        divisor: 2,
        actionPoints: 2,
        freeActions: 0,
        summary: '1 ОП за каждые 2 м',
    },
    sprint: {
        label: 'Спринт',
        icon: '»',
        maxDistance: 30,
        divisor: 3,
        actionPoints: 4,
        freeActions: 0,
        summary: '1 ОП за каждые 3 м',
    },
};
const COMBAT_POSTURES = {
    standing: {
        label: 'Стоя',
        icon: '↑',
        movementMultiplier: 1,
        walkMaxDistance: 10,
        shootingBonus: 0,
        ergonomicsBonus: 0,
        stealthBonus: 0,
    },
    sitting: {
        label: 'Сидя',
        icon: '↘',
        movementMultiplier: 2,
        walkMaxDistance: 5,
        shootingBonus: 1,
        ergonomicsBonus: 10,
        stealthBonus: 2,
    },
    prone: {
        label: 'Лёжа',
        icon: '▬',
        movementMultiplier: 3,
        walkMaxDistance: 3,
        shootingBonus: 2,
        ergonomicsBonus: 20,
        stealthBonus: 4,
    },
};
let buildMode = 'terrain';
let structurePreset = 'wall';
let structureWidth = 3;
let structureDepth = 0.2;
let structureHeight = 2.4;
let structureColor = '#8b6b4f';
let structureRotation = 0;
let buildPreviewMesh = null;
const structureDeletionInFlight = new Set();
let pendingObjectMoveId = null;
let hoveredStructureObjectId = null;

const objectInteractions = {
    door: ['toggle_door'],
    shelf: ['open_container'],
    chest: ['open_container', 'climb'],
    corpse: ['open_container'],
    table: ['move', 'climb'],
    chair: ['move', 'climb'],
    fence: ['climb']
};

const interactionRequirements = {
    toggle_door: { requires_actor: true, max_distance: 1, checks: ['locked'] },
    open_container: { requires_actor: true, max_distance: 1, checks: ['locked', 'search'] },
    move: { requires_actor: true, max_distance: 1, checks: ['strength', 'weight'] },
    climb: { requires_actor: true, max_distance: 1, checks: ['athletics'] }
};

const LOW_CLIMB_OBJECT_TYPES = new Set(['table', 'chair', 'chest', 'box', 'barrier']);
const HIGH_CLIMB_OBJECT_TYPES = new Set(['fence']);
const TOO_HIGH_OBJECT_TYPES = new Set(['tree', 'rock', 'house', 'tent', 'wall', 'shelf', 'anomaly']);
const PASSABLE_OBJECT_TYPES = new Set(['campfire', 'ground_item']);
const COVER_CLASS_DEFAULTS = {
    conditional: { label: 'Условное', maxHp: 25, protection: 0 },
    flimsy: { label: 'Хлипкое', maxHp: 50, protection: 5 },
    medium: { label: 'Средней прочности', maxHp: 100, protection: 20 },
    strong: { label: 'Прочное', maxHp: 200, protection: 40 },
    very_strong: { label: 'Очень прочное', maxHp: 400, protection: 60 },
    titanium: { label: 'Титановое', maxHp: 800, protection: 90 },
    special: { label: 'Особое', maxHp: 200, protection: 0 },
};

// Хранилище обработчиков для удаления
const handlers = {
    window: {},
    document: {},
    canvas: {}
};

const terrainColors = {
    grass: 0x3a5f0b,
    sand: 0xC2B280,
    rock: 0x808080,
    swamp: 0x4B3B2A,
    water: 0x1E90FF
};

// ========== Вспомогательные функции ==========
function isKeyboardInputTarget(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function updateLocationCameraMovement(deltaSeconds) {
    if (!locationActive || !camera || !controls || locationCameraKeys.size === 0) return;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) return;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const movement = new THREE.Vector3();
    if (locationCameraKeys.has('KeyW')) movement.add(forward);
    if (locationCameraKeys.has('KeyS')) movement.sub(forward);
    if (locationCameraKeys.has('KeyD')) movement.add(right);
    if (locationCameraKeys.has('KeyA')) movement.sub(right);
    if (movement.lengthSq() === 0) return;

    const distanceToTarget = camera.position.distanceTo(controls.target);
    movement.normalize().multiplyScalar(Math.max(6, distanceToTarget * 0.6) * deltaSeconds);
    const oldTarget = controls.target.clone();
    const maxX = Math.max(0, (currentLocationData?.grid_width || 1) - 0.5);
    const maxZ = Math.max(0, (currentLocationData?.grid_height || 1) - 0.5);
    const nextTarget = oldTarget.clone().add(movement);
    nextTarget.x = THREE.MathUtils.clamp(nextTarget.x, 0.5, maxX);
    nextTarget.z = THREE.MathUtils.clamp(nextTarget.z, 0.5, maxZ);
    const appliedMovement = nextTarget.sub(oldTarget);
    controls.target.add(appliedMovement);
    camera.position.add(appliedMovement);
}

function getTileHeight(tileX, tileZ) {
    if (!currentLocationData) return 1.0;
    if (tileZ < 0 || tileZ >= currentLocationData.tiles_data.length) return 1.0;
    const row = currentLocationData.tiles_data[tileZ];
    if (tileX < 0 || tileX >= row.length) return 1.0;
    return row[tileX].height || 1.0;
}

function disposeObject(obj) {
    if (!obj) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
        if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => mat.dispose());
        } else {
            obj.material.dispose();
        }
    }
    if (obj.texture) obj.texture.dispose();
    if (obj.children) {
        obj.children.forEach(child => disposeObject(child));
    }
}

function getPointerWorldPoint(clientX, clientY, planeY = 0) {
    if (!renderer || !camera) return null;
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, point)) return null;
    return point;
}

function createTransparentClone(source, opacity = 0.35) {
    const clone = source.clone(true);
    clone.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        child.material = materials.map((material) => {
            const next = material.clone();
            next.transparent = true;
            next.opacity = opacity;
            next.depthWrite = false;
            return next;
        });
        if (Array.isArray(child.material) && child.material.length === 1) {
            child.material = child.material[0];
        }
    });
    return clone;
}

function createPreviewLine(color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 999;
    return line;
}

function ensureMovementPreviewHint() {
    if (movementPreviewHint) return movementPreviewHint;
    movementPreviewHint = document.createElement('div');
    movementPreviewHint.style.cssText = `
        position: fixed;
        z-index: 1200;
        display: none;
        pointer-events: none;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(8, 12, 18, 0.85);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        border: 1px solid rgba(255,255,255,0.18);
        box-shadow: 0 10px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(8px);
    `;
    document.body.appendChild(movementPreviewHint);
    return movementPreviewHint;
}

function clearMovementPreview() {
    if (movementPreviewGhost && scene) {
        scene.remove(movementPreviewGhost);
        movementPreviewGhost.traverse((child) => {
            if (child.isMesh && child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((material) => material.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        movementPreviewGhost = null;
    }
    if (movementPreviewLine && scene) {
        scene.remove(movementPreviewLine);
        disposeObject(movementPreviewLine);
        movementPreviewLine = null;
    }
    if (movementPreviewHint) {
        movementPreviewHint.style.display = 'none';
    }
    movementPreviewCharacterId = null;
    movementPreviewStartX = null;
    movementPreviewStartY = null;
    movementPreviewLastTargetKey = null;
}

function invalidateMovementMapCache() {
    movementMapVersion += 1;
    movementMapCache.clear();
    locationObjectPickCache = { key: null, result: null };
}

function clearAttackPreview() {
    if (attackPreviewLine && scene) {
        scene.remove(attackPreviewLine);
        disposeObject(attackPreviewLine);
        attackPreviewLine = null;
    }
}

function isCurrentCombatTurnForCharacter(characterId) {
    if (!combatState || combatState.status !== 'active') return true;
    const current = combatState.current_character;
    if (!current) return false;
    return String(current.character_id) === String(characterId) ||
        String(current.location_character_id) === String(characterId);
}

function buildRoutePoints(startX, startY, endX, endY, movingCharacterId = null) {
    const path = findMovementPath(startX, startY, endX, endY, movingCharacterId);
    if (!path?.path?.length) return null;

    const points = [];
    const pushPoint = (x, y, z) => {
        const last = points[points.length - 1];
        if (!last || last.x !== x || last.y !== y || last.z !== z) {
            points.push(new THREE.Vector3(x, y, z));
        }
    };

    path.path.forEach(([x, y]) => {
        pushPoint(x + 0.5, getTileHeight(x, y) + 0.4, y + 0.5);
    });

    const climbCost = path.path.slice(1).reduce((sum, [x, y]) => {
        const profile = getTileMovementProfile(x, y, movingCharacterId);
        return sum + Math.max(0, Number(profile.climbCost) || 0);
    }, 0);
    return {
        points,
        path: path.path,
        cost: path.cost,
        climbCost,
        distance: Math.max(0, path.path.length - 1),
    };
}

function getMovementModeRouteCost(route, movementType = 'walk') {
    const mode = COMBAT_MOVEMENT_TYPES[movementType] || COMBAT_MOVEMENT_TYPES.walk;
    const posture = combatState?.current_character?.posture || 'standing';
    const postureProfile = COMBAT_POSTURES[posture] || COMBAT_POSTURES.standing;
    if (!route) return { movementPoints: Infinity, distance: Infinity };
    const climbCost = Math.max(0, Number(route.climbCost) || 0);
    const travelCost = Math.max(0, (Number(route.cost) || 0) - climbCost);
    const travelMovementPoints = mode.divisor === null
        ? 0
        : Math.ceil((travelCost * postureProfile.movementMultiplier) / mode.divisor);
    const movementPoints = travelMovementPoints + climbCost;
    return {
        movementPoints,
        travelMovementPoints,
        climbCost,
        distance: Math.max(0, Number(route.distance) || 0),
    };
}

function getMovementModeAvailability(movementType, route = null) {
    const mode = COMBAT_MOVEMENT_TYPES[movementType] || COMBAT_MOVEMENT_TYPES.walk;
    const current = combatState?.current_character || {};
    const posture = current.posture || 'standing';
    const postureProfile = current.posture_modifiers || {};
    const maxDistance = movementType === 'walk'
        ? Number(postureProfile.walk_max_distance) || COMBAT_POSTURES[posture]?.walkMaxDistance || mode.maxDistance
        : mode.maxDistance;
    const round = Math.max(1, Number(combatState?.round_number) || 1);
    const usedMode = current.movement_mode_this_turn || null;
    const usedDistance = movementType === 'correction'
        ? Number(current.correction_distance_this_turn) || 0
        : Number(current.movement_distance_this_turn) || 0;
    const routeCost = getMovementModeRouteCost(route, movementType);
    const availableMovement = Number(current.movement_points_current) || 0;
    const climbActionPoints = routeCost.climbCost >= 10 ? 3 : 1;
    const usesClimbAction = Boolean(
        route
        && routeCost.climbCost > 0
        && routeCost.movementPoints > availableMovement
        && routeCost.travelMovementPoints <= availableMovement
        && (Number(current.action_points_current) || 0) >= mode.actionPoints + climbActionPoints
    );
    let reason = '';

    if (usedMode && usedMode !== movementType) {
        reason = 'В этом ходу уже выбран другой вид движения';
    } else if (routeCost.climbCost > 0 && posture !== 'standing') {
        reason = 'Перед перелезанием нужно встать';
    } else if (movementType === 'run' && posture !== 'standing') {
        reason = 'Бег возможен только стоя';
    } else if (movementType === 'sprint' && posture !== 'standing') {
        reason = 'Спринт возможен только стоя';
    } else if (
        ['run', 'sprint'].includes(movementType)
        && current.is_exoskeleton
    ) {
        reason = 'Бег и спринт недоступны в экзоскелете';
    } else if (movementType === 'correction' && posture === 'prone') {
        reason = 'Корректировка недоступна лёжа';
    } else if (
        ['run', 'sprint'].includes(movementType)
        && (Number(current.strenuous_movement_blocked_until_round) || 0) >= round
    ) {
        reason = 'Бег и спринт недоступны из-за одышки';
    } else if ((Number(current.action_points_current) || 0) < mode.actionPoints) {
        reason = `Нужно ${mode.actionPoints} ОД`;
    } else if ((Number(current.free_actions_current) || 0) < mode.freeActions) {
        reason = 'Нужно 1 СД';
    } else if (usedDistance >= maxDistance) {
        reason = 'Лимит дистанции в этом ходу исчерпан';
    } else if (route && usedDistance + routeCost.distance > maxDistance) {
        reason = `Превышен лимит ${maxDistance} м`;
    } else if (
        route
        && routeCost.movementPoints > availableMovement
        && !usesClimbAction
    ) {
        reason = 'Недостаточно ОП';
    }

    return {
        allowed: !reason,
        reason,
        usedDistance,
        remainingDistance: Math.max(0, maxDistance - usedDistance),
        usesClimbAction,
        climbActionPoints: usesClimbAction ? climbActionPoints : 0,
        ...routeCost,
    };
}

function updateMovementPreview(clientX, clientY) {
    if (!movementPreviewCharacterId || !armedMoveCharacterId) return;
    const entry = characterModels.get(movementPreviewCharacterId);
    if (!entry) return;

    const source = movementPreviewGhost || createTransparentClone(entry.model, 0.32);
    if (!movementPreviewGhost) {
        movementPreviewGhost = source;
        movementPreviewGhost.position.copy(entry.model.position);
        movementPreviewGhost.rotation.copy(entry.model.rotation);
        movementPreviewGhost.scale.copy(entry.model.scale);
        scene.add(movementPreviewGhost);
    }

    const point = getPointerWorldPoint(clientX, clientY, entry.model.position.y);
    if (!point) return;
    const targetX = Math.max(0, Math.min((currentLocationData?.grid_width || 1) - 1, Math.floor(point.x)));
    const targetY = Math.max(0, Math.min((currentLocationData?.grid_height || 1) - 1, Math.floor(point.z)));
    const targetKey = `${targetX}:${targetY}`;
    const startX = movementPreviewStartX ?? entry.posX;
    const startY = movementPreviewStartY ?? entry.posY;
    let route = movementPreviewLine?.userData?.route || null;
    let cost = movementPreviewLine?.userData?.cost ?? null;
    let points = movementPreviewLine?.userData?.points || null;

    if (!movementPreviewLine?.userData || movementPreviewLine.userData.targetKey !== targetKey || !points) {
        route = buildRoutePoints(startX, startY, targetX, targetY, movementPreviewCharacterId);
        cost = getMovementModeRouteCost(route, armedMovementType || 'walk').movementPoints;
        points = route?.points || [
            new THREE.Vector3(startX + 0.5, getTileHeight(startX, startY) + 0.4, startY + 0.5),
            new THREE.Vector3(targetX + 0.5, getTileHeight(targetX, targetY) + 0.4, targetY + 0.5),
        ];
        if (movementPreviewLine) {
            movementPreviewLine.userData = movementPreviewLine.userData || {};
            movementPreviewLine.userData.targetKey = targetKey;
            movementPreviewLine.userData.route = route;
            movementPreviewLine.userData.cost = cost;
            movementPreviewLine.userData.points = points;
        }
        movementPreviewLastTargetKey = targetKey;
    }
    const available = combatState?.current_character?.movement_points_current ?? 0;
    const movementType = armedMovementType || 'walk';
    const movementMode = COMBAT_MOVEMENT_TYPES[movementType] || COMBAT_MOVEMENT_TYPES.walk;
    const availability = getMovementModeAvailability(movementType, route);

    if (!movementPreviewLine) {
        movementPreviewLine = createPreviewLine(availability.allowed ? 0x54d17a : 0xff6b6b);
        scene.add(movementPreviewLine);
        movementPreviewLine.userData = {
            targetKey,
            route,
            cost,
            points,
        };
    }
    movementPreviewLine.material.color.setHex(availability.allowed ? 0x54d17a : 0xff6b6b);
    movementPreviewLine.geometry.setFromPoints(points);

    const hint = ensureMovementPreviewHint();
    const costLabel = availability.usesClimbAction
        ? `ОП ${availability.travelMovementPoints}/${available} + ${availability.climbActionPoints} ОД`
        : `ОП ${cost}/${available}`;
    hint.textContent = route
        ? `${movementMode.label}: ${availability.distance} м · ${costLabel}`
        : 'Путь заблокирован';
    hint.style.left = `${clientX + 14}px`;
    hint.style.top = `${clientY + 14}px`;
    hint.style.display = 'block';
    hint.style.color = availability.allowed ? '#d7ffe5' : '#ffd0d0';
}

function updateAttackPreview(clientX, clientY) {
    if (!pendingCombatAction) {
        clearAttackPreview();
        return;
    }
    const actor = findCombatCharacterByCharacterId(pendingCombatAction.actorCharacterId);
    if (!actor) {
        clearAttackPreview();
        return;
    }
    const actorEntry = characterModels.get(actor.character_id);
    if (!actorEntry) {
        clearAttackPreview();
        return;
    }
    if (pendingCombatAction.targetType === 'point') {
        const point = getPointerWorldPoint(clientX, clientY, actorEntry.model.position.y);
        if (!point) {
            clearAttackPreview();
            return;
        }
        if (!attackPreviewLine) {
            attackPreviewLine = createPreviewLine(0xff8c42);
            scene.add(attackPreviewLine);
        }
        const targetX = Math.floor(point.x);
        const targetY = Math.floor(point.z);
        const start = new THREE.Vector3(
            actorEntry.model.position.x,
            actorEntry.model.position.y + 1.6,
            actorEntry.model.position.z
        );
        const end = new THREE.Vector3(
            targetX + 0.5,
            getTileHeight(targetX, targetY) + 0.35,
            targetY + 0.5
        );
        attackPreviewLine.geometry.setFromPoints([start, end]);
        return;
    }
    if (pendingCombatAction.targetType === 'structure') {
        const object = getLocationObjectAtScreen(clientX, clientY);
        if (!object) {
            clearAttackPreview();
            return;
        }
        if (!attackPreviewLine) {
            attackPreviewLine = createPreviewLine(0xff8c42);
            scene.add(attackPreviewLine);
        }
        const start = new THREE.Vector3(
            actorEntry.model.position.x,
            actorEntry.model.position.y + 1.6,
            actorEntry.model.position.z
        );
        const end = new THREE.Vector3();
        object.getWorldPosition(end);
        end.y += 0.5;
        attackPreviewLine.geometry.setFromPoints([start, end]);
        return;
    }
    if (pendingCombatAction.targetType === 'multi_character' && !pendingCombatAction.areaAnchor) {
        const point = getPointerWorldPoint(clientX, clientY, actorEntry.model.position.y);
        if (!point) {
            clearAttackPreview();
            return;
        }
        if (!attackPreviewLine) {
            attackPreviewLine = createPreviewLine(0xff8c42);
            scene.add(attackPreviewLine);
        }
        const targetX = Math.floor(point.x);
        const targetY = Math.floor(point.z);
        const start = new THREE.Vector3(
            actorEntry.model.position.x,
            actorEntry.model.position.y + 1.6,
            actorEntry.model.position.z
        );
        const end = new THREE.Vector3(
            targetX + 0.5,
            getTileHeight(targetX, targetY) + 0.35,
            targetY + 0.5
        );
        attackPreviewLine.geometry.setFromPoints([start, end]);
        return;
    }
    const targetObj = getCharacterAtScreen(clientX, clientY);
    if (!targetObj || !targetObj.userData?.characterId) {
        clearAttackPreview();
        return;
    }
    const target = findCombatCharacterByCharacterId(targetObj.userData.characterId);
    if (!target || target.character_id === actor.character_id) {
        clearAttackPreview();
        return;
    }

    const targetEntry = characterModels.get(target.character_id);
    if (!actorEntry || !targetEntry) {
        clearAttackPreview();
        return;
    }

    if (!attackPreviewLine) {
        attackPreviewLine = createPreviewLine(0xffc94d);
        scene.add(attackPreviewLine);
    }
    const start = new THREE.Vector3(
        actorEntry.model.position.x,
        actorEntry.model.position.y + 1.6,
        actorEntry.model.position.z
    );
    const end = new THREE.Vector3(
        targetEntry.model.position.x,
        targetEntry.model.position.y + 1.6,
        targetEntry.model.position.z
    );
    attackPreviewLine.geometry.setFromPoints([start, end]);
}

function initializeMovementPreview(characterId) {
    movementPreviewCharacterId = characterId;
    const entry = characterModels.get(characterId);
    if (!entry) return;
    clearMovementPreview();
    movementPreviewCharacterId = characterId;
    movementPreviewStartX = entry.posX;
    movementPreviewStartY = entry.posY;
    movementPreviewGhost = createTransparentClone(entry.model, 0.32);
    movementPreviewGhost.position.copy(entry.model.position);
    movementPreviewGhost.rotation.copy(entry.model.rotation);
    movementPreviewGhost.scale.copy(entry.model.scale);
    scene.add(movementPreviewGhost);
}

function commitMovementPreview(clientX, clientY) {
    if (!movementPreviewCharacterId) return false;
    const entry = characterModels.get(movementPreviewCharacterId);
    if (!entry) return false;
    const point = getPointerWorldPoint(clientX, clientY, entry.model.position.y);
    if (!point) return false;

    const targetX = Math.max(0, Math.min((currentLocationData?.grid_width || 1) - 1, Math.floor(point.x)));
    const targetY = Math.max(0, Math.min((currentLocationData?.grid_height || 1) - 1, Math.floor(point.z)));
    const startX = movementPreviewStartX ?? entry.posX;
    const startY = movementPreviewStartY ?? entry.posY;
    const route = buildRoutePoints(startX, startY, targetX, targetY, movementPreviewCharacterId);
    const movementType = armedMovementType || 'walk';
    const availability = getMovementModeAvailability(movementType, route);

    if (!route) {
        showNotification('Путь к выбранной клетке заблокирован', 'system');
        return false;
    }

    if (combatState?.status === 'active' && !availability.allowed) {
        showNotification(availability.reason || 'Это перемещение недоступно', 'system');
        return false;
    }

    if (window.socket && window.currentLocationId) {
        window.socket.emit('move_in_location', {
            token: localStorage.getItem('access_token'),
            location_id: window.currentLocationId,
            character_id: movementPreviewCharacterId,
            x: targetX,
            y: targetY,
            movement_mode: movementType,
        });
    }
    clearMovementPreview();
    armedMoveCharacterId = null;
    armedMovementType = null;
    return true;
}

function getCharacterAtScreen(clientX, clientY) {
    if (!renderer || !camera) return null;
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const models = [];
    characterModels.forEach((entry) => {
        models.push(entry.model);
    });
    const intersects = raycaster.intersectObjects(models, true);
    if (intersects.length > 0) {
        let obj = intersects[0].object;
        while (obj) {
            if (obj.userData && obj.userData.isCharacter) {
                return obj;
            }
            obj = obj.parent;
        }
        return intersects[0].object;
    }
    return null;
}

function getCurrentUserId() {
    return parseInt(localStorage.getItem('user_id') || '0', 10);
}

function findCombatCharacterByLocationId(locationCharacterId) {
    if (!combatState || !Array.isArray(combatState.characters)) return null;
    return combatState.characters.find((item) => item.location_character_id === locationCharacterId) || null;
}

function findCombatCharacterByCharacterId(characterId) {
    if (!combatState || !Array.isArray(combatState.characters)) return null;
    return combatState.characters.find((item) => item.character_id === characterId) || null;
}

function getGrappleMovementContext(characterId) {
    const holder = findCombatCharacterByCharacterId(characterId);
    if (!holder?.grapple_target_id) return null;
    const captive = findCombatCharacterByLocationId(holder.grapple_target_id);
    const holderEntry = getCharacterModelEntry(holder.character_id);
    const captiveEntry = captive ? getCharacterModelEntry(captive.character_id) : null;
    if (!captive || !holderEntry || !captiveEntry) return null;
    return {
        captiveCharacterId: captive.character_id,
        offsetX: captiveEntry.posX - holderEntry.posX,
        offsetY: captiveEntry.posY - holderEntry.posY,
    };
}

function canControlCharacter(characterId) {
    const entry = characterModels.get(characterId);
    if (!entry) return false;
    const myId = getCurrentUserId();
    return Boolean(window.isGM || entry.controlledBy === myId || entry.ownerId === myId);
}

function canActWithCombatCharacter(combatCharacter) {
    if (!combatCharacter) return false;
    const myId = getCurrentUserId();
    return Boolean(window.isGM || combatCharacter.controlled_by === myId || combatCharacter.owner_id === myId);
}

function closeCombatMenus() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
    if (combatActionMenu) {
        combatActionMenu.style.display = 'none';
    }
    contextMenuCharacterId = null;
    combatActionMenuCharacterId = null;
    closeMovementTypeMenu();
    closePostureMenu();
}

function updateCombatHudPosition(left, top) {
    if (!combatHud) return;
    combatHud.style.left = `${Math.max(8, left)}px`;
    combatHud.style.top = `${Math.max(8, top)}px`;
}

function ensureCombatHudDragging() {
    if (!combatHud || combatHud.dataset.dragBound === '1') return;

    const onPointerDown = (event) => {
        const header = event.target.closest?.('.combat-hud-header');
        if (!header || !combatHud.contains(header)) return;
        if (event.target.closest?.('button')) return;
        if (event.button !== 0) return;
        combatHudDragState = {
            offsetX: event.clientX - combatHud.getBoundingClientRect().left,
            offsetY: event.clientY - combatHud.getBoundingClientRect().top,
        };
        combatHud.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    };

    const onPointerMove = (event) => {
        if (!combatHudDragState) return;
        updateCombatHudPosition(event.clientX - combatHudDragState.offsetX, event.clientY - combatHudDragState.offsetY);
    };

    const onPointerUp = () => {
        combatHudDragState = null;
    };

    combatHud.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    combatHud.dataset.dragBound = '1';
    handlers.window.combatHudPointerMove = onPointerMove;
    handlers.window.combatHudPointerUp = onPointerUp;
}

function ensureCombatActionMenu() {
    if (combatActionMenu) return;
    combatActionMenu = document.createElement('div');
    combatActionMenu.id = 'combat-action-menu';
    combatActionMenu.style.cssText = `
        position: fixed;
        width: 280px;
        height: 280px;
        z-index: 1100;
        display: none;
        pointer-events: auto;
        transform: translate(-50%, -50%);
    `;
    combatActionMenu.innerHTML = `
        <div class="combat-menu-core" style="
            position:absolute;
            left:50%;
            top:50%;
            width:84px;
            height:84px;
            transform:translate(-50%, -50%);
            border-radius:50%;
            background:rgba(15,18,28,0.96);
            border:1px solid rgba(255,255,255,0.18);
            color:#fff;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            font-weight:700;
            font-size:13px;
            box-shadow:0 12px 30px rgba(0,0,0,0.4);
            backdrop-filter: blur(8px);
        ">Меню</div>
    `;
    document.body.appendChild(combatActionMenu);
    const onClick = (event) => {
        if (combatActionMenu && !combatActionMenu.contains(event.target)) {
            combatActionMenu.style.display = 'none';
            combatActionMenuCharacterId = null;
        }
    };
    document.addEventListener('click', onClick);
    handlers.document.combatMenuClick = onClick;
}

function isMedicalConsumableItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (item.category === 'consumable') return true;
    const attrs = item.attributes || {};
    return Boolean(
        attrs.consumable ||
        attrs.direct ||
        attrs.effects ||
        attrs.status_additions?.length ||
        attrs.status_removals?.length
    );
}

function getMedicalConsumableEntries(characterData) {
    return getCharacterTransferEntries(characterData)
        .filter((entry) => isMedicalConsumableItem(entry.item))
        .sort((a, b) => {
            const rootCompare = String(a.rootLabel || '').localeCompare(String(b.rootLabel || ''), 'ru');
            if (rootCompare !== 0) return rootCompare;
            return String(a.item?.name || '').localeCompare(String(b.item?.name || ''), 'ru');
        });
}

function closeMedicalConsumableMenu() {
    if (medicalConsumableMenu) {
        medicalConsumableMenu.style.display = 'none';
    }
    medicalConsumableMenuState = null;
    medicalConsumableDragState = null;
}

function ensureMedicalConsumableMenu() {
    if (medicalConsumableMenu) return;
    medicalConsumableMenu = document.createElement('div');
    medicalConsumableMenu.id = 'medical-consumable-menu';
    medicalConsumableMenu.style.cssText = `
        position: fixed;
        width: min(520px, calc(100vw - 24px));
        height: min(72vh, 720px);
        max-height: calc(100vh - 24px);
        z-index: 1215;
        display: none;
        flex-direction: column;
        pointer-events: auto;
        background: rgba(14, 18, 26, 0.98);
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 16px;
        box-shadow: 0 20px 42px rgba(0,0,0,0.45);
        color: #fff;
        backdrop-filter: blur(10px);
        font-family: 'Segoe UI', Arial, sans-serif;
        overflow: hidden;
    `;
    document.body.appendChild(medicalConsumableMenu);

    const onClick = (event) => {
        if (medicalConsumableMenu && !medicalConsumableMenu.contains(event.target)) {
            closeMedicalConsumableMenu();
        }
    };
    document.addEventListener('click', onClick);
    handlers.document.medicalMenuClick = onClick;

    medicalConsumableMenu.addEventListener('pointerdown', (event) => {
        const dragHandle = event.target.closest('.medical-menu-drag-handle');
        if (!dragHandle || event.button !== 0) return;
        if (event.target.closest('button, select, input, textarea, option, label')) return;
        const rect = medicalConsumableMenu.getBoundingClientRect();
        medicalConsumableDragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
        };
        dragHandle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    });

    document.addEventListener('pointermove', (event) => {
        if (
            !medicalConsumableDragState
            || medicalConsumableDragState.pointerId !== event.pointerId
            || !medicalConsumableMenu
        ) return;
        const rect = medicalConsumableMenu.getBoundingClientRect();
        const minLeft = 8;
        const minTop = 8;
        const maxLeft = Math.max(minLeft, window.innerWidth - rect.width - 8);
        const maxTop = Math.max(minTop, window.innerHeight - rect.height - 8);
        const left = Math.min(
            Math.max(minLeft, event.clientX - medicalConsumableDragState.offsetX),
            maxLeft
        );
        const top = Math.min(
            Math.max(minTop, event.clientY - medicalConsumableDragState.offsetY),
            maxTop
        );
        medicalConsumableMenu.style.left = `${left}px`;
        medicalConsumableMenu.style.top = `${top}px`;
    });

    const stopMedicalMenuDrag = (event) => {
        if (!medicalConsumableDragState) return;
        if (
            event?.pointerId !== undefined
            && medicalConsumableDragState.pointerId !== event.pointerId
        ) return;
        medicalConsumableDragState = null;
    };
    document.addEventListener('pointerup', stopMedicalMenuDrag);
    document.addEventListener('pointercancel', stopMedicalMenuDrag);
}

async function showMedicalConsumableMenu(characterId, forcedTargetCharacterId = null) {
    ensureMedicalConsumableMenu();
    medicalConsumableMenuState = { characterId };

    const character = await Server.getCharacter(characterId).catch(() => null);
    const actorLocationCharacterId = findCombatCharacterByCharacterId(characterId)?.location_character_id
        || pendingStructureAction?.actorLocationCharacterId;
    const interactionTarget = forcedTargetCharacterId && actorLocationCharacterId
        ? await Server.inspectLocationCharacter(
            window.currentLobbyId,
            getCurrentLocationId(),
            forcedTargetCharacterId,
            actorLocationCharacterId
        ).catch(() => null)
        : null;
    const characterData = character?.data || null;
    const consumables = characterData ? getMedicalConsumableEntries(characterData) : [];

    medicalConsumableMenu.innerHTML = `
        <div class="medical-menu-drag-handle" style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.08); cursor:move; user-select:none; touch-action:none;">
            <div style="font-weight:700;">Расходники</div>
            <button type="button" class="medical-close-btn" style="width:32px; height:32px; border-radius:999px; border:0; background:rgba(255,255,255,0.08); color:#fff; cursor:pointer; font-size:18px; line-height:1;">×</button>
        </div>
        <div style="padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.06); opacity:0.8; font-size:13px;">
            Быстрый список предметов, которые можно использовать прямо из боя.
        </div>
        <div class="medical-menu-body" style="flex:1 1 auto; min-height:0; padding:12px 14px; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable;"></div>
    `;

    const body = medicalConsumableMenu.querySelector('.medical-menu-body');
    if (!characterData) {
        body.innerHTML = '<div style="opacity:0.75;">Не удалось загрузить персонажа</div>';
    } else if (!consumables.length) {
        body.innerHTML = '<div style="opacity:0.75;">В инвентаре нет расходников</div>';
    } else {
        consumables.forEach((entry) => {
            const item = entry.item || {};
            const row = document.createElement('button');
            row.type = 'button';
            row.style.cssText = `
                width:100%;
                display:flex;
                justify-content:space-between;
                align-items:center;
                gap:12px;
                padding:10px 12px;
                margin-bottom:8px;
                border-radius:12px;
                border:1px solid rgba(255,255,255,0.10);
                background:rgba(255,255,255,0.04);
                color:#fff;
                cursor:pointer;
                text-align:left;
            `;
            row.innerHTML = `
                <div style="min-width:0;">
                    <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${item.name || 'Расходник'}</div>
                    <div style="opacity:0.72; font-size:12px;">${entry.rootLabel || 'Инвентарь'}${item.quantity > 1 ? ` · ${item.quantity} шт.` : ''}</div>
                </div>
                <div style="flex:0 0 auto; padding:6px 10px; border-radius:999px; background:rgba(108,176,111,0.18); color:#d8ffd8; font-weight:700;">Использовать</div>
            `;
            row.onclick = async (event) => {
                event.stopPropagation();
                try {
                    const module = await import('./characterSheet.js');
                    const direct = item.attributes?.consumable?.direct || {};
                    const needsTarget = direct.target_required
                        || direct.application_form === 'injectable'
                        || direct.requires_injury
                        || direct.wound_treatment
                        || direct.requires_infusion_tool;
                    if (needsTarget && !forcedTargetCharacterId) {
                        const actor = findCombatCharacterByCharacterId(characterId);
                        if (!actor) throw new Error('Не удалось найти действующего персонажа');
                        beginPendingCombatAction({
                            actorCharacterId: characterId,
                            actorLocationCharacterId: actor.location_character_id,
                            actionKey: 'use_item',
                            itemPath: entry.path,
                            itemId: item.id,
                            onResolve: ({ targetCharacterId }) => module.useCharacterInventoryItem(
                                characterId,
                                entry.path,
                                { itemId: item.id, targetCharacterId }
                            ),
                        });
                    } else {
                        await module.useCharacterInventoryItem(characterId, entry.path, {
                            itemId: item.id,
                            targetCharacterId: forcedTargetCharacterId || undefined,
                            targetData: interactionTarget?.target_data,
                            interactionContext: forcedTargetCharacterId ? {
                                lobbyId: window.currentLobbyId,
                                locationId: getCurrentLocationId(),
                                actorLocationCharacterId,
                            } : undefined,
                        });
                    }
                    closeMedicalConsumableMenu();
                } catch (error) {
                    showNotification(error.message || 'Не удалось использовать расходник', 'system');
                }
            };
            body.appendChild(row);
        });
    }

    const closeBtn = medicalConsumableMenu.querySelector('.medical-close-btn');
    if (closeBtn) closeBtn.onclick = () => closeMedicalConsumableMenu();

    medicalConsumableMenu.style.display = 'flex';
    medicalConsumableMenu.style.visibility = 'hidden';

    const rect = medicalConsumableMenu.getBoundingClientRect();
    let left = window.innerWidth / 2 - rect.width / 2;
    let top = window.innerHeight / 2 - rect.height / 2;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    left = Math.min(left, Math.max(8, window.innerWidth - rect.width - 8));
    top = Math.min(top, Math.max(8, window.innerHeight - rect.height - 8));
    medicalConsumableMenu.style.left = `${left}px`;
    medicalConsumableMenu.style.top = `${top}px`;
    medicalConsumableMenu.style.visibility = 'visible';
}

function showCombatActionMenu(clientX, clientY, characterId) {
    ensureCombatActionMenu();
    combatActionMenuCharacterId = characterId;
    const combatCharacter = findCombatCharacterByCharacterId(characterId);
    const condition = getLocationCharacterCondition(characterId);
    const canAct = canActWithCombatCharacter(combatCharacter) && condition.state === 'active';
    const isCurrentTurn = Boolean(
        combatState?.status !== 'active' ||
        combatState?.current_character?.character_id === combatCharacter?.character_id
    );
    const hasFullAccess = !combatState || combatState.status !== 'active' ? canControlCharacter(characterId) : (canAct && isCurrentTurn);
    let menuItems = [
        {
            label: 'Движение',
            title: 'Перетащить персонажа по карте',
            angle: -90,
            action: () => startCharacterMoveMode(characterId),
        },
        {
            label: 'Атака',
            title: 'Открыть экипировку для выбора оружия и типа атаки',
            angle: -38,
            action: () => import('./characterSheet.js').then(module => module.openCharacterSheet(characterId, 'equipment')),
        },
        {
            label: 'Положение',
            icon: '↕',
            title: 'Встать, сесть или лечь',
            angle: 222,
            action: () => showPostureMenu(characterId),
        },
        {
            label: 'Инвентарь',
            title: 'Открыть вкладку инвентаря',
            angle: 118,
            action: () => import('./characterSheet.js').then(module => module.openCharacterSheet(characterId, 'inventory')),
            allowAlways: true,
        },
        {
            label: 'Мед',
            icon: '✚',
            title: 'Быстрый выбор расходников',
            angle: 66,
            action: () => showMedicalConsumableMenu(characterId),
        },
        {
            label: 'ОП',
            title: 'Преобразовать СД в ОП',
            angle: 170,
            action: () => {
                const combatCharacter = findCombatCharacterByCharacterId(characterId);
                if (!combatCharacter || !combatCharacter.location_character_id) {
                    showNotification('Не удалось найти персонажа в бою', 'system');
                    return;
                }
                Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
                    location_character_id: combatCharacter.location_character_id,
                    action_key: 'convert_free_action_to_movement',
                }).catch((error) => {
                    showNotification(error.message || 'Не удалось получить ОП', 'system');
                });
            },
        },
    ];

    if (condition.state === 'pain_shock') {
        menuItems = condition.can_recover === false ? [{
            label: 'Боль 10',
            icon: '!',
            title: 'Выход из болевого шока невозможен, пока боль не снизится до 9',
            angle: -90,
            requiresCombat: true,
            allowIncapacitated: true,
            action: () => showNotification(
                'Сначала снизьте уровень боли хотя бы до 9',
                'system'
            ),
        }] : [{
            label: 'Очнуться',
            icon: '◉',
            title: 'Совершить проверку Воли и попытаться выйти из болевого шока',
            angle: -90,
            requiresCombat: true,
            allowIncapacitated: true,
            action: async () => {
                try {
                    const result = await Server.performLocationCombatAction(
                        window.currentLobbyId,
                        getCurrentLocationId(),
                        {
                            location_character_id: combatCharacter.location_character_id,
                            action_key: 'recover_from_shock',
                        }
                    );
                    const check = result?.melee_action || {};
                    const rolls = Array.isArray(check.rolls) ? check.rolls.join(', ') : check.roll;
                    showNotification(
                        `${check.success ? 'Персонаж очнулся и остался лежать' : 'Персонаж не смог очнуться'}: d20 ${rolls}, СЛ ${check.difficulty ?? '?'}. Ход завершён`,
                        check.success ? 'success' : 'system'
                    );
                } catch (error) {
                    showNotification(error.message || 'Не удалось попытаться очнуться', 'system');
                }
            },
        }];
    } else if (condition.state !== 'active') {
        menuItems = [];
    }

    if (condition.state === 'active') {
        menuItems.push({
            label: 'Ближний бой',
            icon: '⚔',
            title: 'Замах, блок, толкание, захват и другие действия ближнего боя',
            angle: -116,
            ringRadius: 165,
            requiresCombat: true,
            action: () => showMeleeCombatMenu(characterId),
        });

        menuItems.splice(2, 0, {
            label: 'Взаим.',
            title: 'Действия со структурой или недееспособным персонажем',
            angle: 14,
            action: () => beginStructureInteractionMode(characterId),
        });
    }
    if (window.isGM) {
        menuItems.push({
            label: 'Убрать',
            icon: '×',
            title: 'Убрать модель персонажа с подлокации',
            angle: -64,
            ringRadius: 165,
            allowAlways: true,
            danger: true,
            action: () => removeCharacterFromCurrentLocation(characterId),
        });
    }

    combatActionMenu.style.width = window.isGM ? '410px' : '280px';
    combatActionMenu.style.height = window.isGM ? '410px' : '280px';

    combatActionMenu.innerHTML = `
        <div class="combat-menu-core" style="
            position:absolute;
            left:50%;
            top:50%;
            width:84px;
            height:84px;
            transform:translate(-50%, -50%);
            border-radius:50%;
            background:rgba(15,18,28,0.96);
            border:1px solid rgba(255,255,255,0.18);
            color:#fff;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            font-weight:700;
            font-size:13px;
            box-shadow:0 12px 30px rgba(0,0,0,0.4);
            backdrop-filter: blur(8px);
        ">${condition.state === 'active' ? (canAct ? 'Действия' : 'Просмотр') : condition.label}</div>
    `;

    const radius = 98;
    menuItems.forEach((item) => {
        const angle = item.angle;
        const itemRadius = item.ringRadius || radius;
        const button = document.createElement('button');
        button.type = 'button';
        button.innerHTML = item.icon ? `<span style="font-size:22px; line-height:1;">${item.icon}</span>` : item.label;
        button.title = item.title;
        button.style.cssText = `
            position:absolute;
            left:50%;
            top:50%;
            width:74px;
            min-height:74px;
            transform: translate(-50%, -50%) translate(${Math.cos((angle * Math.PI) / 180) * itemRadius}px, ${Math.sin((angle * Math.PI) / 180) * itemRadius}px);
            border-radius:50%;
            border:1px solid rgba(255,255,255,0.18);
            background: rgba(32, 36, 48, 0.96);
            color: #fff;
            font-size: 12px;
            font-weight: 600;
            line-height: 1.1;
            cursor: pointer;
            box-shadow: 0 8px 18px rgba(0,0,0,0.35);
            backdrop-filter: blur(8px);
            padding: 8px;
        `;
        const allowed = (
            item.allowAlways
            || hasFullAccess
            || (item.allowIncapacitated && canControlCharacter(characterId) && isCurrentTurn)
        )
            && (!item.requiresCombat || combatState?.status === 'active');
        button.disabled = !allowed;
        button.style.opacity = allowed ? '1' : '0.45';
        if (item.danger) {
            button.style.background = 'rgba(105, 31, 28, 0.97)';
            button.style.borderColor = 'rgba(225, 108, 94, 0.72)';
        }
        if (item.icon) {
            button.style.fontSize = '22px';
            button.style.fontWeight = '800';
        }
        button.onclick = (event) => {
            event.stopPropagation();
            combatActionMenu.style.display = 'none';
            combatActionMenuCharacterId = null;
            item.action();
        };
        combatActionMenu.appendChild(button);
    });

    let left = clientX;
    let top = clientY;
    combatActionMenu.style.display = 'block';
    const rect = combatActionMenu.getBoundingClientRect();
    if (left + rect.width / 2 > window.innerWidth) left = window.innerWidth - rect.width / 2 - 10;
    if (top + rect.height / 2 > window.innerHeight) top = window.innerHeight - rect.height / 2 - 10;
    if (left < rect.width / 2 + 10) left = rect.width / 2 + 10;
    if (top < rect.height / 2 + 10) top = rect.height / 2 + 10;
    combatActionMenu.style.left = `${left}px`;
    combatActionMenu.style.top = `${top}px`;
}

function showMeleeCombatMenu(characterId) {
    const actor = findCombatCharacterByCharacterId(characterId);
    if (!actor?.location_character_id || !isCurrentCombatTurnForCharacter(characterId)) {
        showNotification('Сейчас не ход этого персонажа', 'system');
        return;
    }
    let menu = document.getElementById('melee-combat-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'melee-combat-menu';
        menu.style.cssText = `
            position:fixed; inset:0; z-index:10040; display:none;
            align-items:center; justify-content:center; background:rgba(0,0,0,.38);
        `;
        menu.addEventListener('pointerdown', (event) => {
            if (event.target === menu) menu.style.display = 'none';
        });
        document.body.appendChild(menu);
    }
    const directAction = async (actionKey, extra = {}) => {
        try {
            const result = await Server.performLocationCombatAction(
                window.currentLobbyId,
                getCurrentLocationId(),
                {
                    location_character_id: actor.location_character_id,
                    action_key: actionKey,
                    ...extra,
                }
            );
            const details = result?.melee_action;
            const outcome = details?.success === undefined
                ? ''
                : (details.success ? ' Успех.' : ' Провал.');
            showNotification(`${extra.label || actionKey}.${outcome}`, details?.success === false ? 'system' : 'success');
            menu.style.display = 'none';
        } catch (error) {
            showNotification(error.message || 'Не удалось выполнить действие', 'system');
        }
    };
    const targetAction = (actionKey, extra = {}) => {
        menu.style.display = 'none';
        beginPendingCombatAction({
            actorCharacterId: characterId,
            actorLocationCharacterId: actor.location_character_id,
            actionKey,
            ...extra,
        });
    };
    const actions = [
        { label: 'Замах · 1 ОД', run: () => directAction('melee_swing', { label: 'Замах подготовлен' }) },
        { label: 'Выхватить вещь · 3 ОД', run: () => targetAction('melee_disarm') },
        { label: 'Толкнуть · 2 ОД', run: () => targetAction('melee_shove') },
        { label: 'Захват · 4 ОД', run: () => targetAction('grapple') },
    ];
    if (actor.grappled_by_id) {
        actions.push({
            label: 'Освободиться · 4 ОД',
            run: () => directAction('grapple_escape', { label: 'Попытка освобождения' }),
        });
        actions.push({
            label: 'Отчаянная атака · 3 ОД',
            run: () => directAction('grapple_desperate_attack', { label: 'Отчаянная атака' }),
        });
    }
    if (actor.grapple_target_id) {
        actions.push(
            { label: 'Усилить хват · 3 ОД', run: () => directAction('grapple_strengthen', { label: 'Хват усилен' }) },
            { label: 'Живой щит · 3 ОД', run: () => directAction('grapple_live_shield', { label: 'Цель используется как живой щит' }) },
            { label: 'Удушение · 5 ОД', run: () => directAction('grapple_choke', { label: 'Удушение' }) },
            { label: 'Болевой прием · 3 ОД', run: () => directAction('grapple_pain_hold', { label: 'Болевой прием' }) },
            { label: 'Отпустить · 1 СД', run: () => directAction('grapple_release', { label: 'Цель отпущена' }) },
        );
    }
    const blockButtons = [1, 2, 3, 4].map(cost =>
        `<button type="button" class="btn btn-sm btn-secondary melee-block-option" data-cost="${cost}">Блок · ${cost} ОД</button>`
    ).join('');
    menu.innerHTML = `
        <div style="width:min(540px,calc(100vw - 24px)); max-height:calc(100vh - 30px);
            overflow:auto; padding:16px; border:1px solid rgba(255,255,255,.16);
            border-radius:14px; background:rgba(20,24,22,.98); color:#eee;
            box-shadow:0 18px 55px rgba(0,0,0,.55);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <strong>Ближний бой</strong>
                <button type="button" class="btn btn-sm btn-secondary melee-menu-close">×</button>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px;">${blockButtons}</div>
            <div class="melee-action-options" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;"></div>
        </div>
    `;
    menu.querySelector('.melee-menu-close').onclick = () => { menu.style.display = 'none'; };
    menu.querySelectorAll('.melee-block-option').forEach((button) => {
        button.onclick = () => directAction('melee_block', {
            action_points: Number(button.dataset.cost),
            label: `Блок за ${button.dataset.cost} ОД`,
        });
    });
    const container = menu.querySelector('.melee-action-options');
    actions.forEach((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm btn-primary';
        button.textContent = entry.label;
        button.onclick = entry.run;
        container.appendChild(button);
    });
    menu.style.display = 'flex';
}

async function removeCharacterFromCurrentLocation(characterId) {
    if (!window.isGM || !window.currentLobbyId || !getCurrentLocationId()) return;
    const entry = getCharacterModelEntry(characterId);
    const name = entry?.name || `#${characterId}`;
    if (!window.confirm(`Убрать ${name} с этой подлокации? Лист персонажа сохранится.`)) {
        return;
    }
    try {
        const response = await fetch(
            `/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/characters/${characterId}`,
            {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                },
            },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'Не удалось убрать персонажа');
        }
        showNotification(`${name} убран с подлокации`, 'success');
    } catch (error) {
        showNotification(error.message || 'Не удалось убрать персонажа', 'error');
    }
}

function getCombatMenuState() {
    const current = combatState?.current_character || null;
    const myId = getCurrentUserId();
    const canAct = Boolean(current) && (window.isGM || current.controlled_by === myId || current.owner_id === myId);
    return { current, canAct };
}

function closeMovementTypeMenu() {
    if (movementTypeMenu) movementTypeMenu.style.display = 'none';
}

function closeAimedZoneMenu(result = null) {
    if (aimedZoneMenu) aimedZoneMenu.style.display = 'none';
    if (aimedZoneMenuResolve) {
        const resolve = aimedZoneMenuResolve;
        aimedZoneMenuResolve = null;
        resolve(result);
    }
}

function selectAimedTargetZone(targetName) {
    closeAimedZoneMenu();
    if (!aimedZoneMenu) {
        aimedZoneMenu = document.createElement('div');
        aimedZoneMenu.id = 'combat-aimed-zone-menu';
        aimedZoneMenu.style.cssText = `
            position:fixed;
            inset:0;
            z-index:1240;
            display:none;
            align-items:center;
            justify-content:center;
            padding:16px;
            background:rgba(4, 7, 10, 0.62);
            backdrop-filter:blur(3px);
        `;
        aimedZoneMenu.addEventListener('pointerdown', (event) => {
            if (event.target === aimedZoneMenu) closeAimedZoneMenu();
        });
        document.body.appendChild(aimedZoneMenu);
    }
    const zones = [
        { key: 'head', label: 'Голова', icon: '●', note: '+5 к сложности' },
        { key: 'chest', label: 'Грудь', icon: '▰', note: 'Торс' },
        { key: 'abdomen', label: 'Живот', icon: '◆', note: 'Торс' },
        { key: 'left_arm', label: 'Левая рука', icon: '◀', note: 'Конечность' },
        { key: 'right_arm', label: 'Правая рука', icon: '▶', note: 'Конечность' },
        { key: 'left_leg', label: 'Левая нога', icon: '↙', note: 'Конечность' },
        { key: 'right_leg', label: 'Правая нога', icon: '↘', note: 'Конечность' },
    ];
    aimedZoneMenu.innerHTML = `
        <div style="
            width:min(660px, calc(100vw - 32px));
            max-height:calc(100vh - 32px);
            overflow-y:auto;
            padding:18px;
            border-radius:16px;
            border:1px solid rgba(255,255,255,0.16);
            background:rgba(14,18,26,0.98);
            color:#fff;
            box-shadow:0 24px 60px rgba(0,0,0,0.48);
        ">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px;">
                <div>
                    <div style="font-size:19px; font-weight:800;">Куда прицелиться</div>
                    <div style="margin-top:3px; opacity:0.7; font-size:12px;">Цель: ${escapeHtml(targetName || 'персонаж')}</div>
                </div>
                <button type="button" class="aimed-zone-close" style="
                    width:34px; height:34px; border:0; border-radius:50%;
                    background:rgba(255,255,255,0.08); color:#fff; cursor:pointer; font-size:20px;
                ">×</button>
            </div>
            <div class="aimed-zone-options" style="
                display:grid;
                grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));
                gap:10px;
            "></div>
        </div>
    `;
    const options = aimedZoneMenu.querySelector('.aimed-zone-options');
    zones.forEach((zone) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.style.cssText = `
            min-height:108px;
            padding:13px 10px;
            border-radius:13px;
            border:1px solid rgba(184,164,110,0.36);
            background:rgba(184,164,110,0.09);
            color:#fff;
            cursor:pointer;
            text-align:center;
        `;
        button.innerHTML = `
            <span style="display:block; font-size:31px; line-height:1;">${zone.icon}</span>
            <strong style="display:block; margin-top:10px; font-size:14px;">${zone.label}</strong>
            <span style="display:block; margin-top:4px; font-size:11px; opacity:0.68;">${zone.note}</span>
        `;
        button.onclick = () => closeAimedZoneMenu(zone.key);
        options.appendChild(button);
    });
    aimedZoneMenu.querySelector('.aimed-zone-close').onclick = () => closeAimedZoneMenu();
    aimedZoneMenu.style.display = 'flex';
    return new Promise((resolve) => {
        aimedZoneMenuResolve = resolve;
    });
}

function closePostureMenu() {
    if (postureMenu) postureMenu.style.display = 'none';
}

function ensurePostureMenu() {
    if (postureMenu) return postureMenu;
    postureMenu = document.createElement('div');
    postureMenu.id = 'combat-posture-menu';
    postureMenu.style.cssText = `
        position:fixed;
        inset:0;
        z-index:1235;
        display:none;
        align-items:center;
        justify-content:center;
        padding:16px;
        background:rgba(4, 7, 10, 0.58);
        backdrop-filter:blur(3px);
    `;
    postureMenu.addEventListener('pointerdown', (event) => {
        if (event.target === postureMenu) closePostureMenu();
    });
    document.body.appendChild(postureMenu);
    return postureMenu;
}

function posturePaymentLabel(option) {
    if (option.resource === 'action') return `${option.cost} ОД`;
    return `${option.cost} ОП`;
}

function movementModeSummary(key, mode, posture) {
    if (key !== 'walk') return mode.summary;
    if (posture === 'sitting') return 'Сидя: 1 м = 2 ОП, не более 5 м';
    if (posture === 'prone') return 'Ползком: 1 м = 3 ОП, не более 3 м';
    return mode.summary;
}

function showPostureMenu(characterId) {
    const isCombatActive = combatState?.status === 'active';
    const character = isCombatActive
        ? findCombatCharacterByCharacterId(characterId)
        : getCharacterModelEntry(characterId);
    if (!character) {
        showNotification('Персонаж не найден на подлокации', 'system');
        return;
    }
    const canChangePosture = isCombatActive
        ? canActWithCombatCharacter(character)
        : canControlCharacter(characterId);
    if (!canChangePosture) {
        showNotification(
            isCombatActive ? 'Сейчас не ход этого персонажа' : 'Вы не управляете этим персонажем',
            'system',
        );
        return;
    }

    const menu = ensurePostureMenu();
    const currentPosture = character.posture || 'standing';
    menu.innerHTML = `
        <div class="posture-panel" style="
            width:min(620px, calc(100vw - 32px));
            max-height:calc(100vh - 32px);
            overflow-y:auto;
            padding:18px;
            border-radius:16px;
            border:1px solid rgba(255,255,255,0.16);
            background:rgba(14,18,26,0.98);
            color:#fff;
            box-shadow:0 24px 60px rgba(0,0,0,0.48);
        ">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px;">
                <div>
                    <div style="font-size:19px; font-weight:800;">Смена положения</div>
                    <div style="margin-top:3px; opacity:0.7; font-size:12px;">
                        ${isCombatActive
                            ? `Сейчас: ${COMBAT_POSTURES[currentPosture]?.label || 'Стоя'} · ОД ${character.action_points_current ?? 0} · ОП ${character.movement_points_current ?? 0}`
                            : `Сейчас: ${COMBAT_POSTURES[currentPosture]?.label || 'Стоя'} · вне боя бесплатно`}
                    </div>
                </div>
                <button type="button" class="posture-close" style="
                    width:34px; height:34px; border:0; border-radius:50%;
                    background:rgba(255,255,255,0.08); color:#fff; cursor:pointer;
                    font-size:20px;
                ">×</button>
            </div>
            <div class="posture-options" style="display:grid; gap:10px;"></div>
        </div>
    `;

    const options = menu.querySelector('.posture-options');
    Object.entries(COMBAT_POSTURES).forEach(([targetPosture, profile]) => {
        if (targetPosture === currentPosture) return;
        const paymentOptions = isCombatActive
            ? (character.posture_change_options?.[targetPosture] || [])
            : [{ resource: 'free', cost: 0 }];
        const card = document.createElement('div');
        card.style.cssText = `
            display:grid;
            grid-template-columns:46px minmax(0, 1fr) auto;
            gap:12px;
            align-items:center;
            padding:13px;
            border-radius:13px;
            border:1px solid rgba(184,164,110,0.3);
            background:rgba(184,164,110,0.07);
        `;
        card.innerHTML = `
            <span style="font-size:28px; text-align:center;">${profile.icon}</span>
            <span>
                <strong style="display:block; font-size:15px;">${profile.label}</strong>
                <span style="display:block; margin-top:4px; font-size:12px; opacity:0.75;">
                    Стрельба +${profile.shootingBonus} · Эргономика +${profile.ergonomicsBonus} ·
                    Скрытность +${profile.stealthBonus}
                </span>
            </span>
            <span class="posture-payment-buttons" style="display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-end;"></span>
        `;
        const paymentButtons = card.querySelector('.posture-payment-buttons');
        paymentOptions.forEach((option) => {
            const available = option.resource === 'free'
                || (
                    option.resource === 'action'
                        ? Number(character.action_points_current) >= option.cost
                        : Number(character.movement_points_current) >= option.cost
                );
            const button = document.createElement('button');
            button.type = 'button';
            button.disabled = !available;
            button.textContent = option.resource === 'free'
                ? 'Сменить'
                : posturePaymentLabel(option);
            button.title = available ? `Перейти в положение «${profile.label}»` : 'Недостаточно ресурсов';
            button.style.cssText = `
                min-width:58px;
                padding:8px 10px;
                border-radius:9px;
                border:1px solid rgba(255,255,255,0.16);
                background:${available ? 'rgba(184,164,110,0.2)' : 'rgba(255,255,255,0.04)'};
                color:#fff;
                cursor:${available ? 'pointer' : 'not-allowed'};
                opacity:${available ? '1' : '0.42'};
            `;
            button.onclick = async () => {
                menu.querySelectorAll('button').forEach((item) => {
                    item.disabled = true;
                });
                try {
                    if (isCombatActive) {
                        await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
                            location_character_id: character.location_character_id,
                            action_key: 'change_posture',
                            posture: targetPosture,
                            payment: option.resource,
                        });
                    } else {
                        const response = await fetch(
                            `/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/characters/${characterId}/posture`,
                            {
                                method: 'PATCH',
                                headers: {
                                    'Content-Type': 'application/json',
                                    Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                                },
                                body: JSON.stringify({ posture: targetPosture }),
                            },
                        );
                        const payload = await response.json().catch(() => ({}));
                        if (!response.ok) {
                            throw new Error(payload.error || 'Не удалось изменить положение');
                        }
                    }
                    closePostureMenu();
                    showNotification(`Положение изменено: ${profile.label}`, 'success');
                } catch (error) {
                    showNotification(error.message || 'Не удалось изменить положение', 'system');
                    showPostureMenu(characterId);
                }
            };
            paymentButtons.appendChild(button);
        });
        options.appendChild(card);
    });

    menu.querySelector('.posture-close').onclick = closePostureMenu;
    menu.style.display = 'flex';
}

function showBracePaymentMenu(characterId) {
    const character = findCombatCharacterByCharacterId(characterId);
    if (!character?.cover_object_id) {
        showNotification('Сначала займите укрытие', 'system');
        return;
    }
    if (character.drawn_weapon_index === null || character.drawn_weapon_index === undefined) {
        showNotification('Сначала возьмите оружие в руки', 'system');
        return;
    }
    const options = [
        { payment: 'action', label: '1 ОД', available: Number(character.action_points_current) >= 1 },
        { payment: 'free', label: '1 СД', available: Number(character.free_actions_current) >= 1 },
        { payment: 'movement', label: '3 ОП', available: Number(character.movement_points_current) >= 3 },
    ];
    const menu = ensurePostureMenu();
    menu.innerHTML = `
        <div style="width:min(430px, calc(100vw - 32px)); padding:18px; border-radius:16px; border:1px solid rgba(255,255,255,0.16); background:rgba(14,18,26,0.98); color:#fff; box-shadow:0 24px 60px rgba(0,0,0,0.48);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div>
                    <div style="font-size:19px; font-weight:800;">Поставить оружие на упор</div>
                    <div style="margin-top:4px; opacity:0.72; font-size:12px;">Точность +1 · Эргономика +10</div>
                </div>
                <button type="button" class="brace-close btn btn-sm btn-secondary">×</button>
            </div>
            <div class="brace-options" style="display:flex; gap:9px; margin-top:16px;"></div>
        </div>`;
    const container = menu.querySelector('.brace-options');
    options.forEach(option => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-primary';
        button.textContent = option.label;
        button.disabled = !option.available;
        button.onclick = async () => {
            try {
                await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
                    location_character_id: character.location_character_id,
                    action_key: 'brace_weapon',
                    payment: option.payment,
                });
                closePostureMenu();
                showNotification('Оружие установлено на упор', 'success');
            } catch (error) {
                showNotification(error.message || 'Не удалось поставить оружие на упор', 'system');
            }
        };
        container.appendChild(button);
    });
    menu.querySelector('.brace-close').onclick = closePostureMenu;
    menu.style.display = 'flex';
}

function ensureMovementTypeMenu() {
    if (movementTypeMenu) return movementTypeMenu;
    movementTypeMenu = document.createElement('div');
    movementTypeMenu.id = 'combat-movement-type-menu';
    movementTypeMenu.style.cssText = `
        position:fixed;
        inset:0;
        z-index:1230;
        display:none;
        align-items:center;
        justify-content:center;
        padding:16px;
        background:rgba(4, 7, 10, 0.58);
        backdrop-filter:blur(3px);
    `;
    movementTypeMenu.addEventListener('pointerdown', (event) => {
        if (event.target === movementTypeMenu) closeMovementTypeMenu();
    });
    document.body.appendChild(movementTypeMenu);
    return movementTypeMenu;
}

function showMovementTypeMenu(characterId) {
    const menu = ensureMovementTypeMenu();
    const current = combatState?.current_character || {};
    menu.innerHTML = `
        <div class="movement-type-panel" style="
            width:min(680px, calc(100vw - 32px));
            max-height:calc(100vh - 32px);
            overflow-y:auto;
            padding:18px;
            border-radius:16px;
            border:1px solid rgba(255,255,255,0.16);
            background:rgba(14,18,26,0.98);
            color:#fff;
            box-shadow:0 24px 60px rgba(0,0,0,0.48);
        ">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px;">
                <div>
                    <div style="font-size:19px; font-weight:800;">Выберите вид движения</div>
                    <div style="margin-top:3px; opacity:0.7; font-size:12px;">
                        ОД ${current.action_points_current ?? 0} · СД ${current.free_actions_current ?? 0} · ОП ${current.movement_points_current ?? 0}
                    </div>
                </div>
                <button type="button" class="movement-type-close" style="
                    width:34px; height:34px; border:0; border-radius:50%;
                    background:rgba(255,255,255,0.08); color:#fff; cursor:pointer;
                    font-size:20px;
                ">×</button>
            </div>
            <div class="movement-type-options" style="
                display:grid;
                grid-template-columns:repeat(auto-fit, minmax(230px, 1fr));
                gap:10px;
            "></div>
        </div>
    `;

    const options = menu.querySelector('.movement-type-options');
    Object.entries(COMBAT_MOVEMENT_TYPES).forEach(([key, mode]) => {
        const availability = getMovementModeAvailability(key);
        const movementSummary = movementModeSummary(key, mode, current.posture || 'standing');
        const resourceCost = [
            mode.actionPoints ? `${mode.actionPoints} ОД` : null,
            mode.freeActions ? `${mode.freeActions} СД` : null,
        ].filter(Boolean).join(' · ') || 'Без ОД и СД';
        const button = document.createElement('button');
        button.type = 'button';
        button.disabled = !availability.allowed;
        button.style.cssText = `
            display:grid;
            grid-template-columns:42px minmax(0, 1fr);
            gap:11px;
            align-items:start;
            min-height:112px;
            padding:13px;
            border-radius:13px;
            border:1px solid ${availability.allowed ? 'rgba(184,164,110,0.36)' : 'rgba(255,255,255,0.08)'};
            background:${availability.allowed ? 'rgba(184,164,110,0.09)' : 'rgba(255,255,255,0.025)'};
            color:#fff;
            text-align:left;
            cursor:${availability.allowed ? 'pointer' : 'not-allowed'};
            opacity:${availability.allowed ? '1' : '0.48'};
        `;
        button.innerHTML = `
            <span style="font-size:27px; line-height:1;">${mode.icon}</span>
            <span>
                <strong style="display:block; font-size:15px;">${mode.label}</strong>
                <span style="display:block; margin-top:5px; font-size:12px; opacity:0.78;">${movementSummary}</span>
                <span style="display:block; margin-top:3px; font-size:12px; opacity:0.78;">
                    ${resourceCost} · осталось ${availability.remainingDistance} м
                </span>
                ${availability.reason ? `<span style="display:block; margin-top:6px; font-size:11px; color:#ffb0a8;">${availability.reason}</span>` : ''}
            </span>
        `;
        button.onclick = () => {
            closeMovementTypeMenu();
            beginCharacterMoveMode(characterId, key);
        };
        options.appendChild(button);
    });

    const closeButton = menu.querySelector('.movement-type-close');
    if (closeButton) closeButton.onclick = closeMovementTypeMenu;
    menu.style.display = 'flex';
}

function beginCharacterMoveMode(characterId, movementType = 'walk') {
    if (!isCurrentCombatTurnForCharacter(characterId)) {
        showNotification('Сейчас не ход этого персонажа', 'system');
        return false;
    }
    armedMoveCharacterId = characterId;
    pendingCombatAction = null;
    clearAttackPreview();
    initializeMovementPreview(characterId);
    armedMovementType = movementType;
    const label = COMBAT_MOVEMENT_TYPES[movementType]?.label || 'Движение';
    showNotification(`${label}: выберите конечную клетку ЛКМ`, 'system');
    return true;
}

export function beginPendingCombatAction(action) {
    if (!combatState || combatState.status !== 'active') {
        showNotification('Бой сейчас не активен', 'system');
        return false;
    }
    const actor = action?.actorCharacterId ? findCombatCharacterByCharacterId(action.actorCharacterId) : null;
    const { current, canAct } = getCombatMenuState();
    const activeActor = actor || current;
    if (!activeActor) {
        showNotification('Не удалось определить действующего персонажа', 'system');
        return false;
    }
    if (!isCurrentCombatTurnForCharacter(activeActor.character_id)) {
        showNotification('Сейчас не ход этого персонажа', 'system');
        return false;
    }
    if (!canActWithCombatCharacter(activeActor) && !window.isGM) {
        showNotification('Этот персонаж недоступен для управления', 'system');
        return false;
    }
    pendingCombatAction = {
        ...action,
        actorCharacterId: action.actorCharacterId || activeActor.character_id,
        actorLocationCharacterId: action.actorLocationCharacterId || activeActor.location_character_id,
        createdAt: Date.now(),
        selectedTargetIds: [],
        areaAnchor: null,
    };
    closeCombatMenus();
    hideStructureInteraction();
    clearMovementPreview();
    if (typeof window.closeCharacterSheet === 'function' && action.source === 'sheet') {
        window.closeCharacterSheet();
    }
    const label = action.actionKey === 'use_item'
        ? 'Использование предмета'
        : (action.actionKey === 'aim' ? 'Прицеливание' : 'Атака');
    const targetHint = action.targetType === 'structure'
        ? 'выберите укрытие'
        : (['multi_character', 'multi_melee'].includes(action.targetType)
            ? (
                action.targetType === 'multi_melee'
                    ? 'выберите до 3 соседних целей, затем нажмите Enter'
                    : 'выберите до 3 целей в области 5×5, затем нажмите Enter'
            )
            : 'выберите цель на сцене');
    showNotification(`${label}: ${targetHint}`, 'system');
    renderCombatHud();
    return true;
}

export function clearPendingCombatAction() {
    pendingCombatAction = null;
    clearAttackPreview();
    renderCombatHud();
}

export function queueCombatActionFromSheet(action) {
    return beginPendingCombatAction({ ...action, source: 'sheet' });
}

export function startCharacterMoveMode(characterId) {
    const entry = characterModels.get(characterId);
    if (!entry) {
        showNotification('Персонаж не найден на локации', 'system');
        return false;
    }
    if (!canControlCharacter(characterId)) {
        showNotification('Вы не можете перемещать этого персонажа', 'system');
        return false;
    }
    if (!isCurrentCombatTurnForCharacter(characterId)) {
        showNotification('Сейчас не ход этого персонажа', 'system');
        return false;
    }
    if (findCombatCharacterByCharacterId(characterId)?.grappled_by_id) {
        showNotification('Схваченный персонаж не может двигаться самостоятельно', 'system');
        return false;
    }
    hideStructureInteraction();
    if (combatState?.status === 'active') {
        showMovementTypeMenu(characterId);
        return true;
    }
    return beginCharacterMoveMode(characterId, 'walk');
}

async function resolveCombatTargetSelection(targetCharacterId) {
    if (!pendingCombatAction) return false;
    const action = pendingCombatAction;
    const actor = findCombatCharacterByCharacterId(action.actorCharacterId);
    const target = findCombatCharacterByCharacterId(targetCharacterId);
    if (!actor) {
        showNotification('Не удалось найти действующего персонажа', 'system');
        clearPendingCombatAction();
        return false;
    }
    if (!target) {
        showNotification('Цель не найдена', 'system');
        return false;
    }
    if (action.actionKey !== 'use_item' && action.actorCharacterId === targetCharacterId) {
        showNotification('Нельзя выбрать самого себя в качестве цели', 'system');
        return false;
    }
    if (['multi_character', 'multi_melee'].includes(action.targetType)) {
        const selectedIds = action.selectedTargetIds || [];
        const existingIndex = selectedIds.indexOf(targetCharacterId);
        if (existingIndex >= 0) {
            selectedIds.splice(existingIndex, 1);
            showNotification(`Цель убрана. Выбрано: ${selectedIds.length}/3`, 'system');
            renderCombatHud();
            return true;
        }
        if (selectedIds.length >= 3) {
            showNotification('Можно выбрать не больше 3 целей', 'system');
            return false;
        }
        if (action.targetType === 'multi_character' && !action.areaAnchor) {
            showNotification('Сначала выберите центр области 5×5', 'system');
            return false;
        }
        if (
            action.targetType === 'multi_character'
            && (
                Math.abs((target.x ?? target.pos_x ?? 0) - action.areaAnchor.x) > 2
                || Math.abs((target.y ?? target.pos_y ?? 0) - action.areaAnchor.y) > 2
            )
        ) {
            showNotification('Цель находится за пределами выбранной области 5×5', 'system');
            return false;
        }
        if (
            action.targetType === 'multi_melee'
            && Math.max(
                Math.abs((target.x ?? 0) - (actor.x ?? 0)),
                Math.abs((target.y ?? 0) - (actor.y ?? 0)),
            ) !== 1
        ) {
            showNotification('Круговой атакой можно выбрать только соседнюю цель', 'system');
            return false;
        }
        selectedIds.push(targetCharacterId);
        showNotification(
            `Цель добавлена. Выбрано: ${selectedIds.length}/3. Enter — выполнить действие`,
            'system'
        );
        renderCombatHud();
        return true;
    }

    const payload = {
        location_character_id: action.actorLocationCharacterId,
        action_key: action.actionKey,
        target_character_id: targetCharacterId,
        weapon_index: action.weaponIndex,
        attack_type: action.attackType,
        fire_mode: action.fireMode,
        shot_count: action.shotCount,
        volley_count: action.volleyCount,
        action_points: action.actionPoints,
        item_path: action.itemPath,
        payment: action.payment,
        attribute_choice: action.attributeChoice,
    };
    if (action.fireMode === 'aimed' || action.meleeAimed) {
        const zone = await selectAimedTargetZone(target.name);
        if (!zone) return false;
        payload.target_zone = zone;
    }

    try {
        if (action.actionKey === 'use_item') {
            if (typeof action.onResolve === 'function') {
                const applied = await action.onResolve({ targetCharacterId, target });
                if (applied === false) return false;
            }
        } else {
            const result = await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), payload);
            const attack = result?.attack;
            if (attack?.results?.length) {
                const hits = attack.results.filter(item => item.hit);
                const damage = attack.damage_total || 0;
                const rolls = attack.results.map((item, index) => {
                    const dice = Array.isArray(item.rolls) && item.rolls.length > 1
                        ? `[${item.rolls.join(', ')}] → ${item.roll}`
                        : String(item.roll);
                    const outcome = item.hit ? 'попадание' : 'промах';
                    return `${index + 1}: d20 ${dice}, СЛ ${item.difficulty} — ${outcome}`;
                }).join('; ');
                const strength = attack.results[0]?.strength_requirement;
                const strengthText = strength?.accuracy_penalty
                    ? ` Требование Силы ${strength.effective_required}, Сила ${strength.strength}: точность −${strength.accuracy_penalty}.`
                    : '';
                showNotification(
                    `${rolls}. Итоговый урон: ${damage}.${strengthText}`,
                    hits.length ? 'success' : 'system'
                );
            }
            const cover = result?.attack?.cover;
            if (cover && cover.grade !== 'none') {
                const labels = {
                    half: 'укрытие 1/2',
                    three_quarters: 'укрытие 3/4',
                    full: 'полное укрытие',
                };
                const penalty = cover.accuracy_penalty ? `, точность -${cover.accuracy_penalty}` : '';
                const disadvantage = cover.disadvantage ? ', помеха' : '';
                showNotification(
                    `${labels[cover.grade] || 'укрытие'}${penalty}${disadvantage}. Закрыты: ${(cover.blocked_zones || []).join(', ')}`,
                    'system'
                );
            }
            if (typeof action.onResolve === 'function') {
                await action.onResolve({ targetCharacterId, target });
            }
        }
        showNotification(
            `${action.actionKey === 'use_item' ? 'Действие' : (action.actionKey === 'aim' ? 'Прицеливание' : 'Атака')} выполнено по ${target.name || 'цели'}`,
            'success'
        );
        clearPendingCombatAction();
        hideStructureInteraction();
        return true;
    } catch (error) {
        showNotification(error.message || 'Не удалось выполнить действие', 'system');
        return false;
    }
}

function selectAreaFireAnchor(clientX, clientY) {
    const action = pendingCombatAction;
    if (!action || action.targetType !== 'multi_character' || action.areaAnchor) return false;
    const actor = findCombatCharacterByCharacterId(action.actorCharacterId);
    const actorEntry = actor ? characterModels.get(actor.character_id) : null;
    if (!actorEntry) return false;
    const point = getPointerWorldPoint(clientX, clientY, actorEntry.model.position.y);
    if (!point) return false;
    const x = Math.floor(point.x);
    const y = Math.floor(point.z);
    if (
        x < 0 ||
        y < 0 ||
        x >= (currentLocationData?.grid_width || 0) ||
        y >= (currentLocationData?.grid_height || 0)
    ) return false;
    action.areaAnchor = { x, y };
    clearAttackPreview();
    showNotification('Область 5×5 выбрана. Отметьте до 3 целей и нажмите Enter', 'system');
    renderCombatHud();
    return true;
}

async function finalizeAreaFire() {
    const action = pendingCombatAction;
    if (
        !action
        || !['multi_character', 'multi_melee'].includes(action.targetType)
    ) return false;
    const targetIds = action.selectedTargetIds || [];
    if (targetIds.length === 0) {
        showNotification('Выберите хотя бы одну цель', 'system');
        return false;
    }
    try {
        const payload = {
            location_character_id: action.actorLocationCharacterId,
            action_key: action.actionKey,
            weapon_index: action.weaponIndex,
            attack_type: action.attackType,
            fire_mode: action.fireMode,
            shot_count: action.shotCount,
            volley_count: action.volleyCount,
            action_points: action.actionPoints,
            target_character_ids: targetIds,
        };
        if (action.targetType === 'multi_character') {
            payload.area_center_x = action.areaAnchor.x;
            payload.area_center_y = action.areaAnchor.y;
        }
        await Server.performLocationCombatAction(
            window.currentLobbyId,
            getCurrentLocationId(),
            payload,
        );
        if (typeof action.onResolve === 'function') {
            await action.onResolve({ targetCharacterIds: targetIds });
        }
        showNotification(
            `${action.targetType === 'multi_melee' ? 'Круговая атака' : 'Огонь по области'}: целей ${targetIds.length}`,
            'success',
        );
        clearPendingCombatAction();
        return true;
    } catch (error) {
        showNotification(error.message || 'Не удалось выполнить огонь по области', 'system');
        return false;
    }
}

async function resolveCombatStructureSelection(clientX, clientY) {
    const action = pendingCombatAction;
    if (!action || action.targetType !== 'structure') return false;
    const object = getLocationObjectAtScreen(clientX, clientY);
    const locationObject = object?.userData?.locationObject;
    if (!locationObject?.id) {
        showNotification('Выберите объект укрытия', 'system');
        return false;
    }
    try {
        await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
            location_character_id: action.actorLocationCharacterId,
            action_key: action.actionKey,
            weapon_index: action.weaponIndex,
            fire_mode: action.fireMode,
            shot_count: action.shotCount,
            volley_count: action.volleyCount,
            action_points: action.actionPoints,
            target_object_id: locationObject.id,
        });
        if (typeof action.onResolve === 'function') {
            await action.onResolve({ targetObject: locationObject });
        }
        showNotification(
            action.actionKey === 'take_cover'
                ? `Укрытие занято: ${locationObject.name || 'объект'}`
                : `Огонь на подавление: ${locationObject.name || 'укрытие'}`,
            'success'
        );
        clearPendingCombatAction();
        return true;
    } catch (error) {
        showNotification(error.message || 'Не удалось подавить укрытие', 'system');
        return false;
    }
}

async function resolveCombatPointSelection(clientX, clientY) {
    if (!pendingCombatAction || pendingCombatAction.targetType !== 'point') return false;
    const action = pendingCombatAction;
    const actor = findCombatCharacterByCharacterId(action.actorCharacterId);
    const actorEntry = actor ? characterModels.get(actor.character_id) : null;
    if (!actor || !actorEntry) {
        clearPendingCombatAction();
        return false;
    }
    const point = getPointerWorldPoint(clientX, clientY, actorEntry.model.position.y);
    if (!point) return false;
    const targetX = Math.floor(point.x);
    const targetY = Math.floor(point.z);
    if (
        targetX < 0 ||
        targetY < 0 ||
        targetX >= (currentLocationData?.grid_width || 0) ||
        targetY >= (currentLocationData?.grid_height || 0)
    ) {
        showNotification('Точка стрельбы находится за пределами локации', 'system');
        return false;
    }
    try {
        await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
            location_character_id: action.actorLocationCharacterId,
            action_key: action.actionKey,
            weapon_index: action.weaponIndex,
            fire_mode: action.fireMode,
            shot_count: action.shotCount,
            target_x: targetX,
            target_y: targetY,
        });
        if (typeof action.onResolve === 'function') {
            await action.onResolve({ targetX, targetY });
        }
        showNotification(
            `${action.fireMode === 'suppression' ? 'Подавление' : 'Стрельба по площади'}: ${targetX}, ${targetY}`,
            'success'
        );
        clearPendingCombatAction();
        return true;
    } catch (error) {
        showNotification(error.message || 'Не удалось выполнить стрельбу', 'system');
        return false;
    }
}

// ========== Создание модели персонажа ==========
function createCharacterModel(userId) {
    const group = new THREE.Group();
    const color = getUserColor(userId);
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.7, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.35;
    body.userData.posturePart = 'body';
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const headGeo = new THREE.SphereGeometry(0.15, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffddbb });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.8;
    head.userData.posturePart = 'head';
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);
    const facingMarker = new THREE.Mesh(
        new THREE.ConeGeometry(0.07, 0.22, 6),
        new THREE.MeshStandardMaterial({ color: 0xf2b84b })
    );
    facingMarker.rotation.x = Math.PI / 2;
    facingMarker.position.set(0, 0.68, 0.28);
    facingMarker.userData.posturePart = 'facingMarker';
    group.add(facingMarker);
    group.userData.isCharacter = true;
    return group;
}

// ========== Добавление персонажа ==========
export function addCharacterToLocation(characterId, name, ownerId, ownerName, posX, posY, hpZones, effects, controlledBy) {
    if (characterModels.has(characterId)) {
        const old = characterModels.get(characterId);
        scene.remove(old.model);
        if (old.label) scene.remove(old.label);
        characterModels.delete(characterId);
    }
    const resolvedControlledBy = Number.isFinite(Number(controlledBy)) ? Number(controlledBy) : null;
    const fallbackOwnerId = Number.isFinite(Number(ownerId)) ? Number(ownerId) : null;
    const colorUserId = resolvedControlledBy ?? fallbackOwnerId ?? 0;
    const model = createCharacterModel(colorUserId);
    const tileHeight = getTileHeight(posX, posY);
    model.position.set(posX + 0.5, tileHeight, posY + 0.5);
    model.userData.characterId = characterId;
    model.userData.ownerId = colorUserId;
    scene.add(model);

    const div = document.createElement('div');
    const colorHex = getUserColorHex(colorUserId);
    const nameLine = document.createElement('div');
    nameLine.textContent = name;
    const grappleBadge = document.createElement('div');
    grappleBadge.style.cssText = `
        display:none;
        margin-top:3px;
        padding:2px 6px;
        border-radius:7px;
        background:rgba(45,18,14,.94);
        border:1px solid rgba(235,126,91,.9);
        color:#ffd6c7;
        font-size:10px;
        font-weight:800;
        line-height:1.2;
        white-space:nowrap;
    `;
    div.append(nameLine, grappleBadge);
    div.style.color = 'white';
    div.style.fontSize = '14px';
    div.style.fontWeight = 'bold';
    div.style.textShadow = '1px 1px 3px black';
    div.style.backgroundColor = colorHex;
    div.style.border = `2px solid ${colorHex}`;
    div.style.padding = '2px 8px';
    div.style.borderRadius = '10px';
    div.style.pointerEvents = 'none';
    const label = new CSS2DObject(div);
    label.position.set(posX + 0.5, tileHeight + 1.2, posY + 0.5);
    scene.add(label);

    characterModels.set(characterId, {
        model,
        label,
        name,
        ownerId: colorUserId,
        ownerName,
        hpZones,
        effects,
        posX,
        posY,
        posture: 'standing',
        controlledBy: resolvedControlledBy ?? fallbackOwnerId,
        grappleBadge,
    });
    const combatCharacter = findCombatCharacterByCharacterId(characterId);
    if (combatCharacter?.posture) {
        applyCharacterPostureVisual(characterId, combatCharacter.posture);
    }
    applyCharacterGrappleVisual(characterId, combatCharacter);
    invalidateMovementMapCache();
}

export function applyCharacterPostureVisual(characterId, posture = 'standing') {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    const normalized = COMBAT_POSTURES[posture] ? posture : 'standing';
    const labelOffset = normalized === 'prone' ? 0.62 : normalized === 'sitting' ? 0.88 : 1.2;
    const tileHeight = getTileHeight(entry.posX, entry.posY);
    const body = entry.model.children.find((child) => child.userData?.posturePart === 'body');
    const head = entry.model.children.find((child) => child.userData?.posturePart === 'head');
    entry.model.scale.set(1, 1, 1);
    if (body && head) {
        body.rotation.z = normalized === 'prone' ? Math.PI / 2 : 0;
        body.scale.set(1, normalized === 'sitting' ? 0.68 : 1, 1);
        body.position.set(0, normalized === 'prone' ? 0.25 : normalized === 'sitting' ? 0.25 : 0.35, 0);
        head.position.set(
            normalized === 'prone' ? 0.48 : 0,
            normalized === 'prone' ? 0.22 : normalized === 'sitting' ? 0.58 : 0.8,
            0,
        );
    }
    entry.model.userData.posture = normalized;
    entry.label.position.y = tileHeight + labelOffset;
    entry.posture = normalized;
}

function applyCharacterFacingVisual(characterId, facingX = 0, facingY = 1) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    const x = Number(facingX) || 0;
    const y = Number(facingY) || 0;
    if (x === 0 && y === 0) return;
    entry.model.rotation.y = Math.atan2(x, y);
    entry.facingX = x;
    entry.facingY = y;
}

function applyCharacterGrappleVisual(characterId, combatCharacter = null) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry?.grappleBadge) return;
    const character = combatCharacter || findCombatCharacterByCharacterId(characterId);
    let text = '';
    if (character?.grapple_target_id) {
        const captive = findCombatCharacterByLocationId(character.grapple_target_id);
        text = `Держит: ${captive?.name || 'цель'}`;
    } else if (character?.grappled_by_id) {
        const holder = findCombatCharacterByLocationId(character.grappled_by_id);
        text = `Схвачен: ${holder?.name || 'противник'}`;
    }
    entry.grappleBadge.textContent = text;
    entry.grappleBadge.style.display = text ? 'block' : 'none';
    entry.model.userData.grappleState = character?.grapple_target_id
        ? 'holder'
        : (character?.grappled_by_id ? 'captive' : null);
}

export function updateCharacterPosition(characterId, posX, posY) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    const tileHeight = getTileHeight(posX, posY);
    entry.model.position.set(posX + 0.5, tileHeight, posY + 0.5);
    const labelOffset = entry.posture === 'prone' ? 0.62 : entry.posture === 'sitting' ? 0.88 : 1.2;
    entry.label.position.set(posX + 0.5, tileHeight + labelOffset, posY + 0.5);
    entry.posX = posX;
    entry.posY = posY;
    invalidateMovementMapCache();
}

export function removeCharacterFromLocation(characterId) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    if (entry.model) {
        disposeObject(entry.model);
        scene.remove(entry.model);
    }
    if (entry.label) {
        scene.remove(entry.label);
    }
    characterModels.delete(characterId);
    if (combatActionMenuCharacterId === characterId && combatActionMenu) {
        combatActionMenu.style.display = 'none';
        combatActionMenuCharacterId = null;
    }
    invalidateMovementMapCache();
}

// ========== Контекстное меню ==========
function createContextMenu() {
    if (contextMenu) return;
    contextMenu = document.createElement('div');
    contextMenu.style.cssText = `
        position: fixed;
        z-index: 1000;
        background: rgba(20,20,30,0.95);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        padding: 5px 0;
        min-width: 180px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.6);
        display: none;
        backdrop-filter: blur(5px);
        color: white;
        pointer-events: auto;
        font-family: 'Segoe UI', Arial, sans-serif;
    `;
    document.body.appendChild(contextMenu);
    const onClick = (e) => {
        if (contextMenu && !contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
            contextMenuCharacterId = null;
        }
    };
    document.addEventListener('click', onClick);
    handlers.document.click = onClick;
}

function showContextMenu(clientX, clientY, characterId) {
    createContextMenu();
    contextMenuCharacterId = characterId;
    contextMenu.innerHTML = '';
    const items = [
        { label: '⚔️ Атаковать', action: () => onAttackCharacter(characterId) },
        { label: '🎒 Использовать предмет', action: () => onUseItem(characterId) },
        { label: '📄 Посмотреть персонажа', action: () => onViewCharacter(characterId) }
    ];
    items.forEach(item => {
        const div = document.createElement('div');
        div.textContent = item.label;
        div.style.cssText = `
            padding: 8px 20px;
            cursor: pointer;
            transition: background 0.15s;
            font-size: 14px;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        `;
        div.addEventListener('mouseenter', () => { div.style.background = 'rgba(255,255,255,0.1)'; });
        div.addEventListener('mouseleave', () => { div.style.background = 'transparent'; });
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            contextMenu.style.display = 'none';
            contextMenuCharacterId = null;
            item.action();
        });
        contextMenu.appendChild(div);
    });
    let left = clientX;
    let top = clientY;
    contextMenu.style.display = 'block';
    const rect = contextMenu.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';
}

function onAttackCharacter(characterId) {
    showNotification(`⚔️ Атака на персонажа ${characterId}`, 'system');
}
function onUseItem(characterId) {
    showNotification(`🎒 Использовать предмет для персонажа ${characterId}`, 'system');
}
function onViewCharacter(characterId) {
    import('./characterSheet.js').then(module => {
        module.openCharacterSheet(characterId);
    });
}

// ========== Очистка персонажей ==========
function clearAllCharacters() {
    characterModels.forEach((entry) => {
        if (entry.model) {
            disposeObject(entry.model);
            scene.remove(entry.model);
        }
        if (entry.label) {
            scene.remove(entry.label);
        }
    });
    characterModels.clear();
}

function ensureCombatHud() {
    if (combatHud) return;
    combatHud = document.createElement('div');
    combatHud.id = 'combat-status-panel';
    combatHud.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        z-index: 30;
        min-width: 260px;
        max-width: 360px;
        background: rgba(10, 12, 18, 0.92);
        color: #fff;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 14px;
        box-shadow: 0 14px 32px rgba(0,0,0,0.38);
        backdrop-filter: blur(10px);
        pointer-events: auto;
        font-family: 'Segoe UI', Arial, sans-serif;
    `;
    document.body.appendChild(combatHud);
}

function closeCombatParticipantMenu() {
    if (combatParticipantMenu) {
        combatParticipantMenu.remove();
        combatParticipantMenu = null;
    }
}

async function showCombatParticipantSelection() {
    if (!window.isGM || combatState?.status === 'active') return;
    let characters = [];
    try {
        const freshState = await Server.getLocationCombatState(
            window.currentLobbyId,
            getCurrentLocationId(),
        );
        combatState = freshState;
        window.locationCombatState = freshState;
        characters = Array.isArray(freshState?.characters)
            ? freshState.characters
            : [];
    } catch (error) {
        showNotification(error.message || 'Не удалось получить участников боя', 'error');
        return;
    }
    if (!characters.length) {
        showNotification('На подлокации нет персонажей', 'system');
        return;
    }

    closeCombatParticipantMenu();
    combatParticipantMenu = document.createElement('div');
    combatParticipantMenu.className = 'modal combat-participant-menu';
    combatParticipantMenu.style.cssText = `
        position:fixed;
        inset:0;
        z-index:1260;
        display:flex;
        align-items:center;
        justify-content:center;
        padding:16px;
        background:rgba(4,7,10,0.62);
    `;
    combatParticipantMenu.innerHTML = `
        <div class="modal-content" style="
            width:min(560px, calc(100vw - 32px));
            max-height:calc(100vh - 32px);
            display:flex;
            flex-direction:column;
            gap:12px;
            padding:18px;
            overflow:hidden;
        ">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;">
                <div>
                    <h3 style="margin:0;">Участники боя</h3>
                    <div style="margin-top:4px; font-size:12px; opacity:.72;">
                        Отмеченные персонажи бросят 1к20 + Бонус Тактики.
                    </div>
                </div>
                <button type="button" class="combat-participant-close btn btn-sm btn-secondary">×</button>
            </div>
            <div class="combat-participant-list" style="
                display:grid;
                gap:8px;
                overflow-y:auto;
                min-height:0;
                padding-right:4px;
            "></div>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button type="button" class="btn btn-secondary combat-participant-cancel">Отмена</button>
                <button type="button" class="btn btn-primary combat-participant-start">Начать бой</button>
            </div>
        </div>
    `;
    const list = combatParticipantMenu.querySelector('.combat-participant-list');
    characters.forEach((character) => {
        const bonus = Number(character.initiative_bonus) || 0;
        const row = document.createElement('label');
        row.style.cssText = `
            display:grid;
            grid-template-columns:auto minmax(0,1fr) auto;
            align-items:center;
            gap:10px;
            padding:10px 12px;
            border:1px solid rgba(255,255,255,.12);
            border-radius:10px;
            background:rgba(255,255,255,.045);
            cursor:pointer;
        `;
        row.innerHTML = `
            <input type="checkbox" value="${character.location_character_id}" checked>
            <strong class="combat-participant-name" style="overflow:hidden; text-overflow:ellipsis;"></strong>
            <span style="font-size:12px; opacity:.75;">Инициатива ${bonus >= 0 ? '+' : ''}${bonus}</span>
        `;
        row.querySelector('.combat-participant-name').textContent = (
            character.name || `#${character.character_id}`
        );
        list.appendChild(row);
    });

    const close = closeCombatParticipantMenu;
    combatParticipantMenu.querySelector('.combat-participant-close').onclick = close;
    combatParticipantMenu.querySelector('.combat-participant-cancel').onclick = close;
    combatParticipantMenu.addEventListener('pointerdown', (event) => {
        if (event.target === combatParticipantMenu) close();
    });
    combatParticipantMenu.querySelector('.combat-participant-start').onclick = async (event) => {
        const selectedIds = Array.from(
            combatParticipantMenu.querySelectorAll('input[type="checkbox"]:checked'),
        ).map(input => Number(input.value)).filter(Number.isFinite);
        if (!selectedIds.length) {
            showNotification('Выберите хотя бы одного участника боя', 'system');
            return;
        }
        event.currentTarget.disabled = true;
        try {
            const state = await Server.startLocationCombat(
                window.currentLobbyId,
                getCurrentLocationId(),
                selectedIds,
            );
            const results = (state.characters || [])
                .filter(character => selectedIds.includes(Number(character.location_character_id)))
                .sort((left, right) => (right.initiative_total || 0) - (left.initiative_total || 0))
                .map(character => (
                    `${character.name}: d20 ${character.initiative_roll} `
                    + `${Number(character.initiative_bonus) >= 0 ? '+' : ''}${character.initiative_bonus} `
                    + `= ${character.initiative_total}`
                ))
                .join('; ');
            close();
            showNotification(`Инициатива: ${results}`, 'system');
        } catch (error) {
            event.currentTarget.disabled = false;
            showNotification(error.message || 'Не удалось начать бой');
        }
    };
    document.body.appendChild(combatParticipantMenu);
}

function renderCombatHud() {
    if (!combatState) {
        if (combatHud && combatHud.parentNode) {
            combatHud.parentNode.removeChild(combatHud);
        }
        combatHud = null;
        return;
    }

    ensureCombatHud();
    const charactersByLocationId = new Map((combatState.characters || []).map((char) => [char.location_character_id, char]));
    const orderLabels = [...new Set(combatState.turn_order || [])]
        .map((id) => {
            const character = charactersByLocationId.get(id);
            if (!character) return `#${id}`;
            if (combatState.status !== 'active') return character.name;
            const bonus = Number(character.initiative_bonus) || 0;
            return `${character.name} (${character.initiative_roll}${bonus >= 0 ? '+' : ''}${bonus}=${character.initiative_total})`;
        })
        .filter(Boolean);
    const visibleOrderLabels = orderLabels.length
        ? orderLabels
        : Array.from(new Set((combatState.characters || []).map((char) => char.name || 'Unknown')));
    const aimedTarget = (combatState.characters || []).find(
        char => char.character_id === combatState.current_character?.aimed_target_character_id
    );
    const isCollapsed = combatHudCollapsed ?? combatState.status !== 'active';
    const compactStatus = combatState.status === 'active'
        ? `Раунд ${combatState.round_number || 0} · ${combatState.current_character?.name || 'нет хода'} · ${combatState.current_character?.posture_label || 'Стоя'}`
        : 'бой не активен';
    combatHud.style.minWidth = isCollapsed ? '230px' : '260px';
    combatHud.innerHTML = `
        <div class="combat-hud-header" style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:8px;
            padding:10px 12px;
            border-bottom:1px solid rgba(255,255,255,0.08);
            cursor:move;
            user-select:none;
        ">
            <div style="min-width:0;">
                <div style="font-weight:700; font-size:15px;">Бой</div>
                <div style="font-size:11px; opacity:0.7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${compactStatus}</div>
            </div>
            <button
                type="button"
                class="combat-hud-collapse-btn"
                aria-label="${isCollapsed ? 'Развернуть панель боя' : 'Свернуть панель боя'}"
                aria-expanded="${isCollapsed ? 'false' : 'true'}"
                title="${isCollapsed ? 'Развернуть' : 'Свернуть'}"
                style="
                    flex:0 0 30px;
                    width:30px;
                    height:30px;
                    padding:0;
                    border:1px solid rgba(255,255,255,0.16);
                    border-radius:8px;
                    background:rgba(255,255,255,0.07);
                    color:#fff;
                    font-size:18px;
                    line-height:1;
                    cursor:pointer;
                "
            >${isCollapsed ? '+' : '−'}</button>
        </div>
        <div class="combat-hud-body" style="display:${isCollapsed ? 'none' : 'block'}; padding:12px 14px; font-size:13px; line-height:1.45;">
            <div>Статус: <strong>${combatState.status || 'idle'}</strong></div>
            <div>Раунд: <strong>${combatState.round_number || 0}</strong></div>
            <div>Ход: <strong>${combatState.current_character?.name || 'нет'}</strong></div>
            <div>Положение: <strong>${combatState.current_character?.posture_label || 'Стоя'}</strong></div>
            <div>ОД: ${combatState.current_character?.action_points_current ?? 0}/${combatState.current_character?.action_points_max ?? 0}</div>
            <div>СД: ${combatState.current_character?.free_actions_current ?? 0}/${combatState.current_character?.free_actions_max ?? 0}</div>
            <div>ОП: ${combatState.current_character?.movement_points_current ?? 0}/${combatState.current_character?.movement_points_max ?? 0}</div>
            ${aimedTarget ? `<div>Прицел: <strong>${aimedTarget.name || 'цель'}</strong> · Точность +${combatState.current_character?.aim_accuracy_bonus || 0}</div>` : ''}
            <div>Боль: ${combatState.current_character?.pain_level ?? 0} | Истощение: ${combatState.current_character?.exhaustion ?? 0}</div>
            <div>Кровопотеря: ${combatState.current_character?.blood ?? 'normal'} | Тяжесть: ${combatState.current_character?.bleeding_severity ?? 0} | Сложность: ${combatState.current_character?.bleeding_difficulty ?? 0}</div>
            <div>Бонус Воли: ${combatState.current_character?.will_bonus ?? 0} | Модификатор кровопотери: ${combatState.current_character?.bleeding_modifier_total ?? 0}</div>
            <div style="margin-top:8px; opacity:0.85;">Порядок: ${visibleOrderLabels.join(' -> ') || 'пусто'}</div>
            ${pendingCombatAction ? `<div style="margin-top:8px; padding:8px 10px; border-radius:10px; background: rgba(255,255,255,0.06);"><strong>Выбор:</strong> ${
                pendingCombatAction.targetType === 'structure'
                    ? 'укрытие для подавления'
                    : (pendingCombatAction.targetType === 'multi_character'
                        ? (pendingCombatAction.areaAnchor
                            ? `цели в области ${(pendingCombatAction.selectedTargetIds || []).length}/3 · Enter для огня`
                            : 'центр области 5×5')
                        : (pendingCombatAction.targetType === 'multi_melee'
                            ? `соседние цели ${(pendingCombatAction.selectedTargetIds || []).length}/3 · Enter для атаки`
                            : (pendingCombatAction.fireMode || pendingCombatAction.actionKey || 'действие')))
            }</div>` : ''}
            <div style="margin-top:10px;">
                ${combatState.status !== 'active' && window.isGM ? '<button class="btn btn-sm btn-primary combat-start-btn" style="margin-top:8px;">Начать бой</button>' : ''}
                ${combatState.status === 'active' && combatState.current_character && canActWithCombatCharacter(combatState.current_character) ? '<button class="btn btn-sm btn-secondary combat-end-turn-btn" style="margin-top:8px;">Закончить ход</button>' : ''}
                ${combatState.status === 'active' && window.isGM ? '<button class="btn btn-sm btn-danger combat-end-combat-btn" style="margin-top:8px; margin-left:6px;">Закончить бой</button>' : ''}
            </div>
            <div style="margin-top:8px; font-size:12px; opacity:0.75;">
                ${combatState.current_character && canActWithCombatCharacter(combatState.current_character) ? 'ПКМ по модели персонажа открывает боевое меню.' : 'Сейчас управление доступно только активному персонажу.'}
            </div>
        </div>
    `;
    ensureCombatHudDragging();
    const collapseBtn = combatHud.querySelector('.combat-hud-collapse-btn');
    if (collapseBtn) {
        collapseBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            combatHudCollapsed = !isCollapsed;
            window.localStorage.setItem('combatHudCollapsed', combatHudCollapsed ? '1' : '0');
            renderCombatHud();
        };
    }
    const startBtn = combatHud.querySelector('.combat-start-btn');
    if (startBtn) {
        startBtn.onclick = showCombatParticipantSelection;
    }
    const endTurnBtn = combatHud.querySelector('.combat-end-turn-btn');
    if (endTurnBtn) {
        endTurnBtn.onclick = async () => {
            endTurnBtn.disabled = true;
            try {
                const result = await Server.endLocationCombatTurn(
                    window.currentLobbyId,
                    getCurrentLocationId(),
                    combatState.current_character?.location_character_id || null
                );
                const check = result?.pain_shock_check;
                if (check) {
                    const message = check.guaranteed
                        ? 'Боль достигла 10: персонаж гарантированно впал в болевой шок'
                        : (
                            check.success
                                ? `Проверка болевого шока пройдена: d20 ${check.roll}, СЛ ${check.difficulty}`
                                : `Персонаж впал в болевой шок: d20 ${check.roll}, СЛ ${check.difficulty}`
                        );
                    showNotification(
                        message,
                        check.success ? 'system' : 'error'
                    );
                }
            } catch (error) {
                showNotification(error.message || 'Не удалось закончить ход');
            } finally {
                endTurnBtn.disabled = false;
            }
        };
    }
    const endCombatBtn = combatHud.querySelector('.combat-end-combat-btn');
    if (endCombatBtn) {
        endCombatBtn.onclick = async () => {
            endCombatBtn.disabled = true;
            try {
                await Server.endLocationCombat(window.currentLobbyId, getCurrentLocationId());
            } catch (error) {
                showNotification(error.message || 'Не удалось закончить бой');
            } finally {
                endCombatBtn.disabled = false;
            }
        };
    }
}

export function setCombatState(state) {
    combatState = state || null;
    window.locationCombatState = combatState;
    (combatState?.characters || []).forEach((character) => {
        applyCharacterPostureVisual(character.character_id, character.posture);
        applyCharacterFacingVisual(
            character.character_id,
            character.facing_x,
            character.facing_y,
        );
        applyCharacterGrappleVisual(character.character_id, character);
    });
    window.dispatchEvent(new CustomEvent('combat-state-updated', { detail: combatState }));
    renderCombatHud();
}

export function getCombatState() {
    return combatState;
}

// ========== Инициализация сцены ==========
export function initLocationScene(containerId) {
    // Сначала полностью уничтожаем старую сцену
    destroyLocationScene();

    const container = document.getElementById(containerId);
    if (!container) return;

    // Очищаем контейнер
    while (container.firstChild) container.removeChild(container.firstChild);

    // WebGL рендерер
    renderer = createCompatibleWebGLRenderer(THREE, { antialias: true })
        || createUnavailableRenderer();
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !renderer.isUnavailableRenderer;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    if (renderer.isUnavailableRenderer) {
        window.webGLUnavailable = true;
        showWebGLUnavailable(container);
    }

    // CSS2D рендерер
    labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(container.clientWidth, container.clientHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(labelRenderer.domElement);

    // Сцена
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);

    // Камера
    camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(50, 60, 50);

    // Контролы
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0, 0);
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    window.locationControls = controls;

    // Освещение
    const ambientLight = new THREE.AmbientLight(0x404060);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    scene.add(dirLight);
    const fillLight = new THREE.PointLight(0x4466cc, 0.3);
    fillLight.position.set(0, 5, 0);
    scene.add(fillLight);

    // Highlight
    createHighlight();

    // Анимация
    let previousFrameTime = performance.now();
    function animate(frameTime = performance.now()) {
        animationFrameId = requestAnimationFrame(animate);
        const deltaSeconds = Math.min(0.1, Math.max(0, (frameTime - previousFrameTime) / 1000));
        previousFrameTime = frameTime;
        updateLocationCameraMovement(deltaSeconds);
        if (controls) controls.update();
        animateAnomalyEffects(anomalyEffectMeshes, performance.now());
        if (renderer && scene && camera) renderer.render(scene, camera);
        if (labelRenderer) labelRenderer.render(scene, camera);
    }
    animate();

    // Инфо-панель
    let locInfo = document.getElementById('location-tile-info');
    if (!locInfo) {
        locInfo = document.createElement('div');
        locInfo.id = 'location-tile-info';
        locInfo.style.cssText = `
            position: absolute;
            bottom: 100px;
            right: 20px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 10px;
            border-radius: 8px;
            display: none;
            pointer-events: none;
            z-index: 15;
        `;
        document.body.appendChild(locInfo);
    }

    // Настройка обработчиков
    setupLocationEditing();
    setupCharacterDragging();
    renderCombatHud();
}

// ========== Highlight ==========
function createHighlight() {
    if (highlightBox) return;
    const geometry = new THREE.BoxGeometry(1, 0.1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 });
    highlightBox = new THREE.Mesh(geometry, material);
    highlightBox.visible = false;
    scene.add(highlightBox);
}

function updateHighlight(x, z, height) {
    if (!highlightBox) createHighlight();
    const size = 1 + brushRadius * 2;
    highlightBox.scale.set(size, 0.1, size);
    highlightBox.position.set(x + 0.5, height + 0.1, z + 0.5);
    highlightBox.visible = true;
}

function hideHighlight() {
    if (highlightBox) highlightBox.visible = false;
}

function getLocationObjectAtScreen(clientX, clientY) {
    if (!renderer || !camera) return null;
    const cacheKey = `${currentLocationId || ''}:${Math.floor(clientX / 4)}:${Math.floor(clientY / 4)}:${locationObjectMeshes.length}`;
    if (locationObjectPickCache.key === cacheKey) {
        return locationObjectPickCache.result;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(locationObjectMeshes, true)[0];
    if (!hit) return null;
    let mesh = hit.object;
    while (mesh && !mesh.userData.locationObjectId) mesh = mesh.parent;
    locationObjectPickCache = { key: cacheKey, result: mesh || null };
    return mesh || null;
}

function getObjectActions(object) {
    const actions = [...(object.properties?.interactions || objectInteractions[object.type] || [])];
    const hasContainerContents = Array.isArray(object?.properties?.contents) && object.properties.contents.length >= 0;
    if ((object?.type === 'corpse' || object?.type === 'body' || object?.properties?.is_corpse || hasContainerContents) && !actions.includes('open_container')) {
        actions.push('open_container');
    }
    return actions;
}

function getStructureActions(object) {
    const actions = [...getObjectActions(object)];
    if (['door', 'table', 'chair', 'shelf', 'chest'].includes(object.type) && !actions.includes('rotate')) {
        actions.push('rotate');
    }
    if ((LOW_CLIMB_OBJECT_TYPES.has(object.type) || HIGH_CLIMB_OBJECT_TYPES.has(object.type) || object.properties?.climbable) && !actions.includes('climb')) {
        actions.push('climb');
    }
    if (combatState?.status === 'active' && isStructureCoverObject(object)) {
        const actorId = pendingStructureAction?.actorCharacterId;
        const combatCharacter = findCombatCharacterByCharacterId(actorId);
        const occupiesThisCover = Number(combatCharacter?.cover_object_id) === Number(object.id);
        actions.push(occupiesThisCover ? 'leave_cover' : 'take_cover');
        if (
            occupiesThisCover
            && combatCharacter?.drawn_weapon_index !== null
            && combatCharacter?.drawn_weapon_index !== undefined
            && !combatCharacter?.weapon_braced
        ) {
            actions.push('brace_weapon');
        }
    }
    return [...new Set(actions)];
}

function isStructureCoverObject(object) {
    const properties = object?.properties || {};
    const type = String(object?.type || '').toLowerCase();
    if (properties.cover_enabled === false) return false;
    if (['floor', 'ground_item', 'campfire', 'anomaly'].includes(type)) return false;
    if (type === 'door' && properties.is_open) return false;
    return getObjectTraversalHeight(object) >= 0.3;
}

function getActionRequirement(object, actionKey) {
    return object?.properties?.interaction_requirements?.[actionKey] || interactionRequirements[actionKey] || {};
}

function getStructureActionLabel(object, actionKey) {
    if (actionKey === 'toggle_door') return object?.properties?.is_open ? 'Закрыть' : 'Открыть';
    if (actionKey === 'open_container') return (object?.type === 'ground_item' || object?.properties?.is_ground_item) ? 'Поднять' : (object?.type === 'chest' ? 'Открыть сундук' : 'Открыть');
    if (actionKey === 'move') return 'Переставить';
    if (actionKey === 'rotate') return 'Повернуть';
    if (actionKey === 'climb') return 'Перелезть';
    if (actionKey === 'take_cover') return 'Занять укрытие';
    if (actionKey === 'leave_cover') return 'Покинуть укрытие';
    if (actionKey === 'brace_weapon') return 'Поставить оружие на упор';
    return actionKey;
}

function getStructureActionIcon(actionKey) {
    if (actionKey === 'toggle_door') return '🚪';
    if (actionKey === 'open_container') return '↑';
    if (actionKey === 'move') return '⤢';
    if (actionKey === 'rotate') return '↻';
    if (actionKey === 'climb') return '↑';
    if (actionKey === 'take_cover') return '◒';
    if (actionKey === 'leave_cover') return '○';
    if (actionKey === 'brace_weapon') return '⊥';
    return '•';
}

function clonePlainObject(value) {
    if (value === null || value === undefined) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return value;
    }
}

function getObjectTraversalHeight(object) {
    const properties = object?.properties || {};
    const dimensions = properties.dimensions || {};
    const rawHeight = dimensions.height ?? properties.height ?? object?.height;
    const parsed = Number(rawHeight);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;

    const type = object?.type || object?.object_type || '';
    if (type === 'ground_item' || properties.is_ground_item) return 0.08;
    if (type === 'fence') return 1.2;
    if (type === 'chair') return 0.9;
    if (type === 'chest') return 1.0;
    if (type === 'table') return 1.0;
    if (type === 'shelf') return 2.0;
    if (['tree', 'rock', 'house', 'tent', 'wall'].includes(type)) return 2.5;
    return 1.5;
}

function getObjectGridPosition(object, fallbackX = null, fallbackY = null) {
    if (!object || typeof object !== 'object') return { x: null, y: null };
    const rawX = fallbackX ?? object.tile_x ?? object.pos_x ?? object.posX ?? object.x ?? null;
    const rawY = fallbackY ?? object.tile_y ?? object.pos_y ?? object.posY ?? object.z ?? null;
    const x = Number(rawX);
    const y = Number(rawY);
    return {
        x: Number.isFinite(x) ? x : null,
        y: Number.isFinite(y) ? y : null,
    };
}

function getCharacterModelEntry(characterId) {
    if (characterId === null || characterId === undefined) return null;
    const direct = characterModels.get(characterId);
    if (direct) return direct;
    const stringKey = String(characterId);
    const stringMatch = characterModels.get(stringKey);
    if (stringMatch) return stringMatch;
    for (const [key, value] of characterModels.entries()) {
        if (String(key) === stringKey) return value;
    }
    return null;
}

function getObjectTraversalDimensions(object) {
    const type = object?.type || object?.object_type || '';
    const properties = object?.properties || {};
    const dimensions = properties.dimensions || {};
    const defaults = {
        door: { width: 0.9, depth: 0.18 },
        table: { width: 1.4, depth: 0.8 },
        chair: { width: 0.55, depth: 0.55 },
        shelf: { width: 1.0, depth: 0.35 },
        chest: { width: 0.9, depth: 0.6 },
        fence: { width: 2.0, depth: 0.15 },
        wall: { width: 1.5, depth: 0.2 },
    };
    const fallback = defaults[type] || { width: 1, depth: 1 };
    let width = Number(dimensions.width ?? properties.width ?? fallback.width);
    let depth = Number(dimensions.depth ?? properties.depth ?? fallback.depth);
    if (!Number.isFinite(width) || width <= 0) width = fallback.width;
    if (!Number.isFinite(depth) || depth <= 0) depth = fallback.depth;
    const rotation = Number(properties.rotation || 0);
    const quarterTurns = ((Math.round(rotation / (Math.PI / 2)) % 4) + 4) % 4;
    if (quarterTurns % 2 === 1) {
        [width, depth] = [depth, width];
    }
    return { width, depth };
}

function getObjectFootprintBounds(object, fallbackX = null, fallbackY = null) {
    const { width, depth } = getObjectTraversalDimensions(object);
    const { x, y } = getObjectGridPosition(object, fallbackX, fallbackY);
    const centerX = (x ?? 0) + 0.5;
    const centerY = (y ?? 0) + 0.5;
    return {
        minX: centerX - (width / 2),
        maxX: centerX + (width / 2),
        minY: centerY - (depth / 2),
        maxY: centerY + (depth / 2),
    };
}

function getObjectFootprintTiles(object, fallbackX = null, fallbackY = null) {
    const bounds = getObjectFootprintBounds(object, fallbackX, fallbackY);
    const tiles = [];
    const minTileX = Math.floor(bounds.minX);
    const maxTileX = Math.floor(bounds.maxX - 0.0001);
    const minTileY = Math.floor(bounds.minY);
    const maxTileY = Math.floor(bounds.maxY - 0.0001);
    for (let x = minTileX; x <= maxTileX; x += 1) {
        for (let y = minTileY; y <= maxTileY; y += 1) {
            const overlaps = bounds.minX < x + 1 && bounds.maxX > x && bounds.minY < y + 1 && bounds.maxY > y;
            if (overlaps) tiles.push({ x, y });
        }
    }
    return tiles;
}

function tileHasObjectFootprint(object, x, y, fallbackX = null, fallbackY = null) {
    const position = getObjectGridPosition(object, fallbackX, fallbackY);
    if (position.x === null || position.y === null) return false;
    return getObjectFootprintTiles(object, fallbackX, fallbackY).some((tile) => tile.x === x && tile.y === y);
}

function getMovementMap(movingCharacterId = null) {
    const grapple = getGrappleMovementContext(movingCharacterId);
    const ignoredCharacterIds = new Set([
        String(movingCharacterId ?? ''),
        String(grapple?.captiveCharacterId ?? ''),
    ]);
    const cacheKey = (
        `${movementMapVersion}:${currentLocationId || ''}:${movingCharacterId ?? ''}`
        + `:${grapple?.captiveCharacterId ?? ''}`
    );
    const cached = movementMapCache.get(cacheKey);
    if (cached) return cached;

    const blockedTiles = new Set();
    const climbCostTiles = new Map();
    const locationObjects = Array.isArray(currentLocationData?.objects) ? currentLocationData.objects : [];
    const tiles = Array.isArray(currentLocationData?.tiles_data) ? currentLocationData.tiles_data : [];

    for (const object of locationObjects) {
        if (!object) continue;
        const profile = getMovementObjectProfile(object);
        for (const footprintTile of getObjectFootprintTiles(object)) {
            const key = `${footprintTile.x}:${footprintTile.y}`;
            if (profile.blocked) {
                blockedTiles.add(key);
                climbCostTiles.delete(key);
            } else if (profile.climbCost > 0 && !blockedTiles.has(key)) {
                climbCostTiles.set(key, Math.max(climbCostTiles.get(key) || 0, profile.climbCost));
            }
        }
    }

    for (let y = 0; y < tiles.length; y += 1) {
        const row = tiles[y];
        if (!Array.isArray(row)) continue;
        for (let x = 0; x < row.length; x += 1) {
            const tile = row[x];
            const objects = Array.isArray(tile?.objects) ? tile.objects : [];
            for (const object of objects) {
                if (!object) continue;
                const profile = getMovementObjectProfile(object);
                for (const footprintTile of getObjectFootprintTiles(object, x, y)) {
                    const key = `${footprintTile.x}:${footprintTile.y}`;
                    if (profile.blocked) {
                        blockedTiles.add(key);
                        climbCostTiles.delete(key);
                    } else if (profile.climbCost > 0 && !blockedTiles.has(key)) {
                        climbCostTiles.set(key, Math.max(climbCostTiles.get(key) || 0, profile.climbCost));
                    }
                }
            }
        }
    }

    if (characterModels && typeof characterModels.forEach === 'function') {
        characterModels.forEach((entry, characterId) => {
            if (ignoredCharacterIds.has(String(characterId))) return;
            if (!entry) return;
            blockedTiles.add(`${entry.posX}:${entry.posY}`);
            climbCostTiles.delete(`${entry.posX}:${entry.posY}`);
        });
    }

    const result = { blockedTiles, climbCostTiles };
    movementMapCache.set(cacheKey, result);
    return result;
}

function findClimbLandingTile(object, actorEntry, actorCharacterId = null) {
    if (!object || !actorEntry) return null;
    const width = currentLocationData?.grid_width || 0;
    const height = currentLocationData?.grid_height || 0;
    if (!width || !height) return null;

    const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
    const occupiedTiles = getObjectFootprintTiles(object);
    if (!occupiedTiles.length) return null;
    const center = occupiedTiles.reduce((acc, tile) => ({
        x: acc.x + tile.x + 0.5,
        y: acc.y + tile.y + 0.5,
    }), { x: 0, y: 0 });
    center.x /= occupiedTiles.length;
    center.y /= occupiedTiles.length;
    const actorVectorX = center.x - (actorEntry.posX + 0.5);
    const actorVectorY = center.y - (actorEntry.posY + 0.5);

    const nearestDistance = occupiedTiles.reduce((best, tile) => {
        const distance = Math.max(Math.abs(actorEntry.posX - tile.x), Math.abs(actorEntry.posY - tile.y));
        return Math.min(best, distance);
    }, Infinity);
    if (nearestDistance > 1) {
        return null;
    }

    const candidates = [];
    const seen = new Set();
    for (const tile of occupiedTiles) {
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
                if (dx === 0 && dy === 0) continue;
                const candidate = { x: tile.x + dx, y: tile.y + dy };
                const key = `${candidate.x}:${candidate.y}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (inBounds(candidate.x, candidate.y)) {
                    candidates.push(candidate);
                }
            }
        }
    }

    candidates.sort((a, b) => {
        const projA = ((a.x + 0.5) - (actorEntry.posX + 0.5)) * actorVectorX + ((a.y + 0.5) - (actorEntry.posY + 0.5)) * actorVectorY;
        const projB = ((b.x + 0.5) - (actorEntry.posX + 0.5)) * actorVectorX + ((b.y + 0.5) - (actorEntry.posY + 0.5)) * actorVectorY;
        if (projA !== projB) return projB - projA;
        const distA = Math.max(Math.abs(a.x - actorEntry.posX), Math.abs(a.y - actorEntry.posY));
        const distB = Math.max(Math.abs(b.x - actorEntry.posX), Math.abs(b.y - actorEntry.posY));
        return distB - distA;
    });

    for (const candidate of candidates) {
        if (candidate.x === actorEntry.posX && candidate.y === actorEntry.posY) {
            continue;
        }
        const profile = getTileMovementProfile(candidate.x, candidate.y, actorCharacterId);
        if (!profile.blocked && profile.climbCost === 0) {
            return candidate;
        }
    }
    return null;
}

function getClimbActionMode(object) {
    const profile = getMovementObjectProfile(object);
    return profile.climbCost >= 12 ? 'high' : 'low';
}

function performClimbAction(object, actorCharacterId) {
    const actor = getLocationCharacterById(actorCharacterId);
    if (!actor) {
        showNotification('Не удалось определить персонажа');
        return false;
    }
    const landing = findClimbLandingTile(object, actor, actorCharacterId);
    if (!landing) {
        showNotification('Не удалось найти клетку для перелезания', 'system');
        hideStructureInteraction();
        return false;
    }
    if (!window.socket || !window.currentLocationId) {
        showNotification('Не удалось выполнить перелезание', 'system');
        return false;
    }
    window.socket.emit('move_in_location', {
        token: localStorage.getItem('access_token'),
        location_id: window.currentLocationId,
        character_id: actorCharacterId,
        x: landing.x,
        y: landing.y,
        special_action: 'climb',
        object_id: object.id,
        climb_mode: getClimbActionMode(object),
    });
    hideStructureInteraction();
    return true;
}

function getLocationCharacterById(characterId) {
    if (!characterId) return null;
    return getCharacterModelEntry(characterId);
}

function getLocationCharacterCondition(characterId) {
    const combatCharacter = findCombatCharacterByCharacterId(characterId);
    if (combatCharacter?.condition?.state) return combatCharacter.condition;
    const entry = getLocationCharacterById(characterId);
    const effects = Array.isArray(entry?.effects) ? entry.effects : [];
    const types = new Set(effects
        .filter(effect => effect?.active !== false)
        .map(effect => String(effect?.type || '').toLowerCase()));
    const names = effects.map(effect => String(effect?.name || '').toLowerCase()).join(' ');
    if (types.has('death') || /\bсмерт|м[её]ртв/.test(names)) {
        return { state: 'dead', label: 'Мёртв', can_act: false, can_recover: false };
    }
    if (
        types.has('critical_condition')
        || types.has('unconsciousness')
        || types.has('unconscious')
        || types.has('sleep')
        || /критическ|без сознания/.test(names)
    ) {
        return { state: 'critical', label: 'Критическое состояние', can_act: false, can_recover: false };
    }
    if (types.has('shock') || types.has('pain_shock') || /болевой шок/.test(names)) {
        return { state: 'pain_shock', label: 'Болевой шок', can_act: false, can_recover: true };
    }
    return { state: 'active', label: 'В сознании', can_act: true, can_recover: false };
}

window.getLocationCharacterPosition = function(characterId) {
    const entry = getLocationCharacterById(characterId);
    if (!entry) return null;
    return { x: entry.posX, y: entry.posY };
};

window.getGroundItemObjectAtPosition = function(tileX, tileY) {
    if (!currentLocationData || !Array.isArray(currentLocationData.objects)) return null;
    return currentLocationData.objects.find((object) => {
        if (!object) return false;
        if (object.type !== 'ground_item' && !object.properties?.is_ground_item) return false;
        const position = getObjectGridPosition(object);
        return position.x === tileX && position.y === tileY;
    }) || null;
};

function getCurrentInteractionActor(characterId = null) {
    const resolvedCharacterId = characterId
        || pendingStructureAction?.actorCharacterId
        || combatState?.current_character?.character_id
        || window.currentLocationCharacterId
        || null;
    return getLocationCharacterById(resolvedCharacterId);
}

function getCharacterTileDistance(characterId, object) {
    const entry = getLocationCharacterById(characterId);
    if (!entry || !object) return Infinity;
    const footprintTiles = getObjectFootprintTiles(object);
    if (!footprintTiles.length) {
        const { x, y } = getObjectGridPosition(object);
        if (x === null || y === null) return Infinity;
        return Math.max(Math.abs(entry.posX - x), Math.abs(entry.posY - y));
    }
    return footprintTiles.reduce((best, tile) => {
        const distance = Math.max(Math.abs(entry.posX - tile.x), Math.abs(entry.posY - tile.y));
        return Math.min(best, distance);
    }, Infinity);
}

function isStructureActionAllowed(object, actionKey, characterId = null) {
    const actor = getCurrentInteractionActor(characterId);
    if (!actor) return false;
    const requirement = getActionRequirement(object, actionKey);
    return getCharacterTileDistance(actor.userData?.characterId || characterId || pendingStructureAction?.actorCharacterId, object) <= (requirement.max_distance ?? 1);
}

async function updateInteractiveObject(objectId, updates) {
    try {
        const object = await Server.updateLocationObject(window.currentLobbyId, objectId, updates);
        updateLocationObject(object);
    } catch (error) {
        showNotification(error.message || 'Не удалось обновить объект');
    }
}

function getLocationObjectMeshById(objectId) {
    return locationObjectMeshes.find((mesh) => mesh.userData.locationObjectId === objectId) || null;
}

function clearStructureActionMenu() {
    if (structureActionMenu) {
        structureActionMenu.style.display = 'none';
        structureActionMenuState = null;
    }
}

function clearStructureRotationMenu() {
    if (structureRotationMenu) {
        structureRotationMenu.style.display = 'none';
        structureRotationMenuState = null;
    }
}

function ensureStructureActionMenu() {
    if (structureActionMenu) return;
    structureActionMenu = document.createElement('div');
    structureActionMenu.id = 'structure-action-menu';
    structureActionMenu.style.cssText = `
        position: fixed;
        z-index: 1110;
        display: none;
        pointer-events: auto;
        min-width: 170px;
        max-width: 220px;
        background: rgba(14, 18, 26, 0.96);
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 14px;
        box-shadow: 0 16px 34px rgba(0,0,0,0.4);
        backdrop-filter: blur(10px);
        color: #fff;
        overflow: hidden;
        font-family: 'Segoe UI', Arial, sans-serif;
    `;
    document.body.appendChild(structureActionMenu);
    const onClick = (event) => {
        if (structureActionMenu && !structureActionMenu.contains(event.target)) {
            clearStructureActionMenu();
        }
    };
    document.addEventListener('click', onClick);
    handlers.document.structureMenuClick = onClick;
}

function ensureStructureRotationMenu() {
    if (structureRotationMenu) return;
    structureRotationMenu = document.createElement('div');
    structureRotationMenu.id = 'structure-rotation-menu';
    structureRotationMenu.style.cssText = `
        position: fixed;
        z-index: 1115;
        display: none;
        pointer-events: auto;
        min-width: 150px;
        background: rgba(14, 18, 26, 0.96);
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 14px;
        box-shadow: 0 16px 34px rgba(0,0,0,0.4);
        backdrop-filter: blur(10px);
        color: #fff;
        overflow: hidden;
        font-family: 'Segoe UI', Arial, sans-serif;
    `;
    document.body.appendChild(structureRotationMenu);
    const onClick = (event) => {
        if (structureRotationMenu && !structureRotationMenu.contains(event.target)) {
            clearStructureRotationMenu();
        }
    };
    document.addEventListener('click', onClick);
    handlers.document.structureRotationMenuClick = onClick;
}

function showStructureRotationMenu(object) {
    ensureStructureRotationMenu();
    const currentRotation = Number(object?.properties?.rotation || 0);
    structureRotationMenuState = { objectId: object.id };

    structureRotationMenu.innerHTML = `
        <div style="
            padding: 10px 12px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.02em;
            opacity: 0.9;
        ">Поворот</div>
    `;

    const actions = [
        { label: '↺', title: 'Повернуть влево', rotation: currentRotation + (Math.PI / 2) },
        { label: '↻', title: 'Повернуть вправо', rotation: currentRotation - (Math.PI / 2) },
    ];

    actions.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.title = item.title;
        button.style.cssText = `
            display:flex;
            align-items:center;
            justify-content:center;
            width:64px;
            height:52px;
            padding: 0;
            border: 0;
            background: rgba(255,255,255,0.06);
            color: #fff;
            cursor: pointer;
            font-size: 24px;
            border-radius: 14px;
            margin: 8px;
        `;
        button.onclick = async (event) => {
            event.stopPropagation();
            clearStructureRotationMenu();
            await updateInteractiveObject(object.id, {
                properties: { rotation: item.rotation }
            });
            hideStructureInteraction();
        };
        structureRotationMenu.appendChild(button);
    });

    structureRotationMenu.style.display = 'block';
    const mesh = getLocationObjectMeshById(object.id);
    let left = window.innerWidth / 2 - 80;
    let top = window.innerHeight / 2 - 50;
    if (mesh && camera) {
        const anchor = new THREE.Vector3();
        mesh.getWorldPosition(anchor);
        anchor.y += 1.2;
        anchor.project(camera);
        if (anchor.z > -1 && anchor.z < 1) {
            left = ((anchor.x + 1) / 2) * window.innerWidth + 16;
            top = ((1 - anchor.y) / 2) * window.innerHeight + 16;
        }
    }
    const rect = structureRotationMenu.getBoundingClientRect();
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    structureRotationMenu.style.left = `${left}px`;
    structureRotationMenu.style.top = `${top}px`;
    structureRotationMenu.style.display = 'block';
}

function getLocationObjectsAtTile(x, y) {
    const objects = [];
    const tile = currentLocationData?.tiles_data?.[y]?.[x];
    if (tile?.objects && Array.isArray(tile.objects)) {
        tile.objects.forEach((object) => {
            if (object && typeof object === 'object' && tileHasObjectFootprint(object, x, y, x, y)) objects.push(object);
        });
    }
    if (Array.isArray(currentLocationData?.objects)) {
        currentLocationData.objects.forEach((object) => {
            if (object && tileHasObjectFootprint(object, x, y)) {
                objects.push(object);
            }
        });
    }
    return objects;
}

function getMovementObjectProfile(object) {
    if (!object) return { blocked: false, climbCost: 0 };
    const type = object.type || object.object_type || '';
    const properties = object.properties || {};
    const height = getObjectTraversalHeight(object);

    if (properties.passable === true || PASSABLE_OBJECT_TYPES.has(type)) {
        return { blocked: false, climbCost: 0 };
    }

    if (type === 'door') {
        if (properties.is_open) return { blocked: false, climbCost: 0 };
        if (properties.climbable) {
            return { blocked: false, climbCost: Number(properties.climb_cost || 12) };
        }
        return { blocked: true, climbCost: 0 };
    }

    if (properties.blocks_movement === false) {
        return { blocked: false, climbCost: 0 };
    }

    if (properties.climbable || LOW_CLIMB_OBJECT_TYPES.has(type) || height <= 1.05) {
        const climbCost = properties.climb_cost !== undefined
            ? Number(properties.climb_cost)
            : 5;
        return { blocked: false, climbCost: Math.max(1, climbCost) };
    }

    if (HIGH_CLIMB_OBJECT_TYPES.has(type) || (height > 1.05 && height <= 1.6)) {
        const climbCost = properties.climb_cost !== undefined
            ? Number(properties.climb_cost)
            : 12;
        return { blocked: false, climbCost: Math.max(1, climbCost) };
    }

    if (properties.block_movement === false) {
        return { blocked: false, climbCost: 0 };
    }

    if (properties.block_movement || TOO_HIGH_OBJECT_TYPES.has(type) || properties.blocks_movement === true || height > 1.8) {
        return { blocked: true, climbCost: 0 };
    }

    return { blocked: true, climbCost: 0 };
}

function getTileMovementProfile(x, y, movingCharacterId = null) {
    const profile = { blocked: false, climbCost: 0 };
    const movementMap = getMovementMap(movingCharacterId);
    const tileKey = `${x}:${y}`;
    if (movementMap.blockedTiles.has(tileKey)) {
        profile.blocked = true;
        return profile;
    }
    if (movementMap.climbCostTiles.has(tileKey)) {
        profile.climbCost = movementMap.climbCostTiles.get(tileKey) || 0;
    }

    return profile;
}

function findMovementPath(startX, startY, endX, endY, movingCharacterId = null) {
    if (startX === endX && startY === endY) {
        return { cost: 0, path: [[startX, startY]] };
    }

    const width = currentLocationData?.grid_width || 0;
    const height = currentLocationData?.grid_height || 0;
    if (!width || !height) return null;

    const inBounds = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
    const grapple = getGrappleMovementContext(movingCharacterId);
    const companionCanOccupy = (x, y) => {
        if (!grapple) return true;
        const companionX = x + grapple.offsetX;
        const companionY = y + grapple.offsetY;
        if (!inBounds(companionX, companionY)) return false;
        const profile = getTileMovementProfile(
            companionX,
            companionY,
            movingCharacterId,
        );
        return !profile.blocked && profile.climbCost === 0;
    };
    const keyFor = (x, y) => `${x}:${y}`;
    const directions = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1],
    ];

    const open = [{ x: startX, y: startY, cost: 0, priority: 0 }];
    const cameFrom = new Map();
    const costSoFar = new Map([[keyFor(startX, startY), 0]]);
    const visited = new Set();

    const heuristic = (x, y) => Math.max(Math.abs(endX - x), Math.abs(endY - y));
    const targetProfile = getTileMovementProfile(endX, endY, movingCharacterId);
    if (targetProfile.climbCost > 0 || !companionCanOccupy(endX, endY)) return null;

    while (open.length) {
        open.sort((a, b) => a.priority - b.priority || a.cost - b.cost);
        const current = open.shift();
        const currentKey = keyFor(current.x, current.y);
        if (visited.has(currentKey)) continue;
        visited.add(currentKey);

        if (current.x === endX && current.y === endY) {
            const path = [[endX, endY]];
            let cursor = currentKey;
            while (cameFrom.has(cursor)) {
                cursor = cameFrom.get(cursor);
                const [px, py] = cursor.split(':').map(Number);
                path.push([px, py]);
            }
            path.reverse();
            return { cost: current.cost, path };
        }

        for (const [dx, dy] of directions) {
            const nx = current.x + dx;
            const ny = current.y + dy;
            if (!inBounds(nx, ny)) continue;

            if (dx !== 0 && dy !== 0) {
                const sideA = getTileMovementProfile(current.x + dx, current.y, movingCharacterId);
                const sideB = getTileMovementProfile(current.x, current.y + dy, movingCharacterId);
                if ((sideA.blocked && sideA.climbCost === 0) || (sideB.blocked && sideB.climbCost === 0)) {
                    continue;
                }
                if (
                    !companionCanOccupy(current.x + dx, current.y)
                    || !companionCanOccupy(current.x, current.y + dy)
                ) {
                    continue;
                }
            }

            const tileProfile = getTileMovementProfile(nx, ny, movingCharacterId);
            if (nx === endX && ny === endY && tileProfile.climbCost > 0) continue;
            if (tileProfile.blocked && tileProfile.climbCost === 0) continue;
            if (!companionCanOccupy(nx, ny)) continue;

            const stepCost = 1 + Math.max(0, tileProfile.climbCost || 0);
            const newCost = current.cost + stepCost;
            const nextKey = keyFor(nx, ny);
            if (costSoFar.has(nextKey) && newCost >= costSoFar.get(nextKey)) continue;

            costSoFar.set(nextKey, newCost);
            cameFrom.set(nextKey, currentKey);
            open.push({
                x: nx,
                y: ny,
                cost: newCost,
                priority: newCost + heuristic(nx, ny),
            });
        }
    }

    return null;
}

function clearStructureMovePreview() {
    if (structureMovePreviewGhost && scene) {
        scene.remove(structureMovePreviewGhost);
        structureMovePreviewGhost.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            if (Array.isArray(child.material)) {
                child.material.forEach((material) => material.dispose());
            } else {
                child.material.dispose();
            }
        });
        structureMovePreviewGhost = null;
    }
    if (structureMovePreviewHint) {
        structureMovePreviewHint.style.display = 'none';
    }
    structureMovePreviewObjectId = null;
}

function ensureStructureMovePreviewHint() {
    if (structureMovePreviewHint) return structureMovePreviewHint;
    structureMovePreviewHint = document.createElement('div');
    structureMovePreviewHint.style.cssText = `
        position: fixed;
        z-index: 1200;
        display: none;
        pointer-events: none;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(8, 12, 18, 0.85);
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        border: 1px solid rgba(255,255,255,0.18);
        box-shadow: 0 10px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(8px);
    `;
    document.body.appendChild(structureMovePreviewHint);
    return structureMovePreviewHint;
}

function hideStructureInteraction() {
    clearStructureActionMenu();
    clearStructureRotationMenu();
    clearStructureMovePreview();
    closeContainerInteractionMenu();
    pendingObjectMoveId = null;
    pendingStructureAction = null;
    hoveredStructureObjectId = null;
    structureHoverLastObjectId = null;
}

function beginStructureInteractionMode(characterId) {
    if (!isCurrentCombatTurnForCharacter(characterId)) {
        showNotification('Сейчас не ход этого персонажа', 'system');
        return false;
    }
    if (!canControlCharacter(characterId)) {
        showNotification('Вы не можете управлять этим персонажем');
        return false;
    }
    pendingStructureAction = {
        actorCharacterId: characterId,
        actorLocationCharacterId: combatState?.current_character?.location_character_id || null,
        createdAt: Date.now(),
    };
    pendingCombatAction = null;
    armedMoveCharacterId = null;
    clearAttackPreview();
    clearMovementPreview();
    clearStructureActionMenu();
    clearStructureMovePreview();
    showNotification('Наведи на структуру или недееспособного персонажа и выбери действие', 'system');
    renderCombatHud();
    return true;
}

function canInteractWithIncapacitatedCharacter(actorCharacterId, targetCharacterId) {
    if (!actorCharacterId || !targetCharacterId || Number(actorCharacterId) === Number(targetCharacterId)) {
        return false;
    }
    const actor = getLocationCharacterById(actorCharacterId);
    const target = getLocationCharacterById(targetCharacterId);
    if (!actor || !target || getLocationCharacterCondition(targetCharacterId).state === 'active') {
        return false;
    }
    return Math.max(
        Math.abs(Number(actor.posX) - Number(target.posX)),
        Math.abs(Number(actor.posY) - Number(target.posY))
    ) <= 1;
}

async function inspectIncapacitatedCharacter(actorLocationCharacterId, targetCharacterId) {
    const snapshot = await Server.inspectLocationCharacter(
        window.currentLobbyId,
        getCurrentLocationId(),
        targetCharacterId,
        actorLocationCharacterId
    );
    const health = snapshot.health || {};
    const effects = (health.effects || [])
        .filter(effect => effect?.active !== false)
        .map(effect => effect.name || effect.type)
        .filter(Boolean);
    showNotification(
        [
            `${snapshot.target_name}: ${snapshot.condition?.label || 'состояние неизвестно'}`,
            health.current !== null && health.current !== undefined
                ? `ОЗ ${health.current}/${health.max ?? '?'}`
                : null,
            `Кровопотеря: ${health.blood_stage || 'normal'}`,
            `Боль: ${health.pain_level ?? 0}`,
            effects.length ? `Эффекты: ${effects.join(', ')}` : 'Активных эффектов нет',
        ].filter(Boolean).join('. '),
        'system'
    );
    return snapshot;
}

async function showCharacterLootMenu(actorLocationCharacterId, targetCharacterId) {
    closeContainerInteractionMenu();
    const snapshot = await Server.inspectLocationCharacter(
        window.currentLobbyId,
        getCurrentLocationId(),
        targetCharacterId,
        actorLocationCharacterId
    );
    if (!containerInteractionMenu) {
        containerInteractionMenu = document.createElement('div');
        containerInteractionMenu.style.cssText = `
            position:fixed; z-index:1210; width:min(620px,calc(100vw - 24px));
            max-height:min(82vh,760px); overflow:hidden; display:none;
            background:rgba(14,18,26,.98); border:1px solid rgba(255,255,255,.16);
            border-radius:16px; box-shadow:0 20px 42px rgba(0,0,0,.45);
            color:#fff; backdrop-filter:blur(10px);
        `;
        document.body.appendChild(containerInteractionMenu);
    }
    containerInteractionState = {
        characterId: targetCharacterId,
        actorLocationCharacterId,
    };
    containerInteractionMenu.innerHTML = `
        <div class="container-drag-handle" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08);cursor:move;">
            <div><strong>Обыск: ${escapeHtml(snapshot.target_name || 'Персонаж')}</strong><div style="font-size:12px;opacity:.7;">${escapeHtml(snapshot.condition?.label || '')}</div></div>
            <button type="button" class="container-close-btn" style="width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;font-size:18px;">×</button>
        </div>
        <div class="character-loot-list" style="padding:12px 14px;max-height:calc(min(82vh,760px) - 72px);overflow:auto;"></div>
    `;
    const list = containerInteractionMenu.querySelector('.character-loot-list');
    const entries = getCharacterTransferEntries(snapshot.target_data || {});
    if (!entries.length) {
        list.innerHTML = '<div style="opacity:.75;padding:10px 2px;">Нечего обыскивать</div>';
    } else {
        entries.forEach(entry => {
            list.appendChild(buildTransferRow(entry, '→', async (amount = 1) => {
                try {
                    await Server.lootLocationCharacter(
                        window.currentLobbyId,
                        getCurrentLocationId(),
                        targetCharacterId,
                        {
                            actor_location_character_id: actorLocationCharacterId,
                            item_path: entry.path,
                            amount,
                        }
                    );
                    showNotification('Предмет забран', 'success');
                    await showCharacterLootMenu(actorLocationCharacterId, targetCharacterId);
                } catch (error) {
                    showNotification(error.message || 'Не удалось забрать предмет', 'system');
                }
            }));
        });
    }
    containerInteractionMenu.querySelector('.container-close-btn').onclick = closeContainerInteractionMenu;
    containerInteractionMenu.style.display = 'block';
    containerInteractionMenu.style.left = `${Math.max(8, window.innerWidth / 2 - 310)}px`;
    containerInteractionMenu.style.top = `${Math.max(8, window.innerHeight / 2 - Math.min(window.innerHeight * .4, 360))}px`;
}

function showCharacterInteractionMenu(clientX, clientY, targetCharacterId) {
    const actorCharacterId = pendingStructureAction?.actorCharacterId;
    const actorLocationCharacterId = pendingStructureAction?.actorLocationCharacterId;
    if (!canInteractWithIncapacitatedCharacter(actorCharacterId, targetCharacterId)) {
        clearStructureActionMenu();
        return;
    }
    ensureStructureActionMenu();
    const target = getLocationCharacterById(targetCharacterId);
    const condition = getLocationCharacterCondition(targetCharacterId);
    structureActionMenuState = {
        objectId: `character:${targetCharacterId}`,
        characterId: targetCharacterId,
    };
    structureActionMenu.innerHTML = `
        <div style="padding:10px 12px 8px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;font-weight:700;">
            ${escapeHtml(target?.name || 'Персонаж')} · ${escapeHtml(condition.label)}
        </div>
    `;
    const actions = [
        {
            icon: '◉',
            label: 'Осмотреть',
            run: () => inspectIncapacitatedCharacter(actorLocationCharacterId, targetCharacterId),
        },
        {
            icon: '⌕',
            label: 'Обыскать',
            run: () => showCharacterLootMenu(actorLocationCharacterId, targetCharacterId),
        },
        {
            icon: '✚',
            label: 'Попытаться лечить',
            run: () => showMedicalConsumableMenu(actorCharacterId, targetCharacterId),
        },
    ];
    actions.forEach(action => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.icon;
        button.title = action.label;
        button.style.cssText = 'width:52px;height:52px;margin:8px;border:0;border-radius:14px;background:rgba(255,255,255,.06);color:#fff;font-size:20px;cursor:pointer;';
        button.onclick = async event => {
            event.stopPropagation();
            clearStructureActionMenu();
            try {
                await action.run();
            } catch (error) {
                showNotification(error.message || 'Не удалось выполнить взаимодействие', 'system');
            }
        };
        structureActionMenu.appendChild(button);
    });
    const rect = structureActionMenu.getBoundingClientRect();
    structureActionMenu.style.left = `${Math.max(8, Math.min(clientX + 18, window.innerWidth - rect.width - 8))}px`;
    structureActionMenu.style.top = `${Math.max(8, Math.min(clientY + 18, window.innerHeight - rect.height - 8))}px`;
    structureActionMenu.style.display = 'block';
}

async function executeStructureAction(object, actionKey) {
    const actorCharacterId = pendingStructureAction?.actorCharacterId || null;
    if (!actorCharacterId) {
        showNotification('Не удалось определить персонажа');
        return false;
    }
    if (!isStructureActionAllowed(object, actionKey, actorCharacterId)) {
        showNotification('Слишком далеко до объекта', 'system');
        return false;
    }

    if (actionKey === 'toggle_door') {
        const isOpen = Boolean(object.properties?.is_open);
        await updateInteractiveObject(object.id, { properties: { is_open: !isOpen } });
        hideStructureInteraction();
        return true;
    }

    if (actionKey === 'rotate') {
        if (object?.type === 'fence') {
            showNotification('Забор нельзя поворачивать', 'system');
            return false;
        }
        showStructureRotationMenu(object);
        return true;
    }

    if (actionKey === 'open_container') {
        hideStructureInteraction();
        showContainerInteractionMenu(object);
        return true;
    }

    if (actionKey === 'climb') {
        return performClimbAction(object, actorCharacterId);
    }

    if (actionKey === 'take_cover' || actionKey === 'leave_cover') {
        const combatCharacter = findCombatCharacterByCharacterId(actorCharacterId);
        if (!combatCharacter?.location_character_id) {
            showNotification('Не удалось найти персонажа в бою', 'system');
            return false;
        }
        try {
            await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
                location_character_id: combatCharacter.location_character_id,
                action_key: actionKey,
                target_object_id: actionKey === 'take_cover' ? object.id : undefined,
            });
            hideStructureInteraction();
            showNotification(
                actionKey === 'take_cover' ? 'Укрытие занято' : 'Персонаж покинул укрытие',
                'success'
            );
            return true;
        } catch (error) {
            showNotification(
                error.message || (actionKey === 'take_cover'
                    ? 'Не удалось занять укрытие'
                    : 'Не удалось покинуть укрытие'),
                'system'
            );
            return false;
        }
    }

    if (actionKey === 'brace_weapon') {
        hideStructureInteraction();
        showBracePaymentMenu(actorCharacterId);
        return true;
    }

    if (actionKey === 'move') {
        pendingObjectMoveId = object.id;
        pendingStructureAction = null;
        structureMovePreviewObjectId = object.id;
        clearStructureMovePreview();
        const mesh = getLocationObjectMeshById(object.id);
        if (mesh) {
            structureMovePreviewGhost = createTransparentClone(mesh, 0.34);
            structureMovePreviewGhost.position.copy(mesh.position);
            structureMovePreviewGhost.rotation.copy(mesh.rotation);
            structureMovePreviewGhost.scale.copy(mesh.scale);
            scene.add(structureMovePreviewGhost);
        }
        const hint = ensureStructureMovePreviewHint();
        hint.textContent = 'Выберите новый тайл';
        hint.style.display = 'block';
        clearStructureActionMenu();
        clearStructureRotationMenu();
        showNotification('Выберите новый тайл для перестановки объекта', 'system');
        return true;
    }

    return false;
}

function showStructureActionMenu(clientX, clientY, object) {
    ensureStructureActionMenu();
    const entries = getStructureActions(object)
        .map((actionKey) => ({
            actionKey,
            label: getStructureActionLabel(object, actionKey),
            allowed: isStructureActionAllowed(object, actionKey),
        }))
        .filter((item) => item.allowed);

    if (!entries.length) {
        clearStructureActionMenu();
        return;
    }

    structureActionMenuState = {
        objectId: object.id,
        actions: entries,
    };

    const title = object.name || object.type || 'Объект';
    structureActionMenu.innerHTML = `
        <div style="
            padding: 10px 12px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.02em;
            opacity: 0.9;
        ">${title}</div>
    `;

    entries.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.innerHTML = `<span style="font-size:20px; line-height:1;">${getStructureActionIcon(item.actionKey)}</span>`;
        button.title = item.label;
        button.style.cssText = `
            display:flex;
            align-items:center;
            justify-content:center;
            width:52px;
            height:52px;
            padding: 0;
            border: 0;
            background: rgba(255,255,255,0.06);
            color: #fff;
            cursor: pointer;
            font-size: 18px;
            border-radius: 14px;
            margin: 8px;
        `;
        button.onmouseenter = () => {
            button.style.background = 'rgba(255,255,255,0.08)';
        };
        button.onmouseleave = () => {
            button.style.background = 'transparent';
        };
        button.onclick = async (event) => {
            event.stopPropagation();
            clearStructureActionMenu();
            await executeStructureAction(object, item.actionKey);
        };
        structureActionMenu.appendChild(button);
    });

    const rect = structureActionMenu.getBoundingClientRect();
    let anchorX = clientX;
    let anchorY = clientY;
    if (camera && object) {
        const anchor = new THREE.Vector3();
        const mesh = getLocationObjectMeshById(object.id);
        if (mesh) {
            mesh.getWorldPosition(anchor);
            anchor.y += 1.2;
            anchor.project(camera);
            if (anchor.z > -1 && anchor.z < 1) {
                anchorX = ((anchor.x + 1) / 2) * window.innerWidth;
                anchorY = ((1 - anchor.y) / 2) * window.innerHeight;
            }
        }
    }
    let left = anchorX + 18;
    let top = anchorY + 18;
    if (left + rect.width > window.innerWidth) left = anchorX - rect.width - 18;
    if (top + rect.height > window.innerHeight) top = anchorY - rect.height - 18;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    structureActionMenu.style.left = `${left}px`;
    structureActionMenu.style.top = `${top}px`;
    structureActionMenu.style.display = 'block';
}

function updateStructureMovePreview(clientX, clientY) {
    if (!pendingObjectMoveId) return;
    const mesh = getLocationObjectMeshById(pendingObjectMoveId);
    if (!mesh) return;
    if (!structureMovePreviewGhost) {
        structureMovePreviewGhost = createTransparentClone(mesh, 0.34);
        structureMovePreviewGhost.position.copy(mesh.position);
        structureMovePreviewGhost.rotation.copy(mesh.rotation);
        structureMovePreviewGhost.scale.copy(mesh.scale);
        scene.add(structureMovePreviewGhost);
    }
    const point = getPointerWorldPoint(clientX, clientY, mesh.position.y);
    if (!point) return;

    const targetX = Math.max(0, Math.min((currentLocationData?.grid_width || 1) - 1, Math.floor(point.x)));
    const targetY = Math.max(0, Math.min((currentLocationData?.grid_height || 1) - 1, Math.floor(point.z)));
    const object = mesh.userData.locationObject;
    const actor = getCurrentInteractionActor();
    const allowedDistance = getActionRequirement(object, 'move').max_distance ?? 1;
    const currentDistance = actor ? Math.max(Math.abs(actor.posX - targetX), Math.abs(actor.posY - targetY)) : Infinity;
    const isAllowed = currentDistance <= allowedDistance;
    const targetHeight = getTileHeight(targetX, targetY);

    structureMovePreviewGhost.position.set(targetX + 0.5, targetHeight, targetY + 0.5);
    structureMovePreviewGhost.visible = true;

    const hint = ensureStructureMovePreviewHint();
    hint.textContent = isAllowed ? `Тайл: ${targetX}, ${targetY}` : 'Слишком далеко';
    hint.style.left = `${clientX + 14}px`;
    hint.style.top = `${clientY + 14}px`;
    hint.style.display = 'block';
    hint.style.color = isAllowed ? '#d7ffe5' : '#ffd0d0';
}

async function commitStructureMovePreview(clientX, clientY) {
    if (!pendingObjectMoveId) return false;
    const mesh = getLocationObjectMeshById(pendingObjectMoveId);
    if (!mesh) return false;
    const point = getPointerWorldPoint(clientX, clientY, mesh.position.y);
    if (!point) return false;

    const targetX = Math.max(0, Math.min((currentLocationData?.grid_width || 1) - 1, Math.floor(point.x)));
    const targetY = Math.max(0, Math.min((currentLocationData?.grid_height || 1) - 1, Math.floor(point.z)));
    const object = mesh.userData.locationObject;
    const actor = getCurrentInteractionActor();
    const allowedDistance = getActionRequirement(object, 'move').max_distance ?? 1;
    const currentDistance = actor ? Math.max(Math.abs(actor.posX - targetX), Math.abs(actor.posY - targetY)) : Infinity;
    if (combatState?.status === 'active' && currentDistance > allowedDistance) {
        showNotification('Слишком далеко до тайла назначения', 'system');
        return false;
    }

    try {
        await updateInteractiveObject(object.id, { tile_x: targetX, tile_y: targetY });
        showNotification('Объект переставлен', 'success');
        return true;
    } finally {
        clearStructureMovePreview();
        pendingObjectMoveId = null;
    }
}

function getContainerItems(object) {
    const contents = object?.properties?.contents;
    return Array.isArray(contents) ? contents : [];
}

function getContainerItemLabel(item, index) {
    if (item && typeof item === 'object') {
        return item.name || item.title || item.label || item.type || `Предмет ${index + 1}`;
    }
    return String(item ?? `Предмет ${index + 1}`);
}

function cloneTransferItem(item) {
    if (item === null || item === undefined) return item;
    return JSON.parse(JSON.stringify(item));
}

function getPreferredLocationCharacterId(explicitCharacterId = null) {
    const direct = explicitCharacterId
        || pendingStructureAction?.actorCharacterId
        || (combatState?.status === 'active' ? combatState?.current_character?.character_id : null)
        || window.currentLocationCharacterId
        || null;
    if (direct && canControlCharacter(direct)) return direct;

    const controllable = Array.from(characterModels.keys()).find((characterId) => canControlCharacter(characterId));
    return controllable || direct || null;
}

function getControlledLocationCharacters() {
    return Array.from(characterModels.entries())
        .map(([characterId, entry]) => ({ characterId, ...entry }))
        .filter((entry) => canControlCharacter(entry.characterId))
        .sort((a, b) => {
            const preferred = String(getPreferredLocationCharacterId() || '');
            if (String(a.characterId) === preferred) return -1;
            if (String(b.characterId) === preferred) return 1;
            return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });
}

function getCharacterInventoryRoot(characterData) {
    const inventory = characterData?.inventory || {};
    if (!inventory.backpack) inventory.backpack = [];
    if (!Array.isArray(inventory.pockets)) inventory.pockets = [];
    characterData.inventory = inventory;
    return inventory;
}

function collectTransferEntries(items, rootPath, rootLabel, entries, depth = 0) {
    if (!Array.isArray(items)) return;
    items.forEach((item, index) => {
        const path = rootPath.concat(index);
        entries.push({
            item,
            path,
            depth,
            rootLabel,
        });
        if (item && typeof item === 'object' && Array.isArray(item.contents) && item.contents.length) {
            collectTransferEntries(item.contents, path.concat('contents'), rootLabel, entries, depth + 1);
        }
    });
}

function getCharacterTransferEntries(characterData) {
    const entries = [];
    const inventory = characterData?.inventory || {};
    collectTransferEntries(inventory.backpack || [], ['inventory', 'backpack'], 'Рюкзак', entries, 0);
    collectTransferEntries(inventory.pockets || [], ['inventory', 'pockets'], 'Карманы', entries, 0);

    const beltPouches = characterData?.equipment?.belt?.pouches || [];
    beltPouches.forEach((pouch, index) => {
        collectTransferEntries(pouch?.contents || [], ['equipment', 'belt', 'pouches', index, 'contents'], `Поясной подсумок ${index + 1}`, entries, 0);
    });

    const vestPouches = characterData?.equipment?.vest?.pouches || [];
    vestPouches.forEach((pouch, index) => {
        collectTransferEntries(pouch?.contents || [], ['equipment', 'vest', 'pouches', index, 'contents'], `Подсумок бронежилета ${index + 1}`, entries, 0);
    });

    return entries;
}

function getContainerTransferEntries(containerItems) {
    const entries = [];
    collectTransferEntries(containerItems || [], ['contents'], 'Контейнер', entries, 0);
    return entries;
}

function getItemByPathFromRoot(root, path) {
    if (!root || !Array.isArray(path) || path.length === 0) return null;
    let current = root;
    for (const key of path) {
        if (current === null || current === undefined) return null;
        if (Array.isArray(current) && typeof key === 'number') {
            current = current[key];
        } else if (typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return null;
        }
    }
    return current;
}

function getParentByPathFromRoot(root, path) {
    if (!root || !Array.isArray(path) || path.length === 0) return null;
    let current = root;
    for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i];
        if (current === null || current === undefined) return null;
        if (Array.isArray(current) && typeof key === 'number') {
            current = current[key];
        } else if (typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return null;
        }
    }
    return current;
}

function getTransferItemQuantity(item) {
    const quantity = Number(item?.quantity);
    if (Number.isFinite(quantity) && quantity > 0) return Math.floor(quantity);
    return 1;
}

function takeItemByPathFromRoot(root, path, amount = 1) {
    const source = getItemByPathFromRoot(root, path);
    if (!source) return null;
    const currentAmount = getTransferItemQuantity(source);
    const safeAmount = Math.max(1, Math.min(Math.floor(amount) || 1, currentAmount));
    if (safeAmount >= currentAmount) {
        const removed = removeItemByPathFromRoot(root, path);
        return removed ? clonePlainObject(removed) : null;
    }

    const itemClone = clonePlainObject(source);
    itemClone.quantity = safeAmount;

    const parent = getParentByPathFromRoot(root, path);
    const lastKey = path[path.length - 1];
    if (Array.isArray(parent) && typeof lastKey === 'number') {
        const item = parent[lastKey];
        if (item && typeof item === 'object') {
            item.quantity = currentAmount - safeAmount;
        }
    }
    return itemClone;
}
function removeItemByPathFromRoot(root, path) {
    if (!root || !Array.isArray(path) || path.length === 0) return null;
    let parent = root;
    for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i];
        if (Array.isArray(parent) && typeof key === 'number') {
            parent = parent[key];
        } else if (parent && typeof parent === 'object' && key in parent) {
            parent = parent[key];
        } else {
            return null;
        }
    }
    const lastKey = path[path.length - 1];
    if (Array.isArray(parent) && typeof lastKey === 'number') {
        const [removed] = parent.splice(lastKey, 1);
        return removed ?? null;
    }
    if (parent && typeof parent === 'object' && typeof lastKey === 'string' && Array.isArray(parent[lastKey])) {
        const removed = parent[lastKey].splice(0, 1);
        return removed[0] ?? null;
    }
    return null;
}

function buildTransferRow(entry, directionLabel, onTransfer) {
    const row = document.createElement('div');
    row.style.cssText = `
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:10px;
        padding: 8px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
    `;

    const info = document.createElement('div');
    info.style.flex = '1';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = getContainerItemLabel(entry.item, 0);
    const meta = document.createElement('div');
    meta.style.cssText = 'opacity:0.72; font-size:12px; line-height:1.35; margin-top:2px;';
    const itemType = typeof entry.item === 'object' ? (entry.item.category || entry.item.type || 'item') : 'item';
    const currentQuantity = getTransferItemQuantity(entry.item);
    const depthPrefix = entry.depth > 0 ? `${'  '.repeat(entry.depth)}↳ ` : '';
    meta.textContent = `${depthPrefix}${entry.rootLabel} · ${itemType}`;
    info.appendChild(title);
    info.appendChild(meta);
    if (false) {
        var countBadge = document.createElement('div');
    countBadge.style.cssText = 'display:inline-flex; align-items:center; margin-top:4px; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.08); font-size:12px; color:#fff; width:max-content;';
    countBadge.textContent = `x${currentQuantity}`;
    info.appendChild(countBadge);

    var qtyWrap = document.createElement('label');
    qtyWrap.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; color:rgba(255,255,255,0.75); margin-top:6px;';
    qtyWrap.textContent = 'Кол-во';
    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.max = String(currentQuantity);
    qtyInput.value = '1';
    qtyInput.style.cssText = `
        width: 70px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.04);
        color: #fff;
    `;
    qtyWrap.appendChild(qtyInput);
        info.appendChild(qtyWrap);
    }

    var countBadge = document.createElement('div');
    countBadge.style.cssText = 'display:inline-flex; align-items:center; margin-top:4px; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.08); font-size:12px; color:#fff; width:max-content;';
    countBadge.textContent = `x${currentQuantity}`;
    info.appendChild(countBadge);

    var qtyWrap = document.createElement('label');
    qtyWrap.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:12px; color:rgba(255,255,255,0.75); margin-top:6px;';
    qtyWrap.textContent = 'Кол-во';
    var qtyInput = document.createElement('input');
    qtyInput.type = 'number';
    qtyInput.min = '1';
    qtyInput.max = String(currentQuantity);
    qtyInput.value = '1';
    qtyInput.style.cssText = `
        width: 70px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.04);
        color: #fff;
    `;
    qtyWrap.appendChild(qtyInput);
    info.appendChild(qtyWrap);

    const transferBtn = document.createElement('button');
    transferBtn.type = 'button';
    transferBtn.textContent = directionLabel;
    transferBtn.title = 'Переместить';
    transferBtn.style.cssText = `
        width:34px;
        height:34px;
        border:0;
        border-radius:10px;
        background: rgba(255,255,255,0.08);
        color:#fff;
        cursor:pointer;
        font-size:18px;
        line-height:1;
        flex:0 0 auto;
    `;
    transferBtn.onclick = () => onTransfer(Math.max(1, Math.min(parseInt(qtyInput.value || '1', 10) || 1, currentQuantity)));

    row.appendChild(info);
    row.appendChild(transferBtn);
    return row;
}

function closeContainerInteractionMenuLegacy() {
    if (containerInteractionMenu) {
        containerInteractionMenu.style.display = 'none';
        containerInteractionState = null;
    }
}

function showContainerContentsMessage(object) {
    const items = getContainerItems(object);
    if (!items.length) {
        showNotification('Контейнер пуст', 'system');
        return;
    }
    const preview = items.slice(0, 5).map((item, index) => getContainerItemLabel(item, index)).join(', ');
    showNotification(items.length > 5 ? `Содержимое: ${preview}, ...` : `Содержимое: ${preview}`, 'system');
}

function showContainerInteractionMenuLegacy(object) {
    closeContainerInteractionMenuLegacy();
    if (!containerInteractionMenu) {
        containerInteractionMenu = document.createElement('div');
        containerInteractionMenu.style.cssText = `
            position: fixed;
            z-index: 1210;
            min-width: 260px;
            max-width: 340px;
            max-height: 420px;
            overflow: hidden;
            background: rgba(14, 18, 26, 0.98);
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 16px;
            box-shadow: 0 20px 42px rgba(0,0,0,0.45);
            color: #fff;
            backdrop-filter: blur(10px);
            font-family: 'Segoe UI', Arial, sans-serif;
        `;
        document.body.appendChild(containerInteractionMenu);
        const onClick = (event) => {
            if (containerInteractionMenu && !containerInteractionMenu.contains(event.target)) {
                closeContainerInteractionMenuLegacy();
            }
        };
        document.addEventListener('click', onClick);
        handlers.document.containerMenuClick = onClick;
    }

    const items = getContainerItems(object);
    containerInteractionState = { objectId: object.id, itemCount: items.length };
    containerInteractionMenu.innerHTML = `
        <div style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:10px;
            padding: 12px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        ">
            <div style="font-weight:700;">${object.name || object.type || 'Контейнер'}</div>
            <button type="button" class="container-close-btn" style="
                width:32px;
                height:32px;
                border-radius:999px;
                border:0;
                background: rgba(255,255,255,0.08);
                color:#fff;
                cursor:pointer;
                font-size:18px;
                line-height:1;
            ">×</button>
        </div>
        <div class="container-items" style="padding: 10px 12px; max-height: 350px; overflow:auto;"></div>
    `;

    const list = containerInteractionMenu.querySelector('.container-items');
    if (!items.length) {
        list.innerHTML = '<div style="opacity:0.75; padding: 8px 2px;">Пусто</div>';
    } else {
        items.forEach((item, index) => {
            const row = document.createElement('div');
            row.style.cssText = `
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:10px;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255,255,255,0.06);
            `;
            const info = document.createElement('div');
            info.style.flex = '1';
            const label = document.createElement('div');
            label.style.fontWeight = '600';
            label.textContent = getContainerItemLabel(item, index);
            const meta = document.createElement('div');
            meta.style.cssText = 'opacity:0.65; font-size:12px;';
            meta.textContent = typeof item === 'object' ? (item.category || item.type || 'item') : 'item';
            info.appendChild(label);
            info.appendChild(meta);

            const inspectBtn = document.createElement('button');
            inspectBtn.type = 'button';
            inspectBtn.textContent = '👁';
            inspectBtn.title = 'Осмотреть';
            inspectBtn.style.cssText = `
                width:34px;
                height:34px;
                border:0;
                border-radius:10px;
                background: rgba(255,255,255,0.08);
                color:#fff;
                cursor:pointer;
            `;
            inspectBtn.onclick = () => showNotification(getContainerItemLabel(item, index), 'system');

            row.appendChild(info);
            row.appendChild(inspectBtn);
            list.appendChild(row);
        });
    }

    const closeBtn = containerInteractionMenu.querySelector('.container-close-btn');
    if (closeBtn) closeBtn.onclick = () => closeContainerInteractionMenuLegacy();

    const rect = containerInteractionMenu.getBoundingClientRect();
    let left = window.innerWidth / 2 - rect.width / 2;
    let top = window.innerHeight / 2 - rect.height / 2;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    containerInteractionMenu.style.left = `${left}px`;
    containerInteractionMenu.style.top = `${top}px`;
    containerInteractionMenu.style.display = 'block';
}

function showObjectContextMenu(clientX, clientY, object) {
    if (combatState?.status === 'active' && !pendingStructureAction) {
        showNotification('В бою взаимодействие со структурами доступно через действие "Взаим."', 'system');
        return;
    }
    createContextMenu();
    contextMenu.innerHTML = '';
    const coverClass = object.properties?.cover_class || 'medium';
    const coverDefaults = COVER_CLASS_DEFAULTS[coverClass] || COVER_CLASS_DEFAULTS.medium;
    const coverHp = object.properties?.cover_hp ?? object.properties?.cover_max_hp ?? coverDefaults.maxHp;
    const coverProtection = object.properties?.cover_physical_protection ?? coverDefaults.protection;
    const actions = [{
        label: 'Осмотреть',
        action: () => showNotification(
            `${object.name || object.type}: ${coverDefaults.label}, ОЗ ${coverHp}/${object.properties?.cover_max_hp ?? coverDefaults.maxHp}, защита ${coverProtection}%`,
            'system'
        )
    }];
    if (window.isGM) {
        actions.push({
            label: `Класс укрытия: ${coverDefaults.label}`,
            action: async () => {
                const keys = Object.keys(COVER_CLASS_DEFAULTS);
                const promptText = keys
                    .map(key => `${key} — ${COVER_CLASS_DEFAULTS[key].label}`)
                    .join('\n');
                const selected = window.prompt(`Выберите класс укрытия:\n${promptText}`, coverClass);
                if (!selected || !COVER_CLASS_DEFAULTS[selected]) return;
                const profile = COVER_CLASS_DEFAULTS[selected];
                await updateInteractiveObject(object.id, {
                    properties: {
                        cover_class: selected,
                        cover_max_hp: profile.maxHp,
                        cover_hp: profile.maxHp,
                        cover_base_physical_protection: profile.protection,
                        cover_physical_protection: profile.protection,
                    }
                });
                showNotification(`Класс укрытия изменён: ${profile.label}`, 'success');
            }
        });
    }
    getObjectActions(object).forEach(action => {
        if (action === 'toggle_door') {
            const isOpen = Boolean(object.properties?.is_open);
            actions.push({
                label: isOpen ? 'Закрыть дверь' : 'Открыть дверь',
                action: () => updateInteractiveObject(object.id, { properties: { is_open: !isOpen } })
            });
        }
        if (action === 'open_container') {
            actions.push({
                label: (object?.type === 'ground_item' || object?.properties?.is_ground_item) ? 'Поднять' : 'Открыть содержимое',
                action: () => showContainerInteractionMenu(object)
            });
        }
        if (action === 'move') {
            actions.push({
                label: 'Передвинуть',
                action: () => {
                    pendingObjectMoveId = object.id;
                    showNotification('Выберите тайл для перемещения объекта', 'system');
                }
            });
        }
        if (action === 'rotate') {
            actions.push({
                label: 'Повернуть',
                action: () => updateInteractiveObject(object.id, {
                    properties: { rotation: Number(object.properties?.rotation || 0) - (Math.PI / 2) }
                })
            });
        }
        if (action === 'climb') {
            actions.push({
                label: 'Перелезть',
                action: () => {
                    const actorCharacterId = pendingStructureAction?.actorCharacterId
                        || combatState?.current_character?.character_id
                        || window.currentLocationCharacterId
                        || null;
                    if (!actorCharacterId) {
                        showNotification('Не удалось определить персонажа');
                        return;
                    }
                    performClimbAction(object, actorCharacterId);
                }
            });
        }
    });
    actions.forEach(item => {
        const button = document.createElement('button');
        button.textContent = item.label;
        button.style.cssText = 'display:block; width:100%; padding:8px 14px; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer;';
        button.onclick = (event) => {
            event.stopPropagation();
            contextMenu.style.display = 'none';
            item.action();
        };
        contextMenu.appendChild(button);
    });
    contextMenu.style.display = 'block';
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.min(clientX, window.innerWidth - rect.width - 10)}px`;
    contextMenu.style.top = `${Math.min(clientY, window.innerHeight - rect.height - 10)}px`;
}

function disposeLocationObject(mesh) {
    mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    });
}

function getStructureDimensions(preset = structurePreset) {
    if (preset === 'floor') return { width: structureWidth, depth: structureWidth, height: 0.12 };
    if (preset === 'door') return { width: 0.9, depth: 0.18, height: Math.max(1.8, structureHeight) };
    if (preset === 'table') return { width: structureWidth, depth: structureDepth, height: Math.max(0.6, structureHeight) };
    if (preset === 'chair') return { width: structureWidth, depth: structureDepth, height: structureHeight };
    if (preset === 'shelf') return { width: structureWidth, depth: Math.max(0.3, structureDepth), height: structureHeight };
    return { width: structureWidth, depth: Math.max(0.1, structureDepth), height: structureHeight };
}

function createLocationObjectMesh(obj) {
    const properties = obj.properties || {};
    const dimensions = properties.dimensions || getStructureDimensions(obj.type);
    const width = dimensions.width || 1;
    const depth = dimensions.depth || 1;
    const height = dimensions.height || 1;
    const material = new THREE.MeshStandardMaterial({ color: properties.color || '#aa8866' });
    const group = new THREE.Group();
    let main;

    if (obj.type === 'ground_item' || properties.is_ground_item) {
        const itemColor = properties.color || '#c9b27a';
        const itemMaterial = new THREE.MeshStandardMaterial({
            color: itemColor,
            roughness: 0.9,
            metalness: 0.02,
        });
        main = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.42), itemMaterial);
        main.position.y = 0.06;
        group.add(main);
        const accent = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.12, 0.18),
            new THREE.MeshStandardMaterial({ color: 0xf4e4b5, roughness: 1, metalness: 0 })
        );
        accent.position.set(0, 0.11, 0);
        group.add(accent);
    } else if (obj.type === 'chair') {
        main = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, depth), material);
        main.position.y = 0.48;
        group.add(main);
        const legGeometry = new THREE.BoxGeometry(0.08, 0.48, 0.08);
        [-0.2, 0.2].forEach(x => [-0.2, 0.2].forEach(z => {
            const leg = new THREE.Mesh(legGeometry, material);
            leg.position.set(x, 0.24, z);
            group.add(leg);
        }));
        const back = new THREE.Mesh(new THREE.BoxGeometry(width, 0.55, 0.1), material);
        back.position.set(0, 0.78, -0.22);
        group.add(back);
    } else if (obj.type === 'table') {
        main = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, depth), material);
        main.position.y = height - 0.06;
        group.add(main);
        const legGeometry = new THREE.BoxGeometry(0.12, height - 0.12, 0.12);
        [-1, 1].forEach(x => [-1, 1].forEach(z => {
            const leg = new THREE.Mesh(legGeometry, material);
            leg.position.set(x * (width / 2 - 0.12), (height - 0.12) / 2, z * (depth / 2 - 0.12));
            group.add(leg);
        }));
    } else {
        main = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        main.position.y = height / 2;
        group.add(main);
    }

    const objectPosition = getObjectGridPosition(obj);
    const tileX = objectPosition.x ?? 0;
    const tileY = objectPosition.y ?? 0;
    group.position.set(tileX + 0.5, getTileHeight(tileX, tileY), tileY + 0.5);
    if (obj.type === 'ground_item' || properties.is_ground_item) {
        group.position.y += 0.04;
    }
    group.rotation.y = (properties.rotation || 0) + (properties.is_open ? Math.PI / 2 : 0);
    group.userData = { locationObjectId: obj.id, locationObject: obj };
    return group;
}

function addLocationObjectMesh(obj) {
    if (locationObjectMeshes.some(mesh => mesh.userData.locationObjectId === obj.id)) return;
    const mesh = createLocationObjectMesh(obj);
    scene.add(mesh);
    locationObjectMeshes.push(mesh);
}

function removeLocationObjectMesh(objectId) {
    const mesh = locationObjectMeshes.find(item => item.userData.locationObjectId === objectId);
    if (!mesh) return;
    scene.remove(mesh);
    disposeLocationObject(mesh);
    locationObjectMeshes = locationObjectMeshes.filter(item => item !== mesh);
}

function replaceLocationObjectMesh(object) {
    removeLocationObjectMesh(object.id);
    addLocationObjectMesh(object);
}

function updateLocationObjectHeight(tileX, tileZ) {
    const height = getTileHeight(tileX, tileZ);
    locationObjectMeshes.forEach(mesh => {
        const object = mesh.userData.locationObject;
        if (!object) return;
        const position = getObjectGridPosition(object);
        if (position.x === tileX && position.y === tileZ) mesh.position.y = height;
    });
}

function clearBuildPreview() {
    if (!buildPreviewMesh) return;
    scene?.remove(buildPreviewMesh);
    disposeLocationObject(buildPreviewMesh);
    buildPreviewMesh = null;
}

function updateBuildPreview() {
    clearBuildPreview();
    if (!window.locationEditMode || buildMode !== 'structure' || !hoveredTileCoords || !scene) return;
    const { x, z } = hoveredTileCoords;
    const dimensions = getStructureDimensions();
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(dimensions.width, dimensions.height, dimensions.depth),
        new THREE.MeshBasicMaterial({ color: structureColor, transparent: true, opacity: 0.35, depthWrite: false })
    );
    mesh.position.set(x + 0.5, getTileHeight(x, z) + dimensions.height / 2, z + 0.5);
    mesh.rotation.y = structureRotation;
    buildPreviewMesh = mesh;
    scene.add(mesh);
}

async function placeStructureAtTile(x, z) {
    if (!window.currentLobbyId || !currentLocationId) return;
    const dimensions = getStructureDimensions();
    const selectedCoverClass = document.getElementById('loc-structure-cover-class')?.value || 'medium';
    const coverProfile = COVER_CLASS_DEFAULTS[selectedCoverClass] || COVER_CLASS_DEFAULTS.medium;
    try {
        const object = await Server.createLocationObject(window.currentLobbyId, currentLocationId, {
            name: structurePreset,
            type: structurePreset,
            tile_x: x,
            tile_y: z,
            properties: {
                dimensions,
                color: structureColor,
                rotation: structureRotation,
                cover_class: selectedCoverClass,
                cover_max_hp: coverProfile.maxHp,
                cover_hp: coverProfile.maxHp,
                cover_base_physical_protection: coverProfile.protection,
                cover_physical_protection: coverProfile.protection,
                interactions: objectInteractions[structurePreset] || [],
                interaction_requirements: (objectInteractions[structurePreset] || []).reduce((rules, action) => {
                    rules[action] = interactionRequirements[action];
                    return rules;
                }, {}),
                contents: ['shelf', 'chest'].includes(structurePreset) ? [] : undefined,
                is_open: false
            }
        });
        currentLocationData.objects = currentLocationData.objects || [];
        if (!currentLocationData.objects.some(item => item.id === object.id)) currentLocationData.objects.push(object);
        addLocationObjectMesh(object);
    } catch (error) {
        showNotification(error.message || 'Не удалось построить объект');
    }
}

async function removeStructuresAtTile(x, z) {
    if (!window.currentLobbyId) return;
    const meshes = locationObjectMeshes.filter(item => {
        const object = item.userData.locationObject;
        if (!object) return false;
        const position = getObjectGridPosition(object);
        return position.x === x && position.y === z;
    });
    const objectIds = meshes
        .map(mesh => mesh.userData.locationObjectId)
        .filter(id => !structureDeletionInFlight.has(id));
    if (!objectIds.length) return;

    objectIds.forEach(id => structureDeletionInFlight.add(id));
    const results = await Promise.allSettled(
        objectIds.map(id => Server.deleteLocationObject(window.currentLobbyId, id))
    );
    results.forEach((result, index) => {
        const objectId = objectIds[index];
        structureDeletionInFlight.delete(objectId);
        if (result.status === 'fulfilled') {
            removeLocationObjectMesh(objectId);
            currentLocationData.objects = currentLocationData.objects.filter(object => object.id !== objectId);
        } else {
            showNotification(result.reason?.message || 'Не удалось удалить объект');
        }
    });
}

export function setLocationBuildMode(mode) { buildMode = mode; updateBuildPreview(); }
export function setLocationStructurePreset(value) { structurePreset = value; updateBuildPreview(); }
export function setLocationStructureWidth(value) { structureWidth = Math.max(0.2, Number(value)); updateBuildPreview(); }
export function setLocationStructureDepth(value) { structureDepth = Math.max(0.1, Number(value)); updateBuildPreview(); }
export function setLocationStructureHeight(value) { structureHeight = Math.max(0.1, Number(value)); updateBuildPreview(); }
export function setLocationStructureColor(value) { structureColor = value; updateBuildPreview(); }
export function setLocationStructureRotation(value) { structureRotation = Number(value); updateBuildPreview(); }

export function addLocationObject(object) {
    if (!currentLocationData) return;
    currentLocationData.objects = currentLocationData.objects || [];
    if (!currentLocationData.objects.some(item => item.id === object.id)) currentLocationData.objects.push(object);
    addLocationObjectMesh(object);
    invalidateMovementMapCache();
}

window.addLocationObject = addLocationObject;

export function removeLocationObject(objectId) {
    if (!currentLocationData) return;
    removeLocationObjectMesh(objectId);
    currentLocationData.objects = (currentLocationData.objects || []).filter(object => object.id !== objectId);
    invalidateMovementMapCache();
}

window.removeLocationObject = removeLocationObject;

export function updateLocationObject(object) {
    if (!currentLocationData) return;
    currentLocationData.objects = currentLocationData.objects || [];
    const index = currentLocationData.objects.findIndex(item => item.id === object.id);
    if (index === -1) currentLocationData.objects.push(object);
    else currentLocationData.objects[index] = object;
    replaceLocationObjectMesh(object);
    invalidateMovementMapCache();
}

window.updateLocationObject = updateLocationObject;

// ========== Загрузка данных локации ==========
export function loadLocation(data) {
    console.log('loadLocation', data);
    tileCubes = [];
    objectMeshes = [];
    anomalyEffectMeshes = [];
    locationObjectMeshes = [];
    currentLocationData = data;
    invalidateMovementMapCache();
    if (!scene) return;

    // Очистка старых объектов (кроме света и highlight)
    const toRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight && child !== highlightBox) toRemove.push(child);
    });
    toRemove.forEach(child => {
        disposeObject(child);
        scene.remove(child);
    });
    clearAllCharacters();

    const gridWidth = data.grid_width;
    const gridHeight = data.grid_height;
    const centerX = gridWidth / 2;
    const centerZ = gridHeight / 2;

    // Сетка
    const gridHelper = new THREE.GridHelper(gridWidth, gridHeight, 0x888888, 0x444444);
    gridHelper.position.set(centerX, -0.1, centerZ);
    scene.add(gridHelper);

    // Пол
    const planeMat = new THREE.MeshStandardMaterial({ color: 0x3a6b3a, side: THREE.DoubleSide, transparent: true, opacity: 0.2 });
    const planeGeo = new THREE.PlaneGeometry(gridWidth, gridHeight);
    const groundPlane = new THREE.Mesh(planeGeo, planeMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.set(centerX, -0.05, centerZ);
    scene.add(groundPlane);
    groundPlaneMesh = groundPlane;

    // Тайлы
    const tileCount = gridWidth * gridHeight;
    const geometry = new THREE.BoxGeometry(0.98, 1, 0.98);
    const material = new THREE.MeshStandardMaterial();
    locationTileMesh = new THREE.InstancedMesh(geometry, material, tileCount);
    locationTileMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(tileCount * 3), 3);
    locationTileMesh.castShadow = false;
    locationTileMesh.receiveShadow = false;
    locationTileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    locationTileMesh.userData.tileByInstance = [];
    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            const tile = data.tiles_data[y][x];
            updateTileInstance(y * gridWidth + x, x, y, tile, locationTileMesh);
        }
    }
    locationTileMesh.instanceMatrix.needsUpdate = true;
    locationTileMesh.instanceColor.needsUpdate = true;
    tileCubes = [locationTileMesh];
    scene.add(locationTileMesh);

    // Объекты на тайлах
    for (let y = 0; y < data.tiles_data.length; y++) {
        for (let x = 0; x < data.tiles_data[y].length; x++) {
            rebuildTileObjects(x, y);
        }
    }

    // Отдельные объекты
    if (data.objects && data.objects.length) {
        data.objects.forEach(addLocationObjectMesh);
    }

    // Камера
    const distance = Math.max(gridWidth, gridHeight) * 0.8;
    camera.position.set(centerX, distance * 0.6, centerZ + distance);
    controls.target.set(centerX, 0, centerZ);
    controls.update();

    if (highlightBox && !scene.children.includes(highlightBox)) scene.add(highlightBox);
}

// ========== Обновление тайлов ==========
function updateTileCube(x, z, tile) {
    if (!locationTileMesh || !currentLocationData) return;
    updateTileInstance(z * currentLocationData.grid_width + x, x, z, tile, locationTileMesh);
    locationTileMesh.instanceMatrix.needsUpdate = true;
    locationTileMesh.instanceColor.needsUpdate = true;
}

function updateTileInstance(instanceId, x, z, tile, mesh) {
    const height = tile.height || 1.0;
    tileInstanceTransform.position.set(x + 0.5, height / 2, z + 0.5);
    tileInstanceTransform.scale.set(1, height, 1);
    tileInstanceTransform.updateMatrix();
    mesh.setMatrixAt(instanceId, tileInstanceTransform.matrix);
    mesh.setColorAt(instanceId, new THREE.Color(terrainColors[tile.terrain] || 0x3a5f0b));
    mesh.userData.tileByInstance[instanceId] = { x, z };
}

function rebuildTileObjects(tileX, tileZ) {
    if (!currentLocationData) return;
    const tile = currentLocationData.tiles_data[tileZ][tileX];
    const tileHeight = tile.height || 1.0;
    const worldX = tileX + 0.5;
    const worldZ = tileZ + 0.5;

    const toRemove = [];
    for (let i = 0; i < objectMeshes.length; i++) {
        const mesh = objectMeshes[i];
        if (mesh.userData && mesh.userData.tileX === tileX && mesh.userData.tileZ === tileZ) {
            scene.remove(mesh);
            toRemove.push(mesh);
        }
    }
    objectMeshes = objectMeshes.filter(m => !toRemove.includes(m));
    anomalyEffectMeshes = anomalyEffectMeshes.filter(m => !toRemove.includes(m));

    const objects = tile.objects || [];
    for (const obj of objects) {
        let geometry, material, yOffset, mesh;
        let isAnomalyEffect = false;
        switch (obj.type) {
            case 'tree':
                break;
            case 'rock':
                geometry = new THREE.DodecahedronGeometry(0.3);
                material = new THREE.MeshStandardMaterial({ color: 0x888888 });
                yOffset = 0.15;
                break;
            case 'house':
                geometry = new THREE.BoxGeometry(0.7, 0.7, 0.7);
                material = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
                yOffset = 0.35;
                break;
            case 'tent':
                geometry = new THREE.CylinderGeometry(0.5, 0.7, 0.5, 4);
                material = new THREE.MeshStandardMaterial({ color: 0xd2b48c });
                yOffset = 0.25;
                break;
            case 'campfire':
                geometry = new THREE.CylinderGeometry(0.2, 0.3, 0.1, 6);
                material = new THREE.MeshStandardMaterial({ color: 0xff6600 });
                yOffset = 0.05;
                break;
            case 'anomaly':
                mesh = createAnomalyEffect(obj.anomalyType || 'electric', obj.color || '#00ffff', obj.scale || 1);
                yOffset = 0;
                isAnomalyEffect = true;
                break;
            default:
                geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                material = new THREE.MeshStandardMaterial({ color: 0xffaa44 });
                yOffset = 0.25;
        }
        if (obj.type === 'anomaly') {
            // The shared effect owns its scale and animation state.
        } else if (obj.type === 'tree') {
            mesh = new THREE.Group();
            const trunk = new THREE.Mesh(
                new THREE.CylinderGeometry(0.1, 0.14, 0.75, 8),
                new THREE.MeshStandardMaterial({ color: 0x5b3a20 })
            );
            trunk.position.y = 0.375;
            mesh.add(trunk);
            [
                { radius: 0.46, height: 0.72, y: 0.82, color: 0x255b2f },
                { radius: 0.36, height: 0.66, y: 1.14, color: 0x2f7439 },
                { radius: 0.25, height: 0.55, y: 1.44, color: 0x3a8745 }
            ].forEach(layer => {
                const foliage = new THREE.Mesh(
                    new THREE.ConeGeometry(layer.radius, layer.height, 8),
                    new THREE.MeshStandardMaterial({ color: obj.color || layer.color })
                );
                foliage.position.y = layer.y;
                mesh.add(foliage);
            });
            yOffset = 0;
        } else {
            mesh = new THREE.Mesh(geometry, material);
        }
        mesh.userData = { ...mesh.userData, tileX, tileZ, objType: obj.type };
        mesh.position.set(worldX, tileHeight + yOffset, worldZ);
        mesh.rotation.y = obj.rotation || 0;
        if (!isAnomalyEffect) mesh.scale.setScalar(obj.scale || 1);
        scene.add(mesh);
        objectMeshes.push(mesh);
        if (isAnomalyEffect) anomalyEffectMeshes.push(mesh);
    }
}

// ========== Обновления из сокета ==========
export function applyLocationTilesUpdate(locationId, updates) {
    if (getCurrentLocationId() !== locationId) return;
    if (!currentLocationData) return;
    for (const upd of updates) {
        const tile = currentLocationData.tiles_data[upd.z][upd.x];
        if (upd.terrain !== undefined) tile.terrain = upd.terrain;
        if (upd.height !== undefined) tile.height = upd.height;
        if (upd.objects !== undefined) tile.objects = upd.objects;
        if (upd.radiation !== undefined) tile.radiation = upd.radiation;
        updateTileCube(upd.x, upd.z, tile);
        rebuildTileObjects(upd.x, upd.z);
        updateLocationObjectHeight(upd.x, upd.z);
    }
    invalidateMovementMapCache();
    characterModels.forEach((entry) => {
        const height = getTileHeight(entry.posX, entry.posY);
        entry.model.position.y = height;
        entry.label.position.y = height + 1.2;
    });
}

// ========== Кисть ==========
export function applyLocationBrush(centerX, centerZ, updates, radius) {
    if (!currentLocationData) return;
    const tiles = currentLocationData.tiles_data;
    const changed = [];
    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const x = centerX + dx;
            const z = centerZ + dz;
            if (x < 0 || x >= currentLocationData.grid_width || z < 0 || z >= currentLocationData.grid_height) continue;
            const tile = tiles[z][x];
            let needUpdate = false;
            if (updates.terrain !== undefined && tile.terrain !== updates.terrain) {
                tile.terrain = updates.terrain;
                needUpdate = true;
            }
            if (updates.height !== undefined && tile.height !== updates.height) {
                tile.height = Math.min(3.0, Math.max(0.5, updates.height));
                needUpdate = true;
            }
            if (updates.radiation !== undefined && tile.radiation !== updates.radiation) {
                tile.radiation = Math.min(10, Math.max(0, updates.radiation));
                needUpdate = true;
            }
            if (updates.addObject && brushObjectMode) {
                const key = `${x},${z}`;
                if (!processedTilesForObjects.has(key)) {
                    processedTilesForObjects.add(key);
                    if (!tile.objects) tile.objects = [];
                    const newObj = {
                        type: brushObjectType,
                        x: brushObjectOffsetX,
                        z: brushObjectOffsetZ,
                        scale: brushObjectScale,
                        rotation: brushObjectRotation,
                        color: brushObjectColor
                    };
                    if (brushObjectType.startsWith('anomaly_')) {
                        newObj.type = 'anomaly';
                        newObj.anomalyType = brushObjectType.replace('anomaly_', '');
                    }
                    tile.objects.push(newObj);
                    needUpdate = true;
                }
            }
            if (updates.objects !== undefined && updates.objects.length === 0 && !brushObjectMode) {
                tile.objects = [];
                needUpdate = true;
            }
            if (needUpdate) {
                updateTileCube(x, z, tile);
                if (updates.height !== undefined) updateLocationObjectHeight(x, z);
                if (updates.objects !== undefined || updates.addObject) {
                    rebuildTileObjects(x, z);
                }
                changed.push({ x, z, terrain: tile.terrain, height: tile.height, objects: tile.objects, radiation: tile.radiation });
            }
        }
    }
    if (changed.length === 0) return;
    if (window.socket && window.currentLocationId) {
        window.socket.emit('update_location_tiles', {
            token: localStorage.getItem('access_token'),
            location_id: window.currentLocationId,
            updates: changed.map(c => ({ x: c.x, z: c.z, terrain: c.terrain, height: c.height, objects: c.objects, radiation: c.radiation }))
        });
    }
    characterModels.forEach((entry) => {
        const height = getTileHeight(entry.posX, entry.posY);
        entry.model.position.y = height;
        entry.label.position.y = height + 1.2;
    });
}

// ========== Перетаскивание персонажей (3D) ==========
function setupCharacterDragging() {
    if (!renderer) return;
    const canvas = renderer.domElement;

    function getCharacterAtScreen(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const models = [];
        characterModels.forEach((entry) => {
            models.push(entry.model);
        });
        const intersects = raycaster.intersectObjects(models, true);
        if (intersects.length > 0) {
            let obj = intersects[0].object;
            while (obj) {
                if (obj.userData && obj.userData.isCharacter) {
                    return obj;
                }
                obj = obj.parent;
            }
            return intersects[0].object;
        }
        return null;
    }

    // mousemove для подсветки
    const onMouseMove = (e) => {
        if (!isDraggingCharacter) {
            const obj = getCharacterAtScreen(e.clientX, e.clientY);
            if (obj) {
                const charId = obj.userData.characterId;
                if (charId && hoveredCharacterId !== charId) {
                    hoveredCharacterId = charId;
                    canvas.style.cursor = 'grab';
                    const entry = characterModels.get(charId);
                    if (entry) {
                        entry.model.children.forEach(child => {
                            if (child.isMesh) {
                                child.material.emissive = new THREE.Color(0x444466);
                                child.material.emissiveIntensity = 0.3;
                            }
                        });
                    }
                }
            } else if (hoveredCharacterId !== null) {
                const entry = characterModels.get(hoveredCharacterId);
                if (entry) {
                    entry.model.children.forEach(child => {
                        if (child.isMesh) {
                            child.material.emissive = new THREE.Color(0x000000);
                            child.material.emissiveIntensity = 0;
                        }
                    });
                }
                hoveredCharacterId = null;
                canvas.style.cursor = 'default';
            }
        }

        if (armedMoveCharacterId && !isDraggingCharacter) {
            updateMovementPreview(e.clientX, e.clientY);
        }
        if (pendingCombatAction) {
            updateAttackPreview(e.clientX, e.clientY);
        }
        if (pendingObjectMoveId) {
            updateStructureMovePreview(e.clientX, e.clientY);
        }
        if (pendingStructureAction && !pendingObjectMoveId) {
            const targetCharacterObject = getCharacterAtScreen(e.clientX, e.clientY);
            const targetCharacterId = targetCharacterObject?.userData?.characterId;
            if (
                targetCharacterId
                && canInteractWithIncapacitatedCharacter(
                    pendingStructureAction.actorCharacterId,
                    targetCharacterId
                )
            ) {
                hoveredStructureObjectId = null;
                canvas.style.cursor = 'pointer';
                const interactionKey = `character:${targetCharacterId}`;
                if (structureActionMenuState?.objectId !== interactionKey) {
                    showCharacterInteractionMenu(e.clientX, e.clientY, targetCharacterId);
                }
                return;
            }
            const structureObj = getLocationObjectAtScreen(e.clientX, e.clientY);
            const structure = structureObj?.userData?.locationObject || null;
            if (structure) {
                if (structureHoverLastObjectId !== structure.id) {
                    structureHoverLastObjectId = structure.id;
                }
                const entries = getStructureActions(structure)
                    .filter((actionKey) => isStructureActionAllowed(structure, actionKey, pendingStructureAction.actorCharacterId));
                if (entries.length > 0) {
                    hoveredStructureObjectId = structure.id;
                    canvas.style.cursor = 'pointer';
                    if (structureActionMenuState?.objectId !== structure.id) {
                        showStructureActionMenu(e.clientX, e.clientY, structure);
                    }
                } else {
                    hoveredStructureObjectId = null;
                    clearStructureActionMenu();
                }
            } else {
                hoveredStructureObjectId = null;
                structureHoverLastObjectId = null;
                clearStructureActionMenu();
            }
        }
    };
    canvas.addEventListener('mousemove', onMouseMove);
    handlers.canvas.mousemove = onMouseMove;

    // pointerdown - начало перетаскивания
    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        if (window.locationEditMode) return;
        if (isDraggingCharacter) return;
        if (armedMoveCharacterId) {
            e.preventDefault();
            e.stopPropagation();
            commitMovementPreview(e.clientX, e.clientY);
            return;
        }
        if (pendingCombatAction?.targetType === 'point') {
            e.preventDefault();
            e.stopPropagation();
            resolveCombatPointSelection(e.clientX, e.clientY);
            return;
        }
        if (pendingCombatAction?.targetType === 'structure') {
            e.preventDefault();
            e.stopPropagation();
            resolveCombatStructureSelection(e.clientX, e.clientY);
            return;
        }
        if (pendingCombatAction?.targetType === 'multi_character' && !pendingCombatAction.areaAnchor) {
            e.preventDefault();
            e.stopPropagation();
            selectAreaFireAnchor(e.clientX, e.clientY);
            return;
        }
        const obj = getCharacterAtScreen(e.clientX, e.clientY);
        if (!obj) return;
        const charId = obj.userData.characterId;
        if (!charId) return;
        const entry = characterModels.get(charId);
        if (!entry) return;
        if (
            combatState?.status === 'active'
            && findCombatCharacterByCharacterId(charId)?.grappled_by_id
        ) {
            showNotification('Схваченный персонаж не может двигаться самостоятельно', 'system');
            return;
        }
        if (pendingCombatAction) {
            e.preventDefault();
            e.stopPropagation();
            resolveCombatTargetSelection(charId);
            return;
        }
        if (pendingStructureAction) {
            e.preventDefault();
            e.stopPropagation();
            if (canInteractWithIncapacitatedCharacter(pendingStructureAction.actorCharacterId, charId)) {
                showCharacterInteractionMenu(e.clientX, e.clientY, charId);
            } else {
                showNotification('Взаимодействовать можно с соседним недееспособным персонажем', 'system');
            }
            return;
        }
        if (combatState?.status === 'active' && !isCurrentCombatTurnForCharacter(charId)) {
            showNotification('Сейчас нельзя перетаскивать персонажей в бою', 'system');
            return;
        }
        const currentUserId = getCurrentUserId();
        const canControl = (entry.controlledBy === currentUserId) || window.isGM;
        if (!canControl) {
            showNotification('Вы не можете перемещать этого персонажа');
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const planeY = entry.model.position.y;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        const intersectPoint = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, intersectPoint)) return;

        dragCharacter = {
            characterId: charId,
            model: entry.model,
            offsetX: entry.model.position.x - intersectPoint.x,
            offsetZ: entry.model.position.z - intersectPoint.z,
            startX: entry.posX,
            startZ: entry.posY
        };
        isDraggingCharacter = true;
        controls.enabled = false;
        canvas.style.cursor = 'grabbing';
        armedMoveCharacterId = null;

        if (hoveredCharacterId !== null) {
            const oldEntry = characterModels.get(hoveredCharacterId);
            if (oldEntry) {
                oldEntry.model.children.forEach(child => {
                    if (child.isMesh) {
                        child.material.emissive = new THREE.Color(0x000000);
                        child.material.emissiveIntensity = 0;
                    }
                });
            }
            hoveredCharacterId = null;
        }
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    handlers.canvas.charPointerDown = onPointerDown;

    // pointermove - перемещение
    const onPointerMove = (e) => {
        if (!isDraggingCharacter || !dragCharacter) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const planeY = dragCharacter.model.position.y;
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
        const intersectPoint = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, intersectPoint)) return;
        let newX = intersectPoint.x + dragCharacter.offsetX;
        let newZ = intersectPoint.z + dragCharacter.offsetZ;
        newX = Math.max(0.5, Math.min(currentLocationData.grid_width - 0.5, newX));
        newZ = Math.max(0.5, Math.min(currentLocationData.grid_height - 0.5, newZ));
        const tileX = Math.floor(newX);
        const tileZ = Math.floor(newZ);
        const height = getTileHeight(tileX, tileZ);
        dragCharacter.model.position.set(newX, height, newZ);
        const entry = characterModels.get(dragCharacter.characterId);
        if (entry) {
            entry.label.position.set(newX, height + 1.2, newZ);
            entry.posX = tileX;
            entry.posY = tileZ;
        }
        if (armedMoveCharacterId && dragCharacter.characterId === armedMoveCharacterId) {
            updateMovementPreview(e.clientX, e.clientY);
        }
    };
    canvas.addEventListener('pointermove', onPointerMove);
    handlers.canvas.charPointerMove = onPointerMove;

    // pointerup / pointercancel - завершение
    const endDrag = (e) => {
        if (!isDraggingCharacter || !dragCharacter) {
            controls.enabled = true;
            return;
        }
        e.preventDefault();
        const entry = characterModels.get(dragCharacter.characterId);
        if (entry) {
            const newX = Math.floor(entry.posX);
            const newY = Math.floor(entry.posY);
            const movementCost = Math.max(Math.abs(newX - dragCharacter.startX), Math.abs(newY - dragCharacter.startZ));
            const activeCombatCharacter = combatState?.current_character || null;
            const isCombatActive = combatState?.status === 'active';
            const isCurrentTurn = Boolean(
                !isCombatActive ||
                activeCombatCharacter?.character_id === dragCharacter.characterId
            );
            const availableMovement = activeCombatCharacter?.movement_points_current ?? 0;
            if (isCombatActive && !isCurrentTurn) {
                updateCharacterPosition(dragCharacter.characterId, dragCharacter.startX, dragCharacter.startZ);
                showNotification('Сейчас не ход этого персонажа', 'system');
            } else if (isCombatActive && movementCost > availableMovement) {
                updateCharacterPosition(dragCharacter.characterId, dragCharacter.startX, dragCharacter.startZ);
                showNotification('Недостаточно ОП для этого перемещения', 'system');
            } else if (window.socket && window.currentLocationId) {
                window.socket.emit('move_in_location', {
                    token: localStorage.getItem('access_token'),
                    location_id: window.currentLocationId,
                    character_id: dragCharacter.characterId,
                    x: newX,
                    y: newY
                });
            }
        }
        dragCharacter = null;
        isDraggingCharacter = false;
        armedMoveCharacterId = null;
        clearMovementPreview();
        controls.enabled = true;
        canvas.style.cursor = 'default';
    };
    const onPointerUp = (e) => { endDrag(e); };
    const onPointerCancel = (e) => { endDrag(e); };
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    handlers.canvas.charPointerUp = onPointerUp;
    handlers.canvas.charPointerCancel = onPointerCancel;

    // contextmenu
    const onContextMenu = (e) => {
        e.preventDefault();
        if (window.locationEditMode) return;
        if (pendingCombatAction) {
            showNotification('Выберите цель левой кнопкой мыши или нажмите Esc для отмены', 'system');
            return;
        }
        const obj = getCharacterAtScreen(e.clientX, e.clientY);
        if (obj) {
            const charId = obj.userData.characterId;
            if (charId) {
                showCombatActionMenu(e.clientX, e.clientY, charId);
            }
            return;
        }
        const locationObject = getLocationObjectAtScreen(e.clientX, e.clientY);
        if (!locationObject) return;
        if (combatState?.status === 'active') {
            if (pendingStructureAction) {
                showStructureActionMenu(e.clientX, e.clientY, locationObject.userData.locationObject);
            } else {
                showNotification('Сначала выбери "Взаим." в меню персонажа', 'system');
            }
            return;
        }
        showObjectContextMenu(e.clientX, e.clientY, locationObject.userData.locationObject);
    };
    canvas.addEventListener('contextmenu', onContextMenu);
    handlers.canvas.contextmenu = onContextMenu;

    const onKeyDown = (e) => {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) && !isKeyboardInputTarget(e.target)) {
            locationCameraKeys.add(e.code);
            e.preventDefault();
        }
        if (
            e.key === 'Enter'
            && ['multi_character', 'multi_melee'].includes(pendingCombatAction?.targetType)
        ) {
            e.preventDefault();
            finalizeAreaFire();
            return;
        }
        if (e.key !== 'Escape') return;
        if (movementTypeMenu && movementTypeMenu.style.display !== 'none') {
            e.preventDefault();
            closeMovementTypeMenu();
        }
        if (postureMenu && postureMenu.style.display !== 'none') {
            e.preventDefault();
            closePostureMenu();
        }
        if (combatParticipantMenu) {
            e.preventDefault();
            closeCombatParticipantMenu();
        }
        if (aimedZoneMenu && aimedZoneMenu.style.display !== 'none') {
            e.preventDefault();
            closeAimedZoneMenu();
        }
        if (pendingCombatAction) {
            e.preventDefault();
            clearPendingCombatAction();
            showNotification('Выбор цели отменён', 'system');
        }
        if (pendingStructureAction || pendingObjectMoveId) {
            e.preventDefault();
            hideStructureInteraction();
            showNotification('Взаимодействие отменено', 'system');
        }
    if (combatActionMenu) {
        combatActionMenu.style.display = 'none';
        combatActionMenuCharacterId = null;
    }
    if (medicalConsumableMenu && medicalConsumableMenu.style.display !== 'none') {
        closeMedicalConsumableMenu();
    }
    armedMoveCharacterId = null;
    armedMovementType = null;
    clearMovementPreview();
};
    document.addEventListener('keydown', onKeyDown);
    handlers.document.keydown = onKeyDown;
    const onKeyUp = (e) => {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) locationCameraKeys.delete(e.code);
    };
    const onWindowBlur = () => locationCameraKeys.clear();
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    handlers.document.keyup = onKeyUp;
    handlers.window.cameraBlur = onWindowBlur;
}

// ========== Настройка обработчиков редактирования и Drag&Drop спавна ==========
export function setupLocationEditing() {
    if (!renderer) return;
    const canvas = renderer.domElement;
    const locInfo = document.getElementById('location-tile-info');
    locationActive = true;

    const onPointerMove = (e) => {
        if (!locationActive) return;
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(tileCubes);
        if (intersects.length > 0) {
            const hit = intersects[0];
            const coords = hit.object.userData.tileByInstance?.[hit.instanceId];
            if (!coords) return;
            const { x, z } = coords;
            const tile = currentLocationData.tiles_data[z][x];
            locInfo.innerHTML = `
                <b>Тайл (${x}, ${z})</b><br>
                Ландшафт: ${tile.terrain}<br>
                Высота: ${tile.height}<br>
                Радиация: ${tile.radiation !== undefined ? tile.radiation : '0'}<br>
            `;
            locInfo.style.display = 'block';
            if (!lastHighlightCoords || lastHighlightCoords.x !== x || lastHighlightCoords.z !== z) {
                updateHighlight(x, z, tile.height || 1.0);
                lastHighlightCoords = { x, z };
            }
            hoveredTileCoords = { x, z };
            updateBuildPreview();
        } else {
            locInfo.style.display = 'none';
            hideHighlight();
            hoveredTileCoords = null;
            lastHighlightCoords = null;
            clearBuildPreview();
        }
    };
    window.addEventListener('pointermove', onPointerMove);
    handlers.window.pointerMove = onPointerMove;

    const onPointerDown = (e) => {
        if (!locationActive) return;
        if (e.button !== 0) return;
        if (!hoveredTileCoords) return;
        if (e.target !== canvas) return;
        if (pendingObjectMoveId) {
            commitStructureMovePreview(e.clientX, e.clientY);
            return;
        }
        if (!window.locationEditMode) return;
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        const { x, z } = hoveredTileCoords;
        if (buildMode === 'structure') {
            if (eraserMode) removeStructuresAtTile(x, z);
            else placeStructureAtTile(x, z);
            return;
        }
        const radMode = document.getElementById('loc-rad-mode')?.checked;
        const objMode = document.getElementById('loc-obj-mode')?.checked;
        const updates = {};
        if (eraserMode) {
            updates.objects = [];
        } else {
            if (radMode) {
                updates.radiation = brushRadiation;
            } else if (objMode) {
                updates.addObject = true;
            } else {
                if (e.altKey) updates.terrain = currentBrushTerrain;
                if (e.shiftKey) updates.height = currentBrushHeight;
            }
        }
        if (Object.keys(updates).length) {
            applyLocationBrush(x, z, updates, brushRadius);
        }
        processedTilesForObjects.clear();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    handlers.canvas.editPointerDown = onPointerDown;

    const onPointerMoveWithDrag = (e) => {
        if (!locationActive) return;
        if (e.buttons !== 1) return;
        if (!window.locationEditMode) return;
        if (!hoveredTileCoords) return;
        if (e.target !== canvas) return;
        const { x, z } = hoveredTileCoords;
        if (buildMode === 'structure') {
            if (eraserMode) removeStructuresAtTile(x, z);
            return;
        }
        const radMode = document.getElementById('loc-rad-mode')?.checked;
        const objMode = document.getElementById('loc-obj-mode')?.checked;
        const updates = {};
        if (eraserMode) {
            updates.objects = [];
        } else {
            if (radMode) {
                updates.radiation = brushRadiation;
            } else if (objMode) {
                updates.addObject = true;
            } else {
                if (e.altKey) updates.terrain = currentBrushTerrain;
                if (e.shiftKey) updates.height = currentBrushHeight;
            }
        }
        if (Object.keys(updates).length) {
            applyLocationBrush(x, z, updates, brushRadius);
        }
    };
    window.addEventListener('pointermove', onPointerMoveWithDrag);
    handlers.window.pointerMoveWithDrag = onPointerMoveWithDrag;

    const onPointerUp = (e) => {
        if (!locationActive) return;
        canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener('pointerup', onPointerUp);
    handlers.canvas.editPointerUp = onPointerUp;

    // Drag & Drop спавна персонажей
    let previewValid = false;

    function createPreviewSprite() {
        if (previewSprite) {
            scene.remove(previewSprite);
            previewSprite.material.map?.dispose();
            previewSprite.material.dispose();
            previewSprite = null;
        }
        const canvas2 = document.createElement('canvas');
        canvas2.width = 64;
        canvas2.height = 64;
        const ctx = canvas2.getContext('2d');
        ctx.fillStyle = '#88aaff';
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 20px Arial';
        ctx.fillText('✨', 26, 42);
        const texture = new THREE.CanvasTexture(canvas2);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.7 });
        previewSprite = new THREE.Sprite(material);
        previewSprite.scale.set(0.8, 0.8, 1);
        scene.add(previewSprite);
        return previewSprite;
    }

    function updatePreviewPosition(clientX, clientY) {
        if (!renderer) return;
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(tileCubes);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const tileX = Math.floor(point.x);
            const tileZ = Math.floor(point.z);
            if (tileX >= 0 && tileX < currentLocationData.grid_width && tileZ >= 0 && tileZ < currentLocationData.grid_height) {
                const tile = currentLocationData.tiles_data[tileZ][tileX];
                const height = tile.height || 1.0;
                if (!previewSprite) previewSprite = createPreviewSprite();
                previewSprite.position.set(tileX + 0.5, height + 0.5, tileZ + 0.5);
                previewSprite.visible = true;
                previewValid = true;
                return;
            }
        }
        if (previewSprite) previewSprite.visible = false;
        previewValid = false;
    }

    const onDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        updatePreviewPosition(e.clientX, e.clientY);
    };
    canvas.addEventListener('dragover', onDragOver);
    handlers.canvas.dragover = onDragOver;

    const onDragLeave = (e) => {
        e.preventDefault();
        if (previewSprite) previewSprite.visible = false;
        previewValid = false;
    };
    canvas.addEventListener('dragleave', onDragLeave);
    handlers.canvas.dragleave = onDragLeave;

    const onDrop = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!previewValid) {
            console.warn('Drop cancelled: preview not valid');
            return;
        }
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(tileCubes);
        if (intersects.length === 0) return;
        const point = intersects[0].point;
        const tileX = Math.floor(point.x);
        const tileZ = Math.floor(point.z);
        const dragData = e.dataTransfer.getData('text/plain');
        if (!dragData) return;
        let parsed;
        try { parsed = JSON.parse(dragData); } catch (err) { return; }
        const characterId = parsed.characterId;
        const ownerId = parsed.ownerId;
        if (!characterId) return;
        openOwnerSelectionModal(characterId, tileX, tileZ, ownerId);
        if (previewSprite) previewSprite.visible = false;
        previewValid = false;
    };
    canvas.addEventListener('drop', onDrop);
    handlers.canvas.drop = onDrop;

    const onWheel = (e) => {
        if (e.altKey) e.preventDefault();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    handlers.canvas.wheel = onWheel;

    eventCleanup = () => {
        // Удаляем все обработчики из хранилища
        Object.keys(handlers.window).forEach(key => {
            window.removeEventListener(key, handlers.window[key]);
            delete handlers.window[key];
        });
        Object.keys(handlers.canvas).forEach(key => {
            canvas.removeEventListener(key, handlers.canvas[key]);
            delete handlers.canvas[key];
        });
        // document.click удаляется отдельно в destroyLocationScene
        locationActive = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (previewSprite) {
            scene.remove(previewSprite);
            previewSprite.material.map?.dispose();
            previewSprite.material.dispose();
            previewSprite = null;
        }
    };
    window._locationEventCleanup = eventCleanup;
}

// ========== Модальное окно выбора владельца ==========
export async function openOwnerSelectionModal(characterId, tileX, tileZ, dragDataOwnerId) {
    const lobbyParticipants = window.lobbyParticipants || [];
    const currentUserId = parseInt(localStorage.getItem('user_id'));
    const isGM = window.isGM;
    let characterOwner = dragDataOwnerId;
    if (!characterOwner) {
        try {
            const response = await fetch(`/lobbies/characters/${characterId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
            });
            if (response.ok) {
                const info = await response.json();
                characterOwner = info.owner_id;
            }
        } catch (err) {}
    }
    let options = [];
    if (isGM) {
        options = lobbyParticipants.map(p => ({ id: p.user_id, name: p.username }));
    } else {
        if (characterOwner !== currentUserId) {
            showNotification('Вы не можете спавнить чужого персонажа');
            return;
        }
        options = [{ id: currentUserId, name: localStorage.getItem('username') }];
    }
    if (options.length === 0) {
        showNotification('Нет доступных владельцев');
        return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h3>Выберите владельца персонажа</h3>
            <select id="owner-select" class="form-control">
                ${options.map(opt => `<option value="${opt.id}">${opt.name}</option>`).join('')}
            </select>
            <div class="form-actions">
                <button id="confirm-spawn" class="btn btn-primary">Поместить</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('confirm-spawn').onclick = async () => {
        const assignToUserId = parseInt(document.getElementById('owner-select').value);
        modal.remove();
        try {
            const response = await fetch(`/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/spawn_character`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
                },
                body: JSON.stringify({
                    character_id: characterId,
                    tile_x: tileX,
                    tile_y: tileZ,
                    assign_to_user_id: assignToUserId
                })
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to spawn character');
            }
            showNotification('Персонаж появился в локации', 'success');
        } catch (err) {
            showNotification(err.message);
        }
    };
}

// ========== Управляющие функции для UI ==========
export function setLocationEditMode(enabled) {
    editMode = enabled;
    window.locationEditMode = enabled;
    if (!enabled) {
        hideHighlight();
        clearBuildPreview();
    }
    if (hoveredTileCoords && currentLocationData) {
        const { x, z } = hoveredTileCoords;
        const tile = currentLocationData.tiles_data[z]?.[x];
        if (tile) updateHighlight(x, z, tile.height);
    }
    const btn = document.getElementById('edit-toggle');
    if (btn) btn.style.background = enabled ? '#4a6fa5' : '';
    const locCheckbox = document.getElementById('loc-edit-toggle-checkbox');
    if (locCheckbox) locCheckbox.checked = enabled;
    updateBuildPreview();
}

export function getLocationEditMode() { return editMode; }
export function setLocationBrushRadius(r) {
    brushRadius = r;
    const radiusSlider = document.getElementById('brush-radius');
    const radiusSpan = document.getElementById('brush-radius-value');
    if (radiusSlider) radiusSlider.value = r;
    if (radiusSpan) radiusSpan.textContent = r;
    const locRadiusSlider = document.getElementById('loc-edit-radius');
    const locRadiusSpan = document.getElementById('loc-radius-value');
    if (locRadiusSlider) locRadiusSlider.value = r;
    if (locRadiusSpan) locRadiusSpan.textContent = r;
    if (hoveredTileCoords && currentLocationData) {
        const { x, z } = hoveredTileCoords;
        const tile = currentLocationData.tiles_data[z][x];
        updateHighlight(x, z, tile.height);
    }
}
export function setLocationBrushTerrain(t) {
    currentBrushTerrain = t;
    const select = document.getElementById('tile-type-select');
    if (select) select.value = t;
    const locSelect = document.getElementById('loc-edit-terrain');
    if (locSelect) locSelect.value = t;
}
export function setLocationBrushHeight(h) {
    currentBrushHeight = h;
    const heightSlider = document.getElementById('tile-height');
    const heightSpan = document.getElementById('tile-height-value');
    if (heightSlider) heightSlider.value = h;
    if (heightSpan) heightSpan.textContent = h.toFixed(1);
    const locHeightSlider = document.getElementById('loc-edit-height');
    const locHeightSpan = document.getElementById('loc-height-value');
    if (locHeightSlider) locHeightSlider.value = h;
    if (locHeightSpan) locHeightSpan.textContent = h.toFixed(1);
}
export function setLocationEraserMode(e) {
    eraserMode = e;
    const eraserCheck = document.getElementById('eraser-checkbox');
    if (eraserCheck) eraserCheck.checked = e;
    const locEraserCheck = document.getElementById('loc-eraser');
    if (locEraserCheck) locEraserCheck.checked = e;
}
export function setLocationBrushRadiation(rad) {
    brushRadiation = Math.min(10, Math.max(0, rad));
    const radiationSlider = document.getElementById('loc-edit-radiation');
    const radiationSpan = document.getElementById('loc-radiation-value');
    if (radiationSlider) radiationSlider.value = brushRadiation;
    if (radiationSpan) radiationSpan.textContent = brushRadiation.toFixed(1);
}
export function setLocationBrushObjectMode(enabled) {
    brushObjectMode = enabled;
    const checkbox = document.getElementById('loc-obj-mode');
    if (checkbox) checkbox.checked = enabled;
}
export function setLocationBrushObjectType(type) {
    brushObjectType = type;
    const select = document.getElementById('loc-obj-type');
    if (select) select.value = type;
}
export function setLocationBrushObjectColor(color) {
    brushObjectColor = color;
    const input = document.getElementById('loc-obj-color');
    if (input) input.value = color;
}
export function setLocationBrushObjectOffsetX(offset) {
    brushObjectOffsetX = parseFloat(offset) || 0;
    const span = document.getElementById('loc-obj-offset-x-value');
    if (span) span.textContent = brushObjectOffsetX.toFixed(2);
}
export function setLocationBrushObjectOffsetZ(offset) {
    brushObjectOffsetZ = parseFloat(offset) || 0;
    const span = document.getElementById('loc-obj-offset-z-value');
    if (span) span.textContent = brushObjectOffsetZ.toFixed(2);
}
export function setLocationBrushObjectScale(scale) {
    brushObjectScale = parseFloat(scale) || 1.0;
    const span = document.getElementById('loc-obj-scale-value');
    if (span) span.textContent = brushObjectScale.toFixed(2);
}
export function setLocationBrushObjectRotation(rot) {
    brushObjectRotation = parseInt(rot) || 0;
    const span = document.getElementById('loc-obj-rotation-value');
    if (span) span.textContent = brushObjectRotation + '°';
}

// ========== Остальные экспорты ==========
export function setCurrentLocationId(id) { currentLocationId = id; }
export function getCurrentLocationId() { return currentLocationId; }
export function getHoveredTileCoords() { return hoveredTileCoords; }
export function updateHighlightByCoords(x, z) {
    if (!currentLocationData) return;
    const tile = currentLocationData.tiles_data[z]?.[x];
    if (tile) updateHighlight(x, z, tile.height);
}

export function addDeleteLocationButton(callback) {
    let btn = document.getElementById('delete-location-btn');
    if (btn) btn.remove();
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

export function destroyLocationScene() {
    locationActive = false;
    closeAimedZoneMenu();

    // Удаляем обработчики
    if (eventCleanup) {
        eventCleanup();
        eventCleanup = null;
    }
    if (window._locationEventCleanup) {
        window._locationEventCleanup();
        window._locationEventCleanup = null;
    }

    // Удаляем обработчики document.click (контекстное меню)
    if (handlers.document.click) {
        document.removeEventListener('click', handlers.document.click);
        delete handlers.document.click;
    }
    if (handlers.document.structureMenuClick) {
        document.removeEventListener('click', handlers.document.structureMenuClick);
        delete handlers.document.structureMenuClick;
    }
    if (handlers.document.structureRotationMenuClick) {
        document.removeEventListener('click', handlers.document.structureRotationMenuClick);
        delete handlers.document.structureRotationMenuClick;
    }
    if (handlers.document.containerMenuClick) {
        document.removeEventListener('click', handlers.document.containerMenuClick);
        delete handlers.document.containerMenuClick;
    }
    if (handlers.document.keydown) {
        document.removeEventListener('keydown', handlers.document.keydown);
        delete handlers.document.keydown;
    }
    if (handlers.document.keyup) {
        document.removeEventListener('keyup', handlers.document.keyup);
        delete handlers.document.keyup;
    }
    if (handlers.window.cameraBlur) {
        window.removeEventListener('blur', handlers.window.cameraBlur);
        delete handlers.window.cameraBlur;
    }
    locationCameraKeys.clear();
    if (handlers.window.combatHudPointerMove) {
        window.removeEventListener('pointermove', handlers.window.combatHudPointerMove);
        delete handlers.window.combatHudPointerMove;
    }
    if (handlers.window.combatHudPointerUp) {
        window.removeEventListener('pointerup', handlers.window.combatHudPointerUp);
        window.removeEventListener('pointercancel', handlers.window.combatHudPointerUp);
        delete handlers.window.combatHudPointerUp;
    }

    // Удаляем контекстное меню
    if (contextMenu && contextMenu.parentNode) {
        contextMenu.parentNode.removeChild(contextMenu);
        contextMenu = null;
    }
    if (combatActionMenu && combatActionMenu.parentNode) {
        combatActionMenu.parentNode.removeChild(combatActionMenu);
        combatActionMenu = null;
    }
    if (structureActionMenu && structureActionMenu.parentNode) {
        structureActionMenu.parentNode.removeChild(structureActionMenu);
        structureActionMenu = null;
    }
    if (structureRotationMenu && structureRotationMenu.parentNode) {
        structureRotationMenu.parentNode.removeChild(structureRotationMenu);
        structureRotationMenu = null;
    }
    if (containerInteractionMenu && containerInteractionMenu.parentNode) {
        containerInteractionMenu.parentNode.removeChild(containerInteractionMenu);
        containerInteractionMenu = null;
    }
    contextMenuCharacterId = null;
    combatActionMenuCharacterId = null;
    pendingCombatAction = null;
    pendingStructureAction = null;
    containerInteractionState = null;
    armedMoveCharacterId = null;
    clearMovementPreview();
    clearAttackPreview();
    clearStructureMovePreview();
    clearStructureActionMenu();
    clearStructureRotationMenu();

    // Очищаем сцену
    if (scene) {
        const objectsToRemove = [];
        scene.traverse((child) => {
            if (child.isLight || child.type === 'Camera' || child.type === 'GridHelper') return;
            if (child === highlightBox) return;
            objectsToRemove.push(child);
        });
        objectsToRemove.forEach(obj => {
            disposeObject(obj);
            scene.remove(obj);
        });
        tileCubes = [];
        locationTileMesh = null;
        objectMeshes = [];
        anomalyEffectMeshes = [];
        locationObjectMeshes = [];
        clearAllCharacters();

        if (highlightBox) {
            scene.remove(highlightBox);
            disposeObject(highlightBox);
            highlightBox = null;
        }
        scene = null;
    }

    // Рендереры
    if (labelRenderer) {
        if (labelRenderer.domElement && labelRenderer.domElement.parentNode) {
            labelRenderer.domElement.parentNode.removeChild(labelRenderer.domElement);
        }
        labelRenderer = null;
    }
    if (renderer) {
        renderer.dispose();
        if (renderer.domElement && renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer = null;
    }

    // Камера и контролы
    camera = null;
    if (controls) {
        controls.dispose();
        controls = null;
    }
    window.locationControls = null;

    // Данные
    currentLocationData = null;
    combatState = null;
    window.locationCombatState = null;
    if (combatHud && combatHud.parentNode) {
        combatHud.parentNode.removeChild(combatHud);
    }
    combatHud = null;
    clearBuildPreview();
    hoveredTileCoords = null;
    lastHighlightCoords = null;
    processedTilesForObjects.clear();
    structureDeletionInFlight.clear();
    dragCharacter = null;
    isDraggingCharacter = false;
    hoveredCharacterId = null;

    // previewSprite
    if (previewSprite) {
        scene?.remove(previewSprite);
        previewSprite.material.map?.dispose();
        previewSprite.material.dispose();
        previewSprite = null;
    }

    const locInfo = document.getElementById('location-tile-info');
    if (locInfo) locInfo.style.display = 'none';

    // Также удаляем обработчик resize, если он был добавлен
    // (он добавляется один раз, но лучше убрать)
    // Мы не можем удалить его, т.к. он не сохранён. Но это не критично.
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

// Удаляем обработчик resize при перезагрузке модуля? Но он добавляется один раз.
// Можно оставить, он не влияет на утечки.
window.addEventListener('resize', resizeLocationScene);

function closeContainerInteractionMenu() {
    if (containerInteractionMenu) {
        containerInteractionMenu.style.display = 'none';
    }
    containerInteractionState = null;
    containerExchangeTarget = null;
}

async function showContainerInteractionMenu(object) {
    closeContainerInteractionMenu();
    containerExchangeTarget = object;

    if (!containerInteractionMenu) {
        containerInteractionMenu = document.createElement('div');
        containerInteractionMenu.style.cssText = `
            position: fixed;
            z-index: 1210;
            width: min(980px, calc(100vw - 24px));
            max-width: 980px;
            max-height: min(82vh, 760px);
            overflow: hidden;
            background: rgba(14, 18, 26, 0.98);
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 16px;
            box-shadow: 0 20px 42px rgba(0,0,0,0.45);
            color: #fff;
            backdrop-filter: blur(10px);
            font-family: 'Segoe UI', Arial, sans-serif;
            display: none;
        `;
        document.body.appendChild(containerInteractionMenu);
        const onClick = (event) => {
            if (event.target.closest?.('#inventory-template-picker-modal, #ammo-selection-modal')) {
                return;
            }
            if (containerInteractionMenu && !containerInteractionMenu.contains(event.target)) {
                closeContainerInteractionMenu();
            }
        };
        document.addEventListener('click', onClick);
        handlers.document.containerMenuClick = onClick;
    }

    const controlledCharacters = getControlledLocationCharacters();
    const preferredCharacterId = getPreferredLocationCharacterId();
    containerInteractionState = {
        objectId: object.id,
        selectedCharacterId: preferredCharacterId,
    };

    containerInteractionMenu.innerHTML = `
        <div class="container-drag-handle" style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.08); cursor:move; user-select:none; touch-action:none;">
            <div style="font-weight:700;">${object.name || object.type || 'Контейнер'}</div>
            <button type="button" class="container-close-btn" style="width:32px; height:32px; border-radius:999px; border:0; background:rgba(255,255,255,0.08); color:#fff; cursor:pointer; font-size:18px; line-height:1;">×</button>
        </div>
        <div style="padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div style="opacity:0.75;">Персонаж:</div>
            <select class="container-character-select form-control" style="width:280px; max-width:100%;"></select>
        </div>
        <div class="container-exchange-body" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:12px; padding:12px; overflow:auto; max-height:calc(min(82vh, 760px) - 120px);"></div>
    `;

    const select = containerInteractionMenu.querySelector('.container-character-select');
    if (select) {
        select.innerHTML = '';
        if (!controlledCharacters.length) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'Нет доступных персонажей';
            select.appendChild(option);
            select.disabled = true;
        } else {
            controlledCharacters.forEach((character) => {
                const option = document.createElement('option');
                option.value = String(character.characterId);
                option.textContent = character.name || `Персонаж ${character.characterId}`;
                select.appendChild(option);
            });
            select.value = String(preferredCharacterId || controlledCharacters[0].characterId);
        }
    }

    const body = containerInteractionMenu.querySelector('.container-exchange-body');
    const dragHandle = containerInteractionMenu.querySelector('.container-drag-handle');
    const renderExchange = async () => {
        const selectedCharacterId = parseInt(select?.value || '0', 10) || null;
        if (selectedCharacterId) {
            containerInteractionState.selectedCharacterId = selectedCharacterId;
            window.currentLocationCharacterId = selectedCharacterId;
            localStorage.setItem('selectedLocationCharacterId', String(selectedCharacterId));
        }

        const character = selectedCharacterId ? await Server.getCharacter(selectedCharacterId).catch(() => null) : null;
        const characterData = character?.data || null;
        const characterEntries = characterData ? getCharacterTransferEntries(characterData) : [];

        body.innerHTML = '';
        const leftPanel = document.createElement('div');
        const rightPanel = document.createElement('div');
        [leftPanel, rightPanel].forEach((panel) => {
            panel.style.cssText = 'min-width:0; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:14px; overflow:hidden;';
        });

        leftPanel.innerHTML = `
            <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); font-weight:700;">Инвентарь</div>
            <div class="exchange-list exchange-list-source" style="padding:10px 12px; max-height:100%; overflow:auto;"></div>
        `;
        rightPanel.innerHTML = `
            <div style="padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; gap:10px; align-items:center;">
                <div style="font-weight:700;">${object.name || object.type || 'Контейнер'}</div>
                ${window.isGM ? '<button type="button" class="btn btn-sm btn-secondary container-add-item-btn">Добавить предмет</button>' : ''}
            </div>
            <div class="exchange-list exchange-list-target" style="padding:10px 12px; max-height:100%; overflow:auto;"></div>
        `;

        body.appendChild(leftPanel);
        body.appendChild(rightPanel);

        const sourceList = leftPanel.querySelector('.exchange-list-source');
        const targetList = rightPanel.querySelector('.exchange-list-target');

        if (!characterData) {
            sourceList.innerHTML = '<div style="opacity:0.75;">Выберите персонажа</div>';
        } else if (!characterEntries.length) {
            sourceList.innerHTML = '<div style="opacity:0.75;">Инвентарь пуст</div>';
        } else {
            characterEntries.forEach((entry) => {
                sourceList.appendChild(buildTransferRow(entry, '→', async (amount = 1) => {
                    const fresh = await Server.getCharacter(selectedCharacterId).catch(() => null);
                    const freshData = fresh?.data || null;
                    if (!freshData) {
                        showNotification('Не удалось загрузить персонажа', 'system');
                        return;
                    }
                    const removed = takeItemByPathFromRoot(freshData, entry.path, amount);
                    if (!removed) {
                        showNotification('Не удалось переместить предмет', 'system');
                        return;
                    }
                    const updatedContents = [...getContainerItems(object), cloneTransferItem(removed)];
                    await Promise.all([
                        Server.updateCharacter(selectedCharacterId, { data: freshData }),
                        Server.updateLocationObject(window.currentLobbyId, object.id, { properties: { contents: updatedContents } }),
                    ]);
                    object.properties = { ...(object.properties || {}), contents: updatedContents };
                    if (!updatedContents.length && (object.type === 'ground_item' || object.properties?.is_ground_item)) {
                        await Server.deleteLocationObject(window.currentLobbyId, object.id);
                        closeContainerInteractionMenu();
                        return;
                    }
                    showNotification('Предмет перемещён', 'success');
                    await showContainerInteractionMenu(object);
                }));
            });
        }

        const renderContainerEntries = () => {
            const currentItems = getContainerItems(object);
            const currentEntries = getContainerTransferEntries(currentItems);
            targetList.innerHTML = '';
            if (!currentEntries.length) {
                targetList.innerHTML = '<div style="opacity:0.75;">Пусто</div>';
                return;
            }
            currentEntries.forEach((entry) => {
                targetList.appendChild(buildTransferRow(entry, '←', async (amount = 1) => {
                    if (!selectedCharacterId) {
                        showNotification('Выберите персонажа', 'system');
                        return;
                    }
                    const fresh = await Server.getCharacter(selectedCharacterId).catch(() => null);
                    const freshData = fresh?.data || null;
                    if (!freshData) {
                        showNotification('Не удалось загрузить персонажа', 'system');
                        return;
                    }
                    const containerRoot = { contents: [...getContainerItems(object)] };
                    const removed = takeItemByPathFromRoot(containerRoot, entry.path, amount);
                    if (!removed) {
                        showNotification('Не удалось переместить предмет', 'system');
                        return;
                    }
                    const inventory = getCharacterInventoryRoot(freshData);
                    inventory.backpack.push(cloneTransferItem(removed));
                    await Promise.all([
                        Server.updateCharacter(selectedCharacterId, { data: freshData }),
                        Server.updateLocationObject(window.currentLobbyId, object.id, { properties: { contents: containerRoot.contents } }),
                    ]);
                    object.properties = { ...(object.properties || {}), contents: containerRoot.contents };
                    if (!containerRoot.contents.length && (object.type === 'ground_item' || object.properties?.is_ground_item)) {
                        await Server.deleteLocationObject(window.currentLobbyId, object.id);
                        closeContainerInteractionMenu();
                        return;
                    }
                    showNotification('Предмет перемещён', 'success');
                    await showContainerInteractionMenu(object);
                }));
            });
        };
        renderContainerEntries();

        const addBtn = rightPanel.querySelector('.container-add-item-btn');
        if (addBtn) {
            addBtn.onclick = async () => {
                if (typeof window.openInventoryTemplatePicker !== 'function') {
                    showNotification('Не удалось открыть выбор предметов', 'system');
                    return;
                }

                await window.openInventoryTemplatePicker('pockets', {
                    title: `Добавить предмет: ${object.name || object.type || 'Контейнер'}`,
                    onSelect: async (newItem) => {
                        const updatedContents = [...getContainerItems(object), newItem];
                        await Server.updateLocationObject(window.currentLobbyId, object.id, {
                            properties: { contents: updatedContents },
                        });
                        object.properties = { ...(object.properties || {}), contents: updatedContents };
                        showNotification('Предмет добавлен в контейнер', 'success');
                        renderContainerEntries();
                        return true;
                    },
                });
            };
        }
    };

    if (select) {
        select.onchange = () => {
            renderExchange().catch((error) => showNotification(error.message || 'Не удалось обновить контейнер', 'system'));
        };
    }

    const closeBtn = containerInteractionMenu.querySelector('.container-close-btn');
    if (closeBtn) closeBtn.onclick = () => closeContainerInteractionMenu();

    if (dragHandle && !dragHandle.dataset.dragBound) {
        dragHandle.dataset.dragBound = '1';
        dragHandle.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            if (event.target.closest('button, select, input, textarea, option, label')) return;
            if (!containerInteractionMenu) return;
            const rect = containerInteractionMenu.getBoundingClientRect();
            containerInteractionDragState = {
                pointerId: event.pointerId,
                offsetX: event.clientX - rect.left,
                offsetY: event.clientY - rect.top,
            };
            dragHandle.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });
        const onPointerMove = (event) => {
            if (!containerInteractionDragState || containerInteractionDragState.pointerId !== event.pointerId || !containerInteractionMenu) return;
            const rect = containerInteractionMenu.getBoundingClientRect();
            const minLeft = 8;
            const minTop = 8;
            const maxLeft = Math.max(minLeft, window.innerWidth - rect.width - 8);
            const maxTop = Math.max(minTop, window.innerHeight - rect.height - 8);
            let left = event.clientX - containerInteractionDragState.offsetX;
            let top = event.clientY - containerInteractionDragState.offsetY;
            left = Math.min(Math.max(minLeft, left), maxLeft);
            top = Math.min(Math.max(minTop, top), maxTop);
            containerInteractionMenu.style.left = `${left}px`;
            containerInteractionMenu.style.top = `${top}px`;
        };
        const stopDrag = (event) => {
            if (!containerInteractionDragState) return;
            if (event && event.pointerId !== undefined && containerInteractionDragState.pointerId !== event.pointerId) return;
            containerInteractionDragState = null;
        };
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', stopDrag);
        document.addEventListener('pointercancel', stopDrag);
    }

    containerInteractionMenu.style.display = 'block';
    containerInteractionMenu.style.visibility = 'hidden';

    const rect = containerInteractionMenu.getBoundingClientRect();
    let left = parseFloat(containerInteractionMenu.style.left || '');
    let top = parseFloat(containerInteractionMenu.style.top || '');
    if (!Number.isFinite(left)) left = window.innerWidth / 2 - rect.width / 2;
    if (!Number.isFinite(top)) top = window.innerHeight / 2 - rect.height / 2;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
    left = Math.min(left, Math.max(8, window.innerWidth - rect.width - 8));
    top = Math.min(top, Math.max(8, window.innerHeight - rect.height - 8));
    containerInteractionMenu.style.left = `${left}px`;
    containerInteractionMenu.style.top = `${top}px`;
    containerInteractionMenu.style.visibility = 'visible';

    await renderExchange();
}

window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (containerInteractionMenu && containerInteractionMenu.style.display === 'block') {
        closeContainerInteractionMenu();
    }
});
