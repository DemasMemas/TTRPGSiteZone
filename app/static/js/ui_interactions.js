// static/js/ui_interactions.js
// Объединённый модуль: глобальное состояние, горячие клавиши и перетаскивание панелей

// ---------- Часть 1: Глобальное состояние (бывший state.js) ----------
const AppState = {
    editMode: false,
    eraserMode: false,
    currentTileType: 'grass',
    brushRadius: 0,
    tileHeight: 1.0,
    isGM: false,
    lobbyId: null,
    token: localStorage.getItem('access_token') || null,
    settingsVisible: false,
    participantsPanelCollapsed: false,

    setEditMode(value) { this.editMode = value; },
    setEraserMode(value) { this.eraserMode = value; window.eraserMode = value; },
    setCurrentTileType(value) { this.currentTileType = value; window.currentTileType = value; },
    setBrushRadius(value) { this.brushRadius = value; window.brushRadius = value; },
    setTileHeight(value) { this.tileHeight = value; window.tileHeight = value; },
    setIsGM(value) { this.isGM = value; },
    setLobbyId(value) { this.lobbyId = value; },
    setSettingsVisible(value) { this.settingsVisible = value; },
    setParticipantsPanelCollapsed(value) { this.participantsPanelCollapsed = value; }
};

window.currentTileType = AppState.currentTileType;
window.tileHeight = AppState.tileHeight;
window.brushRadius = AppState.brushRadius;
window.eraserMode = AppState.eraserMode;

export default AppState;

// ---------- Часть 2: Перетаскивание панелей ----------
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
        if (e.button !== 0) return;
        if (e.target.closest('button, input, select, textarea, a, [contenteditable="true"], [draggable="true"], .toggle-btn, .close, .character-card, .character-card *')) return;
        e.preventDefault();
        panel.style.transition = 'none';
        panel.style.zIndex = '110';
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
        // Keep a visible grab area even when a panel is larger than the viewport.
        newLeft = Math.min(Math.max(newLeft, 0), Math.max(0, winW - Math.min(startWidth, 80)));
        newTop = Math.min(Math.max(newTop, 0), Math.max(0, winH - Math.min(startHeight, 56)));
        panel.style.left = newLeft + 'px';
        panel.style.top = newTop + 'px';
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            panel.style.cursor = '';
            panel.style.transition = '';
            panel.style.zIndex = '100';
            const rect = panel.getBoundingClientRect();
            savePanelState(panelId, { position: { left: rect.left, top: rect.top } });
        }
    };

    panel.addEventListener('mousedown', onMouseDown);
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
        if (panel.dataset.draggableInitialized === 'true') return;
        const panelId = panel.id;
        if (!panelId) return;
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
            if (saved.position) applyPosition(panel, saved.position);
        }
        makeDraggable(panel, header, panelId);
        panel.dataset.draggableInitialized = 'true';
    });

    document.querySelectorAll('.modal .modal-content').forEach(modalContent => {
        if (modalContent.dataset.draggableInitialized === 'true') return;
        const modal = modalContent.closest('.modal');
        const panelId = modal?.id;
        if (!panelId) return;
        makeDraggable(modalContent, modalContent, panelId);
        modalContent.dataset.draggableInitialized = 'true';
    });
}

// ---------- Часть 3: Горячие клавиши ----------
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
    '#inventory-template-picker-modal',
    '#ammo-selection-modal',
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
        if (modalOpen && !wasOpen && typeof window.hideTooltip === 'function') window.hideTooltip();
    }

    if (tileModal) new MutationObserver(updateModalOpen).observe(tileModal, { attributes: true, attributeFilter: ['style'] });
    if (visModal) new MutationObserver(updateModalOpen).observe(visModal, { attributes: true, attributeFilter: ['style'] });
    if (createMarkerModal) new MutationObserver(updateModalOpen).observe(createMarkerModal, { attributes: true, attributeFilter: ['style'] });
    if (editMarkerModal) new MutationObserver(updateModalOpen).observe(editMarkerModal, { attributes: true, attributeFilter: ['style'] });
    if (charSheetModal) new MutationObserver(updateModalOpen).observe(charSheetModal, { attributes: true, attributeFilter: ['style'] });

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('blur', handleBlur);
}

function handleKeyDown(e) {
    // ---- Локация активна? Перенаправляем вызовы ----
    if (window.isLocationActive) {
        // ESC
        if (e.key === 'Escape') {
            let anyCustomOpen = false;
            customModals.forEach(selector => {
                const modal = document.querySelector(selector);
                if (modal && modal.style.display === 'flex') {
                    anyCustomOpen = true;
                    modal.style.display = 'none';
                }
            });
            if (anyCustomOpen) { e.preventDefault(); return; }
            if (modalOpen) {
                e.preventDefault();
                closeTileEditModal();
                closeVisibilityModal();
                if (typeof window.closeMarkerEditModal === 'function') window.closeMarkerEditModal();
                if (typeof window.closeCharacterSheet === 'function') window.closeCharacterSheet();
                const createModal = document.getElementById('marker-create-modal');
                if (createModal && createModal.style.display === 'flex') createModal.style.display = 'none';
            }
            return;
        }
        // Enter в чате
        if (e.key === 'Enter') {
            const target = e.target;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
            if (isInput && target.id === 'message-input') {
                e.preventDefault();
                window.sendMessage();
            }
            return;
        }
        // Alt
        if (e.key === 'Alt') {
            e.preventDefault();
            altPressed = true;
            if (window.locationControls) window.locationControls.enableZoom = false;
            if (controls) controls.enableZoom = false;
            return;
        }
        // E – режим редактирования
        if (e.code === 'KeyE' && !modalOpen) {
            e.preventDefault();
            if (window.isGM) {
                window.toggleEditMode();
            }
            return;
        }
        // R – ластик
        if (e.code === 'KeyR' && !modalOpen) {
            e.preventDefault();
            const locEraser = document.getElementById('loc-eraser');
            if (locEraser) {
                const newState = !locEraser.checked;
                locEraser.checked = newState;
                window.setEraserModeFromInput(newState);
            }
            return;
        }
        // Alt + = / - (радиус)
        if (e.altKey && e.code === 'Equal') {
            e.preventDefault();
            const locRadiusSlider = document.getElementById('loc-edit-radius');
            if (locRadiusSlider) {
                const current = parseInt(locRadiusSlider.value);
                const newRadius = Math.min(5, Math.max(0, current + 1));
                window.setBrushRadiusFromInput(newRadius);
            }
            return;
        }
        if (e.altKey && e.code === 'Minus') {
            e.preventDefault();
            const locRadiusSlider = document.getElementById('loc-edit-radius');
            if (locRadiusSlider) {
                const current = parseInt(locRadiusSlider.value);
                const newRadius = Math.min(5, Math.max(0, current - 1));
                window.setBrushRadiusFromInput(newRadius);
            }
            return;
        }
        // [ и ] – тип тайла
        if (e.code === 'BracketLeft') {
            e.preventDefault();
            const select = document.getElementById('loc-edit-terrain');
            if (select) {
                const options = Array.from(select.options);
                let newIndex = (select.selectedIndex - 1 + options.length) % options.length;
                select.selectedIndex = newIndex;
                window.setCurrentTileTypeFromUI?.(select.value);
            }
            return;
        }
        if (e.code === 'BracketRight') {
            e.preventDefault();
            const select = document.getElementById('loc-edit-terrain');
            if (select) {
                const options = Array.from(select.options);
                let newIndex = (select.selectedIndex + 1) % options.length;
                select.selectedIndex = newIndex;
                window.setCurrentTileTypeFromUI?.(select.value);
            }
            return;
        }
        // = и - без Alt – высота
        if (!e.altKey && e.code === 'Equal') {
            e.preventDefault();
            const locHeightSlider = document.getElementById('loc-edit-height');
            if (locHeightSlider) {
                let current = parseFloat(locHeightSlider.value);
                let newHeight = Math.min(3.0, Math.max(0.5, current + 0.1));
                newHeight = Math.round(newHeight * 10) / 10;
                window.setTileHeightFromInput(newHeight);
            }
            return;
        }
        if (!e.altKey && e.code === 'Minus') {
            e.preventDefault();
            const locHeightSlider = document.getElementById('loc-edit-height');
            if (locHeightSlider) {
                let current = parseFloat(locHeightSlider.value);
                let newHeight = Math.min(3.0, Math.max(0.5, current - 0.1));
                newHeight = Math.round(newHeight * 10) / 10;
                window.setTileHeightFromInput(newHeight);
            }
            return;
        }
        // Остальные клавиши игнорируем
        return;
    }

    // ---- Глобальная карта (оригинальное поведение) ----
    if (e.key === 'Escape') {
        let anyCustomOpen = false;
        customModals.forEach(selector => {
            const modal = document.querySelector(selector);
            if (modal && modal.style.display === 'flex') {
                anyCustomOpen = true;
                modal.style.display = 'none';
            }
        });
        if (anyCustomOpen) { e.preventDefault(); return; }
        if (modalOpen) {
            e.preventDefault();
            closeTileEditModal();
            closeVisibilityModal();
            if (typeof window.closeMarkerEditModal === 'function') window.closeMarkerEditModal();
            if (typeof window.closeCharacterSheet === 'function') window.closeCharacterSheet();
            const createModal = document.getElementById('marker-create-modal');
            if (createModal && createModal.style.display === 'flex') createModal.style.display = 'none';
        }
        return;
    }

    const target = e.target;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (e.key === 'Enter' && isInput && target.id === 'message-input') {
        e.preventDefault();
        window.sendMessage();
        return;
    }

    if (isInput) return;

    if (e.key === 'Alt') {
        altPressed = true;
        if (controls) controls.enableZoom = false;
    }

    if (e.altKey && e.code === 'Equal') {
        e.preventDefault();
        const newRadius = Math.min(5, Math.max(0, AppState.brushRadius + 1));
        setBrushRadiusFromInput(newRadius);
        return;
    }
    if (e.altKey && e.code === 'Minus') {
        e.preventDefault();
        const newRadius = Math.min(5, Math.max(0, AppState.brushRadius - 1));
        setBrushRadiusFromInput(newRadius);
        return;
    }

    if (e.code === 'BracketLeft') {
        e.preventDefault();
        const select = document.getElementById('tile-type-select');
        if (select) {
            const options = Array.from(select.options);
            let newIndex = (select.selectedIndex - 1 + options.length) % options.length;
            select.selectedIndex = newIndex;
            AppState.setCurrentTileType(select.value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
    }
    if (e.code === 'BracketRight') {
        e.preventDefault();
        const select = document.getElementById('tile-type-select');
        if (select) {
            const options = Array.from(select.options);
            let newIndex = (select.selectedIndex + 1) % options.length;
            select.selectedIndex = newIndex;
            AppState.setCurrentTileType(select.value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
    }

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

    if (e.code === 'KeyE') {
        e.preventDefault();
        if (AppState.isGM) setEditMode(!getEditMode());
        return;
    }
}

function handleKeyUp(e) {
    if (e.key === 'Alt') {
        altPressed = false;
        if (window.locationControls) window.locationControls.enableZoom = true;
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
    // ---- Локация активна ----
    if (window.isLocationActive) {
        if (e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            const locRadiusSlider = document.getElementById('loc-edit-radius');
            if (locRadiusSlider) {
                const delta = e.deltaY > 0 ? -1 : 1;
                const current = parseInt(locRadiusSlider.value);
                const newRadius = Math.min(5, Math.max(0, current + delta));
                window.setBrushRadiusFromInput(newRadius);
            }
        }
        return;
    }

    // ---- Глобальная карта ----
    if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -1 : 1;
        const newRadius = Math.min(5, Math.max(0, AppState.brushRadius + delta));
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
