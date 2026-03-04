// static/js/hotkeys.js
import AppState from './state.js';
import { setBrushRadiusFromInput, setTileHeightFromInput, setEraserModeFromInput, setEditMode, getEditMode } from './mapEdit.js';
import { closeTileEditModal } from './mapEdit.js';
import { closeVisibilityModal } from './ui.js';
import { controls } from './lobby3d.js'; // импортируем controls

let modalOpen = false;
let altPressed = false;

export function initHotkeys() {
    // Наблюдаем за модальными окнами
    const tileModal = document.getElementById('tile-edit-modal');
    const visModal = document.getElementById('visibility-modal');

    if (tileModal) {
        const observer = new MutationObserver(() => {
            modalOpen = tileModal.style.display === 'flex' || visModal?.style.display === 'flex';
        });
        observer.observe(tileModal, { attributes: true, attributeFilter: ['style'] });
    }
    if (visModal) {
        const observer = new MutationObserver(() => {
            modalOpen = visModal.style.display === 'flex' || tileModal?.style.display === 'flex';
        });
        observer.observe(visModal, { attributes: true, attributeFilter: ['style'] });
    }

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('blur', handleBlur); // на случай, если Alt зажат и окно теряет фокус
}

function handleKeyDown(e) {
    // Отслеживаем нажатие Alt
    if (e.key === 'Alt') {
        altPressed = true;
        if (controls) controls.enableZoom = false;
    }

    const target = e.target;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // ESC - закрыть модальное окно
    if (e.key === 'Escape') {
        if (modalOpen) {
            e.preventDefault();
            closeTileEditModal();
            closeVisibilityModal();
        }
        return;
    }

    // Enter - отправить сообщение, если фокус в поле ввода сообщения
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
    // Если окно теряет фокус, сбрасываем Alt
    if (altPressed) {
        altPressed = false;
        if (controls) controls.enableZoom = true;
    }
}

function handleWheel(e) {
    // Alt + колесо - радиус кисти
    if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -1 : 1;
        const newRadius = Math.min(3, Math.max(0, AppState.brushRadius + delta));
        setBrushRadiusFromInput(newRadius);
        return;
    }

    // Если мышь над селектом типа тайла - переключение типа
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