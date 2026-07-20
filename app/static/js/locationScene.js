// static/js/locationScene.js
import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.128.0/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'https://unpkg.com/three@0.128.0/examples/jsm/renderers/CSS2DRenderer.js';
import { showNotification } from './utils.js';
import { getUserColor, getUserColorHex } from './colors.js';
import { Server } from './api.js';
import { createAnomalyEffect, animateAnomalyEffects } from './anomalies.js';

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
let armedMoveCharacterId = null;
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

    return { points, cost: path.cost };
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
        cost = route?.cost ?? Math.max(Math.abs(targetX - startX), Math.abs(targetY - startY));
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

    if (!movementPreviewLine) {
        movementPreviewLine = createPreviewLine(cost <= available || window.isGM ? 0x54d17a : 0xff6b6b);
        scene.add(movementPreviewLine);
        movementPreviewLine.userData = {
            targetKey,
            route,
            cost,
            points,
        };
    }
    movementPreviewLine.geometry.setFromPoints(points);

    const hint = ensureMovementPreviewHint();
    hint.textContent = route ? `ОП: ${cost}/${available}` : 'Путь заблокирован';
    hint.style.left = `${clientX + 14}px`;
    hint.style.top = `${clientY + 14}px`;
    hint.style.display = 'block';
    hint.style.color = cost <= available || window.isGM ? '#d7ffe5' : '#ffd0d0';
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

    const actorEntry = characterModels.get(actor.character_id);
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
    const cost = route?.cost ?? Math.max(Math.abs(targetX - startX), Math.abs(targetY - startY));
    const available = combatState?.current_character?.movement_points_current ?? 0;

    if (!route) {
        showNotification('Путь к выбранной клетке заблокирован', 'system');
        return false;
    }

    if (combatState?.status === 'active' && cost > available) {
        showNotification('Недостаточно ОП для этого перемещения', 'system');
        return false;
    }

    if (window.socket && window.currentLocationId) {
        window.socket.emit('move_in_location', {
            token: localStorage.getItem('access_token'),
            location_id: window.currentLocationId,
            character_id: movementPreviewCharacterId,
            x: targetX,
            y: targetY
        });
    }
    clearMovementPreview();
    armedMoveCharacterId = null;
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

function showCombatActionMenu(clientX, clientY, characterId) {
    ensureCombatActionMenu();
    combatActionMenuCharacterId = characterId;
    const combatCharacter = findCombatCharacterByCharacterId(characterId);
    const canAct = canActWithCombatCharacter(combatCharacter);
    const isCurrentTurn = Boolean(
        combatState?.status !== 'active' ||
        combatState?.current_character?.character_id === combatCharacter?.character_id
    );
    const hasFullAccess = !combatState || combatState.status !== 'active' ? canControlCharacter(characterId) : (canAct && isCurrentTurn);
    const menuItems = [
        {
            label: 'Движение',
            title: 'Перетащить персонажа по карте',
            angle: -90,
            action: () => startCharacterMoveMode(characterId),
        },
        {
            label: 'Атака',
            title: 'Открыть экипировку для выбора оружия и типа атаки',
            angle: -18,
            action: () => import('./characterSheet.js').then(module => module.openCharacterSheet(characterId, 'equipment')),
        },
        {
            label: 'Инвентарь',
            title: 'Открыть вкладку инвентаря',
            angle: 126,
            action: () => import('./characterSheet.js').then(module => module.openCharacterSheet(characterId, 'inventory')),
        },
        {
            label: 'ОП',
            title: 'Преобразовать СД в ОП',
            angle: 198,
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

    menuItems.splice(2, 0, {
        label: 'Взаим.',
        title: 'Действия со структурой',
        angle: 36,
        action: () => beginStructureInteractionMode(characterId),
    });

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
        ">${canAct ? 'Действия' : 'Просмотр'}</div>
    `;

    const radius = 98;
    menuItems.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.label;
        button.title = item.title;
        button.style.cssText = `
            position:absolute;
            left:50%;
            top:50%;
            width:74px;
            min-height:74px;
            transform: translate(-50%, -50%) translate(${Math.cos((item.angle * Math.PI) / 180) * radius}px, ${Math.sin((item.angle * Math.PI) / 180) * radius}px);
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
        const allowed = item.label === 'Инвентарь' || hasFullAccess;
        button.disabled = !allowed;
        button.style.opacity = allowed ? '1' : '0.45';
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

function getCombatMenuState() {
    const current = combatState?.current_character || null;
    const myId = getCurrentUserId();
    const canAct = Boolean(current) && (window.isGM || current.controlled_by === myId || current.owner_id === myId);
    return { current, canAct };
}

function beginCharacterMoveMode(characterId) {
    if (!isCurrentCombatTurnForCharacter(characterId)) {
        showNotification('Сейчас не ход этого персонажа', 'system');
        return false;
    }
    armedMoveCharacterId = characterId;
    pendingCombatAction = null;
    clearAttackPreview();
    initializeMovementPreview(characterId);
    showNotification('Теперь перетащите этого персонажа ЛКМ', 'system');
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
    };
    closeCombatMenus();
    hideStructureInteraction();
    clearMovementPreview();
    if (typeof window.closeCharacterSheet === 'function' && action.source === 'sheet') {
        window.closeCharacterSheet();
    }
    const label = action.actionKey === 'use_item' ? 'Использование предмета' : 'Атака';
    showNotification(`${label}: выберите цель на сцене`, 'system');
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
    hideStructureInteraction();
    return beginCharacterMoveMode(characterId);
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

    const payload = {
        location_character_id: action.actorLocationCharacterId,
        action_key: action.actionKey,
        target_character_id: targetCharacterId,
        weapon_index: action.weaponIndex,
        attack_type: action.attackType,
        item_path: action.itemPath,
    };

    try {
        await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), payload);
        if (typeof action.onResolve === 'function') {
            await action.onResolve({ targetCharacterId, target });
        }
        showNotification(
            `${action.actionKey === 'use_item' ? 'Действие' : 'Атака'} выполнена по ${target.name || 'цели'}`,
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

// ========== Создание модели персонажа ==========
function createCharacterModel(userId) {
    const group = new THREE.Group();
    const color = getUserColor(userId);
    const bodyGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.7, 8);
    const bodyMat = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.35;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const headGeo = new THREE.SphereGeometry(0.15, 8);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffddbb });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 0.8;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);
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
    div.textContent = name;
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
        controlledBy: resolvedControlledBy ?? fallbackOwnerId
    });
    invalidateMovementMapCache();
}

export function updateCharacterPosition(characterId, posX, posY) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    const tileHeight = getTileHeight(posX, posY);
    entry.model.position.set(posX + 0.5, tileHeight, posY + 0.5);
    entry.label.position.set(posX + 0.5, tileHeight + 1.2, posY + 0.5);
    entry.posX = posX;
    entry.posY = posY;
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
        .map((id) => charactersByLocationId.get(id)?.name || `#${id}`)
        .filter(Boolean);
    const visibleOrderLabels = orderLabels.length
        ? orderLabels
        : Array.from(new Set((combatState.characters || []).map((char) => char.name || 'Unknown')));
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
            <div style="font-weight:700; font-size:15px;">Бой</div>
            <div style="font-size:12px; opacity:0.75;">перетащи меня</div>
        </div>
        <div style="padding:12px 14px; font-size:13px; line-height:1.45;">
            <div>Статус: <strong>${combatState.status || 'idle'}</strong></div>
            <div>Раунд: <strong>${combatState.round_number || 0}</strong></div>
            <div>Ход: <strong>${combatState.current_character?.name || 'нет'}</strong></div>
            <div>ОД: ${combatState.current_character?.action_points_current ?? 0}/${combatState.current_character?.action_points_max ?? 0}</div>
            <div>СД: ${combatState.current_character?.free_actions_current ?? 0}/${combatState.current_character?.free_actions_max ?? 0}</div>
            <div>ОП: ${combatState.current_character?.movement_points_current ?? 0}/${combatState.current_character?.movement_points_max ?? 0}</div>
            <div style="margin-top:8px; opacity:0.85;">Порядок: ${visibleOrderLabels.join(' -> ') || 'пусто'}</div>
            ${pendingCombatAction ? `<div style="margin-top:8px; padding:8px 10px; border-radius:10px; background: rgba(255,255,255,0.06);"><strong>Выбор цели:</strong> ${pendingCombatAction.actionKey || 'action'}</div>` : ''}
            <div style="margin-top:10px;">
                ${combatState.status !== 'active' && window.isGM ? '<button class="btn btn-sm btn-primary combat-start-btn" style="margin-top:8px;">Начать бой</button>' : ''}
                ${combatState.status === 'active' ? '<button class="btn btn-sm btn-secondary combat-end-turn-btn" style="margin-top:8px;">Закончить ход</button>' : ''}
                ${combatState.status === 'active' && window.isGM ? '<button class="btn btn-sm btn-danger combat-end-combat-btn" style="margin-top:8px; margin-left:6px;">Закончить бой</button>' : ''}
            </div>
            <div style="margin-top:8px; font-size:12px; opacity:0.75;">
                ${combatState.current_character && canActWithCombatCharacter(combatState.current_character) ? 'ПКМ по модели персонажа открывает боевое меню.' : 'Сейчас управление доступно только активному персонажу.'}
            </div>
        </div>
    `;
    ensureCombatHudDragging();
    const startBtn = combatHud.querySelector('.combat-start-btn');
    if (startBtn) {
        startBtn.onclick = async () => {
            startBtn.disabled = true;
            try {
                await Server.startLocationCombat(window.currentLobbyId, getCurrentLocationId());
            } catch (error) {
                showNotification(error.message || 'Не удалось начать бой');
            } finally {
                startBtn.disabled = false;
            }
        };
    }
    const endTurnBtn = combatHud.querySelector('.combat-end-turn-btn');
    if (endTurnBtn) {
        endTurnBtn.onclick = async () => {
            endTurnBtn.disabled = true;
            try {
                await Server.endLocationCombatTurn(
                    window.currentLobbyId,
                    getCurrentLocationId(),
                    combatState.current_character?.location_character_id || null
                );
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
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

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
    function animate() {
        animationFrameId = requestAnimationFrame(animate);
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
    return [...new Set(actions)];
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
    return actionKey;
}

function getStructureActionIcon(actionKey) {
    if (actionKey === 'toggle_door') return '🚪';
    if (actionKey === 'open_container') return '↑';
    if (actionKey === 'move') return '⤢';
    if (actionKey === 'rotate') return '↻';
    if (actionKey === 'climb') return '↑';
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
    const cacheKey = `${movementMapVersion}:${currentLocationId || ''}:${movingCharacterId ?? ''}`;
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
        const ignoreId = String(movingCharacterId ?? '');
        characterModels.forEach((entry, characterId) => {
            if (String(characterId) === ignoreId) return;
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
    if (targetProfile.climbCost > 0) return null;

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
            }

            const tileProfile = getTileMovementProfile(nx, ny, movingCharacterId);
            if (nx === endX && ny === endY && tileProfile.climbCost > 0) continue;
            if (tileProfile.blocked && tileProfile.climbCost === 0) continue;

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
    showNotification('Наведи на структуру и выбери действие', 'system');
    renderCombatHud();
    return true;
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
    const actions = [{ label: 'Осмотреть', action: () => showNotification(object.name || object.type, 'system') }];
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
        const obj = getCharacterAtScreen(e.clientX, e.clientY);
        if (!obj) return;
        const charId = obj.userData.characterId;
        if (!charId) return;
        const entry = characterModels.get(charId);
        if (!entry) return;
        if (pendingCombatAction) {
            e.preventDefault();
            e.stopPropagation();
            resolveCombatTargetSelection(charId);
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
        if (e.key !== 'Escape') return;
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
        armedMoveCharacterId = null;
        clearMovementPreview();
    };
    document.addEventListener('keydown', onKeyDown);
    handlers.document.keydown = onKeyDown;
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
            ${window.isGM ? '<button type="button" class="container-add-item-btn btn btn-secondary btn-sm">Добавить предмет</button>' : ''}
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

        const containerItems = getContainerItems(object);
        const containerEntries = getContainerTransferEntries(containerItems);
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
                ${window.isGM ? '<button type="button" class="btn btn-sm btn-secondary container-add-item-btn">Добавить</button>' : ''}
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

        if (!containerEntries.length) {
            targetList.innerHTML = '<div style="opacity:0.75;">Пусто</div>';
        } else {
            containerEntries.forEach((entry) => {
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
                    const containerRoot = { contents: [...containerItems] };
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
        }

        const addBtn = rightPanel.querySelector('.container-add-item-btn');
        if (addBtn) {
            addBtn.onclick = async () => {
                const templates = window.getAllItemTemplates ? await window.getAllItemTemplates() : [];
                if (!templates.length) {
                    showNotification('Не удалось загрузить шаблоны предметов', 'system');
                    return;
                }
                const picker = document.createElement('select');
                picker.className = 'form-control';
                picker.style.margin = '0 12px 12px';
                picker.innerHTML = '<option value="">-- Выберите предмет --</option>';
                templates.forEach((template) => {
                    const option = document.createElement('option');
                    option.value = template.id;
                    option.textContent = `${template.name || template.id} (${template.category || 'item'})`;
                    picker.appendChild(option);
                });
                targetList.prepend(picker);
                picker.onchange = async () => {
                    const template = templates.find((item) => String(item.id) === String(picker.value));
                    if (!template) return;
                    const newItem = {
                        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        templateId: template.id,
                        type: template.subcategory || template.category || 'item',
                        category: template.category || 'item',
                        name: template.name || 'Новый предмет',
                        quantity: 1,
                        weight: template.effectiveWeight ?? template.weight ?? 0,
                        volume: template.effectiveVolume ?? template.volume ?? 0,
                        contents: [],
                        attributes: template.attributes ? { ...template.attributes } : {},
                    };
                    const updatedContents = [...containerItems, newItem];
                    await Server.updateLocationObject(window.currentLobbyId, object.id, { properties: { contents: updatedContents } });
                    object.properties = { ...(object.properties || {}), contents: updatedContents };
                    showNotification('Предмет добавлен в контейнер', 'success');
                    await showContainerInteractionMenu(object);
                };
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
