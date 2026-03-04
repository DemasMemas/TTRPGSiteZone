// static/js/hotkeys.js
import AppState from './state.js';
import { setBrushRadiusFromInput, setTileHeightFromInput, setEraserModeFromInput, setEditMode, getEditMode } from './mapEdit.js';
import { closeTileEditModal } from './mapEdit.js';
import { closeVisibilityModal } from './ui.js';

let modalOpen = false; // флаг, открыто ли какое-либо модальное окно

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
    document.addEventListener('wheel', handleWheel, { passive: false });
}

function handleKeyDown(e) {
    // Игнорируем, если фокус в поле ввода (кроме Enter для отправки)
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

    // Если фокус в поле ввода, остальные комбинации игнорируем
    if (isInput) return;

    // --- Глобальные комбинации ---

    // Alt + = (клавиша + без Shift) - увеличение радиуса кисти
    if (e.altKey && e.code === 'Equal') {
        e.preventDefault();
        const newRadius = Math.min(3, Math.max(0, AppState.brushRadius + 1));
        setBrushRadiusFromInput(newRadius);
        return;
    }

    // Alt + - (клавиша минус) - уменьшение радиуса кисти
    if (e.altKey && e.code === 'Minus') {
        e.preventDefault();
        const newRadius = Math.min(3, Math.max(0, AppState.brushRadius - 1));
        setBrushRadiusFromInput(newRadius);
        return;
    }

    // [ - предыдущий тип тайла
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

    // ] - следующий тип тайла
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

    // = (без Alt) - увеличение высоты
    if (!e.altKey && e.code === 'Equal') {
        e.preventDefault();
        const newHeight = Math.min(3.0, Math.max(0.5, AppState.tileHeight + 0.1));
        setTileHeightFromInput(newHeight);
        return;
    }

    // - (без Alt) - уменьшение высоты
    if (!e.altKey && e.code === 'Minus') {
        e.preventDefault();
        const newHeight = Math.min(3.0, Math.max(0.5, AppState.tileHeight - 0.1));
        setTileHeightFromInput(newHeight);
        return;
    }

    // R - переключение ластика (раньше было Delete)
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

    // E - переключение Edit Mode (только для ГМ)
    if (e.code === 'KeyE') {
        e.preventDefault();
        if (AppState.isGM) {
            setEditMode(!getEditMode());
        }
        return;
    }

    // Цифры 1-5 можно будет добавить позже
}

function handleWheel(e) {
    // Alt + колесо - радиус кисти (с блокировкой масштабирования камеры)
    if (e.altKey) {
        e.preventDefault();
        e.stopPropagation(); // дополнительная защита от OrbitControls
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
        return;
    }
}