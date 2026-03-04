// static/js/draggable.js

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

        // Отключаем transitions на время перетаскивания
        panel.style.transition = 'none';

        // Получаем текущие координаты панели на экране
        const rect = panel.getBoundingClientRect();

        // Принудительно выставляем позицию через left/top, сбрасываем transform
        panel.style.left = rect.left + 'px';
        panel.style.top = rect.top + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'none';

        // Запоминаем стартовые данные
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

        // Вычисляем смещение мыши
        const dx = e.clientX - startMouseX;
        const dy = e.clientY - startMouseY;

        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        // Ограничения: панель должна быть полностью видима
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
            panel.style.transition = ''; // восстанавливаем transition
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