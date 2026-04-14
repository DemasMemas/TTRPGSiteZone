// static/js/ui_interactions.js
// Объединённый модуль: глобальное состояние, горячие клавиши и перетаскивание панелей

// ---------- Часть 1: Глобальное состояние (бывший state.js) ----------
const AppState = {
    // Режимы редактирования карты
    editMode: false,
    eraserMode: false,
    currentTileType: 'grass',
    brushRadius: 0,
    tileHeight: 1.0,

    // Данные комнаты
    isGM: false,
    lobbyId: null,
    token: localStorage.getItem('access_token') || null,

    // UI-состояния
    settingsVisible: false,
    participantsPanelCollapsed: false,

    // Методы для изменения состояния
    setEditMode(value) {
        this.editMode = value;
    },
    setEraserMode(value) {
        this.eraserMode = value;
        window.eraserMode = value;
    },
    setCurrentTileType(value) {
        this.currentTileType = value;
        window.currentTileType = value;
    },
    setBrushRadius(value) {
        this.brushRadius = value;
        window.brushRadius = value;
    },
    setTileHeight(value) {
        this.tileHeight = value;
        window.tileHeight = value;
    },
    setIsGM(value) {
        this.isGM = value;
    },
    setLobbyId(value) {
        this.lobbyId = value;
    },
    setSettingsVisible(value) {
        this.settingsVisible = value;
    },
    setParticipantsPanelCollapsed(value) {
        this.participantsPanelCollapsed = value;
    }
};

// Синхронизируем с глобальными переменными (для обратной совместимости)
window.currentTileType = AppState.currentTileType;
window.tileHeight = AppState.tileHeight;
window.brushRadius = AppState.brushRadius;
window.eraserMode = AppState.eraserMode;

export default AppState;

// ---------- Часть 2: Перетаскивание панелей (бывший draggable.js) ----------
function savePanelState(panelId, state) {
    const allState = JSON.parse(localStorage.getItem('panelStates') || '{}');
    allState[panelId] = { ...allState[panelId], ...state };
    localStorage.setItem('panelStates', JSON.stringify(allState));
}

function loadPanelState(panelId) {
    const allState = JSON.parse(localStorage.getItem('panelStates') || '{}');
    return allState[panelId] || null;
}

function makeDraggable(panel, handle, panelId) {
    let startMouseX, startMouseY, startLeft, startTop, startWidth, startHeight;
    let isDragging = false;

    const onMouseDown = (e) => {
        if (e.target.classList.contains('toggle-btn')) return;
        e.preventDefault();

        panel.style.transition = 'none';
        const rect = panel.getBoundingClientRect();

        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';

        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        startWidth = panel.offsetWidth;
        startHeight = panel.offsetHeight;

        isDragging = true;
        panel.style.cursor = 'grabbing';
    };

    const onMouseMove = (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;

        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        const winW = window.innerWidth;
        const winH = window.innerHeight;

        newLeft = Math.min(Math.max(newLeft, 0), winW - startWidth);
        newTop = Math.min(Math.max(newTop, 0), winH - startHeight);

        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            panel.style.cursor = '';
            panel.style.transition = '';
            const rect = panel.getBoundingClientRect();
            savePanelState(panelId, {
                position: { left: rect.left, top: rect.top }
            });
        }
    };

    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

function applyPosition(panel, pos) {
    requestAnimationFrame(() => {
        const winW = window.innerWidth;
        const winH = window.innerHeight;
        const panelW = panel.offsetWidth;
        const panelH = panel.offsetHeight;

        const left = Math.min(Math.max(pos.left, 0), winW - panelW);
        const top = Math.min(Math.max(pos.top, 0), winH - panelH);

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';
    });
}

export function initDraggablePanels() {
    document.querySelectorAll('.draggable-panel').forEach(panel => {
        const panelId = panel.id;
        if (!panelId) {
            console.warn('Draggable panel без id:', panel);
            return;
        }

        const header = panel.querySelector('.panel-header');
        if (!header) return;

        let toggleBtn = header.querySelector('.toggle-btn');
        if (!toggleBtn) {
            toggleBtn = document.createElement('span');
            toggleBtn.className = 'toggle-btn';
            toggleBtn.innerHTML = '▼';
            header.appendChild(toggleBtn);
        }

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('collapsed');
            const collapsed = panel.classList.contains('collapsed');
            toggleBtn.innerHTML = collapsed ? '▶' : '▼';
            savePanelState(panelId, { collapsed });
        });

        const saved = loadPanelState(panelId);
        if (saved) {
            if (saved.collapsed) {
                panel.classList.add('collapsed');
                toggleBtn.innerHTML = '▶';
            }
            if (saved.position) {
                applyPosition(panel, saved.position);
            }
        }

        makeDraggable(panel, header, panelId);
    });
}

// ---------- Часть 3: Горячие клавиши (бывший hotkeys.js) ----------
import { setBrushRadiusFromInput, setTileHeightFromInput, setEraserModeFromInput, setEditMode, getEditMode } from './mapEdit.js';
import { closeTileEditModal } from './mapEdit.js';
import { closeVisibilityModal } from './ui.js';
import { controls } from './lobby3d.js';
import { closeMarkerEditModal } from './markers.js';

let modalOpen = false;
let altPressed = false;

const customModals = [
    '#create-helmet-template-modal',
    '#create-gasMask-template-modal',
    '#create-armor-template-modal',
    '#create-weapon-template-modal',
    '#create-backpack-template-modal',
    '#create-vest-template-modal',
    '#create-inventory-item-modal',
    '#create-special-trait-template-modal',
    '#create-background-template-modal'
];

export function initHotkeys() {
    const tileModal = document.getElementById('tile-edit-modal');
    const visModal = document.getElementById('visibility-modal');
    const createMarkerModal = document.getElementById('marker-create-modal');
    const editMarkerModal = document.getElementById('marker-edit-modal');
    const charSheetModal = document.getElementById('character-sheet-modal');

    function updateModalOpen() {
        const wasOpen = modalOpen;
        modalOpen = (tileModal?.style.display === 'flex') ||
                    (visModal?.style.display === 'flex') ||
                    (createMarkerModal?.style.display === 'flex') ||
                    (editMarkerModal?.style.display === 'flex') ||
                    (charSheetModal?.style.display === 'flex');
        if (modalOpen && !wasOpen) {
            if (typeof window.hideTooltip === 'function') {
                window.hideTooltip();
            }
        }
    }

    if (tileModal) {
        const observer = new MutationObserver(updateModalOpen);
        observer.observe(tileModal, { attributes: true, attributeFilter: ['style'] });
    }
    if (visModal) {
        const observer = new MutationObserver(updateModalOpen);
        observer.observe(visModal, { attributes: true, attributeFilter: ['style'] });
    }
    if (createMarkerModal) {
        const observer = new MutationObserver(updateModalOpen);
        observer.observe(createMarkerModal, { attributes: true, attributeFilter: ['style'] });
    }
    if (editMarkerModal) {
        const observer = new MutationObserver(updateModalOpen);
        observer.observe(editMarkerModal, { attributes: true, attributeFilter: ['style'] });
    }
    if (charSheetModal) {
        const observer = new MutationObserver(updateModalOpen);
        observer.observe(charSheetModal, { attributes: true, attributeFilter: ['style'] });
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('blur', handleBlur);
}

function handleKeyDown(e) {
    if (e.key === 'Alt') {
        altPressed = true;
        if (controls) controls.enableZoom = false;
    }

    const target = e.target;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // ESC - закрыть модальное окно
    if (e.key === 'Escape') {
        let anyCustomOpen = false;
        customModals.forEach(selector => {
            const modal = document.querySelector(selector);
            if (modal && modal.style.display === 'flex') {
                anyCustomOpen = true;
                modal.style.display = 'none';
            }
        });
        if (anyCustomOpen) {
            e.preventDefault();
            return;
        }

        if (modalOpen) {
            e.preventDefault();
            closeTileEditModal();
            closeVisibilityModal();
            if (typeof window.closeMarkerEditModal === 'function') {
                window.closeMarkerEditModal();
            }
            if (typeof window.closeCharacterSheet === 'function') {
                window.closeCharacterSheet();
            }
            const createModal = document.getElementById('marker-create-modal');
            if (createModal && createModal.style.display === 'flex') {
                createModal.style.display = 'none';
            }
        }
        return;
    }

    // Enter - отправить сообщение
    if (e.key === 'Enter' && isInput && target.id === 'message-input') {
        e.preventDefault();
        window.sendMessage();
        return;
    }

    if (isInput) return;

    // Alt + = / - (радиус кисти)
    if (e.altKey && e.code === 'Equal') {
        e.preventDefault();
        const newRadius = Math.min(3, Math.max(0, AppState.brushRadius + 1));
        setBrushRadiusFromInput(newRadius);
        return;
    }
    if (e.altKey && e.code === 'Minus') {
        e.preventDefault();
        const newRadius = Math.min(3, Math.max(0, AppState.brushRadius - 1));
        setBrushRadiusFromInput(newRadius);
        return;
    }

    // [ и ] - тип тайла
    if (e.code === 'BracketLeft') {
        e.preventDefault();
        const select = document.getElementById('tile-type-select');
        if (!select) return;
        const options = Array.from(select.options);
        let newIndex = (select.selectedIndex - 1 + options.length) % options.length;
        select.selectedIndex = newIndex;
        AppState.setCurrentTileType(select.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }
    if (e.code === 'BracketRight') {
        e.preventDefault();
        const select = document.getElementById('tile-type-select');
        if (!select) return;
        const options = Array.from(select.options);
        let newIndex = (select.selectedIndex + 1) % options.length;
        select.selectedIndex = newIndex;
        AppState.setCurrentTileType(select.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    // = / - (без Alt) - высота
    if (!e.altKey && e.code === 'Equal') {
        e.preventDefault();
        const newHeight = Math.min(3.0, Math.max(0.5, AppState.tileHeight + 0.1));
        setTileHeightFromInput(newHeight);
        return;
    }
    if (!e.altKey && e.code === 'Minus') {
        e.preventDefault();
        const newHeight = Math.min(3.0, Math.max(0.5, AppState.tileHeight - 0.1));
        setTileHeightFromInput(newHeight);
        return;
    }

    // R - ластик
    if (e.code === 'KeyR') {
        e.preventDefault();
        const eraserCheck = document.getElementById('eraser-checkbox');
        if (eraserCheck) {
            const newState = !eraserCheck.checked;
            eraserCheck.checked = newState;
            setEraserModeFromInput(newState);
        }
        return;
    }

    // E - Edit Mode
    if (e.code === 'KeyE') {
        e.preventDefault();
        if (AppState.isGM) {
            setEditMode(!getEditMode());
        }
        return;
    }
}

function handleKeyUp(e) {
    if (e.key === 'Alt') {
        altPressed = false;
        if (controls) controls.enableZoom = true;
    }
}

function handleBlur() {
    if (altPressed) {
        altPressed = false;
        if (controls) controls.enableZoom = true;
    }
}

function handleWheel(e) {
    if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -1 : 1;
        const newRadius = Math.min(3, Math.max(0, AppState.brushRadius + delta));
        setBrushRadiusFromInput(newRadius);
        return;
    }

    const tileSelect = document.getElementById('tile-type-select');
    if (tileSelect && tileSelect.matches(':hover')) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? 1 : -1;
        const options = Array.from(tileSelect.options);
        let newIndex = (tileSelect.selectedIndex + delta + options.length) % options.length;
        tileSelect.selectedIndex = newIndex;
        AppState.setCurrentTileType(tileSelect.value);
        tileSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
}