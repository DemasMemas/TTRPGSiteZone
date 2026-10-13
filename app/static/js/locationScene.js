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
import { createDeferredActionResumer } from './deferredCombatActions.js';
import { createAnomalyEffect, animateAnomalyEffects } from './anomalies.js';
import { createMutantModel } from './mutantModels.js';
import { anomalyCoversTile } from './locationAnomalyArea.js';
import { createFpsCounter } from './fpsCounter.js';
import { horizontalCameraAxes, isTypingTarget } from './cameraPan.js';
import { createWaterMaterial } from './waterSurface.js';
import {
    buildFloorGridData, buildFogSurfaceData, buildSmoothTerrainData, buildTerrainGridData,
    createTerrainSurfaceHeightSampler, isSmoothTerrainTile,
    waterSurfaceAdjustments,
} from './locationTerrain.js';
import { DEFAULT_LOCATION_LIGHTING, resolveLocationLighting } from './locationLighting.js';
import { findLocationAsset } from './locationAssetCatalog.js';
import { placementForLocationAsset, visualAssetForLocationObject } from './locationAssetVariants.js';
import {
    alignLocationPbrFloorUvs, applyLocationPbrMaterial, releaseLocationPbrMaterial,
    tileLocationPbrBoxUvs,
} from './locationPbrMaterials.js';
import {
    bearingFromDelta, bearingToObjectRotation, clampAssetElevation, objectRotationToBearing,
    rotatePointAround,
} from './locationAssetTransforms.js';
import { createSecondaryDragGuard } from './locationEditorPointer.js';
import { doorOnWall, doorFrameStyle, floorVisualPose, wallVisualPlan } from './locationArchitecture.js';
import { applyInteriorFloorShade, createRoofGeometry, createRoofGableGeometry, roofPlans, roofVisibleForCamera } from './locationRoof.js';
import { createLocationTerrainPixels, updateLocationTerrainPixels } from './locationTerrainTexture.js';
import { computeDarknessFactors, lightPathOpen } from './locationDarkness.js';
import { applySurfaceDarkness, writeDarknessPixels } from './locationDarknessSurface.js';
import { applySurfacePattern, getSurfaceTexture } from './locationTerrainDetail.js';
import { createGrassDetailGroup } from './locationGrassDetail.js';
import { buildRoundedWaterData, classifyWaterRegions, waterLevelForTile } from './locationWaterEdge.js';
import { createWaterDetailGroup } from './locationWaterDetail.js';
import { createCrateModel, createFenceModel, createShelfModel, createTentModel } from './locationSimpleModels.js';
import {
    clearUnusedLocationModels, isSharedLocationModelGeometry, mountLocationModel, releaseLocationModel,
} from './locationModelAssets.js';
import { animateFireObjectModels, createFireObjectModel, fireLightSource, getFireLightSources, isFireObject } from './locationFire.js';
import { createElectricFixtureModel, electricFixtureLightSource, isElectricFixture } from './locationFixtures.js';
import { getAnomalyLightSources } from './locationAnomalyLight.js';
import { MAX_ANOMALY_RENDER_LIGHTS, selectAnomalyRenderLights } from './locationAnomalyRenderLights.js';
import { createSceneProfiler } from './sceneProfiler.js';
import { isWorldDarkTime } from './darknessRules.js';
import {
    assetDimensions, baseAssetDimensions, resizedAxis, resizedUniformDimensions, validAssetDimensions,
} from './locationAssetDimensions.js';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    })[character]);
}

const NARRATIVE_SKILLS = [
    ['skills.physical.strength', 'Сила'],
    ['skills.physical.agility', 'Ловкость'],
    ['skills.physical.will', 'Воля'],
    ['skills.physical.awareness', 'Внимательность'],
    ['skills.physical.melee', 'Ближний бой'],
    ['skills.physical.shooting', 'Стрельба'],
    ['skills.social.charisma', 'Харизма'],
    ['skills.social.barter', 'Бартер'],
    ['skills.social.persuasion', 'Убеждение'],
    ['skills.social.deception', 'Обман'],
    ['skills.social.intimidation', 'Устрашение'],
    ['skills.other.medicine', 'Медицина'],
    ['skills.other.engineering', 'Инженерия'],
    ['skills.other.stealth', 'Скрытность'],
    ['skills.other.tactics', 'Тактика'],
    ['skills.other.survival', 'Выживание'],
];
const AWARENESS_SKILL_PATH = 'skills.physical.awareness';

function activeConsumableModifier(data, stat) {
    const modifiers = data?.health?.combatMeta?.consumableModifiers;
    if (!Array.isArray(modifiers)) return 0;
    return modifiers.reduce((total, modifier) => {
        if (!modifier || ![stat, `${stat}_delta`].includes(String(modifier.stat || ''))) return total;
        if (modifier.remaining !== null && modifier.remaining !== undefined && Number(modifier.remaining) <= 0) return total;
        return total + (Number(modifier.value) || 0);
    }, 0);
}

function characterDeafness(data) {
    const health = data?.health || {};
    const values = [Number(health.deafness) || 0];
    const psyState = Math.max(0, Number(health.psyState ?? health.psy_state) || 0);
    if (psyState >= 40) values.push(100);
    else if (psyState >= 20) values.push(50);
    (Array.isArray(health.effects) ? health.effects : []).forEach(effect => {
        if (effect?.active !== false && String(effect?.type || '').toLowerCase() === 'deafness') {
            values.push(Number(effect.value) || 0);
        }
    });
    return Math.max(0, ...values);
}

function signedModifier(value) {
    const number = Number(value) || 0;
    return `${number >= 0 ? '+' : ''}${number}`;
}

function awarenessModePath(form) {
    const skillPath = form?.elements?.skill_path?.value;
    if (skillPath !== AWARENESS_SKILL_PATH) return skillPath;
    const mode = form.elements.awareness_mode?.value === 'hearing' ? 'hearing' : 'visual';
    return `${AWARENESS_SKILL_PATH}.${mode}`;
}

function awarenessModeRowHtml() {
    return `
        <label data-awareness-mode-row style="display:none;gap:5px;margin-top:8px;">
            <span>Вид проверки Внимательности</span>
            <select name="awareness_mode" class="form-control">
                <option value="visual">Зрение</option>
                <option value="hearing">Слух</option>
            </select>
            <small data-awareness-mode-note style="opacity:.72;line-height:1.35;">
                Общие состояния и бонус навыка рассчитываются сервером.
            </small>
        </label>`;
}

function bindAwarenessMode(form, getCharacterId) {
    const skillInput = form?.elements?.skill_path;
    const modeInput = form?.elements?.awareness_mode;
    const row = form?.querySelector?.('[data-awareness-mode-row]');
    const note = form?.querySelector?.('[data-awareness-mode-note]');
    if (!skillInput || !modeInput || !row) return;
    let requestVersion = 0;

    const updateProfile = async () => {
        const visible = skillInput.value === AWARENESS_SKILL_PATH && !skillInput.disabled;
        row.style.display = visible ? 'grid' : 'none';
        modeInput.disabled = !visible;
        if (!visible) return;
        const version = ++requestVersion;
        const characterId = Number(getCharacterId?.());
        if (!Number.isFinite(characterId)) return;
        try {
            const character = await Server.getCharacter(characterId);
            if (version !== requestVersion || skillInput.value !== AWARENESS_SKILL_PATH) return;
            const data = character?.data || {};
            const headphones = Number(
                data.equipment?.headphones?.awarenessBonus
                ?? data.equipment?.headphones?.awareness_bonus,
            ) || 0;
            const vision = activeConsumableModifier(data, 'vision_awareness');
            const deafness = characterDeafness(data);
            const visualParts = [
                vision ? `препараты ${signedModifier(vision)}` : '',
            ].filter(Boolean);
            const hearingParts = [
                headphones ? `наушники ${signedModifier(headphones)}` : '',
            ].filter(Boolean);
            modeInput.options[0].textContent = `Зрение: ${signedModifier(vision)}${visualParts.length ? ` (${visualParts.join(', ')})` : ''}`;
            modeInput.options[1].textContent = deafness >= 90
                ? `Слух: невозможно (глухота ${deafness})`
                : `Слух: ${signedModifier(headphones)}${hearingParts.length ? ` (${hearingParts.join(', ')})` : ''}${deafness ? `, глухота ${deafness}` : ''}`;
            modeInput.options[1].disabled = deafness >= 90;
            if (modeInput.options[1].disabled && modeInput.value === 'hearing') {
                modeInput.value = 'visual';
            }
            if (note) {
                note.textContent = 'Указаны отдельные модификаторы канала. Бонус навыка и общие состояния добавит сервер.';
            }
        } catch (error) {
            if (note && version === requestVersion) {
                note.textContent = 'Не удалось загрузить модификаторы; итог всё равно рассчитает сервер.';
            }
        }
    };

    skillInput.addEventListener('change', updateProfile);
    updateProfile();
    return updateProfile;
}

// ========== Глобальные переменные ==========
let scene, camera, renderer, labelRenderer, controls;
let currentLocationId = null;
let currentLocationData = null;
let locationAmbientLight = null;
let locationDirectionalLight = null;
let locationLightGroup = null;
let anomalyRenderSources = [];
let anomalyRenderPool = [];
let lastAnomalyLightUpdateAt = -Infinity;
let locationProfiler = null;
let locationDarknessFactors = null;
let locationDarknessTexture = null;
let activeLightingProfile = null;
let selectedLocationAsset = null;
let editorSelection = null;
let editorMoveMode = false;
let editorMovePreviewPoint = null;
let editorRotateMode = false;
let editorRotateAngle = 0;
let editorGroupRotatePivot = null;
let editorGroupRotateStartBearing = null;
let editorGroupRotateWithPivot = false;
let editorResizeMode = false;
let editorResizeAxis = 'all';
let editorResizeDimensions = null;
let editorResizeBaseDimensions = null;
let editorResizeAnchor = null;
const cameraDragMenuGuard = createSecondaryDragGuard();
let editorSelectionRing = null;
let editorSelections = [];
let lampEditPending = false;
let tileCubes = [];
let locationTileMesh = null;
let waterTileMesh = null;
let waterSurfaceMesh = null;
let waterBankMesh = null;
let sandBankMesh = null;
let waterDetailGroup = null;
let waterRegions = new Map();
const WATER_SIDE_COLORS = { grass: 0x183c4a, swamp: 0x244c3b, sand: 0x76603a, rock: 0x5b5b50 };
let smoothTerrainMesh = null;
let terrainSurfaceMesh = null;
let terrainSurfaceTexture = null;
let locationGridMesh = null;
let grassDetailGroup = null;
let locationGridVisible = false;
let darknessEditorOverlay = null;
let darknessOverlayRequested = false;
let fogMemoryKey = null;
let fogMemory = new Map();
let fogMemoryGhosts = new Map();
let fogMemoryDecorationTemplates = new Map();
const fogOverlayMeshes = new Map();
let fogSurfaceData = null;
let visionBlockerHeightCache = null;
let gmVisionCharacterId = null;
const tileInstanceTransform = new THREE.Object3D();
let objectMeshes = [];
let anomalyEffectMeshes = [];
let combatAreaMeshes = [];
let locationObjectMeshes = [];
let roofMeshes = [];
let locationRoofsVisible = true;
let groundPlaneMesh;
let characterModels = new Map();
const characterVisibilityOverrides = new Map();
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
let pendingCharacterPlacement = null;
let pendingCharacterPlacementQueue = [];
let highlightBox = null;
let locationActive = false;
let eventCleanup = null;
let processedTilesForObjects = new Set();
let lastHighlightCoords = null;
window.locationEditMode = false;
let animationFrameId = null;
let locationFpsCounter = null;
const FOG_VIEW_RADIUS = 25;
const FOG_VIEW_HALF_ANGLE = Math.PI / 3;
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
let autoEndingBlockedTurn = false;
const deferredCombatActions = new Map();
let structureActionMenu = null;
let structureActionMenuState = null;
let structureRotationMenu = null;
let structureRotationMenuState = null;
let pendingStructureAction = null;
let containerInteractionMenu = null;
let containerInteractionState = null;
let containerExchangeTarget = null;
let containerInteractionRefresh = null;
let containerInteractionDragState = null;
let medicalConsumableMenu = null;
let medicalConsumableMenuState = null;
let medicalConsumableDragState = null;
let characterTradeModal = null;
const pendingCharacterInteractionResolvers = new Map();
let armedMoveCharacterId = null;
let armedMovementType = null;
let armedMovementEvasion = false;
let movementTypeMenu = null;
let postureMenu = null;
let facingMenu = null;
let pendingFacingSelection = null;
let facingPreviewMesh = null;
let combatParticipantMenu = null;
let combatStartRequestMenu = null;
const pendingCombatStartRequests = new Map();
let combatStartRequestVersion = 0;
let teamManagementModal = null;
let opportunityAttackModal = null;
let activeOpportunityAttackId = null;
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
    backward_sideways: {
        label: 'Спиной / боком',
        icon: '↙',
        maxDistance: 5,
        divisor: 0.5,
        actionPoints: 0,
        freeActions: 0,
        summary: 'До 5 м · 1 м = 2 ОП · без разворота',
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
        icon: '⚡',
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
let buildPreviewKey = null;
const structureDeletionInFlight = new Set();
let pendingObjectMoveId = null;
let hoveredStructureObjectId = null;

const objectInteractions = {
    door: ['toggle_door'],
    window: ['toggle_door'],
    shelf: ['open_container'],
    chest: ['open_container', 'climb'],
    corpse: ['open_container'],
    table: ['move', 'climb'],
    chair: ['move', 'climb'],
    box: ['open_container', 'move', 'climb'],
    military_crate: ['open_container', 'move', 'climb'],
    barrel: ['move'],
    fence: ['climb'],
    campfire: ['toggle_fire'],
    torch: ['toggle_fire'],
    wall_torch: ['toggle_fire'],
    fire_barrel: ['toggle_fire'],
};

const interactionRequirements = {
    toggle_door: { requires_actor: true, max_distance: 1, checks: ['locked'] },
    open_container: { requires_actor: true, max_distance: 1, checks: ['locked', 'search'] },
    move: { requires_actor: true, max_distance: 1, checks: ['strength', 'weight'] },
    climb: { requires_actor: true, max_distance: 1, checks: ['athletics'] },
    toggle_fire: { requires_actor: true, max_distance: 1, checks: [] },
};

const LOW_CLIMB_OBJECT_TYPES = new Set(['table', 'chair', 'chest', 'box', 'military_crate', 'barrier']);
const HIGH_CLIMB_OBJECT_TYPES = new Set(['fence']);
const TOO_HIGH_OBJECT_TYPES = new Set(['tree', 'rock', 'house', 'tent', 'wall', 'shelf']);
const PASSABLE_OBJECT_TYPES = new Set(['campfire', 'torch', 'wall_torch', 'fire_barrel',
    'ceiling_bulb', 'wall_bulb', 'ground_item', 'anomaly', 'poster', 'floor']);
const THROWABLE_OBJECT_WEIGHTS = {
    chair: 5,
    box: 10,
    military_crate: 18,
    chest: 15,
    table: 25,
    barrel: 40,
};
const ANOMALY_VISUAL_BY_KEY = {
    batut: 'void', otboynik: 'void', kacheli: 'void', zybuchka: 'void', vozduhovorot: 'void', glukhar: 'void', britva: 'void', viselitsa: 'void',
    vspishka: 'electric', pautina: 'electric', tesla: 'electric', katushka: 'electric', kapkan: 'electric', paralizator: 'electric', akkumulyator: 'electric', ionny_tuman: 'electric',
    banya: 'fire', parilka: 'fire', mochalka: 'fire', kipyatilnik: 'fire', morozilnik: 'fire', uley: 'fire', metelitsa: 'fire', gril: 'fire',
    zarosli: 'radiation', svetlyachki: 'radiation', mor: 'radiation', zapovednik: 'radiation', mertvy_koster: 'radiation', solyariy: 'radiation', radioaktivny_roy: 'radiation', bagrovaya_luna: 'radiation',
    varevo: 'acid', soda: 'acid', ezhinoe_oblako: 'acid', rzhavchina: 'acid', mogilshchik: 'acid', chuma: 'acid', myshelovka: 'acid', gniloy_razlom: 'acid',
    ekho: 'psi', mirazh: 'psi', starshina: 'psi', tuman_poteryannykh: 'psi', tma: 'psi', piyavka: 'psi', kolodets: 'psi', mozgotrobilka: 'psi',
};
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
const terrainGridColors = {
    grass: new THREE.Color(0xaac27c),
    sand: new THREE.Color(0x524b33),
    rock: new THREE.Color(0x3c4140),
    swamp: new THREE.Color(0xb49d83),
    water: new THREE.Color(0xb3d2df),
};
const floorGridColor = new THREE.Color(0xc5c0b3);

// ========== Вспомогательные функции ==========
function isKeyboardInputTarget(target) {
    return isTypingTarget(target);
}

function updateLocationCameraMovement(deltaSeconds) {
    if (!locationActive || !camera || !controls || locationCameraKeys.size === 0) return;
    const { forward, right } = horizontalCameraAxes(THREE, camera);
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
    releaseLocationModel(obj);
    if (obj.isLight && obj.shadow?.map) obj.shadow.map.dispose();
    if (obj.geometry && !isSharedLocationModelGeometry(obj.geometry)) obj.geometry.dispose();
    if (obj.material) {
        if (Array.isArray(obj.material)) {
            obj.material.forEach(mat => { releaseLocationPbrMaterial(mat); mat.dispose(); });
        } else {
            releaseLocationPbrMaterial(obj.material);
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

export function showCombatExplosion(payload) {
    if (!scene) return;
    const details = payload?.explosive || payload;
    const explosion = details?.explosion || {};
    const impact = details?.impact || explosion?.epicenter;
    if (!impact || !Number.isFinite(Number(impact.x)) || !Number.isFinite(Number(impact.y))) return;
    const radius = Math.max(0.75, Number(explosion.radius) || 1);
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.72, 1, 64),
        new THREE.MeshBasicMaterial({
            color: 0xff8a2b,
            transparent: true,
            opacity: 0.9,
            side: THREE.DoubleSide,
            depthWrite: false,
        }),
    );
    ring.rotation.x = -Math.PI / 2;
    const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 16, 12),
        new THREE.MeshBasicMaterial({
            color: 0xffd36a,
            transparent: true,
            opacity: 1,
            depthWrite: false,
        }),
    );
    core.position.y = 0.32;
    group.add(ring, core);
    group.position.set(
        Number(impact.x) + 0.5,
        getTileHeight(Number(impact.x), Number(impact.y)) + 0.05,
        Number(impact.y) + 0.5,
    );
    scene.add(group);
    const startedAt = performance.now();
    const duration = 750;
    const animate = (now) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const scale = 0.1 + radius * eased;
        ring.scale.setScalar(scale);
        ring.material.opacity = 0.9 * (1 - progress);
        core.scale.setScalar(1 + eased * 4);
        core.material.opacity = 1 - progress;
        if (progress < 1 && scene) {
            requestAnimationFrame(animate);
            return;
        }
        scene?.remove(group);
        ring.geometry.dispose();
        ring.material.dispose();
        core.geometry.dispose();
        core.material.dispose();
    };
    requestAnimationFrame(animate);
}

function syncCombatAreaVisuals(state) {
    combatAreaMeshes.forEach((mesh) => {
        scene?.remove(mesh);
        disposeObject(mesh);
    });
    combatAreaMeshes = [];
    if (!scene || state?.status !== 'active') return;

    (state.area_effects || []).forEach((area) => {
        const radius = Math.max(0.2, Number(area.radius) || 0);
        const type = String(area.type || '');
        const color = type.startsWith('smoke')
            ? 0x727872
            : (type === 'gas' ? 0x879c43 : 0xe46d24);
        const height = type.startsWith('smoke') ? 2.4 : 0.35;
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, height, 48),
            new THREE.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: type.startsWith('smoke') ? 0.42 : 0.3,
                depthWrite: false,
                side: THREE.DoubleSide,
            }),
        );
        mesh.position.set(
            Number(area.x) + 0.5,
            getTileHeight(Number(area.x), Number(area.y)) + height / 2 + 0.04,
            Number(area.y) + 0.5,
        );
        mesh.userData.combatArea = area;
        scene.add(mesh);
        combatAreaMeshes.push(mesh);
    });

    (state.pending_explosives || []).forEach((event) => {
        const marker = new THREE.Mesh(
            new THREE.RingGeometry(0.18, 0.28, 32),
            new THREE.MeshBasicMaterial({
                color: 0xffb02e,
                transparent: true,
                opacity: 0.85,
                depthWrite: false,
                side: THREE.DoubleSide,
            }),
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(
            Number(event.x) + 0.5,
            getTileHeight(Number(event.x), Number(event.y)) + 0.08,
            Number(event.y) + 0.5,
        );
        scene.add(marker);
        combatAreaMeshes.push(marker);
    });
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

    let routePath = path.path;
    if (combatState?.status === 'active') {
        const anomalies = [];
        currentLocationData?.tiles_data?.forEach((row, originY) => row?.forEach((tile, originX) => {
            tile?.objects?.forEach(object => {
                if ((object?.type || object?.object_type) === 'anomaly'
                    && (window.isGM || !object.gm_hidden)) {
                    anomalies.push([object, originX, originY]);
                }
            });
        }));
        currentLocationData?.objects?.forEach(object => {
            if ((object?.type || object?.object_type) === 'anomaly'
                && (window.isGM || !object.properties?.gm_hidden)) {
                anomalies.push([object, object.tile_x, object.tile_y]);
            }
        });
        const anomalyIndex = routePath.findIndex(([x, y], index) => (
            index > 0 && anomalies.some(([object, originX, originY]) => (
                anomalyCoversTile(object, originX, originY, x, y)
            ))
        ));
        if (anomalyIndex > 0) routePath = routePath.slice(0, anomalyIndex + 1);
    }

    const points = [];
    const pushPoint = (x, y, z) => {
        const last = points[points.length - 1];
        if (!last || last.x !== x || last.y !== y || last.z !== z) {
            points.push(new THREE.Vector3(x, y, z));
        }
    };

    routePath.forEach(([x, y]) => {
        pushPoint(x + 0.5, getTileHeight(x, y) + 0.4, y + 0.5);
    });

    const climbCost = routePath.slice(1).reduce((sum, [x, y]) => {
        const profile = getTileMovementProfile(x, y, movingCharacterId);
        return sum + Math.max(0, Number(profile.climbCost) || 0);
    }, 0);
    return {
        points,
        path: routePath,
        cost: routePath.slice(1).reduce((sum, [x, y]) => {
            const profile = getTileMovementProfile(x, y, movingCharacterId);
            return sum + 1 + Math.max(0, Number(profile.climbCost) || 0);
        }, 0),
        climbCost,
        distance: Math.max(0, routePath.length - 1),
        trappedByAnomaly: routePath.length < path.path.length,
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

function getMovementModeAvailability(movementType, route = null, evasion = armedMovementEvasion) {
    const mode = COMBAT_MOVEMENT_TYPES[movementType] || COMBAT_MOVEMENT_TYPES.walk;
    const current = combatState?.current_character || {};
    const posture = current.posture || 'standing';
    const postureProfile = current.posture_modifiers || {};
    const baseMaxDistance = movementType === 'walk'
        ? Number(postureProfile.walk_max_distance) || COMBAT_POSTURES[posture]?.walkMaxDistance || mode.maxDistance
        : mode.maxDistance;
    const round = Math.max(1, Number(combatState?.round_number) || 1);
    const usedMode = current.movement_mode_this_turn || null;
    const evading = usedMode ? Boolean(current.movement_evasion) : evasion;
    const evasionReduction = evading ? ({ walk: 3, run: 5, sprint: 7 }[movementType] || 0) : 0;
    const maxDistance = Math.max(0, baseMaxDistance - evasionReduction);
    const selectingMode = !usedMode;
    const modeActionPoints = selectingMode ? mode.actionPoints : 0;
    const modeFreeActions = selectingMode ? mode.freeActions : 0;
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
        && (Number(current.action_points_current) || 0) >= modeActionPoints + climbActionPoints
    );
    let reason = '';
    const routeMovesForward = movementType === 'backward_sideways'
        && Array.isArray(route?.path)
        && route.path.slice(1).some((tile, index) => {
            const previous = route.path[index];
            const stepX = Number(tile?.[0]) - Number(previous?.[0]);
            const stepY = Number(tile?.[1]) - Number(previous?.[1]);
            const facingX = Number(current.facing_x) || 0;
            const facingY = Number(current.facing_y) || 1;
            return stepX * facingX + stepY * facingY > 0;
        });

    if (evading && !['walk', 'run', 'sprint'].includes(movementType)) {
        reason = 'Уклонение доступно при ходьбе, беге и спринте';
    } else if (routeMovesForward) {
        reason = 'Этот режим допускает только шаги спиной или боком';
    } else if (usedMode && usedMode !== movementType) {
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
        && !usedMode
        && (Number(current.strenuous_movement_blocked_until_round) || 0) > 0
        && round <= (Number(current.strenuous_movement_blocked_until_round) || 0)
    ) {
        reason = 'Бег и спринт недоступны из-за одышки';
    } else if ((Number(current.action_points_current) || 0) < modeActionPoints) {
        reason = `Нужно ${modeActionPoints} ОД`;
    } else if ((Number(current.free_actions_current) || 0) < modeFreeActions) {
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
        modeActionPoints,
        modeFreeActions,
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
        ? `${movementMode.label}: ${availability.distance} м · ${costLabel}${availability.reason ? ` · ${availability.reason}` : ''}`
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
    if (
        pendingCombatAction.actionKey === 'attack'
        && pendingCombatAction.targetType === 'character'
        && !targetObj
    ) {
        const structure = getLocationObjectAtScreen(clientX, clientY);
        if (structure?.userData?.locationObject) {
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
            structure.getWorldPosition(end);
            end.y += Math.max(0.25, getObjectTraversalHeight(
                structure.userData.locationObject
            ) / 2);
            attackPreviewLine.geometry.setFromPoints([start, end]);
            return;
        }
    }
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
            evasion: combatState?.current_character?.movement_mode_this_turn
                ? Boolean(combatState.current_character.movement_evasion) : armedMovementEvasion,
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
        if (entry.model.visible) models.push(entry.model);
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

function canTakeCombatTurn(combatCharacter) {
    const condition = combatCharacter?.condition || {};
    return Boolean(
        condition.can_act
        || (condition.state === 'pain_shock' && condition.can_recover)
    );
}

async function autoEndBlockedCombatTurn() {
    const current = combatState?.current_character;
    if (
        autoEndingBlockedTurn
        || !window.isGM
        || combatState?.status !== 'active'
        || !current
        || canTakeCombatTurn(current)
    ) {
        return;
    }
    autoEndingBlockedTurn = true;
    try {
        await Server.endLocationCombatTurn(
            window.currentLobbyId,
            getCurrentLocationId(),
            current.location_character_id,
        );
    } catch (error) {
        showNotification(error.message || 'Не удалось автоматически завершить недоступный ход');
    } finally {
        autoEndingBlockedTurn = false;
    }
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
    closeFacingMenu();
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

async function requestTreatmentConsent(actorLocationCharacterId, targetCharacterId, procedure) {
    const requestData = await Server.createCharacterInteraction(
        window.currentLobbyId,
        getCurrentLocationId(),
        {
            actor_location_character_id: actorLocationCharacterId,
            target_character_id: targetCharacterId,
            kind: 'treatment',
            payload: { procedure },
        },
    );
    if (['accepted', 'forced'].includes(requestData.status)) {
        return { allowed: true, requestId: requestData.id, status: requestData.status };
    }
    if (requestData.status !== 'pending') {
        return { allowed: false, requestId: requestData.id, status: requestData.status };
    }
    const gmDecision = Boolean(requestData.payload?.gm_decision_for_offline_target);
    showNotification(gmDecision
        ? 'Игрок пациента не в сети. Ожидаем решения ГМа'
        : 'Ожидаем согласия персонажа на лечение', 'system');
    return new Promise((resolve) => {
        const notice = document.createElement('div');
        notice.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:1310;max-width:340px;padding:12px 14px;border:1px solid rgba(255,255,255,.2);border-radius:12px;background:#19231d;color:#f0f5ef;box-shadow:0 12px 32px rgba(0,0,0,.35);display:grid;gap:10px;';
        const label = document.createElement('span');
        label.textContent = gmDecision ? 'Ожидаем решения ГМа по лечению' : 'Ожидаем согласия на лечение';
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'btn btn-secondary';
        cancelButton.textContent = 'Отменить ожидание';
        notice.append(label, cancelButton);
        document.body.appendChild(notice);
        let settled = false;
        let timer;
        const settle = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            pendingCharacterInteractionResolvers.delete(requestData.id);
            notice.remove();
            resolve(result);
        };
        const cancel = (timedOut = false) => {
            if (settled) return;
            cancelButton.disabled = true;
            if (characterTradeModal?.dataset.interactionRequestId === String(requestData.id)) {
                characterTradeModal.style.display = 'none';
            }
            settle({ allowed: false, requestId: requestData.id, status: 'cancelled' });
            if (timedOut) showNotification('Время ожидания согласия истекло', 'system');
            Server.cancelCharacterInteraction(window.currentLobbyId, requestData.id).catch(error => {
                showNotification(error.message || 'Не удалось отменить запрос на сервере', 'system');
            });
        };
        cancelButton.onclick = () => cancel();
        pendingCharacterInteractionResolvers.set(requestData.id, settle);
        timer = setTimeout(() => cancel(true), 90_000);
        if (gmDecision && Number(requestData.target_user_id) === getCurrentUserId()) {
            showIncomingCharacterInteraction(requestData).catch(error => {
                showNotification(error.message || 'Не удалось открыть запрос ГМу', 'system');
            });
        }
    });
}

async function applyQuickMedicalConsumable(characterId, entry, targetCharacterId, actorLocationCharacterIdHint = null) {
    if (!canControlCharacter(characterId) || getLocationCharacterCondition(characterId).state !== 'active') {
        throw new Error('Этот персонаж сейчас не может применить предмет');
    }
    const module = await import('./characterSheet.js');
    const isOtherTarget = targetCharacterId && Number(targetCharacterId) !== Number(characterId);
    const actorLocationCharacterId = actorLocationCharacterIdHint
        || findCombatCharacterByCharacterId(characterId)?.location_character_id;
    if (isOtherTarget && !actorLocationCharacterId) {
        throw new Error('Не удалось найти врача на локации');
    }
    const interactionTarget = isOtherTarget
        ? await Server.inspectLocationCharacter(
            window.currentLobbyId, getCurrentLocationId(), targetCharacterId, actorLocationCharacterId
        )
        : null;
    return module.useCharacterInventoryItem(characterId, entry.path, {
        itemId: entry.item?.id,
        targetCharacterId: targetCharacterId || undefined,
        targetData: interactionTarget?.target_data,
        requestTreatmentConsent: isOtherTarget && getLocationCharacterCondition(targetCharacterId).state === 'active'
            ? procedure => requestTreatmentConsent(actorLocationCharacterId, targetCharacterId, procedure)
            : undefined,
        interactionContext: isOtherTarget ? {
            lobbyId: window.currentLobbyId,
            locationId: getCurrentLocationId(),
            actorLocationCharacterId,
        } : undefined,
    });
}

async function showMedicalConsumableMenu(characterId, forcedTargetCharacterId = null, actorLocationCharacterIdHint = null) {
    ensureMedicalConsumableMenu();
    medicalConsumableMenuState = { characterId };

    const character = await Server.getCharacter(characterId).catch(() => null);
    const actorLocationCharacterId = actorLocationCharacterIdHint
        || findCombatCharacterByCharacterId(characterId)?.location_character_id
        || pendingStructureAction?.actorLocationCharacterId;
    const characterData = character?.data || null;
    const consumables = characterData ? getMedicalConsumableEntries(characterData) : [];

    medicalConsumableMenu.innerHTML = `
        <div class="medical-menu-drag-handle" style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(255,255,255,0.08); cursor:move; user-select:none; touch-action:none;">
            <div style="font-weight:700;">Расходники</div>
            <button type="button" class="medical-close-btn" style="width:32px; height:32px; border-radius:999px; border:0; background:rgba(255,255,255,0.08); color:#fff; cursor:pointer; font-size:18px; line-height:1;">×</button>
        </div>
        <div style="padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.06); opacity:0.8; font-size:13px;">
            Быстрый список предметов для применения в бою и вне боя.
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
                    const direct = item.attributes?.consumable?.direct || {};
                    const needsTarget = direct.target_required
                        || direct.application_form === 'injectable'
                        || direct.requires_injury
                        || direct.wound_treatment
                        || direct.requires_infusion_tool;
                    if (needsTarget && !forcedTargetCharacterId) {
                        const choice = document.createElement('div');
                        choice.style.cssText = 'display:flex;gap:8px;margin:-2px 0 10px;';
                        choice.innerHTML = `
                            <button type="button" class="medical-target-self btn btn-sm btn-secondary">Себе</button>
                            <button type="button" class="medical-target-map btn btn-sm btn-secondary">Выбрать модель на карте</button>
                        `;
                        row.after(choice);
                        row.disabled = true;
                        choice.querySelector('.medical-target-self').onclick = async () => {
                            try {
                                closeMedicalConsumableMenu();
                                await applyQuickMedicalConsumable(
                                    characterId, entry, characterId, actorLocationCharacterId
                                );
                            } catch (error) {
                                showNotification(error.message || 'Не удалось использовать расходник', 'system');
                            } finally {
                                row.disabled = false;
                                choice.remove();
                            }
                        };
                        choice.querySelector('.medical-target-map').onclick = () => {
                            const started = beginPendingCombatAction({
                                actorCharacterId: characterId,
                                actorLocationCharacterId,
                                actionKey: 'use_item',
                                itemPath: entry.path,
                                itemId: item.id,
                                onResolve: ({ targetCharacterId }) => applyQuickMedicalConsumable(
                                    characterId, entry, targetCharacterId, actorLocationCharacterId
                                ),
                            });
                            if (started) closeMedicalConsumableMenu();
                            else {
                                row.disabled = false;
                                choice.remove();
                            }
                        };
                        return;
                    } else {
                        closeMedicalConsumableMenu();
                        await applyQuickMedicalConsumable(
                            characterId, entry, forcedTargetCharacterId, actorLocationCharacterId
                        );
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

function closeNarrativeActionModal() {
    document.getElementById('narrative-action-modal')?.remove();
}

function showNarrativeActionModal(characterId) {
    const actor = findCombatCharacterByCharacterId(characterId);
    if (!actor?.location_character_id || !isCurrentCombatTurnForCharacter(characterId)) {
        showNotification('Другое действие можно совершить только в свой ход', 'system');
        return;
    }
    closeNarrativeActionModal();
    const modal = document.createElement('div');
    modal.id = 'narrative-action-modal';
    modal.style.cssText = `
        position:fixed; inset:0; z-index:10060; display:flex; align-items:center;
        justify-content:center; padding:16px; background:rgba(0,0,0,.58);
    `;
    modal.innerHTML = `
        <form style="width:min(460px, 100%); background:#171b16; color:#e7e0cb; border:1px solid #625b42; border-radius:8px; padding:18px; box-shadow:0 18px 55px rgba(0,0,0,.58);">
            <h3 style="margin:0 0 14px;">Другое действие</h3>
            <label style="display:grid; gap:5px; margin-bottom:12px;">
                <span>Что делает персонаж</span>
                <input name="action_name" class="form-control" maxlength="200" required placeholder="Например: выбиваю дверь плечом">
            </label>
            <label style="display:grid; gap:5px; margin-bottom:12px; max-width:150px;">
                <span>Стоимость, ОД</span>
                <input name="action_points" class="form-control number-input" type="number" min="0" max="30" value="1" required>
            </label>
            <label style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
                <input name="roll_required" type="checkbox">
                <span>Требуется проверка навыка</span>
            </label>
            <div data-narrative-skill-row style="display:grid;grid-template-columns:1fr 120px;gap:10px;margin-bottom:16px;opacity:.45;">
            <label style="display:grid; gap:5px;">
                <span>Навык</span>
                <select name="skill_path" class="form-control" disabled>
                    ${NARRATIVE_SKILLS.map(([path, label]) => `<option value="${path}">${label}</option>`).join('')}
                </select>
            </label>
            <label style="display:grid; gap:5px;">
                <span>Сложность</span>
                <input name="difficulty" class="form-control number-input" type="number" min="1" max="40" value="10" disabled>
            </label>
            </div>
            ${awarenessModeRowHtml()}
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button type="button" class="btn btn-secondary" data-narrative-cancel>Отмена</button>
                <button type="submit" class="btn btn-primary">Выполнить</button>
            </div>
        </form>`;
    document.body.appendChild(modal);
    const form = modal.querySelector('form');
    const rollInput = form.elements.roll_required;
    const skillInput = form.elements.skill_path;
    const difficultyInput = form.elements.difficulty;
    const skillRow = modal.querySelector('[data-narrative-skill-row]');
    const updateAwarenessMode = bindAwarenessMode(form, () => characterId);
    rollInput.addEventListener('change', () => {
        skillInput.disabled = !rollInput.checked;
        difficultyInput.disabled = !rollInput.checked;
        skillRow.style.opacity = rollInput.checked ? '1' : '.45';
        updateAwarenessMode?.();
    });
    modal.querySelector('[data-narrative-cancel]').onclick = closeNarrativeActionModal;
    modal.addEventListener('pointerdown', event => {
        if (event.target === modal) closeNarrativeActionModal();
    });
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeNarrativeActionModal();
        }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const actionName = form.elements.action_name.value.trim();
        const actionPoints = Number.parseInt(form.elements.action_points.value, 10);
        if (!actionName || !Number.isInteger(actionPoints) || actionPoints < 0 || actionPoints > 30) {
            showNotification('Укажите название и стоимость от 0 до 30 ОД', 'system');
            return;
        }
        const actionId = `narrative-${actor.location_character_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const payload = {
            location_character_id: actor.location_character_id,
            action_key: 'narrative_action',
            action_points: actionPoints,
            narrative_action_name: actionName,
            narrative_roll_required: rollInput.checked,
            narrative_skill_path: rollInput.checked ? awarenessModePath(form) : null,
            narrative_difficulty: rollInput.checked ? Number.parseInt(difficultyInput.value, 10) : null,
            pending_action_id: actionId,
        };
        try {
            const result = await Server.performLocationCombatAction(
                window.currentLobbyId,
                getCurrentLocationId(),
                payload,
            );
            closeNarrativeActionModal();
            if (result?.pending_action) {
                deferredCombatActions.set(result.pending_action_id, payload);
                showNotification('Действие начато и завершится после полной оплаты ОД.', 'system');
                return;
            }
            const check = result?.narrative_action?.check;
            showNotification(
                check
                    ? `${actionName}: d20 ${check.roll}, итог ${check.total} против СЛ ${check.difficulty} — ${check.success ? 'успех' : 'провал'}`
                    : `${actionName}: затрачено ${actionPoints} ОД`,
                'success',
            );
        } catch (error) {
            showNotification(error.message || 'Не удалось выполнить действие', 'system');
        }
    });
    form.elements.action_name.focus();
}

function showReactionReserveMenu(character) {
    if (!character?.location_character_id) return;
    let modal = document.getElementById('combat-reaction-reserve-menu');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'combat-reaction-reserve-menu';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10060;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.48);';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
        <form style="width:min(420px,calc(100vw - 32px));padding:18px;border:1px solid rgba(255,255,255,.17);border-radius:14px;background:rgba(18,23,22,.98);color:#f4f1e8;box-shadow:0 20px 60px rgba(0,0,0,.55);">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><strong style="font-size:18px;">Реакция</strong><button type="button" class="reaction-close btn btn-sm btn-secondary">×</button></div>
            <div style="margin:8px 0 14px;font-size:12px;opacity:.76;">Отложенные ресурсы нельзя использовать в свой ход. В чужой ход вы запросите разрешение у ГМа.</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;">
                <label>ОД<input name="action_points" type="number" min="0" max="${character.action_points_current || 0}" value="0" style="width:100%;"></label>
                <label>СД<input name="free_actions" type="number" min="0" max="${character.free_actions_current || 0}" value="0" style="width:100%;"></label>
                <label>ОП<input name="movement_points" type="number" min="0" max="${character.movement_points_current || 0}" value="0" style="width:100%;"></label>
            </div>
            <label style="display:block;margin-top:12px;">Триггер<input name="trigger" type="text" maxlength="240" placeholder="Например: если враг выйдет из-за укрытия" style="width:100%;"></label>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:15px;">Отложить реакцию</button>
        </form>
    `;
    const form = modal.querySelector('form');
    modal.querySelector('.reaction-close').onclick = () => { modal.style.display = 'none'; };
    modal.onpointerdown = (event) => {
        if (event.target === modal) modal.style.display = 'none';
    };
    form.onsubmit = async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            await Server.reserveLocationCombatReaction(window.currentLobbyId, getCurrentLocationId(), {
                location_character_id: character.location_character_id,
                action_points: Number(form.elements.action_points.value) || 0,
                free_actions: Number(form.elements.free_actions.value) || 0,
                movement_points: Number(form.elements.movement_points.value) || 0,
                trigger: form.elements.trigger.value,
            });
            modal.style.display = 'none';
            showNotification('Реакция отложена', 'success');
        } catch (error) {
            submit.disabled = false;
            showNotification(error.message || 'Не удалось отложить реакцию', 'system');
        }
    };
    modal.style.display = 'flex';
}

function showHelpReserveMenu(character) {
    if (!character?.location_character_id || !combatState?.characters) return;
    const targets = combatState.characters.filter(item => (
        item.character_id !== character.character_id && item.location_character_id
        && combatCharacterVisibleToPlayer(item)
    ));
    if (!targets.length) {
        showNotification('На локации нет персонажа, которому можно помочь', 'system');
        return;
    }
    let modal = document.getElementById('combat-help-reserve-menu');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'combat-help-reserve-menu';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10060;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.48);';
        document.body.appendChild(modal);
    }
    const targetOptions = targets.map(item => (
        `<option value="${item.character_id}">${escapeHtml(item.name || 'Персонаж')}</option>`
    )).join('');
    const skillOptions = [
        '<option value="">Не указывать</option>',
        ...NARRATIVE_SKILLS.map(([value, label]) => (
            `<option value="${value}">${escapeHtml(label)}</option>`
        )),
    ].join('');
    modal.innerHTML = `
        <form style="width:min(440px,calc(100vw - 32px));padding:18px;border:1px solid rgba(255,255,255,.17);border-radius:14px;background:rgba(18,23,22,.98);color:#f4f1e8;box-shadow:0 20px 60px rgba(0,0,0,.55);">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><strong style="font-size:18px;">Помощь</strong><button type="button" class="help-close btn btn-sm btn-secondary">×</button></div>
            <div style="margin:8px 0 14px;font-size:12px;opacity:.76;">ОД резервируются сейчас. Если их не хватает, остаток будет списан в следующем ходу. В чужой ход запросите помощь у ГМа; после подтверждения следующая подходящая проверка цели получит преимущество.</div>
            <label style="display:grid;gap:5px;margin-bottom:10px;">Кому помочь<select name="target_character_id">${targetOptions}</select></label>
            <label style="display:grid;gap:5px;margin-bottom:10px;max-width:140px;">Стоимость, ОД<input name="action_points" type="number" min="1" max="30" value="1"></label>
            <label style="display:grid;gap:5px;margin-bottom:10px;">Действие<input name="action_label" type="text" maxlength="200" required placeholder="Например: придерживаю рану"></label>
            <label style="display:grid;gap:5px;">Подходящий навык<select name="skill_path">${skillOptions}</select></label>
            ${awarenessModeRowHtml()}
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:15px;">Заявить помощь</button>
        </form>
    `;
    const form = modal.querySelector('form');
    const updateAwarenessMode = bindAwarenessMode(
        form,
        () => Number(form.elements.target_character_id.value),
    );
    form.elements.target_character_id.addEventListener('change', () => updateAwarenessMode?.());
    modal.querySelector('.help-close').onclick = () => { modal.style.display = 'none'; };
    modal.onpointerdown = event => {
        if (event.target === modal) modal.style.display = 'none';
    };
    form.onsubmit = async event => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        const actionPoints = Number.parseInt(form.elements.action_points.value, 10);
        if (!Number.isInteger(actionPoints) || actionPoints < 1) {
            showNotification('Укажите стоимость помощи в ОД', 'system');
            return;
        }
        submit.disabled = true;
        try {
            await Server.reserveLocationCombatReaction(window.currentLobbyId, getCurrentLocationId(), {
                location_character_id: character.location_character_id,
                action_points: actionPoints,
                free_actions: 0,
                movement_points: 0,
                kind: 'help',
                trigger: `Помощь: ${form.elements.action_label.value.trim()}`,
                help_target_character_id: Number(form.elements.target_character_id.value),
                help_action_label: form.elements.action_label.value.trim(),
                help_skill_path: awarenessModePath(form),
            });
            modal.style.display = 'none';
            showNotification('Помощь заявлена и ожидает подходящего действия', 'success');
        } catch (error) {
            submit.disabled = false;
            showNotification(error.message || 'Не удалось заявить помощь', 'system');
        }
    };
    modal.style.display = 'flex';
}

function showGmEventMenu() {
    if (!window.isGM || !combatState?.characters?.length) return;
    let modal = document.getElementById('gm-location-event-menu');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'gm-location-event-menu';
        modal.style.cssText = 'position:fixed;inset:0;z-index:10060;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.48);';
        document.body.appendChild(modal);
    }
    const characterChoices = combatState.characters.map(character => `
        <label style="display:flex;gap:7px;align-items:center;margin:4px 0;">
            <input type="checkbox" name="target" value="${character.location_character_id}">
            <span>${escapeHtml(character.name || 'Персонаж')}</span>
        </label>
    `).join('');
    modal.innerHTML = `
        <form style="width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:18px;border:1px solid rgba(255,255,255,.17);border-radius:14px;background:rgba(18,23,22,.98);color:#f4f1e8;box-shadow:0 20px 60px rgba(0,0,0,.55);">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><strong style="font-size:18px;">Событие ГМа</strong><button type="button" class="gm-event-close btn btn-sm btn-secondary">×</button></div>
            <label style="display:grid;gap:5px;margin:13px 0 9px;">Событие
                <select name="type">
                    <option value="stress">Стресс</option>
                    <option value="fall">Падение</option>
                </select>
            </label>
            <label class="gm-event-amount" style="display:grid;gap:5px;margin-bottom:9px;max-width:160px;">Изменение стресса
                <input name="amount" type="number" min="-10" max="10" value="1">
            </label>
            <label class="gm-event-stress-trigger" style="display:grid;gap:5px;margin-bottom:9px;">Причина стресса
                <select name="stress_trigger">
                    <option value="gm_event">Событие ГМа</option>
                    <option value="direct_attack">Прямая атака</option>
                    <option value="indirect_damage">Непрямой урон</option>
                    <option value="suppression">Подавление укрытия</option>
                    <option value="fright">Испуг</option>
                    <option value="intimidation">Устрашение</option>
                    <option value="provocation">Провокация</option>
                    <option value="dread">Нагнетение</option>
                    <option value="phobia">Фобия</option>
                    <option value="blindness_90">Слепота 90+</option>
                    <option value="deafness_90">Глухота 90+</option>
                    <option value="ally_critical">Критическое состояние союзника</option>
                    <option value="ally_death">Смерть союзника</option>
                    <option value="inspiration">Воодушевление / снижение стресса</option>
                </select>
            </label>
            <label class="gm-event-force-manifest" style="display:flex;gap:7px;align-items:center;margin-bottom:9px;"><input name="force_manifest" type="checkbox"> Принудительно проявить стресс</label>
            <label class="gm-event-height" style="display:none;gap:5px;margin-bottom:9px;max-width:160px;">Высота, м
                <input name="height_meters" type="number" min="0" max="1000" step="0.1" value="1">
            </label>
            <div style="margin:10px 0 6px;font-weight:600;">Цели</div>
            <div style="max-height:180px;overflow:auto;padding:7px 9px;border:1px solid rgba(255,255,255,.12);border-radius:8px;">${characterChoices}</div>
            <label style="display:grid;gap:5px;margin-top:11px;">Комментарий для чата <input name="note" type="text" maxlength="240"></label>
            <button type="submit" class="btn btn-primary" style="width:100%;margin-top:15px;">Применить событие</button>
        </form>
    `;
    const form = modal.querySelector('form');
    const typeInput = form.elements.type;
    const amountLabel = form.querySelector('.gm-event-amount');
    const stressTriggerLabel = form.querySelector('.gm-event-stress-trigger');
    const forceManifestLabel = form.querySelector('.gm-event-force-manifest');
    const heightLabel = form.querySelector('.gm-event-height');
    typeInput.onchange = () => {
        amountLabel.style.display = typeInput.value === 'stress' ? 'grid' : 'none';
        stressTriggerLabel.style.display = typeInput.value === 'stress' ? 'grid' : 'none';
        forceManifestLabel.style.display = typeInput.value === 'stress' ? 'flex' : 'none';
        heightLabel.style.display = typeInput.value === 'fall' ? 'grid' : 'none';
    };
    modal.querySelector('.gm-event-close').onclick = () => { modal.style.display = 'none'; };
    modal.onpointerdown = event => { if (event.target === modal) modal.style.display = 'none'; };
    form.onsubmit = async event => {
        event.preventDefault();
        const ids = [...form.querySelectorAll('input[name="target"]:checked')].map(input => Number(input.value));
        if (!ids.length) {
            showNotification('Выберите хотя бы одного персонажа', 'system');
            return;
        }
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            await Server.applyLocationGmEvent(window.currentLobbyId, getCurrentLocationId(), {
                location_character_ids: ids,
                type: typeInput.value,
                amount: Number(form.elements.amount.value),
                height_meters: Number(form.elements.height_meters.value),
                stress_trigger: form.elements.stress_trigger.value,
                force_manifest: form.elements.force_manifest.checked,
                note: form.elements.note.value.trim(),
            });
            modal.style.display = 'none';
            showNotification('Событие ГМа применено', 'success');
        } catch (error) {
            submit.disabled = false;
            showNotification(error.message || 'Не удалось применить событие', 'system');
        }
    };
    modal.style.display = 'flex';
}

async function requestReservedReaction(character) {
    try {
        await Server.requestLocationCombatReaction(
            window.currentLobbyId,
            getCurrentLocationId(),
            character.location_character_id,
        );
        showNotification('Запрос реакции отправлен ГМу', 'system');
    } catch (error) {
        showNotification(error.message || 'Не удалось запросить реакцию', 'system');
    }
}

function getMustDoUsage(actor) {
    const usage = actor?.must_do_usage || {};
    const retry = actor?.must_do_retry || {};
    const limit = Math.max(1, Number(usage.limit ?? retry.use_limit) || 1);
    const remaining = Math.max(0, Number(usage.remaining ?? retry.uses_remaining ?? limit) || 0);
    return { limit, remaining };
}

function showManualMustDoModal(actor) {
    const { limit, remaining } = getMustDoUsage(actor);
    if (remaining <= 0) {
        showNotification(`Лимит «Должен это сделать» исчерпан: 0/${limit}`, 'system');
        return;
    }
    document.getElementById('must-do-manual-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'must-do-manual-modal';
    modal.tabIndex = -1;
    modal.style.cssText = 'position:fixed;inset:0;z-index:10065;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.58);';
    modal.innerHTML = `<form style="width:min(460px,100%);background:#171b16;color:#e7e0cb;border:1px solid #625b42;border-radius:8px;padding:18px;box-shadow:0 18px 55px rgba(0,0,0,.58);">
        <h3 style="margin:0 0 8px;">Должен это сделать</h3>
        <p style="margin:0 0 14px;opacity:.8;">Ручной повтор по разрешению ГМа. Добавляет 1 стресс. Осталось: ${remaining}/${limit}.</p>
        <label style="display:grid;gap:5px;margin-bottom:12px;"><span>Действие</span><input name="action_name" class="form-control" maxlength="200" required placeholder="Какой бросок повторяется"></label>
        <div style="display:grid;grid-template-columns:1fr 120px;gap:10px;margin-bottom:16px;">
            <label style="display:grid;gap:5px;"><span>Навык</span><select name="skill_path" class="form-control">${NARRATIVE_SKILLS.map(([path, label]) => `<option value="${path}">${label}</option>`).join('')}</select></label>
            <label style="display:grid;gap:5px;"><span>Сложность</span><input name="difficulty" class="form-control number-input" type="number" min="1" max="40" value="10" required></label>
        </div>
        ${awarenessModeRowHtml()}
        <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="btn btn-secondary">Отмена</button><button type="submit" class="btn btn-primary">Бросить</button></div>
    </form>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    const form = modal.querySelector('form');
    bindAwarenessMode(form, () => actor.character_id);
    modal.querySelector('[type="button"]').onclick = close;
    modal.onpointerdown = event => { if (event.target === modal) close(); };
    modal.onkeydown = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };
    form.onsubmit = async event => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        const payload = {
            narrative_action_name: form.elements.action_name.value.trim(),
            narrative_skill_path: awarenessModePath(form),
            narrative_difficulty: Number.parseInt(form.elements.difficulty.value, 10),
        };
        const succeeded = await performMustDoRetry(actor, payload);
        if (succeeded) close();
        else submit.disabled = false;
    };
    modal.focus();
    form.elements.action_name.focus();
}

async function performMustDoRetry(actor, manualPayload = null) {
    const { limit, remaining } = getMustDoUsage(actor);
    if (remaining <= 0) {
        showNotification(`Лимит «Должен это сделать» исчерпан: 0/${limit}`, 'system');
        return false;
    }
    if (!actor?.must_do_retry && !manualPayload) {
        showManualMustDoModal(actor);
        return false;
    }
    try {
        const result = await Server.performLocationCombatAction(
            window.currentLobbyId,
            getCurrentLocationId(),
            {
                location_character_id: actor.location_character_id,
                action_key: 'must_do_it',
                ...(manualPayload || {}),
            },
        );
        const details = result?.must_do_it || {};
        const check = details.check || {};
        const uses = Number.isFinite(Number(details.uses_remaining))
            ? ` Осталось применений: ${details.uses_remaining}/${details.use_limit}.`
            : '';
        if (details.kind === 'medical' && details.medical_retry) {
            const sheet = await import('./characterSheet.js');
            await sheet.resolveMustDoMedicalRetry(details.medical_retry, Boolean(check.success));
        }
        showNotification(
            `Должен это сделать: d20 ${check.roll ?? '—'}, итог ${check.total ?? '—'} против СЛ ${check.difficulty ?? '—'} — ${check.success ? 'успех' : 'провал'}.${uses}`,
            check.success ? 'success' : 'system',
        );
        return true;
    } catch (error) {
        showNotification(error.message || 'Не удалось повторить проверку', 'system');
        return false;
    }
}

function showConsolationMenu(actor) {
    const targets = (combatState?.characters || []).filter(character =>
        character.location_character_id !== actor.location_character_id && character.condition?.state !== 'dead'
        && combatCharacterVisibleToPlayer(character)
    );
    if (!targets.length) {
        showNotification('Нет доступных союзников для утешения', 'system');
        return;
    }
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.58);';
    modal.innerHTML = `<form style="width:min(390px,100%);background:#171b16;color:#e7e0cb;border:1px solid #625b42;border-radius:8px;padding:18px;">
        <h3 style="margin:0 0 8px;">Утешить союзника</h3>
        <p style="margin:0 0 14px;opacity:.8;">3 ОД, не чаще одного раза в игровой час на цель.</p>
        <select name="target" class="form-control">${targets.map(target => `<option value="${target.character_id}">${escapeHtml(target.name)}</option>`).join('')}</select>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;"><button type="button" class="btn btn-secondary">Отмена</button><button class="btn btn-primary">Утешить</button></div>
    </form>`;
    document.body.appendChild(modal);
    const form = modal.querySelector('form');
    modal.querySelector('[type="button"]').onclick = () => modal.remove();
    modal.onpointerdown = event => { if (event.target === modal) modal.remove(); };
    form.onsubmit = async event => {
        event.preventDefault();
        try {
            const result = await Server.performLocationCombatAction(
                window.currentLobbyId, getCurrentLocationId(), {
                    location_character_id: actor.location_character_id,
                    action_key: 'console_ally',
                    target_character_id: Number(form.elements.target.value),
                },
            );
            modal.remove();
            const check = result?.consolation?.check || {};
            showNotification(
                `${result?.consolation?.target_name || 'Союзник'}: Воля ${check.total ?? '—'} против СЛ ${check.difficulty ?? '—'} — ${check.success ? 'стресс снижен' : 'проявление стресса'}`,
                check.success ? 'success' : 'system',
            );
        } catch (error) {
            showNotification(error.message || 'Не удалось утешить союзника', 'system');
        }
    };
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
    const characterEntry = getCharacterModelEntry(characterId);
    const groundItemsHere = (currentLocationData?.objects || []).find(object => {
        if (object?.type !== 'ground_item' && !object?.properties?.is_ground_item) return false;
        const position = getObjectGridPosition(object);
        return position.x === Number(characterEntry?.posX) && position.y === Number(characterEntry?.posY);
    });
    let menuItems = [
        {
            label: 'Движение',
            title: 'Перетащить персонажа по карте',
            angle: -90,
            action: () => startCharacterMoveMode(characterId),
        },
        {
            label: 'Атака',
            title: 'Выбрать оружие или природную атаку',
            angle: -38,
            action: () => openCharacterAttackSelection(characterId),
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

    if (condition.state === 'active') {
        if (isCurrentTurn && combatCharacter?.active_anomaly) {
            menuItems.push({
                label: '\u0412\u044b\u0440\u0432\u0430\u0442\u044c\u0441\u044f',
                icon: '\u21f1',
                title: `\u0412\u044b\u0439\u0442\u0438 \u0438\u0437 \u0430\u043d\u043e\u043c\u0430\u043b\u0438\u0438 \u00ab${combatCharacter.active_anomaly.name}\u00bb \u0437\u0430 3 \u041e\u0414`,
                angle: 278,
                ringRadius: 165,
                requiresCombat: true,
                action: () => {
                    const anomalyKey = combatCharacter.active_anomaly.key;
                    let attributeChoice = null;
                    if (['ekho', 'starshina'].includes(anomalyKey)) {
                        attributeChoice = window.confirm('Возле персонажа есть исходящий шум?')
                            ? 'noise' : 'silence';
                    } else if (anomalyKey === 'mozgotrobilka') {
                        attributeChoice = window.confirm('Пытаться выбраться с закрытыми глазами?')
                            ? 'eyes_closed' : 'eyes_open';
                    }
                    beginPendingCombatAction({
                        actorCharacterId: characterId,
                        actorLocationCharacterId: combatCharacter.location_character_id,
                        actionKey: 'escape_anomaly',
                        targetType: 'point',
                        attributeChoice,
                    });
                },
            });
        }
        if (combatCharacter && !combatCharacter.is_mutant) {
            const retry = combatCharacter.must_do_retry;
            const { remaining, limit } = getMustDoUsage(combatCharacter);
            if (remaining > 0) {
                menuItems.push({
                    label: `Должен ${remaining}/${limit}`, icon: '!',
                    title: retry
                        ? `Повторить проверку «${retry.name || 'действие'}», получить 1 стресс. Осталось применений: ${remaining}/${limit}`
                        : `Выполнить разрешённый ГМом повтор, получить 1 стресс. Осталось применений: ${remaining}/${limit}`,
                    angle: 194, ringRadius: 165, requiresCombat: true,
                    action: () => performMustDoRetry(combatCharacter),
                });
            }
        }
        menuItems.push({
            label: 'Утешить', icon: '♡',
            title: 'Помочь союзнику справиться со стрессом за 3 ОД',
            angle: 230, ringRadius: 165, requiresCombat: true,
            action: () => showConsolationMenu(combatCharacter),
        });
        menuItems.push({
            label: '\u0420\u0430\u0437\u0432\u043e\u0440\u043e\u0442',
            icon: '\u21bb',
            title: '\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u0432\u0437\u0433\u043b\u044f\u0434\u0430 \u0438 \u043e\u0431\u0437\u043e\u0440\u0430',
            angle: 18,
            ringRadius: 165,
            action: () => showFacingMenu(characterId),
        });
        if (
            isCurrentTurn
            && combatCharacter?.drawn_weapon_index !== null
            && combatCharacter?.drawn_weapon_index !== undefined
        ) {
            menuItems.push({
                label: 'Ствол в упор',
                icon: '⊙',
                title: 'Приставить ствол к выбранной части тела соседней цели',
                angle: 302,
                ringRadius: 165,
                requiresCombat: true,
                action: () => beginPendingCombatAction({
                    actorCharacterId: characterId,
                    actorLocationCharacterId: combatCharacter.location_character_id,
                    actionKey: 'place_gunpoint',
                    targetType: 'character',
                    selectTargetZone: true,
                }),
            });
        }
    }
    if (combatState?.status === 'active' && combatCharacter?.location_character_id) {
        const gunpointTargetTurn = Boolean(
            combatCharacter.gunpoint
            && Number(combatCharacter.gunpoint.target_location_character_id)
                === Number(combatState.current_location_character_id)
        );
        if (!isCurrentTurn && gunpointTargetTurn) {
            menuItems.push({
                label: 'Выстрелить',
                icon: '✹',
                title: `Выстрелить в упор в ${combatCharacter.gunpoint.target_name || 'цель'} за 1 ОД`,
                angle: 302,
                ringRadius: 165,
                requiresCombat: true,
                allowReaction: true,
                action: async () => {
                    try {
                        const result = await Server.performLocationCombatAction(
                            window.currentLobbyId,
                            getCurrentLocationId(),
                            {
                                location_character_id: combatCharacter.location_character_id,
                                action_key: 'gunpoint_shot',
                            },
                        );
                        const hit = result?.attack?.results?.[0] || {};
                        showNotification(
                            `Выстрел в упор: d20 ${hit.roll ?? '—'}, урон ${Math.round(Number(hit.damage) || 0)}`,
                            'success',
                        );
                    } catch (error) {
                        showNotification(error.message || 'Не удалось выстрелить в упор', 'system');
                    }
                },
            });
        }
        const hasReserve = Boolean(combatCharacter.reaction_reserve);
        if (isCurrentTurn && !hasReserve) {
            menuItems.push({
                label: 'Реакция',
                icon: '↯',
                title: 'Отложить часть ОД, СД и ОП для действия в чужой ход',
                angle: 122,
                ringRadius: 165,
                requiresCombat: true,
                action: () => showReactionReserveMenu(combatCharacter),
            });
            menuItems.push({
                label: 'Помощь',
                icon: '✚',
                title: 'Заявить помощь другому персонажу и зарезервировать ОД',
                angle: 158,
                ringRadius: 165,
                requiresCombat: true,
                action: () => showHelpReserveMenu(combatCharacter),
            });
        } else if (!isCurrentTurn && hasReserve) {
            menuItems.push({
                label: 'Реакция',
                icon: '↯',
                title: 'Запросить у ГМа разрешение на отложенную реакцию',
                angle: 122,
                ringRadius: 165,
                requiresCombat: true,
                allowReaction: true,
                action: () => requestReservedReaction(combatCharacter),
            });
        }
    }

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
            label: 'Другое',
            icon: '…',
            title: 'Описать произвольное действие, списать ОД и при необходимости бросить навык',
            angle: -10,
            ringRadius: 165,
            requiresCombat: true,
            action: () => showNarrativeActionModal(characterId),
        });
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
    if (groundItemsHere) {
        menuItems.push({
            label: 'Вещи',
            icon: '▣',
            title: 'Открыть вещи на клетке персонажа',
            angle: 248,
            ringRadius: 165,
            allowAlways: true,
            action: () => showContainerInteractionMenu(groundItemsHere),
        });
    }
    if (window.isGM) {
        if (characterEntry?.isMutant || characterEntry?.isNpc) {
            menuItems.push({
                label: characterEntry.gmHidden ? 'Показать' : 'Скрыть',
                icon: characterEntry.gmHidden ? '◉' : '◌',
                title: characterEntry.gmHidden
                    ? 'Показать модель игрокам' : 'Скрыть модель от игроков',
                angle: 118,
                ringRadius: 165,
                allowAlways: true,
                action: async () => {
                    try {
                        const result = await Server.setLocationCharacterHidden(
                            window.currentLobbyId, getCurrentLocationId(), characterId,
                            !characterEntry.gmHidden,
                        );
                        applyCharacterVisibilityUpdate(characterId, result.gm_hidden);
                    } catch (error) {
                        showNotification(error.message || 'Не удалось изменить видимость модели', 'error');
                    }
                },
            });
        }
        if (combatState?.status !== 'active' && combatCharacter?.location_character_id
            && condition.state === 'active') {
            menuItems.push({
                label: 'Начать бой',
                icon: '⚔',
                title: 'Начать бой действием этого персонажа; он будет первым',
                angle: -18,
                ringRadius: 165,
                allowAlways: true,
                action: () => showCombatParticipantSelection(
                    combatCharacter.location_character_id,
                ),
            });
        }
        menuItems.push({
            label: gmVisionCharacterId === characterId ? 'Обзор ГМа' : 'Взгляд',
            icon: gmVisionCharacterId === characterId ? '◉' : '◌',
            title: gmVisionCharacterId === characterId
                ? 'Вернуться к полному обзору ГМа'
                : 'Показать поле зрения этого персонажа',
            angle: 70,
            ringRadius: 165,
            allowAlways: true,
            action: () => toggleGmVision(characterId),
        });
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

    combatActionMenu.style.width = '410px';
    combatActionMenu.style.height = '410px';

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
            || (item.allowReaction && canControlCharacter(characterId))
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

function collectStealableElectronics(characterData) {
    const matches = [];
    const isDevice = (item) => {
        const name = String(item?.name || '').toLowerCase();
        return ['детектор аномал', 'рация', 'радио', 'пнв', 'кпк']
            .some(token => name.includes(token));
    };
    const walk = (value, path) => {
        if (Array.isArray(value)) {
            value.forEach((entry, index) => walk(entry, [...path, index]));
            return;
        }
        if (!value || typeof value !== 'object') return;
        if (isDevice(value)) {
            matches.push({ item: value, path });
            return;
        }
        Object.entries(value).forEach(([key, entry]) => {
            if (entry && typeof entry === 'object') walk(entry, [...path, key]);
        });
    };
    walk(characterData?.inventory || {}, ['inventory']);
    walk(characterData?.equipment || {}, ['equipment']);
    return matches;
}

async function showElectrocrowStealMenu(actor) {
    const targets = (combatState?.characters || []).filter(target => (
        target.location_character_id !== actor.location_character_id
        && target.condition?.state !== 'dead'
        && Math.max(
            Math.abs(Number(target.x) - Number(actor.x)),
            Math.abs(Number(target.y) - Number(actor.y)),
        ) <= 1
    ));
    const candidates = [];
    for (const target of targets) {
        const character = await Server.getCharacter(target.character_id);
        collectStealableElectronics(character?.data || {}).forEach(device => {
            candidates.push({ target, ...device });
        });
    }
    if (!candidates.length) {
        showNotification('У соседних целей нет Детектора, Рации, ПНВ или КПК', 'system');
        return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(500px,calc(100vw - 28px));">
            <button type="button" class="close">&times;</button>
            <h3>Украсть устройство · 2 ОД</h3>
            <div class="electrocrow-device-list" style="display:grid;gap:8px;"></div>
        </div>
    `;
    const list = modal.querySelector('.electrocrow-device-list');
    candidates.forEach(candidate => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary';
        button.textContent = `${candidate.item.name} · у ${candidate.target.name}`;
        button.onclick = async () => {
            button.disabled = true;
            try {
                const result = await Server.performLocationCombatAction(
                    window.currentLobbyId,
                    getCurrentLocationId(),
                    {
                        location_character_id: actor.location_character_id,
                        action_key: 'mutant_steal_device',
                        target_character_id: candidate.target.character_id,
                        item_path: candidate.path,
                        pending_action_id: `mutant-steal-${actor.location_character_id}-${Date.now()}`,
                    },
                );
                modal.remove();
                if (result?.pending_action) {
                    showNotification('Кража начата и завершится после оплаты оставшихся ОД', 'system');
                } else {
                    showNotification(`Украдено: ${candidate.item.name}`, 'success');
                }
            } catch (error) {
                button.disabled = false;
                showNotification(error.message || 'Не удалось украсть устройство', 'system');
            }
        };
        list.appendChild(button);
    });
    modal.querySelector('.close').onclick = () => modal.remove();
    document.body.appendChild(modal);
}

async function openCharacterAttackSelection(characterId) {
    try {
        const character = await Server.getCharacter(characterId);
        const data = character?.data || {};
        if (!data.is_mutant && !data.basic?.is_mutant) {
            const sheet = await import('./characterSheet.js');
            await sheet.openCharacterAttackSheet(characterId);
            return;
        }
        const actor = findCombatCharacterByCharacterId(characterId);
        if (combatState?.status === 'active' && !actor?.location_character_id) {
            showNotification('Мутант не участвует в текущем бою', 'system');
            return;
        }
        const weapons = Array.isArray(data.weapons) ? data.weapons : [];
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content" style="width:min(520px,calc(100vw - 28px));">
                <button type="button" class="close mutant-attack-close">&times;</button>
                <h3>Атаки: ${escapeHtml(character.name)}</h3>
                <div class="mutant-attack-options" style="display:grid;gap:8px;"></div>
            </div>
        `;
        const options = modal.querySelector('.mutant-attack-options');
        const mutantTraits = [
            ...(Array.isArray(data.mutant?.traits) ? data.mutant.traits : []),
            ...(Array.isArray(data.mutant?.variant?.traits) ? data.mutant.variant.traits : []),
        ];
        const hasTrait = (text) => mutantTraits.some((trait) => String(trait).includes(text));
        const performMutantAction = async (actionKey) => {
            try {
                const result = await Server.performLocationCombatAction(
                    window.currentLobbyId,
                    getCurrentLocationId(),
                    {
                        location_character_id: actor.location_character_id,
                        action_key: actionKey,
                        pending_action_id: `mutant-${actionKey}-${actor.location_character_id}-${Date.now()}`,
                    },
                );
                if (result?.pending_action) {
                    showNotification('Действие начато и завершится после оплаты оставшихся ОД.', 'system');
                    return;
                }
                if (actionKey === 'mutant_battle_cry') {
                    const targets = result?.mutant_action?.targets || [];
                    const failed = targets.filter((entry) => !entry.success).length;
                    showNotification(`Боевой клич: проверок ${targets.length}, провалов ${failed}.`, 'success');
                } else if (actionKey === 'mutant_camouflage') {
                    showNotification('Маскировка активна на 3 раунда или до первой атаки.', 'success');
                } else if (actionKey === 'mutant_psy_roar') {
                    const targets = result?.mutant_action?.targets || [];
                    const failed = targets.filter((entry) => !entry?.save?.success).length;
                    showNotification(`Пси-рёв: целей ${targets.length}, провалов Воли ${failed}.`, 'success');
                } else if (actionKey === 'mutant_clone') {
                    showNotification('Пси-копия создана на соседней клетке.', 'success');
                } else {
                    showNotification('Засада подготовлена: СЛ обнаружения увеличена на 5.', 'success');
                }
            } catch (error) {
                showNotification(error.message || 'Не удалось выполнить действие мутанта', 'system');
            }
        };
        weapons.forEach((weapon, index) => {
            const attrs = weapon?.attributes || {};
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-secondary';
            const rawCost = Number(String(attrs.raw_effect || '').match(/(\d+)\s*ОД/i)?.[1]);
            const baseCost = Number.isFinite(rawCost) ? rawCost : (Number(attrs.action_points) || 0);
            const firstAttackNote = hasTrait('Улучшенные рефлексы') ? ` · первая атака ${Math.max(0, baseCost - 1)} ОД` : '';
            const isBattleCry = attrs.special_action === 'mutant_battle_cry'
                || String(weapon.name || '').toLowerCase().includes('клич');
            const isPsyAttack = ['пси-удар', 'зомбирование', 'приказ смерти']
                .includes(String(weapon.name || '').toLowerCase());
            const isObjectAttack = [
                'бросок',
                'огненный снаряд',
                'электрический снаряд',
                'химический снаряд',
            ].includes(String(weapon.name || '').toLowerCase());
            const isAnomalyShield = String(weapon.name || '').toLowerCase() === 'щит';
            button.textContent = isBattleCry
                ? `${weapon.name} · ${baseCost} ОД${firstAttackNote} · Воля СЛ 15`
                : (isPsyAttack
                    ? `${weapon.name} · ${baseCost} ОД · автоматически при прямой видимости`
                    : `${weapon.name} · ${baseCost} ОД${firstAttackNote} · урон ${Number(attrs.damage) || 0} · пробитие ${Number(attrs.armor_piercing) || 0}%`);
            button.onclick = () => {
                modal.remove();
                if (combatState?.status !== 'active') {
                    showNotification(`${weapon.name}: урон ${Number(attrs.damage) || 0}, пробитие ${Number(attrs.armor_piercing) || 0}%`, 'system');
                    return;
                }
                if (isBattleCry) {
                    performMutantAction('mutant_battle_cry');
                    return;
                }
                if (isAnomalyShield) {
                    performMutantAction('mutant_anomaly_shield');
                    return;
                }
                beginPendingCombatAction({
                    actorCharacterId: characterId,
                    actorLocationCharacterId: actor.location_character_id,
                    actionKey: isPsyAttack
                        ? 'mutant_psy_attack'
                        : (isObjectAttack ? 'mutant_object_attack' : 'attack'),
                    weaponIndex: index,
                    attackType: weapon.name,
                    targetType: 'character',
                    source: 'mutant-card',
                });
            };
            options.appendChild(button);
        });
        if (hasTrait('Прыгун')) {
            const jumpButton = document.createElement('button');
            jumpButton.type = 'button';
            jumpButton.className = 'btn btn-secondary';
            jumpButton.textContent = 'Прыжок · 4 ОД · выбрать клетку до 15 м';
            jumpButton.onclick = () => {
                modal.remove();
                beginPendingCombatAction({
                    actorCharacterId: characterId,
                    actorLocationCharacterId: actor.location_character_id,
                    actionKey: 'mutant_jump',
                    targetType: 'point',
                    source: 'mutant-card',
                });
            };
            options.appendChild(jumpButton);
        }
        if (hasTrait('Засада')) {
            const ambushButton = document.createElement('button');
            ambushButton.type = 'button';
            ambushButton.className = 'btn btn-secondary';
            ambushButton.textContent = 'Засада · СЛ обнаружения +5 · требуется куст';
            ambushButton.onclick = () => {
                modal.remove();
                performMutantAction('mutant_ambush');
            };
            options.appendChild(ambushButton);
        }
        if (hasTrait('Маскировка')) {
            const camouflageButton = document.createElement('button');
            camouflageButton.type = 'button';
            camouflageButton.className = 'btn btn-secondary';
            camouflageButton.textContent = 'Маскировка · 1 ОД · 3 раунда или до атаки';
            camouflageButton.onclick = () => {
                modal.remove();
                performMutantAction('mutant_camouflage');
            };
            options.appendChild(camouflageButton);
        }
        if (hasTrait('Пси-рёв')) {
            const roarButton = document.createElement('button');
            roarButton.type = 'button';
            roarButton.className = 'btn btn-secondary';
            roarButton.textContent = 'Пси-рёв · 3 ОД · все противники в бою';
            roarButton.onclick = () => {
                modal.remove();
                performMutantAction('mutant_psy_roar');
            };
            options.appendChild(roarButton);
        }
        if (hasTrait('Клонирование')) {
            const cloneButton = document.createElement('button');
            cloneButton.type = 'button';
            cloneButton.className = 'btn btn-secondary';
            cloneButton.textContent = 'Клонирование · 1 ОД · создать копию рядом';
            cloneButton.onclick = () => {
                modal.remove();
                performMutantAction('mutant_clone');
            };
            options.appendChild(cloneButton);
        }
        if (hasTrait('Сон')) {
            const sleepButton = document.createElement('button');
            sleepButton.type = 'button';
            sleepButton.className = 'btn btn-secondary';
            sleepButton.textContent = 'Пси-сон · 4 ОД · цель до 10 м';
            sleepButton.onclick = () => {
                modal.remove();
                beginPendingCombatAction({
                    actorCharacterId: characterId,
                    actorLocationCharacterId: actor.location_character_id,
                    actionKey: 'mutant_psy_sleep',
                    targetType: 'character',
                    source: 'mutant-card',
                });
            };
            options.appendChild(sleepButton);
        }
        if (hasTrait('Вор')) {
            const stealButton = document.createElement('button');
            stealButton.type = 'button';
            stealButton.className = 'btn btn-secondary';
            stealButton.textContent = 'Украсть устройство · 2 ОД · соседняя цель';
            stealButton.onclick = () => {
                modal.remove();
                showElectrocrowStealMenu(actor).catch(error => {
                    showNotification(error.message || 'Не удалось открыть список устройств', 'system');
                });
            };
            options.appendChild(stealButton);
        }
        if (combatState?.status === 'active') {
            const skillCheckButton = document.createElement('button');
            skillCheckButton.type = 'button';
            skillCheckButton.className = 'btn btn-secondary';
            skillCheckButton.textContent = 'Проверка навыка / другое действие';
            skillCheckButton.onclick = () => {
                modal.remove();
                showNarrativeActionModal(characterId);
            };
            options.appendChild(skillCheckButton);
        }
        if (!weapons.length) options.textContent = 'У этого мутанта нет атак.';
        modal.querySelector('.mutant-attack-close').onclick = () => modal.remove();
        document.body.appendChild(modal);
    } catch (error) {
        showNotification(error.message || 'Не удалось открыть атаки мутанта', 'system');
    }
}

export async function requestCombatStartForAttack(characterId) {
    if (!window.isLocationActive || !getCurrentLocationId()) return false;
    if (combatState?.status === 'active') return false;
    try {
        const state = await Server.getLocationCombatState(window.currentLobbyId, getCurrentLocationId());
        if (state.status === 'active') {
            setCombatState(state);
            showNotification('Бой уже начался. Выберите цель атаки ещё раз.', 'system');
            return true;
        }
        const actor = state.characters?.find(item => Number(item.character_id) === Number(characterId));
        if (!actor?.location_character_id) {
            showNotification('Этот персонаж не размещён на подлокации', 'error');
            return true;
        }
        if (actor.condition?.state !== 'active') {
            showNotification('Только персонаж в сознании может начать бой действием', 'system');
            return true;
        }
        if (window.isGM) {
            await showCombatParticipantSelection(actor.location_character_id);
            return true;
        }
        await Server.requestLocationCombatStart(
            window.currentLobbyId, getCurrentLocationId(), actor.location_character_id,
        );
        showNotification('Запрос на начало боя отправлен ГМу. Патроны и ОД не потрачены.', 'system');
    } catch (error) {
        showNotification(error.message || 'Не удалось запросить начало боя', 'error');
    }
    return true;
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
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:9px;">
                <label style="display:flex;align-items:center;gap:6px;">Рука блока
                    <select class="form-control melee-block-arm" style="width:auto;">
                        <option value="left_arm">Левая</option>
                        <option value="right_arm">Правая</option>
                    </select>
                </label>
                <label style="display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" class="melee-block-counterattack" checked>
                    Ответная атака при глубоком промахе
                </label>
            </div>
            <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px;">${blockButtons}</div>
            <div class="melee-action-options" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;"></div>
        </div>
    `;
    menu.querySelector('.melee-menu-close').onclick = () => { menu.style.display = 'none'; };
    menu.querySelectorAll('.melee-block-option').forEach((button) => {
        button.onclick = () => directAction('melee_block', {
            action_points: Number(button.dataset.cost),
            target_zone: menu.querySelector('.melee-block-arm')?.value || 'right_arm',
            payment: menu.querySelector('.melee-block-counterattack')?.checked ? 'counterattack' : '',
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
        { key: 'chest', label: 'Грудь', icon: '▣', note: 'Торс' },
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

function closeFacingMenu() {
    if (facingMenu) facingMenu.remove();
    facingMenu = null;
    pendingFacingSelection = null;
    clearFacingPreview();
}

function clearFacingPreview() {
    if (!facingPreviewMesh) return;
    scene?.remove(facingPreviewMesh);
    facingPreviewMesh.geometry?.dispose();
    facingPreviewMesh.material?.dispose();
    facingPreviewMesh = null;
}

function updateFacingPreview(clientX, clientY) {
    if (!pendingFacingSelection || !currentLocationData || !scene) {
        clearFacingPreview();
        return;
    }
    const tile = getLocationTileAtScreen(clientX, clientY);
    const character = pendingFacingSelection.isCombatActive
        ? findCombatCharacterByCharacterId(pendingFacingSelection.characterId)
        : getCharacterModelEntry(pendingFacingSelection.characterId);
    if (!tile || !character) {
        clearFacingPreview();
        return;
    }
    const sourceX = Number(character.x ?? character.posX);
    const sourceY = Number(character.y ?? character.posY);
    const facingX = tile.x - sourceX;
    const facingY = tile.y - sourceY;
    const facingLength = Math.hypot(facingX, facingY);
    if (!facingLength) {
        clearFacingPreview();
        return;
    }
    const visibleTiles = [];
    const sourceHeight = visionEyeHeight({
        posX: sourceX,
        posY: sourceY,
        posture: character.posture || 'standing',
    });
    const minX = Math.max(0, Math.floor(sourceX - FOG_VIEW_RADIUS));
    const maxX = Math.min(currentLocationData.grid_width - 1, Math.ceil(sourceX + FOG_VIEW_RADIUS));
    const minY = Math.max(0, Math.floor(sourceY - FOG_VIEW_RADIUS));
    const maxY = Math.min(currentLocationData.grid_height - 1, Math.ceil(sourceY + FOG_VIEW_RADIUS));
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const dx = x - sourceX;
            const dy = y - sourceY;
            const distance = Math.hypot(dx, dy);
            if (!distance || distance > FOG_VIEW_RADIUS) continue;
            const cosine = (dx * facingX + dy * facingY) / (distance * facingLength);
            if (cosine < Math.cos(FOG_VIEW_HALF_ANGLE)) continue;
            if (!hasLineOfSight(sourceX, sourceY, x, y, sourceHeight, getTileHeight(x, y) + 1.65)) continue;
            visibleTiles.push({ x, y });
        }
    }
    clearFacingPreview();
    if (!visibleTiles.length) return;
    const geometry = new THREE.PlaneGeometry(0.9, 0.9);
    const material = new THREE.MeshBasicMaterial({
        color: 0xd3b66a,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    facingPreviewMesh = new THREE.InstancedMesh(geometry, material, visibleTiles.length);
    const transform = new THREE.Object3D();
    visibleTiles.forEach(({ x, y }, index) => {
        transform.position.set(x + 0.5, getTileHeight(x, y) + 0.035, y + 0.5);
        transform.rotation.set(-Math.PI / 2, 0, 0);
        transform.updateMatrix();
        facingPreviewMesh.setMatrixAt(index, transform.matrix);
    });
    facingPreviewMesh.instanceMatrix.needsUpdate = true;
    facingPreviewMesh.renderOrder = 18;
    facingPreviewMesh.raycast = () => {};
    scene.add(facingPreviewMesh);
}

function getFacingChangeOptions(character, targetX, targetY) {
    const fromX = Number(character.facing_x ?? character.facingX) || 0;
    const fromY = Number(character.facing_y ?? character.facingY) || 1;
    const dot = fromX * targetX + fromY * targetY;
    const lengths = Math.hypot(fromX, fromY) * Math.hypot(targetX, targetY);
    const degrees = Math.round(Math.acos(Math.max(-1, Math.min(1, dot / lengths))) * 180 / Math.PI);
    const prone = character.posture === 'prone';
    if (degrees <= 45) {
        return {
            degrees,
            options: prone
                ? [
                    { payment: 'prone_action', action: 1, free: 0, movement: 0 },
                    { payment: 'prone_movement', action: 0, free: 0, movement: 3 },
                ]
                : [{ payment: 'free_turn', action: 0, free: 0, movement: 0 }],
        };
    }
    const movement = Math.max(0, (degrees <= 90 ? 3 : 5) - (Number(character.agility_bonus) || 0) + (prone ? 3 : 0));
    const actionExtra = prone ? 1 : 0;
    return {
        degrees,
        options: degrees <= 90
            ? [
                { payment: 'free', action: actionExtra, free: 1, movement: 0 },
                { payment: 'action', action: 1 + actionExtra, free: 0, movement: 0 },
                { payment: 'movement', action: 0, free: 0, movement },
            ]
            : [
                { payment: 'mixed', action: 1 + actionExtra, free: 1, movement: 0 },
                { payment: 'action', action: 2 + actionExtra, free: 0, movement: 0 },
                { payment: 'movement', action: 0, free: 0, movement },
            ],
    };
}

function facingPaymentLabel(option) {
    const parts = [];
    if (option.action) parts.push(`${option.action} \u041e\u0414`);
    if (option.free) parts.push(`${option.free} \u0421\u0414`);
    if (option.movement) parts.push(`${option.movement} \u041e\u041f`);
    return parts.join(' + ') || 'Бесплатно';
}

function showFacingMenuLegacy(characterId) {
    const isCombatActive = combatState?.status === 'active';
    const character = isCombatActive
        ? findCombatCharacterByCharacterId(characterId)
        : getCharacterModelEntry(characterId);
    if (!character || (isCombatActive && !canActWithCombatCharacter(character)) || (!isCombatActive && !canControlCharacter(characterId))) return;
    if (isCombatActive && Number(character.facing_changed_round) === Number(combatState?.round_number)) {
        showNotification('\u0420\u0430\u0437\u0432\u043e\u0440\u043e\u0442 \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d \u0432 \u044d\u0442\u043e\u043c \u0440\u0430\u0443\u043d\u0434\u0435', 'system');
        return;
    }
    closeFacingMenu();
    facingMenu = document.createElement('div');
    facingMenu.style.cssText = 'position:fixed;inset:0;z-index:1240;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,7,10,.62);';
    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(430px,calc(100vw - 32px));padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:rgba(14,18,26,.98);color:#fff;box-shadow:0 24px 60px rgba(0,0,0,.48);';
    const title = document.createElement('div');
    title.innerHTML = '<div style="font-size:19px;font-weight:800;">\u0420\u0430\u0437\u0432\u043e\u0440\u043e\u0442</div><div style="margin-top:3px;font-size:12px;opacity:.72;">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435. \u041d\u0435 \u0431\u043e\u043b\u0435\u0435 \u043e\u0434\u043d\u043e\u0433\u043e \u0440\u0430\u0437\u0430 \u0437\u0430 \u0440\u0430\u0443\u043d\u0434.</div>';
    const directionGrid = document.createElement('div');
    directionGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:16px;';
    const paymentArea = document.createElement('div');
    paymentArea.style.cssText = 'display:grid;gap:8px;margin-top:14px;';
    const directions = [
        [-1, -1, '\u2196'], [0, -1, '\u2191'], [1, -1, '\u2197'],
        [-1, 0, '\u2190'], [0, 0, ''], [1, 0, '\u2192'],
        [-1, 1, '\u2199'], [0, 1, '\u2193'], [1, 1, '\u2198'],
    ];
    directions.forEach(([x, y, icon]) => {
        if (x === 0 && y === 0) {
            const spacer = document.createElement('div');
            directionGrid.appendChild(spacer);
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = icon;
        button.style.cssText = 'height:48px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:#fff;font-size:24px;cursor:pointer;';
        button.onclick = () => {
            const details = getFacingChangeOptions(character, x, y);
            if (!details.degrees) return;
            paymentArea.replaceChildren();
            const hint = document.createElement('div');
            hint.style.cssText = 'font-size:13px;opacity:.82;';
            hint.textContent = `\u0420\u0430\u0437\u0432\u043e\u0440\u043e\u0442 \u043d\u0430 ${details.degrees}\u00b0. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0440\u0430\u0442\u0443:`;
            paymentArea.appendChild(hint);
            const options = isCombatActive
                ? details.options
                : [{ payment: 'outside_combat', action: 0, free: 0, movement: 0 }];
            options.forEach((option) => {
                const affordable = !isCombatActive || (Number(character.action_points_current) >= option.action
                    && Number(character.free_actions_current) >= option.free
                    && Number(character.movement_points_current) >= option.movement);
                const pay = document.createElement('button');
                pay.type = 'button';
                pay.className = 'btn btn-secondary';
                pay.textContent = isCombatActive ? facingPaymentLabel(option) : '\u041f\u043e\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f';
                pay.disabled = !affordable;
                pay.onclick = async () => {
                    panel.querySelectorAll('button').forEach((item) => { item.disabled = true; });
                    try {
                        const result = isCombatActive
                            ? await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
                                location_character_id: character.location_character_id,
                                action_key: 'change_facing',
                                facing_x: x,
                                facing_y: y,
                                payment: option.payment,
                            })
                            : await fetch(
                                `/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/characters/${characterId}/facing`,
                                {
                                    method: 'PATCH',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                                    },
                                    body: JSON.stringify({ facing_x: x, facing_y: y }),
                                },
                            ).then(async (response) => {
                                const payload = await response.json().catch(() => ({}));
                                if (!response.ok) throw new Error(payload.error || 'Unable to turn');
                                return payload;
                            });
                        closeFacingMenu();
                        if (result?.state) setCombatState(result.state);
                        else applyCharacterFacingVisual(characterId, x, y);
                    } catch (error) {
                        showNotification(error.message || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0440\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', 'system');
                        showFacingMenu(characterId);
                    }
                };
                paymentArea.appendChild(pay);
            });
        };
        directionGrid.appendChild(button);
    });
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'btn btn-secondary'; close.textContent = '\u041e\u0442\u043c\u0435\u043d\u0430'; close.style.marginTop = '14px'; close.onclick = closeFacingMenu;
    panel.append(title, directionGrid, paymentArea, close);
    facingMenu.appendChild(panel);
    facingMenu.addEventListener('pointerdown', (event) => {
        if (event.target === facingMenu) closeFacingMenu();
    });
    document.body.appendChild(facingMenu);
}

function getLocationTileAtScreen(clientX, clientY) {
    if (!renderer || !camera) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObjects(tileCubes)[0];
    const coords = hitTileCoords(hit);
    return coords ? { x: coords.x, y: coords.z } : null;
}

function hitTileCoords(hit) {
    return hit?.object?.userData?.tileByInstance?.[hit.instanceId]
        || hit?.object?.userData?.tileByFace?.[hit.faceIndex] || null;
}

function showFacingPaymentSelection(characterId, targetX, targetY, isCombatActive) {
    const character = isCombatActive
        ? findCombatCharacterByCharacterId(characterId)
        : getCharacterModelEntry(characterId);
    if (!character) return;
    const details = getFacingChangeOptions(character, targetX, targetY);
    if (!details.degrees) return;
    facingMenu = document.createElement('div');
    facingMenu.style.cssText = 'position:fixed;inset:0;z-index:1240;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(4,7,10,.48);';
    const panel = document.createElement('div');
    panel.style.cssText = 'width:min(360px,calc(100vw - 32px));padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:rgba(14,18,26,.98);color:#fff;box-shadow:0 24px 60px rgba(0,0,0,.48);';
    const heading = document.createElement('div');
    heading.innerHTML = `<strong style="font-size:18px;">\u0420\u0430\u0437\u0432\u043e\u0440\u043e\u0442 \u043d\u0430 ${details.degrees}\u00b0</strong><div style="margin-top:4px;font-size:12px;opacity:.72;">${isCombatActive ? '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0442\u0440\u0430\u0442\u0443.' : '\u0412\u043d\u0435 \u0431\u043e\u044f \u0431\u0435\u0441\u043f\u043b\u0430\u0442\u043d\u043e.'}</div>`;
    panel.appendChild(heading);
    const options = isCombatActive
        ? details.options
        : [{ payment: 'outside_combat', action: 0, free: 0, movement: 0 }];
    options.forEach((option) => {
        const affordable = !isCombatActive || (
            Number(character.action_points_current) >= option.action
            && Number(character.free_actions_current) >= option.free
            && Number(character.movement_points_current) >= option.movement
        );
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-secondary';
        button.disabled = !affordable;
        button.textContent = isCombatActive ? facingPaymentLabel(option) : '\u041f\u043e\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f';
        button.style.cssText = 'display:block;width:100%;margin-top:10px;';
        button.onclick = async () => {
            panel.querySelectorAll('button').forEach((item) => { item.disabled = true; });
            try {
                const result = isCombatActive
                    ? await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
                        location_character_id: character.location_character_id,
                        action_key: 'change_facing',
                        facing_x: targetX,
                        facing_y: targetY,
                        payment: option.payment,
                    })
                    : await fetch(`/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/characters/${characterId}/facing`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                        },
                        body: JSON.stringify({ facing_x: targetX, facing_y: targetY }),
                    }).then(async (response) => {
                        const payload = await response.json().catch(() => ({}));
                        if (!response.ok) throw new Error(payload.error || 'Unable to turn');
                        return payload;
                    });
                closeFacingMenu();
                if (result?.state) setCombatState(result.state);
                else applyCharacterFacingVisual(characterId, targetX, targetY);
            } catch (error) {
                showNotification(error.message || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0440\u0430\u0437\u0432\u0435\u0440\u043d\u0443\u0442\u044c\u0441\u044f', 'system');
                closeFacingMenu();
            }
        };
        panel.appendChild(button);
    });
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn-secondary'; cancel.textContent = '\u041e\u0442\u043c\u0435\u043d\u0430'; cancel.style.cssText = 'display:block;width:100%;margin-top:10px;'; cancel.onclick = closeFacingMenu;
    panel.appendChild(cancel);
    facingMenu.appendChild(panel);
    facingMenu.addEventListener('pointerdown', (event) => {
        if (event.target === facingMenu) closeFacingMenu();
    });
    document.body.appendChild(facingMenu);
}

async function resolveFacingCell(clientX, clientY) {
    const pending = pendingFacingSelection;
    if (!pending) return;
    const tile = getLocationTileAtScreen(clientX, clientY);
    if (!tile) return;
    const character = pending.isCombatActive
        ? findCombatCharacterByCharacterId(pending.characterId)
        : getCharacterModelEntry(pending.characterId);
    if (!character) {
        closeFacingMenu();
        return;
    }
    const sourceX = Number(character.x ?? character.posX);
    const sourceY = Number(character.y ?? character.posY);
    const targetX = tile.x - sourceX;
    const targetY = tile.y - sourceY;
    if (!targetX && !targetY) {
        showNotification('\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0434\u0440\u0443\u0433\u0443\u044e \u043a\u043b\u0435\u0442\u043a\u0443', 'system');
        return;
    }
    pendingFacingSelection = null;
    clearFacingPreview();
    renderer.domElement.style.cursor = 'default';
    if (!pending.isCombatActive) {
        try {
            const response = await fetch(
                `/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/characters/${pending.characterId}/facing`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${localStorage.getItem('access_token')}`,
                    },
                    body: JSON.stringify({ facing_x: targetX, facing_y: targetY }),
                },
            );
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'Unable to turn');
            applyCharacterFacingVisual(pending.characterId, targetX, targetY);
        } catch (error) {
            showNotification(error.message || 'Не удалось развернуться', 'system');
        }
        return;
    }
    showFacingPaymentSelection(pending.characterId, targetX, targetY, pending.isCombatActive);
}

function showFacingMenu(characterId) {
    const isCombatActive = combatState?.status === 'active';
    const character = isCombatActive
        ? findCombatCharacterByCharacterId(characterId)
        : getCharacterModelEntry(characterId);
    if (!character || (isCombatActive && !canActWithCombatCharacter(character)) || (!isCombatActive && !canControlCharacter(characterId))) return;
    if (isCombatActive && Number(character.facing_changed_round) === Number(combatState?.round_number)) {
        showNotification('\u0420\u0430\u0437\u0432\u043e\u0440\u043e\u0442 \u0443\u0436\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d \u0432 \u044d\u0442\u043e\u043c \u0440\u0430\u0443\u043d\u0434\u0435', 'system');
        return;
    }
    closeFacingMenu();
    pendingFacingSelection = { characterId, isCombatActive };
    renderer?.domElement && (renderer.domElement.style.cursor = 'crosshair');
    showNotification('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043b\u0435\u0442\u043a\u0443, \u0432 \u0441\u0442\u043e\u0440\u043e\u043d\u0443 \u043a\u043e\u0442\u043e\u0440\u043e\u0439 \u043f\u0435\u0440\u0441\u043e\u043d\u0430\u0436 \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u043c\u043e\u0442\u0440\u0435\u0442\u044c. Esc \u2014 \u043e\u0442\u043c\u0435\u043d\u0430.', 'system');
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

function showMovementTypeMenu(characterId, evasion = false) {
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
            <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:13px;">
                <input type="checkbox" id="movement-evasion" ${evasion ? 'checked' : ''}>
                <span>Уклонение на ходу: СЛ стрельбы по вам +2; дистанция ходьбы −3 м, бега −5 м, спринта −7 м. До следующего хода.</span>
            </label>
            <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:13px; opacity:0.9;">
                <input type="checkbox" id="movement-gain-op-if-needed" checked>
                <span>Получить ОП, если их нет</span>
            </label>
        </div>
    `;

    const options = menu.querySelector('.movement-type-options');
    Object.entries(COMBAT_MOVEMENT_TYPES).forEach(([key, mode]) => {
        const availability = getMovementModeAvailability(key, null, evasion);
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
        button.onclick = async () => {
            const gainOpIfNeeded = Boolean(menu.querySelector('#movement-gain-op-if-needed')?.checked);
            if (gainOpIfNeeded && (Number(current.movement_points_current) || 0) <= 0) {
                const combatCharacter = findCombatCharacterByCharacterId(characterId);
                if (combatCharacter?.location_character_id) {
                    try {
                        const result = await Server.performLocationCombatAction(
                            window.currentLobbyId,
                            getCurrentLocationId(),
                            {
                                location_character_id: combatCharacter.location_character_id,
                                action_key: 'convert_free_action_to_movement',
                            }
                        );
                        if (result?.character) {
                            combatState = result.state || combatState;
                        }
                    } catch (error) {
                        showNotification(error.message || 'Не удалось получить ОП', 'system');
                        return;
                    }
                }
            }
            closeMovementTypeMenu();
            beginCharacterMoveMode(characterId, key, evasion);
        };
        options.appendChild(button);
    });

    menu.querySelector('#movement-evasion').onchange = (event) => {
        const gainOp = menu.querySelector('#movement-gain-op-if-needed').checked;
        showMovementTypeMenu(characterId, event.target.checked);
        menu.querySelector('#movement-gain-op-if-needed').checked = gainOp;
    };
    const closeButton = menu.querySelector('.movement-type-close');
    if (closeButton) closeButton.onclick = closeMovementTypeMenu;
    menu.style.display = 'flex';
}

function beginCharacterMoveMode(characterId, movementType = 'walk', evasion = false) {
    if (!isCurrentCombatTurnForCharacter(characterId)) {
        showNotification('Сейчас не ход этого персонажа', 'system');
        return false;
    }
    armedMoveCharacterId = characterId;
    pendingCombatAction = null;
    clearAttackPreview();
    initializeMovementPreview(characterId);
    armedMovementType = movementType;
    armedMovementEvasion = combatState?.current_character?.movement_mode_this_turn
        ? Boolean(combatState.current_character.movement_evasion) : evasion;
    const label = COMBAT_MOVEMENT_TYPES[movementType]?.label || 'Движение';
    showNotification(`${label}${armedMovementEvasion ? ' с уклонением' : ''}: выберите конечную клетку ЛКМ`, 'system');
    return true;
}

export function beginPendingCombatAction(action) {
    if (!combatState || combatState.status !== 'active') {
        if (action?.actionKey !== 'use_item' || !canControlCharacter(action.actorCharacterId)
            || getLocationCharacterCondition(action.actorCharacterId).state !== 'active') {
            showNotification('Этот персонаж сейчас не может применить предмет', 'system');
            return false;
        }
        pendingCombatAction = { ...action, outOfCombat: true, createdAt: Date.now() };
        closeCombatMenus();
        hideStructureInteraction();
        showNotification('Применение предмета: выберите персонажа на карте (Esc — отмена)', 'system');
        return true;
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
        : (action.actionKey === 'explosive_attack'
            ? 'Выбор точки взрыва'
            : (action.actionKey === 'aim' ? 'Прицеливание' : 'Атака'));
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

export function registerDeferredCombatAction(actionId, payload) {
    if (actionId && payload) deferredCombatActions.set(String(actionId), { ...payload });
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
        const selectedMode = combatState?.current_character?.movement_mode_this_turn;
        if (selectedMode) return beginCharacterMoveMode(characterId, selectedMode);
        showMovementTypeMenu(characterId);
        return true;
    }
    return beginCharacterMoveMode(characterId, 'walk');
}

function isAttackerBehindTarget(attacker, target) {
    const facingX = Number(target?.facing_x ?? target?.facingX) || 0;
    const facingY = Number(target?.facing_y ?? target?.facingY) || 1;
    const relativeX = Number(attacker?.x ?? attacker?.pos_x) - Number(target?.x ?? target?.pos_x);
    const relativeY = Number(attacker?.y ?? attacker?.pos_y) - Number(target?.y ?? target?.pos_y);
    return facingX * relativeX + facingY * relativeY < 0;
}

async function resolveCombatTargetSelection(targetCharacterId) {
    if (!pendingCombatAction) return false;
    const action = pendingCombatAction;
    if (action.outOfCombat) {
        if (combatState?.status === 'active') {
            clearPendingCombatAction();
            showNotification('Начался бой. Выберите расходник заново', 'system');
            return false;
        }
        const target = getLocationCharacterById(targetCharacterId);
        if (!target) return false;
        try {
            const applied = await action.onResolve({ targetCharacterId, target });
            if (applied === false) return false;
            clearPendingCombatAction();
            return true;
        } catch (error) {
            showNotification(error.message || 'Не удалось применить предмет', 'system');
            return false;
        }
    }
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
        pending_action_id: `combat-${action.actorLocationCharacterId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    if (action.fireMode === 'aimed' || action.meleeAimed || action.selectTargetZone) {
        const zone = await selectAimedTargetZone(target.name);
        if (!zone) return false;
        payload.target_zone = zone;
    }
    if (
        action.actionKey === 'attack'
        && !action.fireMode
        && action.targetType === 'character'
        && isAttackerBehindTarget(actor, target)
        && window.confirm('Атака со спины: потратить дополнительно 2 ОД для гарантированного попадания?')
    ) {
        payload.payment = [action.meleeAimed ? 'aimed' : null, 'back_auto']
            .filter(Boolean)
            .join('+');
    }

    try {
        if (action.actionKey === 'use_item') {
            if (typeof action.onResolve === 'function') {
                const applied = await action.onResolve({ targetCharacterId, target });
                if (applied === false) return false;
            }
        } else {
            const result = await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), payload);
            if (result?.state) setCombatState(result.state);
            if (result?.pending_action) {
                deferredCombatActions.set(result.pending_action_id, { ...payload });
                showNotification(
                    'Действие начато. Оставшиеся ОД будут списаны в следующих ходах.',
                    'system'
                );
                clearPendingCombatAction();
                return true;
            }
            const attack = result?.attack;
            const gunpoint = result?.gunpoint;
            if (action.actionKey === 'place_gunpoint' && gunpoint) {
                showNotification(
                    gunpoint.success
                        ? `Ствол приставлен: d20 ${gunpoint.roll} против СЛ ${gunpoint.difficulty}`
                        : `Не удалось приставить ствол: d20 ${gunpoint.roll} против СЛ ${gunpoint.difficulty}`,
                    gunpoint.success ? 'success' : 'system',
                );
            }
            if (attack?.results?.length) {
                const hits = attack.results.filter(item => item.hit);
                const damage = attack.damage_total || 0;
                const rolls = attack.results.map((item, index) => {
                    if (item.automatic_hit) {
                        return `${index + 1}: автоматическое попадание`;
                    }
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
        const reopenEquipment = action.actionKey === 'aim' && action.source === 'sheet';
        clearPendingCombatAction();
        hideStructureInteraction();
        if (reopenEquipment) {
            const sheet = await import('./characterSheet.js');
            await sheet.openCharacterSheet(action.actorCharacterId, 'equipment');
        }
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
    const directCoverAttack = action?.actionKey === 'attack'
        && action?.targetType === 'character';
    if (!action || (action.targetType !== 'structure' && !directCoverAttack)) return false;
    const object = getLocationObjectAtScreen(clientX, clientY);
    const locationObject = object?.userData?.locationObject;
    if (!locationObject?.id) {
        showNotification('Выберите объект укрытия', 'system');
        return false;
    }
    try {
        const result = await Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), {
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
        const coverHit = result?.attack?.results?.find((entry) => entry?.cover_hit === true);
        const coverState = coverHit?.cover_damage;
        const coverDetails = coverHit
            ? ` · защита ${Number(coverHit.cover_protection) || 0}% → ${Number(coverState?.physical_protection) || 0}% · ОЗ ${Number(coverState?.hp) || 0}/${Number(coverState?.max_hp) || 0}`
            : '';
        showNotification(
            directCoverAttack
                ? `Атака укрытия: ${locationObject.name || 'объект'}${coverDetails}${result?.attack?.damage_total ? ` · урон за ним ${result.attack.damage_total}` : ''}`
                : action.actionKey === 'take_cover'
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
        const payload = {
            location_character_id: action.actorLocationCharacterId,
            action_key: action.actionKey,
            weapon_index: action.weaponIndex,
            fire_mode: action.fireMode,
            shot_count: action.shotCount,
            item_path: action.itemPath,
            explosive_source: action.explosiveSource,
            explosive_fire_mode: action.explosiveFireMode,
            explosive_fuse_mode: action.explosiveFuseMode,
            inventory_retrieval_action_points: action.inventoryRetrievalActionPoints,
            inventory_use_action_discount: action.inventoryUseActionDiscount,
            attribute_choice: action.attributeChoice,
            target_x: targetX,
            target_y: targetY,
            pending_action_id: `combat-point-${action.actorLocationCharacterId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        const result = await Server.performLocationCombatAction(
            window.currentLobbyId,
            getCurrentLocationId(),
            payload,
        );
        if (result?.pending_action) {
            deferredCombatActions.set(result.pending_action_id, payload);
            showNotification(
                'Действие начато. Недостающие ОД будут списаны в следующих ходах.',
                'system',
            );
            clearPendingCombatAction();
            return true;
        }
        if (typeof action.onResolve === 'function') {
            await action.onResolve({ targetX, targetY });
        }
        if (action.actionKey === 'mutant_jump') {
            showNotification(`Прыжок завершён: клетка ${targetX}, ${targetY}.`, 'success');
        }
        if (action.actionKey === 'escape_anomaly' && result?.anomaly) {
            const check = result.anomaly.check || {};
            const outcomes = {
                success: '\u0443\u0441\u043f\u0435\u0445, \u0431\u0435\u0437 \u0443\u0440\u043e\u043d\u0430',
                partial_exit: '\u0432\u044b\u0445\u043e\u0434 \u0441 25% \u0443\u0440\u043e\u043d\u0430',
                failure: '\u043f\u0440\u043e\u0432\u0430\u043b, 50% \u0443\u0440\u043e\u043d\u0430',
                severe_failure: '\u043f\u0440\u043e\u0432\u0430\u043b, 100% \u0443\u0440\u043e\u043d\u0430',
                critical_failure: '\u043a\u0440\u0438\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u043f\u0440\u043e\u0432\u0430\u043b, 125% \u0443\u0440\u043e\u043d\u0430',
            };
            showNotification(
                `${result.anomaly.name}: d20 ${check.roll} + ${check.modifier ?? 0} = ${check.total}, \u0421\u041b ${check.difficulty}. ${outcomes[result.anomaly.outcome] || result.anomaly.outcome}`,
                result.anomaly.exits ? 'success' : 'system',
            );
            clearPendingCombatAction();
            return true;
        }
        showNotification(
            `${action.actionKey === 'explosive_attack'
                ? 'Точка взрыва выбрана'
                : (action.fireMode === 'suppression' ? 'Подавление' : 'Стрельба по площади')}: ${targetX}, ${targetY}`,
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
function normalizeTeamColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

function updateCharacterTeamVisual(characterId, teamName, teamColor) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    entry.teamName = String(teamName || '').trim() || null;
    entry.teamColor = normalizeTeamColor(teamColor);
    const badge = entry.teamBadge;
    if (!badge) return;
    if (!entry.teamName) {
        badge.style.display = 'none';
        badge.textContent = '';
        return;
    }
    badge.textContent = entry.teamName;
    badge.style.display = 'block';
    badge.style.backgroundColor = entry.teamColor || '#56616a';
    badge.style.borderColor = entry.teamColor || '#8b98a3';
}

export function addCharacterToLocation(characterId, name, ownerId, ownerName, posX, posY, hpZones, effects, controlledBy, teamName = null, teamColor = null, facingX = 0, facingY = 1, isMutant = false, isNpc = false, gmHidden = false, mutantType = '') {
    if (characterModels.has(characterId)) {
        const old = characterModels.get(characterId);
        disposeObject(old.model);
        scene.remove(old.model);
        if (old.label) scene.remove(old.label);
        characterModels.delete(characterId);
    }
    const resolvedControlledBy = Number.isFinite(Number(controlledBy)) ? Number(controlledBy) : null;
    const fallbackOwnerId = Number.isFinite(Number(ownerId)) ? Number(ownerId) : null;
    const colorUserId = resolvedControlledBy ?? fallbackOwnerId ?? 0;
    const model = (isMutant && createMutantModel(mutantType)) || createCharacterModel(colorUserId);
    const tileHeight = getTileHeight(posX, posY);
    model.position.set(posX + 0.5, tileHeight, posY + 0.5);
    tintLocationMesh(model, darknessFactorAt(posX, posY));
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
    const gunpointBadge = document.createElement('div');
    gunpointBadge.style.cssText = `
        display:none;
        margin-top:3px;
        padding:2px 6px;
        border-radius:7px;
        background:rgba(72,45,8,.94);
        border:1px solid rgba(238,190,72,.9);
        color:#ffe9a8;
        font-size:10px;
        font-weight:800;
        line-height:1.2;
        white-space:nowrap;
    `;
    const anomalyBadge = document.createElement('div');
    anomalyBadge.style.cssText = `
        display:none;
        margin-top:3px;
        padding:2px 6px;
        border-radius:7px;
        background:rgba(24,49,33,.94);
        border:1px solid rgba(98,205,127,.9);
        color:#caffd5;
        font-size:10px;
        font-weight:800;
        line-height:1.2;
        white-space:nowrap;
    `;
    const teamBadge = document.createElement('div');
    teamBadge.style.cssText = `
        display:none;
        margin-top:3px;
        padding:2px 6px;
        border:1px solid transparent;
        border-radius:7px;
        color:#fff;
        font-size:10px;
        font-weight:800;
        line-height:1.2;
        white-space:nowrap;
    `;
    div.append(nameLine, teamBadge, grappleBadge, gunpointBadge, anomalyBadge);
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
    label.position.set(posX + 0.5, tileHeight + (model.userData.labelHeight || 1.55), posY + 0.5);
    scene.add(label);

    characterModels.set(characterId, {
        model,
        label,
        name,
        ownerId: colorUserId,
        characterOwnerId: fallbackOwnerId,
        ownerName,
        hpZones,
        effects,
        isMutant: Boolean(isMutant),
        mutantType,
        isNpc: Boolean(isNpc),
        gmHidden: characterVisibilityOverrides.get(String(characterId)) ?? Boolean(gmHidden),
        camouflaged: false,
        posX,
        posY,
        posture: 'standing',
        controlledBy: resolvedControlledBy ?? fallbackOwnerId,
        grappleBadge,
        gunpointBadge,
        anomalyBadge,
        teamBadge,
        teamName: null,
        teamColor: null,
    });
    updateCharacterTeamVisual(characterId, teamName, teamColor);
    applyCharacterFacingVisual(characterId, facingX, facingY);
    const combatCharacter = findCombatCharacterByCharacterId(characterId);
    if (combatCharacter?.posture) {
        applyCharacterPostureVisual(characterId, combatCharacter.posture);
    }
    applyCharacterGrappleVisual(characterId, combatCharacter);
    applyCharacterGunpointVisual(characterId, combatCharacter);
    applyCharacterAnomalyVisual(characterId, combatCharacter);
    applyCharacterVisibilityVisual(characterId, { camouflaged: combatCharacter?.camouflaged }, true);
    invalidateMovementMapCache();
    applyFogOfWar();
}

export async function refreshLocationTeams() {
    const locationId = getCurrentLocationId();
    if (!locationId || !window.currentLobbyId) return;
    try {
        const result = await Server.getLocationTeams(window.currentLobbyId, locationId);
        (result.characters || []).forEach((character) => {
            updateCharacterTeamVisual(
                character.character_id,
                character.team_name,
                character.team_color,
            );
            const combatCharacter = findCombatCharacterByCharacterId(character.character_id);
            if (combatCharacter) {
                combatCharacter.team_name = character.team_name;
                combatCharacter.team_color = character.team_color;
            }
        });
        applyFogOfWar();
        renderCombatHud();
    } catch (error) {
        console.warn('Unable to refresh location teams', error);
    }
}

function fogIsActive() {
    return Boolean(
        currentLocationData
        && Number(localStorage.getItem('user_id'))
        && (!window.isGM || gmVisionCharacterId !== null),
    );
}

function toggleGmVision(characterId = null) {
    if (!window.isGM) return;
    const nextCharacterId = Number(characterId);
    gmVisionCharacterId = Number.isFinite(nextCharacterId) && nextCharacterId > 0
        && gmVisionCharacterId !== nextCharacterId
        ? nextCharacterId
        : null;
    applyFogOfWar();
    renderCombatHud();
    const entry = gmVisionCharacterId === null ? null : getCharacterModelEntry(gmVisionCharacterId);
    showNotification(
        entry
            ? `Режим обзора: ${entry.name}`
            : 'Полный обзор ГМа восстановлен',
        'system',
    );
}

function clearFogMemoryGhosts() {
    fogMemoryGhosts.forEach((ghost) => {
        scene?.remove(ghost);
        disposeObject(ghost);
    });
    fogMemoryGhosts = new Map();
    fogMemoryDecorationTemplates.forEach((template) => disposeObject(template));
    fogMemoryDecorationTemplates = new Map();
}

function getFogMemoryStorageKey() {
    const userId = Number(localStorage.getItem('user_id'));
    const lobbyId = Number(window.currentLobbyId);
    const locationId = Number(getCurrentLocationId());
    return userId && lobbyId && locationId
        ? `ttrpg:fog-memory:${userId}:${lobbyId}:${locationId}`
        : null;
}

function loadFogMemory() {
    const storageKey = getFogMemoryStorageKey();
    if (storageKey === fogMemoryKey) return;
    fogMemoryKey = storageKey;
    fogMemory = new Map();
    if (!storageKey) return;
    try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
        Object.entries(stored).forEach(([key, value]) => {
            if (value && typeof value === 'object') fogMemory.set(key, value);
        });
    } catch (error) {
        console.warn('Unable to load fog memory', error);
    }
}

function saveFogMemory() {
    if (!fogMemoryKey) return;
    try {
        localStorage.setItem(fogMemoryKey, JSON.stringify(Object.fromEntries(fogMemory)));
    } catch (error) {
        console.warn('Unable to save fog memory', error);
    }
}

function rememberFogTile(x, y) {
    const key = `${x}:${y}`;
    const tile = currentLocationData?.tiles_data?.[y]?.[x] || {};
    const next = {
        terrain: String(tile.terrain || 'grass'),
        height: Number(tile.height) || 1,
    };
    const previous = fogMemory.get(key);
    if (previous?.terrain === next.terrain && previous?.height === next.height) {
        return { memory: previous, changed: false };
    }
    fogMemory.set(key, next);
    return { memory: next, changed: true };
}

function setFogGhostAppearance(root) {
    root.traverse((child) => {
        child.raycast = () => {};
        if (!child.isMesh) return;
        if (child.geometry) child.geometry = child.geometry.clone();
        const isMaterialArray = Array.isArray(child.material);
        const materials = isMaterialArray ? child.material : [child.material];
        const ghostMaterials = materials.map((material) => {
            const ghostMaterial = material.clone();
            if (ghostMaterial.color) ghostMaterial.color.multiplyScalar(0.42);
            ghostMaterial.transparent = true;
            ghostMaterial.opacity = Math.min(Number(ghostMaterial.opacity ?? 1), 0.48);
            ghostMaterial.depthWrite = false;
            return ghostMaterial;
        });
        child.material = isMaterialArray ? ghostMaterials : ghostMaterials[0];
    });
    root.userData.fogMemoryGhost = true;
    return root;
}

function makeGmHiddenGhost(root) {
    const treated = new Set();
    const tint = new THREE.Color(0x91d9d1);
    root.traverse((child) => {
        if (!child.isMesh && !child.isSprite) return;
        child.castShadow = false;
        child.receiveShadow = false;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            if (!material || treated.has(material)) continue;
            treated.add(material);
            material.color?.lerp(tint, 0.65);
            material.emissive?.set(0x246d70);
            if (material.emissive) material.emissiveIntensity = 0.45;
            material.transparent = true;
            material.opacity = Math.min(Number(material.opacity ?? 1), 0.38);
            material.depthWrite = false;
            material.side = THREE.DoubleSide;
        }
    });
    root.userData.gmHiddenGhost = true;
    return root;
}

function cloneFogGhost(root) {
    const ghost = root.clone(true);
    ghost.traverse((child) => {
        child.raycast = () => {};
        if (!child.isMesh) return;
        if (child.geometry) child.geometry = child.geometry.clone();
        const isMaterialArray = Array.isArray(child.material);
        const materials = isMaterialArray ? child.material : [child.material];
        const clonedMaterials = materials.map((material) => material.clone());
        child.material = isMaterialArray ? clonedMaterials : clonedMaterials[0];
    });
    ghost.userData.fogMemoryGhost = true;
    return ghost;
}

function applyFogGhostPosture(model, posture) {
    const normalized = COMBAT_POSTURES[posture] ? posture : 'standing';
    const body = model.children.find((child) => child.userData?.posturePart === 'body');
    const head = model.children.find((child) => child.userData?.posturePart === 'head');
    if (!body || !head) return;
    body.rotation.z = normalized === 'prone' ? Math.PI / 2 : 0;
    body.scale.set(1, normalized === 'sitting' ? 0.68 : 1, 1);
    body.position.set(0, normalized === 'prone' ? 0.25 : normalized === 'sitting' ? 0.25 : 0.35, 0);
    head.position.set(
        normalized === 'prone' ? 0.48 : 0,
        normalized === 'prone' ? 0.22 : normalized === 'sitting' ? 0.58 : 0.8,
        0,
    );
}

function rememberFogContents(x, y) {
    const key = `${x}:${y}`;
    const memory = fogMemory.get(key);
    if (!memory) return false;
    const decorations = objectMeshes
        .filter((mesh) => mesh.userData?.objType === 'anomaly'
            && !mesh.userData?.sourceObject?.gm_hidden
            && Number(mesh.userData.tileX) === x && Number(mesh.userData.tileZ) === y);
    const previous = (memory.decorations || []).filter(type => type === 'anomaly');
    decorations.forEach((mesh, index) => {
        const decorationKey = `${key}:${index}:anomaly`;
        const current = fogMemoryDecorationTemplates.get(decorationKey);
        if (current) disposeObject(current);
        fogMemoryDecorationTemplates.set(decorationKey, setFogGhostAppearance(mesh.clone(true)));
    });
    for (let index = decorations.length; index < previous.length; index++) {
        const decorationKey = `${key}:${index}:anomaly`;
        const template = fogMemoryDecorationTemplates.get(decorationKey);
        if (template) disposeObject(template);
        fogMemoryDecorationTemplates.delete(decorationKey);
    }
    memory.decorations = decorations.map(() => 'anomaly');
    return previous.length !== decorations.length;
}

function rememberVisibleCharacters(sources) {
    let changed = false;
    const visible = new Map();
    const byTile = new Map();
    characterModels.forEach((entry, characterId) => {
        if (!isCharacterVisibleToPlayer(entry, sources)) return;
        const id = Number(characterId);
        const x = Number(entry.posX);
        const y = Number(entry.posY);
        const key = `${x}:${y}`;
        if (!fogMemory.has(key)) rememberFogTile(x, y);
        const snapshot = {
            characterId: id, ownerId: Number(entry.ownerId) || 0,
            mutantType: entry.mutantType || '',
            posX: x, posY: y, posture: entry.posture || 'standing',
            facingX: Number(entry.facingX) || 0, facingY: Number(entry.facingY ?? 1),
        };
        visible.set(id, snapshot);
        if (!byTile.has(key)) byTile.set(key, []);
        byTile.get(key).push(snapshot);
    });
    fogMemory.forEach((memory, tileKey) => {
        const previous = memory.characters || [];
        const observed = byTile.get(tileKey) || [];
        if (!previous.length && !observed.length) return;
        const [tileX, tileY] = tileKey.split(':').map(Number);
        const tileVisible = isTileVisibleToPlayer(tileX, tileY, sources);
        const next = previous.filter(item => {
            const id = Number(item.characterId);
            if (visible.has(id)) return false;
            const current = characterModels.get(id);
            if (current?.gmHidden || current?.camouflaged) return false;
            return !tileVisible || Boolean(current && Number(current.posX) === tileX
                && Number(current.posY) === tileY);
        }).concat(observed);
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
            memory.characters = next;
            changed = true;
        }
    });
    return changed;
}

function getFogGhost(key, createGhost) {
    let ghost = fogMemoryGhosts.get(key);
    if (!ghost) {
        ghost = createGhost();
        if (!ghost) return null;
        fogMemoryGhosts.set(key, ghost);
        scene.add(ghost);
    }
    return ghost;
}

function createCharacterFogGhost(snapshot) {
    const ghost = setFogGhostAppearance(createMutantModel(snapshot.mutantType)
        || createCharacterModel(snapshot.ownerId));
    ghost.position.set(snapshot.posX + 0.5, Number(snapshot.height) || 1, snapshot.posY + 0.5);
    ghost.rotation.y = Math.atan2(Number(snapshot.facingX) || 0, Number(snapshot.facingY) || 1);
    applyFogGhostPosture(ghost, snapshot.posture);
    return ghost;
}

function syncFogMemoryGhosts(active, sources) {
    const desired = new Map();
    if (active) {
        fogMemory.forEach((memory, tileKey) => {
            (memory.characters || []).forEach((snapshot) => {
                const current = characterModels.get(Number(snapshot.characterId));
                if (current?.gmHidden || current?.camouflaged) return;
                if (current && isCharacterVisibleToPlayer(current, sources)) return;
                const [x, y] = tileKey.split(':').map(Number);
                if (isTileVisibleToPlayer(x, y, sources)
                    && (!current || Number(current.posX) !== x || Number(current.posY) !== y)) return;
                desired.set(`character:${snapshot.characterId}`, {
                    create: () => createCharacterFogGhost({ ...snapshot, height: memory.height }),
                });
            });
            (memory.decorations || []).forEach((type, index) => {
                if (type !== 'anomaly') return;
                const template = fogMemoryDecorationTemplates.get(`${tileKey}:${index}:${type}`);
                if (!template) return;
                const [x, y] = tileKey.split(':').map(Number);
                const visibleAnomalies = (currentLocationData?.tiles_data?.[y]?.[x]?.objects || [])
                    .filter(object => object.type === 'anomaly' && !object.gm_hidden);
                if (!visibleAnomalies[index]) return;
                if (isTileVisibleToPlayer(x, y, sources)) return;
                desired.set(`decoration:${tileKey}:${index}:${type}`, {
                    create: () => cloneFogGhost(template),
                });
            });
        });
    }
    fogMemoryGhosts.forEach((ghost, key) => {
        if (desired.has(key)) return;
        scene.remove(ghost);
        disposeObject(ghost);
        fogMemoryGhosts.delete(key);
    });
    desired.forEach((definition, key) => {
        const ghost = getFogGhost(key, definition.create);
        if (ghost) ghost.visible = true;
    });
}

function getFogVisionSources() {
    if (window.isGM && gmVisionCharacterId !== null) {
        const selected = characterModels.get(gmVisionCharacterId);
        return selected ? [selected] : [];
    }
    const userId = Number(localStorage.getItem('user_id'));
    const entries = Array.from(characterModels.values());
    const directSources = entries.filter((entry) => (
        Number(entry.controlledBy) === userId || Number(entry.characterOwnerId) === userId
    ));
    const alliedTeams = new Set(
        directSources.map((entry) => String(entry.teamName || '').trim()).filter(Boolean),
    );
    const teamSources = alliedTeams.size
        ? entries.filter((entry) => alliedTeams.has(String(entry.teamName || '').trim()))
        : [];
    return Array.from(new Set([...directSources, ...teamSources]));
}

function blocksVision(object) {
    const properties = object?.properties || {};
    if (properties.blocks_vision === false) return false;
    return properties.blocks_vision === true || [
        'wall', 'cover', 'crate', 'box', 'military_crate', 'chest', 'fence', 'rock', 'house', 'shelf', 'table', 'chair',
    ].includes(String(object?.type || '').toLowerCase());
}

function getFogObjectHeight(object) {
    const properties = object?.properties || {};
    const dimensions = properties.dimensions || {};
    const explicit = Number(dimensions.height ?? properties.height ?? object?.height);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const type = String(object?.type || '').toLowerCase();
    return {
        fence: 1.2,
        chair: 0.9,
        chest: 1,
        table: 1,
        shelf: 2,
        tree: 2.5,
        rock: 1.2,
        house: 5,
        tent: 2.2,
        wall: 2.5,
    }[type] || 1.5;
}

function getVisionBlockerHeight(x, y, rayHeight) {
    const key = `${x}:${y}:${Math.round(rayHeight * 10)}`;
    if (visionBlockerHeightCache?.has(key)) return visionBlockerHeightCache.get(key);
    const tile = currentLocationData?.tiles_data?.[y]?.[x];
    const tileObjects = (tile?.objects || []).filter((object) => blocksVision(object));
    const locationObjects = (currentLocationData?.objects || []).filter((object) => {
        if (!blocksVision(object) || !tileHasObjectFootprint(object, x, y)) return false;
        if (object.type !== 'wall') return true;
        return !(currentLocationData.objects || []).some(portal => {
            if (!['door', 'window'].includes(portal.type) || !portal.properties?.is_open
                || !tileHasObjectFootprint(portal, x, y)) return false;
            const opening = doorOnWall(portal, object);
            if (!opening) return false;
            const bottom = getTileHeight(x, y) + Number(object.properties?.elevation || 0) + opening.bottom;
            return rayHeight >= bottom && rayHeight <= bottom + opening.height;
        });
    });
    const height = [...tileObjects, ...locationObjects].reduce(
        (height, object) => Math.max(height, getTileHeight(x, y) + getFogObjectHeight(object)),
        -Infinity,
    );
    visionBlockerHeightCache?.set(key, height);
    return height;
}

function visionEyeHeight(entry) {
    const posture = entry?.posture || 'standing';
    const eyeOffset = posture === 'prone' ? 0.35 : posture === 'sitting' ? 1.05 : 1.65;
    return getTileHeight(entry?.posX ?? 0, entry?.posY ?? 0) + eyeOffset;
}

function hasLineOfSight(sourceX, sourceY, targetX, targetY, sourceHeight = null, targetHeight = null) {
    let x = sourceX;
    let y = sourceY;
    const dx = Math.abs(targetX - sourceX);
    const sx = sourceX < targetX ? 1 : -1;
    const dy = -Math.abs(targetY - sourceY);
    const sy = sourceY < targetY ? 1 : -1;
    let error = dx + dy;
    const totalSteps = Math.max(dx, -dy, 1);
    const fromHeight = sourceHeight ?? (getTileHeight(sourceX, sourceY) + 1.65);
    const toHeight = targetHeight ?? (getTileHeight(targetX, targetY) + 1.65);
    let steps = 0;
    while (x !== targetX || y !== targetY) {
        const twiceError = 2 * error;
        if (twiceError >= dy) {
            error += dy;
            x += sx;
        }
        if (twiceError <= dx) {
            error += dx;
            y += sy;
        }
        steps += 1;
        const rayHeight = fromHeight + (toHeight - fromHeight) * (steps / totalSteps);
        const blockerHeight = getVisionBlockerHeight(x, y, rayHeight);
        // A low obstacle only hides what is physically below its top edge.
        if (Number.isFinite(blockerHeight) && blockerHeight >= rayHeight) {
            return x === targetX && y === targetY;
        }
    }
    return lightPathOpen(
        { x: sourceX + 0.5, z: sourceY + 0.5 },
        { x: targetX + 0.5, z: targetY + 0.5 },
        currentLocationData?.objects || [],
    );
}

function isPointVisibleToPlayer(x, y, targetHeight, sources) {
    return sources.some((source) => {
        const sourceX = Number(source.posX);
        const sourceY = Number(source.posY);
        const dx = x - sourceX;
        const dy = y - sourceY;
        const distance = Math.hypot(dx, dy);
        if (!distance) return true;
        if (darknessFactorAt(x, y) < 0.12) return false;
        if (distance > FOG_VIEW_RADIUS) return false;
        const facingX = Number(source.facingX) || 0;
        const facingY = Number(source.facingY ?? 1);
        const facingLength = Math.hypot(facingX, facingY);
        const cosine = (dx * facingX + dy * facingY) / (distance * facingLength);
        if (cosine < Math.cos(FOG_VIEW_HALF_ANGLE)) return false;
        return hasLineOfSight(sourceX, sourceY, x, y, visionEyeHeight(source), targetHeight);
    });
}

function isTileVisibleToPlayer(x, y, sources) {
    return isPointVisibleToPlayer(x, y, getTileHeight(x, y) + 1.65, sources);
}

function isCharacterVisibleToPlayer(entry, sources) {
    if (entry.gmHidden || entry.camouflaged) return false;
    const height = { standing: 1.7, sitting: 1.1, prone: 0.4 }[entry.posture] ?? 1.7;
    return isPointVisibleToPlayer(
        Number(entry.posX), Number(entry.posY), getTileHeight(entry.posX, entry.posY) + height, sources,
    );
}

function combatCharacterVisibleToPlayer(character) {
    return Boolean(window.isGM || !(character?.gm_hidden || character?.camouflaged));
}

function isFogHiddenObject(object) {
    const type = String(object?.type || '').toLowerCase();
    return type === 'anomaly' || type === 'ground_item' || type === 'corpse'
        || type === 'body' || object?.properties?.is_ground_item === true
        || object?.properties?.is_corpse === true;
}

function clearFogOverlay() {
    fogOverlayMeshes.forEach((mesh) => {
        scene?.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
    });
    fogOverlayMeshes.clear();
    fogSurfaceData = null;
}

function updateFogOverlay(active, sources) {
    if (!active) {
        fogOverlayMeshes.forEach(mesh => { mesh.visible = false; });
        return;
    }
    const width = Number(currentLocationData?.grid_width) || 0;
    const height = Number(currentLocationData?.grid_height) || 0;
    const capacity = width * height;
    if (!capacity) return;
    fogSurfaceData ??= buildFogSurfaceData(currentLocationData.tiles_data);
    const tiles = { explored: [], unexplored: [] };
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (isTileVisibleToPlayer(x, y, sources)) continue;
            const key = fogMemory.has(`${x}:${y}`) ? 'explored' : 'unexplored';
            tiles[key].push(y * width + x);
        }
    }
    for (const [kind, tileNumbers] of Object.entries(tiles)) {
        let mesh = fogOverlayMeshes.get(kind);
        if (!mesh) {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.Float32BufferAttribute(fogSurfaceData.positions, 3));
            const indexArray = fogSurfaceData.positions.length / 3 > 65535
                ? new Uint32Array(capacity * 24) : new Uint16Array(capacity * 24);
            const indexBuffer = new THREE.BufferAttribute(indexArray, 1);
            indexBuffer.setUsage(THREE.DynamicDrawUsage);
            geometry.setIndex(indexBuffer);
            mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
                color: 0x071019,
                transparent: true,
                opacity: kind === 'explored' ? 0.24 : 0.48,
                depthWrite: false,
                side: THREE.DoubleSide,
            }));
            mesh.raycast = () => {};
            mesh.frustumCulled = false;
            mesh.renderOrder = 4;
            scene.add(mesh);
            fogOverlayMeshes.set(kind, mesh);
        }
        const index = mesh.geometry.index;
        let count = 0;
        for (const tileNumber of tileNumbers) {
            const triangles = fogSurfaceData.tileIndices[tileNumber] || [];
            for (const vertex of triangles) index.array[count++] = vertex;
        }
        mesh.geometry.setDrawRange(0, count);
        mesh.visible = count > 0;
        index.needsUpdate = true;
    }
}

function applyFogOfWar() {
    if (!scene || !currentLocationData) return;
    visionBlockerHeightCache = new Map();
    const active = fogIsActive();
    loadFogMemory();
    const sources = active ? getFogVisionSources() : [];
    let learnedNewTiles = false;
    if (active) {
        const anomalyTiles = new Set();
        objectMeshes.forEach((mesh) => {
            if (mesh.userData?.objType === 'anomaly') {
                anomalyTiles.add(`${mesh.userData.tileX}:${mesh.userData.tileZ}`);
            }
        });
        fogMemory.forEach((memory, key) => {
            if (memory.decorations?.includes('anomaly')) anomalyTiles.add(key);
        });
        anomalyTiles.forEach((key) => {
            const [x, y] = key.split(':').map(Number);
            if (!isTileVisibleToPlayer(x, y, sources)) return;
            const remembered = rememberFogTile(x, y);
            learnedNewTiles = rememberFogContents(x, y) || remembered.changed || learnedNewTiles;
        });
        learnedNewTiles = rememberVisibleCharacters(sources) || learnedNewTiles;
    }
    if (learnedNewTiles) saveFogMemory();
    updateFogOverlay(active, sources);
    characterModels.forEach((entry) => {
        const hidden = entry.gmHidden || entry.camouflaged;
        const visible = (globalThis.window?.isGM && hidden)
            || (!hidden && (!active || isCharacterVisibleToPlayer(entry, sources)));
        entry.model.visible = visible;
        entry.label.visible = visible;
    });
    objectMeshes.forEach((mesh) => {
        if (mesh.userData?.sourceObject?.gm_hidden) {
            mesh.visible = Boolean(window.isGM);
            return;
        }
        if (mesh.userData?.objType !== 'anomaly') {
            mesh.visible = true;
            return;
        }
        const { tileX, tileZ } = mesh.userData || {};
        const sourceObject = mesh.userData?.sourceObject || { type: mesh.userData?.objType };
        mesh.visible = !active || isPointVisibleToPlayer(
            tileX,
            tileZ,
            getTileHeight(tileX, tileZ) + getFogObjectHeight(sourceObject),
            sources,
        );
    });
    locationObjectMeshes.forEach((mesh) => {
        const object = mesh.userData?.locationObject || {};
        if (object.properties?.gm_hidden) {
            mesh.visible = Boolean(window.isGM);
            return;
        }
        if (!isFogHiddenObject(object)) {
            mesh.visible = true;
            return;
        }
        const position = getObjectGridPosition(object);
        mesh.visible = !active || isPointVisibleToPlayer(
            position.x ?? 0,
            position.y ?? 0,
            getTileHeight(position.x ?? 0, position.y ?? 0) + getFogObjectHeight(object),
            sources,
        );
    });
    syncFogMemoryGhosts(active, sources);
    visionBlockerHeightCache = null;
}

function closeTeamManagementModal() {
    if (teamManagementModal) teamManagementModal.remove();
    teamManagementModal = null;
}

async function showTeamManagementModal() {
    if (!window.isGM || !window.currentLobbyId || !getCurrentLocationId()) return;
    let characters;
    try {
        const result = await Server.getLocationTeams(window.currentLobbyId, getCurrentLocationId());
        characters = Array.isArray(result.characters) ? result.characters : [];
    } catch (error) {
        showNotification(error.message || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u043a\u043e\u043c\u0430\u043d\u0434\u044b', 'error');
        return;
    }
    closeTeamManagementModal();
    const assignments = new Map(characters.map((character) => [
        Number(character.location_character_id),
        String(character.team_name || '').trim(),
    ]));
    const teams = [];
    characters.forEach((character) => {
        const name = String(character.team_name || '').trim();
        if (!name || teams.some((team) => team.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return;
        teams.push({
            name,
            color: normalizeTeamColor(character.team_color) || '#64748b',
        });
    });

    teamManagementModal = document.createElement('div');
    teamManagementModal.className = 'modal team-management-modal';
    teamManagementModal.style.cssText = `
        position:fixed; inset:0; z-index:1265; display:flex; align-items:center;
        justify-content:center; padding:16px; background:rgba(4,7,10,.68);
    `;
    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.cssText = `
        width:min(700px, calc(100vw - 32px)); max-height:calc(100vh - 32px);
        display:flex; flex-direction:column; gap:12px; padding:18px; overflow:hidden;
    `;
    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
    const heading = document.createElement('div');
    heading.innerHTML = '<h3 style="margin:0;">\u041a\u043e\u043c\u0430\u043d\u0434\u044b \u043f\u043e\u0434\u043b\u043e\u043a\u0430\u0446\u0438\u0438</h3><div style="margin-top:4px;font-size:12px;opacity:.72;">\u041a\u043e\u043c\u0430\u043d\u0434\u044b \u0432\u0438\u0434\u043d\u044b \u0432 \u043f\u043e\u0440\u044f\u0434\u043a\u0435 \u0445\u043e\u0434\u0430 \u0438 \u043d\u0430\u0434 \u043c\u043e\u0434\u0435\u043b\u044f\u043c\u0438.</div>';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'btn btn-sm btn-secondary';
    closeButton.textContent = '\u00d7';
    closeButton.onclick = closeTeamManagementModal;
    header.append(heading, closeButton);

    const addRow = document.createElement('div');
    addRow.style.cssText = 'display:grid; grid-template-columns:minmax(0,1fr) 56px auto; gap:8px; align-items:end;';
    const newName = document.createElement('input');
    newName.type = 'text';
    newName.maxLength = 80;
    newName.placeholder = '\u041d\u043e\u0432\u0430\u044f \u043a\u043e\u043c\u0430\u043d\u0434\u0430';
    const newColor = document.createElement('input');
    newColor.type = 'color';
    newColor.value = '#64748b';
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn btn-secondary';
    addButton.textContent = '\u0421\u043e\u0437\u0434\u0430\u0442\u044c';
    addRow.append(newName, newColor, addButton);

    const teamList = document.createElement('div');
    const characterList = document.createElement('div');
    characterList.style.cssText = 'display:grid; gap:7px; overflow-y:auto; min-height:0; padding-right:4px;';
    const renderLists = () => {
        teamList.replaceChildren();
        if (teams.length) {
            teams.forEach((team, index) => {
                const row = document.createElement('div');
                row.style.cssText = 'display:grid; grid-template-columns:28px minmax(0,1fr) 42px; align-items:center; gap:8px;';
                const dot = document.createElement('span');
                dot.style.cssText = `width:16px;height:16px;border-radius:50%;background:${team.color};border:1px solid rgba(255,255,255,.4);`;
                const name = document.createElement('strong');
                name.textContent = team.name;
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'btn btn-sm btn-secondary';
                remove.textContent = '\u00d7';
                remove.title = '\u0420\u0430\u0441\u0444\u043e\u0440\u043c\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u043a\u043e\u043c\u0430\u043d\u0434\u0443';
                remove.onclick = () => {
                    const removed = teams.splice(index, 1)[0];
                    assignments.forEach((value, key) => {
                        if (value === removed.name) assignments.set(key, '');
                    });
                    renderLists();
                };
                row.append(dot, name, remove);
                teamList.append(row);
            });
        }
        characterList.replaceChildren();
        characters.forEach((character) => {
            const row = document.createElement('label');
            row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,.65fr);gap:12px;align-items:center;padding:9px 10px;border:1px solid rgba(255,255,255,.11);border-radius:9px;background:rgba(255,255,255,.035);';
            const name = document.createElement('strong');
            name.textContent = character.name || `#${character.character_id}`;
            const select = document.createElement('select');
            const none = document.createElement('option');
            none.value = '';
            none.textContent = '\u0411\u0435\u0437 \u043a\u043e\u043c\u0430\u043d\u0434\u044b';
            select.appendChild(none);
            teams.forEach((team) => {
                const option = document.createElement('option');
                option.value = team.name;
                option.textContent = team.name;
                select.appendChild(option);
            });
            select.value = assignments.get(Number(character.location_character_id)) || '';
            select.onchange = () => assignments.set(Number(character.location_character_id), select.value);
            row.append(name, select);
            characterList.append(row);
        });
    };
    addButton.onclick = () => {
        const name = newName.value.trim();
        if (!name) return;
        if (teams.some((team) => team.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
            showNotification('\u041a\u043e\u043c\u0430\u043d\u0434\u0430 \u0441 \u0442\u0430\u043a\u0438\u043c \u0438\u043c\u0435\u043d\u0435\u043c \u0443\u0436\u0435 \u0435\u0441\u0442\u044c', 'system');
            return;
        }
        teams.push({ name, color: normalizeTeamColor(newColor.value) || '#64748b' });
        newName.value = '';
        renderLists();
    };
    renderLists();

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex; justify-content:flex-end; gap:8px;';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn btn-secondary'; cancel.textContent = '\u041e\u0442\u043c\u0435\u043d\u0430'; cancel.onclick = closeTeamManagementModal;
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c';
    save.onclick = async () => {
        const teamByName = new Map(teams.map((team) => [team.name, team]));
        const payload = characters.map((character) => {
            const name = assignments.get(Number(character.location_character_id)) || '';
            const team = teamByName.get(name);
            return {
                location_character_id: Number(character.location_character_id),
                team_name: team?.name || '',
                team_color: team?.color || '',
            };
        });
        save.disabled = true;
        try {
            const result = await Server.updateLocationTeams(window.currentLobbyId, getCurrentLocationId(), payload);
            (result.characters || []).forEach((character) => updateCharacterTeamVisual(character.character_id, character.team_name, character.team_color));
            closeTeamManagementModal();
            await refreshLocationTeams();
        } catch (error) {
            save.disabled = false;
            showNotification(error.message || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043a\u043e\u043c\u0430\u043d\u0434\u044b', 'error');
        }
    };
    footer.append(cancel, save);
    content.append(header, addRow, teamList, characterList, footer);
    teamManagementModal.appendChild(content);
    teamManagementModal.addEventListener('pointerdown', (event) => {
        if (event.target === teamManagementModal) closeTeamManagementModal();
    });
    document.body.appendChild(teamManagementModal);
}

export function refreshUserColor(userId) {
    const normalizedUserId = Number(userId);
    const colorHex = getUserColorHex(normalizedUserId);
    characterModels.forEach((entry) => {
        if (Number(entry.ownerId) !== normalizedUserId) return;
        entry.model?.traverse((child) => {
            if (
                child.userData?.posturePart === 'body'
                && child.material?.color
            ) {
                child.material.color.set(colorHex);
            }
        });
        const labelElement = entry.label?.element;
        if (labelElement) {
            labelElement.style.backgroundColor = colorHex;
            labelElement.style.borderColor = colorHex;
        }
    });
}

export function applyCharacterPostureVisual(characterId, posture = 'standing') {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    const normalized = COMBAT_POSTURES[posture] ? posture : 'standing';
    const labelOffset = entry.model.userData.labelHeight && normalized === 'standing'
        ? entry.model.userData.labelHeight
        : normalized === 'prone' ? 0.95 : normalized === 'sitting' ? 1.25 : 1.55;
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
    applyFogOfWar();
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

function applyCharacterGunpointVisual(characterId, combatCharacter = null) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry?.gunpointBadge) return;
    const character = combatCharacter || findCombatCharacterByCharacterId(characterId);
    const gunpoint = character?.gunpoint;
    const text = gunpoint
        ? `Ствол к: ${gunpoint.target_name || 'цели'}`
        : '';
    entry.gunpointBadge.textContent = text;
    entry.gunpointBadge.style.display = text ? 'block' : 'none';
    entry.model.userData.gunpointTargetId = gunpoint?.target_character_id || null;
}

function applyCharacterAnomalyVisual(characterId, combatCharacter = null) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry?.anomalyBadge) return;
    const character = combatCharacter || findCombatCharacterByCharacterId(characterId);
    const anomaly = character?.active_anomaly;
    entry.anomalyBadge.textContent = anomaly ? `\u0410\u043d\u043e\u043c\u0430\u043b\u0438\u044f: ${anomaly.name}` : '';
    entry.anomalyBadge.style.display = anomaly ? 'block' : 'none';
    entry.model.userData.activeAnomaly = anomaly?.key || null;
}

function applyCharacterVisibilityVisual(characterId, changes = {}, deferRefresh = false) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    if (changes.gmHidden !== undefined) entry.gmHidden = Boolean(changes.gmHidden);
    if (changes.camouflaged !== undefined) entry.camouflaged = Boolean(changes.camouflaged);
    if (changes.isNpc !== undefined) entry.isNpc = Boolean(changes.isNpc);
    const ghost = Boolean(window.isGM && (entry.gmHidden || entry.camouflaged));
    if (ghost && !entry.visibilityAppearance) {
        entry.visibilityAppearance = [];
        entry.model.traverse(child => {
            if (!child.isMesh && !child.isSprite) return;
            const original = child.material;
            entry.visibilityAppearance.push({ child, original,
                castShadow: child.castShadow, receiveShadow: child.receiveShadow });
            child.material = Array.isArray(original)
                ? original.map(material => material.clone()) : original.clone();
        });
        makeGmHiddenGhost(entry.model);
    } else if (!ghost && entry.visibilityAppearance) {
        entry.visibilityAppearance.forEach(({ child, original, castShadow, receiveShadow }) => {
            const ghostMaterials = Array.isArray(child.material) ? child.material : [child.material];
            ghostMaterials.forEach(material => material.dispose());
            child.material = original;
            child.castShadow = castShadow;
            child.receiveShadow = receiveShadow;
        });
        entry.visibilityAppearance = null;
        delete entry.model.userData.gmHiddenGhost;
        tintLocationMesh(entry.model, darknessFactorAt(entry.posX, entry.posY));
    }
    entry.label.element.style.opacity = ghost ? '0.55' : '1';
    if (!deferRefresh) applyFogOfWar();
}

export function applyCharacterVisibilityUpdate(characterId, gmHidden) {
    characterVisibilityOverrides.set(String(characterId), Boolean(gmHidden));
    (combatState?.characters || []).forEach(character => {
        if (Number(character.character_id) === Number(characterId)) character.gm_hidden = gmHidden;
    });
    if (Number(combatState?.current_character?.character_id) === Number(characterId)) {
        combatState.current_character.gm_hidden = gmHidden;
    }
    applyCharacterVisibilityVisual(characterId, { gmHidden });
    renderCombatHud();
}

export function updateCharacterPosition(characterId, posX, posY, options = {}) {
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    const tileHeight = getTileHeight(posX, posY);
    entry.model.position.set(posX + 0.5, tileHeight, posY + 0.5);
    tintLocationMesh(entry.model, darknessFactorAt(posX, posY));
    const labelOffset = entry.model.userData.labelHeight && entry.posture === 'standing'
        ? entry.model.userData.labelHeight
        : entry.posture === 'prone' ? 0.95 : entry.posture === 'sitting' ? 1.25 : 1.55;
    entry.label.position.set(posX + 0.5, tileHeight + labelOffset, posY + 0.5);
    entry.posX = posX;
    entry.posY = posY;
    if (!options.deferRefresh) {
        invalidateMovementMapCache();
        applyFogOfWar();
    }
}

export function removeCharacterFromLocation(characterId) {
    characterVisibilityOverrides.delete(String(characterId));
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return;
    if (gmVisionCharacterId === characterId) gmVisionCharacterId = null;
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
    applyFogOfWar();
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
    characterVisibilityOverrides.clear();
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

function closeCombatStartRequestMenu() {
    combatStartRequestMenu?.remove();
    combatStartRequestMenu = null;
}

function showCombatStartRequestMenu() {
    if (!window.isGM || !window.isLocationActive || combatState?.status === 'active') {
        closeCombatStartRequestMenu();
        return;
    }
    const startRequest = pendingCombatStartRequests.values().next().value;
    if (!startRequest) {
        closeCombatStartRequestMenu();
        return;
    }
    if (combatStartRequestMenu?.dataset.requestId === String(startRequest.id)) {
        combatStartRequestMenu.style.display = 'flex';
        return;
    }
    closeCombatStartRequestMenu();
    combatStartRequestMenu = document.createElement('div');
    combatStartRequestMenu.className = 'modal combat-start-request-menu';
    combatStartRequestMenu.dataset.requestId = String(startRequest.id);
    combatStartRequestMenu.style.cssText = 'position:fixed;inset:0;z-index:1250;display:flex;align-items:center;justify-content:center;background:rgba(4,7,10,.66);';
    combatStartRequestMenu.innerHTML = `<div class="modal-content" style="width:min(440px,calc(100vw - 32px));padding:18px;">
        <h3 style="margin-top:0">Запрос на начало боя</h3>
        <p class="combat-start-request-text"></p>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            <button type="button" class="btn btn-secondary combat-start-request-later">Позже</button>
            <button type="button" class="btn btn-danger combat-start-request-reject">Отклонить</button>
            <button type="button" class="btn btn-primary combat-start-request-approve">Выбрать участников</button>
        </div>
    </div>`;
    combatStartRequestMenu.querySelector('.combat-start-request-text').textContent =
        `${startRequest.actor_name} хочет начать бой атакой. Порядок хода можно выбрать при подтверждении.`;
    combatStartRequestMenu.querySelector('.combat-start-request-later').onclick = closeCombatStartRequestMenu;
    combatStartRequestMenu.querySelector('.combat-start-request-approve').onclick = () => {
        closeCombatStartRequestMenu();
        showCombatParticipantSelection(startRequest.actor_location_character_id, startRequest.id);
    };
    combatStartRequestMenu.querySelector('.combat-start-request-reject').onclick = async (event) => {
        event.currentTarget.disabled = true;
        try {
            await Server.respondLocationCombatStartRequest(
                window.currentLobbyId, getCurrentLocationId(), startRequest.id, 'reject',
            );
            pendingCombatStartRequests.delete(startRequest.id);
            closeCombatStartRequestMenu();
            showCombatStartRequestMenu();
            renderCombatHud();
        } catch (error) {
            event.currentTarget.disabled = false;
            showNotification(error.message || 'Не удалось отклонить запрос', 'error');
        }
    };
    document.body.appendChild(combatStartRequestMenu);
}

export function handleCombatStartRequest(startRequest) {
    if (!window.isGM || Number(startRequest?.location_id) !== Number(getCurrentLocationId())) return;
    combatStartRequestVersion += 1;
    pendingCombatStartRequests.set(startRequest.id, startRequest);
    showCombatStartRequestMenu();
    renderCombatHud();
}

export function handleCombatStartRequestResolved(startRequest) {
    combatStartRequestVersion += 1;
    pendingCombatStartRequests.delete(startRequest.id);
    if (combatStartRequestMenu?.dataset.requestId === String(startRequest.id)) {
        closeCombatStartRequestMenu();
        showCombatStartRequestMenu();
    }
    renderCombatHud();
    if (Number(startRequest.actor_user_id) !== Number(localStorage.getItem('user_id'))) return;
    const message = startRequest.status === 'approved'
        ? 'ГМ начал бой. Проверьте порядок хода; когда наступит ваш ход, выберите атаку и цель.'
        : (startRequest.status === 'rejected'
            ? 'ГМ отклонил начало боя.'
            : 'Запрос на начало боя закрыт: бой начался другим действием.');
    showNotification(message, startRequest.status === 'approved' ? 'success' : 'system');
}

export async function loadCombatStartRequests() {
    if (!window.isGM || !window.isLocationActive) return;
    const locationId = getCurrentLocationId();
    const version = combatStartRequestVersion;
    try {
        const requests = await Server.getLocationCombatStartRequests(
            window.currentLobbyId, locationId,
        );
        if (!window.isLocationActive || Number(getCurrentLocationId()) !== Number(locationId)) return;
        if (combatState?.status === 'active') return;
        if (version !== combatStartRequestVersion) {
            loadCombatStartRequests();
            return;
        }
        pendingCombatStartRequests.clear();
        requests.forEach(item => pendingCombatStartRequests.set(item.id, item));
        showCombatStartRequestMenu();
        renderCombatHud();
    } catch (error) {
        showNotification(error.message || 'Не удалось получить запросы на начало боя', 'error');
    }
}

async function showCombatParticipantSelection(initiatorLocationCharacterId = null, startRequestId = null) {
    if (!window.isGM || combatState?.status === 'active') return;
    let characters = [];
    try {
        const freshState = await Server.getLocationCombatState(
            window.currentLobbyId,
            getCurrentLocationId(),
        );
        combatState = freshState;
        window.locationCombatState = freshState;
        if (freshState?.status === 'active') {
            showNotification('Бой уже начался', 'system');
            return;
        }
        characters = Array.isArray(freshState?.characters)
            ? freshState.characters
            : [];
        if (initiatorLocationCharacterId != null) {
            const initiator = characters.find(character =>
                Number(character.location_character_id) === Number(initiatorLocationCharacterId)
            );
            if (initiator?.condition?.state !== 'active') {
                showNotification('Инициатор больше не может начать бой действием', 'system');
                return;
            }
        }
    } catch (error) {
        showNotification(error.message || 'Не удалось получить участников боя', 'error');
        return;
    }
    const selectableCharacters = characters.filter(character => character.condition?.state !== 'dead');
    if (!selectableCharacters.length) {
        showNotification('На подлокации нет живых участников боя', 'system');
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
                        Отмеченные персонажи бросают 1к20 + Бонус Тактики.
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
            ${initiatorLocationCharacterId != null ? `
                <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;">
                    <input type="checkbox" class="combat-initiator-first" checked>
                    <span>Атакующий ходит первым<br>
                        <small style="opacity:.72;">Если снять галочку, порядок определится обычным броском инициативы.</small>
                    </span>
                </label>
            ` : ''}
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button type="button" class="btn btn-secondary combat-participant-cancel">Отмена</button>
                <button type="button" class="btn btn-primary combat-participant-start">Начать бой</button>
            </div>
        </div>
    `;
    const list = combatParticipantMenu.querySelector('.combat-participant-list');
    selectableCharacters.forEach((character) => {
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
            <input type="checkbox" value="${character.location_character_id}" checked ${character.location_character_id === initiatorLocationCharacterId ? 'disabled' : ''}>
            <strong class="combat-participant-name" style="overflow:hidden; text-overflow:ellipsis;"></strong>
            <span style="font-size:12px; opacity:.75;">Инициатива ${bonus >= 0 ? '+' : ''}${bonus}</span>
        `;
        row.querySelector('.combat-participant-name').textContent = (
            character.name || `#${character.character_id}`
        );
        list.appendChild(row);
    });

    const close = () => {
        closeCombatParticipantMenu();
        if (startRequestId && pendingCombatStartRequests.has(startRequestId)) showCombatStartRequestMenu();
    };
    combatParticipantMenu.querySelector('.combat-participant-close').onclick = close;
    combatParticipantMenu.querySelector('.combat-participant-cancel').onclick = close;
    combatParticipantMenu.addEventListener('pointerdown', (event) => {
        if (event.target === combatParticipantMenu) close();
    });
    combatParticipantMenu.querySelector('.combat-participant-start').onclick = async (event) => {
        const selectedIds = Array.from(
            list.querySelectorAll('input[type="checkbox"]:checked'),
        ).map(input => Number(input.value)).filter(Number.isFinite);
        if (
            initiatorLocationCharacterId != null
            && Number.isFinite(Number(initiatorLocationCharacterId))
            && !selectedIds.includes(Number(initiatorLocationCharacterId))
        ) {
            selectedIds.unshift(Number(initiatorLocationCharacterId));
        }
        if (!selectedIds.length) {
            showNotification('Выберите хотя бы одного участника боя', 'system');
            return;
        }
        event.currentTarget.disabled = true;
        try {
            const initiatorFirst = combatParticipantMenu.querySelector('.combat-initiator-first')?.checked ?? false;
            const state = startRequestId
                ? await Server.respondLocationCombatStartRequest(
                    window.currentLobbyId, getCurrentLocationId(), startRequestId, 'approve', selectedIds,
                    initiatorFirst,
                )
                : await Server.startLocationCombat(
                    window.currentLobbyId, getCurrentLocationId(), selectedIds,
                    initiatorLocationCharacterId, initiatorFirst,
                );
            if (startRequestId) pendingCombatStartRequests.delete(startRequestId);
            close();
        } catch (error) {
            event.currentTarget.disabled = false;
            showNotification(error.message || 'Не удалось начать бой');
        }
    };
    document.body.appendChild(combatParticipantMenu);
}

const COMBAT_STATUS_LABELS = {
    active: 'Идёт',
    idle: 'Не активен',
    finished: 'Завершён',
    completed: 'Завершён',
};

const BLOOD_STAGE_LABELS = {
    normal: 'Норма',
    light: 'Лёгкая',
    medium: 'Средняя',
    severe: 'Сильная',
    critical: 'Критическая',
    fatal: 'Смертельная',
};

function getBloodStageLabel(value) {
    const key = String(value || 'normal').toLowerCase();
    return BLOOD_STAGE_LABELS[key] || key;
}

function renderCombatHud() {
    if (!combatState || !window.isLocationActive) {
        if (combatHud && combatHud.parentNode) {
            combatHud.parentNode.removeChild(combatHud);
        }
        combatHud = null;
        return;
    }

    ensureCombatHud();
    const visibleToPlayer = combatCharacterVisibleToPlayer;
    const currentVisible = visibleToPlayer(combatState.current_character);
    const charactersByLocationId = new Map((combatState.characters || []).map((char) => [char.location_character_id, char]));
    const orderLabels = [...new Set(combatState.turn_order || [])]
        .map((id) => {
            const character = charactersByLocationId.get(id);
            if (!character) return `#${id}`;
            if (!visibleToPlayer(character)) return null;
            const teamColor = normalizeTeamColor(character.team_color);
            const marker = teamColor
                ? `<span title="${escapeHtml(character.team_name || '\u041a\u043e\u043c\u0430\u043d\u0434\u0430')}" style="display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:50%;background:${teamColor};"></span>`
                : '';
            const removeButton = window.isGM && combatState.status === 'active'
                ? `<button type="button" class="combat-remove-participant-btn" data-location-character-id="${id}" title="Убрать из инициативы" aria-label="Убрать ${escapeHtml(character.name || `#${id}`)} из инициативы" style="margin-left:3px;padding:0 3px;border:0;background:transparent;color:#d7a08d;cursor:pointer;font-size:14px;line-height:1;">&times;</button>`
                : '';
            return `<span style="display:inline-flex;align-items:center;white-space:nowrap;">${marker}${escapeHtml(character.name || `#${id}`)}${removeButton}</span>`;
        })
        .filter(Boolean);
    const visibleOrderLabels = orderLabels.length
        ? orderLabels
        : Array.from(new Set((combatState.characters || [])
            .filter(visibleToPlayer).map((char) => escapeHtml(char.name || 'Unknown'))));
    const absentCombatCharacters = (combatState.characters || []).filter(character =>
        !(combatState.turn_order || []).includes(character.location_character_id)
        && character.condition?.state !== 'dead'
    );
    const aimedTarget = (combatState.characters || []).find(
        char => char.character_id === combatState.current_character?.aimed_target_character_id
            && visibleToPlayer(char)
    );
    const pendingReaction = charactersByLocationId.get(
        Number(combatState.reaction?.pending_location_character_id),
    );
    const reactionReturnCharacter = charactersByLocationId.get(
        Number(combatState.reaction?.return_location_character_id),
    );
    const stressCards = window.isGM ? (combatState.characters || []).flatMap(character =>
        (character.stress_effects || []).filter(effect => effect.gmPending).map(effect => ({ character, effect }))
    ) : [];
    const currentMustDoUsage = getMustDoUsage(combatState.current_character);
    const deferredCharacters = (combatState.characters || []).filter(character => character.deferred_action && (
        window.isGM || Number(character.controlled_by ?? character.owner_id) === getCurrentUserId()
    ));
    const currentMustDoRetry = combatState.current_character?.must_do_retry;
    const isCombatActive = combatState.status === 'active';
    const combatStatusLabel = COMBAT_STATUS_LABELS[combatState.status] || 'Не активен';
    const currentBloodLabel = getBloodStageLabel(combatState.current_character?.blood);
    const isCollapsed = combatHudCollapsed ?? combatState.status !== 'active';
    const compactStatus = combatState.status === 'active'
        ? `Раунд ${combatState.round_number || 0} · ${currentVisible ? (combatState.current_character?.name || 'нет хода') : 'Скрытый ход'} · ${currentVisible ? (combatState.current_character?.posture_label || 'Стоя') : ''}`
        : 'Бой не активен';
    combatHud.style.minWidth = isCollapsed ? '230px' : '260px';
    combatHud.style.maxHeight = isCollapsed ? '120px' : 'calc(80vh - 24px)';
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
            ${isCollapsed && combatState.status === 'active' && combatState.current_character && canActWithCombatCharacter(combatState.current_character)
                ? '<button class="btn btn-sm btn-secondary combat-end-turn-btn" style="margin-left:8px;">Закончить ход</button>'
                : ''}
        </div>
        <div class="combat-hud-body" style="display:${isCollapsed ? 'none' : 'block'}; padding:12px 14px; font-size:13px; line-height:1.45;">
            ${isCombatActive ? `
            <div>Статус: <strong>${combatStatusLabel}</strong></div>
            <div>Раунд: <strong>${combatState.round_number || 0}</strong></div>
            <div>Ход: <strong>${currentVisible ? (combatState.current_character?.name || 'нет') : 'Скрытый участник'}</strong></div>
            ${currentVisible ? `<div>Положение: <strong>${combatState.current_character?.posture_label || 'Стоя'}</strong></div>
            <div>ОД: ${combatState.current_character?.action_points_current ?? 0}/${combatState.current_character?.action_points_max ?? 0}</div>
            <div>СД: ${combatState.current_character?.free_actions_current ?? 0}/${combatState.current_character?.free_actions_max ?? 0}</div>
            <div>ОП: ${combatState.current_character?.movement_points_current ?? 0}/${combatState.current_character?.movement_points_max ?? 0}</div>` : ''}
            ${deferredCharacters.map(character => `<div style="margin-top:6px;padding:8px;border:1px solid rgba(255,255,255,.15);border-radius:8px;">
                <strong>${escapeHtml(character.name)}: ${escapeHtml(character.deferred_action.label)}</strong>
                <div>${character.deferred_action.status === 'ready' ? 'Оплачено; ожидает завершения' : `Осталось оплатить: ${character.deferred_action.remaining_action_points} ОД`}</div>
                ${character.deferred_action.status === 'ready' && (character.deferred_action.server_executable || character.deferred_action.client_executable) && character.location_character_id === combatState.current_character?.location_character_id
                    ? '<button type="button" class="btn btn-sm btn-secondary combat-deferred-retry">Завершить</button>' : ''}
                ${!character.deferred_action.server_executable && !character.deferred_action.client_executable ? '<div>Старое действие без сохранённого выбора магазина. Отмените его и начните заново.</div>' : ''}
                <button type="button" class="btn btn-sm btn-secondary combat-deferred-cancel" data-character="${character.location_character_id}" data-action="${escapeHtml(character.deferred_action.id)}" title="Без возврата уже потраченных ОД">Отменить действие</button>
            </div>`).join('')}
            ${combatState.current_character?.movement_evasion ? '<div>Уклонение на ходу: <strong>СЛ стрельбы по вам +2</strong></div>' : ''}
            ${aimedTarget ? `<div>Прицел: <strong>${aimedTarget.name || 'цель'}</strong> · Точность +${combatState.current_character?.aim_accuracy_bonus || 0}</div>` : ''}
            <div>Боль: ${combatState.current_character?.pain_level ?? 0} | Истощение: ${combatState.current_character?.exhaustion ?? 0}</div>
            <div>Кровопотеря: ${currentBloodLabel} | Тяжесть: ${combatState.current_character?.bleeding_severity ?? 0} | Сложность: ${combatState.current_character?.bleeding_difficulty ?? 0}</div>
            ${combatState.status === 'active' && combatState.current_character && !combatState.current_character.is_mutant && currentMustDoUsage.remaining > 0 ? `<div style="margin-top:6px;padding:7px 8px;border-radius:7px;background:rgba(190,143,72,.16);border:1px solid rgba(190,143,72,.28);"><button type="button" class="btn btn-sm btn-secondary combat-must-do-btn" style="width:100%;">Должен это сделать · ${currentMustDoUsage.remaining}/${currentMustDoUsage.limit}</button><div style="margin-top:5px;font-size:12px;opacity:.8;">${currentMustDoRetry ? `Сохранённый провал: ${escapeHtml(currentMustDoRetry.name || 'повторная проверка')}` : 'Ручной повтор по разрешению ГМа'}</div></div>` : ''}
            ${combatState.current_character?.help_advantage ? `<div style="margin-top:6px;padding:6px 8px;border-radius:7px;background:rgba(92,154,110,.16);">Помощь: преимущество${combatState.current_character.help_advantage.action_label ? `, ${escapeHtml(combatState.current_character.help_advantage.action_label)}` : ''}${combatState.current_character.help_advantage.source_name ? ` (${escapeHtml(combatState.current_character.help_advantage.source_name)})` : ''}</div>` : ''}
            <div>Бонус Воли: ${combatState.current_character?.will_bonus ?? 0} | Модификатор кровопотери: ${combatState.current_character?.bleeding_modifier_total ?? 0}</div>
            <div class="combat-participants-panel">
                <div class="combat-participants-heading">Порядок хода</div>
                <div class="combat-participants-order">${visibleOrderLabels.join('<span class="combat-order-arrow" aria-hidden="true">→</span>') || 'Пусто'}</div>
                ${window.isGM && absentCombatCharacters.length ? `<div class="combat-participants-add">
                    <label for="combat-add-participant-select">Новый участник</label>
                    <div class="combat-participants-controls">
                        <select id="combat-add-participant-select" class="form-control combat-add-participant-select" aria-label="Добавить в инициативу">
                            ${absentCombatCharacters.map(character => `<option value="${character.location_character_id}">${escapeHtml(character.name || `#${character.location_character_id}`)}</option>`).join('')}
                        </select>
                        <button type="button" class="btn btn-sm btn-primary combat-add-participant-btn" title="Добавить в начало списка; первый ход в следующем раунде">Добавить</button>
                    </div>
                    <div class="combat-participants-hint">В начале списка со следующего раунда, без прерывания текущего хода</div>
                </div>` : ''}
            </div>
            ${reactionReturnCharacter ? `<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(84,139,196,.16);">Реакция: после завершения ход вернётся к <strong>${escapeHtml(reactionReturnCharacter.name || 'персонажу')}</strong>.</div>` : ''}
            ${pendingReaction && window.isGM ? `<div style="margin-top:8px;padding:8px 9px;border-radius:8px;background:rgba(215,169,75,.16);border:1px solid rgba(215,169,75,.35);"><strong>Запрос реакции: ${escapeHtml(pendingReaction.name || 'персонаж')}</strong>${pendingReaction.reaction_reserve?.trigger ? `<div style="margin-top:3px;font-size:12px;opacity:.86;">${escapeHtml(pendingReaction.reaction_reserve.trigger)}</div>` : ''}<div style="margin-top:7px;"><button class="btn btn-sm btn-primary combat-reaction-approve">Разрешить</button><button class="btn btn-sm btn-secondary combat-reaction-reject" style="margin-left:6px;">Отклонить</button></div></div>` : ''}
            ${pendingCombatAction ? `<div style="margin-top:8px; padding:8px 10px; border-radius:10px; background: rgba(255,255,255,0.06);"><strong>Выбор:</strong> ${
                pendingCombatAction.targetType === 'structure'
                    ? 'Укрытие для подавления'
                    : (pendingCombatAction.targetType === 'multi_character'
                        ? (pendingCombatAction.areaAnchor
                            ? `Цели в области ${(pendingCombatAction.selectedTargetIds || []).length}/3 · Enter для огня`
                            : 'Центр области 5x5')
                        : (pendingCombatAction.targetType === 'multi_melee'
                            ? `Соседние цели ${(pendingCombatAction.selectedTargetIds || []).length}/3 · Enter для атаки`
                            : (pendingCombatAction.fireMode || pendingCombatAction.actionKey || 'действие')))}
            }</div>` : ''}
            ${stressCards.map(({character, effect}) => `<div class="stress-effect-card" data-character="${character.location_character_id}" data-effect="${escapeHtml(effect.id)}" style="margin-top:8px;padding:8px;border:1px solid rgba(215,120,80,.45);border-radius:8px;"><strong>Стресс: ${escapeHtml(character.name)} — ${escapeHtml(effect.name)}</strong><div style="margin-top:4px;font-size:12px;opacity:.86;">${escapeHtml(effect.requirement || '')}</div><div style="margin-top:7px"><button class="btn btn-sm btn-primary stress-approve">Разрешить</button><button class="btn btn-sm btn-secondary stress-replace">Заменить эффект</button><button class="btn btn-sm btn-secondary stress-skip">Пропустить</button></div></div>`).join('')}
            <div style="margin-top:10px;">
                ${combatState.status === 'active' && combatState.current_character && canActWithCombatCharacter(combatState.current_character) ? '<button class="btn btn-sm btn-secondary combat-end-turn-btn" style="margin-top:8px;">Закончить ход</button>' : ''}
                ${combatState.status === 'active' && window.isGM ? '<button class="btn btn-sm btn-danger combat-end-combat-btn" style="margin-top:8px; margin-left:6px;">Закончить бой</button>' : ''}
            </div>
            <div style="margin-top:8px; font-size:12px; opacity:0.75;">
                ${combatState.current_character && canActWithCombatCharacter(combatState.current_character) ? 'ПКМ по модели персонажа открывает боевое меню.' : 'Сейчас управление доступно только активному персонажу.'}
            </div>
            ` : `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                <span style="opacity:.72;">Бой не активен</span>
                ${window.isGM ? '<button class="btn btn-sm btn-primary combat-start-btn">Начать бой</button>' : ''}
            </div>
            ${window.isGM && pendingCombatStartRequests.size ? `<button class="btn btn-sm btn-warning combat-start-requests-btn" style="margin-top:8px;">Запросы атаки · ${pendingCombatStartRequests.size}</button>` : ''}
            `}
        </div>
    `;
    ensureCombatHudDragging();
    combatHud.querySelector('.combat-start-requests-btn')?.addEventListener('click', showCombatStartRequestMenu);
    combatHud.querySelector('.combat-deferred-retry')?.addEventListener('click', () => resumeCompletedCombatAction(combatState, true));
    combatHud.querySelectorAll('.combat-deferred-cancel').forEach(button => {
        button.onclick = async () => {
            button.disabled = true;
            try {
                await Server.cancelDeferredCombatAction(window.currentLobbyId, getCurrentLocationId(), {
                    location_character_id: Number(button.dataset.character), action_id: button.dataset.action,
                });
            } catch (error) {
                showNotification(error.message || 'Не удалось отменить действие', 'system');
                button.disabled = false;
            }
        };
    });
    combatHud.querySelectorAll('.combat-remove-participant-btn').forEach(button => {
        button.onclick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const locationCharacterId = Number(button.dataset.locationCharacterId);
            if (!locationCharacterId) return;
            button.disabled = true;
            try {
                await Server.removeLocationCombatParticipant(
                    window.currentLobbyId,
                    getCurrentLocationId(),
                    locationCharacterId,
                );
            } catch (error) {
                button.disabled = false;
                showNotification(error.message || 'Не удалось убрать персонажа из инициативы');
            }
        };
    });
    combatHud.querySelector('.combat-add-participant-btn')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const locationCharacterId = Number(combatHud.querySelector('.combat-add-participant-select')?.value);
        if (!locationCharacterId) return;
        button.disabled = true;
        try {
            await Server.addLocationCombatParticipant(window.currentLobbyId, getCurrentLocationId(), locationCharacterId);
        } catch (error) {
            button.disabled = false;
            showNotification(error.message || 'Не удалось добавить персонажа в инициативу');
        }
    });
    combatHud.querySelectorAll('.stress-effect-card button').forEach(button => {
        button.onclick = async () => {
            const card = button.closest('.stress-effect-card');
            const replacing = button.classList.contains('stress-replace');
            const replacement = replacing ? window.prompt('Какое действие или требование должен получить персонаж?') : null;
            if (replacing && !replacement?.trim()) return;
            const stressIndex = [...combatHud.querySelectorAll('.stress-effect-card')].indexOf(card);
            const pendingEffect = stressCards[stressIndex]?.effect;
            try {
                await Server.resolveLocationStressEffect(window.currentLobbyId, getCurrentLocationId(), {
                    location_character_id: Number(card.dataset.character),
                    effect_id: card.dataset.effect,
                    effect_name: pendingEffect?.name,
                    stress_table: pendingEffect?.stress_table,
                    stress_roll: pendingEffect?.stress_roll,
                    action: button.classList.contains('stress-approve') ? 'approve' : (replacing ? 'replace' : 'skip'),
                    replacement,
                });
            } catch (error) {
                showNotification(error.message || 'Не удалось обработать эффект стресса');
            }
        };
    });
    if (window.isGM) {
        const teamButton = document.createElement('button');
        teamButton.type = 'button';
        teamButton.className = 'btn btn-sm btn-secondary combat-team-manage-btn';
        teamButton.textContent = '\u041a\u043e\u043c\u0430\u043d\u0434\u044b';
        teamButton.style.cssText = 'margin-left:auto; flex:0 0 auto;';
        teamButton.onclick = showTeamManagementModal;
        combatHud.querySelector('.combat-hud-header')?.appendChild(teamButton);
        const eventButton = document.createElement('button');
        eventButton.type = 'button';
        eventButton.className = 'btn btn-sm btn-secondary combat-gm-event-btn';
        eventButton.textContent = 'Событие';
        eventButton.title = 'Применить событие к персонажам на локации';
        eventButton.style.cssText = 'margin-left:6px; flex:0 0 auto;';
        eventButton.onclick = showGmEventMenu;
        combatHud.querySelector('.combat-hud-header')?.appendChild(eventButton);
        if (gmVisionCharacterId !== null) {
            const fullVisionButton = document.createElement('button');
            fullVisionButton.type = 'button';
            fullVisionButton.className = 'btn btn-sm btn-secondary';
            fullVisionButton.textContent = 'Обзор ГМа';
            fullVisionButton.title = 'Вернуться к полному обзору ГМа';
            fullVisionButton.style.cssText = 'margin-left:6px; flex:0 0 auto;';
            fullVisionButton.onclick = () => toggleGmVision();
            combatHud.querySelector('.combat-hud-header')?.appendChild(fullVisionButton);
        }
    }
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
        startBtn.onclick = () => showCombatParticipantSelection();
    }
    const mustDoBtn = combatHud.querySelector('.combat-must-do-btn');
    if (mustDoBtn) {
        mustDoBtn.disabled = !canActWithCombatCharacter(combatState.current_character);
        mustDoBtn.onclick = () => performMustDoRetry(combatState.current_character);
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
                    showNotification(message, check.success ? 'system' : 'error');
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
    const resolveReaction = async (approve) => {
        try {
            await Server.resolveLocationCombatReaction(
                window.currentLobbyId,
                getCurrentLocationId(),
                approve,
            );
            showNotification(approve ? 'Реакция разрешена' : 'Реакция отклонена', 'system');
        } catch (error) {
            showNotification(error.message || 'Не удалось обработать реакцию', 'system');
        }
    };
    combatHud.querySelector('.combat-reaction-approve')?.addEventListener('click', () => resolveReaction(true));
    combatHud.querySelector('.combat-reaction-reject')?.addEventListener('click', () => resolveReaction(false));
}

export function setCombatState(state) {
    combatState = state || null;
    window.locationCombatState = combatState;
    if (combatState?.status === 'active') {
        combatStartRequestVersion += 1;
        closeCombatStartRequestMenu();
        pendingCombatStartRequests.clear();
    }
    syncCombatAreaVisuals(combatState);
    (combatState?.characters || []).forEach((character) => {
        const entry = getCharacterModelEntry(character.character_id);
        if (entry) {
            entry.hpZones = character.hp_zones;
            entry.effects = character.effects;
        }
        updateCharacterPosition(character.character_id, character.x, character.y, { deferRefresh: true });
        updateCharacterTeamVisual(character.character_id, character.team_name, character.team_color);
        applyCharacterPostureVisual(character.character_id, character.posture);
        applyCharacterFacingVisual(
            character.character_id,
            character.facing_x,
            character.facing_y,
        );
        applyCharacterGrappleVisual(character.character_id, character);
        applyCharacterGunpointVisual(character.character_id, character);
        applyCharacterAnomalyVisual(character.character_id, character);
        applyCharacterVisibilityVisual(character.character_id, {
            gmHidden: character.gm_hidden,
            camouflaged: character.camouflaged,
            isNpc: character.is_npc,
        }, true);
    });
    invalidateMovementMapCache();
    applyFogOfWar();
    showAvailableOpportunityAttack();
    window.dispatchEvent(new CustomEvent('combat-state-updated', { detail: combatState }));
    resumeCompletedCombatAction(combatState);
    renderCombatHud();
    void autoEndBlockedCombatTurn();
}

function showAvailableOpportunityAttack() {
    const myId = getCurrentUserId();
    const available = (combatState?.characters || []).flatMap((character) => {
        const controllerId = Number(character.controlled_by ?? character.owner_id) || null;
        const canRespond = controllerId === myId || (window.isGM && (!controllerId || controllerId === myId));
        if (!canRespond) return [];
        return (character.opportunity_attacks || []).map(opportunity => ({ character, opportunity }));
    })[0];
    if (!available) {
        opportunityAttackModal?.remove();
        opportunityAttackModal = null;
        activeOpportunityAttackId = null;
        return;
    }
    if (activeOpportunityAttackId === available.opportunity.id && opportunityAttackModal?.isConnected) {
        return;
    }
    opportunityAttackModal?.remove();
    activeOpportunityAttackId = available.opportunity.id;
    const reason = available.opportunity.reason === 'opponent_moved_behind'
        ? 'пытается зайти за спину'
        : 'выходит из зоны ближнего боя';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.cssText = 'display:flex;z-index:12550;align-items:center;justify-content:center;';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(460px,calc(100vw - 24px));">
            <h3 style="margin-top:0;">Атака по возможности</h3>
            <p><strong>${escapeHtml(available.opportunity.target_name)}</strong> ${reason}.</p>
            <p style="opacity:.76;">Можно провести неприцельную атаку оружием ближнего боя. Лимит: одна цель за раунд.</p>
            ${(available.opportunity.attack_options || []).length > 1 ? `
                <label style="display:grid;gap:5px;margin-bottom:12px;">
                    <span>Атака</span>
                    <select class="opportunity-attack-type">
                        ${(available.opportunity.attack_options || []).map((option, index) => `
                            <option value="${index}">${escapeHtml(option.label || option.attack_type || 'Атака')}</option>
                        `).join('')}
                    </select>
                </label>
            ` : ''}
            <div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end;">
                <button type="button" class="btn btn-secondary opportunity-skip">Пропустить</button>
                <button type="button" class="btn btn-primary opportunity-attack">Атаковать</button>
            </div>
        </div>
    `;
    const resolve = async (accept) => {
        modal.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try {
            const options = available.opportunity.attack_options || [];
            const selectedIndex = Number(modal.querySelector('.opportunity-attack-type')?.value || 0);
            const selectedAttack = options[selectedIndex] || options[0] || null;
            await Server.resolveLocationOpportunityAttack(
                window.currentLobbyId,
                getCurrentLocationId(),
                {
                    location_character_id: available.character.location_character_id,
                    opportunity_id: available.opportunity.id,
                    accept,
                    weapon_index: selectedAttack?.weapon_index,
                    attack_type: selectedAttack?.attack_type,
                },
            );
            modal.remove();
            opportunityAttackModal = null;
            activeOpportunityAttackId = null;
        } catch (error) {
            showNotification(error.message || 'Не удалось выполнить атаку по возможности', 'system');
            modal.querySelectorAll('button').forEach(button => { button.disabled = false; });
        }
    };
    modal.querySelector('.opportunity-skip').onclick = () => resolve(false);
    modal.querySelector('.opportunity-attack').onclick = () => resolve(true);
    document.body.appendChild(modal);
    opportunityAttackModal = modal;
}

window.addEventListener('must-do-retry-registered', event => {
    const characterId = Number(event.detail?.characterId);
    if (!combatState || !characterId || !event.detail?.retry) return;
    const actor = (combatState.characters || []).find(
        character => Number(character.character_id) === characterId,
    );
    if (actor) actor.must_do_retry = event.detail.retry;
    if (Number(combatState.current_character?.character_id) === characterId) {
        combatState.current_character.must_do_retry = event.detail.retry;
    }
    renderCombatHud();
});

const resumeSavedCombatAction = createDeferredActionResumer({
    send: payload => Server.performLocationCombatAction(window.currentLobbyId, getCurrentLocationId(), payload),
    resumeConsumable: async actionId => {
        const module = await import('./characterSheet.js');
        return module.resumeDeferredConsumable(window.currentLobbyId, getCurrentLocationId(), actionId);
    },
    canResume: actor => canActWithCombatCharacter(actor),
    notify: showNotification,
});

window.addEventListener('character-item-operation-finished', () => {
    resumeSavedCombatAction(combatState);
});

async function resumeCompletedCombatAction(state, force = false) {
    const current = state?.current_character;
    const actionId = current?.completed_pending_action_id;
    if (current?.deferred_action) {
        deferredCombatActions.delete(current.deferred_action.id);
        return resumeSavedCombatAction(state, { force });
    }
    const payload = actionId ? deferredCombatActions.get(actionId) : null;
    if (!payload) return;
    deferredCombatActions.delete(actionId);
    try {
        const result = await Server.performLocationCombatAction(
            window.currentLobbyId,
            getCurrentLocationId(),
            {
                ...payload,
                pending_action_id: undefined,
                resume_pending_action_id: actionId,
            },
        );
        if (result?.attack) {
            showNotification('Длительная атака завершена', 'success');
        } else {
            showNotification('Длительное действие завершено', 'success');
        }
    } catch (error) {
        showNotification(error.message || 'Не удалось завершить длительное действие');
    }
}

export function getCombatState() {
    return combatState;
}

// ========== Инициализация сцены ==========
function createLocationProfileControl(container) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'scene-profile-button';
    button.textContent = 'Профиль сцены';
    const panel = document.createElement('pre');
    panel.className = 'scene-profile-results';
    panel.hidden = true;
    container.append(button, panel);

    let skipLabels = false;
    let grass = null;
    let grassWasVisible = false;
    let anomalyVisibility = [];
    let anomalyLightVisibility = [];
    let lights = null;
    let lightsWereVisible = false;
    let shadowsWereEnabled = false;
    const phases = [
        { name: 'Полная сцена', apply() {}, restore() {} },
        { name: 'Без травы и декора почвы', apply() {
            grass = grassDetailGroup;
            grassWasVisible = grass?.visible;
            if (grass) grass.visible = false;
        }, restore() { if (grass) grass.visible = grassWasVisible; } },
        { name: 'Без визуалов аномалий', apply() {
            anomalyVisibility = anomalyEffectMeshes.map(mesh => [mesh, mesh.visible]);
            anomalyVisibility.forEach(([mesh]) => { mesh.visible = false; });
        }, restore() { anomalyVisibility.forEach(([mesh, visible]) => { mesh.visible = visible; }); } },
        { name: 'Без света аномалий', apply() {
            anomalyLightVisibility = anomalyRenderPool.map(light => [light, light.visible]);
            anomalyLightVisibility.forEach(([light]) => { light.visible = false; });
        }, restore() { anomalyLightVisibility.forEach(([light, visible]) => { light.visible = visible; }); } },
        { name: 'Без локальных источников света', apply() {
            lights = locationLightGroup;
            lightsWereVisible = lights?.visible;
            if (lights) lights.visible = false;
        }, restore() { if (lights) lights.visible = lightsWereVisible; } },
        { name: 'Без теней', apply() {
            shadowsWereEnabled = renderer.shadowMap.enabled;
            renderer.shadowMap.enabled = false;
        }, restore() {
            renderer.shadowMap.enabled = shadowsWereEnabled;
            renderer.shadowMap.needsUpdate = true;
        } },
        { name: 'Без HTML-подписей', apply() { skipLabels = true; }, restore() { skipLabels = false; } },
    ];
    const profiler = createSceneProfiler({ phases,
        onProgress(name, index, total) {
            panel.hidden = false;
            panel.textContent = `Замер ${index}/${total}: ${name}\nДержите камеру неподвижно; каждый режим прогревается.`;
        },
        onComplete(results) {
            button.textContent = 'Профиль сцены';
            panel.textContent = [
                'Реальная подлокация (FPS / p95 кадра / CPU / draw calls)',
                ...results.map(result => {
                    const pause = result.longFrames
                        ? `; долгих пауз ${result.longFrames} (макс ${Math.round(result.longestFrameMs)}мс)` : '';
                    if (!result.valid) return `${result.name}: нет устойчивого замера${pause}`;
                    return `${result.name}: ${result.fps.toFixed(1)} / ${result.frameP95Ms.toFixed(1)}мс / ${result.cpuMs.toFixed(1)}мс / ${Math.round(result.calls)}${pause}`;
                }),
                `Травинки: ${grassDetailGroup?.userData.detailCounts?.tufts || 0}; эффекты аномалий: ${anomalyEffectMeshes.length}`,
                `Огни аномалий: ${anomalyRenderSources.length} (рендерятся до ${anomalyRenderPool.length}); DPR: ${renderer.getPixelRatio().toFixed(2)}`,
                'Сравнивайте режимы с полной сценой; абсолютный FPS ограничен экраном.',
            ].join('\n');
            console.table(results);
        },
    });
    button.disabled = Boolean(renderer.isUnavailableRenderer);
    panel.title = 'Нажмите, чтобы закрыть результат';
    panel.addEventListener('click', () => { if (!profiler.running) panel.hidden = true; });
    button.addEventListener('click', () => {
        if (profiler.running) {
            profiler.stop();
            button.textContent = 'Профиль сцены';
            panel.textContent = 'Замер остановлен, настройки сцены восстановлены.';
            return;
        }
        button.textContent = 'Остановить замер';
        profiler.start(performance.now());
    });
    return {
        get skipLabels() { return skipLabels; },
        frame(now, metrics) { profiler.frame(now, metrics); },
        stop() {
            if (!profiler.running) return;
            profiler.stop();
            button.textContent = 'Профиль сцены';
            panel.textContent = 'Замер прерван изменением сцены; настройки восстановлены.';
        },
        destroy() { profiler.stop(); button.remove(); panel.remove(); },
    };
}

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
    locationFpsCounter = createFpsCounter(container, 'Подлокация');
    locationProfiler = createLocationProfileControl(container);
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
    controls.enableZoom = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0, 0);
    controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    window.locationControls = controls;

    // Освещение
    locationAmbientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(locationAmbientLight);
    locationDirectionalLight = new THREE.DirectionalLight(0xffffff, 1);
    locationDirectionalLight.castShadow = true;
    locationDirectionalLight.shadow.mapSize.set(2048, 2048);
    locationDirectionalLight.shadow.bias = -0.0001;
    locationDirectionalLight.shadow.normalBias = 0.02;
    locationDirectionalLight.shadow.radius = 2;
    scene.add(locationDirectionalLight);
    scene.add(locationDirectionalLight.target);

    // Highlight
    createHighlight();

    // Анимация
    let previousFrameTime = performance.now();
    let locationFrameWorkMs = 0;
    let locationSampleFrames = 0;
    let locationSampleAt = previousFrameTime;
    function animate(frameTime = performance.now()) {
        animationFrameId = requestAnimationFrame(animate);
        const deltaSeconds = Math.min(0.1, Math.max(0, (frameTime - previousFrameTime) / 1000));
        previousFrameTime = frameTime;
        if (document.hidden) {
            locationFpsCounter.pause();
            locationProfiler?.stop();
            locationFrameWorkMs = 0;
            locationSampleFrames = 0;
            locationSampleAt = frameTime;
            return;
        }
        const frameWorkStartedAt = performance.now();
        updateLocationCameraMovement(deltaSeconds);
        if (controls) controls.update();
        updateAnomalyRenderLights(frameTime);
        updateRoofVisibility();
        animateAnomalyEffects(anomalyEffectMeshes, performance.now());
        animateFireObjectModels(locationObjectMeshes, frameTime);
        animateFireObjectModels(objectMeshes, frameTime);
        waterSurfaceMesh?.material.map?.offset.set((frameTime * 0.000002) % 1, (frameTime * 0.000001) % 1);
        if (renderer && scene && camera) {
            renderer.render(scene, camera);
            if (!renderer.isUnavailableRenderer) locationFpsCounter.frame(frameTime);
            else locationFpsCounter.pause();
        }
        if (labelRenderer && !locationProfiler?.skipLabels) labelRenderer.render(scene, camera);
        if (renderer && !renderer.isUnavailableRenderer) {
            const finishedAt = performance.now();
            const cpuMs = finishedAt - frameWorkStartedAt;
            locationFrameWorkMs += cpuMs;
            locationSampleFrames += 1;
            const info = renderer.info?.render;
            locationProfiler?.frame(finishedAt, {
                cpuMs, calls: info?.calls || 0, triangles: info?.triangles || 0,
            });
            if (frameTime - locationSampleAt >= 1000) {
                if (info) locationFpsCounter.setDetails(
                    `calls ${info.calls} | tris ${Math.round(info.triangles / 1000)}k | CPU ${(locationFrameWorkMs / locationSampleFrames).toFixed(1)}ms`
                );
                locationFrameWorkMs = 0;
                locationSampleFrames = 0;
                locationSampleAt = frameTime;
            }
        }
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
    const hit = raycaster.intersectObjects(locationObjectMeshes.filter(mesh => mesh.visible), true)[0];
    if (!hit) return null;
    let mesh = hit.object;
    while (mesh && !mesh.userData.locationObjectId) mesh = mesh.parent;
    locationObjectPickCache = { key: cacheKey, result: mesh || null };
    return mesh || null;
}

function getObjectActions(object) {
    const actions = [...(object.properties?.interactions || objectInteractions[object.type] || [])];
    if (isFireObject(object) && !actions.includes('toggle_fire')) actions.push('toggle_fire');
    if (['box', 'military_crate'].includes(object.type) && !actions.includes('open_container')) {
        actions.push('open_container');
    }
    const hasContainerContents = Array.isArray(object?.properties?.contents) && object.properties.contents.length >= 0;
    if ((object?.type === 'corpse' || object?.type === 'body' || object?.properties?.is_corpse || hasContainerContents) && !actions.includes('open_container')) {
        actions.push('open_container');
    }
    return actions;
}

function getStructureActions(object) {
    const actions = [...getObjectActions(object)];
    if (['door', 'window', 'table', 'chair', 'shelf', 'chest'].includes(object.type) && !actions.includes('rotate')) {
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
    if (['floor', 'ground_item', 'campfire', 'torch', 'wall_torch', 'fire_barrel',
        'ceiling_bulb', 'wall_bulb', 'anomaly', 'poster'].includes(type)) return false;
    if (['door', 'window'].includes(type) && properties.is_open) return false;
    return getObjectTraversalHeight(object) >= 0.3;
}

function getActionRequirement(object, actionKey) {
    return object?.properties?.interaction_requirements?.[actionKey] || interactionRequirements[actionKey] || {};
}

function getStructureActionLabel(object, actionKey) {
    if (actionKey === 'toggle_door') return object?.properties?.is_open ? 'Закрыть' : 'Открыть';
    if (actionKey === 'toggle_fire') return object?.properties?.is_lit ? 'Потушить' : 'Зажечь';
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
    if (actionKey === 'toggle_fire') return '♨';
    if (actionKey === 'open_container') return '↑';
    if (actionKey === 'move') return '↔';
    if (actionKey === 'rotate') return '↻';
    if (actionKey === 'climb') return '↕';
    if (actionKey === 'take_cover') return '▣';
    if (actionKey === 'leave_cover') return '◯';
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
    const cosine = Math.abs(Math.cos(rotation));
    const sine = Math.abs(Math.sin(rotation));
    return { width: width * cosine + depth * sine, depth: width * sine + depth * cosine };
}

function getObjectFootprintBounds(object, fallbackX = null, fallbackY = null) {
    const { width, depth } = getObjectTraversalDimensions(object);
    const { x, y } = getObjectGridPosition(object, fallbackX, fallbackY);
    const centerX = (x ?? 0) + 0.5 + Number(object?.properties?.offset_x || 0);
    const centerY = (y ?? 0) + 0.5 + Number(object?.properties?.offset_z || 0);
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
        const doorwayTiles = object.type === 'wall' ? new Set(locationObjects
            .filter(door => door.type === 'door' && door.properties?.is_open && doorOnWall(door, object))
            .flatMap(door => getObjectFootprintTiles(door).map(tile => `${tile.x}:${tile.y}`))) : null;
        for (const footprintTile of getObjectFootprintTiles(object)) {
            const key = `${footprintTile.x}:${footprintTile.y}`;
            if (doorwayTiles?.has(key)) continue;
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
        return object;
    } catch (error) {
        showNotification(error.message || 'Не удалось обновить объект');
        return null;
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
        if (structureActionMenu?.style.display === 'block' && !structureActionMenu.contains(event.target)) {
            hideStructureInteraction();
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
        { label: '↶', title: 'Повернуть влево', rotation: currentRotation + (Math.PI / 2) },
        { label: '↷', title: 'Повернуть вправо', rotation: currentRotation - (Math.PI / 2) },
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
            hideStructureInteraction();
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

    if (type === 'window') return { blocked: true, climbCost: 0 };

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
        actorLocationCharacterId: findCombatCharacterByCharacterId(characterId)?.location_character_id || null,
        createdAt: Date.now(),
    };
    pendingCombatAction = null;
    armedMoveCharacterId = null;
    clearAttackPreview();
    clearMovementPreview();
    clearStructureActionMenu();
    clearStructureMovePreview();
    showNotification('Наведи на структуру или соседнего персонажа и выбери действие', 'system');
    renderCombatHud();
    return true;
}

function canInteractWithCharacter(actorCharacterId, targetCharacterId, requireIncapacitated = false) {
    if (!actorCharacterId || !targetCharacterId || Number(actorCharacterId) === Number(targetCharacterId)) {
        return false;
    }
    const actor = getLocationCharacterById(actorCharacterId);
    const target = getLocationCharacterById(targetCharacterId);
    if (!actor || !target) {
        return false;
    }
    if (requireIncapacitated && getLocationCharacterCondition(targetCharacterId).state === 'active') {
        return false;
    }
    if (combatState?.status !== 'active') return true;
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
            `Кровопотеря: ${getBloodStageLabel(health.blood_stage)}`,
            `Боль: ${health.pain_level ?? 0}`,
            effects.length ? `Эффекты: ${effects.join(', ')}` : 'Активных эффектов нет',
        ].filter(Boolean).join('. '),
        'system'
    );
    return snapshot;
}

function ensureCharacterTradeModal() {
    if (characterTradeModal) return characterTradeModal;
    characterTradeModal = document.createElement('div');
    characterTradeModal.className = 'modal';
    characterTradeModal.style.zIndex = '1320';
    document.body.appendChild(characterTradeModal);
    return characterTradeModal;
}

function addTradeOfferEntry(offer, entry, amount) {
    const item = entry.item || {};
    const safeAmount = Math.max(1, Math.min(Number(amount || 1), getTransferItemQuantity(item)));
    const key = item.id != null ? `id:${item.id}` : `path:${entry.path.join('.')}`;
    const existing = offer.find(candidate => candidate.key === key);
    if (existing) {
        existing.amount = Math.min(existing.available, existing.amount + safeAmount);
        return;
    }
    offer.push({
        key,
        item_id: item.id ?? null,
        path: [...entry.path],
        name: item.name || 'Предмет',
        amount: safeAmount,
        available: getTransferItemQuantity(item),
    });
}

function renderTradeInventoryList(container, entries, direction, onAdd = null) {
    container.innerHTML = '';
    if (!entries.length) {
        container.innerHTML = '<div style="padding:10px;opacity:.7;">Инвентарь пуст</div>';
        return;
    }
    entries.forEach(entry => {
        if (onAdd) {
            container.appendChild(buildTransferRow(entry, direction, amount => onAdd(entry, amount)));
            return;
        }
        const row = document.createElement('div');
        row.style.cssText = 'padding:8px 2px;border-bottom:1px solid rgba(255,255,255,.06);';
        row.innerHTML = `<strong>${escapeHtml(entry.item?.name || 'Предмет')}</strong><div style="font-size:12px;opacity:.7;">${escapeHtml(entry.rootLabel)} · x${getTransferItemQuantity(entry.item)}</div>`;
        container.appendChild(row);
    });
}

function renderTradeOfferList(container, title, offer, direction, onRemove = null) {
    container.innerHTML = `<div style="font-weight:700;margin-bottom:6px;">${escapeHtml(title)}</div>`;
    if (!offer.length) {
        container.insertAdjacentHTML('beforeend', '<div style="padding:8px 0;opacity:.65;">Ничего</div>');
        return;
    }
    offer.forEach((entry, index) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);';
        row.innerHTML = `<span>${escapeHtml(entry.name)} ×${Number(entry.amount || 1)} <b>${direction}</b></span>`;
        if (onRemove) {
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn btn-sm btn-secondary';
            remove.textContent = '×';
            remove.onclick = () => onRemove(index);
            row.appendChild(remove);
        }
        container.appendChild(row);
    });
}

async function showCharacterTradeMenu(actorLocationCharacterId, actorCharacterId, targetCharacterId) {
    const [actorCharacter, snapshot] = await Promise.all([
        Server.getCharacter(actorCharacterId),
        Server.inspectLocationCharacter(
            window.currentLobbyId,
            getCurrentLocationId(),
            targetCharacterId,
            actorLocationCharacterId,
        ),
    ]);
    const actorEntries = getCharacterTransferEntries(actorCharacter?.data || {});
    const targetEntries = getCharacterTransferEntries(snapshot?.target_data || {});
    const actorOffer = [];
    const targetOffer = [];
    const modal = ensureCharacterTradeModal();
    modal.innerHTML = `
        <div class="modal-content" style="width:min(1120px,calc(100vw - 24px));max-width:1120px;max-height:88vh;overflow:hidden;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,.08);">
                <div><h3 style="margin:0;">Обмен</h3><div style="font-size:12px;opacity:.7;">Стоимость в бою: 2 ОД после согласия</div></div>
                <button type="button" class="btn btn-secondary trade-decline">Отказаться</button>
            </div>
            <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.8fr) minmax(0,1fr);gap:12px;overflow:auto;max-height:calc(88vh - 130px);padding:12px 0;">
                <section class="trade-panel"><h4>${escapeHtml(actorCharacter?.name || 'Ваш персонаж')}</h4><div class="trade-actor-inventory"></div></section>
                <section style="background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;">
                    <div class="trade-actor-offer"></div>
                    <div class="trade-target-offer" style="margin-top:16px;"></div>
                </section>
                <section class="trade-panel"><h4>${escapeHtml(snapshot.target_name || 'Другой персонаж')}</h4><div class="trade-target-inventory"></div></section>
            </div>
            <div class="form-actions"><button type="button" class="btn btn-primary trade-confirm">Подтвердить предложение</button><button type="button" class="btn btn-secondary trade-decline">Отказаться</button></div>
        </div>`;
    const render = () => {
        renderTradeInventoryList(
            modal.querySelector('.trade-actor-inventory'),
            actorEntries,
            '→',
            (entry, amount) => { addTradeOfferEntry(actorOffer, entry, amount); render(); },
        );
        renderTradeInventoryList(
            modal.querySelector('.trade-target-inventory'),
            targetEntries,
            '←',
            (entry, amount) => { addTradeOfferEntry(targetOffer, entry, amount); render(); },
        );
        renderTradeOfferList(
            modal.querySelector('.trade-actor-offer'),
            `${actorCharacter?.name || 'Вы'} отдаёт`,
            actorOffer,
            '→',
            index => { actorOffer.splice(index, 1); render(); },
        );
        renderTradeOfferList(
            modal.querySelector('.trade-target-offer'),
            `${snapshot.target_name || 'Персонаж'} отдаёт`,
            targetOffer,
            '←',
            index => { targetOffer.splice(index, 1); render(); },
        );
    };
    render();
    modal.querySelectorAll('.trade-decline').forEach(button => {
        button.onclick = () => { modal.style.display = 'none'; };
    });
    modal.querySelector('.trade-confirm').onclick = async () => {
        try {
            const result = await Server.createCharacterInteraction(
                window.currentLobbyId,
                getCurrentLocationId(),
                {
                    actor_location_character_id: actorLocationCharacterId,
                    target_character_id: targetCharacterId,
                    kind: 'trade',
                    payload: {
                        actor_offer: actorOffer.map(({ available, key, ...entry }) => entry),
                        target_offer: targetOffer.map(({ available, key, ...entry }) => entry),
                    },
                },
            );
            modal.style.display = 'none';
            showNotification(
                result.status === 'completed' ? 'Обмен завершён' : 'Предложение обмена отправлено',
                result.status === 'completed' ? 'success' : 'system',
            );
        } catch (error) {
            showNotification(error.message || 'Не удалось предложить обмен', 'system');
        }
    };
    modal.style.display = 'flex';
}

async function showIncomingCharacterInteraction(requestData) {
    const modal = ensureCharacterTradeModal();
    if (modal.dataset.interactionRequestId === String(requestData.id) && modal.style.display === 'flex') return;
    modal.dataset.interactionRequestId = String(requestData.id);
    const procedure = requestData.payload?.procedure || {};
    if (requestData.kind === 'treatment') {
        modal.innerHTML = `
            <div class="modal-content" style="width:min(520px,calc(100vw - 24px));">
                <h3>Согласие на лечение</h3>
                <p><strong>${escapeHtml(requestData.actor_name)}</strong> собирается провести процедуру персонажу <strong>${escapeHtml(requestData.target_name)}</strong>.</p>
                <div style="padding:10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.035);">
                    <div style="font-weight:700;">${escapeHtml(procedure.item_name || 'Медицинская процедура')}</div>
                    <div style="margin-top:4px;opacity:.8;">${escapeHtml(procedure.application || '')}</div>
                    <div style="margin-top:4px;font-size:12px;opacity:.65;">Заявленная стоимость: ${Number(procedure.action_points || 0)} ОД без учёта доставания</div>
                </div>
                <p style="font-size:13px;opacity:.75;">При отказе врач и пациент совершат встречные проверки Силы.</p>
                <div class="form-actions"><button class="btn btn-primary interaction-accept">Согласиться</button><button class="btn btn-secondary interaction-decline">Отказаться</button></div>
            </div>`;
    } else {
        modal.innerHTML = `
            <div class="modal-content" style="width:min(1120px,calc(100vw - 24px));max-width:1120px;max-height:88vh;overflow:hidden;">
                <h3>Предложение обмена</h3>
                <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,.8fr) minmax(0,1fr);gap:12px;overflow:auto;max-height:calc(88vh - 150px);">
                    <section><h4>${escapeHtml(requestData.actor_name)}</h4><div class="trade-actor-inventory"></div></section>
                    <section style="background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;"><div class="trade-actor-offer"></div><div class="trade-target-offer" style="margin-top:16px;"></div></section>
                    <section><h4>${escapeHtml(requestData.target_name)}</h4><div class="trade-target-inventory"></div></section>
                </div>
                <div class="form-actions"><button class="btn btn-primary interaction-accept">Подтвердить обмен</button><button class="btn btn-secondary interaction-decline">Отказаться</button></div>
            </div>`;
        renderTradeInventoryList(
            modal.querySelector('.trade-actor-inventory'),
            getCharacterTransferEntries(requestData.actor_data || {}),
            '',
        );
        renderTradeInventoryList(
            modal.querySelector('.trade-target-inventory'),
            getCharacterTransferEntries(requestData.target_data || {}),
            '',
        );
        renderTradeOfferList(
            modal.querySelector('.trade-actor-offer'),
            `${requestData.actor_name} отдаёт`,
            requestData.payload?.actor_offer || [],
            '→',
        );
        renderTradeOfferList(
            modal.querySelector('.trade-target-offer'),
            `${requestData.target_name} отдаёт`,
            requestData.payload?.target_offer || [],
            '←',
        );
    }
    const respond = async decision => {
        modal.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try {
            const result = await Server.respondCharacterInteraction(
                window.currentLobbyId,
                requestData.id,
                decision,
            );
            modal.style.display = 'none';
            if (requestData.kind === 'treatment' && decision === 'decline') {
                const contest = result.result || {};
                showNotification(
                    contest.forced
                        ? `Отказ не удался: ${result.actor_name} победил во встречной проверке Силы (${contest.actor_strength.total} против ${contest.target_strength.total})`
                        : `Лечение отклонено. Сила: ${contest.actor_strength?.total ?? '?'} против ${contest.target_strength?.total ?? '?'}`,
                    contest.forced ? 'system' : 'success',
                );
            } else {
                showNotification(
                    result.status === 'completed' ? 'Обмен завершён' : 'Ответ отправлен',
                    result.status === 'completed' ? 'success' : 'system',
                );
            }
        } catch (error) {
            modal.querySelectorAll('button').forEach(button => { button.disabled = false; });
            showNotification(error.message || 'Не удалось отправить ответ', 'system');
        }
    };
    modal.querySelector('.interaction-accept').onclick = () => respond('accept');
    modal.querySelector('.interaction-decline').onclick = () => respond('decline');
    modal.style.display = 'flex';
}

export function handleCharacterInteractionRequest(requestData) {
    if (Number(requestData.location_id) !== Number(getCurrentLocationId())
        && !requestData.payload?.gm_decision_for_offline_target) return;
    showIncomingCharacterInteraction(requestData).catch(error => {
        showNotification(error.message || 'Не удалось открыть запрос взаимодействия', 'system');
    });
}

export function handleCharacterInteractionResolved(requestData) {
    if (requestData.status === 'cancelled'
        && characterTradeModal?.dataset.interactionRequestId === String(requestData.id)) {
        characterTradeModal.style.display = 'none';
    }
    const resolve = pendingCharacterInteractionResolvers.get(requestData.id);
    if (resolve) {
        resolve({
            allowed: ['accepted', 'forced', 'in_progress', 'completed'].includes(requestData.status),
            requestId: requestData.id,
            status: requestData.status,
            result: requestData.result || {},
        });
    }
    if (requestData.kind === 'trade') {
        if (requestData.status === 'completed') showNotification('Обмен завершён', 'success');
        if (requestData.status === 'rejected') showNotification('Предложение обмена отклонено', 'system');
    }
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

async function showMutantButcheringMenu(actorLocationCharacterId, targetCharacterId) {
    const profile = await Server.butcherLocationMutant(
        window.currentLobbyId,
        getCurrentLocationId(),
        targetCharacterId,
        { actor_location_character_id: actorLocationCharacterId },
    );
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="width:min(660px,calc(100vw - 28px));max-height:calc(100vh - 28px);overflow:auto;">
            <button type="button" class="close mutant-card-close" aria-label="Закрыть">&times;</button>
            <h3 style="margin-bottom:5px;">Разделка: ${escapeHtml(profile.target_name || profile.species)}</h3>
            <div style="font-size:13px;opacity:.78;margin-bottom:12px;">
                d20 ${profile.roll.roll} ${Number(profile.roll.mutant_modifier) >= 0 ? '+' : ''}${profile.roll.mutant_modifier} вид
                ${Number(profile.roll.weapon_bonus) >= 0 ? '+' : ''}${profile.roll.weapon_bonus} оружие
                ${Number(profile.roll.survival_bonus) >= 0 ? '+' : ''}${profile.roll.survival_bonus} Выживание − 5
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid rgba(211,182,106,.3);border-radius:10px;background:rgba(211,182,106,.08);">
                <strong>Очки разделки</strong><strong class="butchering-points" style="font-size:20px;"></strong>
            </div>
            <div class="butchering-parts" style="display:grid;gap:8px;margin-top:12px;"></div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">
                <button type="button" class="btn btn-secondary butchering-cancel">Отмена</button>
                <button type="button" class="btn btn-primary butchering-confirm">Завершить разделку</button>
            </div>
        </div>
    `;
    const values = Object.fromEntries(Object.keys(profile.parts || {}).map(key => [key, 0]));
    const points = modal.querySelector('.butchering-points');
    const list = modal.querySelector('.butchering-parts');
    const rows = new Map();
    const spentPoints = () => Object.entries(values).reduce(
        (sum, [key, value]) => sum + value * Number(profile.parts[key]?.points || 0),
        0,
    );
    const render = () => {
        const spent = spentPoints();
        const total = Number(profile.roll.total) || 0;
        points.textContent = `${total - spent} / ${total}`;
        rows.forEach((row, key) => {
            const part = profile.parts[key];
            row.querySelector('.butchering-count').textContent = values[key];
            row.querySelector('.butchering-minus').disabled = values[key] <= 0;
            row.querySelector('.butchering-plus').disabled = !part.available
                || spent + Number(part.points) > total
                || (part.max !== null && part.max !== undefined && values[key] >= Number(part.max));
        });
    };
    Object.entries(profile.parts || {}).forEach(([key, part]) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.035);';
        const maxText = part.max === null || part.max === undefined ? '' : ` · максимум ${part.max}`;
        const radiationText = Number(part.radiation) > 0 ? ` · радиация ${part.radiation}` : '';
        row.innerHTML = `
            <div><strong>${escapeHtml(part.label)}</strong><div style="font-size:12px;opacity:.7;">${part.points} очк. · ${part.weight} кг · ${part.unit_price} ₽${maxText}${radiationText}${part.available ? '' : ' · недоступно'}</div></div>
            <div style="display:grid;grid-template-columns:34px 34px 34px;align-items:center;text-align:center;gap:4px;">
                <button type="button" class="btn btn-sm btn-secondary butchering-minus">−</button>
                <strong class="butchering-count">0</strong>
                <button type="button" class="btn btn-sm btn-secondary butchering-plus">+</button>
            </div>
        `;
        row.querySelector('.butchering-minus').onclick = () => {
            values[key] = Math.max(0, values[key] - 1);
            render();
        };
        row.querySelector('.butchering-plus').onclick = () => {
            values[key] += 1;
            render();
        };
        rows.set(key, row);
        list.appendChild(row);
    });
    const close = () => modal.remove();
    modal.querySelector('.close').onclick = close;
    modal.querySelector('.butchering-cancel').onclick = close;
    modal.addEventListener('pointerdown', event => {
        if (event.target === modal) close();
    });
    modal.querySelector('.butchering-confirm').onclick = async event => {
        event.currentTarget.disabled = true;
        try {
            const result = await Server.butcherLocationMutant(
                window.currentLobbyId,
                getCurrentLocationId(),
                targetCharacterId,
                {
                    actor_location_character_id: actorLocationCharacterId,
                    confirm: true,
                    allocation: values,
                },
            );
            close();
            const loot = (result.loot || []).map(item => `${item.name} ×${item.quantity}`).join(', ');
            showNotification(loot ? `Получено: ${loot}` : 'Разделка завершена без добычи', 'success');
        } catch (error) {
            event.currentTarget.disabled = false;
            showNotification(error.message || 'Не удалось завершить разделку', 'system');
        }
    };
    document.body.appendChild(modal);
    render();
}

function showCharacterInteractionMenu(clientX, clientY, targetCharacterId) {
    const actorCharacterId = pendingStructureAction?.actorCharacterId;
    const actorLocationCharacterId = pendingStructureAction?.actorLocationCharacterId;
    if (!canInteractWithCharacter(actorCharacterId, targetCharacterId)) {
        clearStructureActionMenu();
        return;
    }
    ensureStructureActionMenu();
    const target = getLocationCharacterById(targetCharacterId);
    const targetCombat = findCombatCharacterByCharacterId(targetCharacterId);
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
    const actions = condition.state === 'active'
        ? [
            {
                icon: '✚',
                label: 'Лечить',
                run: () => showMedicalConsumableMenu(actorCharacterId, targetCharacterId, actorLocationCharacterId),
            },
            {
                icon: '⇄',
                label: 'Обмен',
                run: () => showCharacterTradeMenu(actorLocationCharacterId, actorCharacterId, targetCharacterId),
            },
        ]
        : [
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
                run: () => showMedicalConsumableMenu(actorCharacterId, targetCharacterId, actorLocationCharacterId),
            },
        ];
    if (condition.state === 'dead' && (targetCombat?.is_mutant || target?.isMutant)) {
        actions.push({
            icon: '◆',
            label: 'Разделать мутанта',
            run: () => showMutantButcheringMenu(actorLocationCharacterId, targetCharacterId),
        });
    }
    actions.forEach(action => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.icon;
        button.title = action.label;
        button.style.cssText = 'width:52px;height:52px;margin:8px;border:0;border-radius:14px;background:rgba(255,255,255,.06);color:#fff;font-size:20px;cursor:pointer;';
        button.onclick = async event => {
            event.stopPropagation();
            hideStructureInteraction();
            try {
                await action.run();
            } catch (error) {
                showNotification(error.message || 'Не удалось выполнить взаимодействие', 'system');
            }
        };
        structureActionMenu.appendChild(button);
    });
    structureActionMenu.style.display = 'block';
    const rect = structureActionMenu.getBoundingClientRect();
    let anchorX = clientX;
    let anchorY = clientY;
    const model = getCharacterModelEntry(targetCharacterId)?.model;
    if (model && camera) {
        const anchor = new THREE.Vector3();
        model.getWorldPosition(anchor);
        anchor.y += 0.9;
        anchor.project(camera);
        if (anchor.z > -1 && anchor.z < 1) {
            anchorX = ((anchor.x + 1) / 2) * window.innerWidth;
            anchorY = ((1 - anchor.y) / 2) * window.innerHeight;
        }
    }
    let left = anchorX + 10;
    if (left + rect.width > window.innerWidth - 8) left = anchorX - rect.width - 10;
    structureActionMenu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
    structureActionMenu.style.top = `${Math.max(8, Math.min(anchorY - rect.height / 2, window.innerHeight - rect.height - 8))}px`;
}

async function executeStructureAction(object, actionKey, actorCharacterId = pendingStructureAction?.actorCharacterId || null) {
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

    if (actionKey === 'toggle_fire') {
        const changed = await updateInteractiveObject(object.id, {
            actor_character_id: Number(actorCharacterId),
            properties: { is_lit: object.properties?.is_lit !== true },
        });
        if (changed) hideStructureInteraction();
        return Boolean(changed);
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

    const title = findLocationAsset(object.type)?.label || object.name || object.type || 'Объект';
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
            const actorCharacterId = pendingStructureAction?.actorCharacterId || null;
            hideStructureInteraction();
            await executeStructureAction(object, item.actionKey, actorCharacterId);
        };
        structureActionMenu.appendChild(button);
    });

    structureActionMenu.style.display = 'block';
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
    let left = anchorX + 10;
    if (left + rect.width > window.innerWidth - 8) left = anchorX - rect.width - 10;
    structureActionMenu.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
    structureActionMenu.style.top = `${Math.max(8, Math.min(anchorY - rect.height / 2, window.innerHeight - rect.height - 8))}px`;
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
    transferBtn.onclick = async () => {
        transferBtn.disabled = true;
        try {
            await onTransfer(Math.max(1, Math.min(parseInt(qtyInput.value || '1', 10) || 1, currentQuantity)));
        } catch (error) {
            showNotification(error.message || 'Перенос не выполнен. Обновите содержимое контейнера.', 'system');
        } finally {
            transferBtn.disabled = false;
        }
    };

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
        if (action === 'toggle_fire') {
            actions.push({
                label: object.properties?.is_lit ? 'Потушить' : 'Зажечь',
                action: () => updateInteractiveObject(object.id, {
                    actor_character_id: pendingStructureAction?.actorCharacterId
                        || window.currentLocationCharacterId || window.currentCharacterId,
                    properties: { is_lit: object.properties?.is_lit !== true },
                }),
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
    disposeObject(mesh);
}

function getStructureDimensions(preset = structurePreset) {
    if (window.locationEditorTool === 'assets' && selectedLocationAsset?.kind === 'structure'
        && selectedLocationAsset.id === preset) {
        return { width: structureWidth, depth: structureDepth, height: structureHeight };
    }
    if (preset === 'floor') return { width: structureWidth, depth: structureDepth, height: 0.12 };
    if (preset === 'door') return { width: 0.9, depth: 0.18, height: Math.max(1.8, structureHeight) };
    if (preset === 'window') return { width: 1.2, depth: 0.14, height: 1 };
    if (preset === 'table') return { width: structureWidth, depth: structureDepth, height: Math.max(0.6, structureHeight) };
    if (preset === 'chair') return { width: structureWidth, depth: structureDepth, height: structureHeight };
    if (preset === 'shelf') return { width: structureWidth, depth: Math.max(0.3, structureDepth), height: structureHeight };
    return { width: structureWidth, depth: Math.max(0.1, structureDepth), height: structureHeight };
}

const FLOOR_SURFACE_OFFSET = 0.035;

function createLocationObjectMesh(obj, forPreview = false) {
    const properties = obj.properties || {};
    const asset = visualAssetForLocationObject(obj.type, properties);
    const floorPose = obj.type === 'floor' ? floorVisualPose(obj, currentLocationData?.objects) : null;
    const dimensions = properties.dimensions || floorPose
        || (isFireObject(obj) ? baseAssetDimensions(obj.type, 'structure') : getStructureDimensions(obj.type));
    const width = floorPose?.width || dimensions.width || 1;
    const depth = floorPose?.depth || dimensions.depth || 1;
    const height = dimensions.height || 1;
    const hasSeparateMaterials = ['fence', 'window', 'box', 'military_crate', 'shelf', 'ground_item'].includes(obj.type)
        || properties.is_ground_item || isFireObject(obj) || isElectricFixture(obj);
    const material = hasSeparateMaterials ? null
        : new THREE.MeshStandardMaterial({ color: properties.color || '#aa8866', roughness: 0.93 });
    if (['wall', 'floor'].includes(obj.type) && asset?.visual?.renderMode !== 'pbr') {
        applySurfacePattern(material, getSurfaceTexture(THREE, obj.type),
            obj.type === 'floor' ? 0.32 : 0.25, obj.type === 'floor' ? 'top' : 'sides');
    }
    if (obj.type === 'floor') applyInteriorFloorShade(material, width, depth);
    if (asset?.visual?.renderMode === 'pbr' && material) {
        applyLocationPbrMaterial(material, asset.visual.maps);
    }
    const group = new THREE.Group();
    let main;

    if (obj.type === 'fence') {
        const fenceColor = properties.color === '#67745d' ? '#8b7458' : (properties.color || '#8b7458');
        group.add(createFenceModel(THREE, width, height, depth, fenceColor));
    } else if (obj.type === 'wall') {
        const plan = wallVisualPlan(obj, currentLocationData?.objects || []);
        for (const span of plan.spans) {
            const piece = new THREE.Mesh(
                new THREE.BoxGeometry(span.end - span.start, span.top - span.bottom, depth),
                material,
            );
            if (asset?.visual?.renderMode === 'pbr') {
                tileLocationPbrBoxUvs(piece.geometry, span.end - span.start, span.top - span.bottom, depth);
            }
            piece.position.set((span.start + span.end) / 2, (span.bottom + span.top) / 2, 0);
            group.add(piece);
        }
    } else if (obj.type === 'window') {
        const frameMaterial = new THREE.MeshStandardMaterial({ color: '#6f756b' });
        const glassMaterial = new THREE.MeshStandardMaterial({
            color: properties.color || '#9bb7bc', transparent: true, opacity: 0.42,
            metalness: 0.08, roughness: 0.12, side: THREE.DoubleSide,
        });
        for (const sign of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, height, depth + 0.04), frameMaterial);
            post.position.set(sign * (width / 2 - 0.035), height / 2, 0);
            group.add(post);
            const rail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.07, depth + 0.04), frameMaterial);
            rail.position.set(0, sign > 0 ? height - 0.035 : 0.035, 0);
            group.add(rail);
        }
        if (!properties.is_open) {
            const pane = new THREE.Mesh(new THREE.BoxGeometry(width - 0.14, height - 0.14, 0.025), glassMaterial);
            pane.position.y = height / 2;
            group.add(pane);
        }
    } else if (obj.type === 'door') {
        const jamb = 0.09;
        const frame = doorFrameStyle(obj, currentLocationData?.objects || []);
        const frameMaterial = new THREE.MeshStandardMaterial({ color: frame.color });
        for (const sign of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(jamb, frame.height, frame.depth), frameMaterial);
            post.position.set(sign * (width / 2 + jamb / 2), frame.bottom + frame.height / 2, 0);
            group.add(post);
        }
        const lintel = new THREE.Mesh(new THREE.BoxGeometry(width + 2 * jamb, 0.12, frame.depth), frameMaterial);
        lintel.position.y = frame.bottom + frame.height - 0.06;
        group.add(lintel);
        const pivot = new THREE.Group();
        pivot.position.x = -width / 2;
        const panelHeight = frame.inWall
            ? Math.max(0.05, Math.min(height, frame.bottom + frame.height - 0.12)) : height;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(width, panelHeight, depth), material);
        panel.position.set(width / 2, panelHeight / 2, 0);
        pivot.add(panel);
        const hardware = new THREE.MeshStandardMaterial({ color: '#b7b5a7', metalness: 0.65, roughness: 0.4 });
        for (const side of [-1, 1]) {
            const plate = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.16, 0.018), hardware);
            plate.position.set(width * 0.77, Math.min(1.02, panelHeight * 0.55),
                side * (depth / 2 + 0.012));
            pivot.add(plate);
            const lever = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.026, 0.034), hardware);
            lever.position.set(width * 0.7, plate.position.y,
                side * (depth / 2 + 0.045));
            pivot.add(lever);
        }
        pivot.rotation.y = properties.is_open ? -Math.PI / 2 : 0;
        group.add(pivot);
        if (!frame.inWall) {
            for (const sign of [-1, 1]) {
                const wing = new THREE.Mesh(new THREE.BoxGeometry(0.42, height + 0.12, depth + 0.08), material);
                wing.position.set(sign * (width / 2 + jamb + 0.21), (height + 0.12) / 2, 0);
                group.add(wing);
            }
        }
    } else if (isFireObject(obj)) {
        const fire = createFireObjectModel(THREE, obj, { width, depth, height });
        group.add(fire);
        group.userData.fireFlames = fire.userData.fireFlames || [];
    } else if (isElectricFixture(obj)) {
        group.add(createElectricFixtureModel(THREE, obj, { width, depth, height }));
    } else if (obj.type === 'ground_item' || properties.is_ground_item) {
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
    } else if (obj.type === 'box' || obj.type === 'military_crate') {
        group.add(createCrateModel(THREE, width, height, depth,
            properties.color || (obj.type === 'military_crate' ? '#45543a' : '#8b6b4f'),
            obj.type === 'military_crate'));
    } else if (obj.type === 'shelf') {
        group.add(createShelfModel(THREE, width, height, depth, properties.color || '#78634c'));
    } else if (obj.type === 'barrel') {
        main = new THREE.Mesh(
            new THREE.CylinderGeometry(width / 2, width / 2, height, 20),
            material,
        );
        main.position.y = height / 2;
        group.add(main);
    } else {
        main = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        main.position.y = height / 2;
        group.add(main);
    }
    if (obj.type === 'floor' && asset?.visual?.renderMode === 'pbr') {
        group.traverse(child => {
            if (child.isMesh && child.geometry?.attributes?.uv) {
                const size = child.geometry.parameters;
                tileLocationPbrBoxUvs(child.geometry, size.width, size.height, size.depth);
            }
        });
    }

    const objectPosition = getObjectGridPosition(obj);
    const tileX = objectPosition.x ?? 0;
    const tileY = objectPosition.y ?? 0;
    group.position.set(floorPose?.x ?? tileX + 0.5 + Number(properties.offset_x || 0),
        getTileHeight(tileX, tileY) + clampAssetElevation(properties.elevation)
            - (obj.type === 'floor' ? height - FLOOR_SURFACE_OFFSET : 0),
        floorPose?.z ?? tileY + 0.5 + Number(properties.offset_z || 0));
    if (obj.type === 'ground_item' || properties.is_ground_item) {
        group.position.y += 0.04;
    }
    group.rotation.y = properties.rotation || 0;
    if (obj.type === 'floor' && asset?.visual?.renderMode === 'pbr') {
        group.updateMatrixWorld(true);
        group.traverse(child => {
            if (child.isMesh) alignLocationPbrFloorUvs(child.geometry, child);
        });
    }
    group.traverse(child => {
        if (!child.isMesh) return;
        child.castShadow = obj.type !== 'floor' && !child.userData.fireFlame;
        child.receiveShadow = true;
    });
    group.userData = { ...group.userData, locationObjectId: obj.id, locationObject: obj };
    if (properties.gm_hidden && window.isGM) makeGmHiddenGhost(group);
    const customColor = properties.color && String(properties.color).toLowerCase() !== asset?.color?.toLowerCase();
    if (asset?.visual?.renderMode === 'glb' && !customColor) {
        const fallback = [...group.children];
        mountLocationModel(group, asset, { width, depth, height }, model => {
            fallback.forEach(child => {
                group.remove(child);
                disposeObject(child);
            });
            model.traverse(child => {
                if (!child.isMesh) return;
                child.castShadow = !forPreview && !child.userData.importedNoShadow;
                child.receiveShadow = !forPreview;
            });
            group.add(model);
            if (forPreview) fadeEditorPreview(model);
            if (properties.gm_hidden && window.isGM) makeGmHiddenGhost(model);
            else if (!forPreview) tintLocationMesh(model, darknessFactorAt(group.position.x, group.position.z));
        }, error => {
            group.userData.assetLoadError = true;
            if (!forPreview) {
                console.warn(`Unable to load location model ${asset.visual.modelPath}; using procedural fallback`, error);
            }
        });
    }
    return group;
}

function darknessFactorAt(x, z) {
    if (!locationDarknessFactors || !currentLocationData) return 1;
    const tileX = Math.floor(x);
    const tileZ = Math.floor(z);
    if (tileX < 0 || tileZ < 0 || tileX >= currentLocationData.grid_width
        || tileZ >= currentLocationData.grid_height) return 1;
    return locationDarknessFactors[tileZ * currentLocationData.grid_width + tileX] ?? 1;
}

function getLocationFireSources() {
    const sources = getFireLightSources(currentLocationData?.objects);
    sources.push(...(currentLocationData?.objects || []).map(object => electricFixtureLightSource(object)).filter(Boolean));
    sources.push(...getLocationDecorFireSources());
    return sources;
}

function isObjectLightSource(object) {
    return isFireObject(object) || isElectricFixture(object);
}

const MIN_FIRE_LIGHT_POOL = 4;

function createFirePointLight(source, objectId = null) {
    const light = new THREE.PointLight(source?.color || '#ffb064', source?.intensity || 0,
        source?.distance || 6, 2);
    light.userData.fireObjectId = objectId;
    light.userData.firePoolLight = true;
    if (source) light.position.set(source.x,
        getTileHeight(source.tileX, source.tileZ) + source.height, source.z);
    // Point-light shadows render the entire scene six times per flame.
    light.castShadow = false;
    light.shadow.mapSize.set(256, 256);
    light.shadow.radius = 2;
    return light;
}

function syncFireObjectLight(object, objectId = object?.id, refreshDarkness = true) {
    if (!locationLightGroup || objectId == null) return;
    const existing = locationLightGroup.children.find(child => child.userData.firePoolLight
        && child.userData.fireObjectId != null
        && String(child.userData.fireObjectId) === String(objectId));
    const source = fireLightSource(object, true) || electricFixtureLightSource(object, true);
    if (!source) {
        if (existing) {
            existing.intensity = 0;
            existing.userData.fireObjectId = null;
            if (refreshDarkness && activeLightingProfile?.dark_tiles?.length) {
                refreshLocationDarkness(activeLightingProfile, true);
            }
        }
        return;
    }
    const light = existing || locationLightGroup.children.find(child => child.userData.firePoolLight
        && child.userData.fireObjectId == null) || createFirePointLight(null);
    if (!light.parent) locationLightGroup.add(light);
    light.userData.fireObjectId = objectId;
    light.position.set(source.x, getTileHeight(source.tileX, source.tileZ) + source.height, source.z);
    light.intensity = source.intensity;
    light.distance = source.distance;
    light.color.set(source.color);
    if (refreshDarkness && activeLightingProfile?.dark_tiles?.length) {
        refreshLocationDarkness(activeLightingProfile, true);
    }
}

function getLocationDecorFireSources() {
    const sources = [];
    for (const [z, row] of (currentLocationData?.tiles_data || []).entries()) {
        for (const [x, tile] of row.entries()) {
            for (const decor of tile.objects || []) {
                if (decor.type !== 'campfire' || decor.is_lit === false) continue;
                const source = fireLightSource({
                    type: 'campfire', tile_x: x, tile_y: z,
                    properties: {
                        is_lit: true, offset_x: decor.x, offset_z: decor.z,
                        elevation: decor.elevation,
                        dimensions: assetDimensions(decor, 'decor', 'campfire'),
                    },
                });
                if (source) sources.push(source);
            }
        }
    }
    return sources;
}

function getLocationEmissiveSources() {
    return [...getLocationFireSources(), ...getAnomalyLightSources(currentLocationData?.tiles_data)];
}

const anomalyLightFrustum = new THREE.Frustum();
const anomalyLightViewMatrix = new THREE.Matrix4();
const anomalyLightSphere = new THREE.Sphere();

function updateAnomalyRenderLights(now = performance.now(), force = false) {
    if (!camera || !controls || !anomalyRenderPool.length || (!force && now - lastAnomalyLightUpdateAt < 150)) return;
    lastAnomalyLightUpdateAt = now;
    camera.updateMatrixWorld();
    anomalyLightViewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    anomalyLightFrustum.setFromProjectionMatrix(anomalyLightViewMatrix);
    const selected = selectAnomalyRenderLights(anomalyRenderSources, controls.target, source => {
        anomalyLightSphere.center.set(source.x, source.y, source.z);
        anomalyLightSphere.radius = source.distance;
        return anomalyLightFrustum.intersectsSphere(anomalyLightSphere);
    }, anomalyRenderPool.length);
    anomalyRenderPool.forEach((light, index) => {
        const source = selected[index];
        light.intensity = source?.intensity || 0;
        if (!source) return;
        light.color.set(source.color);
        light.distance = source.distance;
        light.position.set(source.x, source.y, source.z);
    });
}

export function isLocationCharacterInDarkness(characterId) {
    if (!currentLocationData) return null;
    const entry = getCharacterModelEntry(characterId);
    if (!entry) return null;
    const x = Math.floor(Number(entry.posX));
    const z = Math.floor(Number(entry.posY));
    const profile = activeLightingProfile || resolveLocationLighting(
        currentLocationData.lighting, window.lobbyGameTimeMinutes ?? 480,
    );
    const marked = (profile.dark_tiles || []).some(tile => tile.x === x && tile.z === z);
    const night = isWorldDarkTime(window.lobbyGameTimeMinutes ?? 480);
    const ambient = Number(profile.ambient_intensity) + Number(profile.directional_intensity);
    if (!marked && !(profile.mode === 'world' ? night : ambient < 0.12)) return false;
    const daylight = profile.mode === 'world' && night ? 0 : Math.min(1, ambient);
    const factor = computeDarknessFactors(
        currentLocationData.grid_width, currentLocationData.grid_height,
        [{ x, z }], currentLocationData.objects || [],
        [...(profile.local_lights || []), ...getLocationEmissiveSources()], daylight,
    )[z * currentLocationData.grid_width + x];
    return factor < 0.12;
}

function tintLocationMesh(mesh, factor) {
    if (mesh.userData?.gmHiddenGhost) return;
    mesh.traverse(child => {
        if (!child.isMesh) return;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
            if (!material?.color) continue;
            if (!material.userData.darkBaseColor) material.userData.darkBaseColor = material.color.clone();
            material.color.copy(material.userData.darkBaseColor).multiplyScalar(factor);
        }
    });
}

function refreshDarknessEditorOverlay(darkTiles = activeLightingProfile?.dark_tiles || []) {
    if (darknessEditorOverlay) {
        scene?.remove(darknessEditorOverlay);
        disposeObject(darknessEditorOverlay);
        darknessEditorOverlay = null;
    }
    if (!scene || !currentLocationData || !darkTiles.length) return;
    const geometry = new THREE.PlaneGeometry(0.86, 0.86);
    const material = new THREE.MeshBasicMaterial({
        color: 0x65d8ed, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    });
    darknessEditorOverlay = new THREE.InstancedMesh(geometry, material, darkTiles.length);
    const transform = new THREE.Object3D();
    for (let index = 0; index < darkTiles.length; index++) {
        const { x, z } = darkTiles[index];
        transform.position.set(x + 0.5, getTileHeight(x, z) + 0.045, z + 0.5);
        transform.rotation.set(-Math.PI / 2, 0, 0);
        transform.updateMatrix();
        darknessEditorOverlay.setMatrixAt(index, transform.matrix);
    }
    darknessEditorOverlay.instanceMatrix.needsUpdate = true;
    darknessEditorOverlay.visible = darknessOverlayRequested && editMode;
    darknessEditorOverlay.renderOrder = 6;
    scene.add(darknessEditorOverlay);
}

export function setLocationDarknessOverlayVisible(visible) {
    darknessOverlayRequested = Boolean(visible);
    if (darknessEditorOverlay) darknessEditorOverlay.visible = darknessOverlayRequested && editMode;
}

export function previewLocationDarkTiles(darkTiles) {
    if (!activeLightingProfile) return;
    refreshLocationDarkness({ ...activeLightingProfile, dark_tiles: darkTiles });
}

function refreshLocationDarkness(profile = activeLightingProfile, lightOnly = false) {
    if (!currentLocationData || !profile) return;
    activeLightingProfile = profile;
    const daylight = profile.mode === 'world' && isWorldDarkTime(window.lobbyGameTimeMinutes ?? 480)
        ? 0 : Math.min(1, Number(profile.ambient_intensity) + Number(profile.directional_intensity));
    const previousFactors = locationDarknessFactors;
    const nextFactors = computeDarknessFactors(
        currentLocationData.grid_width, currentLocationData.grid_height,
        profile.dark_tiles || [], currentLocationData.objects || [],
        [...(profile.local_lights || []), ...getLocationEmissiveSources()], daylight,
    );
    const changedTiles = lightOnly && previousFactors ? new Set() : null;
    if (changedTiles) {
        for (const tile of profile.dark_tiles || []) {
            const index = tile.z * currentLocationData.grid_width + tile.x;
            if (Math.abs(nextFactors[index] - previousFactors[index]) > 0.001) changedTiles.add(index);
        }
    }
    locationDarknessFactors = nextFactors;
    if (changedTiles && !changedTiles.size) {
        if (fogIsActive()) applyFogOfWar();
        return;
    }
    if (locationDarknessTexture) {
        writeDarknessPixels(locationDarknessFactors, locationDarknessTexture.image.data);
        locationDarknessTexture.needsUpdate = true;
    }
    if (!lightOnly) refreshDarknessEditorOverlay(profile.dark_tiles || []);
    if (locationTileMesh) {
        const tileIndices = changedTiles || Array.from(
            { length: currentLocationData.grid_width * currentLocationData.grid_height }, (_, index) => index);
        for (const index of tileIndices) {
            const x = index % currentLocationData.grid_width;
            const z = Math.floor(index / currentLocationData.grid_width);
            const tile = currentLocationData.tiles_data[z][x];
            if (tile.terrain === 'water') {
                waterTileMesh?.setColorAt(index, new THREE.Color(0xffffff));
            } else {
                locationTileMesh.setColorAt(index,
                    new THREE.Color(terrainColors[tile.terrain] || 0x3a5f0b)
                        .multiplyScalar(darknessFactorAt(x, z)));
            }
        }
        locationTileMesh.instanceColor.needsUpdate = true;
        if (waterTileMesh?.instanceColor) waterTileMesh.instanceColor.needsUpdate = true;
    }
    updateSmoothTerrainColors(changedTiles);
    updateLocationGridColors(changedTiles);
    for (const mesh of locationObjectMeshes) {
        if (changedTiles && !changedTiles.has(Math.floor(mesh.position.z) * currentLocationData.grid_width
            + Math.floor(mesh.position.x))) continue;
        tintLocationMesh(mesh, darknessFactorAt(mesh.position.x, mesh.position.z));
    }
    for (const mesh of objectMeshes) {
        if (changedTiles && !changedTiles.has(Math.floor(mesh.position.z) * currentLocationData.grid_width
            + Math.floor(mesh.position.x))) continue;
        if (!anomalyEffectMeshes.includes(mesh)) tintLocationMesh(mesh, darknessFactorAt(mesh.position.x, mesh.position.z));
    }
    for (const entry of characterModels.values()) {
        if (changedTiles && !changedTiles.has(Math.floor(entry.model.position.z) * currentLocationData.grid_width
            + Math.floor(entry.model.position.x))) continue;
        tintLocationMesh(entry.model, darknessFactorAt(entry.model.position.x, entry.model.position.z));
    }
    if (!lightOnly || fogIsActive()) applyFogOfWar();
}

function addLocationObjectMesh(obj, refreshFog = true) {
    if (locationObjectMeshes.some(mesh => mesh.userData.locationObjectId === obj.id)) return;
    const mesh = createLocationObjectMesh(obj);
    tintLocationMesh(mesh, darknessFactorAt(mesh.position.x, mesh.position.z));
    scene.add(mesh);
    locationObjectMeshes.push(mesh);
    if (refreshFog) applyFogOfWar();
}

function removeLocationObjectMesh(objectId, refreshFog = true) {
    const mesh = locationObjectMeshes.find(item => Number(item.userData.locationObjectId) === Number(objectId));
    if (!mesh) return;
    scene.remove(mesh);
    disposeLocationObject(mesh);
    locationObjectMeshes = locationObjectMeshes.filter(item => item !== mesh);
    if (refreshFog) applyFogOfWar();
}

function replaceLocationObjectMesh(object, refreshFog = true) {
    removeLocationObjectMesh(object.id, false);
    addLocationObjectMesh(object, refreshFog);
}

function updateRoofVisibility() {
    if (!camera || !controls || !roofMeshes.length) return;
    const distance = camera.position.distanceTo(controls.target);
    for (const roof of roofMeshes) {
        const visible = roofVisibleForCamera(roof.userData.roofPlan, controls.target,
            distance, locationRoofsVisible, editMode, camera.position);
        for (const child of roof.userData.visualMeshes) child.visible = visible;
    }
}

function rebuildLocationRoofs() {
    for (const roof of roofMeshes) {
        scene?.remove(roof);
        disposeLocationObject(roof);
    }
    roofMeshes = [];
    if (!scene || !currentLocationData) return;
    const plans = roofPlans(currentLocationData.objects, (x, z) => getTileHeight(x, z));
    const enclosedFloors = new Set(plans.map(plan => plan.floorId));
    for (const object of locationObjectMeshes) {
        const enclosed = enclosedFloors.has(object.userData.locationObjectId);
        object.traverse(child => {
            if (child.isMesh && child.material?.userData.interiorShade) {
                child.material.userData.interiorShade.value = enclosed ? 1 : 0;
            }
        });
    }
    const texture = getSurfaceTexture(THREE, 'roof');
    for (const plan of plans) {
        const material = new THREE.MeshStandardMaterial({
            color: plan.color, roughness: 0.94, side: THREE.DoubleSide,
        });
        applySurfacePattern(material, texture, 0.22, 'top');
        const roof = new THREE.Group();
        const roofGeometry = createRoofGeometry(THREE, plan);
        const roofFace = new THREE.Mesh(roofGeometry, material);
        roof.add(roofFace);
        const gableMaterial = new THREE.MeshStandardMaterial({
            color: plan.gableColor, roughness: 1, side: THREE.DoubleSide,
        });
        applySurfacePattern(gableMaterial, getSurfaceTexture(THREE, 'wall'), 0.25, 'sides');
        const gable = new THREE.Mesh(createRoofGableGeometry(THREE, plan), gableMaterial);
        roof.add(gable);
        const shadowCaster = new THREE.Mesh(roofGeometry,
            new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
        shadowCaster.castShadow = true;
        shadowCaster.raycast = () => {};
        roof.add(shadowCaster);
        roof.position.set(plan.x, plan.eaveY, plan.z);
        roof.rotation.y = plan.angle;
        roof.traverse(child => {
            if (!child.isMesh) return;
            child.receiveShadow = true;
        });
        roof.raycast = () => {};
        roof.userData.roofPlan = plan;
        roof.userData.visualMeshes = [roofFace, gable];
        scene.add(roof);
        roofMeshes.push(roof);
    }
    updateRoofVisibility();
}

function refreshArchitecturalMeshes() {
    if (!scene || !currentLocationData) return;
    for (let index = 0; index < locationObjectMeshes.length; index++) {
        const oldMesh = locationObjectMeshes[index];
        const source = (currentLocationData.objects || []).find(item => item.id === oldMesh.userData.locationObjectId);
        if (!source || !['wall', 'door', 'window', 'floor'].includes(source.type)) continue;
        scene.remove(oldMesh);
        disposeLocationObject(oldMesh);
        const newMesh = createLocationObjectMesh(source);
        tintLocationMesh(newMesh, darknessFactorAt(newMesh.position.x, newMesh.position.z));
        scene.add(newMesh);
        locationObjectMeshes[index] = newMesh;
    }
    rebuildLocationRoofs();
    rebuildLocationGrid();
    applyFogOfWar();
    refreshLocationDarkness();
}

function updateLocationObjectHeight(tileX, tileZ) {
    const height = getTileHeight(tileX, tileZ);
    locationObjectMeshes.forEach(mesh => {
        const object = mesh.userData.locationObject;
        if (!object) return;
        const position = getObjectGridPosition(object);
        if (position.x === tileX && position.y === tileZ) {
            mesh.position.y = height + clampAssetElevation(object.properties?.elevation)
                - (object.type === 'floor'
                    ? Number(object.properties?.dimensions?.height || 0.12) - FLOOR_SURFACE_OFFSET : 0);
        }
    });
}

function clearBuildPreview() {
    buildPreviewKey = null;
    if (!buildPreviewMesh) return;
    scene?.remove(buildPreviewMesh);
    disposeLocationObject(buildPreviewMesh);
    buildPreviewMesh = null;
}

function createPosterMesh(color) {
    const group = new THREE.Group();
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 1.16, 0.035),
        new THREE.MeshStandardMaterial({ color: '#302d27', roughness: 0.9 }),
    );
    frame.position.x = -0.02;
    frame.rotation.y = Math.PI / 2;
    const paper = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 1.1),
        new THREE.MeshStandardMaterial({ color: color || '#c9a96a', side: THREE.DoubleSide, roughness: 0.95 }),
    );
    paper.position.x = 0.005;
    paper.rotation.y = Math.PI / 2;
    group.add(frame, paper);
    return group;
}

function createEditorDecorPreview(type, color) {
    if (type.startsWith('anomaly_')) {
        const key = type.slice('anomaly_'.length);
        const profile = (window.locationAnomalyCatalog || []).find(anomaly => anomaly.key === key);
        return createAnomalyEffect(profile?.visual || 'void', color || '#79d7dd', 1, key, '');
    }
    if (type === 'poster') return createPosterMesh(color);
    if (type === 'tent') return createTentModel(THREE, color || '#9b9778');
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: color || '#7f9674' });
    if (type === 'tree') {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.7, 8),
            new THREE.MeshStandardMaterial({ color: '#5b3a20' }));
        trunk.position.y = 0.35;
        group.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.43, 1.2, 8), material);
        crown.position.y = 1.15;
        group.add(crown);
    } else {
        const geometry = type === 'rock' ? new THREE.DodecahedronGeometry(0.35)
            : new THREE.CylinderGeometry(0.23, 0.3, 0.16, 8);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.y = type === 'rock' ? 0.2 : 0.08;
        group.add(mesh);
    }
    return group;
}

function applyDecorSize(mesh, source, type) {
    const base = baseAssetDimensions(type, 'decor');
    const dimensions = assetDimensions(source, 'decor', type);
    mesh.scale.set(
        (type === 'poster' ? dimensions.depth / base.depth : dimensions.width / base.width),
        dimensions.height / base.height,
        (type === 'poster' ? dimensions.width / base.width : dimensions.depth / base.depth),
    );
}

function createEditorLampPreview(source, includeLight = true) {
    const group = new THREE.Group();
    const isSpot = source.kind === 'spot' || source.lightKind === 'spot';
    const fixture = new THREE.Mesh(
        isSpot ? new THREE.ConeGeometry(0.22, 0.35, 12) : new THREE.SphereGeometry(0.2, 12, 8),
        new THREE.MeshStandardMaterial({ color: source.color, emissive: source.color, emissiveIntensity: 0.65 }),
    );
    if (isSpot) {
        fixture.rotation.z = -Math.PI / 2;
        fixture.rotation.y = -Number(source.azimuth || 0) * Math.PI / 180;
    }
    const base = baseAssetDimensions(isSpot ? 'spot' : 'point', 'lamp');
    const dimensions = assetDimensions(source, 'lamp', isSpot ? 'spot' : 'point');
    fixture.scale.set(dimensions.width / base.width, dimensions.height / base.height, dimensions.depth / base.depth);
    group.add(fixture);
    if (!includeLight) return group;
    const previewIntensity = Math.min(Number(source.intensity || 2), 2);
    const distance = Number(source.distance || 7);
    if (isSpot) {
        const light = new THREE.SpotLight(source.color, previewIntensity, distance, Math.PI / 5, 0.55, 2);
        const azimuth = Number(source.azimuth || 0) * Math.PI / 180;
        light.target.position.set(Math.cos(azimuth) * 5, -Math.min(3, Number(source.height)), Math.sin(azimuth) * 5);
        group.add(light, light.target);
        group.add(new THREE.ArrowHelper(
            new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)),
            new THREE.Vector3(), 0.9, source.color, 0.22, 0.13,
        ));
    } else {
        group.add(new THREE.PointLight(source.color, previewIntensity, distance, 2));
    }
    return group;
}

function fadeEditorPreview(mesh) {
    mesh.traverse(child => {
        if (!child.isMesh) return;
        for (const material of (Array.isArray(child.material) ? child.material : [child.material])) {
            material.transparent = true;
            material.opacity = 0.55;
            material.depthWrite = false;
        }
        child.raycast = () => {};
        child.castShadow = false;
    });
    return mesh;
}

function createEditorGroupMovePreview() {
    const group = new THREE.Group();
    for (const selection of editorSelections) {
        const source = getEditorSource(selection);
        if (!source) continue;
        let mesh;
        if (selection.kind === 'structure') {
            mesh = createLocationObjectMesh(source, true);
        } else if (selection.kind === 'lamp') {
            mesh = createEditorLampPreview(source, false);
            mesh.position.set(Number(source.x),
                getTileHeight(Math.floor(source.x), Math.floor(source.z)) + Number(source.height), Number(source.z));
        } else {
            const type = source.type === 'anomaly' ? `anomaly_${source.anomalyKey}` : source.type;
            mesh = createEditorDecorPreview(type, source.color);
            applyDecorSize(mesh, source, type);
            mesh.rotation.y = THREE.MathUtils.degToRad(Number(source.rotation) || 0);
            mesh.position.set(selection.x + 0.5 + Number(source.x || 0),
                getTileHeight(selection.x, selection.z) + clampAssetElevation(source.elevation),
                selection.z + 0.5 + Number(source.z || 0));
        }
        const originX = mesh.position.x;
        const originZ = mesh.position.z;
        mesh.userData.editorMoveOrigin = {
            x: originX, z: originZ,
            groundOffset: mesh.position.y - getTileHeight(Math.floor(originX), Math.floor(originZ)),
            rotation: mesh.rotation.y,
        };
        group.add(mesh);
    }
    return fadeEditorPreview(group);
}

function updateBuildPreview() {
    if (editorRotateMode && editorSelections.length === 1 && editorSelection?.kind === 'lamp') {
        clearBuildPreview();
        return;
    }
    if (!window.locationEditMode || !hoveredTileCoords || !scene) {
        clearBuildPreview();
        return;
    }
    if (editorRotateMode && editorSelections.length > 1 && editorGroupRotatePivot) {
        const key = `group-rotate:${editorSelections.map(selection =>
            `${selection.kind}:${selection.id ?? `${selection.x}:${selection.z}:${selection.index}`}`).join('|')}`;
        if (!buildPreviewMesh || buildPreviewKey !== key) {
            clearBuildPreview();
            buildPreviewMesh = createEditorGroupMovePreview();
            buildPreviewKey = key;
            const pivotMarker = new THREE.Mesh(
                new THREE.RingGeometry(0.1, 0.18, 24),
                new THREE.MeshBasicMaterial({ color: 0xe5bb6a, side: THREE.DoubleSide, depthTest: false }),
            );
            pivotMarker.rotation.x = -Math.PI / 2;
            pivotMarker.position.set(editorGroupRotatePivot.x,
                getTileHeight(Math.floor(editorGroupRotatePivot.x), Math.floor(editorGroupRotatePivot.z)) + 0.08,
                editorGroupRotatePivot.z);
            pivotMarker.raycast = () => {};
            buildPreviewMesh.add(pivotMarker);
            scene.add(buildPreviewMesh);
        }
        for (const mesh of buildPreviewMesh.children) {
            const origin = mesh.userData.editorMoveOrigin;
            if (!origin) continue;
            const next = editorGroupRotateWithPivot
                ? rotatePointAround(origin.x, origin.z,
                    editorGroupRotatePivot.x, editorGroupRotatePivot.z, editorRotateAngle)
                : origin;
            mesh.position.x = next.x;
            mesh.position.z = next.z;
            mesh.rotation.y = origin.rotation + bearingToObjectRotation(editorRotateAngle);
            const tileX = Math.floor(next.x);
            const tileZ = Math.floor(next.z);
            if (tileX >= 0 && tileZ >= 0 && tileX < currentLocationData.grid_width
                && tileZ < currentLocationData.grid_height) {
                mesh.position.y = getTileHeight(tileX, tileZ) + origin.groundOffset;
            }
        }
        return;
    }
    if (editorMoveMode && editorSelections.length > 1) {
        if (!editorMovePreviewPoint) {
            clearBuildPreview();
            return;
        }
        const key = `group-move:${editorSelections.map(selection =>
            `${selection.kind}:${selection.id ?? `${selection.x}:${selection.z}:${selection.index}`}`).join('|')}`;
        if (!buildPreviewMesh || buildPreviewKey !== key) {
            clearBuildPreview();
            buildPreviewMesh = createEditorGroupMovePreview();
            buildPreviewKey = key;
            scene.add(buildPreviewMesh);
        }
        const anchor = getSelectedLocationEditorAsset();
        if (!anchor) return;
        const dx = editorMovePreviewPoint.x - anchor.x;
        const dz = editorMovePreviewPoint.z - anchor.z;
        buildPreviewMesh.position.set(dx, 0, dz);
        for (const mesh of buildPreviewMesh.children) {
            const origin = mesh.userData.editorMoveOrigin;
            const tileX = Math.floor(origin.x + dx);
            const tileZ = Math.floor(origin.z + dz);
            if (tileX >= 0 && tileZ >= 0 && tileX < currentLocationData.grid_width
                && tileZ < currentLocationData.grid_height) {
                mesh.position.y = getTileHeight(tileX, tileZ) + origin.groundOffset;
            }
        }
        return;
    }
    const selectedPosition = editorRotateMode || editorResizeMode ? getSelectedLocationEditorAsset() : null;
    const x = editorMoveMode && editorMovePreviewPoint ? Math.floor(editorMovePreviewPoint.x)
        : selectedPosition ? Math.floor(selectedPosition.x) : hoveredTileCoords.x;
    const z = editorMoveMode && editorMovePreviewPoint ? Math.floor(editorMovePreviewPoint.z)
        : selectedPosition ? Math.floor(selectedPosition.z) : hoveredTileCoords.z;
    const editingSelection = editorMoveMode || editorRotateMode || editorResizeMode;
    const source = editingSelection ? getSelectedEditorSource() : selectedLocationAsset;
    const placingAsset = window.locationEditorTool === 'assets' && selectedLocationAsset;
    const movableStructurePreview = placingAsset && !editingSelection && source?.kind === 'structure';
    const mountOffsetX = !editingSelection ? Math.sin(structureRotation) * Number(source?.offsetZ || 0) : 0;
    const mountOffsetZ = !editingSelection ? Math.cos(structureRotation) * Number(source?.offsetZ || 0) : 0;
    const previewKey = [window.locationEditorTool, movableStructurePreview ? 'structure' : x,
        movableStructurePreview ? 'preview' : z, editorMoveMode, editorRotateMode, editorRotateAngle,
        editorResizeMode, editorResizeAxis, JSON.stringify(editorResizeDimensions),
        editorMovePreviewPoint?.x?.toFixed(2), editorMovePreviewPoint?.z?.toFixed(2),
        source?.id || source?.type || source?.kind,
        source?.properties?.rotation ?? source?.rotation ?? source?.azimuth,
        source?.properties?.elevation ?? source?.elevation ?? source?.height,
        source?.x ?? source?.offsetX, source?.z ?? source?.offsetZ,
        JSON.stringify(source?.dimensions || source?.properties?.dimensions || null),
        structureWidth, structureDepth, structureHeight, structureColor, structureRotation].join(':');
    if (buildPreviewMesh && buildPreviewKey === previewKey) {
        if (movableStructurePreview) buildPreviewMesh.position.set(x + 0.5 + mountOffsetX,
            getTileHeight(x, z) + clampAssetElevation(source.elevation), z + 0.5 + mountOffsetZ);
        return;
    }
    clearBuildPreview();
    buildPreviewKey = previewKey;
    if (editingSelection || placingAsset) {
        if (!source) return;
        const kind = editingSelection ? editorSelection.kind : source.kind;
        if (kind === 'structure') {
            const object = editingSelection ? (editorResizeMode
                ? { ...source, properties: { ...source.properties, dimensions: editorResizeDimensions } }
                : editorMoveMode && editorMovePreviewPoint ? {
                    ...source, tile_x: x, tile_y: z,
                    properties: { ...source.properties,
                        offset_x: editorMovePreviewPoint.x - x - 0.5,
                        offset_z: editorMovePreviewPoint.z - z - 0.5 },
                } : source) : {
                type: placementForLocationAsset(source).type, tile_x: x, tile_y: z,
                properties: {
                    dimensions: { width: structureWidth, depth: structureDepth, height: structureHeight },
                    color: structureColor,
                    rotation: structureRotation,
                    offset_x: mountOffsetX,
                    offset_z: mountOffsetZ,
                    elevation: clampAssetElevation(source.elevation),
                    ...(placementForLocationAsset(source).visualAsset ? { visual_asset: source.id } : {}),
                    ...(isFireObject({ type: source.id }) ? { is_lit: true } : {}),
                    ...(isElectricFixture({ type: source.id }) ? { is_on: true } : {}),
                },
            };
            buildPreviewMesh = createLocationObjectMesh(object, true);
        } else if (kind === 'lamp') {
            const lampPreview = editorResizeMode
                ? { ...source, dimensions: editorResizeDimensions, intensity: 0 } : source;
            buildPreviewMesh = createEditorLampPreview(lampPreview);
            buildPreviewMesh.position.set(
                editorResizeMode ? Number(source.x) : editorMovePreviewPoint?.x ?? x + 0.5,
                getTileHeight(x, z) + Number(source.height),
                editorResizeMode ? Number(source.z) : editorMovePreviewPoint?.z ?? z + 0.5,
            );
        } else {
            const decorType = source.type === 'anomaly'
                ? `anomaly_${source.anomalyKey}` : source.type || source.id;
            buildPreviewMesh = createEditorDecorPreview(decorType, source.color);
            const decorPreview = editorResizeMode
                ? { ...source, dimensions: editorResizeDimensions, scale: 1 } : source;
            applyDecorSize(buildPreviewMesh, decorPreview, decorType);
            buildPreviewMesh.rotation.y = THREE.MathUtils.degToRad(
                editingSelection ? Number(source.rotation || 0) : -Number(source.rotation || 0),
            );
            buildPreviewMesh.position.set(
                editorMovePreviewPoint?.x ?? x + 0.5 + Number(source.x ?? source.offsetX ?? 0),
                getTileHeight(x, z) + clampAssetElevation(source.elevation),
                editorMovePreviewPoint?.z ?? z + 0.5 + Number(source.z ?? source.offsetZ ?? 0),
            );
        }
        if (kind === 'structure') buildPreviewMesh.position.set(
            editorMovePreviewPoint?.x ?? x + 0.5 + Number(source.properties?.offset_x || 0) + mountOffsetX,
            getTileHeight(x, z),
            editorMovePreviewPoint?.z ?? z + 0.5 + Number(source.properties?.offset_z || 0) + mountOffsetZ,
        );
        if (kind === 'structure') buildPreviewMesh.position.y += clampAssetElevation(source.properties?.elevation ?? source.elevation);
        if (editorRotateMode) {
            buildPreviewMesh.rotation.y = bearingToObjectRotation(editorRotateAngle);
            const arrow = new THREE.ArrowHelper(
                new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.16, 0),
                0.8, 0x8be2cb, 0.2, 0.13,
            );
            arrow.traverse(item => { item.raycast = () => {}; });
            buildPreviewMesh.add(arrow);
        }
        if (editorResizeMode) {
            const posterAxes = kind === 'decor' && source.type === 'poster';
            const axes = editorResizeAxis === 'all' ? ['width', 'depth', 'height'] : [editorResizeAxis];
            for (const axis of axes) {
                const direction = axis === 'height' ? new THREE.Vector3(0, 1, 0)
                    : axis === 'depth' ? new THREE.Vector3(posterAxes ? 1 : 0, 0, posterAxes ? 0 : 1)
                        : new THREE.Vector3(posterAxes ? 0 : 1, 0, posterAxes ? 1 : 0);
                const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(0, 0.16, 0),
                    0.8, 0xe5bb6a, 0.2, 0.13);
                arrow.traverse(item => { item.raycast = () => {}; });
                buildPreviewMesh.add(arrow);
            }
        }
        scene.add(fadeEditorPreview(buildPreviewMesh));
        return;
    }
    if (buildMode !== 'structure' || window.locationEditorTool === 'assets') return;
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
    const placement = window.locationEditorTool === 'assets' && selectedLocationAsset?.id === structurePreset
        ? placementForLocationAsset(selectedLocationAsset) : { type: structurePreset, visualAsset: null };
    const placedType = placement.type;
    const selectedCoverClass = document.getElementById('loc-structure-cover-class')?.value || 'medium';
    const coverProfile = COVER_CLASS_DEFAULTS[selectedCoverClass] || COVER_CLASS_DEFAULTS.medium;
    try {
        const object = await Server.createLocationObject(window.currentLobbyId, currentLocationId, {
            name: placedType,
            type: placedType,
            tile_x: x,
            tile_y: z,
            properties: {
                dimensions,
                color: structureColor,
                ...(placement.visualAsset ? { visual_asset: placement.visualAsset } : {}),
                rotation: structureRotation,
                offset_x: Math.sin(structureRotation) * Number(selectedLocationAsset?.offsetZ || 0),
                offset_z: Math.cos(structureRotation) * Number(selectedLocationAsset?.offsetZ || 0),
                elevation: window.locationEditorTool === 'assets'
                    ? clampAssetElevation(selectedLocationAsset?.elevation) : 0,
                cover_class: selectedCoverClass,
                cover_max_hp: coverProfile.maxHp,
                cover_hp: coverProfile.maxHp,
                cover_base_physical_protection: coverProfile.protection,
                cover_physical_protection: coverProfile.protection,
                weight_kg: THROWABLE_OBJECT_WEIGHTS[placedType],
                interactions: objectInteractions[placedType] || [],
                interaction_requirements: (objectInteractions[placedType] || []).reduce((rules, action) => {
                    rules[action] = interactionRequirements[action];
                    return rules;
                }, {}),
                contents: ['shelf', 'box', 'military_crate', 'chest'].includes(placedType) ? [] : undefined,
                is_open: false,
                ...(isFireObject({ type: placedType }) ? { is_lit: true } : {}),
                ...(isElectricFixture({ type: placedType }) ? { is_on: true } : {}),
                passable: isObjectLightSource({ type: placedType }),
                cover_enabled: !isObjectLightSource({ type: placedType }),
            }
        });
        addLocationObject(object);
        return object;
    } catch (error) {
        showNotification(error.message || 'Не удалось построить объект');
    }
}

async function removeStructuresAtTile(x, z, radius = 0) {
    if (!window.currentLobbyId || !currentLocationData) return;
    const locationData = currentLocationData;
    const objects = (locationData.objects || []).filter(object => {
        const position = getObjectGridPosition(object);
        return Math.abs(position.x - x) <= radius && Math.abs(position.y - z) <= radius
            && !structureDeletionInFlight.has(object.id);
    });
    if (!objects.length) return;

    objects.forEach(object => structureDeletionInFlight.add(object.id));
    const results = await Promise.allSettled(
        objects.map(object => Server.deleteLocationObject(window.currentLobbyId, object.id))
    );
    let removedFloor = false;
    let removedArchitecture = false;
    let removedFire = false;
    let removedAny = false;
    results.forEach((result, index) => {
        const object = objects[index];
        const objectId = object.id;
        structureDeletionInFlight.delete(objectId);
        if (result.status === 'fulfilled') {
            if (currentLocationData !== locationData) return;
            removeLocationObjectMesh(objectId, false);
            locationData.objects = locationData.objects.filter(item => item.id !== objectId);
            removedAny = true;
            removedFloor ||= object.type === 'floor';
            removedArchitecture ||= ['wall', 'door', 'window', 'floor'].includes(object.type);
            removedFire ||= isObjectLightSource(object);
            if (isObjectLightSource(object)) syncFireObjectLight(null, objectId, false);
        } else {
            showNotification(result.reason?.message || 'Не удалось удалить объект');
        }
    });
    if (!removedAny) return;
    if (removedFloor) rebuildGrassDetailMesh();
    if (removedArchitecture) {
        refreshArchitecturalMeshes();
    } else if (removedFire && activeLightingProfile?.dark_tiles?.length) {
        refreshLocationDarkness(activeLightingProfile, true);
    } else if (fogIsActive()) {
        applyFogOfWar();
    }
    invalidateMovementMapCache();
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
    if (currentLocationData.objects.some(item => String(item.id) === String(object.id))) return;
    currentLocationData.objects.push(object);
    const fire = isObjectLightSource(object);
    addLocationObjectMesh(object, !fire);
    if (object.type === 'floor') { rebuildLocationGrid(); rebuildGrassDetailMesh(); rebuildLocationRoofs(); }
    if (['wall', 'door', 'window'].includes(object.type)) refreshArchitecturalMeshes();
    if (fire) {
        syncFireObjectLight(object);
        if ((!activeLightingProfile?.dark_tiles?.length || !locationLightGroup) && fogIsActive()) applyFogOfWar();
    }
    invalidateMovementMapCache();
}

window.addLocationObject = addLocationObject;

export function removeLocationObject(objectId) {
    if (!currentLocationData) return;
    const removed = (currentLocationData.objects || []).find(object => Number(object.id) === Number(objectId));
    if (Number(containerInteractionState?.objectId) === Number(objectId)) closeContainerInteractionMenu();
    removeLocationObjectMesh(objectId, false);
    currentLocationData.objects = (currentLocationData.objects || []).filter(object => Number(object.id) !== Number(objectId));
    if (removed?.type === 'floor') { rebuildLocationGrid(); rebuildGrassDetailMesh(); rebuildLocationRoofs(); }
    if (['wall', 'door', 'window'].includes(removed?.type)) refreshArchitecturalMeshes();
    const fire = isObjectLightSource(removed);
    if (fire) syncFireObjectLight(null, objectId);
    invalidateMovementMapCache();
    if (!fire || ((!activeLightingProfile?.dark_tiles?.length || !locationLightGroup) && fogIsActive())) applyFogOfWar();
}

window.removeLocationObject = removeLocationObject;

export function updateLocationObject(object) {
    if (!currentLocationData) return;
    currentLocationData.objects = currentLocationData.objects || [];
    const index = currentLocationData.objects.findIndex(item => String(item.id) === String(object.id));
    const previous = index === -1 ? null : currentLocationData.objects[index];
    if (index === -1) currentLocationData.objects.push(object);
    else currentLocationData.objects[index] = object;
    const fire = isObjectLightSource(object) || isObjectLightSource(previous);
    replaceLocationObjectMesh(object, !fire);
    if (object.type === 'floor' || previous?.type === 'floor') {
        rebuildLocationGrid();
        rebuildGrassDetailMesh();
        rebuildLocationRoofs();
    }
    if (['wall', 'door', 'window'].includes(object.type)) refreshArchitecturalMeshes();
    if (fire) {
        syncFireObjectLight(object);
        if ((!activeLightingProfile?.dark_tiles?.length || !locationLightGroup) && fogIsActive()) applyFogOfWar();
    }
    invalidateMovementMapCache();
    if (typeof editorSelection !== 'undefined' && editorSelection?.kind === 'structure' && editorSelection.id === object.id) {
        updateEditorSelectionVisual();
        notifyEditorSelection();
    }
    if (Number(containerInteractionState?.objectId) === Number(object.id)) {
        containerExchangeTarget = object;
        containerInteractionRefresh?.(object);
    }
}

window.updateLocationObject = updateLocationObject;

export function applyLocationLighting(settings, persist = true) {
    if (settings && persist && currentLocationData) currentLocationData.lighting = settings;
    if (!scene || !currentLocationData || !locationAmbientLight || !locationDirectionalLight) return;
    locationProfiler?.stop();
    const cloudSetting = window.weatherSettings?.sun;
    const clarity = cloudSetting?.enabled ? Number(cloudSetting.intensity) : 1;
    const profile = resolveLocationLighting(
        settings || currentLocationData.lighting,
        window.lobbyGameTimeMinutes ?? 480,
        clarity,
    );
    locationAmbientLight.color.set(profile.ambient_color);
    locationAmbientLight.intensity = Number(profile.ambient_intensity);
    locationDirectionalLight.color.set(profile.directional_color);
    locationDirectionalLight.intensity = Number(profile.directional_intensity);
    const azimuth = Number(profile.directional_azimuth) * Math.PI / 180;
    const elevation = Number(profile.directional_elevation) * Math.PI / 180;
    const distance = Math.max(currentLocationData.grid_width, currentLocationData.grid_height);
    const centerX = currentLocationData.grid_width / 2;
    const centerZ = currentLocationData.grid_height / 2;
    locationDirectionalLight.target.position.set(centerX, 1, centerZ);
    locationDirectionalLight.position.set(
        centerX + Math.cos(azimuth) * Math.cos(elevation) * distance,
        1 + Math.sin(elevation) * distance,
        centerZ + Math.sin(azimuth) * Math.cos(elevation) * distance,
    );
    locationDirectionalLight.target.updateMatrixWorld();
    const shadowExtent = distance * 0.9 + 6;
    const shadowCamera = locationDirectionalLight.shadow.camera;
    shadowCamera.left = -shadowExtent;
    shadowCamera.right = shadowExtent;
    shadowCamera.top = shadowExtent;
    shadowCamera.bottom = -shadowExtent;
    shadowCamera.near = 0.1;
    shadowCamera.far = distance * 3 + 20;
    shadowCamera.updateProjectionMatrix();
    scene.background.set(profile.background_color);

    if (locationLightGroup) {
        scene.remove(locationLightGroup);
        disposeObject(locationLightGroup);
    }
    locationLightGroup = new THREE.Group();
    for (const [index, source] of (profile.local_lights || []).entries()) {
        const x = Number(source.x);
        const z = Number(source.z);
        const tileX = Math.max(0, Math.min(currentLocationData.grid_width - 1, Math.floor(x)));
        const tileZ = Math.max(0, Math.min(currentLocationData.grid_height - 1, Math.floor(z)));
        const y = getTileHeight(tileX, tileZ) + Number(source.height);
        const fixture = new THREE.Group();
        fixture.userData.locationLampIndex = index;
        fixture.position.set(x, y, z);
        const isSpot = source.kind === 'spot';
        const light = isSpot
            ? new THREE.SpotLight(source.color, Number(source.intensity), Number(source.distance), Math.PI / 5, 0.55, 2)
            : new THREE.PointLight(source.color, Number(source.intensity), Number(source.distance), 2);
        light.castShadow = true;
        light.shadow.mapSize.set(512, 512);
        light.shadow.radius = 2;
        fixture.add(light);
        if (isSpot) {
            const azimuth = Number(source.azimuth || 0) * Math.PI / 180;
            light.target.position.set(Math.cos(azimuth) * 5, -Math.min(3, Number(source.height)), Math.sin(azimuth) * 5);
            fixture.add(light.target);
        }
        const bulb = new THREE.Mesh(
            isSpot ? new THREE.ConeGeometry(0.2, 0.34, 12) : new THREE.SphereGeometry(0.18, 12, 8),
            new THREE.MeshStandardMaterial({ color: source.color, emissive: source.color, emissiveIntensity: 0.5 }),
        );
        if (isSpot) {
            bulb.rotation.z = -Math.PI / 2;
            bulb.rotation.y = -Number(source.azimuth || 0) * Math.PI / 180;
        }
        const base = baseAssetDimensions(isSpot ? 'spot' : 'point', 'lamp');
        const dimensions = assetDimensions(source, 'lamp', isSpot ? 'spot' : 'point');
        bulb.scale.set(dimensions.width / base.width, dimensions.height / base.height, dimensions.depth / base.depth);
        if (source.gm_hidden && window.isGM) makeGmHiddenGhost(bulb);
        bulb.userData.locationLampBulb = true;
        bulb.visible = Boolean(window.isGM && (editMode || source.gm_hidden));
        fixture.add(bulb);
        const picker = new THREE.Mesh(
            new THREE.SphereGeometry(0.38, 8, 6),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        picker.visible = Boolean(window.isGM && editMode);
        fixture.add(picker);
        locationLightGroup.add(fixture);
    }
    let fireLightCount = 0;
    for (const object of currentLocationData.objects || []) {
        const source = fireLightSource(object, true) || electricFixtureLightSource(object, true);
        if (source) {
            locationLightGroup.add(createFirePointLight(source, object.id));
            fireLightCount++;
        }
    }
    const fireLightCapacity = Math.max(MIN_FIRE_LIGHT_POOL, Math.ceil((fireLightCount + 1) / 4) * 4);
    for (; fireLightCount < fireLightCapacity; fireLightCount++) {
        locationLightGroup.add(createFirePointLight(null));
    }
    for (const source of getLocationDecorFireSources()) {
        const light = new THREE.PointLight(source.color, source.intensity, source.distance, 2);
        light.position.set(source.x,
            getTileHeight(source.tileX, source.tileZ) + source.height, source.z);
        light.castShadow = source.castsShadow !== false;
        light.shadow.mapSize.set(256, 256);
        light.shadow.radius = 2;
        locationLightGroup.add(light);
    }
    anomalyRenderSources = getAnomalyLightSources(currentLocationData?.tiles_data).map(source => ({
        ...source,
        y: getTileHeight(source.tileX, source.tileZ) + source.height,
    }));
    anomalyRenderPool = [];
    for (let index = 0; index < Math.min(MAX_ANOMALY_RENDER_LIGHTS, anomalyRenderSources.length); index++) {
        const light = new THREE.PointLight('#ffffff', 0, 3, 2);
        light.castShadow = false;
        anomalyRenderPool.push(light);
        locationLightGroup.add(light);
    }
    lastAnomalyLightUpdateAt = -Infinity;
    scene.add(locationLightGroup);
    updateAnomalyRenderLights(performance.now(), true);
    refreshLocationDarkness(profile);
    updateEditorSelectionVisual(settings && !persist ? settings : null);
}

function getEditorSource(selection) {
    if (!selection || !currentLocationData) return null;
    if (selection.kind === 'structure') {
        return (currentLocationData.objects || []).find(item => item.id === selection.id) || null;
    }
    if (selection.kind === 'lamp') {
        return currentLocationData.lighting?.local_lights?.[selection.index] || null;
    }
    return currentLocationData.tiles_data?.[selection.z]?.[selection.x]?.objects?.[selection.index] || null;
}

function getEditorSelectionPosition(selection, source = getEditorSource(selection)) {
    if (!source) return null;
    if (selection.kind === 'structure') return {
        x: Number(source.tile_x) + 0.5 + Number(source.properties?.offset_x || 0),
        z: Number(source.tile_y) + 0.5 + Number(source.properties?.offset_z || 0),
    };
    if (selection.kind === 'lamp') return { x: Number(source.x), z: Number(source.z) };
    return {
        x: selection.x + 0.5 + Number(source.x || 0),
        z: selection.z + 0.5 + Number(source.z || 0),
    };
}

function getEditorGroupPivot() {
    const positions = editorSelections.map(selection => getEditorSelectionPosition(selection)).filter(Boolean);
    if (!positions.length) return null;
    return {
        x: positions.reduce((total, position) => total + position.x, 0) / positions.length,
        z: positions.reduce((total, position) => total + position.z, 0) / positions.length,
    };
}

function getSelectedEditorSource() {
    return getEditorSource(editorSelection);
}

function getPrimaryLocationEditorAsset() {
    const source = getSelectedEditorSource();
    if (!source) return null;
    const kind = editorSelection.kind;
    if (kind === 'structure') return {
        kind, label: findLocationAsset(source.type)?.label || source.name || source.type,
        x: Number(source.tile_x) + 0.5 + Number(source.properties?.offset_x || 0),
        z: Number(source.tile_y) + 0.5 + Number(source.properties?.offset_z || 0),
        rotation: Math.round((objectRotationToBearing(source.properties?.rotation || 0) + 360) % 360),
        elevation: clampAssetElevation(source.properties?.elevation),
        color: source.properties?.color || '#aa8866',
        dimensions: assetDimensions(source, 'structure', source.type),
        resizable: true,
        fire: isObjectLightSource(source),
        electric: isElectricFixture(source),
        isLit: isElectricFixture(source) ? source.properties?.is_on !== false : source.properties?.is_lit === true,
    };
    if (kind === 'lamp') return {
        kind, label: source.kind === 'spot' ? 'Прожектор' : 'Лампа',
        x: source.x, z: source.z, rotation: Number(source.azimuth || 0),
        height: source.height, elevation: source.height, color: source.color,
        intensity: source.intensity, distance: source.distance,
        lightKind: source.kind || 'point',
        dimensions: assetDimensions(source, 'lamp', source.kind || 'point'),
        resizable: true,
    };
    return {
        kind, label: source.anomalyName || findLocationAsset(source.type)?.label || source.type,
        x: editorSelection.x + 0.5 + Number(source.x || 0),
        z: editorSelection.z + 0.5 + Number(source.z || 0),
        rotation: Math.round((-(Number(source.rotation) || 0) + 360) % 360),
        elevation: clampAssetElevation(source.elevation),
        color: source.color || '#aa8866',
        dimensions: assetDimensions(source, 'decor', source.type),
        resizable: true,
    };
}

export function getSelectedLocationEditorAsset() {
    const asset = getPrimaryLocationEditorAsset();
    const source = getSelectedEditorSource();
    return asset ? { ...asset, selectedCount: editorSelections.length,
        hidden: Boolean(editorSelection.kind === 'structure' ? source?.properties?.gm_hidden : source?.gm_hidden) } : null;
}

function notifyEditorSelection() {
    window.dispatchEvent(new CustomEvent('location-editor-selection', {
        detail: getSelectedLocationEditorAsset(),
    }));
}

export function getLocationAssetResizeState() {
    return {
        active: editorResizeMode,
        axis: editorResizeAxis,
        dimensions: editorResizeDimensions ? { ...editorResizeDimensions } : null,
    };
}

function notifyEditorResize() {
    window.dispatchEvent(new CustomEvent('location-editor-resize', {
        detail: getLocationAssetResizeState(),
    }));
}

export function cancelLocationAssetResize() {
    if (!editorResizeMode) return false;
    editorResizeMode = false;
    editorResizeDimensions = null;
    editorResizeBaseDimensions = null;
    editorResizeAnchor = null;
    notifyEditorResize();
    updateBuildPreview();
    return true;
}

function clearEditorSelection() {
    if (editorSelection?.kind === 'lamp') applyLocationLighting();
    editorSelection = null;
    editorSelections = [];
    editorMoveMode = false;
    editorMovePreviewPoint = null;
    editorRotateMode = false;
    editorGroupRotatePivot = null;
    editorGroupRotateStartBearing = null;
    editorGroupRotateWithPivot = false;
    editorResizeMode = false;
    editorResizeDimensions = null;
    editorResizeBaseDimensions = null;
    editorResizeAnchor = null;
    notifyEditorResize();
    updateEditorSelectionVisual();
    notifyEditorSelection();
}

function cancelLocationEditorContextAction() {
    if (!window.isGM || !window.locationEditMode) return false;
    if (window.locationEditorTool === 'assets' && selectedLocationAsset) {
        if (window.cancelLocationAssetPlacement) window.cancelLocationAssetPlacement();
        else clearLocationAssetPreset();
        return true;
    }
    if (window.locationEditorTool === 'select' && editorSelections.length) {
        clearEditorSelection();
        updateBuildPreview();
        return true;
    }
    return false;
}

function updateEditorSelectionVisual(lightingOverride = null) {
    if (editorSelectionRing) {
        scene?.remove(editorSelectionRing);
        disposeObject(editorSelectionRing);
        editorSelectionRing = null;
    }
    if (!scene || !editorSelections.length) return;
    editorSelectionRing = new THREE.Group();
    for (const selection of editorSelections) {
        const source = selection.kind === 'lamp' && lightingOverride
            ? lightingOverride.local_lights?.[selection.index] : getEditorSource(selection);
        if (!source) continue;
        const x = selection.kind === 'structure' ? Number(source.tile_x) + 0.5 + Number(source.properties?.offset_x || 0)
            : selection.kind === 'lamp' ? Number(source.x) : selection.x + 0.5 + Number(source.x || 0);
        const z = selection.kind === 'structure' ? Number(source.tile_y) + 0.5 + Number(source.properties?.offset_z || 0)
            : selection.kind === 'lamp' ? Number(source.z) : selection.z + 0.5 + Number(source.z || 0);
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.38, 0.53, 28),
            new THREE.MeshBasicMaterial({
                color: selection.kind === 'structure' ? (source.properties?.gm_hidden ? 0xffb66e : 0x8be2cb)
                    : source.gm_hidden ? 0xffb66e : 0x8be2cb,
                side: THREE.DoubleSide, depthTest: false,
            }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, getTileHeight(Math.floor(x), Math.floor(z)) + 0.04, z);
        ring.renderOrder = 100;
        ring.raycast = () => {};
        editorSelectionRing.add(ring);
    }
    scene.add(editorSelectionRing);
}

function pickEditorAsset(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = [...locationObjectMeshes, ...objectMeshes, ...(locationLightGroup?.children || [])];
    for (const hit of raycaster.intersectObjects(meshes, true)) {
        let item = hit.object;
        while (item && item !== scene) {
            if (item.userData?.locationObjectId) return { kind: 'structure', id: item.userData.locationObjectId };
            if (Number.isInteger(item.userData?.locationLampIndex)) {
                return { kind: 'lamp', index: item.userData.locationLampIndex };
            }
            if (item.userData?.sourceObject) {
                const x = item.userData.tileX;
                const z = item.userData.tileZ;
                const index = currentLocationData.tiles_data[z][x].objects.indexOf(item.userData.sourceObject);
                if (index >= 0) return { kind: 'decor', x, z, index };
            }
            item = item.parent;
        }
    }
    return null;
}

function sameEditorSelection(a, b) {
    return Boolean(a && b && a.kind === b.kind) && (a.kind === 'structure' ? a.id === b.id
        : a.kind === 'lamp' ? a.index === b.index
            : a.x === b.x && a.z === b.z && a.index === b.index);
}

function selectEditorAsset(clientX, clientY, additive = false) {
    if (editorSelection?.kind === 'lamp') applyLocationLighting();
    const picked = pickEditorAsset(clientX, clientY);
    if (additive && picked) {
        const index = editorSelections.findIndex(item => sameEditorSelection(item, picked));
        if (index >= 0) editorSelections.splice(index, 1);
        else editorSelections.push(picked);
    } else if (!additive) {
        editorSelections = picked ? [picked] : [];
    }
    editorSelection = editorSelections.at(-1) || null;
    editorMoveMode = false;
    editorMovePreviewPoint = null;
    editorRotateMode = false;
    editorGroupRotatePivot = null;
    editorGroupRotateStartBearing = null;
    editorGroupRotateWithPivot = false;
    editorResizeMode = false;
    editorResizeDimensions = null;
    editorResizeBaseDimensions = null;
    editorResizeAnchor = null;
    notifyEditorResize();
    updateEditorSelectionVisual();
    notifyEditorSelection();
    return Boolean(picked);
}

async function persistLocationLights(lights) {
    if (lampEditPending || !currentLocationData || !window.currentLobbyId || !currentLocationId) return false;
    lampEditPending = true;
    const lighting = {
        ...DEFAULT_LOCATION_LIGHTING,
        ...(currentLocationData.lighting || {}),
        local_lights: lights,
    };
    try {
        await Server.updateLocation(window.currentLobbyId, currentLocationId, { lighting });
        applyLocationLighting(lighting);
        notifyEditorSelection();
        return true;
    } catch (error) {
        showNotification(error.message || 'Не удалось сохранить светильник', 'system');
        return false;
    } finally {
        lampEditPending = false;
    }
}

function sendDecorTileUpdates(positions) {
    const lightChanged = positions.some(({ x, z }) =>
        currentLocationData.tiles_data[z][x].objects?.some(obj => ['campfire', 'anomaly'].includes(obj.type))
        || objectMeshes.some(mesh => mesh.userData?.tileX === x && mesh.userData?.tileZ === z
            && ['campfire', 'anomaly'].includes(mesh.userData?.objType)));
    const updates = positions.map(({ x, z }) => ({
        x, z, objects: currentLocationData.tiles_data[z][x].objects,
    }));
    window.socket?.emit('update_location_tiles', {
        token: localStorage.getItem('access_token'),
        location_id: currentLocationId,
        updates,
    });
    positions.forEach(({ x, z }) => rebuildTileObjects(x, z));
    if (lightChanged) applyLocationLighting();
    applyFogOfWar();
    updateEditorSelectionVisual();
    notifyEditorSelection();
}

export function setLocationAssetPreset(assetId) {
    selectedLocationAsset = typeof assetId === 'object' ? assetId : findLocationAsset(assetId);
    if (!selectedLocationAsset) return;
    if (selectedLocationAsset.kind === 'structure') {
        structurePreset = selectedLocationAsset.id;
        const dimensions = assetDimensions(selectedLocationAsset, 'structure', selectedLocationAsset.id);
        structureWidth = dimensions.width;
        structureDepth = dimensions.depth;
        structureHeight = dimensions.height;
        structureColor = selectedLocationAsset.color;
        structureRotation = 0;
        buildMode = 'structure';
    } else if (selectedLocationAsset.kind === 'decor') {
        brushObjectType = selectedLocationAsset.id;
        brushObjectColor = selectedLocationAsset.color;
        setLocationBrushObjectOffsetX(selectedLocationAsset.offsetX || 0);
        setLocationBrushObjectOffsetZ(selectedLocationAsset.offsetZ || 0);
        setLocationBrushObjectScale(1);
        setLocationBrushObjectRotation(-Number(selectedLocationAsset.rotation || 0));
        brushObjectMode = true;
        buildMode = 'terrain';
    } else {
        buildMode = 'light';
    }
    updateBuildPreview();
}

export function setLocationAssetElevation(value) {
    if (!selectedLocationAsset) return;
    if (selectedLocationAsset.kind === 'lamp') selectedLocationAsset.height = clampAssetElevation(value);
    else selectedLocationAsset.elevation = clampAssetElevation(value);
    updateBuildPreview();
}

export function setLocationAssetDimensions(dimensions) {
    if (!selectedLocationAsset || !validAssetDimensions(dimensions)) return false;
    selectedLocationAsset.dimensions = [dimensions.width, dimensions.depth, dimensions.height];
    if (selectedLocationAsset.kind === 'structure') {
        structureWidth = dimensions.width;
        structureDepth = dimensions.depth;
        structureHeight = dimensions.height;
    }
    updateBuildPreview();
    return true;
}

export function clearLocationAssetPreset() {
    selectedLocationAsset = null;
    buildMode = 'terrain';
    brushObjectMode = false;
    clearBuildPreview();
}

export function beginMoveSelectedLocationAsset() {
    if (!getSelectedEditorSource()) {
        showNotification('Сначала выберите объект инструментом «Выбор»', 'system');
        return false;
    }
    cancelLocationAssetResize();
    window.selectLocationEditorTool?.('select');
    editorMoveMode = true;
    editorMovePreviewPoint = null;
    editorRotateMode = false;
    editorGroupRotatePivot = null;
    editorGroupRotateStartBearing = null;
    editorGroupRotateWithPivot = false;
    showNotification('Наведите на точку и кликните. Объект можно перемещать внутри клетки; Esc отменит.', 'system');
    updateBuildPreview();
    return true;
}

export function beginRotateSelectedLocationAsset() {
    const selection = getSelectedLocationEditorAsset();
    if (!selection) {
        showNotification('Сначала выберите объект инструментом «Выбор»', 'system');
        return false;
    }
    if (editorSelections.length === 1 && selection.kind === 'lamp' && selection.lightKind !== 'spot') {
        showNotification('Всенаправленной лампе поворот не нужен', 'system');
        return false;
    }
    cancelLocationAssetResize();
    window.selectLocationEditorTool?.('select');
    editorMoveMode = false;
    editorMovePreviewPoint = null;
    editorRotateMode = true;
    editorGroupRotatePivot = editorSelections.length > 1 ? getEditorGroupPivot() : null;
    editorGroupRotateStartBearing = null;
    editorGroupRotateWithPivot = false;
    editorRotateAngle = editorGroupRotatePivot ? 0 : Number(selection.rotation || 0);
    showNotification(editorGroupRotatePivot
        ? 'Двигайте курсор вокруг центра группы: предметы поворачиваются на месте. Ctrl: вращать вокруг центра. Shift: шаг 15°. Esc: отмена.'
        : 'Двигайте курсор вокруг объекта и кликните для выбора угла. Shift: шаг 15°. Esc: отмена.', 'system');
    updateBuildPreview();
    return true;
}

export function beginResizeSelectedLocationAsset() {
    if (editorSelections.length > 1) {
        showNotification('Для изменения размера группы используйте + или −', 'system');
        return false;
    }
    const selection = getSelectedLocationEditorAsset();
    if (!selection) return false;
    if (editorResizeMode) return true;
    if (!selection.resizable) {
        showNotification('Размер этого объекта определяется его правилами', 'system');
        return false;
    }
    window.selectLocationEditorTool?.('select');
    editorMoveMode = false;
    editorMovePreviewPoint = null;
    editorRotateMode = false;
    editorResizeMode = true;
    editorResizeAxis = 'all';
    editorResizeDimensions = { ...selection.dimensions };
    editorResizeBaseDimensions = { ...selection.dimensions };
    editorResizeAnchor = null;
    showNotification('Размер: сейчас меняются все три оси. Для отдельной оси выберите X, Z или Y в панели. Клик сохранит, Esc отменит.', 'system');
    notifyEditorResize();
    updateBuildPreview();
    return true;
}

export function setLocationAssetResizeAxis(axis) {
    if (!editorResizeMode || !['all', 'width', 'depth', 'height'].includes(axis)) return false;
    editorResizeAxis = axis;
    editorResizeBaseDimensions = { ...editorResizeDimensions };
    editorResizeAnchor = null;
    notifyEditorResize();
    updateBuildPreview();
    return true;
}

export async function deleteSelectedLocationAsset() {
    if (editorSelections.length > 1) {
        const selections = [...editorSelections];
        const structures = selections.filter(item => item.kind === 'structure');
        const lamps = selections.filter(item => item.kind === 'lamp');
        const decor = selections.filter(item => item.kind === 'decor');
        const changedTiles = new Map();
        const failed = [];
        if (lamps.length) {
            const indices = new Set(lamps.map(item => item.index));
            if (!await persistLocationLights(currentLocationData.lighting.local_lights.filter((_, index) => !indices.has(index)))) return;
        }
        for (const selection of structures) {
            const source = getEditorSource(selection);
            if (!source) continue;
            try {
                await Server.deleteLocationObject(window.currentLobbyId, source.id);
                removeLocationObject(source.id);
            } catch (error) {
                showNotification(error.message || 'Не удалось удалить объект', 'system');
                failed.push(selection);
            }
        }
        decor.sort((a, b) => a.z - b.z || a.x - b.x || b.index - a.index);
        for (const selection of decor) {
            const tile = currentLocationData.tiles_data[selection.z]?.[selection.x];
            if (!tile?.objects?.[selection.index]) continue;
            tile.objects.splice(selection.index, 1);
            changedTiles.set(`${selection.x}:${selection.z}`, { x: selection.x, z: selection.z });
        }
        if (changedTiles.size) sendDecorTileUpdates([...changedTiles.values()]);
        if (failed.length) {
            editorSelections = failed;
            editorSelection = failed.at(-1);
            updateEditorSelectionVisual();
            notifyEditorSelection();
        } else clearEditorSelection();
        return;
    }
    const source = getSelectedEditorSource();
    if (!source) return;
    if (editorSelection.kind === 'lamp') {
        const lights = [...currentLocationData.lighting.local_lights];
        lights.splice(editorSelection.index, 1);
        if (!await persistLocationLights(lights)) return;
    } else if (editorSelection.kind === 'structure') {
        try {
            await Server.deleteLocationObject(window.currentLobbyId, source.id);
            removeLocationObject(source.id);
        } catch (error) {
            showNotification(error.message || 'Не удалось удалить объект', 'system');
            return;
        }
    } else {
        currentLocationData.tiles_data[editorSelection.z][editorSelection.x].objects.splice(editorSelection.index, 1);
        sendDecorTileUpdates([{ x: editorSelection.x, z: editorSelection.z }]);
    }
    clearEditorSelection();
}

export async function toggleSelectedLocationFire() {
    if (!window.isGM || editorSelections.length !== 1 || editorSelection?.kind !== 'structure') return false;
    const source = getSelectedEditorSource();
    if (!isObjectLightSource(source)) return false;
    try {
        const electric = isElectricFixture(source);
        const property = electric ? 'is_on' : 'is_lit';
        const updated = await Server.updateLocationObject(window.currentLobbyId, source.id, {
            properties: { [property]: electric ? source.properties?.is_on === false : source.properties?.is_lit !== true },
        });
        updateLocationObject(updated);
        return true;
    } catch (error) {
        showNotification(error.message || 'Не удалось изменить огонь', 'system');
        return false;
    }
}

export async function toggleSelectedLocationAssetsHidden() {
    if (!editorSelections.length) return false;
    const selections = [...editorSelections];
    const isHidden = selection => {
        const source = getEditorSource(selection);
        return Boolean(selection.kind === 'structure' ? source?.properties?.gm_hidden : source?.gm_hidden);
    };
    const hidden = !selections.every(isHidden);
    const changedTiles = new Map();
    const lights = [...(currentLocationData.lighting?.local_lights || [])];
    let lightsChanged = false;
    for (const selection of selections) {
        const source = getEditorSource(selection);
        if (!source) continue;
        if (selection.kind === 'structure') {
            try {
                const updated = await Server.updateLocationObject(window.currentLobbyId, source.id, {
                    properties: { gm_hidden: hidden },
                });
                updateLocationObject(updated);
            } catch (error) { showNotification(error.message || 'Не удалось скрыть объект', 'system'); }
        } else if (selection.kind === 'lamp') {
            lights[selection.index] = { ...source, gm_hidden: hidden };
            lightsChanged = true;
        } else {
            source.gm_hidden = hidden;
            changedTiles.set(`${selection.x}:${selection.z}`, { x: selection.x, z: selection.z });
        }
    }
    if (lightsChanged) await persistLocationLights(lights);
    if (changedTiles.size) sendDecorTileUpdates([...changedTiles.values()]);
    applyFogOfWar();
    notifyEditorSelection();
    return true;
}

async function updateSelectedLocationAssetGroup(transform) {
    if (!editorSelections.length) return false;
    const selections = [...editorSelections];
    const sources = selections.map(getEditorSource);
    const originals = selections.map(selection => {
        editorSelection = selection;
        return getSelectedLocationEditorAsset();
    });
    const updates = originals.map((asset, index) => transform(asset, index));
    if (updates.some(update => !update)) {
        editorSelection = selections.at(-1);
        showNotification('Один из объектов нельзя изменить или он выйдет за границы карты', 'system');
        return false;
    }
    const remaining = [];
    let allSaved = true;
    for (let index = 0; index < selections.length; index++) {
        const selection = selections[index];
        if (selection.kind === 'decor') {
            const source = sources[index];
            let located = null;
            for (let z = 0; z < currentLocationData.grid_height && !located; z++) {
                for (let x = 0; x < currentLocationData.grid_width; x++) {
                    const objectIndex = currentLocationData.tiles_data[z][x].objects?.indexOf(source) ?? -1;
                    if (objectIndex >= 0) {
                        located = { kind: 'decor', x, z, index: objectIndex };
                        break;
                    }
                }
            }
            editorSelection = located || selection;
        } else editorSelection = selection;
        const details = { ...originals[index], ...updates[index] };
        if (!Object.hasOwn(updates[index], 'dimensions')) delete details.dimensions;
        const saved = await updateSelectedLocationAssetDetails(details);
        allSaved = Boolean(saved) && allSaved;
        remaining.push(editorSelection);
    }
    editorSelections = remaining;
    editorSelection = remaining.at(-1) || null;
    updateEditorSelectionVisual();
    notifyEditorSelection();
    return allSaved;
}

export async function scaleSelectedLocationAssets(grow) {
    return updateSelectedLocationAssetGroup(asset => {
        if (!asset?.resizable) return null;
        const dimensions = resizedUniformDimensions(asset.dimensions, grow ? 1.1 : 1 / 1.1);
        return validAssetDimensions(dimensions) ? { dimensions } : null;
    });
}

export async function updateSelectedLocationAssetDetails({ x, z, height, elevation, intensity, distance, color, rotation, dimensions }) {
    const source = getSelectedEditorSource();
    if (!source || !currentLocationData) return false;
    if (!Number.isFinite(x) || !Number.isFinite(z)
        || x < 0 || z < 0 || x >= currentLocationData.grid_width || z >= currentLocationData.grid_height) {
        showNotification('Координаты вне подлокации', 'system');
        return false;
    }
    if (elevation !== undefined && (!Number.isFinite(elevation) || elevation < 0 || elevation > 10)) {
        showNotification('Высота должна быть от 0 до 10 м', 'system');
        return false;
    }
    if (dimensions !== undefined && !validAssetDimensions(dimensions)) {
        showNotification('Некорректные размеры объекта', 'system');
        return false;
    }
    if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(color)) return false;
    if (editorSelection.kind === 'lamp') {
        const lights = [...currentLocationData.lighting.local_lights];
        const azimuth = ((Number(rotation) + 180) % 360 + 360) % 360 - 180;
        lights[editorSelection.index] = {
            ...source, x, z, height, intensity, distance, color, azimuth,
            ...(dimensions ? { dimensions } : {}),
        };
        return persistLocationLights(lights);
    }
    if (editorSelection.kind === 'structure') {
        try {
            const object = await Server.updateLocationObject(window.currentLobbyId, source.id, {
                tile_x: Math.floor(x), tile_y: Math.floor(z),
                properties: {
                    offset_x: x - Math.floor(x) - 0.5,
                    offset_z: z - Math.floor(z) - 0.5,
                    rotation: bearingToObjectRotation(rotation),
                    elevation: elevation ?? clampAssetElevation(source.properties?.elevation),
                    ...(color !== undefined ? { color } : {}),
                    ...(dimensions ? { dimensions } : {}),
                },
            });
            updateLocationObject(object);
            notifyEditorSelection();
            return true;
        } catch (error) { showNotification(error.message || 'Не удалось сохранить объект', 'system'); }
        return false;
    }
    const old = { x: editorSelection.x, z: editorSelection.z };
    const next = { x: Math.floor(x), z: Math.floor(z) };
    currentLocationData.tiles_data[old.z][old.x].objects.splice(editorSelection.index, 1);
    source.rotation = -Number(rotation);
    source.elevation = elevation ?? clampAssetElevation(source.elevation);
    if (color !== undefined) source.color = color;
    if (dimensions) {
        source.dimensions = dimensions;
        source.scale = 1;
    }
    source.x = x - next.x - 0.5;
    source.z = z - next.z - 0.5;
    const objects = currentLocationData.tiles_data[next.z][next.x].objects;
    objects.push(source);
    editorSelection = { kind: 'decor', ...next, index: objects.length - 1 };
    if (editorSelections.length === 1) editorSelections = [editorSelection];
    sendDecorTileUpdates(old.x === next.x && old.z === next.z ? [old] : [old, next]);
    return true;
}

export function previewSelectedLocationLamp(details) {
    if (editorSelection?.kind !== 'lamp' || !currentLocationData?.lighting) return;
    if (!Number.isFinite(details.x) || !Number.isFinite(details.z)
        || details.x < 0 || details.z < 0
        || details.x >= currentLocationData.grid_width || details.z >= currentLocationData.grid_height
        || !Number.isFinite(details.height) || details.height < 0 || details.height > 10
        || !Number.isFinite(details.intensity) || details.intensity < 0 || details.intensity > 10
        || !Number.isFinite(details.distance) || details.distance < 1 || details.distance > 30) return;
    const source = getSelectedEditorSource();
    if (!source) return;
    const lights = [...(currentLocationData.lighting.local_lights || [])];
    lights[editorSelection.index] = { ...source, ...details, azimuth: Number(details.rotation ?? source.azimuth ?? 0) };
    applyLocationLighting({ ...currentLocationData.lighting, local_lights: lights }, false);
}

function updateEditorRotatePreview(clientX, clientY, snap = false, aroundGroup = false) {
    if (!editorRotateMode || !editorSelection) return;
    if (editorGroupRotatePivot) {
        const modeChanged = editorGroupRotateWithPivot !== aroundGroup;
        editorGroupRotateWithPivot = aroundGroup;
        const pivot = editorGroupRotatePivot;
        const point = getPointerWorldPoint(clientX, clientY,
            getTileHeight(Math.floor(pivot.x), Math.floor(pivot.z)));
        if (!point || Math.hypot(point.x - pivot.x, point.z - pivot.z) < 0.25) {
            if (modeChanged) updateBuildPreview();
            return;
        }
        const bearing = bearingFromDelta(point.x - pivot.x, point.z - pivot.z);
        if (editorGroupRotateStartBearing === null) {
            editorGroupRotateStartBearing = bearing;
            if (modeChanged) updateBuildPreview();
            return;
        }
        let delta = ((bearing - editorGroupRotateStartBearing + 540) % 360) - 180;
        if (snap) delta = Math.round(delta / 15) * 15;
        if (delta === editorRotateAngle && !modeChanged) return;
        editorRotateAngle = delta;
        updateBuildPreview();
        return;
    }
    const selection = getSelectedLocationEditorAsset();
    if (!selection) return;
    const centerX = selection.x;
    const centerZ = selection.z;
    const point = getPointerWorldPoint(clientX, clientY, getTileHeight(Math.floor(centerX), Math.floor(centerZ)));
    if (!point || Math.hypot(point.x - centerX, point.z - centerZ) < 0.25) return;
    const nextAngle = bearingFromDelta(point.x - centerX, point.z - centerZ, snap);
    if (nextAngle === editorRotateAngle) return;
    editorRotateAngle = nextAngle;
    if (selection.kind === 'lamp') {
        previewSelectedLocationLamp({
            x: selection.x, z: selection.z, height: selection.height,
            intensity: selection.intensity, distance: selection.distance,
            color: selection.color, rotation: editorRotateAngle,
        });
    } else {
        updateBuildPreview();
    }
}

function updateEditorResizePreview(clientX, clientY) {
    if (!editorResizeMode || !editorResizeDimensions || !editorResizeBaseDimensions) return;
    const selection = getSelectedLocationEditorAsset();
    if (!selection) return;
    const centerX = selection.x;
    const centerZ = selection.z;
    let coordinate;
    if (editorResizeAxis === 'all') {
        coordinate = clientX;
    } else if (editorResizeAxis === 'height') {
        coordinate = -clientY * 0.02;
    } else {
        const point = getPointerWorldPoint(clientX, clientY, getTileHeight(Math.floor(centerX), Math.floor(centerZ)));
        if (!point) return;
        const rotation = selection.kind === 'lamp' ? 0 : bearingToObjectRotation(selection.rotation);
        const dx = point.x - centerX;
        const dz = point.z - centerZ;
        const localX = Math.cos(rotation) * dx - Math.sin(rotation) * dz;
        const localZ = Math.sin(rotation) * dx + Math.cos(rotation) * dz;
        coordinate = editorResizeAxis === 'width'
            ? (selection.kind === 'decor' && getSelectedEditorSource()?.type === 'poster' ? localZ : localX)
            : (selection.kind === 'decor' && getSelectedEditorSource()?.type === 'poster' ? localX : localZ);
    }
    if (!editorResizeAnchor) {
        editorResizeAnchor = { coordinate, sign: editorResizeAxis === 'height' ? 1 : Math.sign(coordinate) || 1 };
        return;
    }
    if (editorResizeAxis === 'all') {
        const next = resizedUniformDimensions(
            editorResizeBaseDimensions, 1 + (coordinate - editorResizeAnchor.coordinate) * 0.01,
        );
        if (Object.keys(next).every(axis => next[axis] === editorResizeDimensions[axis])) return;
        editorResizeDimensions = next;
        notifyEditorResize();
        updateBuildPreview();
        return;
    }
    const factor = editorResizeAxis === 'height' ? 1 : 2;
    const min = editorResizeAxis === 'depth' ? 0.02 : 0.05;
    const max = editorResizeAxis === 'height' ? 20 : 30;
    const next = resizedAxis(editorResizeBaseDimensions[editorResizeAxis]
        + (coordinate - editorResizeAnchor.coordinate) * editorResizeAnchor.sign * factor, min, max);
    if (next === editorResizeDimensions[editorResizeAxis]) return;
    editorResizeDimensions[editorResizeAxis] = next;
    notifyEditorResize();
    updateBuildPreview();
}

async function commitEditorAssetResize() {
    const selection = getSelectedLocationEditorAsset();
    if (!selection || !editorResizeDimensions) return;
    const saved = await updateSelectedLocationAssetDetails({
        x: selection.x, z: selection.z,
        height: selection.height, intensity: selection.intensity,
        distance: selection.distance, color: selection.color,
        rotation: selection.rotation, elevation: selection.elevation,
        dimensions: { ...editorResizeDimensions },
    });
    if (saved) cancelLocationAssetResize();
}

async function commitEditorAssetRotation() {
    if (editorGroupRotatePivot) {
        const pivot = editorGroupRotatePivot;
        const delta = editorRotateAngle;
        if (delta === 0) {
            editorRotateMode = false;
            editorGroupRotatePivot = null;
            editorGroupRotateStartBearing = null;
            editorGroupRotateWithPivot = false;
            clearBuildPreview();
            return;
        }
        const saved = await updateSelectedLocationAssetGroup(asset => {
            if (!asset) return null;
            const next = editorGroupRotateWithPivot
                ? rotatePointAround(asset.x, asset.z, pivot.x, pivot.z, delta)
                : { x: asset.x, z: asset.z };
            if (next.x < 0 || next.z < 0 || next.x >= currentLocationData.grid_width
                || next.z >= currentLocationData.grid_height) return null;
            const rotation = asset.kind === 'lamp' && asset.lightKind !== 'spot'
                ? asset.rotation : ((Number(asset.rotation) + delta) % 360 + 360) % 360;
            return { ...next, rotation };
        });
        if (saved) {
            editorRotateMode = false;
            editorGroupRotatePivot = null;
            editorGroupRotateStartBearing = null;
            editorGroupRotateWithPivot = false;
            updateBuildPreview();
        }
        return;
    }
    const selection = getSelectedLocationEditorAsset();
    if (!selection) return;
    const saved = await updateSelectedLocationAssetDetails({
        x: selection.x, z: selection.z,
        height: selection.height, intensity: selection.intensity,
        distance: selection.distance, color: selection.color,
        rotation: editorRotateAngle, elevation: selection.elevation,
    });
    if (saved) {
        editorRotateMode = false;
        updateBuildPreview();
    }
}

async function commitEditorAssetMove(x, z) {
    const current = getSelectedLocationEditorAsset();
    if (!current) return;
    if (editorSelections.length > 1) {
        const dx = x - current.x;
        const dz = z - current.z;
        editorMoveMode = false;
        const saved = await updateSelectedLocationAssetGroup(asset => {
            const nextX = asset.x + dx;
            const nextZ = asset.z + dz;
            return nextX >= 0 && nextZ >= 0 && nextX < currentLocationData.grid_width
                && nextZ < currentLocationData.grid_height ? { x: nextX, z: nextZ } : null;
        });
        if (!saved) editorMoveMode = true;
        else editorMovePreviewPoint = null;
        if (editorSelectionRing) editorSelectionRing.position.set(0, 0, 0);
        updateBuildPreview();
        return;
    }
    const source = getSelectedEditorSource();
    if (await updateSelectedLocationAssetDetails({
        x, z, rotation: current.rotation,
        height: source.height, intensity: source.intensity,
        distance: source.distance, color: source.color, elevation: current.elevation,
    })) {
        editorMoveMode = false;
        editorMovePreviewPoint = null;
    }
    updateBuildPreview();
}

async function placeSelectedLocationAsset(x, z) {
    const asset = selectedLocationAsset;
    if (!asset) return;
    if (asset.kind === 'structure') {
        const object = await placeStructureAtTile(x, z);
        if (object) {
            editorSelection = { kind: 'structure', id: object.id };
            editorSelections = [editorSelection];
            updateEditorSelectionVisual();
            notifyEditorSelection();
        }
        return;
    }
    if (asset.kind === 'decor') {
        processedTilesForObjects.clear();
        applyLocationBrush(x, z, { addObject: true }, 0);
        processedTilesForObjects.clear();
        const objects = currentLocationData.tiles_data[z][x].objects || [];
        if (objects.length) {
            editorSelection = { kind: 'decor', x, z, index: objects.length - 1 };
            editorSelections = [editorSelection];
            updateEditorSelectionVisual();
            notifyEditorSelection();
        }
        return;
    }
    const lights = [...(currentLocationData.lighting?.local_lights || [])];
    lights.push({
        x: x + 0.5, z: z + 0.5, height: asset.height,
        color: asset.color, intensity: asset.intensity, distance: asset.distance,
        kind: asset.lightKind || 'point', azimuth: 0,
        dimensions: assetDimensions(asset, 'lamp', asset.lightKind || 'point'),
    });
    if (await persistLocationLights(lights)) {
        editorSelection = { kind: 'lamp', index: lights.length - 1 };
        editorSelections = [editorSelection];
        updateEditorSelectionVisual();
        notifyEditorSelection();
    }
}

// ========== Загрузка данных локации ==========
export function loadLocation(data) {
    locationProfiler?.stop();
    clearFogOverlay();
    clearFogMemoryGhosts();
    tileCubes = [];
    objectMeshes = [];
    anomalyEffectMeshes = [];
    locationObjectMeshes = [];
    darknessEditorOverlay = null;
    currentLocationData = data;
    selectedLocationAsset = null;
    editorSelection = null;
    editorSelections = [];
    editorResizeMode = false;
    editorResizeDimensions = null;
    editorResizeBaseDimensions = null;
    editorResizeAnchor = null;
    editorMoveMode = false;
    editorMovePreviewPoint = null;
    editorRotateMode = false;
    editorGroupRotatePivot = null;
    editorGroupRotateStartBearing = null;
    editorGroupRotateWithPivot = false;
    editorSelectionRing = null;
    buildPreviewMesh = null;
    buildPreviewKey = null;
    invalidateMovementMapCache();
    if (!scene) return;

    // Очистка старых объектов (кроме света и highlight)
    waterTileMesh = null;
    if (waterSurfaceMesh?.material.map) waterSurfaceMesh.material.map.dispose();
    waterSurfaceMesh = null;
    waterBankMesh = null;
    sandBankMesh = null;
    waterDetailGroup = null;
    waterRegions = classifyWaterRegions(data.tiles_data);
    smoothTerrainMesh = null;
    terrainSurfaceMesh = null;
    terrainSurfaceTexture?.dispose();
    terrainSurfaceTexture = null;
    locationGridMesh = null;
    const toRemove = [];
    scene.children.forEach(child => {
        if (!child.isLight && child !== highlightBox && child !== locationLightGroup
            && child !== locationDirectionalLight?.target) toRemove.push(child);
    });
    toRemove.forEach(child => {
        disposeObject(child);
        scene.remove(child);
    });
    clearUnusedLocationModels();
    grassDetailGroup = null;
    clearAllCharacters();

    const gridWidth = data.grid_width;
    const gridHeight = data.grid_height;
    const centerX = gridWidth / 2;
    const centerZ = gridHeight / 2;
    locationDarknessTexture?.dispose();
    locationDarknessFactors = null;
    locationDarknessTexture = new THREE.DataTexture(
        new Uint8Array(gridWidth * gridHeight * 4).fill(255),
        gridWidth, gridHeight, THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    locationDarknessTexture.magFilter = THREE.LinearFilter;
    locationDarknessTexture.minFilter = THREE.LinearFilter;
    locationDarknessTexture.needsUpdate = true;
    const darknessSize = new THREE.Vector2(gridWidth, gridHeight);

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
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    locationTileMesh = new THREE.InstancedMesh(geometry, material, tileCount);
    locationTileMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(tileCount * 3), 3);
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const waterTopMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    waterTileMesh = new THREE.InstancedMesh(geometry.clone(), [
        waterMaterial, waterMaterial, waterTopMaterial,
        waterMaterial, waterMaterial, waterMaterial,
    ], tileCount);
    waterTileMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(tileCount * 3), 3);
    waterTileMesh.castShadow = false;
    waterTileMesh.receiveShadow = false;
    waterTileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    locationTileMesh.castShadow = false;
    locationTileMesh.receiveShadow = true;
    locationTileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    locationTileMesh.userData.tileByInstance = [];
    for (let y = 0; y < gridHeight; y++) {
        for (let x = 0; x < gridWidth; x++) {
            const tile = data.tiles_data[y][x];
            updateTileInstance(y * gridWidth + x, x, y, tile);
        }
    }
    locationTileMesh.instanceMatrix.needsUpdate = true;
    locationTileMesh.instanceColor.needsUpdate = true;
    waterTileMesh.instanceMatrix.needsUpdate = true;
    waterTileMesh.instanceColor.needsUpdate = true;
    tileCubes = [locationTileMesh, waterTileMesh];
    scene.add(locationTileMesh, waterTileMesh);
    rebuildSmoothTerrainMesh();
    rebuildLocationTerrainSurface();
    rebuildWaterSurfaceMesh();
    rebuildLocationGrid();
    rebuildGrassDetailMesh();

    // Объекты на тайлах
    for (let y = 0; y < data.tiles_data.length; y++) {
        for (let x = 0; x < data.tiles_data[y].length; x++) {
            if (data.tiles_data[y][x].objects?.length) rebuildTileObjects(x, y);
        }
    }

    // Отдельные объекты
    if (data.objects && data.objects.length) {
        data.objects.forEach(object => addLocationObjectMesh(object, false));
    }
    rebuildLocationRoofs();
    applyLocationLighting();
    applyFogOfWar();

    // Камера
    const distance = Math.max(gridWidth, gridHeight) * 0.8;
    camera.position.set(centerX, distance * 0.6, centerZ + distance);
    controls.target.set(centerX, 0, centerZ);
    controls.update();

    if (highlightBox && !scene.children.includes(highlightBox)) scene.add(highlightBox);
}

// ========== Обновление тайлов ==========
function updateTileCube(x, z, tile, rebuildTerrain = true) {
    if (!locationTileMesh || !currentLocationData) return false;
    const neighbors = [];
    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) neighbors.push([x + dx, z + dz]);
    }
    for (const [nx, nz] of neighbors) {
        const next = currentLocationData.tiles_data[nz]?.[nx];
        if (next) updateTileInstance(nz * currentLocationData.grid_width + nx, nx, nz, next);
    }
    locationTileMesh.instanceMatrix.needsUpdate = true;
    locationTileMesh.instanceColor.needsUpdate = true;
    waterTileMesh.instanceMatrix.needsUpdate = true;
    waterTileMesh.instanceColor.needsUpdate = true;
    const needsRebuild = Boolean(smoothTerrainMesh) || neighbors.some(([nx, nz]) =>
        isSmoothTerrainTile(currentLocationData.tiles_data, nx, nz));
    if (rebuildTerrain && needsRebuild) rebuildSmoothTerrainMesh();
    return needsRebuild;
}

function updateSmoothTerrainColors(changedTiles = null) {
    if (!smoothTerrainMesh || !currentLocationData) return;
    const colors = smoothTerrainMesh.geometry.getAttribute('color');
    smoothTerrainMesh.userData.tileByVertex.forEach(({ x, z }, index) => {
        if (changedTiles && !changedTiles.has(z * currentLocationData.grid_width + x)) return;
        const terrain = currentLocationData.tiles_data[z][x].terrain;
        const color = new THREE.Color(terrainColors[terrain] || 0x3a5f0b)
            .multiplyScalar(darknessFactorAt(x, z));
        colors.setXYZ(index, color.r, color.g, color.b);
    });
    colors.needsUpdate = true;
}

function updateLocationGridColors(changedTiles = null) {
    if (!locationGridMesh || !currentLocationData) return;
    const colors = locationGridMesh.geometry.getAttribute('color');
    locationGridMesh.userData.tileByVertex.forEach(({ x, z, floor }, index) => {
        if (changedTiles && !changedTiles.has(z * currentLocationData.grid_width + x)) return;
        const terrain = floor ? null : currentLocationData.tiles_data[z][x].terrain;
        const color = floor ? floorGridColor : terrainGridColors[terrain] || terrainGridColors.grass;
        const shade = darknessFactorAt(x, z);
        colors.setXYZ(index, color.r * shade, color.g * shade, color.b * shade);
    });
    colors.needsUpdate = true;
}

function rebuildLocationGrid() {
    if (locationGridMesh) {
        scene.remove(locationGridMesh);
        disposeObject(locationGridMesh);
        locationGridMesh = null;
    }
    if (!scene || !currentLocationData || !locationGridVisible) return;
    const objects = currentLocationData.objects || [];
    const floors = objects.filter(object => object.type === 'floor').map(object => ({
        ...floorVisualPose(object, objects),
        top: getTileHeight(object.tile_x, object.tile_y)
            + clampAssetElevation(object.properties?.elevation) + 0.005,
    }));
    const uncovered = (x, z) => !floors.some(floor => {
        const dx = x + 0.5 - floor.x;
        const dz = z + 0.5 - floor.z;
        const along = dx * floor.axis.x + dz * floor.axis.z;
        const across = dx * floor.normal.x + dz * floor.normal.z;
        return Math.abs(along) < floor.width / 2 && Math.abs(across) < floor.depth / 2;
    });
    const data = buildTerrainGridData(currentLocationData.tiles_data, uncovered);
    const floorData = buildFloorGridData(floors);
    const positions = data.positions.concat(floorData.positions);
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
    locationGridMesh = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false,
    }));
    locationGridMesh.raycast = () => {};
    locationGridMesh.userData.tileByVertex = data.tileByVertex.concat(floorData.tileByVertex);
    updateLocationGridColors();
    scene.add(locationGridMesh);
}

function rebuildSmoothTerrainMesh() {
    if (smoothTerrainMesh) {
        scene.remove(smoothTerrainMesh);
        disposeObject(smoothTerrainMesh);
        smoothTerrainMesh = null;
    }
    const data = buildSmoothTerrainData(currentLocationData.tiles_data);
    tileCubes = [locationTileMesh, waterTileMesh];
    if (!data.positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(data.positions.length), 3));
    const terrainTileCoords = new Float32Array(data.tileByVertex.length * 2);
    data.tileByVertex.forEach(({ x, z }, index) => {
        terrainTileCoords[index * 2] = x;
        terrainTileCoords[index * 2 + 1] = z;
    });
    geometry.setAttribute('terrainTileCoord', new THREE.Float32BufferAttribute(terrainTileCoords, 2));
    geometry.setAttribute('terrainTop', new THREE.Float32BufferAttribute(data.topByVertex, 1));
    const terrainUvs = new Float32Array(data.positions.length / 3 * 2);
    for (let index = 0; index < data.positions.length / 3; index++) {
        terrainUvs[index * 2] = data.positions[index * 3] * 0.125;
        terrainUvs[index * 2 + 1] = data.positions[index * 3 + 2] * 0.125;
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(terrainUvs, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide,
    });
    smoothTerrainMesh = new THREE.Mesh(geometry, material);
    smoothTerrainMesh.userData.tileByFace = data.tileByFace;
    smoothTerrainMesh.userData.tileByVertex = data.tileByVertex;
    smoothTerrainMesh.receiveShadow = true;
    updateSmoothTerrainColors();
    scene.add(smoothTerrainMesh);
    tileCubes.push(smoothTerrainMesh);
}

function updateLocationTerrainSurfaceTexture(changedTiles) {
    if (!terrainSurfaceTexture || !currentLocationData || !changedTiles.length) return;
    updateLocationTerrainPixels(currentLocationData.tiles_data, terrainSurfaceTexture.image, changedTiles);
    terrainSurfaceTexture.needsUpdate = true;
}

function rebuildLocationTerrainSurface(preserveTexture = false) {
    if (terrainSurfaceMesh) {
        scene.remove(terrainSurfaceMesh);
        disposeObject(terrainSurfaceMesh);
        terrainSurfaceMesh = null;
    }
    if (!preserveTexture) {
        terrainSurfaceTexture?.dispose();
        terrainSurfaceTexture = null;
    }
    if (!scene || !currentLocationData) return;
    const tiles = currentLocationData.tiles_data;
    const width = currentLocationData.grid_width;
    const height = currentLocationData.grid_height;
    if (!terrainSurfaceTexture) {
        const image = createLocationTerrainPixels(tiles);
        terrainSurfaceTexture = new THREE.DataTexture(image.data, image.width, image.height,
            THREE.RGBAFormat, THREE.UnsignedByteType);
        terrainSurfaceTexture.magFilter = THREE.LinearFilter;
        terrainSurfaceTexture.minFilter = THREE.LinearFilter;
        terrainSurfaceTexture.generateMipmaps = false;
        terrainSurfaceTexture.encoding = THREE.sRGBEncoding;
        terrainSurfaceTexture.needsUpdate = true;
    }

    const sampleHeight = createTerrainSurfaceHeightSampler(tiles);
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const subdivisions = 4;
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            if (tiles[z][x].terrain === 'water' || isSmoothTerrainTile(tiles, x, z)) continue;
            const first = positions.length / 3;
            const landHeightAt = (px, pz) => sampleHeight(
                Math.max(x + 0.00001, Math.min(x + 0.99999, px)),
                Math.max(z + 0.00001, Math.min(z + 0.99999, pz)),
            );
            for (let row = 0; row <= subdivisions; row++) {
                for (let column = 0; column <= subdivisions; column++) {
                    const px = x + column / subdivisions;
                    const pz = z + row / subdivisions;
                    const py = landHeightAt(px, pz);
                    positions.push(px, py + 0.002, pz);
                    uvs.push(px / width, pz / height);
                    const left = landHeightAt(px - 0.04, pz);
                    const right = landHeightAt(px + 0.04, pz);
                    const near = landHeightAt(px, pz - 0.04);
                    const far = landHeightAt(px, pz + 0.04);
                    const normal = new THREE.Vector3(left - right, 0.08, near - far).normalize();
                    normals.push(normal.x, normal.y, normal.z);
                }
            }
            for (let row = 0; row < subdivisions; row++) {
                for (let column = 0; column < subdivisions; column++) {
                    const a = first + row * (subdivisions + 1) + column;
                    const b = a + 1;
                    const d = a + subdivisions + 1;
                    const c = d + 1;
                    indices.push(a, d, b, b, d, c);
                }
            }
        }
    }
    if (smoothTerrainMesh) {
        const smoothGeometry = smoothTerrainMesh.geometry;
        const sourcePositions = smoothGeometry.getAttribute('position');
        const sourceNormals = smoothGeometry.getAttribute('normal');
        const topFlags = smoothGeometry.getAttribute('terrainTop');
        for (let face = 0; face < smoothTerrainMesh.userData.tileByFace.length; face++) {
            if (topFlags.getX(face * 3) < 0.5) continue;
            const { x, z } = smoothTerrainMesh.userData.tileByFace[face];
            const first = positions.length / 3;
            for (let corner = 0; corner < 3; corner++) {
                const source = face * 3 + corner;
                const px = sourcePositions.getX(source);
                const pz = sourcePositions.getZ(source);
                positions.push(px, sourcePositions.getY(source) + 0.002, pz);
                normals.push(sourceNormals.getX(source), sourceNormals.getY(source), sourceNormals.getZ(source));
                uvs.push(px / width, pz / height);
            }
            indices.push(first, first + 1, first + 2);
        }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({
        map: terrainSurfaceTexture, side: THREE.DoubleSide, roughness: 0.97,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    applySurfaceDarkness(material, locationDarknessTexture, new THREE.Vector2(width, height));
    terrainSurfaceMesh = new THREE.Mesh(geometry, material);
    terrainSurfaceMesh.raycast = () => {};
    terrainSurfaceMesh.receiveShadow = true;
    scene.add(terrainSurfaceMesh);
}

function rebuildWaterSurfaceMesh() {
    if (waterSurfaceMesh) {
        scene.remove(waterSurfaceMesh);
        waterSurfaceMesh.material.map?.dispose();
        disposeObject(waterSurfaceMesh);
        waterSurfaceMesh = null;
    }
    if (waterBankMesh) {
        scene.remove(waterBankMesh);
        disposeObject(waterBankMesh);
        waterBankMesh = null;
    }
    if (sandBankMesh) {
        scene.remove(sandBankMesh);
        disposeObject(sandBankMesh);
        sandBankMesh = null;
    }
    if (waterDetailGroup) {
        scene.remove(waterDetailGroup);
        disposeObject(waterDetailGroup);
        waterDetailGroup = null;
    }
    if (!scene || !currentLocationData) return;
    const data = buildRoundedWaterData(currentLocationData.tiles_data);
    const previousRegions = waterRegions;
    waterRegions = data.regions;
    if (waterTileMesh) {
        let changed = false;
        for (const [key, kind] of waterRegions) {
            if (previousRegions.get(key) === kind) continue;
            const [x, z] = key.split(',').map(Number);
            updateTileInstance(z * currentLocationData.grid_width + x, x, z,
                currentLocationData.tiles_data[z][x]);
            changed = true;
        }
        if (changed) {
            waterTileMesh.instanceMatrix.needsUpdate = true;
            waterTileMesh.instanceColor.needsUpdate = true;
        }
    }
    if (!data.water.length) return;
    const waterGeometry = new THREE.BufferGeometry();
    waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.water, 3));
    waterGeometry.setAttribute('color', new THREE.Float32BufferAttribute(data.waterColors, 3));
    waterGeometry.computeVertexNormals();
    const waterMaterial = createWaterMaterial();
    waterMaterial.vertexColors = true;
    applySurfaceDarkness(waterMaterial, locationDarknessTexture,
        new THREE.Vector2(currentLocationData.grid_width, currentLocationData.grid_height));
    waterSurfaceMesh = new THREE.Mesh(waterGeometry, waterMaterial);
    waterSurfaceMesh.raycast = () => {};
    waterSurfaceMesh.castShadow = false;
    waterSurfaceMesh.receiveShadow = false;
    scene.add(waterSurfaceMesh);
    if (data.bank.length) {
        const bankGeometry = new THREE.BufferGeometry();
        bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.bank, 3));
        bankGeometry.setAttribute('color', new THREE.Float32BufferAttribute(data.bankColors, 3));
        bankGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.bankUvs, 2));
        bankGeometry.computeVertexNormals();
        const bankMaterial = new THREE.MeshStandardMaterial({
            map: terrainSurfaceTexture, vertexColors: true, side: THREE.DoubleSide, roughness: 0.97,
        });
        applySurfaceDarkness(bankMaterial, locationDarknessTexture,
            new THREE.Vector2(currentLocationData.grid_width, currentLocationData.grid_height));
        waterBankMesh = new THREE.Mesh(bankGeometry, bankMaterial);
        waterBankMesh.raycast = () => {};
        waterBankMesh.receiveShadow = true;
        scene.add(waterBankMesh);
    }
    if (data.sandBank.length) {
        const bankGeometry = new THREE.BufferGeometry();
        bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(data.sandBank, 3));
        bankGeometry.setAttribute('color', new THREE.Float32BufferAttribute(data.sandBankColors, 3));
        bankGeometry.computeVertexNormals();
        const bankMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true, side: THREE.DoubleSide, roughness: 0.97,
        });
        applySurfaceDarkness(bankMaterial, locationDarknessTexture,
            new THREE.Vector2(currentLocationData.grid_width, currentLocationData.grid_height));
        sandBankMesh = new THREE.Mesh(bankGeometry, bankMaterial);
        sandBankMesh.raycast = () => {};
        sandBankMesh.receiveShadow = true;
        scene.add(sandBankMesh);
    }
    waterDetailGroup = createWaterDetailGroup(THREE, currentLocationData.tiles_data, waterRegions);
    scene.add(waterDetailGroup);
}

function rebuildGrassDetailMesh() {
    if (grassDetailGroup) {
        scene.remove(grassDetailGroup);
        disposeObject(grassDetailGroup);
        grassDetailGroup = null;
    }
    if (!scene || !currentLocationData) return;
    const objects = currentLocationData.objects || [];
    const floors = objects.filter(object => object.type === 'floor')
        .map(object => floorVisualPose(object, objects));
    const isCovered = (x, z) => floors.some(floor => {
        const dx = x - floor.x;
        const dz = z - floor.z;
        return Math.abs(dx * floor.axis.x + dz * floor.axis.z) < floor.width / 2
            && Math.abs(dx * floor.normal.x + dz * floor.normal.z) < floor.depth / 2;
    });
    grassDetailGroup = createGrassDetailGroup(THREE, currentLocationData.tiles_data,
        createTerrainSurfaceHeightSampler(currentLocationData.tiles_data), isCovered);
    scene.add(grassDetailGroup);
}

function updateTileInstance(instanceId, x, z, tile) {
    const height = tile.height || 1.0;
    const isWater = tile.terrain === 'water';
    const isSmooth = isSmoothTerrainTile(currentLocationData.tiles_data, x, z);
    const waterKind = waterRegions.get(`${x},${z}`) || 'grass';
    const renderedHeight = isWater
        ? Math.max(0.05, waterLevelForTile(tile, waterKind) - 0.01) : height;
    tileInstanceTransform.position.set(x + 0.5, renderedHeight / 2, z + 0.5);
    tileInstanceTransform.scale.set(1, renderedHeight, 1);
    tileInstanceTransform.updateMatrix();
    const activeMesh = isWater ? waterTileMesh : locationTileMesh;
    const inactiveMesh = isWater ? locationTileMesh : waterTileMesh;
    if (!isSmooth) activeMesh.setMatrixAt(instanceId, tileInstanceTransform.matrix);
    const color = new THREE.Color(isWater ? WATER_SIDE_COLORS[waterKind]
        : terrainColors[tile.terrain] || 0x3a5f0b);
    if (!isWater) color.multiplyScalar(darknessFactorAt(x, z));
    activeMesh.setColorAt(instanceId, color);
    tileInstanceTransform.scale.set(0, 0, 0);
    tileInstanceTransform.updateMatrix();
    inactiveMesh.setMatrixAt(instanceId, tileInstanceTransform.matrix);
    if (isSmooth) activeMesh.setMatrixAt(instanceId, tileInstanceTransform.matrix);
    activeMesh.userData.tileByInstance ??= [];
    activeMesh.userData.tileByInstance[instanceId] = { x, z };
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
                mesh = createTentModel(THREE, obj.color === '#d2b48c'
                    ? '#9b9778' : (obj.color || '#9b9778'));
                yOffset = 0;
                break;
            case 'campfire':
                mesh = createFireObjectModel(THREE, {
                    type: 'campfire', tile_x: tileX, tile_y: tileZ,
                    properties: { color: obj.color, is_lit: obj.is_lit !== false },
                }, baseAssetDimensions('campfire', 'decor'));
                yOffset = 0;
                break;
            case 'poster':
                mesh = createPosterMesh(obj.color);
                yOffset = 0;
                break;
            case 'anomaly':
                mesh = createAnomalyEffect(
                    obj.anomalyType || 'electric',
                    obj.color || '#00ffff',
                    1,
                    obj.anomalyKey || '',
                    obj.anomalyName || obj.anomalyKey || '',
                );
                yOffset = 0;
                isAnomalyEffect = true;
                break;
            default:
                geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
                material = new THREE.MeshStandardMaterial({ color: 0xffaa44 });
                yOffset = 0.25;
        }
        if (obj.type === 'tree') {
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
        } else if (!mesh) {
            mesh = new THREE.Mesh(geometry, material);
        }
        mesh.userData = { ...mesh.userData, tileX, tileZ, objType: obj.type, sourceObject: obj };
        mesh.position.set(
            worldX + Number(obj.x || 0),
            tileHeight + yOffset + clampAssetElevation(obj.elevation),
            worldZ + Number(obj.z || 0),
        );
        mesh.rotation.y = THREE.MathUtils.degToRad(Number(obj.rotation) || 0);
        applyDecorSize(mesh, obj, obj.type);
        if (!isAnomalyEffect) mesh.position.y += yOffset * (mesh.scale.y - 1);
        if (obj.gm_hidden && window.isGM) makeGmHiddenGhost(mesh);
        scene.add(mesh);
        objectMeshes.push(mesh);
        if (isAnomalyEffect) anomalyEffectMeshes.push(mesh);
        else {
            mesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = !child.userData.fireFlame;
                    child.receiveShadow = true;
                }
            });
            tintLocationMesh(mesh, darknessFactorAt(mesh.position.x, mesh.position.z));
        }
    }
}

// ========== Обновления из сокета ==========
export function applyLocationTilesUpdate(locationId, updates) {
    if (getCurrentLocationId() !== locationId) return;
    if (!currentLocationData) return;
    let terrainNeedsRebuild = false;
    let gridNeedsRebuild = false;
    let lightChanged = false;
    for (const upd of updates) {
        const tile = currentLocationData.tiles_data[upd.z][upd.x];
        if (upd.objects !== undefined && (
            tile.objects?.some(obj => ['campfire', 'anomaly'].includes(obj.type))
            || upd.objects.some(obj => ['campfire', 'anomaly'].includes(obj.type))
        )) lightChanged = true;
        if (upd.height !== undefined) lightChanged = true;
        if (upd.terrain !== undefined || upd.height !== undefined) gridNeedsRebuild = true;
        if (upd.terrain !== undefined) tile.terrain = upd.terrain;
        if (upd.height !== undefined) tile.height = upd.height;
        if (upd.objects !== undefined) tile.objects = upd.objects;
        if (upd.radiation !== undefined) tile.radiation = upd.radiation;
        terrainNeedsRebuild = updateTileCube(upd.x, upd.z, tile, false) || terrainNeedsRebuild;
        rebuildTileObjects(upd.x, upd.z);
        updateLocationObjectHeight(upd.x, upd.z);
    }
    if (terrainNeedsRebuild) rebuildSmoothTerrainMesh();
    if (gridNeedsRebuild) {
        if (updates.some(update => update.terrain !== undefined)) updateLocationTerrainSurfaceTexture(updates);
        rebuildLocationTerrainSurface(true);
        rebuildWaterSurfaceMesh();
        rebuildLocationGrid();
        rebuildGrassDetailMesh();
    }
    if (updates.some(update => update.height !== undefined)) rebuildLocationRoofs();
    if (gridNeedsRebuild) clearFogOverlay();
    if (lightChanged) applyLocationLighting();
    invalidateMovementMapCache();
    applyFogOfWar();
    if (editorSelection) updateEditorSelectionVisual();
    characterModels.forEach((entry) => {
        const height = getTileHeight(entry.posX, entry.posY);
        entry.model.position.y = height;
        entry.label.position.y = height + (entry.posture === 'prone' ? 0.95 : entry.posture === 'sitting' ? 1.25 : 1.55);
    });
}

// ========== Кисть ==========
export function applyLocationBrush(centerX, centerZ, updates, radius) {
    if (!currentLocationData) return;
    const tiles = currentLocationData.tiles_data;
    const changed = [];
    let terrainNeedsRebuild = false;
    let lightChanged = false;
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
                        elevation: window.locationEditorTool === 'assets'
                            ? clampAssetElevation(selectedLocationAsset?.elevation) : 0,
                        dimensions: window.locationEditorTool === 'assets'
                            ? assetDimensions(selectedLocationAsset, 'decor', selectedLocationAsset?.id)
                            : undefined,
                        color: brushObjectColor
                    };
                    if (brushObjectType.startsWith('anomaly_')) {
                        newObj.type = 'anomaly';
                        newObj.anomalyKey = brushObjectType.replace('anomaly_', '');
                        const profile = (window.locationAnomalyCatalog || []).find(
                            anomaly => anomaly.key === newObj.anomalyKey
                        );
                        newObj.anomalyName = profile?.name || newObj.anomalyKey;
                        newObj.anomalyRank = profile?.rank || null;
                        newObj.anomalyCategory = profile?.category || null;
                        newObj.anomalyType = profile?.visual || ANOMALY_VISUAL_BY_KEY[newObj.anomalyKey] || 'void';
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
                if (updates.objects !== undefined || updates.addObject) {
                    lightChanged ||= tile.objects?.some(obj => ['campfire', 'anomaly'].includes(obj.type))
                        || objectMeshes.some(mesh => mesh.userData?.tileX === x
                            && mesh.userData?.tileZ === z
                            && ['campfire', 'anomaly'].includes(mesh.userData?.objType));
                }
                terrainNeedsRebuild = updateTileCube(x, z, tile, false) || terrainNeedsRebuild;
                if (updates.height !== undefined) updateLocationObjectHeight(x, z);
                if (updates.objects !== undefined || updates.addObject) {
                    rebuildTileObjects(x, z);
                }
                changed.push({ x, z, terrain: tile.terrain, height: tile.height, objects: tile.objects, radiation: tile.radiation });
            }
        }
    }
    if (updates.terrain !== undefined) {
        const changedByTile = new Map(changed.map(item => [`${item.x},${item.z}`, item]));
        for (const { x, z, height } of waterSurfaceAdjustments(tiles, new Set(changedByTile.keys()))) {
            tiles[z][x].height = height;
            lightChanged = true;
            terrainNeedsRebuild = updateTileCube(x, z, tiles[z][x], false) || terrainNeedsRebuild;
            updateLocationObjectHeight(x, z);
            const cell = changedByTile.get(`${x},${z}`);
            if (cell) cell.height = height;
            else {
                const added = { x, z, terrain: tiles[z][x].terrain, height,
                    objects: tiles[z][x].objects, radiation: tiles[z][x].radiation };
                changed.push(added);
                changedByTile.set(`${x},${z}`, added);
            }
        }
    }
    if (changed.length === 0) return;
    if (terrainNeedsRebuild) rebuildSmoothTerrainMesh();
    if (updates.terrain !== undefined || updates.height !== undefined) {
        if (updates.terrain !== undefined) updateLocationTerrainSurfaceTexture(changed);
        rebuildLocationTerrainSurface(true);
        rebuildWaterSurfaceMesh();
        rebuildLocationGrid();
        rebuildGrassDetailMesh();
    }
    if (updates.height !== undefined) rebuildLocationRoofs();
    if (updates.terrain !== undefined || updates.height !== undefined) clearFogOverlay();
    if (lightChanged || updates.height !== undefined) applyLocationLighting();
    if (updates.height !== undefined && editorSelection) updateEditorSelectionVisual();
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
        entry.label.position.y = height + (entry.posture === 'prone' ? 0.95 : entry.posture === 'sitting' ? 1.25 : 1.55);
    });
    applyFogOfWar();
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
        if (entry.model.visible) models.push(entry.model);
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
        if (pendingFacingSelection) {
            updateFacingPreview(e.clientX, e.clientY);
        }
        if (pendingCombatAction) {
            updateAttackPreview(e.clientX, e.clientY);
        }
        if (pendingObjectMoveId) {
            updateStructureMovePreview(e.clientX, e.clientY);
        }
        if (pendingStructureAction && !pendingObjectMoveId) {
            const menuOpen = structureActionMenu?.style.display === 'block';
            const targetCharacterObject = getCharacterAtScreen(e.clientX, e.clientY);
            const targetCharacterId = targetCharacterObject?.userData?.characterId;
            if (
                targetCharacterId
                && canInteractWithCharacter(
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
                    if (!menuOpen) clearStructureActionMenu();
                }
            } else {
                hoveredStructureObjectId = null;
                structureHoverLastObjectId = null;
                if (!menuOpen) clearStructureActionMenu();
            }
        }
    };
    canvas.addEventListener('mousemove', onMouseMove);
    handlers.canvas.mousemove = onMouseMove;

    // pointerdown - начало перетаскивания
    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        if (structureActionMenu?.style.display === 'block') {
            e.preventDefault();
            e.stopImmediatePropagation();
            hideStructureInteraction();
            return;
        }
        if (window.locationEditMode && (window.locationEditorTool !== 'select' || e.altKey || e.shiftKey)) return;
        if (isDraggingCharacter) return;
        if (pendingFacingSelection) {
            e.preventDefault();
            e.stopPropagation();
            resolveFacingCell(e.clientX, e.clientY);
            return;
        }
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
        if (
            pendingCombatAction?.actionKey === 'attack'
            && pendingCombatAction?.targetType === 'character'
            && !getCharacterAtScreen(e.clientX, e.clientY)
            && getLocationObjectAtScreen(e.clientX, e.clientY)?.userData?.locationObject
        ) {
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
            if (canInteractWithCharacter(pendingStructureAction.actorCharacterId, charId)) {
                showCharacterInteractionMenu(e.clientX, e.clientY, charId);
            } else {
                showNotification('Взаимодействовать можно с соседним персонажем', 'system');
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
        canvas.setPointerCapture?.(e.pointerId);
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
            entry.label.position.set(newX, height + (entry.posture === 'prone' ? 0.95 : entry.posture === 'sitting' ? 1.25 : 1.55), newZ);
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
        if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
        controls.enabled = true;
        canvas.style.cursor = 'default';
    };
    const onPointerUp = (e) => { endDrag(e); };
    const onPointerCancel = (e) => { endDrag(e); };
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    handlers.canvas.charPointerUp = onPointerUp;
    handlers.canvas.charPointerCancel = onPointerCancel;
    // Pointer capture normally handles this; the window fallback prevents a stuck camera
    // when the browser cancels the pointer outside of the WebGL canvas.
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    handlers.window.charDragPointerUp = onPointerUp;
    handlers.window.charDragPointerCancel = onPointerCancel;

    // contextmenu
    const onContextMenu = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (cameraDragMenuGuard.shouldSuppressMenu()) return;
        if (cancelLocationEditorContextAction()) return;
        if (pendingCombatAction) {
            showNotification('Выберите цель левой кнопкой мыши или нажмите Esc для отмены', 'system');
            return;
        }
        const obj = getCharacterAtScreen(e.clientX, e.clientY);
        const charId = obj?.userData?.characterId || hoveredCharacterId;
        if (charId) {
            showCombatActionMenu(e.clientX, e.clientY, charId);
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
        if (editorRotateMode && editorGroupRotatePivot
            && ['ControlLeft', 'ControlRight'].includes(e.code) && !editorGroupRotateWithPivot) {
            editorGroupRotateWithPivot = true;
            updateBuildPreview();
        }
        if (window.isGM && window.locationEditMode && editorSelections.length
            && !isKeyboardInputTarget(e.target) && !e.altKey && !e.ctrlKey && !e.metaKey
            && !Array.from(document.querySelectorAll('.modal')).some(modal => modal.getClientRects().length)) {
            const scaleUp = e.code === 'NumpadAdd' || e.code === 'Equal' || e.key === '+' || e.key === '=';
            const scaleDown = e.code === 'NumpadSubtract' || e.key === '-';
            if (e.code === 'KeyH' || e.code === 'Delete' || scaleUp || scaleDown) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (e.repeat) return;
                if (e.code === 'KeyH') toggleSelectedLocationAssetsHidden();
                else if (e.code === 'Delete') deleteSelectedLocationAsset();
                else scaleSelectedLocationAssets(scaleUp);
                return;
            }
        }
        if (editorResizeMode && !isKeyboardInputTarget(e.target) && !e.altKey && !e.ctrlKey && !e.metaKey
            && ['KeyX', 'KeyY', 'KeyZ'].includes(e.code)) {
            e.preventDefault();
            setLocationAssetResizeAxis({ KeyX: 'width', KeyY: 'height', KeyZ: 'depth' }[e.code]);
            return;
        }
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
        if (editorResizeMode) {
            e.preventDefault();
            cancelLocationAssetResize();
            return;
        }
        if (editorRotateMode) {
            e.preventDefault();
            editorRotateMode = false;
            editorGroupRotatePivot = null;
            editorGroupRotateStartBearing = null;
            editorGroupRotateWithPivot = false;
            if (editorSelection?.kind === 'lamp') applyLocationLighting();
            updateBuildPreview();
            return;
        }
        if (editorMoveMode) {
            e.preventDefault();
            editorMoveMode = false;
            editorMovePreviewPoint = null;
            if (editorSelectionRing) editorSelectionRing.position.set(0, 0, 0);
            updateBuildPreview();
            return;
        }
        if (window.locationEditMode && window.locationEditorTool === 'assets' && selectedLocationAsset) {
            e.preventDefault();
            window.selectLocationEditorTool?.('select');
            clearLocationAssetPreset();
            return;
        }
        if (pendingCharacterPlacement) {
            e.preventDefault();
            pendingCharacterPlacement = null;
            pendingCharacterPlacementQueue = [];
            canvas.style.cursor = 'default';
            showNotification('Размещение персонажа отменено', 'system');
            return;
        }
        if (movementTypeMenu && movementTypeMenu.style.display !== 'none') {
            e.preventDefault();
            closeMovementTypeMenu();
        }
        if (postureMenu && postureMenu.style.display !== 'none') {
            e.preventDefault();
            closePostureMenu();
        }
        if (pendingFacingSelection || facingMenu) {
            e.preventDefault();
            closeFacingMenu();
            canvas.style.cursor = 'default';
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
        if (pendingStructureAction || pendingObjectMoveId || structureRotationMenu?.style.display === 'block') {
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
        if (editorRotateMode && editorGroupRotatePivot
            && ['ControlLeft', 'ControlRight'].includes(e.code) && editorGroupRotateWithPivot) {
            editorGroupRotateWithPivot = false;
            updateBuildPreview();
        }
    };
    const onWindowBlur = () => {
        locationCameraKeys.clear();
        if (editorRotateMode && editorGroupRotateWithPivot) {
            editorGroupRotateWithPivot = false;
            updateBuildPreview();
        }
    };
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    handlers.document.keyup = onKeyUp;
    handlers.window.cameraBlur = onWindowBlur;
}

// ========== Настройка обработчиков редактирования и Drag&Drop спавна ==========
function getEditBrushUpdates() {
    const tool = window.locationEditorTool;
    if (eraserMode || tool === 'erase') return { objects: [] };
    if (tool === 'radiation') return { radiation: brushRadiation };
    if (tool === 'decor') return { addObject: true };
    if (tool === 'terrain') return { terrain: currentBrushTerrain };
    if (tool === 'height') return { height: currentBrushHeight };
    return {};
}

function shouldEraseLocationStructures() {
    return window.locationEditorTool === 'erase'
        && document.getElementById('loc-erase-structures')?.checked === true;
}

export function setupLocationEditing() {
    if (!renderer) return;
    const canvas = renderer.domElement;
    const locInfo = document.getElementById('location-tile-info');
    locationActive = true;
    const onCameraRotatePointerDown = (event) => {
        if (event.button === 2) cameraDragMenuGuard.begin(event.clientX, event.clientY, event.pointerId);
        if (event.button === 2 && window.locationEditMode && !isDraggingCharacter) {
            controls.enabled = true;
        }
    };
    canvas.addEventListener('pointerdown', onCameraRotatePointerDown, { capture: true });
    handlers.canvas.cameraRotatePointerDown = onCameraRotatePointerDown;

    const onPointerMove = (e) => {
        if (!locationActive) return;
        cameraDragMenuGuard.move(e.clientX, e.clientY, e.pointerId);
        if (editorRotateMode && e.target === canvas) {
            updateEditorRotatePreview(e.clientX, e.clientY, e.shiftKey, e.ctrlKey);
        }
        if (editorResizeMode && e.target === canvas && !(e.buttons & 2)) {
            updateEditorResizePreview(e.clientX, e.clientY);
        }
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(tileCubes);
        if (intersects.length > 0) {
            const hit = intersects[0];
            const coords = hitTileCoords(hit);
            if (!coords) return;
            const { x, z } = coords;
            const tile = currentLocationData.tiles_data[z][x];
            locInfo.innerHTML = `
                <b>(${x}, ${z})</b><br>
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
            if (editorMoveMode && e.target === canvas && !(e.buttons & 2)) {
                const point = getPointerWorldPoint(e.clientX, e.clientY, getTileHeight(x, z));
                if (point) {
                    editorMovePreviewPoint = { x: point.x, z: point.z };
                    if (editorSelections.length > 1 && editorSelectionRing) {
                        const anchor = getSelectedLocationEditorAsset();
                        editorSelectionRing.position.set(point.x - anchor.x, 0, point.z - anchor.z);
                    }
                }
            }
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
    const onCameraRotatePointerUp = event => {
        if (event.button === 2 || event.type === 'pointercancel') cameraDragMenuGuard.end();
    };
    window.addEventListener('pointerup', onCameraRotatePointerUp);
    window.addEventListener('pointercancel', onCameraRotatePointerUp);

    const onPointerDown = (e) => {
        if (!locationActive) return;
        if (e.button !== 0) return;
        if (!hoveredTileCoords) return;
        if (e.target !== canvas) return;
        if (pendingCharacterPlacement) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const placement = pendingCharacterPlacement;
            pendingCharacterPlacement = null;
            canvas.style.cursor = 'default';
            const { x, z } = hoveredTileCoords;
            openOwnerSelectionModal(
                placement.characterId,
                x,
                z,
                placement.ownerId,
                {
                    isMutant: placement.isMutant,
                    onSuccess: activateNextCharacterPlacement,
                    onCancel: cancelCharacterPlacement,
                },
            );
            return;
        }
        if (pendingObjectMoveId) {
            commitStructureMovePreview(e.clientX, e.clientY);
            return;
        }
        if (!window.locationEditMode) return;
        if (editorResizeMode) {
            e.preventDefault();
            e.stopImmediatePropagation();
            commitEditorAssetResize();
            return;
        }
        if (editorRotateMode) {
            e.preventDefault();
            e.stopImmediatePropagation();
            updateEditorRotatePreview(e.clientX, e.clientY, e.shiftKey, e.ctrlKey);
            commitEditorAssetRotation();
            return;
        }
        if (editorMoveMode) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const point = getPointerWorldPoint(e.clientX, e.clientY,
                getTileHeight(hoveredTileCoords.x, hoveredTileCoords.z));
            commitEditorAssetMove(point?.x ?? hoveredTileCoords.x + 0.5,
                point?.z ?? hoveredTileCoords.z + 0.5);
            return;
        }
        if (window.locationEditorTool === 'select') {
            if (selectEditorAsset(e.clientX, e.clientY, e.shiftKey)) {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
            return;
        }
        if (window.locationEditorTool === 'assets' && !e.altKey && (!e.shiftKey || !selectedLocationAsset)) {
            if (!selectedLocationAsset) {
                if (selectEditorAsset(e.clientX, e.clientY, e.shiftKey)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    window.selectLocationEditorTool?.('select');
                }
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            placeSelectedLocationAsset(hoveredTileCoords.x, hoveredTileCoords.z);
            return;
        }
        if (window.locationEditorTool === 'light' && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            canvas.setPointerCapture(e.pointerId);
            window.locationDarknessPaintAtTile?.(hoveredTileCoords.x, hoveredTileCoords.z);
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        const { x, z } = hoveredTileCoords;
        if (buildMode === 'structure' && (eraserMode || (!e.altKey && !e.shiftKey))) {
            if (eraserMode) removeStructuresAtTile(x, z, brushRadius);
            else placeStructureAtTile(x, z);
            return;
        }
        const updates = getEditBrushUpdates();
        if (Object.keys(updates).length) {
            applyLocationBrush(x, z, updates, brushRadius);
        }
        if (shouldEraseLocationStructures()) removeStructuresAtTile(x, z, brushRadius);
        processedTilesForObjects.clear();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    handlers.canvas.editPointerDown = onPointerDown;

    const onPointerMoveWithDrag = (e) => {
        if (!locationActive) return;
        if (e.buttons !== 1) return;
        if (!window.locationEditMode) return;
        if ((window.locationEditorTool === 'assets' && !e.altKey && !e.shiftKey) || editorMoveMode || editorRotateMode || editorResizeMode) return;
        if (!hoveredTileCoords) return;
        if (e.target !== canvas) return;
        const { x, z } = hoveredTileCoords;
        if (window.locationEditorTool === 'light' && !e.altKey && !e.shiftKey) {
            window.locationDarknessPaintAtTile?.(x, z);
            return;
        }
        if (buildMode === 'structure' && (eraserMode || (!e.altKey && !e.shiftKey))) {
            if (eraserMode) removeStructuresAtTile(x, z, brushRadius);
            return;
        }
        const updates = getEditBrushUpdates();
        if (Object.keys(updates).length) {
            applyLocationBrush(x, z, updates, brushRadius);
        }
        if (shouldEraseLocationStructures()) removeStructuresAtTile(x, z, brushRadius);
    };
    window.addEventListener('pointermove', onPointerMoveWithDrag);
    handlers.window.pointerMoveWithDrag = onPointerMoveWithDrag;

    const onPointerUp = (e) => {
        if (!locationActive) return;
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
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
        const groupIds = Array.isArray(parsed.characterIds)
            ? [...new Set(parsed.characterIds.map(Number).filter(Number.isInteger))]
            : [];
        const characterId = parsed.characterId || groupIds[0];
        const ownerId = parsed.ownerId;
        if (!characterId) return;
        openOwnerSelectionModal(characterId, tileX, tileZ, ownerId, {
            isMutant: Boolean(parsed.isMutant),
            onConfirm: groupIds.length > 1
                ? assignToUserId => spawnMutantGroupNearTile(groupIds, tileX, tileZ, assignToUserId)
                : null,
        });
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
        window.removeEventListener('pointerup', onCameraRotatePointerUp);
        window.removeEventListener('pointercancel', onCameraRotatePointerUp);
        cameraDragMenuGuard.reset();
        if (handlers.window.charDragPointerUp) {
            window.removeEventListener('pointerup', handlers.window.charDragPointerUp);
            delete handlers.window.charDragPointerUp;
        }
        if (handlers.window.charDragPointerCancel) {
            window.removeEventListener('pointercancel', handlers.window.charDragPointerCancel);
            delete handlers.window.charDragPointerCancel;
        }
        // Удаляем все обработчики из хранилища
        Object.keys(handlers.window).forEach(key => {
            window.removeEventListener(key, handlers.window[key]);
            delete handlers.window[key];
        });
        Object.keys(handlers.canvas).forEach(key => {
            canvas.removeEventListener(key, handlers.canvas[key]);
            delete handlers.canvas[key];
        });
        canvas.removeEventListener('pointerdown', onCameraRotatePointerDown, { capture: true });
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
async function spawnCharacterAtTile(characterId, tileX, tileZ, assignToUserId) {
    const response = await fetch(`/lobbies/${window.currentLobbyId}/locations/${getCurrentLocationId()}/spawn_character`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
            character_id: characterId, tile_x: tileX, tile_y: tileZ,
            assign_to_user_id: assignToUserId,
        }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Не удалось разместить персонажа');
    }
    return response.json();
}

async function spawnMutantGroupNearTile(characterIds, centerX, centerY, assignToUserId) {
    const blocked = new Set(getMovementMap().blockedTiles);
    const positions = [];
    const width = currentLocationData?.grid_width || 0;
    const height = currentLocationData?.grid_height || 0;
    for (let radius = 0; radius < Math.max(width, height) && positions.length < characterIds.length; radius += 1) {
        for (let y = centerY - radius; y <= centerY + radius; y += 1) {
            for (let x = centerX - radius; x <= centerX + radius; x += 1) {
                if (Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) !== radius) continue;
                if (x < 0 || y < 0 || x >= width || y >= height) continue;
                if (blocked.has(`${x}:${y}`)) continue;
                positions.push({ x, y });
                if (positions.length === characterIds.length) break;
            }
            if (positions.length === characterIds.length) break;
        }
    }
    if (positions.length < characterIds.length) {
        throw new Error('Рядом недостаточно свободных клеток для всей группы');
    }
    let placed = 0;
    try {
        for (let index = 0; index < characterIds.length; index += 1) {
            await spawnCharacterAtTile(characterIds[index], positions[index].x, positions[index].y, assignToUserId);
            placed += 1;
        }
    } catch (error) {
        throw new Error(`Размещено ${placed} из ${characterIds.length}: ${error.message}`);
    }
    showNotification(`Размещено мутантов: ${placed}`, 'success');
}

export async function openOwnerSelectionModal(characterId, tileX, tileZ, dragDataOwnerId, callbacks = {}) {
    const lobbyParticipants = window.lobbyParticipants || [];
    const currentUserId = parseInt(localStorage.getItem('user_id'));
    const isGM = window.isGM;
    const autoAssignMutant = isGM && callbacks.isMutant
        && document.getElementById('mutants-belong-to-gm')?.checked;
    if (autoAssignMutant) {
        try {
            if (callbacks.onConfirm) await callbacks.onConfirm(currentUserId);
            else await spawnCharacterAtTile(characterId, tileX, tileZ, currentUserId);
            callbacks.onSuccess?.();
        } catch (error) {
            showNotification(error.message, 'error');
            callbacks.onCancel?.();
        }
        return;
    }
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
            <span class="close owner-selection-close">&times;</span>
            <h3>Выберите владельца персонажа</h3>
            <select id="owner-select" class="form-control">
                ${options.map(opt => `<option value="${opt.id}" ${Number(opt.id) === Number(characterOwner) ? 'selected' : ''}>${opt.name}</option>`).join('')}
            </select>
            <div class="form-actions">
                <button id="confirm-spawn" class="btn btn-primary">Поместить</button>
                <button class="btn btn-secondary owner-selection-cancel">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    const cancel = () => {
        modal.remove();
        callbacks.onCancel?.();
    };
    modal.querySelector('.owner-selection-close').onclick = cancel;
    modal.querySelector('.owner-selection-cancel').onclick = cancel;
    document.getElementById('confirm-spawn').onclick = async () => {
        const assignToUserId = parseInt(document.getElementById('owner-select').value);
        modal.remove();
        try {
            if (callbacks.onConfirm) await callbacks.onConfirm(assignToUserId);
            else await spawnCharacterAtTile(characterId, tileX, tileZ, assignToUserId);
            showNotification('Персонаж появился в локации', 'success');
            callbacks.onSuccess?.();
        } catch (err) {
            showNotification(err.message);
            callbacks.onCancel?.();
        }
    };
}

function cancelCharacterPlacement() {
    pendingCharacterPlacement = null;
    pendingCharacterPlacementQueue = [];
    if (renderer) renderer.domElement.style.cursor = 'default';
}

function activateNextCharacterPlacement() {
    pendingCharacterPlacement = pendingCharacterPlacementQueue.shift() || null;
    if (!pendingCharacterPlacement) {
        if (renderer) renderer.domElement.style.cursor = 'default';
        return;
    }
    renderer.domElement.style.cursor = 'crosshair';
    const remaining = pendingCharacterPlacementQueue.length;
    showNotification(
        `Выберите клетку для ${pendingCharacterPlacement.name}${remaining ? ` · затем ещё ${remaining}` : ''}. Esc отменяет размещение.`,
        'system',
    );
}

export function beginCharacterPlacement(characterOrCharacters) {
    const characters = Array.isArray(characterOrCharacters) ? characterOrCharacters : [characterOrCharacters];
    if (!locationActive || !currentLocationData || !renderer) {
        return false;
    }
    pendingCharacterPlacementQueue = characters.map(character => {
        const characterId = Number(character?.id ?? character?.characterId);
        if (!characterId) return null;
        return {
            characterId,
            ownerId: Number(character?.owner_id ?? character?.ownerId) || null,
            name: character?.name || `#${characterId}`,
            isMutant: Boolean(character?.data?.is_mutant || character?.data?.basic?.is_mutant),
        };
    }).filter(Boolean);
    if (!pendingCharacterPlacementQueue.length) return false;
    activateNextCharacterPlacement();
    return true;
}

// ========== Управляющие функции для UI ==========
export function setLocationEditMode(enabled) {
    editMode = enabled;
    window.locationEditMode = enabled;
    updateRoofVisibility();
    if (locationLightGroup) locationLightGroup.children.forEach(fixture => {
        fixture.children.forEach(child => {
            if (child.isMesh) child.visible = Boolean(window.isGM
                && (enabled || (child.userData.locationLampBulb && child.userData.gmHiddenGhost)));
        });
    });
    if (fogIsActive()) applyFogOfWar();
    if (darknessEditorOverlay) darknessEditorOverlay.visible = darknessOverlayRequested && enabled;
    if (!enabled) {
        hideHighlight();
        clearBuildPreview();
        clearEditorSelection();
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
    const darknessRadius = document.querySelector('[data-darkness-radius]');
    const darknessRadiusValue = document.querySelector('[data-darkness-radius-value]');
    if (darknessRadius) darknessRadius.value = r;
    if (darknessRadiusValue) darknessRadiusValue.textContent = `${r * 2 + 1} × ${r * 2 + 1}`;
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
    const input = document.getElementById('loc-obj-offset-x');
    if (input) input.value = String(brushObjectOffsetX);
    const span = document.getElementById('loc-obj-offset-x-value');
    if (span) span.textContent = brushObjectOffsetX.toFixed(2);
}
export function setLocationBrushObjectOffsetZ(offset) {
    brushObjectOffsetZ = parseFloat(offset) || 0;
    const input = document.getElementById('loc-obj-offset-z');
    if (input) input.value = String(brushObjectOffsetZ);
    const span = document.getElementById('loc-obj-offset-z-value');
    if (span) span.textContent = brushObjectOffsetZ.toFixed(2);
}
export function setLocationBrushObjectScale(scale) {
    brushObjectScale = parseFloat(scale) || 1.0;
    const input = document.getElementById('loc-obj-scale');
    if (input) input.value = String(brushObjectScale);
    const span = document.getElementById('loc-obj-scale-value');
    if (span) span.textContent = brushObjectScale.toFixed(2);
}
export function setLocationBrushObjectRotation(rot) {
    const degrees = parseInt(rot, 10) || 0;
    brushObjectRotation = ((degrees % 360) + 360) % 360;
    const input = document.getElementById('loc-obj-rotation');
    if (input) input.value = String(brushObjectRotation);
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

function getLocationViewToggleGroup() {
    let group = document.getElementById('location-view-toggle-group');
    if (!group) {
        group = document.createElement('div');
        group.id = 'location-view-toggle-group';
        document.getElementById('location-container').appendChild(group);
    }
    group.style.position = 'absolute';
    group.style.top = '20px';
    const exitWidth = document.getElementById('exit-location-btn')?.getBoundingClientRect().width || 129;
    group.style.right = window.isGM ? '271px' : `${Math.ceil(exitWidth) + 28}px`;
    group.style.zIndex = '20';
    group.style.display = 'flex';
    group.style.alignItems = 'center';
    group.style.gap = '8px';
    return group;
}

export function addLocationGridButton() {
    document.getElementById('location-grid-btn')?.remove();
    const btn = document.createElement('button');
    btn.id = 'location-grid-btn';
    btn.type = 'button';
    btn.textContent = '▦';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.padding = '8px 12px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '18px';
    btn.style.lineHeight = '1';
    const sync = () => {
        btn.style.background = locationGridVisible ? '#3d7959' : '#465261';
        btn.title = locationGridVisible ? 'Скрыть сетку' : 'Показать сетку';
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-pressed', String(locationGridVisible));
    };
    btn.onclick = () => {
        locationGridVisible = !locationGridVisible;
        rebuildLocationGrid();
        sync();
    };
    sync();
    getLocationViewToggleGroup().appendChild(btn);
    return btn;
}

export function addLocationRoofButton() {
    document.getElementById('location-roof-btn')?.remove();
    const btn = document.createElement('button');
    btn.id = 'location-roof-btn';
    btn.type = 'button';
    btn.textContent = '⌂';
    btn.style.color = 'white';
    btn.style.border = 'none';
    btn.style.padding = '8px 12px';
    btn.style.borderRadius = '8px';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '18px';
    btn.style.lineHeight = '1';
    const sync = () => {
        btn.style.background = locationRoofsVisible ? '#3d7959' : '#465261';
        btn.title = locationRoofsVisible ? 'Скрыть крыши' : 'Показать крыши';
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-pressed', String(locationRoofsVisible));
    };
    btn.onclick = () => {
        locationRoofsVisible = !locationRoofsVisible;
        updateRoofVisibility();
        sync();
    };
    sync();
    getLocationViewToggleGroup().prepend(btn);
    return btn;
}

export function destroyLocationScene() {
    locationProfiler?.destroy();
    locationProfiler = null;
    locationFpsCounter?.destroy();
    locationFpsCounter = null;
    closeNarrativeActionModal();
    closeCombatStartRequestMenu();
    pendingCombatStartRequests.clear();
    combatStartRequestVersion += 1;
    closeFacingMenu();
    clearFogMemoryGhosts();
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

    clearFogOverlay();
    // Очищаем сцену
    if (scene) {
        if (waterSurfaceMesh?.material.map) waterSurfaceMesh.material.map.dispose();
        terrainSurfaceTexture?.dispose();
        terrainSurfaceTexture = null;
        const objectsToRemove = [];
        scene.traverse((child) => {
            if (child.isLight || child.type === 'Camera') return;
            if (child === highlightBox) return;
            objectsToRemove.push(child);
        });
        objectsToRemove.forEach(obj => {
            disposeObject(obj);
            scene.remove(obj);
        });
        clearUnusedLocationModels();
        tileCubes = [];
        locationTileMesh = null;
        waterTileMesh = null;
        waterSurfaceMesh = null;
        waterBankMesh = null;
        sandBankMesh = null;
        waterDetailGroup = null;
        waterRegions = new Map();
        grassDetailGroup = null;
        smoothTerrainMesh = null;
        terrainSurfaceMesh = null;
        locationGridMesh = null;
        objectMeshes = [];
        anomalyEffectMeshes = [];
        combatAreaMeshes = [];
        locationObjectMeshes = [];
        roofMeshes = [];
        darknessEditorOverlay = null;
        darknessOverlayRequested = false;
        clearAllCharacters();

        if (highlightBox) {
            scene.remove(highlightBox);
            disposeObject(highlightBox);
            highlightBox = null;
        }
        scene = null;
    }
    locationAmbientLight = null;
    locationDirectionalLight = null;
    locationLightGroup = null;
    anomalyRenderSources = [];
    anomalyRenderPool = [];
    lastAnomalyLightUpdateAt = -Infinity;
    locationDarknessTexture?.dispose();
    locationDarknessTexture = null;
    locationDarknessFactors = null;
    activeLightingProfile = null;
    selectedLocationAsset = null;
    editorSelection = null;
    editorSelections = [];
    editorMoveMode = false;
    editorMovePreviewPoint = null;
    editorRotateMode = false;
    editorGroupRotatePivot = null;
    editorGroupRotateStartBearing = null;
    editorGroupRotateWithPivot = false;
    editorResizeMode = false;
    editorResizeDimensions = null;
    editorResizeBaseDimensions = null;
    editorResizeAnchor = null;
    editorSelectionRing = null;
    lampEditPending = false;

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
    containerInteractionRefresh = null;
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
    let renderVersion = 0;
    const renderExchange = async () => {
        const version = ++renderVersion;
        if (Number(containerInteractionState?.objectId) !== Number(object.id)) return;
        const selectedCharacterId = parseInt(select?.value || '0', 10) || null;
        if (selectedCharacterId) {
            containerInteractionState.selectedCharacterId = selectedCharacterId;
            window.currentLocationCharacterId = selectedCharacterId;
            localStorage.setItem('selectedLocationCharacterId', String(selectedCharacterId));
        }

        const character = selectedCharacterId ? await Server.getCharacter(selectedCharacterId).catch(() => null) : null;
        if (version !== renderVersion || Number(containerInteractionState?.objectId) !== Number(object.id)) return;
        const characterData = character?.data || null;
        const characterEntries = characterData ? getCharacterTransferEntries(characterData) : [];
        let transferring = false;
        const transferEntry = async (entry, amount, direction) => {
            if (transferring) return;
            transferring = true;
            try {
                await Server.waitForCharacterSave(selectedCharacterId);
                const fresh = await Server.getCharacter(selectedCharacterId);
                const result = await Server.transferLocationItem(window.currentLobbyId, object.id, {
                    character_id: selectedCharacterId, character_revision: fresh.data._revision,
                    object_revision: object.revision, direction, item_path: entry.path,
                    expected_item: entry.item, amount,
                });
                if (result.deleted) {
                    removeLocationObject(object.id);
                    closeContainerInteractionMenu();
                } else {
                    object = result.object;
                    updateLocationObject(object);
                    await showContainerInteractionMenu(object);
                }
                showNotification('Предмет перемещён', 'success');
            } finally {
                transferring = false;
            }
        };

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
                    await transferEntry(entry, amount, 'to_container');
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
                    await transferEntry(entry, amount, 'to_character');
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
                        object = await Server.updateLocationObject(window.currentLobbyId, object.id, {
                            revision: object.revision,
                            properties: { contents: updatedContents },
                        });
                        updateLocationObject(object);
                        showNotification('Предмет добавлен в контейнер', 'success');
                        renderContainerEntries();
                        return true;
                    },
                });
            };
        }
    };
    containerInteractionRefresh = updatedObject => {
        object = updatedObject;
        renderExchange();
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
